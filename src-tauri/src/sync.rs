//! A project and the repository it is linked to: what is fetched from there and pushed to it.
//! The repository is GitHub's, reached over HTTPS with the token of the user who signed in; a
//! path on this machine is one too (the tests' other side). The token is handed to the
//! transport in memory, and stands in no file and in no address.

use std::path::Path;

use git2::build::CheckoutBuilder;
use git2::{Cred, ErrorClass, ErrorCode, FetchOptions, IndexEntry, IndexTime, MergeFileOptions, Oid, PushOptions, RemoteCallbacks, Repository};
use serde_json::{json, Value};

use crate::history::{self, Stamp};

pub const REMOTE: &str = "origin";

type Res<T> = Result<T, String>;

fn say<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// What the other side is reached with: the token of the signed-in user (none: an address that
/// asks for nothing).
#[derive(Clone, Default)]
pub struct Access {
    pub token: Option<String>,
}

impl Access {
    fn callbacks(&self) -> RemoteCallbacks<'_> {
        let mut callbacks = RemoteCallbacks::new();
        let mut asked = false;
        callbacks.credentials(move |_url, _user, _allowed| {
            // (asked again: the token was not taken — said once, not tried for ever)
            if std::mem::replace(&mut asked, true) {
                return Err(git2::Error::from_str("the sign-in was not accepted"));
            }
            match &self.token {
                Some(token) => Cred::userpass_plaintext("x-access-token", token),
                None => Err(git2::Error::from_str("not signed in")),
            }
        });
        callbacks
    }
}

/// The project's repository is told where its other side is (anew, if it had another).
pub fn link(root: &Path, url: &str) -> Res<()> {
    let repo = Repository::open(root).map_err(say)?;
    if repo.find_remote(REMOTE).is_ok() {
        return repo.remote_set_url(REMOTE, url).map_err(say);
    }
    let made = repo.remote(REMOTE, url).map(|_| ()).map_err(say);
    made
}

/// The project has no other side any more. What was fetched from it stays, as does the history.
pub fn unlink(root: &Path) -> Res<()> {
    let repo = Repository::open(root).map_err(say)?;
    if repo.find_remote(REMOTE).is_err() {
        return Ok(());
    }
    repo.remote_delete(REMOTE).map_err(say)
}

/// Where the project's other side is, if it has one.
pub fn linked(root: &Path) -> Option<String> {
    let repo = Repository::open(root).ok()?;
    let url = repo.find_remote(REMOTE).ok()?.url().ok().map(String::from);
    url
}

#[allow(dead_code)] // (asked when a project is linked: the next steps)
/// The branches the repository at an address has (none: it is empty). Says whether it can be reached.
pub fn branches(url: &str, access: &Access) -> Res<Vec<String>> {
    let mut remote = git2::Remote::create_detached(url).map_err(say)?;
    let connection = remote.connect_auth(git2::Direction::Fetch, Some(access.callbacks()), None).map_err(say)?;
    let heads = connection.list().map_err(say)?.iter().filter_map(|h| h.name().strip_prefix("refs/heads/").map(String::from)).collect();
    Ok(heads)
}

#[allow(dead_code)] // (the reconciling fetches for itself; this is the tests')
/// What the other side has is brought here (refs/remotes/origin/…); nothing of the folder changes.
pub fn fetch(root: &Path, access: &Access) -> Res<()> {
    fetch_into(&Repository::open(root).map_err(say)?, access).map_err(say)
}

fn fetch_into(repo: &Repository, access: &Access) -> Result<(), git2::Error> {
    let mut remote = repo.find_remote(REMOTE)?;
    let mut opts = FetchOptions::new();
    opts.remote_callbacks(access.callbacks());
    opts.prune(git2::FetchPrune::On);
    remote.fetch(&[] as &[&str], Some(&mut opts), None)
}

/// The project's branch goes to the other side — only as a continuation of what is there: where
/// the other side has commits this one has not, nothing is pushed and that is said.
pub fn push(root: &Path, access: &Access) -> Res<()> {
    let repo = Repository::open(root).map_err(say)?;
    let head = repo.head().map_err(say)?;
    let branch = head.name().map_err(say)?.to_string();
    let mut remote = repo.find_remote(REMOTE).map_err(say)?;
    let mut refused = None;
    {
        let mut callbacks = access.callbacks();
        callbacks.push_update_reference(|_name, status| {
            refused = status.map(String::from);
            Ok(())
        });
        let mut opts = PushOptions::new();
        opts.remote_callbacks(callbacks);
        remote.push(&[format!("{branch}:{branch}")], Some(&mut opts)).map_err(say)?;
    }
    match refused {
        Some(why) => Err(why),
        None => Ok(()),
    }
}

