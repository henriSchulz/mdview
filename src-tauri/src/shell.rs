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

use crate::ai::{self, Completer, Drawing, Illustrator, Talk, Talker};
use crate::github::{self, News, Session};
use crate::history::{self, Historian, Place, Stamp};
use crate::paste;
use crate::share;
use crate::sync::{self, Access};
use crate::scan::{self, clean_name, file_kind, is_md, is_pdf, quote, read_bytes, read_text, resolve, s, unquote, Node, Resolver, TitleCache};
use crate::theme::{self, home, Theme};
use crate::{host, Event, Pick, ORIGIN, SHARED};

// The rest of this module, by what it is about (each file: more of `impl App` or `impl Win`).
mod app;
mod claude;
mod files;
mod folder;
mod messages;
mod project;
mod tabs;
mod undo;

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
    "viewer/base.js",
    "viewer/markdown.js",
    "viewer/prep.js",
    "viewer/render.js",
    "viewer/chrome.js",
    "viewer/editor.js",
    "viewer/trail.js",
    "viewer/modes.js",
    "viewer/sidebar.js",
    "viewer/menus.js",
    "viewer/drawer.js",
    "viewer/tabs.js",
    "viewer/toolbar.js",
    "viewer/split.js",
    "viewer/twin.js",
    "viewer.js",
    "overview.js",
];

/// The page's styles, in the order they are linked (later ones win): viewer/*.css.
const STYLES: &[&str] = &["page", "text", "code", "blocks", "pages", "editor", "chrome", "sidebar", "tabs", "menus", "narrow", "layouts", "split", "twin"];

/// Settings of the active mode (state.json "active"), with what they are when nothing is set.
fn default_prefs() -> Map<String, Value> {
    let prefs = json!({
        "lang": "en",           // the active mode's own texts: "en" | "de"
        "startMode": "last",    // a new window: "last" (the mode used last) | "read" | "active" | "split" | "edit"
        "bar": true,            // the formatting bar over a selection
        "slash": true,          // "/" at the start of an empty line opens the insert menu
        "syntax": false,        // the Markdown of the formatting at the caret shows
        "quotes": false,        // typed quotes become typographic ones
        "wrap": 0,              // paragraphs written anew are wrapped at this many characters (0: not)
        "images": "assets",     // pasted and dropped pictures and files: in the base folder's "assets" (files.rs: base_of) | "beside" the note itself | a folder relative to the note
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
        // what the folder sidebar lists beside the notes: everything, as long as a kind is not taken out —
        // PDFs, pictures, sound and film, whiteboards, everything else
        "sidebarPdf": true, "sidebarImages": true, "sidebarMedia": true, "sidebarBoards": true, "sidebarOther": true,
        "showHidden": false,      // … and what is put away: hidden by hand, named with a dot, built, kept for a note (shown dimmed)
        "sidebarLayout": "rail", // how the sidebar is laid out: "source" (a tree, what was open last above it) | "rail" (the folders as signs beside their notes) | "sheets" (a sheet of paper each) | "tiles" (smart lists as tiles above the folders)
        "sidebarSort": "name",  // the notes of a folder, in the sidebar and the tiles: "name" (at first) | "opened" (last opened first) | "modified"
        // a continuation suggested while typing (the text around the caret goes to the model's maker)
        "aiOn": true,             // AI in the app at all: Transform with AI, the chat, graphics by Claude, suggestions
        "aiClaude": "",           // the model the claude command is asked for ("": its own)
        "aiComplete": false,
        "panel": false, "panelTab": "insert",   // the panel at the window's right (insert, format): open, and its tab
        "ovScope": "all", "ovLayout": "tiles",  // all notes: "all" | "folders" (one at a time), as "tiles" | "list"
        // what All Notes lists beside the notes — its own choice, apart from the sidebar's
        "ovPdf": true, "ovImages": true, "ovMedia": true, "ovBoards": true, "ovOther": true,
        "ovBoardsShow": "all",      // the whiteboards shown there: "all" | "embedded" (a note shows them) | "loose" (none does)
        "calloutStyle": "box",    // how callouts and Focus look: "box" (a tinted box, a bar) | "tip" (a large sign beside the text) | "label" (a line, the title on its edge)
        "docZoom": 100,           // the note's text, in percent (Ctrl + and −)
        "props": true,            // a note's properties show at its head (false: put away, from the menu of a right click)
        "hinting": false,         // text drawn on whole pixels (sharper on a screen of ordinary resolution); at the next start
        "aiModel": "",            // the model asked for suggestions ("": AI_MODEL)
        "historyQuiet": 30,       // a project's changes are kept as a commit after this many seconds without another
        "deviceName": "",         // what this device is called in a commit ("": the computer's name)
    });
    let Value::Object(mut m) = prefs else { unreachable!() };
    // quick notes (mdview --quick): the folder they are kept in ("": Documents/Notizen/QuickNotes), and the keys that make a new one
    // (put in here: the list above is as long as one json! takes)
    m.insert("quickDir".into(), json!(""));
    m.insert("quickNew".into(), json!("Ctrl+N"));
    m
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

/// The text of a file that is one — source code, a list, a log: UTF-8 without a NUL, and not
/// too large — for showing it in a note as code (`![[main.c]]`).
fn embedded_text(p: &Path) -> Option<String> {
    if fs::metadata(p).ok()?.len() > EMBED_LIMIT as u64 {
        return None;
    }
    let bytes = fs::read(p).ok()?;
    if bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes).ok()
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
/// A file written whole or not at all: beside it under another name first, then put in its place
/// — a full disk or a crash in the middle leaves the file as it was, not cut off. A link is
/// followed (the file it names is what is written), the file keeps its permissions; where no file
/// can be made beside it, it is written in place as before.
fn write_whole(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let real = crate::scan::canon(path).unwrap_or_else(|_| path.to_path_buf());
    let Some(name) = real.file_name().map(|n| n.to_string_lossy().into_owned()) else { return fs::write(path, data) };
    let beside = real.with_file_name(format!(".{name}.mdview-{}", std::process::id()));
    let made = (|| -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&beside)?;
        f.write_all(data)?;
        f.sync_all()?;
        if let Ok(meta) = fs::metadata(&real) {
            let _ = fs::set_permissions(&beside, meta.permissions());
        }
        fs::rename(&beside, &real)
    })();
    match made {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&beside);
            // (the disk is full: nothing is tried in place — that would cut the file off)
            if e.raw_os_error() == Some(28) && real.exists() {
                return Err(e);
            }
            fs::write(path, data)
        }
    }
}

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

