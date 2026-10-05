//! A folder's history: a project is a folder that holds both the app's marker
//! (.mdview/project.json) and a Git repository. What changes in it is kept as commits, each
//! naming the device it was made on. A repository without the marker is someone else's: it is
//! read (versions, their text), never written to.
//!
//! Nothing here knows of windows. The shell asks through the Historian, whose thread does the
//! work: a snapshot of a large folder never holds up a window.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use std::sync::mpsc::{channel, Sender};

use git2::{ErrorCode, IndexAddOption, Oid, Repository, RepositoryInitOptions, RepositoryState, Signature, Sort};
use serde_json::{json, Value};

use crate::Event;

const MARKER: &str = ".mdview/project.json";
const IGNORE: &str = ".DS_Store\nThumbs.db\n"; // what a new project leaves out (only where no .gitignore is)
const BIG: u64 = 50 * 1024 * 1024; // a file larger than this is not taken into the history
const NAMED: usize = 3; // changed files a commit's subject names
const LOG_LIMIT: usize = 500; // versions of one file listed
const SKIP_DIRS: &[&str] = &["node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"]; // (as the folder scan)
const NEST_DEPTH: usize = 12; // how deep below a folder projects of their own are looked for
const ABSORBED: &str = "mdview-absorbed"; // in .git: the repositories of projects taken in, kept a while
const ABSORBED_KEPT: Duration = Duration::from_secs(30 * 24 * 3600);

type Res<T> = Result<T, String>;

fn say<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Where a path stands: in a project of the app's, in a repository of someone else's, or in neither.
#[derive(Debug, PartialEq)]
pub enum Place {
    None,
    Project(PathBuf),
    Foreign(PathBuf),
}

impl Place {
    fn root(&self) -> Option<&Path> {
        match self {
            Place::Project(r) | Place::Foreign(r) => Some(r),
            Place::None => None,
        }
    }
}

/// The nearest repository at or above the path decides: with the marker beside it, a project.
pub fn place_of(path: &Path) -> Place {
    let start = if path.is_dir() { Some(path) } else { path.parent() };
    for dir in start.into_iter().flat_map(Path::ancestors) {
        if dir.join(".git").exists() {
            return if dir.join(MARKER).is_file() { Place::Project(dir.to_path_buf()) } else { Place::Foreign(dir.to_path_buf()) };
        }
    }
    Place::None
}

/// Where a folder stands, for the page: { state: "none" | "project" | "inside" (a project above) |
/// "foreign", own (a foreign repository that is the folder's: it can be taken over), name, root }.
pub fn standing(folder: &Path) -> Value {
    let named = |r: &Path| r.file_name().map_or_else(|| r.to_string_lossy().into_owned(), |n| n.to_string_lossy().into_owned());
    match place_of(folder) {
        Place::None => json!({ "state": "none" }),
        Place::Project(r) => json!({ "state": if r == folder { "project" } else { "inside" }, "name": named(&r), "root": r }),
        // (was: the app's own, its history switched off — to be switched on again without a question)
        Place::Foreign(r) => json!({ "state": "foreign", "own": r == folder, "was": r == folder && was_project(&r), "name": named(&r), "root": r }),
    }
}

/// The standing, and what the repository holds: its branch, how many commits, the last one
/// ({ time, device, subject }), and — in a project — how many files are not as the last commit
/// has them (changed).
pub fn overview(folder: &Path) -> Value {
    let mut all = standing(folder);
    let place = place_of(folder);
    let Some(repo) = place.root().and_then(|r| Repository::open(r).ok()) else { return all };
    all["branch"] = json!(repo.head().ok().and_then(|h| h.shorthand().ok().map(String::from)));
    all["versions"] = json!(repo.revwalk().ok().and_then(|mut w| w.push_head().ok().map(|_| w.count())).unwrap_or(0));
    if let Ok(commit) = repo.head().and_then(|h| h.peel_to_commit()) {
        let message = commit.message().unwrap_or("");
        let device = trailer(message, "Device").unwrap_or_else(|| commit.author().name().unwrap_or("").to_string());
        all["last"] = json!({ "time": commit.time().seconds(), "device": device, "subject": commit.summary().ok().flatten().unwrap_or("") });
    }
    if let Place::Project(root) = &place {
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false);
        // (a file left out for its size is not a change waiting to be kept)
        let mut inner = Inner::new(root);
        let mut waits = |e: &git2::StatusEntry| e.path().is_ok_and(|p| !inner.has(Path::new(p)) && !fs::metadata(root.join(p)).is_ok_and(|m| m.len() > BIG));
        all["changed"] = json!(repo.statuses(Some(&mut opts)).map_or(0, |st| st.iter().filter(|e| waits(e)).count()));
    }
    all
}

/// The branch a repository's commits go to (none: no commit yet, or no branch checked out).
pub fn branch(root: &Path) -> Option<String> {
    Repository::open(root).ok()?.head().ok()?.shorthand().ok().map(String::from)
}

/// What of a project's folder is another repository's (a project of its own left separate, or
/// someone's): none of it is this project's to keep. Asked for every path, so what a directory
/// is is remembered.
struct Inner<'a> {
    root: &'a Path,
    known: HashMap<PathBuf, bool>,
}

impl<'a> Inner<'a> {
    fn new(root: &'a Path) -> Self {
        Inner { root, known: HashMap::new() }
    }