/// How a project and its other side stand after they were reconciled.
#[derive(Debug, PartialEq)]
pub enum Standing {
    /// both have the same
    Even,
    /// this side's commits went over (how many)
    Pushed(usize),
    /// the other side's commits came here, and the folder is as they have it (how many)
    Pulled(usize),
    /// both had commits of their own: joined here in one commit, the folder is as that has it,
    /// and it went over (how many came)
    Merged(usize),
    /// both changed the same place of these files: nothing was changed anywhere, it is the user's to say
    Conflict(Vec<String>),
    /// the other side could not be reached (said why): everything here is as it was
    Unreachable(String),
    /// the other side did not let this user in (not signed in, or not allowed there)
    SignIn(String),
    /// the two are not the same project (no commit in common), or something else stands in the way
    Refused(String),
}

impl Standing {
    /// For the page: { state, count?, files?, why? }.
    pub fn json(&self) -> Value {
        match self {
            Standing::Even => json!({ "state": "even" }),
            Standing::Pushed(n) => json!({ "state": "even", "did": "pushed", "count": n }),
            Standing::Pulled(n) => json!({ "state": "even", "did": "pulled", "count": n }),
            Standing::Merged(n) => json!({ "state": "even", "did": "merged", "count": n }),
            Standing::Conflict(files) => json!({ "state": "conflict", "files": files }),
            Standing::Unreachable(why) => json!({ "state": "offline", "why": why }),
            Standing::SignIn(why) => json!({ "state": "signin", "why": why }),
            Standing::Refused(why) => json!({ "state": "error", "why": why }),
        }
    }
}

const TRIES: usize = 3; // times a push is tried again after the other side moved meanwhile

/// The project and its other side are brought to the same: what waits here is kept, what is
/// there is fetched; then pushed, pulled, or both joined — as far as that goes without the
/// user. Nothing here ever overwrites a commit, and the folder is only changed to what a
/// commit has while it still is what the last commit has.
pub fn reconcile(root: &Path, access: &Access, stamp: &Stamp) -> Standing {
    match reconcile_in(root, access, stamp) {
        Ok(standing) => standing,
        Err(e) => Standing::Refused(e),
    }
}

fn reconcile_in(root: &Path, access: &Access, stamp: &Stamp) -> Res<Standing> {
    history::snapshot(root, stamp)?;
    let repo = Repository::open(root).map_err(say)?;
    let branch = repo.head().map_err(say)?.name().map_err(say)?.to_string(); // refs/heads/main
    let theirs_name = format!("refs/remotes/{REMOTE}/{}", branch.trim_start_matches("refs/heads/"));
    let mut came = 0;
    let mut did = Standing::Even;
    for _ in 0..TRIES {
        if let Err(e) = fetch_into(&repo, access) {
            let why = e.message().to_string();
            return Ok(match (e.code(), e.class()) {
                (ErrorCode::Auth, _) => Standing::SignIn(why),
                (_, ErrorClass::Net | ErrorClass::Ssl | ErrorClass::Os | ErrorClass::Http) => Standing::Unreachable(why),
                _ if !repo.find_remote(REMOTE).is_ok() => Standing::Refused("not linked".into()),
                _ => Standing::Unreachable(why),
            });
        }
        let ours = repo.refname_to_id(&branch).map_err(say)?;
        let Ok(theirs) = repo.refname_to_id(&theirs_name) else {
            // (nothing there yet: this side's is the first)
            return push_or(root, access, Standing::Pushed(count(&repo, ours, None)));
        };
        if ours == theirs {
            return Ok(did);
        }
        if repo.merge_base(ours, theirs).is_err() {
            return Ok(Standing::Refused("the repository holds another project (no version in common)".into()));
        }
        let (ahead, behind) = repo.graph_ahead_behind(ours, theirs).map_err(say)?;
        if behind == 0 {
            match push(root, access) {
                Ok(()) => return Ok(if came > 0 { Standing::Merged(came) } else { Standing::Pushed(ahead) }),
                Err(_) => continue, // (the other side moved meanwhile: fetch again)
            }
        }
        let their_commit = repo.find_commit(theirs).map_err(say)?;
        if ahead == 0 {
            // only they have new commits: the folder becomes what theirs has, the branch follows
            if !checkout(&repo, &their_commit.tree().map_err(say)?) {
                return Ok(Standing::Refused("the folder changed meanwhile".into())); // (kept at the next turn, then again)
            }
            repo.find_reference(&branch).and_then(|mut r| r.set_target(theirs, "pulled")).map_err(say)?;
            return Ok(Standing::Pulled(behind));
        }
        // both have commits of their own: joined in memory, nothing touched until it is known to go
        let our_commit = repo.find_commit(ours).map_err(say)?;
        let mut joined = repo.merge_commits(&our_commit, &their_commit, None).map_err(say)?;
        if joined.has_conflicts() {
            let mut files: Vec<String> = joined
                .conflicts()
                .map_err(say)?
                .flatten()
                .filter_map(|c| c.our.or(c.their).or(c.ancestor).map(|e| String::from_utf8_lossy(&e.path).into_owned()))
                .collect();
            files.sort();
            files.dedup();
            return Ok(Standing::Conflict(files));
        }
        if !join(&repo, &branch, &our_commit, &their_commit, &mut joined, stamp)? {
            return Ok(Standing::Refused("the folder changed meanwhile".into()));
        }
        came = behind;
        did = Standing::Merged(behind);
        // (round again: the joined commit goes over)
    }
    Ok(Standing::Unreachable("the other side kept changing".into()))
}

