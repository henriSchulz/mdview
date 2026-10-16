//! What is read off the disk without a window: a folder's notes as a tree, a note's title,
//! where a wikilink points, the links to a PDF.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use regex::Regex;
use serde::Serialize;

pub const MD_EXT: &[&str] = &["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];
const IMG_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];
const AUDIO_EXT: &[&str] = &["mp3", "wav", "ogg", "m4a", "flac", "opus", "webm"];
const VIDEO_EXT: &[&str] = &["mp4", "mkv", "mov", "ogv"];
/// pictures that may be dropped on a note
pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"];
pub const SKIP_DIRS: &[&str] = &["node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"];
const TITLE_SCAN: usize = 16 * 1024; // a note's title (first H1) is looked for this far in
const NOTE_LIMIT: usize = 5000; // notes listed in the sidebar at most

static FENCE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(`{3,}|~{3,})(.*)$").unwrap());
static H1_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$").unwrap());
static TITLE_WIKI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]").unwrap());
static TITLE_LINK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").unwrap());
static TITLE_MARK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(\*\*|__|~~|==|[*`])").unwrap());
static NAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[/\\\x00-\x1f]").unwrap());
static PDF_LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)!?\[\[([^\]\[|#]+\.pdf)(?:#([^\]\[|]*))?(?:\|[^\]\[]*)?\]\]|\]\(<?([^)\s#>]+\.pdf)(?:#([^)\s>]*))?>?\)").unwrap()
});
static SHOWN_WIKI_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s*!?\[\[[^\]]*\]\]").unwrap());
static SHOWN_LEAD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?:>\s*)*(?:\[![^\]]*\]\s*)?").unwrap());
static QUOTE_LEAD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\s*(?:>\s*)*").unwrap());

/// what urllib's quote leaves as it is
const QUOTE: &AsciiSet = &NON_ALPHANUMERIC.remove(b'_').remove(b'.').remove(b'-').remove(b'~').remove(b'/');

pub fn quote(s: &str) -> String {
    utf8_percent_encode(s, QUOTE).to_string()
}

pub fn unquote(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

pub fn ext_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

pub fn is_md(path: &Path) -> bool {
    MD_EXT.contains(&ext_of(path).as_str())
}

pub fn is_pdf(path: &Path) -> bool {
    ext_of(path) == "pdf"
}

/// A whiteboard's file, by its name (board/format.js).
pub fn is_board(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().ends_with(".board.svg"))
}

pub fn file_kind(path: &Path) -> &'static str {
    let ext = ext_of(path);
    let ext = ext.as_str();
    if MD_EXT.contains(&ext) {
        "md"
    } else if IMG_EXT.contains(&ext) {
        "image"
    } else if AUDIO_EXT.contains(&ext) {
        "audio"
    } else if VIDEO_EXT.contains(&ext) {
        "video"
    } else if ext == "pdf" {
        "pdf"
    } else {
        "file"
    }
}

pub fn s(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    // (the page takes paths apart at "/" — a note's name, its folder, a folder's place under the
    // window's. Windows reads "/" as it reads "\\": the page is given the one it knows.)
    if cfg!(windows) {
        return text.replace('\\', "/");
    }
    text
}

/// The one folder of a base folder that holds what is put into its notes (shell/files.rs).
pub const ASSETS: &str = "assets";
/// The folders the windows show: each the base folder of its notes, though nothing in it says so.
static SHOWN: LazyLock<std::sync::Mutex<HashSet<PathBuf>>> = LazyLock::new(Default::default);
pub fn shown(folder: &Path) {
    SHOWN.lock().unwrap().insert(folder.to_path_buf());
}

/// The base folder a path lies in, as far as can be told without its window (shell/files.rs,
/// base_of): the project's root, else the folder a window shows, else a repository's or a vault's.
fn top_of(path: &Path) -> Option<PathBuf> {
    if let crate::history::Place::Project(root) = crate::history::place_of(path) {
        return Some(root);
    }
    let shown = SHOWN.lock().unwrap();
    let above = || path.ancestors().skip(1).take(32);
    above().find(|d| shown.contains(*d)).or_else(|| above().find(|d| d.join(".git").exists() || d.join(".obsidian").is_dir())).map(Path::to_path_buf)
}

