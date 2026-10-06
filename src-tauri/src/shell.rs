//! The windows and what they do, on one thread: every event (the page said something, a file
//! changed, a timer ran out) is taken from one queue and handled to the end before the next.
//!
//! Opened on a folder (or started without arguments, which reopens the last folder) the
//! window gets a sidebar listing the folder's notes, by file name or by title (first H1), and
//! can create, rename and trash them. Ctrl+E switches between reading and editing the source
//! in place; edits are saved automatically (the page sends the text, this side writes the file).

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::LazyLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use notify::{RecursiveMode, Watcher};
use regex::Regex;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

use crate::ai::{self, Completer, Drawing, Illustrator};
use crate::github::{self, News, Session};
use crate::history::{self, Historian, Place, Stamp};
use crate::share;
use crate::sync::{self, Access};
use crate::scan::{self, clean_name, file_kind, is_md, is_pdf, quote, read_bytes, read_text, resolve, s, unquote, Node, Resolver, TitleCache};
use crate::theme::{self, home, Theme};
use crate::{host, Event, Pick, ORIGIN, SHARED};

const OPENED_LIMIT: usize = 3000; // notes whose last opening is remembered
const SF_SYMBOLS: &str = ".SF Symbols Fallback"; // the font the app's signs are set in, where it is installed (viewer.js)
const RESIDENT_MS: u64 = 15 * 60 * 1000;
const SYNC_MS: u64 = 60 * 1000; // how often a linked project's other side is looked at, while a window shows the project
const EMBED_LIMIT: usize = 256 * 1024;
const EDIT_LIMIT: usize = 2 * 1024 * 1024;
const PREVIEW_BYTES: usize = 2400; // of a note's beginning, for its tile in the overview
const PREVIEW_BATCH: usize = 60; // notes read per request for the overview
const WATCH_LIMIT: usize = 400; // directories watched below an open folder
const SIDEBAR_WIDTH: i64 = 260; // extra default width of a folder window; matches --sb-w

static DEBUG: LazyLock<bool> = LazyLock::new(|| env("MDVIEW_DEBUG").is_some());
// Development: a script evaluated in every page once it has rendered; what it posts as
// {"type": "probe", "name": …, "text": …} is written into the directory MDVIEW_PROBE_OUT as
// <file name>.<name>.json. See dev/rig.sh.
static PROBE: LazyLock<Option<String>> = LazyLock::new(|| env("MDVIEW_PROBE"));
static PROBE_OUT: LazyLock<Option<String>> = LazyLock::new(|| env("MDVIEW_PROBE_OUT"));
static WIKI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!?\[\[([^\[\]\n]+?)\]\]").unwrap());
static TASK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([\s>]*(?:[-*+]|\d+[.)])\s+\[)(.)(\])").unwrap());
static WORD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\w-]+").unwrap());

const SCRIPTS: &[&str] = &[
    "vendor/markdown-it.min.js",
    "vendor/footnote.min.js",
    "vendor/deflist.min.js",
    "vendor/mark.min.js",
    "vendor/sub.min.js",
    "vendor/sup.min.js",
    "vendor/abbr.min.js",
    "vendor/emoji.min.js",
    "vendor/js-yaml.min.js",
    "vendor/highlight.min.js",
    "vendor/highlight-extra.min.js",
    "vendor/katex/katex.min.js",
    "strings.js",
    "viewer.js",
    "overview.js",
];

/// Settings of the active mode (state.json "active"), with what they are when nothing is set.
fn default_prefs() -> Map<String, Value> {
    let prefs = json!({
        "lang": "en",           // the active mode's own texts: "en" | "de"
        "startMode": "last",    // a new window: "last" (the mode used last) | "read" | "active" | "edit"
        "bar": true,            // the formatting bar over a selection
        "slash": true,          // "/" at the start of an empty line opens the insert menu
        "syntax": false,        // the Markdown of the formatting at the caret shows
        "quotes": false,        // typed quotes become typographic ones
        "wrap": 0,              // paragraphs written anew are wrapped at this many characters (0: not)
        "images": "beside",     // pasted and dropped pictures: "beside" the note | "assets" | a folder relative to the note
        "style": "auto",        // new Markdown: "auto" (as the document does it) | "fixed" (the choices below)
        "bullet": "-", "emphasis": "*", "strongMark": "**", "ordered": ".",
        "dialogWidth": 0, "dialogHeight": 0,  // a dialog's size, once one was pulled to another (0: its own)
        // the formula editor (LaTeX Suite): snippets, "/" makes a fraction, matrix keys, Tab leaves
        // brackets, brackets grow around sums, bracket pairs coloured, "mk" / "dm" in the text
        "latexSnippets": true, "latexFraction": true, "latexMatrix": true, "latexTabout": true,
        "latexEnlarge": true, "latexBrackets": true, "latexText": true,
        // the PDF viewer: what a link to a selection is copied as ("callout" | "quote" | "link" |
        // "embed"), and whether selecting text copies at once
        "pdfFormat": "callout", "pdfAuto": false,
        // what the folder sidebar lists beside the notes: PDFs, pictures, sound and film, everything else
        "sidebarPdf": true, "sidebarImages": false, "sidebarMedia": false, "sidebarOther": false,
        "sidebarSort": "opened",  // the notes of a folder, in the sidebar and the tiles: "opened" (last opened first) | "name" | "modified"
        // a continuation suggested while typing (the text around the caret goes to the model's maker)
        "aiComplete": false,
        "panel": false, "panelTab": "insert",   // the panel at the window's right (insert, format): open, and its tab
        "ovScope": "all", "ovLayout": "tiles",  // all notes: "all" | "folders" (one at a time), as "tiles" | "list"
        "measure": "normal",      // the text column's width: "narrow" | "normal" | "wide" | "full"
        "docZoom": 100,           // the note's text, in percent (Ctrl + and −)
        "hinting": false,         // text drawn on whole pixels (sharper on a screen of ordinary resolution); at the next start
        "aiModel": "",            // the model asked for suggestions ("": AI_MODEL)
        "historyQuiet": 30,       // a project's changes are kept as a commit after this many seconds without another
        "deviceName": "",         // what this device is called in a commit ("": the computer's name)
    });
    match prefs {
        Value::Object(m) => m,
        _ => unreachable!(),
    }
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mtime(path: &Path) -> std::io::Result<f64> {
    Ok(fs::metadata(path)?.modified()?.duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0))
}

/// What went wrong, as the system words it ("Permission denied").
fn strerror(e: &std::io::Error) -> String {
    let text = e.to_string();
    text.split(" (os error").next().unwrap_or(&text).to_string()
}

fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn dir_of(path: &Path) -> PathBuf {
    path.parent().map(Path::to_path_buf).unwrap_or_default()
}

fn take(text: &str, n: usize) -> String {
    text.chars().take(n).collect()
}

/// A file as the page asks for it (see main.rs).
pub fn file_url(path: &Path) -> String {
    let p = s(path).replace('\\', "/");
    format!("{ORIGIN}/file{}{}", if p.starts_with('/') { "" } else { "/" }, quote(&p))
}

/// The file an address of the page's (or a file: address) names, and the place in it.
fn url_file(href: &str) -> Option<(PathBuf, Option<String>)> {
    let u = tauri::Url::parse(href).ok()?;
    let frag = u.fragment().map(unquote).filter(|f| !f.is_empty());
    if href.starts_with(ORIGIN) {
        let p = unquote(u.path().strip_prefix("/file")?);
        return Some((PathBuf::from(if cfg!(windows) { p.trim_start_matches('/').to_string() } else { p }), frag));
    }
    if u.scheme() == "file" {
        return Some((u.to_file_path().ok().unwrap_or_else(|| PathBuf::from(unquote(u.path()))), frag));
    }
    None
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            c => out.push(c),
        }
    }
    out
}

fn relative(target: &Path, base: &Path) -> String {
    let (t, b): (Vec<_>, Vec<_>) = (target.components().collect(), base.components().collect());
    let same = t.iter().zip(b.iter()).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = b[same..].iter().map(|_| "..".to_string()).collect();
    parts.extend(t[same..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()));
    if parts.is_empty() { ".".into() } else { parts.join("/") }
}

fn can_write(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        std::ffi::CString::new(path.as_os_str().as_bytes()).is_ok_and(|c| unsafe { libc::access(c.as_ptr(), libc::W_OK) == 0 })
    }
    #[cfg(not(unix))]
    {
        fs::metadata(path).is_ok_and(|m| !m.permissions().readonly())
    }
}

/// Why the file can't be edited in place, or None if it can.
fn readonly_reason(path: &Path, raw: Option<&[u8]>) -> Option<&'static str> {
    let Some(raw) = raw else {
        return (!can_write(&dir_of(path))).then_some("folder is read-only");
    };
    if !can_write(path) {
        Some("file is read-only")
    } else if raw.len() > EDIT_LIMIT {
        Some("file is too large")
    } else if std::str::from_utf8(raw).is_err() {
        Some("file is not UTF-8")
    } else {
        None
    }
}

/// A new file in folder, named by name(1), name(2), … — the first that is free.
fn write_new(folder: &Path, name: impl Fn(u32) -> String, data: &[u8], tries: u32) -> std::io::Result<PathBuf> {
    fs::create_dir_all(folder)?;
    for n in 1..tries {
        let target = folder.join(name(n));
        match fs::OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(mut f) => {
                f.write_all(data)?;
                return Ok(target);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "File exists"))
}

/// The key put last (what was used last stands last), the oldest dropped beyond the limit.
fn bump(map: &mut Map<String, Value>, key: &str, value: Value, limit: usize) {
    map.shift_remove(key);
    map.insert(key.to_string(), value);
    while map.len() > limit {
        let Some(first) = map.keys().next().cloned() else { break };
        map.shift_remove(&first);
    }
}

/// This computer's name, for the device a commit names.
fn host_name() -> String {
    #[cfg(unix)]
    {
        let mut buf = [0u8; 256];
        if unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) } == 0 {
            let name = String::from_utf8_lossy(&buf[..buf.iter().position(|b| *b == 0).unwrap_or(buf.len())]).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    env("COMPUTERNAME").unwrap_or_else(|| "device".into())
}

fn state_file() -> PathBuf {
    let base = env("XDG_STATE_HOME").map(PathBuf::from);
    #[cfg(windows)]
    let base = base.or_else(|| env("LOCALAPPDATA").map(PathBuf::from));
    base.unwrap_or_else(|| home().join(".local/state")).join("mdview").join("state.json")
}

/// The snippets file as a function the page can call, or "" (it is the user's own JavaScript,
/// run in the page like the plugin runs it). Snippets of one's own for the formula editor, as
/// Obsidian LaTeX Suite reads them ("export default [ … ]"); they take the place of the built-in ones.
fn user_snippets() -> String {
    static EXPORT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"export\s+default").unwrap());
    let Ok(source) = fs::read_to_string(ai::config_dir().join("snippets.js")) else { return String::new() };
    if source.trim().is_empty() {
        return String::new();
    }
    let body = if EXPORT_RE.is_match(&source) {
        EXPORT_RE.replacen(&source, 1, "return ").into_owned()
    } else {
        format!("return ({}\n)", source.trim_end().trim_end_matches(';'))
    };
    format!("window.MdSnippets = function (require) {{\n{}\n}};", body.replace("</", "<\\/"))
}

fn nonce() -> String {
    use std::hash::{BuildHasher, Hasher};
    (0..2).map(|_| format!("{:016x}", std::collections::hash_map::RandomState::new().build_hasher().finish())).collect()
}

fn app_version() -> String {
    let out = std::process::Command::new("git").arg("-C").arg(&SHARED.assets).args(["log", "-1", "--format=%h · %cs"]).output();
    let said = out.ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    if said.is_empty() { env!("CARGO_PKG_VERSION").to_string() } else { said }
}

struct Tab {
    id: u64,
    path: Option<PathBuf>,
    back: Vec<PathBuf>,
    fwd: Vec<PathBuf>,
}

pub struct Win {
    label: String,
    window: Option<WebviewWindow>,
    title: String,
    path: Option<PathBuf>,
    folder: Option<PathBuf>, // set: this window browses a folder (sidebar)
    tree: Option<Node>,
    tree_json: Option<String>,
    note_paths: HashSet<String>,
    kept_dirs: HashSet<String>, // folders made from the sidebar: shown although nothing is in them yet
    share_asked: Option<PathBuf>, // the note whose sharing the page last asked about: told again when its project was kept or reconciled
    title_cache: TitleCache,
    watcher: Option<notify::RecommendedWatcher>,
    watched: HashSet<PathBuf>,   // every directory the watcher looks at
    dir_watch: HashSet<PathBuf>, // … for the folder's tree
    rescan_turn: u64,
    reload_turn: u64,
    close_turn: u64,
    shell_ready: bool,
    loading_shell: bool,
    shell_n: u64,
    pending_fragment: Option<String>,
    back: Vec<PathBuf>,
    fwd: Vec<PathBuf>,
    // a folder window's tabs. The one shown is the window's own path, back and fwd; it is
    // written into its tab when another takes its place.
    tabs: Vec<Tab>,
    tab: usize,
    tab_seq: u64,
    tabs_json: Option<String>,
    closed_tabs: Vec<(PathBuf, usize)>, // (path, place) of tabs closed here, for Ctrl+Shift+T
    resolver: Option<Resolver>,
    editing: bool,
    own_text: Option<String>,
    own_write: Option<Vec<u8>>, // bytes just written here: the reload for them is skipped
    closing: bool,
    getting: Option<(String, String, String)>, // a repository to fetch (url, folder name, branch), while its place is being chosen
    mode_given: bool, // the page was told which mode the app was last used in
    save_seq: Value,
    zoom: f64,
    gone: bool,
}

