//! What is read off the disk without a window: a folder's notes as a tree, a note's title,
//! where a wikilink points, the links to a PDF.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
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
const SKIP_DIRS: &[&str] = &["node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"];
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
    path.to_string_lossy().into_owned()
}

/// The path made absolute, links followed where the file exists.
pub fn resolve(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf()))
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
    pub opened: i64,
}

#[derive(Serialize, Clone)]
pub struct Node {
    pub name: String,
    pub path: String,
    pub dirs: Vec<Node>,
    pub notes: Vec<Note>,
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
    show: &'a HashSet<&'static str>,
    walked: Vec<PathBuf>,
    count: usize,
    deadline: Instant,
}

impl Scan<'_> {
    fn walk(&mut self, d: &Path, depth: usize) -> Node {
        let mut node = Node {
            name: d.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            path: s(d),
            dirs: vec![],
            notes: vec![],
        };
        self.walked.push(d.to_path_buf());
        let Ok(read) = fs::read_dir(d) else { return node };
        let mut entries: Vec<(String, fs::DirEntry)> =
            read.flatten().map(|e| (e.file_name().to_string_lossy().into_owned(), e)).collect();
        entries.sort_by(|a, b| natural_cmp(&a.0, &b.0));
        for (name, e) in entries {
            if name.starts_with('.') {
                continue;
            }
            let path = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if SKIP_DIRS.contains(&name.as_str()) || depth >= 12 || self.count >= NOTE_LIMIT || Instant::now() > self.deadline {
                    continue;
                }
                let sub = self.walk(&path, depth + 1);
                // (keep: folders made here, still empty)
                if !sub.dirs.is_empty() || !sub.notes.is_empty() || self.keep.contains(&s(&path)) {
                    node.dirs.push(sub);
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
            let real = s(&fs::canonicalize(&path).unwrap_or_else(|_| path.clone()));
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
                    opened: 0,
                });
                self.count += 1;
            } else {
                // what the settings ask for beside the notes — with its ending, to tell it
                // from a note. (PDFs open in the window; the rest in its own application.)
                let kind = file_kind(&path);
                let group = match kind {
                    "pdf" => "pdf",
                    "image" => "image",
                    "audio" | "video" => "media",
                    _ => "other",
                };
                if self.show.contains(group) {
                    node.notes.push(Note { name, path: s(&path), real, title: None, mtime: None, pdf: true, kind: Some(kind), opened: 0 });
                    self.count += 1;
                }
            }
        }
        node
    }
}

/// The notes below root as a tree, plus every directory walked (to watch).
/// Hidden entries and SKIP_DIRS are left out, as are folders without notes.
/// Titles are only read when asked for.
pub fn scan_folder(root: &Path, cache: &mut TitleCache, titles: bool, keep: &HashSet<String>, show: &HashSet<&'static str>) -> (Node, Vec<PathBuf>) {
    let mut scan = Scan { cache, titles, keep, show, walked: vec![], count: 0, deadline: Instant::now() + Duration::from_millis(1500) };
    let tree = scan.walk(root, 0);
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

/// Resolves Obsidian wikilink targets like Obsidian does: next to the note, at the vault
/// root, then anywhere below the root by file name. The root is the nearest ancestor holding
/// .obsidian, else the note's dir.
pub struct Resolver {
    pub note_dir: PathBuf,
    pub vault: Option<PathBuf>,
    index: Option<HashMap<String, Vec<String>>>,
}

impl Resolver {
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
        Resolver { note_dir: note_dir.to_path_buf(), vault, index: None }
    }

    fn index(&mut self) -> &HashMap<String, Vec<String>> {
        if self.index.is_none() {
            let mut idx: HashMap<String, Vec<String>> = HashMap::new();
            let mut count = 0usize;
            let deadline = Instant::now() + Duration::from_millis(300);
            let root = self.vault.clone().unwrap_or_else(|| self.note_dir.clone());
            walk_files(&root, |dir, files| {
                for f in files {
                    idx.entry(f.to_lowercase()).or_default().push(s(&dir.join(f)));
                }
                count += files.len();
                count <= 60000 && Instant::now() <= deadline
            });
            self.index = Some(idx);
        }
        self.index.as_ref().unwrap()
    }

    pub fn resolve(&mut self, target: &str) -> Option<PathBuf> {
        let name = target.split(['#', '^']).next().unwrap_or("").trim();
        if name.is_empty() {
            return None;
        }
        let cands: Vec<String> = if is_md(Path::new(name)) { vec![name.to_string()] } else { vec![format!("{name}.md"), name.to_string()] };
        let mut bases = vec![self.note_dir.clone()];
        bases.extend(self.vault.clone());
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