/// The commit that joins two lines, with the tree of an index that has no conflict (left); the
/// folder becomes what it has, then the branch points to it. false: the folder changed
/// meanwhile, and nothing was done.
fn join(repo: &Repository, branch: &str, ours: &git2::Commit, theirs: &git2::Commit, joined: &mut git2::Index, stamp: &Stamp) -> Res<bool> {
    let tree = repo.find_tree(joined.write_tree_to(repo).map_err(say)?).map_err(say)?;
    let message = format!("Joined with what another device kept\n\nDevice: {}\nClient: {}\n", stamp.device, stamp.client);
    let sig = stamp.signature(repo)?;
    let commit = repo.commit(None, &sig, &sig, &message, &tree, &[ours, theirs]).map_err(say)?;
    if !checkout(repo, &tree) {
        return Ok(false);
    }
    repo.find_reference(branch).and_then(|mut r| r.set_target(commit, "joined")).map_err(say)?;
    Ok(true)
}

// -- conflicts ----------------------------------------------------------------

const MARK: u16 = 31; // the length of the lines that part the two sides in a file merged for showing: none a note has
const TEXT_LIMIT: usize = 2 * 1024 * 1024; // a file larger than this is chosen as a whole, not place by place

/// The two lines to be joined, as they were last fetched, and the join of them in memory.
fn joining(repo: &Repository) -> Res<(String, git2::Commit<'_>, git2::Commit<'_>, git2::Index)> {
    let branch = repo.head().map_err(say)?.name().map_err(say)?.to_string();
    let theirs_name = format!("refs/remotes/{REMOTE}/{}", branch.trim_start_matches("refs/heads/"));
    let ours = repo.find_commit(repo.refname_to_id(&branch).map_err(say)?).map_err(say)?;
    let theirs = repo.find_commit(repo.refname_to_id(&theirs_name).map_err(say)?).map_err(say)?;
    let joined = repo.merge_commits(&ours, &theirs, None).map_err(say)?;
    Ok((branch, ours, theirs, joined))
}

fn text_of(repo: &Repository, entry: Option<&IndexEntry>) -> Option<String> {
    let blob = repo.find_blob(entry?.id).ok()?;
    let bytes = blob.content();
    if bytes.len() > TEXT_LIMIT || bytes.contains(&0) {
        return None;
    }
    String::from_utf8(bytes.to_vec()).ok()
}

/// A file merged with the places that differ marked, cut into parts: { same } where both
/// sides agree (or only one changed), { mine, theirs, base } where both changed.
fn parts(merged: &str) -> Vec<Value> {
    let line_of = |c: char| c.to_string().repeat(MARK as usize);
    let (open, base, mid, close) = (line_of('<'), line_of('|'), line_of('='), line_of('>'));
    let mut out = vec![];
    let (mut same, mut mine, mut was, mut theirs) = (String::new(), String::new(), String::new(), String::new());
    let mut at = 0; // 0: both agree, 1: mine, 2: what it was, 3: theirs
    for line in merged.split_inclusive('\n') {
        if at == 0 && line.starts_with(&open) {
            if !same.is_empty() {
                out.push(json!({ "same": std::mem::take(&mut same) }));
            }
            at = 1;
        } else if at == 1 && line.starts_with(&base) {
            at = 2;
        } else if (at == 1 || at == 2) && line.trim_end() == mid {
            at = 3;
        } else if at == 3 && line.starts_with(&close) {
            out.push(json!({ "mine": std::mem::take(&mut mine), "base": std::mem::take(&mut was), "theirs": std::mem::take(&mut theirs) }));
            at = 0;
        } else {
            [&mut same, &mut mine, &mut was, &mut theirs][at].push_str(line);
        }
    }
    if !same.is_empty() {
        out.push(json!({ "same": same }));
    }
    out
}

/// Who a line's last commit is by, for the page: the device it names (else its author), and when.
fn by(commit: &git2::Commit) -> Value {
    let device = commit.message().unwrap_or("").lines().rev().find_map(|l| l.strip_prefix("Device: ").map(|d| d.trim().to_string()));
    json!({ "device": device.unwrap_or_else(|| commit.author().name().unwrap_or("").to_string()), "time": commit.time().seconds() })
}