    /// Is this path (in the project, relative to its root) inside a repository below the root?
    fn has(&mut self, rel: &Path) -> bool {
        let full = self.root.join(rel);
        let start = if full.is_dir() { Some(full.as_path()) } else { full.parent() };
        let dirs: Vec<PathBuf> = start.into_iter().flat_map(Path::ancestors).take_while(|d| *d != self.root && d.starts_with(self.root)).map(Path::to_path_buf).collect();
        // (from the outermost in: below a repository everything is its own)
        for dir in dirs.iter().rev() {
            let inner = match self.known.get(dir) {
                Some(k) => *k,
                None => {
                    let k = dir.join(".git").exists();
                    self.known.insert(dir.clone(), k);
                    k
                }
            };
            if inner {
                return true;
            }
        }
        false
    }
}

/// The projects of the app's below a folder (not the folder itself, and none inside another
/// repository): what is asked about when the folder becomes a project.
pub fn nested(root: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        let Ok(read) = fs::read_dir(dir) else { return };
        for e in read.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) || !e.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let sub = e.path();
            if sub.join(".git").exists() {
                if sub.join(MARKER).is_file() {
                    found.push(sub);
                }
            } else if depth < NEST_DEPTH {
                walk(&sub, depth + 1, found);
            }
        }
    }
    let mut found = vec![];
    walk(root, 0, &mut found);
    found.sort();
    found
}

/// Who a commit is made by: the device, the program, and the author where one is known (else
/// the one Git is configured with, else the device).
pub struct Stamp {
    pub device: String, // "name (id)"
    pub client: String, // "desktop 0.1.0"
    pub author: Option<(String, String)>,
}

impl Stamp {
    fn signature(&self, repo: &Repository) -> Res<Signature<'static>> {
        if let Some((name, mail)) = &self.author {
            return Signature::now(name, mail).map_err(say);
        }
        if let Ok(sig) = repo.signature() {
            return Ok(sig);
        }
        let name = self.device.split(" (").next().filter(|n| !n.is_empty()).unwrap_or("mdview");
        Signature::now(name, "device@mdview.invalid").map_err(say)
    }
}

/// The folder becomes a project: a repository is made in it, or the one that is its own is
/// taken over; the marker is written. A folder inside a repository cannot become one.
pub fn enable(root: &Path) -> Res<()> {
    match place_of(root) {
        Place::Project(r) if r == root => return Ok(()),
        Place::Project(r) => return Err(format!("already part of the project in {}", r.display())),
        Place::Foreign(r) if r != root => return Err(format!("inside the repository in {}", r.display())),
        Place::Foreign(_) => {}
        Place::None => {
            let mut opts = RepositoryInitOptions::new();
            opts.initial_head("main").no_reinit(true);
            Repository::init_opts(root, &opts).map_err(say)?;
            let ignore = root.join(".gitignore");
            if !ignore.exists() {
                fs::write(ignore, IGNORE).map_err(say)?;
            }
        }
    }
    let marker = root.join(MARKER);
    fs::create_dir_all(marker.parent().unwrap()).map_err(say)?;
    // (a project whose history was switched off is itself again: the marker its last commit has)
    if let Some(was) = kept_marker(root) {
        return fs::write(marker, was).map_err(say);
    }
    let project = json!({ "id": uuid::Uuid::new_v4().to_string(), "created": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true), "version": 1 });
    fs::write(marker, format!("{project:#}\n")).map_err(say)
}

/// The marker as the repository's last commit has it: the folder was a project of the app's.
fn kept_marker(root: &Path) -> Option<Vec<u8>> {
    let repo = Repository::open(root).ok()?;
    let entry = repo.head().ok()?.peel_to_tree().ok()?.get_path(Path::new(MARKER)).ok()?;
    let bytes = repo.find_blob(entry.id()).ok()?.content().to_vec();
    Some(bytes)
}

/// Was this repository a project of the app's (its history switched off since)? Then switching
/// it on again takes nothing over from anyone.
pub fn was_project(root: &Path) -> bool {
    kept_marker(root).is_some()
}

/// The project's history is switched off: what waits is kept, then the marker goes. The
/// repository stays, with every version — from now on it is not written to.
pub fn disable(root: &Path, stamp: &Stamp) -> Res<()> {
    snapshot(root, stamp)?;
    fs::remove_file(root.join(MARKER)).map_err(say)?;
    let _ = fs::remove_dir(root.join(".mdview")); // (if nothing else is in it)
    Ok(())
}

/// What a snapshot did: the commit it made (none: nothing had changed, or the repository is in
/// the middle of something), and the files left out for their size.
#[derive(Debug, Default)]
pub struct Snapshot {
    pub commit: Option<String>,
    pub skipped: Vec<String>,
}

fn subject(changed: &[String], first: bool) -> String {
    if first {
        return "History switched on".into();
    }
    let name = |p: &String| Path::new(p).file_name().map_or_else(|| p.clone(), |n| n.to_string_lossy().into_owned());
    match changed {
        [one] => name(one),
        many => {
            let names: Vec<String> = many.iter().take(NAMED).map(name).collect();
            format!("{} files: {}{}", many.len(), names.join(", "), if many.len() > NAMED { ", …" } else { "" })
        }
    }
}