/// The file a note names, where it is: where the link says — else, by its name, in the `assets`
/// of a folder above, up to the base folder's (a note of a subfolder names what lies there as
/// `assets/x.png`, and goes on naming it so wherever it is moved), and last in an `assets`
/// anywhere in the base folder (a note moved away from pictures that were kept beside it, before
/// there was one place for them). Nothing found: the path as it came.
pub fn found(path: &Path) -> PathBuf {
    if path.is_file() {
        return path.to_path_buf();
    }
    let (Some(name), Some(top)) = (path.file_name(), top_of(path)) else { return path.to_path_buf() };
    for dir in path.ancestors().skip(1).take_while(|d| d.starts_with(&top)) {
        let there = dir.join(ASSETS).join(name);
        if there != path && there.is_file() {
            return there;
        }
    }
    // (the one nearest the top; of two as near, the first by name — the same one every time)
    let (name, deadline) = (name.to_string_lossy().into_owned(), Instant::now() + Duration::from_millis(200));
    let mut hits: Vec<PathBuf> = vec![];
    walk_files(&top, |dir, files| {
        if dir.file_name().is_some_and(|d| d == ASSETS) && files.contains(&name) {
            hits.push(dir.join(&name));
        }
        Instant::now() <= deadline
    });
    hits.into_iter().min_by_key(|h| (h.components().count(), h.clone())).unwrap_or_else(|| path.to_path_buf())
}

/// The path made absolute, links followed where the file exists.
pub fn resolve(path: &Path) -> PathBuf {
    canon(path).unwrap_or_else(|_| std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf()))
}

/// The path as the system has it, links followed. On Windows the system answers in its long
/// form (\\?\C:\…), from which no address of a file can be made (a picture beside a note, a
/// link to another one): the plain form of the same path is what is passed on.
pub fn canon(path: impl AsRef<Path>) -> std::io::Result<PathBuf> {
    let p = fs::canonicalize(path)?;
    #[cfg(windows)]
    {
        let text = p.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{rest}")));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(rest));
        }
    }
    Ok(p)
}

pub fn read_bytes(path: &Path, limit: Option<usize>) -> std::io::Result<Vec<u8>> {
    let mut f = fs::File::open(path)?;
    let mut raw = Vec::new();
    match limit {
        Some(n) => {
            f.take(n as u64).read_to_end(&mut raw)?;
        }
        None => {
            f.read_to_end(&mut raw)?;
        }
    }
    Ok(raw)
}

pub fn read_text(path: &Path, limit: Option<usize>) -> std::io::Result<String> {
    Ok(String::from_utf8_lossy(&read_bytes(path, limit)?).into_owned())
}

/// First H1 of a note (frontmatter and code blocks skipped), or None.
pub fn note_title(path: &Path) -> Option<String> {
    let text = read_text(path, Some(TITLE_SCAN)).ok()?;
    let lines: Vec<&str> = text.lines().collect();
    let mut start = 0;
    if lines.first().is_some_and(|l| l.trim() == "---") {
        if let Some(i) = (1..lines.len()).find(|&i| matches!(lines[i].trim(), "---" | "...")) {
            start = i + 1;
        }
    }
    let mut fence: Option<String> = None;
    for line in &lines[start.min(lines.len())..] {
        let m = FENCE_RE.captures(line);
        if let Some(open) = &fence {
            if let Some(m) = &m {
                if m[1].chars().next() == open.chars().next() && m[1].len() >= open.len() && m[2].trim().is_empty() {
                    fence = None;
                }
            }
            continue;
        }
        if let Some(m) = m {
            fence = Some(m[1].to_string());
            continue;
        }
        if let Some(m) = H1_RE.captures(line) {
            let t = TITLE_WIKI_RE.replace_all(&m[1], "$1");
            let t = TITLE_LINK_RE.replace_all(&t, "$1");
            let t = TITLE_MARK_RE.replace_all(&t, "");
            let t = t.trim();
            return (!t.is_empty()).then(|| t.to_string());
        }
    }
    None
}

/// A typed note name as a safe file name stem part (no path, not hidden).
pub fn clean_name(name: &str) -> String {
    NAME_RE.replace_all(name, " ").trim().trim_start_matches(['.', ' ']).to_string()
}