/// What stands in the way of joining the project with its other side, for the user to say:
/// { theirs (the commit there this was worked out against), mine: { device, time }, their:
/// { device, time }, files: [{ path, kind, mine, theirs, parts }] }. kind "text": parts, as
/// above — a choice for every place; kind "file": one side or the other as a whole (not text,
/// or deleted on one side — mine / theirs false: not there on that side). Nothing is changed.
pub fn conflicts(root: &Path) -> Res<Value> {
    let repo = Repository::open(root).map_err(say)?;
    let (_, ours, theirs, joined) = joining(&repo)?;
    let mut files = vec![];
    for c in joined.conflicts().map_err(say)?.flatten() {
        let Some(path) = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref()).map(|e| String::from_utf8_lossy(&e.path).into_owned()) else { continue };
        let (mine, their) = (text_of(&repo, c.our.as_ref()), text_of(&repo, c.their.as_ref()));
        let mut file = json!({ "path": path, "kind": "file", "mine": c.our.is_some(), "theirs": c.their.is_some() });
        if let (Some(mine), Some(their), Some(o), Some(t)) = (&mine, &their, &c.our, &c.their) {
            let mut opts = MergeFileOptions::new();
            opts.marker_size(MARK).style_diff3(true);
            let merged = match &c.ancestor {
                Some(a) => repo.merge_file_from_index(a, o, t, Some(&mut opts)).ok().and_then(|m| String::from_utf8(m.content().to_vec()).ok()),
                None => None,
            };
            file["kind"] = json!("text");
            file["parts"] = match merged {
                Some(m) => json!(parts(&m)),
                None => json!([{ "mine": mine, "base": "", "theirs": their }]), // (made on both sides: the whole of it is the place)
            };
        }
        files.push(file);
    }
    files.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(json!({ "theirs": theirs.id().to_string(), "mine": by(&ours), "their": by(&theirs), "files": files }))
}

fn entry(path: &[u8], id: Oid, mode: u32) -> IndexEntry {
    let zero = IndexTime::new(0, 0);
    IndexEntry { ctime: zero, mtime: zero, dev: 0, ino: 0, mode, uid: 0, gid: 0, file_size: 0, id, flags: 0, flags_extended: 0, path: path.to_vec() }
}

/// The name a file gets beside the one it would have: "Note (device).md".
fn beside(path: &str, device: &str) -> String {
    let device: String = device.split(" (").next().unwrap_or("").chars().filter(|c| !"/\\:".contains(*c)).collect();
    let (dir, name) = path.rsplit_once('/').map_or(("", path), |(d, n)| (d, n));
    let (stem, ext) = name.rsplit_once('.').filter(|(s, _)| !s.is_empty()).map_or((name, String::new()), |(s, e)| (s, format!(".{e}")));
    format!("{}{}{stem} ({}){ext}", dir, if dir.is_empty() { "" } else { "/" }, if device.is_empty() { "other device" } else { &device })
}

/// The user said how it is to be: for every file in conflict a pick — { text } (what the file
/// is to be), or { take: "mine" | "theirs" | "both" } (both: theirs beside mine, under a name
/// with their device in it). Joined with those, the folder follows and it goes over. expect:
/// the commit of the other side the picks were made against; if that is not the one fetched
/// last, nothing is done and the user looks again.
pub fn resolve(root: &Path, expect: &str, picks: &serde_json::Map<String, Value>, access: &Access, stamp: &Stamp) -> Standing {
    match resolve_in(root, expect, picks, stamp) {
        Ok(true) => reconcile(root, access, stamp),
        Ok(false) => Standing::Refused("the folder changed meanwhile".into()),
        Err(e) => Standing::Refused(e),
    }
}