/// The project as it is now, kept as a commit — if anything changed since the last one.
pub fn snapshot(root: &Path, stamp: &Stamp) -> Res<Snapshot> {
    if place_of(root) != Place::Project(root.to_path_buf()) {
        return Err(format!("not a project: {}", root.display()));
    }
    let repo = Repository::open(root).map_err(say)?;
    let mut done = Snapshot::default();
    if repo.state() != RepositoryState::Clean {
        return Ok(done); // (a merge or rebase somebody began: theirs to finish)
    }
    prune_absorbed(&repo);
    let mut index = repo.index().map_err(say)?;
    let mut skipped = vec![];
    let mut inner = Inner::new(root);
    index
        .add_all(
            ["*"],
            IndexAddOption::DEFAULT,
            Some(&mut |path: &Path, _: &[u8]| {
                if inner.has(path) {
                    return 1; // (another repository's: a project of its own, or someone's)
                }
                let big = fs::metadata(root.join(path)).is_ok_and(|m| m.is_file() && m.len() > BIG);
                if big {
                    skipped.push(path.to_string_lossy().into_owned());
                }
                big as i32 // (1: left out)
            }),
        )
        .map_err(say)?;
    index.update_all(["*"], None).map_err(say)?; // (what is gone from the folder goes from the index)
    index.write().map_err(say)?;
    done.skipped = skipped;
    let tree = repo.find_tree(index.write_tree().map_err(say)?).map_err(say)?;
    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit().map_err(say)?),
        Err(e) if matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => None,
        Err(e) => return Err(say(e)),
    };
    let before = parent.as_ref().map(|p| p.tree()).transpose().map_err(say)?;
    if before.as_ref().is_some_and(|t| t.id() == tree.id()) {
        return Ok(done);
    }
    let diff = repo.diff_tree_to_tree(before.as_ref(), Some(&tree), None).map_err(say)?;
    let changed: Vec<String> =
        diff.deltas().filter_map(|d| d.new_file().path().or(d.old_file().path()).map(|p| p.to_string_lossy().into_owned())).collect();
    let message = format!("{}\n\nDevice: {}\nClient: {}\n", subject(&changed, parent.is_none()), stamp.device, stamp.client);
    let sig = stamp.signature(&repo)?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let id = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents).map_err(say)?;
    done.commit = Some(id.to_string());
    Ok(done)
}