/// "note 2" before "note 10": digits compared as numbers, the rest without case.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    fn parts(s: &str) -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.to_lowercase().chars() {
            let digit = c.is_ascii_digit();
            match out.last_mut() {
                Some((d, run)) if *d == digit => run.push(c),
                _ => out.push((digit, c.to_string())),
            }
        }
        out
    }
    let (a, b) = (parts(a), parts(b));
    for (x, y) in a.iter().zip(b.iter()) {
        let o = match (x.0, y.0) {
            (true, true) => {
                let (m, n) = (x.1.trim_start_matches('0'), y.1.trim_start_matches('0'));
                m.len().cmp(&n.len()).then_with(|| m.cmp(n))
            }
            (true, false) => Ordering::Less, // (a name starting with a number comes first)
            (false, true) => Ordering::Greater,
            (false, false) => x.1.cmp(&y.1),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    a.len().cmp(&b.len())
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Clone)]
pub struct Note {
    pub name: String,
    pub path: String,
    pub real: String,
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<i64>,
    #[serde(skip_serializing_if = "is_false")]
    pub pdf: bool, // (anything that is not a note)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<&'static str>,
    #[serde(skip_serializing_if = "is_false")]
    pub hidden: bool, // (put away — by hand, by its name, as something the application keeps for a note: listed only where that is asked for)
    pub opened: i64,
}

#[derive(Serialize, Clone)]
pub struct Node {
    pub name: String,
    pub path: String,
    pub dirs: Vec<Node>,
    pub notes: Vec<Note>,
    #[serde(skip_serializing_if = "is_false")]
    pub hidden: bool,
}

impl Node {
    pub fn notes(&self) -> Vec<&Note> {
        let mut out: Vec<&Note> = self.notes.iter().collect();
        for d in &self.dirs {
            out.extend(d.notes());
        }
        out
    }

    pub fn each_note(&mut self, f: &mut dyn FnMut(&mut Note)) {
        self.notes.iter_mut().for_each(&mut *f);
        for d in &mut self.dirs {
            d.each_note(f);
        }
    }
}

/// path -> (mtime in ns, size, title)
pub type TitleCache = HashMap<String, (u128, u64, Option<String>)>;

struct Scan<'a> {
    cache: &'a mut TitleCache,
    titles: bool,
    keep: &'a HashSet<String>,
    put_away: &'a HashSet<String>,
    all: bool,
    walked: Vec<PathBuf>,
    count: usize,
    deadline: Instant,
}