fn resolve_in(root: &Path, expect: &str, picks: &serde_json::Map<String, Value>, stamp: &Stamp) -> Res<bool> {
    history::snapshot(root, stamp)?;
    let repo = Repository::open(root).map_err(say)?;
    let (branch, ours, theirs, mut joined) = joining(&repo)?;
    if theirs.id().to_string() != expect {
        return Err("the other side has changed since: look again".into());
    }
    let their_device = by(&theirs)["device"].as_str().unwrap_or("").to_string();
    let found: Vec<git2::IndexConflict> = joined.conflicts().map_err(say)?.flatten().collect();
    for c in found {
        let Some(path) = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref()).map(|e| e.path.clone()) else { continue };
        let name = String::from_utf8_lossy(&path).into_owned();
        let pick = picks.get(&name).ok_or_else(|| format!("nothing said for {name}"))?;
        let mode = c.our.as_ref().or(c.their.as_ref()).map_or(0o100644, |e| e.mode);
        joined.conflict_remove(Path::new(&name)).map_err(say)?;
        let put = |joined: &mut git2::Index, e: IndexEntry| joined.add(&e).map_err(say);
        if let Some(text) = pick["text"].as_str() {
            put(&mut joined, entry(&path, repo.blob(text.as_bytes()).map_err(say)?, mode))?;
            continue;
        }
        match (pick["take"].as_str(), &c.our, &c.their) {
            (Some("mine"), Some(o), _) => put(&mut joined, entry(&path, o.id, o.mode))?,
            (Some("theirs"), _, Some(t)) => put(&mut joined, entry(&path, t.id, t.mode))?,
            (Some("mine"), None, _) | (Some("theirs"), _, None) => {} // (deleted on that side: gone)
            (Some("both"), Some(o), Some(t)) => {
                put(&mut joined, entry(&path, o.id, o.mode))?;
                put(&mut joined, entry(beside(&name, &their_device).as_bytes(), t.id, t.mode))?;
            }
            (Some("both"), Some(e), None) | (Some("both"), None, Some(e)) => put(&mut joined, entry(&path, e.id, e.mode))?, // (the one that is there)
            _ => return Err(format!("nothing said for {name}")),
        }
    }
    if joined.has_conflicts() {
        return Err("not everything is said".into());
    }
    join(&repo, &branch, &ours, &theirs, &mut joined, stamp)
}

fn push_or(root: &Path, access: &Access, done: Standing) -> Res<Standing> {
    Ok(match push(root, access) {
        Ok(()) => done,
        Err(why) => Standing::Unreachable(why),
    })
}

/// How many commits `from` has that `not` has not.
fn count(repo: &Repository, from: Oid, not: Option<Oid>) -> usize {
    let Ok(mut walk) = repo.revwalk() else { return 0 };
    if walk.push(from).is_err() {
        return 0;
    }
    if let Some(not) = not {
        let _ = walk.hide(not);
    }
    walk.count()
}