pub struct App {
    handle: AppHandle,
    tx: Sender<Event>,
    state: Map<String, Value>,
    theme: Theme,
    sf_symbols: bool,
    wins: HashMap<String, Win>,
    seq: u64,
    theme_turn: u64,
    idle_turn: u64,
    completer: Option<Completer>,
    illustrator: Illustrator,
    historian: Historian,
    unsnapped: HashMap<PathBuf, u64>, // projects touched since their last snapshot, and the turn that will make it
    snap_turn: u64,
    said_big: HashSet<String>, // files left out of a history for their size, said once
    session: Option<Session>,  // the user signed in with GitHub: the token for a linked project's other side, and who it is
    signing: Option<(std::sync::Arc<std::sync::atomic::AtomicBool>, Option<(String, String)>)>, // a sign-in under way: to stop it, and the code to confirm (and where) once told
    github_said: String,       // why the last sign-in did not go, for the settings
    repos: Option<Vec<Value>>, // the repositories the app was given on the user's account, once read
    renew_turn: u64,
    synced: HashMap<PathBuf, Value>, // linked projects: how they stood when last reconciled, and when
    watcher: Option<notify::RecommendedWatcher>,
    started: Option<SystemTime>, // the program file as it was when this started
}

pub fn run(handle: AppHandle, tx: Sender<Event>, rx: Receiver<Event>) {
    let state = fs::read_to_string(state_file()).ok().and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok()).unwrap_or_default();
    let mut app = App {
        illustrator: Illustrator::new(tx.clone()),
        historian: Historian::new(tx.clone()),
        unsnapped: HashMap::new(),
        snap_turn: 0,
        said_big: HashSet::new(),
        session: None,
        signing: None,
        github_said: String::new(),
        repos: None,
        renew_turn: 0,
        synced: HashMap::new(),
        handle,
        tx,
        state,
        theme: theme::load_theme(),
        sf_symbols: host::has_font(SF_SYMBOLS),
        wins: HashMap::new(),
        seq: 0,
        theme_turn: 0,
        idle_turn: 0,
        completer: None,
        watcher: None,
        started: std::env::current_exe().ok().and_then(|p| fs::metadata(p).ok()).and_then(|m| m.modified().ok()),
    };
    app.blank_page();
    if truthy(&app.prefs()["hinting"]) {
        host::hinting(&app.handle);
    }
    app.watch_theme();
    app.after(app.sync_ms(), Event::SyncTick);
    github::resume(app.tx.clone(), app.keyring_place()); // (a sign-in kept from before)
    for event in rx {
        app.on_event(event);
    }
}

impl App {
    fn after(&self, ms: u64, event: Event) {
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(ms));
            let _ = tx.send(event);
        });
    }

    fn save_state(&self) {
        let file = state_file();
        let _ = fs::create_dir_all(dir_of(&file));
        let _ = fs::write(file, Value::Object(self.state.clone()).to_string());
    }

    // -- history ----------------------------------------------------------

    /// Who this program's commits are made by: the device (state.json "device": an id made
    /// once, and a name that is the computer's until another is set).
    fn stamp(&mut self) -> Stamp {
        let known = |d: &Value, k: &str| d.get(k).and_then(Value::as_str).filter(|v| !v.is_empty()).map(String::from);
        let device = self.state.get("device").cloned().unwrap_or(Value::Null);
        let (id, name) = match (known(&device, "id"), known(&device, "name")) {
            (Some(id), Some(name)) => (id, name),
            (id, name) => {
                let (id, name) = (id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()), name.unwrap_or_else(host_name));
                self.state.insert("device".into(), json!({ "id": id, "name": name }));
                self.save_state();
                (id, name)
            }
        };
        let name = self.prefs()["deviceName"].as_str().map(str::trim).filter(|n| !n.is_empty()).map(String::from).unwrap_or(name);
        Stamp { device: format!("{name} ({id})"), client: format!("desktop {}", env!("CARGO_PKG_VERSION")), author: self.session.as_ref().map(Session::author) }
    }

    /// Something at this path changed, or may have: its project, if it is in one, gets a
    /// snapshot once it has been quiet for a while.
    fn touch(&mut self, path: &Path) {
        if path.components().any(|c| c.as_os_str() == ".git") {
            return; // (the history's own writing)
        }
        let Place::Project(root) = history::place_of(path) else { return };
        self.snap_turn += 1;
        self.unsnapped.insert(root.clone(), self.snap_turn);
        let quiet = env("MDVIEW_HISTORY_QUIET_MS").and_then(|ms| ms.parse().ok()).unwrap_or_else(|| self.prefs()["historyQuiet"].as_u64().unwrap_or(30).max(1) * 1000);
        self.after(quiet, Event::Snapshot { root, turn: self.snap_turn });
    }

    fn access(&self) -> Access {
        Access { token: self.session.as_ref().map(|s| s.access.clone()) }
    }

    /// What waits in a project is kept now, and a linked one reconciled — not after the quiet while.
    fn keep_now(&mut self, root: &Path) {
        self.unsnapped.remove(root);
        let (stamp, access) = (self.stamp(), self.access());
        self.historian.snapshot(root, stamp, access);
    }

    /// The name the sign-in is kept under in the keyring: the folder this instance's state is in.
    fn keyring_place(&self) -> String {
        s(&dir_of(&state_file()))
    }

    /// For the page's settings: who is signed in, a code waiting to be confirmed, why it did not go.
    fn github_shown(&self) -> Value {
        json!({
            "user": self.session.as_ref().map(github::shown),
            "code": self.signing.as_ref().and_then(|(_, code)| code.as_ref()).map(|(code, uri)| json!({ "code": code, "uri": uri })),
            "busy": self.signing.is_some(),
            "repos": self.repos,
            "said": self.github_said,
        })
    }

    fn on_github(&mut self, news: News) {
        match news {
            News::Code { code, uri } => {
                if let Some((_, shown)) = self.signing.as_mut() {
                    *shown = Some((code, uri));
                }
            }
            News::In(session, note) => {
                // (renewed a while before it ends; a linked project's other side is looked at now)
                let left = session.expires.saturating_sub(now()).saturating_sub(600).max(60);
                self.renew_turn += 1;
                self.after(left * 1000, Event::GitHubRenew { turn: self.renew_turn });
                self.session = Some(session);
                self.signing = None;
                self.github_said = note.unwrap_or_default();
                self.sync_shown();
            }
            News::Out(why) => {
                if self.signing.take().is_none() {
                    self.session = None; // (a sign-in kept from before that GitHub takes no more)
                    self.repos = None;
                }
                self.github_said = why;
            }
            News::Repos(Ok(list)) => self.repos = Some(list),
            News::Repos(Err(e)) => {
                self.repos = Some(vec![]);
                self.github_said = e;
            }
            News::Later => {
                self.renew_turn += 1;
                self.after(60_000, Event::GitHubRenew { turn: self.renew_turn });
            }
        }
        self.each_win(|w, app| w.settings_info(app));
    }

    fn sync_ms(&self) -> u64 {
        env("MDVIEW_SYNC_MS").and_then(|ms| ms.parse().ok()).unwrap_or(SYNC_MS) // (the override: for tests)
    }

    /// The projects the windows show.
    fn shown_projects(&self) -> HashSet<PathBuf> {
        self.wins.values().filter_map(|w| w.path.as_deref().or(w.folder.as_deref())).filter_map(|p| match history::place_of(p) {
            Place::Project(root) => Some(root),
            _ => None,
        }).collect()
    }

    /// The linked projects on screen are reconciled with their other side — not one that has
    /// changes waiting to be kept: its snapshot comes, and reconciles (and nothing is fetched
    /// into a folder that is being written in).
    fn sync_shown(&mut self) {
        for root in self.shown_projects() {
            if !self.unsnapped.contains_key(&root) && sync::linked(&root).is_some() {
                let (stamp, access) = (self.stamp(), self.access());
                self.historian.sync(&root, stamp, access);
            }
        }
    }

    /// Where a folder stands with a history, for the page: history::standing, and for a linked
    /// project where its other side is and how the two stood when last reconciled.
    fn standing(&self, folder: &Path) -> Value {
        let mut all = history::standing(folder);
        if let Some(root) = all["root"].as_str().map(PathBuf::from).filter(|_| all["state"] == "project" || all["state"] == "inside") {
            if let Some(url) = sync::linked(&root) {
                all["linked"] = json!(url);
                all["sync"] = self.synced.get(&root).cloned().unwrap_or(Value::Null);
            }
        }
        all
    }

    /// The snapshots still waiting are made now — all of them, or (keep) only those of projects
    /// no window shows any more.
    fn snapshot_waiting(&mut self, keep: bool) {
        let shown = if keep { self.shown_projects() } else { HashSet::new() };
        let due: Vec<PathBuf> = self.unsnapped.keys().filter(|root| !shown.contains(*root)).cloned().collect();
        for root in due {
            self.unsnapped.remove(&root);
            let (stamp, access) = (self.stamp(), self.access());
            self.historian.snapshot(&root, stamp, access);
        }
    }

    fn sub(&mut self, key: &str) -> &mut Map<String, Value> {
        let slot = self.state.entry(key.to_string()).or_insert_with(|| json!({}));
        if !slot.is_object() {
            *slot = json!({});
        }
        slot.as_object_mut().unwrap()
    }

    fn prefs(&self) -> Map<String, Value> {
        let mut prefs = default_prefs();
        if let Some(stored) = self.state.get("active").and_then(Value::as_object) {
            for (k, v) in stored {
                if prefs.contains_key(k) {
                    prefs.insert(k.clone(), v.clone());
                }
            }
        }
        prefs
    }

    /// What the page changed of the settings, kept; all of them as they now are.
    fn store_prefs(&mut self, new: &Map<String, Value>) -> Map<String, Value> {
        let defaults = default_prefs();
        let mut prefs = self.prefs();
        for (k, v) in new {
            if defaults.get(k).is_some_and(|d| std::mem::discriminant(d) == std::mem::discriminant(v)) {
                prefs.insert(k.clone(), v.clone());
            }
        }
        let changed: Map<String, Value> = prefs.iter().filter(|(k, v)| defaults.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect();
        self.state.insert("active".into(), Value::Object(changed));
        self.save_state();
        prefs
    }

    fn blank_page(&self) {
        let bg = self.theme.color("background");
        *SHARED.blank.lock().unwrap() = format!("<!doctype html><html><head><meta charset='utf-8'><style>html{{background:{bg}}}</style></head><body></body></html>");
    }

    fn watch_theme(&mut self) {
        let tx = self.tx.clone();
        let Ok(mut watcher) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            let _ = tx.send(Event::ThemeChanged);
        }) else {
            return;
        };
        let dir = theme::theme_dir();
        for d in [dir.clone(), dir.join("theme")] {
            let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
        }
        self.watcher = Some(watcher);
    }

    fn apply_theme(&mut self) {
        self.theme = theme::load_theme();
        self.blank_page();
        // (the theme's folder may be another one now: a link put elsewhere)
        if let Some(w) = self.watcher.as_mut() {
            let _ = w.watch(&theme::theme_dir().join("theme"), RecursiveMode::NonRecursive);
        }
        let (r, g, b) = self.theme.background();
        let css = theme::theme_css(&self.theme);
        for w in self.wins.values() {
            if let Some(window) = &w.window {
                let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
            }
            w.js("MdView.setTheme", &[json!(css), json!(self.theme.mode)]);
        }
    }

    fn with_win(&mut self, label: &str, f: impl FnOnce(&mut Win, &mut App)) {
        let Some(mut w) = self.wins.remove(label) else { return };
        f(&mut w, self);
        if w.gone {
            SHARED.pages.lock().unwrap().remove(label);
            self.snapshot_waiting(true); // (a project no window shows any more is kept as it was left)
            self.rest();
        } else {
            self.wins.insert(label.to_string(), w);
        }
    }

    fn each_win(&mut self, mut f: impl FnMut(&mut Win, &mut App)) {
        let labels: Vec<String> = self.wins.keys().cloned().collect();
        for label in labels {
            self.with_win(&label, &mut f);
        }
    }

    /// No window left: the process stays for a while, so that the next one opens at once.
    fn rest(&mut self) {
        if self.wins.is_empty() {
            self.idle_turn += 1;
            // (the override: for tests)
            let resident = env("MDVIEW_RESIDENT_MS").and_then(|ms| ms.parse().ok()).unwrap_or(RESIDENT_MS);
            self.after(resident, Event::Idle { turn: self.idle_turn });
        }
    }

    fn on_event(&mut self, event: Event) {
        match event {
            Event::Open { args, cwd } => self.open(args, &cwd),
            Event::Msg { label, json } => {
                if let Ok(msg) = serde_json::from_str::<Value>(&json) {
                    self.with_win(&label, |w, app| w.on_message(app, &msg));
                }
            }
            Event::Loaded { label, url } => self.with_win(&label, |w, app| w.on_loaded(app, &url)),
            Event::Link { label, href } => self.with_win(&label, |w, app| w.handle_link(app, &href, false)),
            Event::Fs { label, paths } => {
                for p in &paths {
                    self.touch(p);
                }
                self.with_win(&label, |w, app| w.on_fs(app, &paths))
            }
            Event::Reload { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.reload_turn {
                    w.reload_after_change(app);
                }
            }),
            Event::Rescan { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.rescan_turn {
                    w.rescan(app);
                }
            }),
            Event::CloseNow { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.close_turn {
                    w.close(app);
                }
            }),
            Event::CloseRequested { label } => self.with_win(&label, |w, app| w.close(app)),
            Event::Closed { label } => {
                if self.wins.remove(&label).is_some() {
                    SHARED.pages.lock().unwrap().remove(&label);
                    self.snapshot_waiting(true);
                    self.rest();
                }
            }
            Event::Crashed { label } => self.with_win(&label, |w, app| w.load_shell(app, true)),
            Event::Picked { label, what, path } => self.with_win(&label, |w, app| w.picked(app, what, path)),
            Event::Completion { label, id, text, error } => {
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.completion", &[id, json!(text), json!(error)]);
                }
            }
            Event::Graphic { label, id, svg, error } => {
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.graphic", &[id, json!(svg), json!(error)]);
                }
            }
            Event::ThemeChanged => {
                self.theme_turn += 1;
                self.after(150, Event::ApplyTheme { turn: self.theme_turn });
            }
            Event::ApplyTheme { turn } => {
                if turn == self.theme_turn {
                    self.apply_theme();
                }
            }
            Event::Idle { turn } => {
                if turn == self.idle_turn && self.wins.is_empty() {
                    self.snapshot_waiting(false);
                    self.historian.wait();
                    self.handle.exit(0);
                }
            }
            Event::Snapshot { root, turn } => {
                if self.unsnapped.get(&root) == Some(&turn) {
                    self.unsnapped.remove(&root);
                    let (stamp, access) = (self.stamp(), self.access());
                    self.historian.snapshot(&root, stamp, access);
                }
            }
            Event::GitHub(news) => self.on_github(news),
            Event::Fetched { label, done } => match done {
                Ok(folder) => self.open_folder(&folder),
                Err(e) => {
                    if let Some(w) = self.wins.get(&label) {
                        w.toast(format!("Couldn't get the repository: {e}"));
                    }
                }
            },
            Event::GitHubRenew { turn } => {
                if turn == self.renew_turn {
                    github::resume(self.tx.clone(), self.keyring_place());
                }
            }
            Event::SyncTick => {
                self.sync_shown();
                self.after(self.sync_ms(), Event::SyncTick);
            }
            Event::Reconciled { root, mut standing, asked } => {
                standing["at"] = json!(now());
                let here = |w: &Win| w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root));
                if asked && standing["state"] == "error" {
                    // (what the user asked for did not go — linking, joining: said, and the state before stays)
                    let text = format!("GitHub: {}", standing["why"].as_str().unwrap_or(""));
                    self.each_win(|w, app| {
                        if w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root)) {
                            w.toast(text.clone());
                            w.js("MdView.conflictsFailed", &[]);
                            w.tree_json = None;
                            w.send_folder(app);
                            w.settings_info(app);
                        }
                    });
                    return;
                }
                let odds = standing["state"] == "conflict" && self.synced.get(&root).is_none_or(|was| was["state"] != "conflict");
                if odds {
                    let n = standing["files"].as_array().map_or(0, Vec::len);
                    let text = format!("{} changed here and on another device. Resolve from the clock in the sidebar", if n == 1 { "A file was".to_string() } else { format!("{n} files were") });
                    for w in self.wins.values().filter(|w| here(w)) {
                        w.toast(text.clone());
                    }
                }
                if *DEBUG {
                    eprintln!("[sync] {}: {standing}", root.display());
                }
                let changed = self.synced.get(&root).map(|was| (&was["state"], &was["files"])) != Some((&standing["state"], &standing["files"])) || !standing["did"].is_null();
                self.synced.insert(root.clone(), standing);
                if changed {
                    // (the clock and the settings say how the project stands)
                    self.each_win(|w, app| {
                        if w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root)) {
                            w.send_folder(app);
                            w.js("MdView.historyKept", &[]);
                        }
                    });
                }
                // (a share's window says whether its link shows yet what was set)
                for w in self.wins.values() {
                    if let Some(path) = w.share_asked.as_deref().filter(|p| p.starts_with(&root)) {
                        w.js("MdView.share", &[share::info(path)]);
                    }
                }
            }
            Event::Snapshotted { root, kept, skipped, error, asked } => {
                if asked {
                    let said = error.as_ref().map(|e| format!("Couldn't take in: {e}"));
                    self.each_win(|w, app| {
                        if w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root)) {
                            w.send_folder(app);
                            if let Some(text) = &said {
                                w.toast(text.clone());
                            }
                        }
                    });
                }
                if kept {
                    // (settings that show the folder's history are no longer right)
                    for w in self.wins.values().filter(|w| w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root))) {
                        w.js("MdView.historyKept", &[]);
                    }
                }
                if let (Some(e), true) = (&error, *DEBUG) {
                    eprintln!("[history] {}: {e}", root.display());
                }
                let new: Vec<String> = skipped.into_iter().filter(|f| self.said_big.insert(format!("{}/{f}", root.display()))).collect();
                if !new.is_empty() {
                    let text = format!("Too large for the history (over 50 MB): {}", new.join(", "));
                    for w in self.wins.values().filter(|w| w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root))) {
                        w.toast(text.clone());
                    }
                }
            }
        }
    }

    /// The process stays resident, the page (viewer.js) is read fresh for every window: after
    /// an update the two would not match. With no window open, start over from the new program.
    fn restart_if_stale(&self, args: &[String]) {
        if !self.wins.is_empty() {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        // (a program built anew is another file in the old one's place: Linux then names the
        // running one "… (deleted)" — the new one is at the name without that)
        let exe = exe.to_str().and_then(|e| e.strip_suffix(" (deleted)")).map(PathBuf::from).unwrap_or(exe);
        let stamp = fs::metadata(&exe).ok().and_then(|m| m.modified().ok());
        if stamp.is_none() || stamp == self.started {
            return;
        }
        self.historian.wait(); // (a snapshot under way is finished first)
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let _ = std::process::Command::new(exe).args(args).exec();
        }
        #[cfg(not(unix))]
        let _ = args;
    }

    fn present(&self, label: &str) {
        if let Some(window) = self.wins.get(label).and_then(|w| w.window.as_ref()) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    fn open_folder(&mut self, folder: &Path) {
        match self.wins.iter().find(|(_, w)| w.folder.as_deref() == Some(folder)).map(|(l, _)| l.clone()) {
            Some(label) => self.present(&label),
            None => self.new_window(None, Some(folder)),
        }
    }

    fn open_file(&mut self, path: &Path) {
        let p = resolve(path);
        if p.is_dir() {
            return self.open_folder(&p);
        }
        match self.wins.iter().find(|(_, w)| w.path.as_deref() == Some(p.as_path())).map(|(l, _)| l.clone()) {
            Some(label) => self.present(&label),
            None => self.new_window(Some(&p), None),
        }
    }

    fn open(&mut self, args: Vec<String>, cwd: &str) {
        let files: Vec<String> = args.into_iter().filter(|a| !a.starts_with('-')).collect();
        self.restart_if_stale(&files);
        if files.is_empty() {
            // Started bare: back to the folder that was open last, if there was one.
            let last = self.state.get("folder").and_then(Value::as_str).map(PathBuf::from).filter(|p| p.is_dir());
            return match last {
                Some(folder) => self.open_folder(&folder),
                None => self.new_window(None, None),
            };
        }
        for f in files {
            if f.contains("://") {
                match url_file(&f) {
                    Some((p, _)) => self.open_file(&p),
                    None => host::launch_uri(&f),
                }
            } else {
                self.open_file(&Path::new(cwd).join(&f));
            }
        }
    }

    fn new_window(&mut self, path: Option<&Path>, folder: Option<&Path>) {
        self.seq += 1;
        self.idle_turn += 1; // (no longer resting)
        let label = format!("w{}", self.seq);
        let mut w = Win::new(&label, self);
        match (folder, path) {
            (Some(folder), _) => w.set_folder(self, folder),
            (None, Some(path)) => w.open_path(self, path, None, false),
            _ => {}
        }
        let num = |key: &str| self.state.get(key).and_then(Value::as_f64);
        let (width, height) = if folder.is_some() {
            (num("folder_width").unwrap_or(num("width").unwrap_or(900.0) + SIDEBAR_WIDTH as f64), num("folder_height").or(num("height")).unwrap_or(1040.0))
        } else {
            (num("width").unwrap_or(900.0), num("height").unwrap_or(1040.0))
        };
        let (r, g, b) = self.theme.background();
        let url: tauri::Url = format!("{ORIGIN}/shell/{label}/{}", w.shell_n).parse().unwrap();
        let (nav, loaded, own) = (self.tx.clone(), self.tx.clone(), label.clone());
        let own2 = label.clone();
        // (A probe's page keeps nothing: what an earlier run left — the place a note was scrolled
        // to, an embed's size — would decide how the next one starts, and would land in the real store.)
        let built = WebviewWindowBuilder::new(&self.handle, &label, WebviewUrl::CustomProtocol(url))
            .title(if w.title.is_empty() { "Markdown Notes" } else { &w.title })
            .inner_size(width, height)
            .background_color(tauri::window::Color(r, g, b, 255))
            .incognito(PROBE.is_some())
            .disable_drag_drop_handler() // (a picture dropped on a note is the page's to take)
            .on_navigation(move |url| {
                // The window's own page may load; anything else is a link, and the shell's to follow.
                let own_page = url.as_str().starts_with(ORIGIN) && url.path().starts_with("/shell/");
                if own_page || url.scheme() == "about" {
                    return true;
                }
                let _ = nav.send(Event::Link { label: own.clone(), href: url.to_string() });
                false
            })
            .on_page_load(move |_window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let _ = loaded.send(Event::Loaded { label: own2.clone(), url: payload.url().to_string() });
                }
            })
            .build();
        let Ok(window) = built else { return self.rest() };
        let (crash, own) = (self.tx.clone(), label.clone());
        host::setup(&window, *DEBUG, move || {
            let _ = crash.send(Event::Crashed { label: own.clone() });
        });
        w.window = Some(window);
        let bare = w.path.is_none() && w.folder.is_none();
        if bare {
            w.choose_file(self);
        }
        self.wins.insert(label, w);
    }
}