impl Scan<'_> {
    /// → the folder, and whether something in it was left out (a folder left with nothing for
    /// that is no empty folder).
    fn walk(&mut self, d: &Path, depth: usize, hidden: bool) -> (Node, bool) {
        let mut node = Node {
            name: d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            path: s(d),
            dirs: vec![],
            notes: vec![],
            hidden,
        };
        let mut left_out = false;
        self.walked.push(d.to_path_buf());
        let Ok(read) = fs::read_dir(d) else { return (node, left_out) };
        let mut entries: Vec<(String, fs::DirEntry)> =
            read.flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), e)).collect();
        entries.sort_by(|a, b| natural_cmp(&a.0, &b.0));
        for (name, e) in entries {
            let path = e.path();
            let Ok(ft) = e.file_type() else { continue };
            // put away: what begins with a dot, what is built and not written, what was hidden by hand
            // or is kept for a note — and everything in a folder that is
            let heavy = ft.is_dir() && (SKIP_DIRS.contains(&name.as_str()) || name == ".git");
            let away = hidden || heavy || name.starts_with('.') || self.put_away.contains(&s(&path));
            if away && !self.all {
                left_out = true;
                continue;
            }
            if ft.is_dir() {
                if depth >= 12 || self.count >= NOTE_LIMIT || Instant::now() > self.deadline {
                    continue;
                }
                if heavy {
                    // (shown as it is asked for, but not gone into: thousands of files nobody wrote)
                    node.dirs.push(Node { name, path: s(&path), dirs: vec![], notes: vec![], hidden: true });
                    continue;
                }
                let (sub, less) = self.walk(&path, depth + 1, away);
                // (a folder with nothing but what is put away is put away with it; keep: folders made here, still empty)
                if !sub.dirs.is_empty() || !sub.notes.is_empty() || !less || self.keep.contains(&s(&path)) {
                    node.dirs.push(sub);
                } else {
                    left_out = true;
                }
                continue;
            }
            if self.count >= NOTE_LIMIT {
                continue;
            }
            let Ok(st) = fs::metadata(&path) else { continue };
            if !st.is_file() {
                continue;
            }
            let real = s(&canon(&path).unwrap_or_else(|_| path.clone()));
            if is_md(&path) {
                let since = st.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).unwrap_or_default();
                let mut title = None;
                if self.titles {
                    let key = (since.as_nanos(), st.len());
                    let hit = self.cache.get(&s(&path)).filter(|h| (h.0, h.1) == key).map(|h| h.2.clone());
                    title = hit.unwrap_or_else(|| {
                        let t = note_title(&path);
                        self.cache.insert(s(&path), (key.0, key.1, t.clone()));
                        t
                    });
                }
                node.notes.push(Note {
                    name: path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    path: s(&path),
                    real,
                    title,
                    mtime: Some(since.as_secs() as i64),
                    pdf: false,
                    kind: None,
                    hidden: away,
                    opened: 0,
                });
            } else {
                // everything else that lies there — with its ending, to tell it from a note; the
                // page lists the kinds it is set to. (PDFs and whiteboards open in the window, the
                // rest in its own application.)
                let kind = if is_board(&path) { "board" } else { file_kind(&path) };
                // (a whiteboard by its name alone: its sign says what it is)
                let name = if kind == "board" { name[..name.len() - ".board.svg".len()].to_string() } else { name };
                node.notes.push(Note { name, path: s(&path), real, title: None, mtime: None, pdf: true, kind: Some(kind), hidden: away, opened: 0 });
            }
            self.count += 1;
        }
        (node, left_out)
    }
}

/// The notes below root as a tree, plus every directory walked (to watch).
/// Everything that lies there is listed but what is put away: names with a dot before them,
/// SKIP_DIRS, and the paths in `put_away` (hidden by hand, kept for a note by the application).
/// all: these too, marked as hidden. Titles are only read when asked for.
pub fn scan_folder(root: &Path, cache: &mut TitleCache, titles: bool, keep: &HashSet<String>, put_away: &HashSet<String>, all: bool) -> (Node, Vec<PathBuf>) {
    let mut scan = Scan { cache, titles, keep, put_away, all, walked: vec![], count: 0, deadline: Instant::now() + Duration::from_millis(1500) };
    let (tree, _) = scan.walk(root, 0, false);
    (tree, scan.walked)
}

/// The directories below root (hidden ones and SKIP_DIRS left out, links to directories not
/// followed) with the names of their files; `each` says whether to go on.
fn walk_files(root: &Path, mut each: impl FnMut(&Path, &[String]) -> bool) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        let (mut files, mut dirs) = (vec![], vec![]);
        for e in read.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if !name.starts_with('.') && !SKIP_DIRS.contains(&name.as_str()) {
                    dirs.push(e.path());
                }
            } else if !(ft.is_symlink() && e.path().is_dir()) {
                files.push(name);
            }
        }
        if !each(&dir, &files) {
            return;
        }
        dirs.sort();
        stack.extend(dirs.into_iter().rev());
    }
}

#[derive(Serialize)]
pub struct Backlink {
    pub path: String,
    pub name: String,
    pub line: usize,
    pub frag: String,
    pub text: String,
}