/// The folder (and the index) become what a tree has — only where the folder still is what
/// the last commit has: a file changed since is never written over (then nothing is done).
fn checkout(repo: &Repository, tree: &git2::Tree) -> bool {
    let mut safe = CheckoutBuilder::new();
    safe.safe();
    repo.checkout_tree(tree.as_object(), Some(&mut safe)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Dir {
            let d = std::env::temp_dir().join(format!("mdview-sync-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&d).unwrap();
            Dir(d.canonicalize().unwrap())
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn stamp(device: &str) -> Stamp {
        Stamp { device: format!("{device} (1234)"), client: "desktop test".into(), author: Some(("Tester".into(), "tester@example.invalid".into())) }
    }

    fn head(root: &Path, name: &str) -> Option<String> {
        Repository::open(root).ok()?.refname_to_id(name).ok().map(|id| id.to_string())
    }

    /// The other side (a repository without a folder, as GitHub's is), and one device's project linked to it.
    fn pair(d: &Dir) -> (PathBuf, PathBuf) {
        let (hub, a) = (d.0.join("hub.git"), d.0.join("a"));
        let mut bare = git2::RepositoryInitOptions::new();
        bare.bare(true).initial_head("main"); // (as GitHub: the branch first pushed is the one a clone gets)
        Repository::init_opts(&hub, &bare).unwrap();
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("note.md"), "one\n").unwrap();
        history::enable(&a).unwrap();
        history::snapshot(&a, &stamp("a")).unwrap();
        link(&a, hub.to_str().unwrap()).unwrap();
        (hub, a)
    }

    #[test]
    fn a_project_is_pushed_and_another_device_gets_it() {
        let d = Dir::new();
        let (hub, a) = pair(&d);
        let none = Access::default();
        assert_eq!(linked(&a).as_deref(), hub.to_str());
        assert!(branches(hub.to_str().unwrap(), &none).unwrap().is_empty()); // (empty yet)
        push(&a, &none).unwrap();
        assert_eq!(branches(hub.to_str().unwrap(), &none).unwrap(), ["main"]);
        assert_eq!(head(&hub, "refs/heads/main"), head(&a, "HEAD"));

        // another device: the repository fetched into a new folder is the same project
        let b = d.0.join("b");
        Repository::clone(hub.to_str().unwrap(), &b).unwrap();
        assert_eq!(history::place_of(&b), history::Place::Project(b.clone()));
        assert_eq!(fs::read(b.join(".mdview/project.json")).unwrap(), fs::read(a.join(".mdview/project.json")).unwrap());
        fs::write(b.join("note.md"), "two\n").unwrap();
        history::snapshot(&b, &stamp("b")).unwrap();
        push(&b, &none).unwrap();

        // back on the first: fetched, it knows of the other's commit and its folder is untouched
        fetch(&a, &none).unwrap();
        assert_eq!(head(&a, "refs/remotes/origin/main"), head(&b, "HEAD"));
        assert_ne!(head(&a, "HEAD"), head(&b, "HEAD"));
        assert_eq!(fs::read_to_string(a.join("note.md")).unwrap(), "one\n");
    }

    #[test]
    fn a_push_over_commits_not_had_here_is_refused() {
        let d = Dir::new();
        let (hub, a) = pair(&d);
        let none = Access::default();
        push(&a, &none).unwrap();
        let b = d.0.join("b");
        Repository::clone(hub.to_str().unwrap(), &b).unwrap();
        fs::write(b.join("note.md"), "theirs\n").unwrap();
        history::snapshot(&b, &stamp("b")).unwrap();
        push(&b, &none).unwrap();
        fs::write(a.join("note.md"), "mine\n").unwrap();
        history::snapshot(&a, &stamp("a")).unwrap();
        assert!(push(&a, &none).is_err());
        assert_eq!(head(&hub, "refs/heads/main"), head(&b, "HEAD")); // (the other side is as it was)
    }

    #[test]
    fn without_a_link_nothing_is_fetched_or_pushed() {
        let d = Dir::new();
        let a = d.0.join("a");
        fs::create_dir_all(&a).unwrap();
        fs::write(a.join("note.md"), "one\n").unwrap();
        history::enable(&a).unwrap();
        history::snapshot(&a, &stamp("a")).unwrap();
        assert_eq!(linked(&a), None);
        assert!(fetch(&a, &Access::default()).is_err() && push(&a, &Access::default()).is_err());
    }

    fn write(root: &Path, name: &str, text: &str) {
        let p = root.join(name);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }
    fn read(root: &Path, name: &str) -> String {
        fs::read_to_string(root.join(name)).unwrap_or_default()
    }
    fn clean(root: &Path) -> bool {
        let repo = Repository::open(root).unwrap();
        let mut all = git2::StatusOptions::new();
        all.include_untracked(true).include_ignored(false).recurse_untracked_dirs(true);
        let n = repo.statuses(Some(&mut all)).unwrap().len();
        n == 0
    }
    /// Two devices with the same project, both even with the other side.
    fn devices(d: &Dir) -> (PathBuf, PathBuf, PathBuf) {
        let (hub, a) = pair(d);
        write(&a, "note.md", "first line\n\nmiddle\n\nlast line\n");
        write(&a, "other.md", "other\n");
        assert_eq!(reconcile(&a, &Access::default(), &stamp("a")), Standing::Pushed(2));
        let b = d.0.join("b");
        Repository::clone(hub.to_str().unwrap(), &b).unwrap();
        (hub, a, b)
    }
    fn sync(root: &Path, device: &str) -> Standing {
        reconcile(root, &Access::default(), &stamp(device))
    }

    #[test]
    fn what_one_device_keeps_the_other_gets() {
        let d = Dir::new();
        let (hub, a, b) = devices(&d);
        assert_eq!(sync(&a, "a"), Standing::Even);
        write(&b, "note.md", "first line\n\nmiddle, changed on b\n\nlast line\n");
        write(&b, "new on b.md", "new\n");
        fs::remove_file(b.join("other.md")).unwrap();
        assert_eq!(sync(&b, "b"), Standing::Pushed(1)); // (what waited was kept first, then went over)
        assert_eq!(head(&hub, "refs/heads/main"), head(&b, "HEAD"));
        assert_eq!(sync(&a, "a"), Standing::Pulled(1));
        assert_eq!(read(&a, "note.md"), "first line\n\nmiddle, changed on b\n\nlast line\n");
        assert_eq!(read(&a, "new on b.md"), "new\n");
        assert!(!a.join("other.md").exists()); // (deleted there: gone here)
        assert!(clean(&a) && head(&a, "HEAD") == head(&b, "HEAD"));
        assert_eq!(sync(&a, "a"), Standing::Even);
        // the version made on b is in a's history of the note, with b's name
        let versions = history::log(&a.join("note.md")).unwrap();
        assert_eq!(versions[0]["device"], "b (1234)");
    }

    #[test]
    fn both_changed_other_things_and_are_joined() {
        let d = Dir::new();
        let (hub, a, b) = devices(&d);
        write(&b, "note.md", "first line, b\n\nmiddle\n\nlast line\n");
        write(&b, "from b.md", "b\n");
        assert_eq!(sync(&b, "b"), Standing::Pushed(1));
        write(&a, "note.md", "first line\n\nmiddle\n\nlast line, a\n"); // (the same note, another place)
        write(&a, "other.md", "other, a\n");
        assert_eq!(sync(&a, "a"), Standing::Merged(1));
        assert_eq!(read(&a, "note.md"), "first line, b\n\nmiddle\n\nlast line, a\n");
        assert_eq!((read(&a, "from b.md").as_str(), read(&a, "other.md").as_str()), ("b\n", "other, a\n"));
        assert!(clean(&a));
        let repo = Repository::open(&a).unwrap();
        let top = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(top.parent_count(), 2);
        assert!(top.message().unwrap().contains("Device: a (1234)"));
        assert_eq!(head(&hub, "refs/heads/main"), head(&a, "HEAD")); // (and it went over)
        assert_eq!(sync(&b, "b"), Standing::Pulled(2)); // (a's commit and the joining one)
        assert_eq!(read(&b, "note.md"), read(&a, "note.md"));
        assert_eq!(sync(&a, "a"), Standing::Even);
        // the note's history has both devices' versions, each once
        let by: Vec<String> = history::log(&a.join("note.md")).unwrap().iter().map(|v| v["device"].as_str().unwrap().to_string()).collect();
        assert!(by.contains(&"a (1234)".to_string()) && by.contains(&"b (1234)".to_string()), "{by:?}");
    }

    #[test]
    fn both_changed_the_same_place_and_nothing_is_touched() {
        let d = Dir::new();
        let (hub, a, b) = devices(&d);
        write(&b, "note.md", "first line\n\nmiddle as b has it\n\nlast line\n");
        assert_eq!(sync(&b, "b"), Standing::Pushed(1));
        write(&a, "note.md", "first line\n\nmiddle as a has it\n\nlast line\n");
        write(&a, "other.md", "other, a\n");
        let there = head(&hub, "refs/heads/main");
        assert_eq!(sync(&a, "a"), Standing::Conflict(vec!["note.md".into()]));
        assert_eq!(read(&a, "note.md"), "first line\n\nmiddle as a has it\n\nlast line\n"); // (no markers, nothing of theirs)
        assert!(clean(&a)); // (what a wrote is kept as its own commit)
        assert_eq!(head(&hub, "refs/heads/main"), there); // (nothing went over)
        // working goes on, and it is still to be said
        write(&a, "other.md", "more\n");
        assert_eq!(sync(&a, "a"), Standing::Conflict(vec!["note.md".into()]));
        assert_eq!(history::log(&a.join("other.md")).unwrap().len(), 3);
    }

    #[test]
    fn a_side_that_cannot_be_reached_or_is_another_project_changes_nothing() {
        let d = Dir::new();
        let (hub, a, _b) = devices(&d);
        write(&a, "note.md", "written without a net\n");
        let hidden = d.0.join("away.git");
        fs::rename(&hub, &hidden).unwrap();
        assert!(matches!(sync(&a, "a"), Standing::Unreachable(_)));
        assert!(clean(&a) && history::log(&a.join("note.md")).unwrap().len() == 3); // (kept here all the same)
        fs::rename(&hidden, &hub).unwrap();
        assert_eq!(sync(&a, "a"), Standing::Pushed(1)); // (and goes over when the net is back)

        // a project linked to a repository that holds another one
        let c = d.0.join("c");
        write(&c, "mine.md", "mine\n");
        history::enable(&c).unwrap();
        link(&c, hub.to_str().unwrap()).unwrap();
        let there = head(&hub, "refs/heads/main");
        assert!(matches!(sync(&c, "c"), Standing::Refused(_)));
        assert_eq!(head(&hub, "refs/heads/main"), there);
        assert_eq!(read(&c, "mine.md"), "mine\n");
        // not linked at all
        let e = d.0.join("e");
        write(&e, "x.md", "x\n");
        history::enable(&e).unwrap();
        assert!(matches!(sync(&e, "e"), Standing::Refused(_)));
    }

    /// a and b changed the same place of note.md (and a picture, and a deleted b / changed a file).
    fn at_odds(d: &Dir) -> (PathBuf, PathBuf, PathBuf) {
        let (hub, a, b) = devices(d);
        fs::write(a.join("pic.png"), [0u8, 1, 2, 3]).unwrap();
        write(&a, "gone.md", "to be deleted there\n");
        assert_eq!(sync(&a, "a"), Standing::Pushed(1));
        assert_eq!(sync(&b, "b"), Standing::Pulled(1));
        write(&b, "note.md", "first line\n\nmiddle as b has it\n\nlast line, b\n");
        fs::write(b.join("pic.png"), [0u8, 9, 9, 9]).unwrap();
        fs::remove_file(b.join("gone.md")).unwrap();
        assert_eq!(sync(&b, "b"), Standing::Pushed(1));
        write(&a, "note.md", "first line, a\n\nmiddle as a has it\n\nlast line\n");
        fs::write(a.join("pic.png"), [0u8, 7, 7, 7]).unwrap();
        write(&a, "gone.md", "changed here\n");
        assert_eq!(sync(&a, "a"), Standing::Conflict(vec!["gone.md".into(), "note.md".into(), "pic.png".into()]));
        (hub, a, b)
    }

    #[test]
    fn a_conflict_is_shown_place_by_place() {
        let d = Dir::new();
        let (_hub, a, _b) = at_odds(&d);
        let all = conflicts(&a).unwrap();
        assert_eq!((all["mine"]["device"].as_str(), all["their"]["device"].as_str()), (Some("a (1234)"), Some("b (1234)")));
        let files = all["files"].as_array().unwrap();
        assert_eq!(files.iter().map(|f| (f["path"].as_str().unwrap(), f["kind"].as_str().unwrap())).collect::<Vec<_>>(), [("gone.md", "file"), ("note.md", "text"), ("pic.png", "file")]);
        assert_eq!((files[0]["mine"].as_bool(), files[0]["theirs"].as_bool()), (Some(true), Some(false))); // (deleted there)
        // the note: what only one side changed is already joined, the place both changed is to be said
        let parts = files[1]["parts"].as_array().unwrap();
        let odds: Vec<&Value> = parts.iter().filter(|p| p["same"].is_null()).collect();
        assert_eq!(odds.len(), 1);
        assert_eq!((odds[0]["mine"].as_str(), odds[0]["theirs"].as_str(), odds[0]["base"].as_str()), (Some("middle as a has it\n"), Some("middle as b has it\n"), Some("middle\n")));
        let agreed: String = parts.iter().filter_map(|p| p["same"].as_str()).collect();
        assert_eq!(agreed, "first line, a\n\n\nlast line, b\n");
        assert_eq!(read(&a, "note.md"), "first line, a\n\nmiddle as a has it\n\nlast line\n"); // (looking changes nothing)
    }

    #[test]
    fn a_conflict_resolved_is_joined_and_goes_over() {
        let d = Dir::new();
        let (hub, a, b) = at_odds(&d);
        let all = conflicts(&a).unwrap();
        let expect = all["theirs"].as_str().unwrap();
        let picks = json!({
            "note.md": { "text": "first line, a\n\nmiddle as both have it\n\nlast line, b\n" },
            "pic.png": { "take": "both" },
            "gone.md": { "take": "theirs" },
        });
        let picks = picks.as_object().unwrap();
        // not all said, or said against another state of the other side: nothing happens
        let mut some = picks.clone();
        some.remove("pic.png");
        assert!(matches!(resolve(&a, expect, &some, &Access::default(), &stamp("a")), Standing::Refused(_)));
        assert!(matches!(resolve(&a, "0000000000000000000000000000000000000000", picks, &Access::default(), &stamp("a")), Standing::Refused(_)));
        assert_eq!(read(&a, "note.md"), "first line, a\n\nmiddle as a has it\n\nlast line\n");

        assert_eq!(resolve(&a, expect, picks, &Access::default(), &stamp("a")), Standing::Pushed(2));
        assert_eq!(read(&a, "note.md"), "first line, a\n\nmiddle as both have it\n\nlast line, b\n");
        assert_eq!(fs::read(a.join("pic.png")).unwrap(), [0u8, 7, 7, 7]); // (mine where it was)
        assert_eq!(fs::read(a.join("pic (b).png")).unwrap(), [0u8, 9, 9, 9]); // (theirs beside it)
        assert!(!a.join("gone.md").exists()); // (theirs: deleted)
        assert!(clean(&a));
        assert_eq!(head(&hub, "refs/heads/main"), head(&a, "HEAD"));
        assert_eq!(sync(&a, "a"), Standing::Even);
        assert_eq!(sync(&b, "b"), Standing::Pulled(2));
        assert_eq!(read(&b, "note.md"), read(&a, "note.md"));
        assert!(b.join("pic (b).png").exists());
    }

    #[test]
    fn names_for_a_file_kept_beside_another() {
        assert_eq!(beside("pic.png", "b (1234)"), "pic (b).png");
        assert_eq!(beside("deep/sub/Note.md", "Henri's Laptop (x)"), "deep/sub/Note (Henri's Laptop).md");
        assert_eq!(beside("README", ""), "README (other device)");
        assert_eq!(beside(".hidden", "a/b"), ".hidden (ab)");
    }

    /// The transport over HTTPS, against the real GitHub: a public repository's branches are
    /// read without signing in, and a private address without a token is refused, not waited
    /// for. Needs the network — cargo test --release network -- --ignored
    #[test]
    #[ignore]
    fn network_https_reaches_github() {
        let none = Access::default();
        assert!(!branches("https://github.com/libgit2/libgit2", &none).unwrap().is_empty());
        assert!(branches("https://github.com/henriSchulz/a-repository-that-is-not-there", &none).is_err());
        let wrong = Access { token: Some("not-a-token".into()) };
        assert!(branches("https://github.com/henriSchulz/a-repository-that-is-not-there", &wrong).is_err());
    }
}