/// What a whiteboard's file holds (board/format.js), and how it is named.
const BOARD_MARK: &str = "<metadata id=\"mdview-board\">";
fn is_board(path: &Path) -> bool {
    scan::is_board(path)
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

/// Quick notes: a window for writing something down at once — a list of short notes, newest
/// first, each a Markdown file in one folder, named after what its first line says. Started with
/// `mdview --quick`. The folder: the settings' quickDir, else Documents/Notizen/QuickNotes.
fn quick_dir(prefs: &Map<String, Value>) -> PathBuf {
    let set = prefs.get("quickDir").and_then(Value::as_str).map(str::trim).filter(|d| !d.is_empty());
    match set {
        Some(d) if d.starts_with("~/") => home().join(&d[2..]),
        Some(d) => PathBuf::from(d),
        None => home().join("Documents/Notizen/QuickNotes"),
    }
}
/// A quick note's name while it has none of its own: the time it was made at.
static QUICK_NAME: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}(-\d+)?$").unwrap());

/// What the application itself put beside notes, and what of it went (attach.rs).
fn attachments() -> crate::attach::Store {
    let cache = env("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".cache")).join("mdview");
    crate::attach::Store::new(&dir_of(&state_file()), &cache)
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
    quick: bool,             // … the folder of the quick notes: a list of short notes, made and named without asking
    tree: Option<Node>,
    tree_json: Option<String>,
    note_paths: HashSet<String>,
    kept_dirs: HashSet<String>, // folders made from the sidebar: shown although nothing is in them yet
    trashed: Vec<PathBuf>, // what went to the trash last: taken out again by Undo (while its message stands)
    trashed_shown: Option<PathBuf>, // … and the note that was on screen then, if it went with it
    steps: undo::Steps,             // what was done to the folder's files: taken back and done again (shell/undo.rs)
    share_asked: Option<PathBuf>, // the note whose sharing the page last asked about: told again when its project was kept or reconciled
    title_cache: TitleCache,
    watcher: Option<notify::RecommendedWatcher>,
    watched: HashSet<PathBuf>,   // every directory the watcher looks at
    dir_watch: HashSet<PathBuf>, // … for the folder's tree
    board_paths: HashSet<String>, // the folder's whiteboards as last listed for All Notes — those a note keeps too, which the folder's list leaves out
    board_dirs: HashSet<PathBuf>, // … where the whiteboards the note shows are kept (their pictures are made anew when they change)
    ai_files: HashSet<PathBuf>, // files chosen in the system's window for Claude to read (the chat's context): only those are handed to it
    ai_token: String,           // … and what the answer of that window carries, so that nothing else can name files
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
    board_open: bool, // a whiteboard is open over the note: closing asks the page first, as while a note is written
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
    talker: Talker,
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
    share_dirty: HashSet<PathBuf>, // projects whose list of shares changed here: the web app is told once that has arrived at GitHub
    watcher: Option<notify::RecommendedWatcher>,
    started: Option<SystemTime>, // the program file as it was when this started
    file_clip: (Vec<PathBuf>, bool), // files and folders copied in a folder's list, for Paste there (true: cut — they are moved)
}

pub fn run(handle: AppHandle, tx: Sender<Event>, rx: Receiver<Event>) {
    let mut state = fs::read_to_string(state_file()).ok().and_then(|t| serde_json::from_str::<Map<String, Value>>(&t).ok()).unwrap_or_default();
    // Since a folder's list shows everything that is not taken out, what was chosen while it showed
    // only what was put in ("no pictures": said by nobody, kept as a choice) is let go, once.
    if state.insert("lists_all".into(), json!(true)).is_none() {
        if let Some(kept) = state.get_mut("active").and_then(Value::as_object_mut) {
            kept.retain(|k, _| !matches!(k.as_str(), "sidebarPdf" | "sidebarImages" | "sidebarMedia" | "sidebarOther" | "ovPdf" | "ovImages" | "ovMedia" | "ovOther"));
        }
    }
    let mut app = App {
        file_clip: (vec![], false),
        illustrator: Illustrator::new(tx.clone()),
        talker: Talker::new(tx.clone()),
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
        share_dirty: HashSet::new(),
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
    std::sync::LazyLock::force(&crate::paste::STARTED);
    github::resume(app.tx.clone(), app.keyring_place()); // (a sign-in kept from before)
    for event in rx {
        app.on_event(event);
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
            quick: false,
            tree: None,
            tree_json: None,
            note_paths: HashSet::new(),
            kept_dirs: HashSet::new(),
            trashed: vec![],
            trashed_shown: None,
            steps: undo::Steps::default(),
            share_asked: None,
            title_cache: TitleCache::new(),
            watcher,
            watched: HashSet::new(),
            dir_watch: HashSet::new(),
            board_paths: HashSet::new(),
            board_dirs: HashSet::new(),
            ai_files: HashSet::new(),
            ai_token: nonce(),
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
            board_open: false,
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
        self.resolver = self.path.as_ref().map(|p| Resolver::in_base(&dir_of(p), &home(), self.folder.as_deref()));
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
             {styles}\
             <link rel='stylesheet' href='{a}/overview.css'>\
             </head><body data-mode='{mode}'{sf}{flat}><main id='content'></main>{scripts}</body></html>",
            theme = theme::theme_css(&app.theme),
            styles = STYLES.iter().map(|s| format!("<link rel='stylesheet' href='{a}/viewer/{s}.css'>")).collect::<String>(),
            mode = app.theme.mode,
            sf = if app.sf_symbols { " data-sf" } else { "" },
            // (WebKit without its DMA-BUF renderer draws no backdrop-filter: the menus are then of a ground that
            // covers, not glass that only lets the text behind it through — viewer/page.css, main.rs)
            flat = if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_ok_and(|v| v != "0") { " data-flat" } else { "" },
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
        if self.path.is_none() && self.folder.is_none() {
            self.js("MdView.clear", &[]); // (nothing open yet: the page offers a folder and a file)
        }
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
        want.extend(self.board_dirs.iter().cloned());
        for gone in self.watched.difference(&want) {
            let _ = watcher.unwatch(gone);
        }
        for new in want.difference(&self.watched) {
            let _ = watcher.watch(new, RecursiveMode::NonRecursive);
        }
        self.watched = want;
    }

    fn on_fs(&mut self, app: &mut App, paths: &[PathBuf]) {
        // a whiteboard's file changed (drawn on elsewhere and brought here by a sync): the page shows its picture anew
        for p in paths.iter().filter(|p| is_board(p) && p.is_file()) {
            self.js("MdView.boardChanged", &[json!(s(p))]);
        }
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
        scan::shown(&folder); // (the base folder of its notes: where a picture one of them names is looked for)
        self.tree_json = None;
        self.title_cache.clear();
        self.quick = folder == resolve(&quick_dir(&app.prefs()));
        if !self.quick {
            // (the quick notes are not the folder a bare start goes back to)
            app.state.insert("folder".into(), json!(s(&folder)));
            app.save_state();
        }
        self.rescan(app);
        let notes: Vec<(String, bool)> = self.tree.as_ref().map(|t| t.notes().iter().map(|n| (n.real.clone(), n.pdf)).collect()).unwrap_or_default();
        let known = |p: &str| notes.iter().any(|(real, _)| real == p);
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
        // a folder opens on All Notes, in the folder itself (Henri, 2026-10-14) — not on the note last shown: its tabs as they
        // were, an empty one shown (the page shows All Notes in it). Only a note named at the start opens that note (above).
        match self.tabs.iter().position(|t| t.path.is_none()) {
            Some(i) => self.tab = i,
            None => {
                let tab = self.make_tab(None);
                self.tabs.push(tab);
                self.tab = self.tabs.len() - 1;
            }
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

    /// A picture, or any files, chosen in the system's own window to stand in the note (Insert ›
    /// Picture, File): what is chosen comes in as files dropped on the note do — kept where
    /// pasted files go, and put in at the caret.
    fn pick_attach(&self, app: &App, pictures: bool, note: &str) {
        let Some(window) = &self.window else { return };
        let mut dialog = app.handle.dialog().file().set_parent(window).set_title(if pictures { "Insert Picture" } else { "Insert File" });
        if pictures {
            dialog = dialog.add_filter("Pictures", scan::IMAGE_EXT);
        }
        let (tx, label, note) = (app.tx.clone(), self.label.clone(), note.to_string());
        dialog.pick_files(move |paths| {
            let uris: Vec<String> = paths.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).filter_map(|p| tauri::Url::from_file_path(p).ok()).map(|u| u.to_string()).collect();
            if !uris.is_empty() {
                let _ = tx.send(Event::Msg { label, json: json!({ "type": "dropfiles", "uris": uris, "path": note }).to_string() });
            }
        });
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
                } else if kind == "file" && m[0].starts_with('!') {
                    // (a file of text, shown in the note as the code it is)
                    if let Some(text) = embedded_text(&p) {
                        info["kind"] = json!("text");
                        info["text"] = json!(text);
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
            let p = scan::found(&resolve(Path::new(path)));
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

    /// A picture of the note, by its file, onto the clipboard.
    fn copy_image(&self, app: &App, src: &str) {
        match url_file(src) {
            None => self.toast("Only pictures in files can be copied"),
            Some((path, _)) => {
                if !host::copy_image_file(&app.handle, &scan::found(&path)) {
                    self.toast("Couldn't copy the picture");
                }
            }
        }
    }

    /// A note or PDF a link leads to, in a tab: a new one, or (own) the one the file has already.
    fn link_tab(&mut self, app: &mut App, p: &Path, fragment: Option<String>, own: bool) {
        let real = crate::scan::canon(p).unwrap_or_else(|_| p.to_path_buf());
        let there = self.tabs.iter().enumerate().position(|(k, t)| own && k != self.tab && t.path.as_ref() == Some(&real));
        match there {
            Some(there) => {
                self.stash_tab();
                self.show_tab(app, there, fragment);
            }
            None => self.new_tab(app, Some(p), fragment, None),
        }
    }

    fn handle_link(&mut self, app: &mut App, href: &str, tab: bool, own: bool) {
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
        if !p.exists() {
            p = scan::found(&p); // (a file kept in the base folder's assets, named from a subfolder)
        }
        let tab = tab && !self.tabs.is_empty();
        if self.path.as_ref() == Some(&p) && (!tab || own) {
            if let Some(frag) = frag {
                self.js("MdView.scrollToFragment", &[json!(frag), json!(true)]);
            }
            return;
        }
        if !p.exists() {
            self.toast(format!("Not found: {}", name_of(&p)));
        } else if p.is_file() && (is_md(&p) || is_pdf(&p)) {
            if tab {
                self.link_tab(app, &p, frag, own);
            } else {
                self.open_path(app, &p, frag, true);
            }
        } else {
            host::launch_path(&p);
        }
    }

    fn open_wikilink(&mut self, app: &mut App, target: &str, tab: bool, own: bool) {
        let heading = target.split_once('#').map(|(_, h)| h.to_string());
        let Some(p) = self.resolver.as_mut().and_then(|r| r.resolve(target)) else {
            return self.toast(format!("Note “{}” doesn't exist", target.split('#').next().unwrap_or("")));
        };
        if !matches!(file_kind(&p), "md" | "pdf") {
            host::launch_path(&p);
        } else if tab && !self.tabs.is_empty() && !(own && self.path.as_ref() == Some(&p)) {
            self.link_tab(app, &p, heading, own);
        } else {
            self.open_path(app, &p, heading, true);
        }
    }

    fn toggle_task(&mut self, app: &mut App, line: i64, checked: bool) {
        let Some(path) = self.path.clone().filter(|_| line >= 0) else { return };
        // (a note that is only read — not UTF-8, too large, not to be written: its text read as
        // UTF-8 and written back would not be the file any more)
        if let Some(why) = fs::read(&path).ok().and_then(|raw| readonly_reason(&path, Some(&raw))) {
            self.toast(format!("Can't edit: {why}"));
            return self.render(app, true, None, false);
        }
        let Ok(text) = read_text(&path, None) else { return };
        let mut lines: Vec<String> = text.split('\n').map(String::from).collect();
        let Some(old) = lines.get(line as usize).cloned() else { return };
        let Some(m) = TASK_RE.captures(&old) else {
            return self.render(app, true, None, false);
        };
        lines[line as usize] = format!("{}{}{}", &m[1], if checked { "x" } else { " " }, &old[m.get(2).unwrap().end()..]);
        if let Err(e) = write_whole(&path, lines.join("\n").as_bytes()) {
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
            match write_whole(&path, text.as_bytes()) {
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
        // (Written whole — write_whole: a link is followed, the permissions stay.) Line endings are kept.
        let crlf = old.windows(2).any(|w| w == b"\r\n");
        let data = if crlf { text.replace('\n', "\r\n").into_bytes() } else { text.as_bytes().to_vec() };
        if data != old {
            if let Err(e) = write_whole(&path, &data) {
                return self.js("MdView.saveFailed", &[json!(strerror(&e))]);
            }
        }
        self.own_text = Some(text.to_string());
    }

    // -- pasted images ----------------------------------------------------

    /// From a file's menu in the sidebar: open it in its default application, in one chosen
    /// from the system's list, or show it in the file manager.

    fn file_op(&self, op: &str, path: &str) {
        let p = Path::new(path);
        let inside = !path.is_empty() && self.folder.as_ref().is_some_and(|f| p.is_dir() && resolve(p).starts_with(f));
        if path.is_empty() || !(self.knows(path) || (op == "reveal" && inside)) {
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
        if (self.editing || self.board_open) && self.shell_ready && !self.closing {
            self.closing = true;
            self.js("MdView.flush", &[json!(true)]);
            self.close_turn += 1;
            return app.after(1500, Event::CloseNow { label: self.label.clone(), turn: self.close_turn });
        }
        self.close_turn += 1;
        self.settle_quick(); // (a quick note left by closing: named, or gone if nothing is in it)
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