/// The repositories of projects taken in, once they have been kept long enough, go.
fn prune_absorbed(repo: &Repository) {
    let Ok(read) = fs::read_dir(repo.path().join(ABSORBED)) else { return };
    for e in read.flatten() {
        let old = e.metadata().and_then(|m| m.modified()).is_ok_and(|t| SystemTime::now().duration_since(t).is_ok_and(|age| age > ABSORBED_KEPT));
        if old {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

/// The tree `base` with the tree `sub` put at the path `at` (what was there is replaced).
fn graft(repo: &Repository, base: Option<&git2::Tree>, at: &[String], sub: Oid) -> Res<Oid> {
    let mut builder = repo.treebuilder(base).map_err(say)?;
    let (name, rest) = at.split_first().ok_or("no path")?;
    let id = if rest.is_empty() {
        sub
    } else {
        let below = base.and_then(|t| t.get_name(name)).filter(|e| e.kind() == Some(git2::ObjectType::Tree)).and_then(|e| repo.find_tree(e.id()).ok());
        graft(repo, below.as_ref(), rest, sub)?
    };
    builder.insert(name, id, 0o040000).map_err(say)?;
    builder.write().map_err(say)
}

/// A project below a project becomes a part of it, with its history: one commit whose parents
/// are both projects' last, and whose tree is the outer project's with the inner one's at its
/// folder. The inner project's repository is put aside (in the outer one's .git, for a while),
/// its marker goes. Both must be projects; what waits in either is kept first.
pub fn merge(root: &Path, child: &Path, stamp: &Stamp) -> Res<()> {
    if place_of(child) != Place::Project(child.to_path_buf()) || !child.starts_with(root) || child == root {
        return Err(format!("not a project below this one: {}", child.display()));
    }
    snapshot(child, stamp)?;
    snapshot(root, stamp)?; // (the outer project as it is, the inner one left out: there is a commit to join to)
    let at: Vec<String> = child.strip_prefix(root).map_err(say)?.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    let name = at.join("/");
    let repo = Repository::open(root).map_err(say)?;
    let their_head = {
    let theirs = Repository::open(child).map_err(say)?;
    let Ok(head) = theirs.head().and_then(|h| h.peel_to_commit()).map(|c| c.id()) else {
        return Err(format!("nothing kept in {name} yet"));
    };
    // everything the inner repository holds, into the outer one
    let (from, to) = (theirs.odb().map_err(say)?, repo.odb().map_err(say)?);
    let mut failed = None;
    from.foreach(|id| {
        if !to.exists(*id) {
            if let Err(e) = from.read(*id).and_then(|o| to.write(o.kind(), o.data())) {
                failed = Some(say(e));
                return false;
            }
        }
        true
    })
    .map_err(|e| failed.take().unwrap_or_else(|| say(e)))?;
    head
    }; // (the inner repository is let go of here: it is moved below)
    let ours = repo.head().and_then(|h| h.peel_to_commit()).map_err(say)?;
    let inner = repo.find_commit(their_head).map_err(say)?;
    // the inner project's tree without its marker, at its folder in the outer one's
    let mut plain = repo.treebuilder(Some(&inner.tree().map_err(say)?)).map_err(say)?;
    if plain.get(".mdview").map_err(say)?.is_some() {
        plain.remove(".mdview").map_err(say)?;
    }
    let sub = plain.write().map_err(say)?;
    let tree = repo.find_tree(graft(&repo, Some(&ours.tree().map_err(say)?), &at, sub)?).map_err(say)?;
    let message = format!("{name} taken in, with its history\n\nDevice: {}\nClient: {}\n", stamp.device, stamp.client);
    let sig = stamp.signature(&repo)?;
    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &[&ours, &inner]).map_err(say)?;
    let mut index = repo.index().map_err(say)?;
    index.read_tree(&tree).map_err(say)?;
    index.write().map_err(say)?;
    // the inner repository, aside; its marker, gone: the folder is the outer project's now
    let aside = repo.path().join(ABSORBED);
    fs::create_dir_all(&aside).map_err(say)?;
    let slot = aside.join(format!("{}-{}", name.replace('/', "-"), chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    fs::rename(child.join(".git"), &slot).map_err(say)?;
    let _ = fs::File::open(&slot).and_then(|f| f.set_modified(SystemTime::now())); // (kept from now)
    fs::remove_dir_all(child.join(".mdview")).map_err(say)
}

/// The repository a file is in, and the file's path in it.
fn within(path: &Path) -> Res<(Repository, PathBuf)> {
    let place = place_of(path);
    let root = place.root().ok_or("no history here")?;
    let rel = path.strip_prefix(root).map_err(say)?.to_path_buf();
    Ok((Repository::open(root).map_err(say)?, rel))
}

fn trailer(message: &str, key: &str) -> Option<String> {
    message.lines().rev().find_map(|l| l.strip_prefix(key)?.strip_prefix(": ").map(|v| v.trim().to_string()))
}

/// The versions of a file, newest first: [{ id, time (seconds), device, subject, path }]. A
/// version is a commit in which the file is not what it was in the commit before. Where the file
/// came to its name by being renamed, the versions go on under the name it had (path: the file's
/// place in the repository as that version has it).
pub fn log(path: &Path) -> Res<Vec<Value>> {
    let (repo, mut rel) = within(path)?;
    let Some(mut from) = repo.head().ok().and_then(|h| h.target()) else { return Ok(vec![]) }; // (no commit yet)
    let blob = |c: &git2::Commit, rel: &Path| -> Option<Oid> { c.tree().ok()?.get_path(rel).ok().map(|e| e.id()) };
    let mut versions = vec![];
    'line: loop {
        let mut walk = repo.revwalk().map_err(say)?;
        walk.push(from).map_err(say)?;
        walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).map_err(say)?;
        // One line of commits at a time, each one's first parent after it: what was joined to the
        // line (another device's work, a project taken in) is gone into only where the file came
        // from there — its trees may be of another folder, where the same path is another file.
        walk.simplify_first_parent().map_err(say)?;
        for id in walk {
            let commit = repo.find_commit(id.map_err(say)?).map_err(say)?;
            let Some(here) = blob(&commit, &rel) else { continue };
            // (as Git reads a merge: a version only where the file differs from every parent)
            let same: Vec<git2::Commit> = commit.parents().filter(|p| blob(p, &rel) == Some(here)).collect();
            if let Some(p) = same.first() {
                if commit.parent_id(0).ok() != Some(p.id()) {
                    from = p.id(); // (as it is in a line joined here: its versions are that line's)
                    continue 'line;
                }
                continue;
            }
            // not there before this commit: made here — or it came to this name here (renamed, or
            // its project taken into this one), and then it goes on as what it was, where it was
            let came = if commit.parents().all(|p| blob(&p, &rel).is_none()) {
                commit.parents().find_map(|p| renamed_from(&repo, &p, &commit, &rel).map(|old| (p, old)))
            } else {
                None
            };
            let only_moved = came.as_ref().is_some_and(|(p, old)| blob(p, old) == Some(here));
            if !only_moved {
                let message = commit.message().unwrap_or("");
                let device = trailer(message, "Device").unwrap_or_else(|| commit.author().name().unwrap_or("").to_string());
                versions.push(json!({ "id": commit.id().to_string(), "time": commit.time().seconds(), "device": device, "subject": commit.summary().ok().flatten().unwrap_or(""), "path": rel }));
                if versions.len() >= LOG_LIMIT {
                    break 'line;
                }
            }
            if let Some((parent, old)) = came {
                rel = old;
                if commit.parent_count() > 1 {
                    from = parent.id(); // (only the line it came from knows it under that name)
                    continue 'line;
                }
            }
        }
        break;
    }
    Ok(versions)
}

/// The name a file had in the commit before, if this commit gave it the one it has.
fn renamed_from(repo: &Repository, parent: &git2::Commit, commit: &git2::Commit, rel: &Path) -> Option<PathBuf> {
    let mut diff = repo.diff_tree_to_tree(Some(&parent.tree().ok()?), Some(&commit.tree().ok()?), None).ok()?;
    let mut find = git2::DiffFindOptions::new();
    find.renames(true);
    diff.find_similar(Some(&mut find)).ok()?;
    let found = diff.deltas().find(|d| d.status() == git2::Delta::Renamed && d.new_file().path() == Some(rel)).and_then(|d| d.old_file().path().map(Path::to_path_buf));
    found
}

/// A file as it was in a version (at: its place in the repository then, where it had another name).
pub fn text(path: &Path, id: &str, at: Option<&str>) -> Res<Vec<u8>> {
    let (repo, rel) = within(path)?;
    let rel = at.map(PathBuf::from).unwrap_or(rel);
    let commit = repo.find_commit(Oid::from_str(id).map_err(say)?).map_err(say)?;
    let entry = commit.tree().map_err(say)?.get_path(&rel).map_err(say)?;
    let blob = repo.find_blob(entry.id()).map_err(say)?;
    Ok(blob.content().to_vec())
}

enum Job {
    Snapshot { root: PathBuf, stamp: Stamp },
    Merge { root: PathBuf, children: Vec<PathBuf>, stamp: Stamp },
    Done(Sender<()>),
}

/// The thread the snapshots are made on, one after the other.
pub struct Historian {
    jobs: Sender<Job>,
}

impl Historian {
    pub fn new(tx: Sender<Event>) -> Self {
        let (jobs, asked) = channel::<Job>();
        std::thread::spawn(move || {
            for job in asked {
                match job {
                    Job::Snapshot { root, stamp } => {
                        let (kept, skipped, error) = match snapshot(&root, &stamp) {
                            Ok(done) => (done.commit.is_some(), done.skipped, None),
                            Err(e) => (false, vec![], Some(e)),
                        };
                        if kept || !skipped.is_empty() || error.is_some() {
                            let _ = tx.send(Event::Snapshotted { root, kept, skipped, error, asked: false });
                        }
                    }
                    Job::Merge { root, children, stamp } => {
                        let failed: Vec<String> = children.iter().filter_map(|c| merge(&root, c, &stamp).err()).collect();
                        let skipped = snapshot(&root, &stamp).map(|d| d.skipped).unwrap_or_default();
                        let error = (!failed.is_empty()).then(|| failed.join("; "));
                        let _ = tx.send(Event::Snapshotted { root, kept: true, skipped, error, asked: true });
                    }
                    Job::Done(said) => {
                        let _ = said.send(());
                    }
                }
            }
        });
        Historian { jobs }
    }

    pub fn snapshot(&self, root: &Path, stamp: Stamp) {
        let _ = self.jobs.send(Job::Snapshot { root: root.to_path_buf(), stamp });
    }

    /// The projects below a project become parts of it; its snapshot follows.
    pub fn merge(&self, root: &Path, children: Vec<PathBuf>, stamp: Stamp) {
        let _ = self.jobs.send(Job::Merge { root: root.to_path_buf(), children, stamp });
    }

    /// Returns when everything asked for so far is done (before the program ends).
    pub fn wait(&self) {
        let (said, done) = channel();
        if self.jobs.send(Job::Done(said)).is_ok() {
            let _ = done.recv();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own for a test, gone when the test is.
    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Dir {
            let d = std::env::temp_dir().join(format!("mdview-history-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&d).unwrap();
            Dir(d.canonicalize().unwrap())
        }
        fn write(&self, name: &str, text: &str) -> PathBuf {
            let p = self.0.join(name);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(&p, text).unwrap();
            p
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn stamp() -> Stamp {
        Stamp { device: "test-device (1234)".into(), client: "desktop test".into(), author: Some(("Tester".into(), "tester@example.invalid".into())) }
    }

    fn commits(root: &Path) -> usize {
        let repo = Repository::open(root).unwrap();
        let mut walk = repo.revwalk().unwrap();
        if walk.push_head().is_err() {
            return 0;
        }
        walk.count()
    }

    #[test]
    fn a_folder_is_nothing_until_switched_on() {
        let d = Dir::new();
        d.write("a.md", "one\n");
        assert_eq!(place_of(&d.0), Place::None);
        assert!(snapshot(&d.0, &stamp()).is_err());
        assert!(!d.0.join(".git").exists());
    }

    #[test]
    fn enable_makes_marker_and_repository_together() {
        let d = Dir::new();
        let note = d.write("sub/a.md", "one\n");
        enable(&d.0).unwrap();
        assert_eq!(place_of(&d.0), Place::Project(d.0.clone()));
        assert_eq!(place_of(&note), Place::Project(d.0.clone())); // (a file below belongs to it)
        assert_eq!(place_of(&d.0.join("sub")), Place::Project(d.0.clone()));
        let marker: Value = serde_json::from_str(&fs::read_to_string(d.0.join(MARKER)).unwrap()).unwrap();
        assert_eq!(marker["id"].as_str().unwrap().len(), 36);
        assert_eq!(fs::read_to_string(d.0.join(".gitignore")).unwrap(), IGNORE);
        enable(&d.0).unwrap(); // (again: nothing changes)
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(d.0.join(MARKER)).unwrap()).unwrap(), marker);
        assert!(enable(&d.0.join("sub")).is_err()); // (no project inside a project)
        assert!(!d.0.join("sub/.git").exists());
    }

    #[test]
    fn snapshot_commits_only_what_changed() {
        let d = Dir::new();
        let note = d.write("a.md", "one\n");
        enable(&d.0).unwrap();
        let first = snapshot(&d.0, &stamp()).unwrap();
        assert!(first.commit.is_some());
        assert_eq!(snapshot(&d.0, &stamp()).unwrap().commit, None); // (nothing changed)
        assert_eq!(commits(&d.0), 1);
        fs::write(&note, "two\n").unwrap();
        let second = snapshot(&d.0, &stamp()).unwrap().commit.unwrap();
        assert_eq!(commits(&d.0), 2);
        let repo = Repository::open(&d.0).unwrap();
        let commit = repo.find_commit(Oid::from_str(&second).unwrap()).unwrap();
        assert_eq!(commit.message().unwrap(), "a.md\n\nDevice: test-device (1234)\nClient: desktop test\n");
        assert_eq!(commit.author().name().ok(), Some("Tester"));
        assert_eq!(repo.head().unwrap().shorthand().ok(), Some("main"));
    }

    #[test]
    fn snapshot_takes_new_changed_and_deleted_files() {
        let d = Dir::new();
        let a = d.write("a.md", "a\n");
        d.write("b.md", "b\n");
        enable(&d.0).unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        fs::remove_file(&a).unwrap();
        d.write("b.md", "b2\n");
        d.write("deep/c.md", "c\n");
        d.write("deep/d.md", "d\n");
        d.write(".DS_Store", "x");
        let id = snapshot(&d.0, &stamp()).unwrap().commit.unwrap();
        let repo = Repository::open(&d.0).unwrap();
        let commit = repo.find_commit(Oid::from_str(&id).unwrap()).unwrap();
        let tree = commit.tree().unwrap();
        assert!(tree.get_path(Path::new("a.md")).is_err());
        assert!(tree.get_path(Path::new("deep/c.md")).is_ok());
        assert!(tree.get_path(Path::new(".DS_Store")).is_err()); // (ignored)
        assert!(tree.get_path(Path::new(MARKER)).is_ok()); // (the marker travels with the project)
        assert_eq!(commit.summary().unwrap().unwrap(), "4 files: a.md, b.md, c.md, …");
        let mut all = git2::StatusOptions::new();
        all.include_untracked(true).include_ignored(false);
        assert_eq!(repo.statuses(Some(&mut all)).unwrap().len(), 0); // (the folder is as the commit says)
    }

    #[test]
    fn log_lists_a_files_versions_and_text_gives_them_back() {
        let d = Dir::new();
        let a = d.write("a.md", "one\n");
        let b = d.write("b.md", "b\n");
        enable(&d.0).unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        fs::write(&b, "b2\n").unwrap();
        snapshot(&d.0, &stamp()).unwrap(); // (not a version of a.md)
        fs::write(&a, "two\r\n").unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        let versions = log(&a).unwrap();
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0]["subject"], "a.md");
        assert_eq!(versions[0]["device"], "test-device (1234)");
        assert!(versions[0]["time"].as_i64().unwrap() > 1_700_000_000);
        assert_eq!(text(&a, versions[0]["id"].as_str().unwrap(), None).unwrap(), b"two\r\n"); // (byte for byte)
        assert_eq!(text(&a, versions[1]["id"].as_str().unwrap(), None).unwrap(), b"one\n");
        assert_eq!(log(&b).unwrap().len(), 2);
        assert!(log(&d.0.join("never.md")).unwrap().is_empty());
    }

    #[test]
    fn a_repository_without_the_marker_is_read_not_written() {
        let d = Dir::new();
        let a = d.write("docs/a.md", "one\n");
        // someone else's repository, with a commit of theirs
        let repo = Repository::init(&d.0).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("docs/a.md")).unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let sig = Signature::now("Someone", "someone@example.invalid").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "theirs", &tree, &[]).unwrap();

        assert_eq!(place_of(&a), Place::Foreign(d.0.clone()));
        assert!(snapshot(&d.0, &stamp()).is_err());
        assert!(enable(&d.0.join("docs")).is_err()); // (never a part of it)
        fs::write(&a, "two\n").unwrap();
        assert!(snapshot(&d.0.join("docs"), &stamp()).is_err());
        assert_eq!(commits(&d.0), 1);
        assert!(!d.0.join("docs/.mdview").exists() && !d.0.join(MARKER).exists());
        let versions = log(&a).unwrap(); // (its history can be read)
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0]["device"], "Someone");
        assert_eq!(text(&a, versions[0]["id"].as_str().unwrap(), None).unwrap(), b"one\n");

        enable(&d.0).unwrap(); // (taken over, as a whole: now a project)
        assert_eq!(place_of(&a), Place::Project(d.0.clone()));
        assert!(!d.0.join(".gitignore").exists()); // (theirs to have or not)
        assert!(snapshot(&d.0, &stamp()).unwrap().commit.is_some());
        assert_eq!(commits(&d.0), 2);
        assert_eq!(log(&a).unwrap().len(), 2);
    }

    #[test]
    fn overview_says_where_a_folder_stands_and_what_is_kept() {
        let d = Dir::new();
        let a = d.write("sub/a.md", "one\n");
        assert_eq!(overview(&d.0)["state"], "none");
        enable(&d.0).unwrap();
        assert_eq!(overview(&d.0)["versions"], 0);
        assert_eq!(overview(&d.0)["changed"], 3); // (the note, the marker, .gitignore)
        snapshot(&d.0, &stamp()).unwrap();
        fs::write(&a, "two\n").unwrap();
        let all = overview(&d.0);
        assert_eq!((all["state"].as_str(), all["branch"].as_str(), all["versions"].as_i64(), all["changed"].as_i64()), (Some("project"), Some("main"), Some(1), Some(1)));
        assert_eq!(all["last"]["subject"], "History switched on");
        assert_eq!(all["last"]["device"], "test-device (1234)");
        assert_eq!(all["name"].as_str(), d.0.file_name().unwrap().to_str());
        let sub = overview(&d.0.join("sub"));
        assert_eq!((sub["state"].as_str(), sub["versions"].as_i64()), (Some("inside"), Some(1)));
        // someone else's repository: read, and nothing said of changes (they are not this app's to keep)
        let f = Dir::new();
        f.write("docs/a.md", "one\n");
        Repository::init(&f.0).unwrap();
        assert_eq!((overview(&f.0)["state"].as_str(), overview(&f.0)["own"].as_bool()), (Some("foreign"), Some(true)));
        let docs = overview(&f.0.join("docs"));
        assert_eq!((docs["state"].as_str(), docs["own"].as_bool(), docs["changed"].is_null()), (Some("foreign"), Some(false), true));
    }

    #[test]
    fn a_renamed_files_versions_go_on_under_its_old_name() {
        let d = Dir::new();
        let old = d.write("Draft.md", "# A note\n\nwith enough text to be known again\nwhen its name changes\n");
        enable(&d.0).unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        fs::write(&old, "# A note\n\nwith enough text to be known again\nwhen its name changes\nand a line more\n").unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        let new = d.0.join("sub/Final.md");
        fs::create_dir_all(new.parent().unwrap()).unwrap();
        fs::rename(&old, &new).unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        fs::write(&new, "# A note\n\nrewritten\n").unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        let versions = log(&new).unwrap();
        let paths: Vec<&str> = versions.iter().map(|v| v["path"].as_str().unwrap()).collect();
        assert_eq!(paths, ["sub/Final.md", "Draft.md", "Draft.md"]); // (the renaming itself changed nothing: no version)
        let first = versions.last().unwrap();
        assert!(text(&new, first["id"].as_str().unwrap(), first["path"].as_str()).unwrap().starts_with(b"# A note\n\nwith enough"));
        assert!(text(&new, first["id"].as_str().unwrap(), None).is_err()); // (it was not there under this name then)
    }

    #[test]
    fn a_repository_below_a_project_is_not_the_projects_to_keep() {
        let d = Dir::new();
        d.write("a.md", "a\n");
        let inner = d.write("own/b.md", "b\n");
        d.write("code/src/c.md", "c\n");
        enable(&d.0.join("own")).unwrap(); // (a project of its own)
        Repository::init(d.0.join("code")).unwrap(); // (someone's repository)
        assert_eq!(nested(&d.0), vec![d.0.join("own")]); // (only the app's own are asked about)
        enable(&d.0).unwrap();
        let id = snapshot(&d.0, &stamp()).unwrap().commit.unwrap();
        let repo = Repository::open(&d.0).unwrap();
        let tree = repo.find_commit(Oid::from_str(&id).unwrap()).unwrap().tree().unwrap();
        assert!(tree.get_path(Path::new("a.md")).is_ok());
        assert!(tree.get_name("own").is_none() && tree.get_name("code").is_none());
        assert_eq!(overview(&d.0)["changed"], 0); // (and nothing of theirs waits to be kept here)
        fs::write(&inner, "b2\n").unwrap();
        assert_eq!(snapshot(&d.0, &stamp()).unwrap().commit, None);
        assert_eq!(place_of(&inner), Place::Project(d.0.join("own"))); // (it is its own project's)
        assert!(snapshot(&d.0.join("own"), &stamp()).unwrap().commit.is_some());
    }

    #[test]
    fn a_project_taken_in_keeps_its_history() {
        let d = Dir::new();
        d.write("top.md", "top\n");
        let note = d.write("deep/sub/a.md", "one\n");
        let sub = d.0.join("deep/sub");
        enable(&sub).unwrap();
        snapshot(&sub, &stamp()).unwrap();
        fs::write(&note, "two\n").unwrap();
        snapshot(&sub, &stamp()).unwrap();
        fs::write(&note, "three\n").unwrap(); // (not kept yet: taking in keeps it first)
        enable(&d.0).unwrap();
        merge(&d.0, &sub, &stamp()).unwrap();

        assert!(!sub.join(".git").exists() && !sub.join(".mdview").exists());
        assert_eq!(place_of(&note), Place::Project(d.0.clone()));
        assert!(nested(&d.0).is_empty());
        let repo = Repository::open(&d.0).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert_eq!(head.summary().unwrap().unwrap(), "deep/sub taken in, with its history");
        assert!(head.tree().unwrap().get_path(Path::new("deep/sub/.mdview")).is_err());
        assert!(head.tree().unwrap().get_path(Path::new("top.md")).is_ok());
        let mut all = git2::StatusOptions::new();
        all.include_untracked(true).include_ignored(false).recurse_untracked_dirs(true);
        assert_eq!(repo.statuses(Some(&mut all)).unwrap().len(), 0); // (the folder is as the commit says)
        assert_eq!(snapshot(&d.0, &stamp()).unwrap().commit, None);
        assert_eq!(fs::read_dir(d.0.join(".git").join(ABSORBED)).unwrap().count(), 1); // (its repository, put aside)

        // the note's versions reach back to its first, under the name it had in its own project
        let versions = log(&note).unwrap();
        let paths: Vec<&str> = versions.iter().map(|v| v["path"].as_str().unwrap()).collect();
        assert_eq!(paths, ["a.md", "a.md", "a.md"]);
        let texts: Vec<Vec<u8>> = versions.iter().map(|v| text(&note, v["id"].as_str().unwrap(), v["path"].as_str()).unwrap()).collect();
        assert_eq!(texts, [b"three\n".to_vec(), b"two\n".to_vec(), b"one\n".to_vec()]);
        fs::write(&note, "four\n").unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        let versions = log(&note).unwrap();
        assert_eq!(versions.len(), 4);
        assert_eq!(versions[0]["path"], "deep/sub/a.md");
        // a note of the outer project that happens to have the inner one's old name is another note
        let other = d.write("a.md", "unrelated\n");
        snapshot(&d.0, &stamp()).unwrap();
        assert_eq!(log(&other).unwrap().len(), 1);
        assert_eq!(log(&note).unwrap().len(), 4);
    }

    /// How long the history takes in a large folder. Not a check: run on purpose, and read —
    /// cargo test --release measure -- --ignored --nocapture
    #[test]
    #[ignore]
    fn measure_a_folder_of_five_thousand_notes() {
        use std::time::Instant;
        let d = Dir::new();
        let body = "A line of a note, about as long as lines are.\n".repeat(60);
        for i in 0..5000 {
            d.write(&format!("area-{}/topic-{}/note-{i}.md", i % 20, i % 7), &format!("# Note {i}\n\n{body}"));
        }
        let timed = |what: &str, f: &mut dyn FnMut()| {
            let t = Instant::now();
            f();
            println!("{what}: {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
        };
        enable(&d.0).unwrap();
        timed("first snapshot (5000 notes)", &mut || assert!(snapshot(&d.0, &stamp()).unwrap().commit.is_some()));
        timed("snapshot, nothing changed", &mut || assert!(snapshot(&d.0, &stamp()).unwrap().commit.is_none()));
        let note = d.0.join("area-3/topic-3/note-3.md");
        fs::write(&note, "changed\n").unwrap();
        timed("snapshot, one note changed", &mut || assert!(snapshot(&d.0, &stamp()).unwrap().commit.is_some()));
        for i in 0..500 {
            fs::write(&note, format!("version {i}\n")).unwrap();
            fs::write(d.0.join(format!("area-{}/topic-{}/note-{}.md", (i + 1) % 20, (i + 1) % 7, i + 1)), format!("other {i}\n")).unwrap();
            snapshot(&d.0, &stamp()).unwrap();
        }
        timed("overview (502 commits)", &mut || assert_eq!(overview(&d.0)["versions"], 502));
        timed("a note's 500 versions listed", &mut || assert_eq!(log(&note).unwrap().len(), 500));
        timed("a note with 2 versions listed", &mut || assert_eq!(log(&d.0.join("area-1/topic-1/note-1.md")).unwrap().len(), 2));
        timed("where a file stands (place_of)", &mut || assert_eq!(place_of(&note), Place::Project(d.0.clone())));
        let id = log(&note).unwrap()[250]["id"].as_str().unwrap().to_string();
        timed("one version's text", &mut || assert!(text(&note, &id, None).is_ok()));
    }

    #[test]
    fn a_history_switched_off_keeps_its_versions_and_comes_back_as_itself() {
        let d = Dir::new();
        let a = d.write("a.md", "one\n");
        enable(&d.0).unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        let marker = fs::read(d.0.join(MARKER)).unwrap();
        fs::write(&a, "two\n").unwrap(); // (not kept yet: switching off keeps it first)
        disable(&d.0, &stamp()).unwrap();
        assert_eq!(place_of(&a), Place::Foreign(d.0.clone()));
        assert!(!d.0.join(".mdview").exists() && d.0.join(".git").exists());
        assert_eq!(log(&a).unwrap().len(), 2); // (the versions can still be read)
        fs::write(&a, "three\n").unwrap();
        assert!(snapshot(&d.0, &stamp()).is_err()); // (and nothing is written any more)
        assert_eq!(commits(&d.0), 2);
        assert!(was_project(&d.0));
        enable(&d.0).unwrap();
        assert_eq!(fs::read(d.0.join(MARKER)).unwrap(), marker); // (the same project, not a new one)
        assert!(snapshot(&d.0, &stamp()).unwrap().commit.is_some());
        assert_eq!(log(&a).unwrap().len(), 3);
        // someone's repository never was one
        let f = Dir::new();
        Repository::init(&f.0).unwrap();
        assert!(!was_project(&f.0));
    }

    #[test]
    fn a_large_file_is_left_out_and_said() {
        let d = Dir::new();
        d.write("a.md", "one\n");
        let big = d.0.join("film.mov");
        fs::File::create(&big).unwrap().set_len(BIG + 1).unwrap(); // (sparse: no bytes written)
        enable(&d.0).unwrap();
        let done = snapshot(&d.0, &stamp()).unwrap();
        assert_eq!(done.skipped, vec!["film.mov".to_string()]);
        let repo = Repository::open(&d.0).unwrap();
        assert!(repo.head().unwrap().peel_to_tree().unwrap().get_path(Path::new("film.mov")).is_err());
        assert_eq!(snapshot(&d.0, &stamp()).unwrap().commit, None); // (and no commit for it each time)
    }

    #[test]
    fn a_repository_in_the_middle_of_a_merge_is_left_alone() {
        let d = Dir::new();
        let a = d.write("a.md", "one\n");
        enable(&d.0).unwrap();
        snapshot(&d.0, &stamp()).unwrap();
        fs::write(d.0.join(".git/MERGE_HEAD"), format!("{}\n", Repository::open(&d.0).unwrap().head().unwrap().target().unwrap())).unwrap();
        fs::write(&a, "two\n").unwrap();
        assert_eq!(snapshot(&d.0, &stamp()).unwrap().commit, None);
        assert_eq!(commits(&d.0), 1);
    }
}