impl Win {
    fn new(label: &str, app: &App) -> Win {
        let (tx, own) = (app.tx.clone(), label.to_string());
        let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            use notify::event::{EventKind, ModifyKind};
            if matches!(ev.kind, EventKind::Access(_) | EventKind::Modify(ModifyKind::Metadata(_))) {
                return;
            }
            let _ = tx.send(Event::Fs { label: own.clone(), paths: ev.paths });
        })
        .ok();
        Win {
            label: label.to_string(),
            window: None,
            title: String::new(),
            path: None,
            folder: None,
            tree: None,
            tree_json: None,
            note_paths: HashSet::new(),
            kept_dirs: HashSet::new(),
            share_asked: None,
            title_cache: TitleCache::new(),
            watcher,
            watched: HashSet::new(),
            dir_watch: HashSet::new(),
            rescan_turn: 0,
            reload_turn: 0,
            close_turn: 0,
            shell_ready: false,
            loading_shell: false,
            shell_n: 0,
            pending_fragment: None,
            back: vec![],
            fwd: vec![],
            tabs: vec![],
            tab: 0,
            tab_seq: 0,
            tabs_json: None,
            closed_tabs: vec![],
            resolver: None,
            editing: false,
            own_text: None,
            own_write: None,
            closing: false,
            getting: None,
            mode_given: false,
            save_seq: json!(0),
            zoom: 1.0,
            gone: false,
        }
    }

    fn js(&self, func: &str, args: &[Value]) {
        if let Some(window) = &self.window {
            let args: Vec<String> = args.iter().map(Value::to_string).collect();
            let _ = window.eval(format!("{func}({})", args.join(",")));
        }
    }

    fn toast(&self, text: impl Into<String>) {
        self.js("MdView.toast", &[json!(text.into())]);
    }

    fn set_title(&mut self, title: String) {
        if let Some(window) = &self.window {
            let _ = window.set_title(&title);
        }
        self.title = title;
    }

    fn new_resolver(&mut self) {
        self.resolver = self.path.as_ref().map(|p| Resolver::new(&dir_of(p), &home()));
    }

    fn vault(&self) -> Option<PathBuf> {
        self.resolver.as_ref().and_then(|r| r.vault.clone())
    }

    // -- loading --------------------------------------------------------

    fn load_shell(&mut self, app: &mut App, force: bool) {
        if self.shell_ready && !force {
            return self.render(app, false, None, false);
        }
        // One shell per window. Relative links and images resolve against
        // <base>, which the page points at the directory of the note shown.
        let target_dir = self.path.as_deref().map(dir_of).or_else(|| self.folder.clone()).unwrap_or_else(home);
        self.tree_json = None;
        self.tabs_json = None;
        self.shell_ready = false;
        self.loading_shell = true;
        self.editing = false;
        let nonce = nonce();
        let a = format!("{ORIGIN}/app");
        let csp = format!(
            "default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline' {o} https:; \
             img-src {o} data: blob: https: http:; font-src {o} data:; media-src {o} https: http:; \
             connect-src ipc: http://ipc.localhost",
            o = if cfg!(windows) { ORIGIN } else { "md:" }
        );
        let prefs = Value::Object(app.prefs()).to_string().replace("</", "<\\/");
        // what the page reaches the shell through, and where it asks for files
        let host = format!(
            "window.MdHost = {{ post: (m) => {{ window.__TAURI_INTERNALS__.invoke(\"msg\", {{ json: m }}).catch(() => {{}}); }}, files: {} }};",
            json!(format!("{ORIGIN}/file"))
        );
        let own = user_snippets();
        let mut scripts = format!("<script nonce=\"{nonce}\">{host}window.MdPrefs = {prefs};</script>");
        if !own.is_empty() {
            scripts += &format!("<script nonce=\"{nonce}\">{own}</script>");
        }
        for src in SCRIPTS {
            scripts += &format!("<script nonce=\"{nonce}\" src=\"{a}/{src}\"></script>");
        }
        let base = file_url(&target_dir).replace('&', "&amp;").replace('\'', "&#x27;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;");
        let page = format!(
            "<!doctype html><html lang='en'><head><meta charset='utf-8'>\
             <meta http-equiv='Content-Security-Policy' content=\"{csp}\">\
             <base href='{base}/'>\
             <link rel='stylesheet' href='{a}/motion.css'>\
             <style id='theme'>{theme}</style>\
             <link rel='stylesheet' href='{a}/vendor/katex/katex.min.css'>\
             <link rel='stylesheet' href='{a}/viewer.css'>\
             <link rel='stylesheet' href='{a}/overview.css'>\
             </head><body data-mode='{mode}'{sf}><main id='content'></main>{scripts}</body></html>",
            theme = theme::theme_css(&app.theme),
            mode = app.theme.mode,
            sf = if app.sf_symbols { " data-sf" } else { "" },
        );
        self.shell_n += 1;
        SHARED.pages.lock().unwrap().insert(self.label.clone(), page);
        if let Some(window) = &self.window {
            if let Ok(url) = format!("{ORIGIN}/shell/{}/{}", self.label, self.shell_n).parse() {
                let _ = window.navigate(url);
            }
        }
    }

    fn on_loaded(&mut self, app: &mut App, url: &str) {
        // (only the page asked for last: an empty window's blank one says nothing)
        if !self.loading_shell || !url.ends_with(&format!("/shell/{}/{}", self.label, self.shell_n)) {
            return;
        }
        self.loading_shell = false;
        self.shell_ready = true;
        self.send_folder(app);
        self.send_tabs(app);
        let fragment = self.pending_fragment.take();
        self.render(app, false, fragment, false);
        if let (Some(probe), Some(window)) = (PROBE.as_ref(), &self.window) {
            if let Ok(script) = fs::read_to_string(probe) {
                let _ = window.eval(script);
            }
        }
    }

    fn open_path(&mut self, app: &mut App, path: &Path, fragment: Option<String>, push: bool) {
        let path = resolve(path);
        app.touch(&path); // (what changed in its project while the app was not looking is kept, too)
        let same = self.path.as_deref() == Some(path.as_path());
        if push && !same {
            if let Some(old) = self.path.clone() {
                self.back.push(old);
                self.fwd.clear();
            }
        }
        self.path = Some(path.clone());
        self.set_title(name_of(&path));
        self.new_resolver();
        if !same {
            self.own_text = None;
            self.watch();
            if let Some(folder) = self.folder.clone().filter(|f| path.starts_with(f)) {
                bump(app.sub("last_notes"), &s(&folder), json!(s(&path)), 20);
                // when it was opened: what the sidebar sorts by ("opened")
                bump(app.sub("opened"), &s(&path), json!(now()), OPENED_LIMIT);
                app.save_state();
                self.send_folder(app);
            }
        }
        self.send_tabs(app);
        if same && self.shell_ready {
            match fragment {
                Some(f) if is_pdf(&path) => self.render_pdf(app, Some(f)), // (a place in the PDF: the viewer goes there)
                Some(f) => self.js("MdView.scrollToFragment", &[json!(f), json!(true)]),
                None => {}
            }
            return;
        }
        if self.shell_ready {
            self.render(app, false, fragment, false);
            self.pending_fragment = None;
        } else {
            self.pending_fragment = fragment;
            self.load_shell(app, false);
        }
    }

    /// The directories looked at: the note's own (editors save by delete + rename, so the file
    /// itself cannot be held on to) and those of the folder's tree.
    fn watch(&mut self) {
        let Some(watcher) = self.watcher.as_mut() else { return };
        let mut want = self.dir_watch.clone();
        want.extend(self.path.as_deref().map(dir_of));
        for gone in self.watched.difference(&want) {
            let _ = watcher.unwatch(gone);
        }
        for new in want.difference(&self.watched) {
            let _ = watcher.watch(new, RecursiveMode::NonRecursive);
        }
        self.watched = want;
    }

    fn on_fs(&mut self, app: &mut App, paths: &[PathBuf]) {
        if self.path.as_ref().is_some_and(|p| paths.contains(p)) {
            // Editors save by delete + rename; wait for the dust to settle.
            self.reload_turn += 1;
            app.after(90, Event::Reload { label: self.label.clone(), turn: self.reload_turn });
        }
        if self.folder.is_some() && paths.iter().any(|p| self.dir_watch.contains(p) || p.parent().is_some_and(|d| self.dir_watch.contains(d))) {
            self.rescan_turn += 1;
            app.after(300, Event::Rescan { label: self.label.clone(), turn: self.rescan_turn });
        }
    }

    fn reload_after_change(&mut self, app: &mut App) {
        let Some(path) = self.path.clone().filter(|p| p.exists()) else { return };
        if let Some(own) = self.own_write.take() {
            if read_bytes(&path, None).is_ok_and(|now| now == own) {
                return; // already on screen
            }
        }
        if self.editing {
            if let Some(own) = &self.own_text {
                if read_text(&path, None).is_ok_and(|now| now.replace("\r\n", "\n") == *own) {
                    return; // our own save; the editor already has it
                }
            }
        }
        self.new_resolver();
        self.render(app, true, None, false);
    }

    // -- folder (sidebar) ---------------------------------------------------

    fn set_folder(&mut self, app: &mut App, folder: &Path) {
        let folder = resolve(folder);
        app.touch(&folder);
        self.folder = Some(folder.clone());
        self.tree_json = None;
        self.title_cache.clear();
        app.state.insert("folder".into(), json!(s(&folder)));
        app.save_state();
        self.rescan(app);
        let notes: Vec<(String, bool)> = self.tree.as_ref().map(|t| t.notes().iter().map(|n| (n.real.clone(), n.pdf)).collect()).unwrap_or_default();
        let known = |p: &str| notes.iter().any(|(real, _)| real == p);
        let last = app.state.get("last_notes").and_then(|l| l.get(s(&folder))).and_then(Value::as_str).map(String::from);
        let first = last.filter(|l| known(l)).or_else(|| notes.iter().find(|(_, pdf)| !pdf).map(|(real, _)| real.clone())); // (a note, not a PDF)
        // the tabs this folder was left with (an empty one only where it was the one shown)
        self.tabs.clear();
        self.tab = 0;
        self.closed_tabs.clear();
        let saved = app.state.get("tabs").and_then(|t| t.get(s(&folder))).cloned().unwrap_or(Value::Null);
        if let Some(paths) = saved.get("paths").and_then(Value::as_array) {
            for (i, p) in paths.iter().enumerate() {
                let shown = saved.get("active").and_then(Value::as_u64) == Some(i as u64);
                let Some(p) = p.as_str() else { continue };
                let opens = !p.is_empty() && Path::new(p).is_file() && matches!(file_kind(Path::new(p)), "md" | "pdf");
                if opens || (p.is_empty() && shown) {
                    if shown {
                        self.tab = self.tabs.len();
                    }
                    let tab = self.make_tab((!p.is_empty()).then(|| Path::new(p)));
                    self.tabs.push(tab);
                }
            }
        }
        if let Some(path) = self.path.clone().filter(|p| known(&s(p))) {
            // (a window that shows a note of this folder already)
            self.tab = match self.tabs.iter().position(|t| t.path.as_ref() == Some(&path)) {
                Some(i) => i,
                None => {
                    let tab = self.make_tab(Some(&path));
                    self.tabs.push(tab);
                    self.tabs.len() - 1
                }
            };
            return self.send_tabs(app);
        }
        if self.tabs.is_empty() {
            let tab = self.make_tab(first.as_deref().map(Path::new));
            self.tabs.push(tab);
        }
        self.back.clear();
        self.fwd.clear();
        self.show_tab(app, self.tab, None);
    }

    /// Nothing to show: an empty folder, or its last note is gone.
    fn show_nothing(&mut self, app: &mut App) {
        self.path = None;
        self.watch();
        self.back.clear();
        self.fwd.clear();
        let folder = self.folder.clone().unwrap_or_default();
        self.set_title(if name_of(&folder).is_empty() { s(&folder) } else { name_of(&folder) });
        if self.shell_ready {
            self.js("MdView.clear", &[]);
        } else {
            self.load_shell(app, false);
        }
        self.send_tabs(app);
    }

    // -- tabs (folder windows) ----------------------------------------------

    fn make_tab(&mut self, path: Option<&Path>) -> Tab {
        self.tab_seq += 1;
        Tab { id: self.tab_seq, path: path.map(resolve), back: vec![], fwd: vec![] }
    }

    fn tab_index(&self, id: u64) -> Option<usize> {
        self.tabs.iter().position(|t| t.id == id)
    }

    /// What the window shows, written into its tab.
    fn stash_tab(&mut self) {
        if let Some(t) = self.tabs.get_mut(self.tab) {
            t.path = self.path.clone();
            t.back = self.back.clone();
            t.fwd = self.fwd.clone();
        }
    }

    /// The tabs as they stand: kept for the folder's next opening, and told to the page.
    fn send_tabs(&mut self, app: &mut App) {
        let Some(folder) = self.folder.clone() else { return };
        if self.tabs.is_empty() {
            let tab = self.make_tab(self.path.clone().as_deref());
            self.tabs = vec![tab];
            self.tab = 0;
        }
        self.stash_tab();
        let kept = json!({ "paths": self.tabs.iter().map(|t| t.path.as_deref().map(s).unwrap_or_default()).collect::<Vec<_>>(), "active": self.tab });
        let every = app.sub("tabs");
        if every.get(&s(&folder)) != Some(&kept) {
            bump(every, &s(&folder), kept, 20);
            app.save_state();
        }
        if !self.shell_ready {
            return;
        }
        let payload = json!({
            "tabs": self.tabs.iter().map(|t| json!({ "id": t.id, "path": t.path.as_deref().map(s), "name": t.path.as_deref().map(name_of).unwrap_or_default() })).collect::<Vec<_>>(),
            "active": self.tabs[self.tab].id,
            "closed": !self.closed_tabs.is_empty(),
        });
        let blob = payload.to_string();
        if self.tabs_json.as_ref() != Some(&blob) {
            self.tabs_json = Some(blob);
            self.js("MdView.setTabs", &[payload]);
        }
    }

    /// Tab i takes the window (the one shown before is written down already).
    fn show_tab(&mut self, app: &mut App, i: usize, fragment: Option<String>) {
        self.tab = i;
        let t = &self.tabs[i];
        self.back = t.back.clone();
        self.fwd = t.fwd.clone();
        match t.path.clone().filter(|p| p.is_file()) {
            Some(path) => self.open_path(app, &path, fragment, false),
            None => self.show_nothing(app), // an empty tab, or its file is gone
        }
    }

    fn select_tab(&mut self, app: &mut App, id: u64) {
        if let Some(i) = self.tab_index(id).filter(|&i| i != self.tab) {
            self.stash_tab();
            self.show_tab(app, i, None);
        }
    }

    /// A tab beside the one shown, and shown at once: empty (the folder's notes to choose from), or on a file.
    fn new_tab(&mut self, app: &mut App, path: Option<&Path>, fragment: Option<String>, at: Option<usize>) {
        if self.folder.is_none() {
            return;
        }
        self.stash_tab();
        let i = self.tabs.len().min(at.unwrap_or(self.tab + 1));
        let tab = self.make_tab(path);
        self.tabs.insert(i, tab);
        self.show_tab(app, i, fragment);
    }

    fn close_tab(&mut self, app: &mut App, id: u64) {
        let Some(i) = self.tab_index(id) else { return };
        if self.tabs.len() == 1 {
            return self.close(app); // the last one: the window goes with it
        }
        self.stash_tab();
        let gone = self.tabs.remove(i);
        if let Some(path) = gone.path {
            self.closed_tabs.push((path, i));
            let over = self.closed_tabs.len().saturating_sub(20);
            self.closed_tabs.drain(..over);
        }
        if i == self.tab {
            self.show_tab(app, i.min(self.tabs.len() - 1), None);
        } else {
            if i < self.tab {
                self.tab -= 1;
            }
            self.send_tabs(app);
        }
    }

    fn close_other_tabs(&mut self, app: &mut App, id: u64) {
        let Some(i) = self.tab_index(id).filter(|_| self.tabs.len() > 1) else { return };
        self.stash_tab();
        let was_shown = i == self.tab;
        for (k, t) in self.tabs.iter().enumerate() {
            if k != i {
                if let Some(path) = &t.path {
                    self.closed_tabs.push((path.clone(), k));
                }
            }
        }
        let over = self.closed_tabs.len().saturating_sub(20);
        self.closed_tabs.drain(..over);
        let keep = self.tabs.remove(i);
        self.tabs = vec![keep];
        if was_shown {
            self.tab = 0;
            self.send_tabs(app);
        } else {
            self.show_tab(app, 0, None);
        }
    }

    fn reopen_tab(&mut self, app: &mut App) {
        while let Some((path, at)) = self.closed_tabs.pop() {
            if path.is_file() {
                return self.new_tab(app, Some(&path), None, Some(at));
            }
        }
        self.send_tabs(app);
    }

    fn move_tab(&mut self, app: &mut App, id: u64, to: i64) {
        let Some(i) = self.tab_index(id) else { return };
        self.stash_tab();
        let shown = self.tabs[self.tab].id;
        let t = self.tabs.remove(i);
        let to = to.clamp(0, self.tabs.len() as i64) as usize;
        self.tabs.insert(to, t);
        self.tab = self.tab_index(shown).unwrap_or(0);
        self.send_tabs(app);
    }

    fn tab_op(&mut self, app: &mut App, msg: &Value) {
        if self.folder.is_none() || self.tabs.is_empty() {
            return;
        }
        let id = match &msg["id"] {
            Value::Number(n) => n.as_u64(),
            Value::String(t) => t.parse().ok(),
            _ => None,
        }
        .unwrap_or(self.tabs[self.tab].id);
        match msg["op"].as_str() {
            Some("select") => self.select_tab(app, id),
            Some("new") => self.new_tab(app, None, None, None),
            Some("close") => self.close_tab(app, id),
            Some("others") => self.close_other_tabs(app, id),
            Some("reopen") => self.reopen_tab(app),
            Some("move") => {
                let to = match &msg["to"] {
                    Value::Number(n) => n.as_f64().map(|f| f as i64),
                    Value::String(t) => t.trim().parse().ok(),
                    _ => None,
                };
                if let Some(to) = to {
                    self.move_tab(app, id, to);
                }
            }
            _ => {}
        }
    }

    fn rescan(&mut self, app: &mut App) {
        self.rescan_turn += 1; // (a scan that was still to come is this one)
        let Some(folder) = self.folder.clone() else { return };
        let titles = app.state.get("sidebar_titles").is_some_and(truthy);
        let prefs = app.prefs();
        let show: HashSet<&'static str> = [("pdf", "sidebarPdf"), ("image", "sidebarImages"), ("media", "sidebarMedia"), ("other", "sidebarOther")]
            .into_iter()
            .filter(|(_, key)| truthy(&prefs[*key]))
            .map(|(group, _)| group)
            .collect();
        let (tree, walked) = scan::scan_folder(&folder, &mut self.title_cache, titles, &self.kept_dirs, &show);
        self.note_paths = tree.notes().iter().map(|n| n.path.clone()).collect();
        self.tree = Some(tree);
        self.dir_watch = walked.into_iter().take(WATCH_LIMIT).collect();
        self.watch();
        self.send_folder(app);
    }

    fn send_folder(&mut self, app: &mut App) {
        let Some(folder) = self.folder.clone().filter(|_| self.shell_ready) else { return };
        let Some(tree) = self.tree.as_mut() else { return };
        let opened = app.state.get("opened").and_then(Value::as_object);
        tree.each_note(&mut |n| n.opened = opened.and_then(|o| o.get(&n.real)).and_then(Value::as_i64).unwrap_or(0));
        // where the folder stands with a history: "none", a "project" itself, "inside" one above,
        // or in a "foreign" repository (own: the folder is that repository's, and can be taken over)
        let history = app.standing(&folder);
        let st = &app.state;
        let payload = json!({
            "history": history,
            "shared": share::listed(&folder),
            "root": s(&folder),
            "name": if name_of(&folder).is_empty() { s(&folder) } else { name_of(&folder) },
            "tree": tree,
            "titles": st.get("sidebar_titles").is_some_and(truthy),
            "visible": st.get("sidebar").map_or(true, truthy),
            "width": st.get("sidebar_width").cloned().unwrap_or(json!(0)),
        });
        let blob = payload.to_string();
        if self.tree_json.as_ref() != Some(&blob) {
            self.tree_json = Some(blob);
            self.js("MdView.setFolder", &[payload]);
        }
    }

    /// The beginning of notes of this folder, for their tiles in the overview.
    fn send_previews(&self, paths: &Value) {
        let mut out = Map::new();
        for p in paths.as_array().map(Vec::as_slice).unwrap_or_default().iter().take(PREVIEW_BATCH) {
            let Some(p) = p.as_str().filter(|p| self.note_paths.contains(*p) && file_kind(Path::new(p)) == "md") else { continue };
            let path = Path::new(p);
            let preview = match (read_text(path, Some(PREVIEW_BYTES)), mtime(path)) {
                (Ok(text), Ok(mtime)) => json!({ "text": text, "mtime": mtime }),
                _ => json!({ "text": "", "mtime": 0 }),
            };
            out.insert(p.to_string(), preview);
        }
        self.js("MdView.setPreviews", &[Value::Object(out)]);
    }

    fn open_note(&mut self, app: &mut App, path: &str, tab: bool) {
        if self.folder.is_none() || !self.note_paths.contains(path) {
            return;
        }
        let path = Path::new(path);
        if !matches!(file_kind(path), "md" | "pdf") {
            return host::launch_path(path); // a picture, a film, any other file: in its own application
        }
        // in a tab of its own where that was asked for; a note that has a tab already: that tab
        let real = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let there = self.tabs.iter().enumerate().position(|(k, t)| k != self.tab && t.path.as_ref() == Some(&real));
        if tab {
            self.new_tab(app, Some(&real), None, None);
        } else if let Some(there) = there {
            self.stash_tab();
            self.show_tab(app, there, None);
        } else {
            self.open_path(app, path, None, true);
        }
    }

    /// Where a new note or folder goes: the folder asked for if it is one of this window's, else the root.
    fn target_dir(&self, folder: &Path, wanted: Option<&str>) -> PathBuf {
        let target = wanted.filter(|w| !w.is_empty()).map(|w| resolve(Path::new(w))).unwrap_or_else(|| folder.to_path_buf());
        if target.is_dir() && target.starts_with(folder) { target } else { folder.to_path_buf() }
    }

    fn new_note(&mut self, app: &mut App, name: &str, wanted: Option<&str>) {
        let Some(folder) = self.folder.clone() else { return };
        let target = self.target_dir(&folder, wanted);
        let name = Some(clean_name(name)).filter(|n| !n.is_empty()).unwrap_or_else(|| "Untitled".into());
        let stem = if name.to_lowercase().ends_with(".md") { name[..name.len() - 3].trim_end().to_string() } else { name };
        let path = target.join(format!("{}.md", if stem.is_empty() { "Untitled" } else { &stem }));
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                if let Err(e) = f.write_all(format!("# {stem}\n\n").as_bytes()) {
                    return self.toast(format!("Couldn't create note: {}", strerror(&e)));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                self.toast(format!("“{}” already exists", name_of(&path)));
                if path.is_file() {
                    self.rescan(app);
                    self.open_path(app, &path, None, true);
                }
                return;
            }
            Err(e) => return self.toast(format!("Couldn't create note: {}", strerror(&e))),
        }
        self.rescan(app);
        self.open_path(app, &path, None, true);
        self.js("MdView.setMode", &[json!("edit"), json!("end")]);
    }

    fn new_folder(&mut self, app: &mut App, name: &str, wanted: Option<&str>) {
        let Some(folder) = self.folder.clone() else { return };
        let target = self.target_dir(&folder, wanted);
        let path = target.join(Some(clean_name(name)).filter(|n| !n.is_empty()).unwrap_or_else(|| "New Folder".into()));
        match fs::create_dir(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => self.toast(format!("“{}” already exists", name_of(&path))),
            Err(e) => return self.toast(format!("Couldn't create folder: {}", strerror(&e))),
        }
        self.kept_dirs.insert(s(&path));
        self.rescan(app);
    }

    fn rename_note(&mut self, app: &mut App, path: &str, name: &str) {
        let Some(folder) = self.folder.clone().filter(|_| self.note_paths.contains(path)) else { return };
        let old = PathBuf::from(path);
        let suffix = old.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let mut stem = clean_name(name);
        if !suffix.is_empty() && stem.to_lowercase().ends_with(&suffix.to_lowercase()) {
            stem = stem[..stem.len() - suffix.len()].trim_end().to_string();
        }
        let new = old.with_file_name(format!("{stem}{suffix}"));
        if stem.is_empty() || new == old {
            return;
        }
        let old_real = fs::canonicalize(&old).unwrap_or_else(|_| old.clone());
        // (a name that differs only in case is the same file where the file system says so)
        let taken = fs::symlink_metadata(&new).is_ok() && fs::canonicalize(&new).ok().as_ref() != Some(&old_real);
        if taken {
            return self.toast(format!("“{}” already exists", name_of(&new)));
        }
        if let Err(e) = fs::rename(&old, &new) {
            return self.toast(format!("Couldn't rename: {}", strerror(&e)));
        }
        let new_real = fs::canonicalize(&new).unwrap_or_else(|_| new.clone());
        let _ = share::moved(&old_real, Some(&new_real)); // (a link to the note goes on showing it)
        let swap = |p: &mut PathBuf| {
            if *p == old_real {
                *p = new_real.clone();
            }
        };
        self.back.iter_mut().for_each(swap);
        self.fwd.iter_mut().for_each(swap);
        for t in &mut self.tabs {
            // (the one shown is written down from the window again)
            t.path.iter_mut().for_each(swap);
            t.back.iter_mut().for_each(swap);
            t.fwd.iter_mut().for_each(swap);
        }
        if self.path.as_ref() == Some(&old_real) && new_real != old_real {
            // the note on screen: it stays as it is (also mid-edit), under its new name
            self.path = Some(new_real.clone());
            self.set_title(name_of(&new_real));
            self.watch();
            app.sub("last_notes").insert(s(&folder), json!(s(&new_real)));
            app.save_state();
        }
        self.js("MdView.noteRenamed", &[json!({ "old": s(&old), "path": s(&new), "oldReal": s(&old_real), "real": s(&new_real), "name": name_of(&new_real) })]);
        self.rescan(app);
        self.send_tabs(app);
    }

    fn trash_note(&mut self, app: &mut App, path: &str) {
        if self.folder.is_none() || !self.note_paths.contains(path) {
            return;
        }
        let real = fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
        let was_current = self.path.as_ref() == Some(&real);
        let mut next = None;
        if was_current {
            if let Some(tree) = &self.tree {
                let notes = tree.notes();
                if let Some(i) = notes.iter().position(|n| n.path == path) {
                    next = notes.get(i + 1).or_else(|| i.checked_sub(1).and_then(|k| notes.get(k))).map(|n| PathBuf::from(&n.real));
                }
            }
        }
        if let Err(e) = trash::delete(path) {
            return self.toast(format!("Couldn't move to Trash: {e}"));
        }
        let _ = share::moved(&real, None); // (a link to it shows nothing any more)
        self.back.retain(|p| *p != real);
        self.fwd.retain(|p| *p != real);
        if !self.tabs.is_empty() {
            // other tabs: none stays on the file, none goes back to it
            self.stash_tab();
            let shown = self.tabs[self.tab].id;
            for t in &mut self.tabs {
                t.back.retain(|p| *p != real);
                t.fwd.retain(|p| *p != real);
            }
            self.tabs.retain(|t| t.id == shown || t.path.as_ref() != Some(&real));
            self.tab = self.tab_index(shown).unwrap_or(0);
            self.closed_tabs.retain(|(p, _)| *p != real);
        }
        self.toast(format!("Moved “{}” to Trash", name_of(Path::new(path))));
        self.rescan(app);
        if !was_current {
            return self.send_tabs(app);
        }
        match next {
            Some(next) => self.open_path(app, &next, None, false),
            None => self.show_nothing(app),
        }
    }

    fn sidebar_pref(&mut self, app: &mut App, msg: &Value) {
        if let Some(width) = msg.get("width") {
            // pulled to another width: kept, nothing to scan again for
            if let Some(w) = width.as_f64().or_else(|| width.as_str().and_then(|t| t.trim().parse().ok())) {
                app.state.insert("sidebar_width".into(), json!((w as i64).clamp(180, 640)));
            }
            if let Some(visible) = msg.get("visible") {
                app.state.insert("sidebar".into(), json!(truthy(visible)));
            }
            return app.save_state();
        }
        if let Some(visible) = msg.get("visible") {
            app.state.insert("sidebar".into(), json!(truthy(visible)));
        }
        if let Some(titles) = msg.get("titles") {
            app.state.insert("sidebar_titles".into(), json!(truthy(titles)));
        }
        app.save_state();
        self.rescan(app);
        app.each_win(|w, app| w.rescan(app));
    }

    fn pick(&self, app: &App, what: Pick) {
        let Some(window) = &self.window else { return };
        let mut dialog = app.handle.dialog().file().set_parent(window);
        let here = self.folder.clone().or_else(|| self.path.as_deref().map(dir_of));
        dialog = match what {
            Pick::Folder => dialog.set_title("Open Folder"),
            Pick::Parent => dialog.set_title("Folder to Put the Repository In"),
            Pick::File => dialog.set_title("Open Markdown").add_filter("Markdown", scan::MD_EXT),
            Pick::Reference => dialog.set_title("Reference picture").add_filter("Pictures", scan::IMAGE_EXT),
        };
        if let Some(dir) = here.filter(|_| !matches!(what, Pick::Reference)) {
            dialog = dialog.set_directory(dir);
        }
        let (tx, label) = (app.tx.clone(), self.label.clone());
        let done = move |path: Option<tauri_plugin_dialog::FilePath>| {
            let path = path.and_then(|p| p.into_path().ok());
            let _ = tx.send(Event::Picked { label, what, path });
        };
        match what {
            Pick::Folder | Pick::Parent => dialog.pick_folder(done),
            _ => dialog.pick_file(done),
        }
    }

    fn choose_file(&self, app: &App) {
        self.pick(app, Pick::File);
    }

    fn picked(&mut self, app: &mut App, what: Pick, path: Option<PathBuf>) {
        match (what, path) {
            (Pick::Folder, Some(folder)) => self.set_folder(app, &folder),
            (Pick::Parent, Some(parent)) => {
                if let Some((url, name, branch)) = self.getting.take() {
                    let access = app.access();
                    app.historian.fetch(&self.label, url, parent.join(name), branch, access);
                    self.toast("Getting the repository…");
                }
            }
            (Pick::File, Some(file)) => self.open_path(app, &file, None, true),
            (Pick::File, None) if self.path.is_none() && self.folder.is_none() => self.close(app),
            (Pick::Reference, Some(p)) => self.js("MdView.graphicImage", &[json!(s(&p)), json!(format!("{}?{}", file_url(&p), now())), Value::Null]),
            _ => {}
        }
    }

    fn build_links(&mut self, text: &str) -> Value {
        let mut links = Map::new();
        let mut texts = vec![text.to_string()];
        let Some(resolver) = self.resolver.as_mut() else { return json!({}) };
        while let Some(chunk) = texts.pop() {
            for m in WIKI_RE.captures_iter(&chunk) {
                let target = m[1].split('|').next().unwrap_or("").trim().to_string();
                if links.contains_key(&target) || target.starts_with('#') {
                    continue;
                }
                let Some(p) = resolver.resolve(&target) else {
                    links.insert(target, Value::Null);
                    continue;
                };
                let kind = file_kind(&p);
                let mut info = json!({ "path": s(&p), "url": file_url(&p), "kind": kind });
                if kind == "md" && m[0].starts_with('!') && links.len() < 400 {
                    if let Ok(embedded) = read_text(&p, Some(EMBED_LIMIT)) {
                        info["text"] = json!(embedded);
                        texts.push(embedded);
                    }
                }
                links.insert(target, info);
            }
        }
        Value::Object(links)
    }

    /// A PDF in the window: the page gets its name and the links to it; the bytes on request.
    fn render_pdf(&mut self, _app: &mut App, fragment: Option<String>) {
        let Some(path) = self.path.clone() else { return };
        let (mtime, error) = match mtime(&path) {
            Ok(t) => (t, None),
            Err(e) => (0.0, Some(format!("Can't read file: {}", strerror(&e)))),
        };
        let root = self.vault().or_else(|| self.folder.clone()).unwrap_or_else(|| dir_of(&path));
        self.mode_given = true;
        let backlinks = if error.is_some() { vec![] } else { scan::pdf_backlinks(&path, &root) };
        self.js(
            "MdView.render",
            &[json!({
                "kind": "pdf", "text": "", "name": name_of(&path), "path": s(&path),
                "base": file_url(&dir_of(&path)) + "/", "readonly": "a PDF", "vault": false, "links": {},
                "fragment": fragment, "error": error, "canBack": !self.back.is_empty(), "mtime": mtime,
                "backlinks": backlinks,
            })],
        );
    }

    /// The bytes of a PDF for the page (it may not read files itself), in pieces.
    fn send_pdf(&self, path: &str, id: &str) {
        let read = || -> Result<Vec<u8>, String> {
            let p = resolve(Path::new(path));
            if !is_pdf(&p) || !p.is_file() {
                return Err("not a PDF file".into());
            }
            if fs::metadata(&p).map_err(|e| strerror(&e))?.len() > 300_000_000 {
                return Err("larger than 300 MB".into());
            }
            fs::read(&p).map_err(|e| strerror(&e))
        };
        let data = match read() {
            Ok(data) => data,
            Err(e) => return self.js("MdView.pdfChunk", &[json!(id), json!(0), json!(1), json!(""), json!(e)]),
        };
        let parts: Vec<&[u8]> = if data.is_empty() { vec![&[]] } else { data.chunks(3_000_000).collect() };
        for (i, part) in parts.iter().enumerate() {
            let b64 = base64::engine::general_purpose::STANDARD.encode(part);
            self.js("MdView.pdfChunk", &[json!(id), json!(i), json!(parts.len()), json!(b64), Value::Null]);
        }
    }

    fn render(&mut self, app: &mut App, keep_scroll: bool, fragment: Option<String>, end: bool) {
        let Some(path) = self.path.clone().filter(|_| self.shell_ready) else { return };
        if is_pdf(&path) {
            return self.render_pdf(app, fragment);
        }
        let (text, error, readonly) = match fs::read(&path) {
            Ok(raw) => (String::from_utf8_lossy(&raw).into_owned(), None, readonly_reason(&path, Some(&raw))),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (String::new(), Some(format!("File not found: {}", s(&path))), readonly_reason(&path, None)),
            Err(e) => (String::new(), Some(format!("Can't read file: {}", strerror(&e))), Some("file can't be read")),
        };
        let links = if text.contains("[[") { self.build_links(&text) } else { json!({}) };
        let mut payload = json!({
            "text": text,
            "name": name_of(&path),
            "path": s(&path),
            "base": file_url(&dir_of(&path)) + "/",
            "readonly": readonly,
            "vault": self.vault().is_some(),
            "links": links,
            "keepScroll": keep_scroll,
            "fragment": fragment,
            "toEnd": end,
            "error": error,
            "canBack": !self.back.is_empty(),
            "seq": self.save_seq, // the last save that was written before the file was read
        });
        if !self.mode_given && (PROBE.is_none() || env("MDVIEW_PROBE_MODE").is_some()) {
            let start = app.prefs()["startMode"].as_str().unwrap_or("last").to_string();
            payload["startMode"] = if start == "last" { app.state.get("mode").cloned().unwrap_or(json!("read")) } else { json!(start) };
        }
        self.mode_given = true;
        self.js("MdView.render", &[payload]);
    }

    // -- actions -----------------------------------------------------------

    fn on_message(&mut self, app: &mut App, msg: &Value) {
        let text_of = |key: &str| msg[key].as_str().unwrap_or("");
        // (what writes into the folder: its project's snapshot follows — the watcher sees only
        // the directories a window shows)
        if matches!(text_of("type"), "save" | "toggle" | "pasteimage" | "dropfiles" | "graphic-save" | "newnote" | "newfolder" | "rename" | "trash") {
            if let Some(p) = self.path.clone().or_else(|| self.folder.clone()) {
                app.touch(&p);
            }
        }
        match text_of("type") {
            // the history's window (active/history.js): a note's versions, one of them as text, one of
            // them put back as the note
            "history-log" => {
                let Some(path) = msg["path"].as_str().map(PathBuf::from).or_else(|| self.path.clone()) else { return };
                let standing = history::standing(&dir_of(&path));
                let versions = history::log(&path).unwrap_or_default();
                self.js("MdView.history", &[json!({ "path": s(&path), "versions": versions, "state": standing["state"], "own": standing["own"] })]);
            }
            "history-text" => {
                let path = PathBuf::from(text_of("path"));
                let text = history::text(&path, text_of("id"), msg["at"].as_str()).ok().map(|b| String::from_utf8_lossy(&b).into_owned());
                self.js("MdView.historyText", &[json!({ "path": s(&path), "id": text_of("id"), "text": text })]);
            }
            "history-restore" => {
                let path = PathBuf::from(text_of("path"));
                // (only a note this window knows, written as any change from outside: the watcher shows it)
                let known = self.path.as_deref() == Some(path.as_path()) || self.note_paths.contains(text_of("path"));
                match history::text(&path, text_of("id"), msg["at"].as_str()).ok().filter(|_| known && is_md(&path)) {
                    Some(bytes) => match fs::write(&path, bytes) {
                        Ok(()) => {
                            app.touch(&path);
                            self.js("MdView.historyRestored", &[json!({ "path": s(&path), "id": text_of("id") })]);
                        }
                        Err(e) => self.toast(format!("Couldn't restore: {}", strerror(&e))),
                    },
                    None => self.toast("Couldn't restore this version"),
                }
            }
            // the conflicts' window (active/conflict.js): what stands in the way of joining the
            // project with its other side, and joining with what the user picked
            "sync-conflicts" | "sync-resolve" => {
                let Some(root) = self.here().and_then(|h| match history::place_of(&h) {
                    Place::Project(r) => Some(r),
                    _ => None,
                }) else { return };
                if text_of("type") == "sync-conflicts" {
                    match sync::conflicts(&root) {
                        Ok(all) => self.js("MdView.conflicts", &[all]),
                        Err(e) => self.toast(format!("Couldn't read the conflicts: {e}")),
                    }
                } else if let Some(picks) = msg["picks"].as_object() {
                    app.unsnapped.remove(&root); // (what waits is kept by the joining itself)
                    let (stamp, access) = (app.stamp(), app.access());
                    app.historian.resolve(&root, text_of("theirs").to_string(), picks.clone(), stamp, access);
                }
            }
            // signing in with GitHub (the settings): begun — the code comes with the settings' info —,
            // the browser opened with the code on the clipboard, given up, signed out
            "github-signin" => {
                if app.signing.is_none() {
                    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                    app.signing = Some((stop.clone(), None));
                    app.github_said.clear();
                    github::sign_in(app.tx.clone(), app.keyring_place(), stop);
                    self.settings_info(app);
                }
            }
            "github-open" => {
                if let Some((code, uri)) = app.signing.as_ref().and_then(|(_, shown)| shown.clone()) {
                    host::copy_text(&app.handle, code);
                    if PROBE.is_none() {
                        host::launch_uri(&uri); // (a test's click opens no browser)
                    }
                }
            }
            "github-cancel" => {
                if let Some((stop, _)) = app.signing.take() {
                    stop.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                self.settings_info(app);
            }
            // the repositories the app was given (read anew), where they are chosen on GitHub, and
            // one of them fetched into a folder of its own
            "github-repos" => {
                if let Some(session) = app.session.clone() {
                    github::repos(app.tx.clone(), session);
                }
            }
            "github-give" => host::launch_uri(github::GIVE),
            "github-get" => {
                if let (Some(url), Some(name)) = (msg["url"].as_str(), msg["name"].as_str().map(clean_name).filter(|n| !n.is_empty())) {
                    self.getting = Some((url.to_string(), name, msg["branch"].as_str().unwrap_or("main").to_string()));
                    self.pick(app, Pick::Parent);
                }
            }
            "github-signout" => {
                github::sign_out(&app.keyring_place());
                app.session = None;
                app.repos = None;
                app.renew_turn += 1;
                app.github_said.clear();
                app.each_win(|w, app| w.settings_info(app));
                self.settings_info(app);
            }
            "history-link" => {
                // the project is told where its other side is (url) or that it has none (no url);
                // linked, the two are reconciled at once
                let Some(root) = self.here().and_then(|h| match history::place_of(&h) {
                    Place::Project(r) => Some(r),
                    _ => None,
                }) else { return };
                app.synced.remove(&root);
                match msg["url"].as_str().filter(|u| !u.is_empty()) {
                    Some(url) => {
                        // (linked and reconciled on the history's thread; how it went comes back)
                        let (stamp, access) = (app.stamp(), app.access());
                        app.historian.link(&root, url.to_string(), stamp, access);
                    }
                    None => {
                        if let Err(e) = sync::unlink(&root) {
                            self.toast(format!("Couldn't unlink: {e}"));
                        }
                        self.tree_json = None;
                        self.send_folder(app);
                        self.settings_info(app);
                    }
                }
            }
            // sharing a note (active/share.js): how it stands, shared or its password set, shared no
            // more — written into the project (share.rs), kept and sent on at once
            "share-info" => {
                let path = PathBuf::from(text_of("path"));
                self.js("MdView.share", &[share::info(&path)]);
                self.share_asked = Some(path);
            }
            "share-set" | "share-stop" => {
                let path = PathBuf::from(text_of("path"));
                let known = self.path.as_deref() == Some(path.as_path()) || self.note_paths.contains(text_of("path"));
                let done = if !known || !is_md(&path) || share::info(&path)["can"] != true {
                    Ok(None)
                } else if text_of("type") == "share-stop" {
                    share::stop(&path)
                } else {
                    // (password: a text sets it, null takes it away, none said leaves it)
                    let password = msg.get("password").map(|p| p.as_str().filter(|p| !p.is_empty()));
                    // (a note shared for the first time: the web app says a short id that is free)
                    let id = if share::is_shared(&path) { None } else { share::free_id() };
                    share::set(&path, password, id).map(Some)
                };
                match done {
                    Ok(Some(root)) => app.keep_now(&root),
                    Ok(None) => {}
                    Err(e) => self.toast(format!("Couldn't share: {e}")),
                }
                self.js("MdView.share", &[share::info(&path)]);
                self.share_asked = Some(path);
                self.send_folder(app); // (the sidebar marks what is shared)
            }
            "history-now" => {
                // Ctrl+S: what waits in the project is kept now, and a linked one reconciled — not
                // after the quiet while
                if let Some(Place::Project(root)) = self.here().map(|h| history::place_of(&h)) {
                    app.unsnapped.remove(&root);
                    let (stamp, access) = (app.stamp(), app.access());
                    app.historian.snapshot(&root, stamp, access);
                }
            }
            "history-disable" => {
                // the folder's history is switched off: its versions stay, nothing more is kept
                let Some(root) = self.here().filter(|h| history::place_of(h) == Place::Project(h.clone())) else { return };
                app.unsnapped.remove(&root);
                app.historian.wait(); // (a snapshot under way is finished first)
                let stamp = app.stamp();
                match history::disable(&root, &stamp) {
                    Ok(()) => {
                        self.tree_json = None;
                        self.send_folder(app);
                        self.settings_info(app);
                        self.toast("History is off. Its versions are kept");
                    }
                    Err(e) => self.toast(format!("Couldn't switch the history off: {e}")),
                }
            }
            "history-enable" => {
                // the folder (or the one named) becomes a project; its first snapshot follows
                let Some(root) = msg["root"].as_str().map(PathBuf::from).or_else(|| self.here()) else { return };
                // (a repository that is there already is someone's: taken over only when they say so)
                if history::place_of(&root) == Place::Foreign(root.clone()) && !truthy(&msg["sure"]) && !history::was_project(&root) {
                    return self.ask_adopt(app, &root);
                }
                // (projects of their own below it: a part of this one from now on, or left as they are?)
                let below = history::nested(&root);
                if !below.is_empty() && msg["nested"].is_null() {
                    return self.ask_nested(app, &root, &below);
                }
                match history::enable(&root) {
                    Ok(()) => {
                        if msg["nested"] == "merge" {
                            let stamp = app.stamp();
                            app.historian.merge(&root, below, stamp);
                        }
                        app.touch(&root);
                        self.send_folder(app);
                        self.settings_info(app);
                    }
                    Err(e) => self.toast(format!("No history here: {e}")),
                }
            }
            "link" => self.handle_link(app, text_of("href"), truthy(&msg["tab"])),
            "wikilink" => self.open_wikilink(app, text_of("target"), truthy(&msg["tab"])),
            "tab" => self.tab_op(app, msg),
            "toggle" => self.toggle_task(app, msg["line"].as_i64().unwrap_or(-1), truthy(&msg["checked"])),
            "editcmd" => {
                // the page's text menu: the command runs where the focus is, as the key would
                if let (Some(window), cmd @ ("Cut" | "Copy" | "Paste" | "SelectAll")) = (&self.window, text_of("cmd")) {
                    host::edit_command(window, cmd);
                }
            }
            "copyimage" => self.copy_image(app, text_of("src")),
            "copy" => host::copy_text(&app.handle, text_of("text").to_string()),
            "mode" => {
                self.editing = truthy(&msg["edit"]);
                if let name @ ("read" | "edit" | "active") = text_of("name") {
                    if app.state.get("mode").and_then(Value::as_str) != Some(name) {
                        app.state.insert("mode".into(), json!(name)); // the next window starts in it
                        app.save_state();
                    }
                }
            }
            "prefs" => {
                let new = msg["prefs"].as_object().cloned().unwrap_or_default();
                let prefs = Value::Object(app.store_prefs(&new));
                let lists = new.keys().any(|k| k.starts_with("sidebar")); // (what the sidebar lists may have changed)
                let told = |w: &mut Win, app: &mut App| {
                    w.js("MdView.setPrefs", &[prefs.clone()]);
                    if lists && w.folder.is_some() {
                        w.rescan(app);
                    }
                };
                told(self, app);
                app.each_win(told);
            }
            "dropfiles" => self.drop_files(app, &msg["uris"], msg["path"].as_str()),
            "closehold" => {
                // the page has a question to ask before the window may go
                self.close_turn += 1;
                self.closing = false;
            }
            "save" => {
                // a late autosave must not land in whatever note is open by now
                if msg["path"].is_null() || msg["path"].as_str() == self.path.as_deref().map(s).as_deref() {
                    if truthy(&msg["seq"]) {
                        self.save_seq = msg["seq"].clone();
                    }
                    self.save_text(msg["text"].as_str(), truthy(&msg["exact"]));
                }
            }
            "pasteimage" => self.paste_image(app, msg["path"].as_str(), truthy(&msg["append"])),
            "pasteclip" => {
                let html = host::clipboard_html(&app.handle);
                let text = host::clipboard_text(&app.handle).unwrap_or_default();
                self.js("MdView.pasteClip", &[json!({ "text": text, "html": html })]);
            }
            "pastetext" => {
                if let Some(text) = host::clipboard_text(&app.handle) {
                    self.js("MdView.pasteText", &[json!({ "text": text })]);
                }
            }
            "external" => {
                if let Some(path) = &self.path {
                    host::open_in_editor(path);
                }
            }
            "note" => self.open_note(app, text_of("path"), truthy(&msg["tab"])),
            "graphic" => app.illustrator.draw(Drawing {
                label: self.label.clone(),
                id: msg["id"].clone(),
                text: take(text_of("text"), 6000),
                image: msg["image"].as_str().filter(|i| !i.is_empty()).map(String::from),
                previous: msg["previous"].as_str().filter(|p| !p.is_empty()).map(String::from),
                change: Some(take(text_of("change"), 3000)).filter(|c| !c.is_empty()),
            }),
            "graphic-cancel" => app.illustrator.stop(),
            "graphic-image" => self.graphic_image(app, text_of("how")),
            "graphic-save" => self.save_graphic(app, text_of("svg"), text_of("name")),
            "complete" => {
                // the next words for what is being written (active/ghost.js); only when switched on
                let prefs = app.prefs();
                if truthy(&prefs["aiComplete"]) {
                    let before: Vec<char> = text_of("before").chars().collect();
                    let before: String = before[before.len().saturating_sub(6000)..].iter().collect();
                    let model = ai::ai_model(prefs["aiModel"].as_str().unwrap_or(""));
                    let tx = app.tx.clone();
                    app.completer.get_or_insert_with(|| Completer::new(tx)).ask(&self.label, msg["id"].clone(), before, take(text_of("after"), 1000), model);
                }
            }
            "resolve" => {
                // a link written after the note was read: where it points
                let target = text_of("target");
                let found = if target.is_empty() { None } else { self.resolver.as_mut().and_then(|r| r.resolve(target)) };
                let info = found.map_or(Value::Null, |p| json!({ "path": s(&p), "url": file_url(&p), "kind": file_kind(&p) }));
                self.js("MdView.linkResolved", &[json!(target), info]);
            }
            "painted" => {
                // (the page's content is drawn: the web view, not shown until now, is)
                if let Some(window) = &self.window {
                    host::show_view(window);
                }
            }
            "fileop" => self.file_op(text_of("op"), text_of("path")),
            "pdfdata" => {
                let id = match &msg["id"] {
                    Value::String(t) => t.clone(),
                    other => other.to_string(),
                };
                self.send_pdf(text_of("path"), &id);
            }
            "pdfnote" => {
                // from a highlight in a PDF to the note it comes from, at the line of its link
                let p = PathBuf::from(text_of("path"));
                if p.is_file() && is_md(&p) {
                    let line = msg["line"].as_f64().unwrap_or(0.0) as i64;
                    self.open_path(app, &p, Some(format!("^line={line}")), true);
                }
            }
            "newnote" => self.new_note(app, text_of("name"), msg["dir"].as_str()),
            "newfolder" => self.new_folder(app, text_of("name"), msg["dir"].as_str()),
            "rename" => self.rename_note(app, text_of("path"), text_of("name")),
            "trash" => self.trash_note(app, text_of("path")),
            "sidebar" => self.sidebar_pref(app, msg),
            "previews" => self.send_previews(&msg["paths"]),
            "folder" => self.pick(app, Pick::Folder),
            "open" => self.choose_file(app),
            "reload" => {
                self.new_resolver();
                self.render(app, true, None, false);
            }
            "zoom" if PROBE.is_some() => {
                // (tests only: the page larger, to see it in a narrow window — the app itself has one size)
                self.zoom = match msg["step"].as_f64().filter(|s| *s != 0.0) {
                    Some(step) => (self.zoom + 0.1 * step).min(2.5),
                    None => 1.0,
                };
                if let Some(window) = &self.window {
                    let _ = window.set_zoom(self.zoom);
                }
            }
            "settings-info" => self.settings_info(app),
            "aikey" => {
                if let Err(e) = ai::store_ai_key(text_of("key")) {
                    self.toast(format!("Couldn't save the key: {}", strerror(&e)));
                }
                self.settings_info(app);
            }
            "help" => {
                let guide = SHARED.assets.join("docs").join("FEATURES.md");
                if guide.is_file() && self.path.as_ref() != Some(&guide) {
                    app.open_file(&guide);
                }
            }
            "print" => {
                if let Some(window) = &self.window {
                    let _ = window.print();
                }
            }
            "close" => self.close(app),
            "back" => self.go(app, true),
            "forward" => self.go(app, false),
            "log" if *DEBUG => eprintln!("[js] {}", text_of("text")),
            "probe" => {
                if let Some(out) = PROBE_OUT.as_ref() {
                    let of = self.path.as_deref().map(name_of).unwrap_or_else(|| "none".into());
                    let name = msg["name"].as_str().unwrap_or("probe");
                    let text = match &msg["text"] {
                        Value::String(t) => t.clone(),
                        other => other.to_string(),
                    };
                    let _ = fs::write(Path::new(out).join(format!("{of}.{name}.json")), text);
                }
            }
            "snapshot" => {
                let rect = ["x", "y", "w", "h"].map(|k| msg[k].as_f64());
                if let (Some(window), [Some(x), Some(y), Some(w), Some(h)]) = (&self.window, rect) {
                    let said = msg["said"].as_str().filter(|t| !t.is_empty()).unwrap_or("Copied").to_string();
                    host::snapshot(window, [x, y, w, h], said, PROBE_OUT.as_ref().map(PathBuf::from));
                }
            }
            "probe-pointer" if PROBE.is_some() => {
                if let Some(window) = &self.window {
                    host::pointer(window, msg);
                }
            }
            _ => {}
        }
    }

    /// A picture of the note, by its file, onto the clipboard.
    fn copy_image(&self, app: &App, src: &str) {
        match url_file(src) {
            None => self.toast("Only pictures in files can be copied"),
            Some((path, _)) => {
                if !host::copy_image_file(&app.handle, &path) {
                    self.toast("Couldn't copy the picture");
                }
            }
        }
    }

    fn handle_link(&mut self, app: &mut App, href: &str, tab: bool) {
        let Some((mut p, frag)) = url_file(href) else {
            // (not a file: the system's to open — unless it is the page's own address)
            if tauri::Url::parse(href).is_ok() && !href.starts_with(ORIGIN) && !href.starts_with("about:") {
                host::launch_uri(href);
            }
            return;
        };
        if !p.exists() && !is_md(&p) {
            let alt = p.with_file_name(format!("{}.md", name_of(&p)));
            if alt.exists() {
                p = alt;
            }
        }
        let tab = tab && !self.tabs.is_empty();
        if self.path.as_ref() == Some(&p) && !tab {
            if let Some(frag) = frag {
                self.js("MdView.scrollToFragment", &[json!(frag), json!(true)]);
            }
            return;
        }
        if !p.exists() {
            self.toast(format!("Not found: {}", name_of(&p)));
        } else if p.is_file() && (is_md(&p) || is_pdf(&p)) {
            if tab {
                self.new_tab(app, Some(&p), frag, None);
            } else {
                self.open_path(app, &p, frag, true);
            }
        } else {
            host::launch_path(&p);
        }
    }

    fn open_wikilink(&mut self, app: &mut App, target: &str, tab: bool) {
        let heading = target.split_once('#').map(|(_, h)| h.to_string());
        let Some(p) = self.resolver.as_mut().and_then(|r| r.resolve(target)) else {
            return self.toast(format!("Note “{}” doesn't exist", target.split('#').next().unwrap_or("")));
        };
        if !matches!(file_kind(&p), "md" | "pdf") {
            host::launch_path(&p);
        } else if tab && !self.tabs.is_empty() {
            self.new_tab(app, Some(&p), heading, None);
        } else {
            self.open_path(app, &p, heading, true);
        }
    }

    fn toggle_task(&mut self, app: &mut App, line: i64, checked: bool) {
        let Some(path) = self.path.clone().filter(|_| line >= 0) else { return };
        let Ok(text) = read_text(&path, None) else { return };
        let mut lines: Vec<String> = text.split('\n').map(String::from).collect();
        let Some(old) = lines.get(line as usize).cloned() else { return };
        let Some(m) = TASK_RE.captures(&old) else {
            return self.render(app, true, None, false);
        };
        lines[line as usize] = format!("{}{}{}", &m[1], if checked { "x" } else { " " }, &old[m.get(2).unwrap().end()..]);
        if let Err(e) = fs::write(&path, lines.join("\n")) {
            self.toast(format!("Couldn't save: {}", strerror(&e)));
            self.render(app, true, None, false);
        }
    }

    /// exact: the text is the file as it is to be (the active mode keeps every line ending as
    /// it was); else "\n" throughout, written the way the file had it.
    fn save_text(&mut self, text: Option<&str>, exact: bool) {
        let (Some(path), Some(text)) = (self.path.clone(), text) else { return };
        if is_pdf(&path) {
            return; // (never the text of a note into a PDF)
        }
        if exact {
            match fs::write(&path, text.as_bytes()) {
                Ok(()) => self.own_write = Some(text.as_bytes().to_vec()), // the watcher will report it: nothing to reload
                Err(e) => self.js("MdView.saveFailed", &[json!(strerror(&e))]),
            }
            return;
        }
        let old = match fs::read(&path) {
            Ok(old) => old,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(e) => return self.js("MdView.saveFailed", &[json!(strerror(&e))]),
        };
        // Written in place (no temp file + rename), so symlinked files and
        // their permissions stay what they are. Line endings are kept.
        let crlf = old.windows(2).any(|w| w == b"\r\n");
        let data = if crlf { text.replace('\n', "\r\n").into_bytes() } else { text.as_bytes().to_vec() };
        if data != old {
            if let Err(e) = fs::write(&path, &data) {
                return self.js("MdView.saveFailed", &[json!(strerror(&e))]);
            }
        }
        self.own_text = Some(text.to_string());
    }

    // -- pasted images ----------------------------------------------------

    /// Where a pasted image goes: next to the note (or where the settings say, relative to
    /// it), or wherever the Obsidian vault keeps its attachments (default: the vault root).
    fn attachment_dir(&self, app: &App, note: &Path, vault: Option<&Path>) -> PathBuf {
        let beside = dir_of(note);
        let Some(vault) = vault else {
            let prefs = app.prefs();
            let wanted = prefs["images"].as_str().unwrap_or("beside").trim();
            if matches!(wanted, "" | "beside" | ".") {
                return beside;
            }
            let d = normalize(&beside.join(if wanted == "assets" { "assets" } else { wanted.trim_start_matches('/') }));
            return if d.starts_with(&beside) { d } else { beside };
        };
        let conf = fs::read_to_string(vault.join(".obsidian/app.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        let conf = conf.as_ref().and_then(|c| c["attachmentFolderPath"].as_str()).filter(|c| !c.trim_matches('/').is_empty());
        let Some(conf) = conf else { return vault.to_path_buf() };
        let d = normalize(&match conf.strip_prefix("./") {
            Some(rel) => beside.join(rel),
            None => vault.join(conf),
        });
        if d.starts_with(vault) { d } else { vault.to_path_buf() }
    }

    fn image_markup(&self, target: &Path, note: &Path, vault: bool) -> String {
        if vault {
            return format!("![[{}]]", name_of(target));
        }
        format!("![]({})", quote(&relative(target, &dir_of(note))))
    }

    /// Save the clipboard image as a file and embed it: the page inserts the Markdown at the
    /// caret (editing), or it goes to the end of the note (reading).
    fn paste_image(&mut self, app: &mut App, path: Option<&str>, append: bool) {
        let Some(note) = self.path.clone().filter(|p| path == Some(s(p).as_str())) else { return };
        let Some((data, ext)) = host::clipboard_image(&app.handle) else { return };
        let mut old = Vec::new();
        if append {
            old = match fs::read(&note) {
                Ok(old) => old,
                Err(e) => return self.toast(format!("Couldn't add image: {}", strerror(&e))),
            };
            if let Some(reason) = readonly_reason(&note, Some(&old)) {
                return self.toast(format!("Can't edit: {reason}"));
            }
        }
        let vault = self.vault();
        let stem = chrono::Local::now().format(if vault.is_some() { "Pasted image %Y%m%d%H%M%S" } else { "pasted-%Y%m%d-%H%M%S" }).to_string();
        let folder = self.attachment_dir(app, &note, vault.as_deref());
        let target = match write_new(&folder, |n| if n == 1 { format!("{stem}{ext}") } else { format!("{stem}-{n}{ext}") }, &data, 100) {
            Ok(target) => target,
            Err(e) => return self.toast(format!("Couldn't save image: {}", strerror(&e))),
        };
        let markup = self.image_markup(&target, &note, vault.is_some());
        if !append {
            return self.js("MdView.insertImage", &[json!({ "path": s(&note), "markup": markup })]);
        }
        let nl: &[u8] = if old.windows(2).any(|w| w == b"\r\n") { b"\r\n" } else { b"\n" };
        let end = old.iter().rposition(|b| !matches!(b, b'\r' | b'\n')).map_or(0, |i| i + 1);
        let mut new = old[..end].to_vec();
        if !new.is_empty() {
            new.extend_from_slice(nl);
            new.extend_from_slice(nl);
        }
        new.extend_from_slice(markup.as_bytes());
        new.extend_from_slice(nl);
        if let Err(e) = fs::write(&note, &new) {
            self.toast(format!("Couldn't save: {}", strerror(&e)));
            let _ = fs::remove_file(&target);
            return;
        }
        self.own_write = Some(new);
        self.new_resolver();
        self.render(app, false, None, true);
    }

    /// Pictures dropped on the document: one inside the note's folder is linked where it is,
    /// any other is copied where pasted pictures go. The page inserts the Markdown where they
    /// were dropped (insertDropped).
    fn drop_files(&mut self, app: &mut App, uris: &Value, path: Option<&str>) {
        let Some(note) = self.path.clone().filter(|p| path == Some(s(p).as_str())) else { return };
        let vault = self.vault();
        let beside = resolve(&dir_of(&note));
        let (mut markups, mut skipped) = (Vec::new(), 0);
        for uri in uris.as_array().map(Vec::as_slice).unwrap_or_default() {
            let src = uri.as_str().and_then(url_file).map(|(p, _)| p).unwrap_or_default();
            if name_of(&src).is_empty() || !scan::IMAGE_EXT.contains(&scan::ext_of(&src).as_str()) || !src.is_file() {
                skipped += 1;
                continue;
            }
            if resolve(&src).starts_with(&beside) {
                markups.push(self.image_markup(&resolve(&src), &note, vault.is_some()));
                continue;
            }
            let copied = fs::read(&src).and_then(|data| {
                let (stem, ext) = (src.file_stem().unwrap_or_default().to_string_lossy().into_owned(), scan::ext_of(&src));
                let dot = src.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or(format!(".{ext}"));
                write_new(&self.attachment_dir(app, &note, vault.as_deref()), |n| if n == 1 { name_of(&src) } else { format!("{stem}-{n}{dot}") }, &data, 100)
            });
            match copied {
                Ok(target) => markups.push(self.image_markup(&target, &note, vault.is_some())),
                Err(e) => self.toast(format!("Couldn't copy picture: {}", strerror(&e))),
            }
        }
        if skipped > 0 && markups.is_empty() {
            self.toast("Only pictures can be dropped here");
        }
        if !markups.is_empty() {
            self.js("MdView.insertDropped", &[json!({ "path": s(&note), "markups": markups })]);
        }
    }

    /// A reference picture for a figure: chosen from the files, or the one on the clipboard
    /// (kept in the cache while it is needed). The page gets its path.
    fn graphic_image(&mut self, app: &mut App, how: &str) {
        if how != "paste" {
            return self.pick(app, Pick::Reference);
        }
        let Some((data, ext)) = host::clipboard_image(&app.handle) else {
            return self.js("MdView.graphicImage", &[Value::Null, Value::Null, json!("No picture on the clipboard")]);
        };
        let dir = env("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".cache")).join("mdview");
        let p = dir.join(format!("reference{ext}"));
        if fs::create_dir_all(&dir).and_then(|_| fs::write(&p, data)).is_ok() {
            self.js("MdView.graphicImage", &[json!(s(&p)), json!(format!("{}?{}", file_url(&p), now())), Value::Null]);
        }
    }

    /// The figure as a file where the note's pictures go, and its Markdown at the caret.
    fn save_graphic(&mut self, app: &mut App, svg: &str, name: &str) {
        let Some(svg) = ai::clean_svg(svg) else { return };
        let Some(note) = self.path.clone().filter(|p| !is_pdf(p)) else { return };
        let vault = self.vault();
        let clean = clean_name(name);
        let words: Vec<&str> = WORD_RE.find_iter(&clean).take(5).map(|m| m.as_str()).collect();
        let stem = take(&words.join("-"), 48).trim_matches('-').to_string();
        let stem = if stem.is_empty() { "graphic".to_string() } else { stem };
        let folder = self.attachment_dir(app, &note, vault.as_deref());
        match write_new(&folder, |n| if n == 1 { format!("{stem}.svg") } else { format!("{stem}-{n}.svg") }, format!("{svg}\n").as_bytes(), 200) {
            Ok(target) => {
                let markup = self.image_markup(&target, &note, vault.is_some());
                self.js("MdView.insertImage", &[json!({ "path": s(&note), "markup": markup })]);
            }
            Err(e) => self.toast(format!("Couldn't save the figure: {}", strerror(&e))),
        }
    }

    /// From a file's menu in the sidebar: open it in its default application, in one chosen
    /// from the system's list, or show it in the file manager.
    /// Before a repository that exists becomes a project: what follows from it, to be agreed to.
    fn ask_adopt(&self, app: &App, root: &Path) {
        let Some(window) = &self.window else { return };
        let onto = history::branch(root).map(|b| format!(" on the branch “{b}”")).unwrap_or_default();
        let text = format!("“{}” is a Git repository already. As a project, Markdown Notes keeps every change in it as a commit of its own{onto}, a little while after it was made.", name_of(root));
        let (tx, label, root) = (app.tx.clone(), self.label.clone(), s(root));
        app.handle
            .dialog()
            .message(text)
            .title("Use This Repository for History?")
            .buttons(MessageDialogButtons::OkCancelCustom("Use Repository".into(), "Cancel".into()))
            .parent(window)
            .show(move |sure| {
                if sure {
                    let _ = tx.send(Event::Msg { label, json: json!({ "type": "history-enable", "root": root, "sure": true }).to_string() });
                }
            });
    }

    /// Before a folder with projects in it becomes one: are they taken in, or left separate?
    fn ask_nested(&self, app: &App, root: &Path, below: &[PathBuf]) {
        let Some(window) = &self.window else { return };
        let names: Vec<String> = below.iter().map(|b| format!("“{}”", relative(b, root))).collect();
        let (they, their) = if names.len() == 1 { ("is a project of its own", "its") } else { ("are projects of their own", "their") };
        let text = format!("{} in this folder {they}. Taken in, {their} history becomes a part of this project's, and there is one project from now on. Left separate, each keeps a history of its own.", names.join(", "));
        let (take, leave) = ("Take In", "Leave Separate");
        let (tx, label, root, sure) = (app.tx.clone(), self.label.clone(), s(root), true);
        app.handle
            .dialog()
            .message(text)
            .title("Projects in This Folder")
            .buttons(MessageDialogButtons::YesNoCancelCustom(take.into(), leave.into(), "Cancel".into()))
            .parent(window)
            .show_with_result(move |answer| {
                let nested = match answer {
                    MessageDialogResult::Yes => "merge",
                    MessageDialogResult::No => "separate",
                    MessageDialogResult::Custom(l) if l == take => "merge",
                    MessageDialogResult::Custom(l) if l == leave => "separate",
                    _ => return,
                };
                let _ = tx.send(Event::Msg { label, json: json!({ "type": "history-enable", "root": root, "sure": sure, "nested": nested }).to_string() });
            });
    }

    fn file_op(&self, op: &str, path: &str) {
        let p = Path::new(path);
        let inside = !path.is_empty() && self.folder.as_ref().is_some_and(|f| p.is_dir() && resolve(p).starts_with(f));
        if path.is_empty() || !(self.note_paths.contains(path) || (op == "reveal" && inside)) {
            return;
        }
        match op {
            "default" => host::launch_path(p),
            "openwith" => {
                if !host::open_with(p) {
                    host::launch_path(p); // (no chooser to ask: the application it opens in anyway)
                }
            }
            "reveal" => host::reveal(p),
            _ => {}
        }
    }

    /// The folder this window is about: the one it browses, or the one its note is in.
    fn here(&self) -> Option<PathBuf> {
        self.folder.clone().or_else(|| self.path.as_deref().map(dir_of))
    }

    fn settings_info(&self, app: &mut App) {
        // the history of the folder shown: where it stands, what is kept, what waits; the device
        let mut history = self.here().map_or(json!({ "state": "none" }), |f| history::overview(&f));
        if let Some(root) = history["root"].as_str().map(PathBuf::from) {
            history["waiting"] = json!(app.unsnapped.contains_key(&root));
            if let Some(here) = self.here() {
                let linked = app.standing(&here);
                history["linked"] = linked["linked"].clone();
                history["sync"] = linked["sync"].clone();
            }
        }
        let device = app.stamp().device;
        let device_id = device.rsplit_once(" (").map_or("", |(_, id)| id.trim_end_matches(')')).to_string();
        let config = s(&ai::config_dir());
        let home = s(&home());
        let shown = if !home.is_empty() && config.starts_with(&home) { format!("~{}", &config[home.len()..]) } else { config };
        self.js("MdView.settingsInfo", &[json!({ "aiKey": ai::ai_key_state(), "aiModel": ai::AI_MODEL, "version": app_version(), "configDir": shown, "deviceName": host_name(), "deviceId": device_id, "history": history, "home": home, "github": app.github_shown() })]);
    }

    fn go(&mut self, app: &mut App, back: bool) {
        let Some(to) = (if back { self.back.pop() } else { self.fwd.pop() }) else { return };
        if let Some(here) = self.path.clone() {
            if back { self.fwd.push(here) } else { self.back.push(here) }
        }
        self.open_path(app, &to, None, false);
    }

    /// The window is to go. While a note is being written the page hands over unsaved text
    /// first; it answers with "close" (or holds the window, to ask).
    fn close(&mut self, app: &mut App) {
        if self.editing && self.shell_ready && !self.closing {
            self.closing = true;
            self.js("MdView.flush", &[json!(true)]);
            self.close_turn += 1;
            return app.after(400, Event::CloseNow { label: self.label.clone(), turn: self.close_turn });
        }
        self.close_turn += 1;
        if let Some(window) = self.window.take() {
            if !window.is_maximized().unwrap_or(false) {
                if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                    let size = size.to_logical::<f64>(scale);
                    let (w, h) = if self.folder.is_some() { ("folder_width", "folder_height") } else { ("width", "height") };
                    app.state.insert(w.into(), json!(size.width.round() as i64));
                    app.state.insert(h.into(), json!(size.height.round() as i64));
                    app.save_state();
                }
            }
            let _ = window.destroy();
        }
        self.watcher = None;
        self.gone = true;
    }
}