/// The links to this PDF in the notes below root — what the PDF viewer shows as highlights
/// (a link to a selection is the annotation).
pub fn pdf_backlinks(pdf: &Path, root: &Path) -> Vec<Backlink> {
    let file_name = pdf.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let name = file_name.to_lowercase();
    let quoted = quote(&file_name).to_lowercase();
    let deadline = Instant::now() + Duration::from_millis(1500);
    let mut out: Vec<Backlink> = Vec::new();
    let mut seen = 0usize;
    let mut full = false;
    let mut todo: Vec<(PathBuf, String)> = Vec::new();
    walk_files(root, |dir, files| {
        for f in files {
            if is_md(Path::new(f)) {
                todo.push((dir.join(f), f.clone()));
            }
        }
        todo.len() <= 5000 && Instant::now() <= deadline
    });
    for (p, f) in todo {
        seen += 1;
        if seen > 5000 || Instant::now() > deadline || out.len() >= 2000 || full {
            break;
        }
        let Ok(text) = read_text(&p, Some(2_000_000)) else { continue };
        let lower = text.to_lowercase();
        if !lower.contains(&name) && !lower.contains(&quoted) {
            continue;
        }
        let lines: Vec<&str> = text.split('\n').collect();
        for (n, line) in lines.iter().enumerate() {
            for m in PDF_LINK_RE.captures_iter(line) {
                let (target, frag) = match m.get(1) {
                    Some(t) => (t.as_str().to_string(), m.get(2).map(|x| x.as_str().to_string()).unwrap_or_default()),
                    None => (unquote(&m[3]), unquote(m.get(4).map_or("", |x| x.as_str()))),
                };
                let target_name = Path::new(target.trim()).file_name().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                if target_name != name || frag.is_empty() {
                    continue;
                }
                let shown = SHOWN_WIKI_RE.replace_all(line, "");
                let mut shown = SHOWN_LEAD_RE.replace(&shown, "").trim().to_string();
                if shown.is_empty() {
                    // the quote of a callout stands in the line below its link
                    let next = lines.get(n + 1).copied().unwrap_or("");
                    shown = QUOTE_LEAD_RE.replace(next, "").trim().to_string();
                }
                out.push(Backlink { path: s(&p), name: f.clone(), line: n, frag, text: shown.chars().take(240).collect() });
                full = out.len() >= 2000;
            }
        }
    }
    out
}

/// The indexes of folders' files that were made lately (Resolver::index): by root, with when.
static INDEXES: Mutex<Option<HashMap<PathBuf, (Instant, Arc<HashMap<String, Vec<String>>>)>>> = Mutex::new(None);

/// Resolves Obsidian wikilink targets like Obsidian does: next to the note, at the vault
/// root, then anywhere below the root by file name. The root is the nearest ancestor holding
/// .obsidian, else the note's dir.
pub struct Resolver {
    pub note_dir: PathBuf,
    pub vault: Option<PathBuf>,
    /// The top of the folder window the note is in, where it is above the note and no vault is: searched like a vault is (it is none).
    base: Option<PathBuf>,
    index: Option<Arc<HashMap<String, Vec<String>>>>,
    /// … and whether it was one made before (a file made since is not in it).
    cached: bool,
}

impl Resolver {
    /// … for a note in a folder window: with no .obsidian above it, the folder window's own top is the root
    /// (a note of a subfolder names a note or a PDF of another subfolder just as well).
    pub fn in_base(note_dir: &Path, home: &Path, base: Option<&Path>) -> Self {
        let mut r = Resolver::new(note_dir, home);
        r.base = base.filter(|b| r.vault.is_none() && note_dir.starts_with(b)).map(Path::to_path_buf);
        r
    }

    pub fn new(note_dir: &Path, home: &Path) -> Self {
        let mut vault = None;
        for p in note_dir.ancestors() {
            if p.join(".obsidian").is_dir() {
                vault = Some(p.to_path_buf());
                break;
            }
            if p == home {
                break;
            }
        }
        Resolver { note_dir: note_dir.to_path_buf(), vault, base: None, index: None, cached: false }
    }

    /// The files below the root by their lower-case names. Kept for a few seconds, for the next note opened and the next link
    /// written: every note has its own resolver, and a folder of thousands of files is no walk to make at each of them — nor
    /// one to cut short at the first 300 ms of a cold disk (a link to a file that was there was then "not a note").
    fn index(&mut self) -> &HashMap<String, Vec<String>> {
        if self.index.is_none() {
            let root = self.vault.clone().or_else(|| self.base.clone()).unwrap_or_else(|| self.note_dir.clone());
            let mut kept = INDEXES.lock().unwrap();
            let kept = kept.get_or_insert_with(HashMap::new);
            let fresh = kept.get(&root).filter(|(at, _)| at.elapsed() < Duration::from_secs(8)).map(|(_, idx)| idx.clone());
            self.cached = fresh.is_some();
            let idx = fresh.unwrap_or_else(|| {
                let mut idx: HashMap<String, Vec<String>> = HashMap::new();
                let mut count = 0usize;
                let deadline = Instant::now() + Duration::from_millis(2500);
                walk_files(&root, |dir, files| {
                    for f in files {
                        idx.entry(f.to_lowercase()).or_default().push(s(&dir.join(f)));
                    }
                    count += files.len();
                    count <= 200_000 && Instant::now() <= deadline
                });
                let idx = Arc::new(idx);
                if kept.len() > 16 {
                    kept.clear();
                }
                kept.insert(root, (Instant::now(), idx.clone()));
                idx
            });
            self.index = Some(idx);
        }
        self.index.as_ref().unwrap()
    }

    /// Where a link points. Found in none: if the files were last looked at some time ago, they are looked at again first.
    pub fn resolve(&mut self, target: &str) -> Option<PathBuf> {
        let found = self.look_for(target);
        if found.is_none() && self.cached {
            let root = self.vault.clone().or_else(|| self.base.clone()).unwrap_or_else(|| self.note_dir.clone());
            if let Some(kept) = INDEXES.lock().unwrap().as_mut() {
                kept.remove(&root);
            }
            self.index = None;
            return self.look_for(target);
        }
        found
    }

    fn look_for(&mut self, target: &str) -> Option<PathBuf> {
        let name = target.split(['#', '^']).next().unwrap_or("").trim();
        if name.is_empty() {
            return None;
        }
        let cands: Vec<String> = if is_md(Path::new(name)) { vec![name.to_string()] } else { vec![format!("{name}.md"), name.to_string()] };
        let mut bases = vec![self.note_dir.clone()];
        bases.extend(self.vault.clone().or_else(|| self.base.clone()));
        for c in &cands {
            for b in &bases {
                let p = b.join(c);
                if p.is_file() {
                    return Some(resolve(&p));
                }
            }
        }
        let here = s(&self.note_dir);
        let idx = self.index();
        for c in &cands {
            let file = Path::new(c).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            let Some(hits) = idx.get(&file) else { continue };
            let mut hits: Vec<&String> = hits.iter().collect();
            if c.contains('/') {
                let tail = format!("/{}", c.to_lowercase());
                let narrowed: Vec<&String> = hits.iter().copied().filter(|h| h.to_lowercase().ends_with(&tail)).collect();
                if !narrowed.is_empty() {
                    hits = narrowed;
                }
            }
            let best = hits.into_iter().min_by_key(|h| (!h.starts_with(&here), h.matches(std::path::MAIN_SEPARATOR).count(), h.to_string()))?;
            return Some(PathBuf::from(best));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(n: &Node) -> Vec<String> {
        let mut out: Vec<String> = n.notes.iter().map(|x| format!("{}{}", x.name, if x.hidden { "*" } else { "" })).collect();
        for d in &n.dirs {
            out.push(format!("{}/{}", d.name, if d.hidden { "*" } else { "" }));
            out.extend(names(d).into_iter().map(|x| format!("{}/{x}", d.name)));
        }
        out
    }

    #[test]
    fn a_file_a_note_names_is_found_in_the_base_folders_assets() {
        let d = std::env::temp_dir().join(format!("mdview-found-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        for dir in ["assets", "Sub/Deep", "Old/assets", "Other"] {
            fs::create_dir_all(d.join(dir)).unwrap();
        }
        // (no window shows the folder, and nothing in it says where its top is: only where the link says)
        fs::write(d.join("assets/one.png"), "").unwrap();
        assert_eq!(found(&d.join("Sub/assets/one.png")), d.join("Sub/assets/one.png"));
        shown(&d);
        for f in ["assets/one.png", "Old/assets/kept.png", "Old/assets/one.png", "Sub/beside.png"] {
            fs::write(d.join(f), f).unwrap();
        }
        // where the link says, when it is there: a folder's own assets go before the base folder's
        assert_eq!(found(&d.join("Old/assets/one.png")), d.join("Old/assets/one.png"));
        assert_eq!(found(&d.join("Sub/beside.png")), d.join("Sub/beside.png"));
        // a note of a subfolder, however deep, names what is in the base folder's assets
        assert_eq!(found(&d.join("Sub/assets/one.png")), d.join("assets/one.png"));
        assert_eq!(found(&d.join("Sub/Deep/assets/one.png")), d.join("assets/one.png"));
        // a note moved away from the pictures kept beside it: found where they stayed
        assert_eq!(found(&d.join("Other/assets/kept.png")), d.join("Old/assets/kept.png"));
        assert_eq!(found(&d.join("assets/kept.png")), d.join("Old/assets/kept.png"));
        // nothing of that name: the path as it came — and nothing from above the folder's top
        assert_eq!(found(&d.join("Sub/assets/none.png")), d.join("Sub/assets/none.png"));
        // (a project is a base folder of its own, in whatever folder it lies)
        let inner = d.join("Sub/Deep");
        fs::create_dir_all(inner.join(".git")).unwrap();
        fs::create_dir_all(inner.join(".mdview")).unwrap();
        fs::write(inner.join(".mdview/project.json"), "{}").unwrap();
        assert_eq!(found(&inner.join("assets/one.png")), inner.join("assets/one.png"));
        fs::create_dir_all(inner.join("assets")).unwrap();
        fs::write(inner.join("assets/own.png"), "").unwrap();
        assert_eq!(found(&inner.join("Below/assets/own.png")), inner.join("assets/own.png"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn a_note_of_a_subfolder_names_a_note_or_a_pdf_of_another_subfolder() {
        let d = std::env::temp_dir().join(format!("mdview-resolve-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        for dir in ["a", "b/deep", "c"] {
            fs::create_dir_all(d.join(dir)).unwrap();
        }
        for f in ["a/x.md", "b/deep/Other note.md", "c/paper.pdf", "top.md"] {
            fs::write(d.join(f), "").unwrap();
        }
        let home = std::env::temp_dir();
        // (the folder window's top is the root: the note's own folder alone is not where the others are)
        let mut r = Resolver::in_base(&d.join("a"), &home, Some(&d));
        assert_eq!(r.resolve("Other note"), Some(d.join("b/deep/Other note.md")));
        assert_eq!(r.resolve("paper.pdf"), Some(d.join("c/paper.pdf")));
        assert_eq!(r.resolve("top"), Some(d.join("top.md")));
        assert_eq!(r.resolve("none"), None);
        // a file made since the files were last looked at is found all the same (a link written the moment its note was made)
        fs::write(d.join("c/new note.md"), "").unwrap();
        assert_eq!(Resolver::in_base(&d.join("a"), &home, Some(&d)).resolve("new note"), Some(d.join("c/new note.md")));
        // a base that is not above the note changes nothing
        assert_eq!(Resolver::in_base(&d.join("a"), &home, Some(&d.join("c"))).resolve("top"), None);
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn a_folder_lists_everything_but_what_is_put_away() {
        let d = std::env::temp_dir().join(format!("mdview-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        for dir in ["assets", "empty", "node_modules/x", ".git", "sub"] {
            fs::create_dir_all(d.join(dir)).unwrap();
        }
        for f in ["a.md", "b.pdf", "c.board.svg", ".env", "assets/kept.png", "sub/s.txt", "sub/away.zip", "node_modules/x/i.js"] {
            fs::write(d.join(f), "x").unwrap();
        }
        let put_away: HashSet<String> = [s(&d.join("assets/kept.png")), s(&d.join("sub/away.zip"))].into();
        let (mut cache, keep) = (TitleCache::new(), HashSet::new());
        let (tree, _) = scan_folder(&d, &mut cache, false, &keep, &put_away, false);
        // (a folder left with nothing because all in it is put away goes with it; one that is empty stays)
        assert_eq!(names(&tree), ["a", "b.pdf", "c", "empty/", "sub/", "sub/s.txt"]);
        assert_eq!(tree.notes.iter().map(|n| n.kind.unwrap_or("md")).collect::<Vec<_>>(), ["md", "pdf", "board"]);
        let (tree, _) = scan_folder(&d, &mut cache, false, &keep, &put_away, true);
        // (all: these too, marked — what is built and a repository's own folder are named, not gone into)
        assert_eq!(names(&tree), [".env*", "a", "b.pdf", "c", ".git/*", "assets/", "assets/kept.png*", "empty/", "node_modules/*", "sub/", "sub/away.zip*", "sub/s.txt"]);
        let _ = fs::remove_dir_all(&d);
    }
}
