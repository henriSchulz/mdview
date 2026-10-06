//! Sharing a note: a link under which anyone can read it in the web app, with a password if
//! one is set — and nothing else of the project with it. What is shared stands in the project
//! itself, in .mdview/shares.json:
//!
//!   { "version": 1, "shares": { "<id>": { "path": "docs/Note.md", "created": "…",
//!       "password": null | { "salt": "<base64>", "hash": "<base64>", "iterations": 600000 } } } }
//!
//! The id is 128 random bits (the link is the secret); of a password only its PBKDF2-SHA256 is
//! kept. The web app reads the file from the project's repository on GitHub whenever a link is
//! used (web/lib/share.ts), so a share begins, changes and ends with the commit that says so
//! arriving there — and only a project linked to a repository on GitHub can share at all. The
//! web app writes the same file the same way (web/public/host/host.js).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Value};

use crate::history::{self, Place};
use crate::sync;

pub const FILE: &str = ".mdview/shares.json";
const ITERATIONS: u32 = 600_000;
/// Where the web app is (another: MDVIEW_WEB).
const WEB: &str = "https://mdview--md-view.europe-west4.hosted.app";
static GITHUB_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$").unwrap());

/// The project a note is in, and the note's path in it (as the repository names it).
fn place(path: &Path) -> Option<(PathBuf, String)> {
    let Place::Project(root) = history::place_of(path) else { return None };
    let rel = path.strip_prefix(&root).ok()?.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
    Some((root, rel))
}

/// The shares as the file has them, by id (read forgivingly: a file that cannot be read is none).
fn read(root: &Path) -> BTreeMap<String, Value> {
    let all: Value = fs::read_to_string(root.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    all["shares"].as_object().map(|m| m.iter().filter(|(_, e)| e["path"].is_string()).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default()
}

/// Written with the ids in order, as the web app writes it: two devices that each share a note
/// change different lines.
fn write(root: &Path, shares: &BTreeMap<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&json!({ "version": 1, "shares": shares })).map_err(|e| e.to_string())? + "\n";
    fs::create_dir_all(root.join(".mdview")).and_then(|()| fs::write(root.join(FILE), text)).map_err(|e| e.to_string())
}

fn find(shares: &BTreeMap<String, Value>, rel: &str) -> Option<String> {
    shares.iter().find(|(_, e)| e["path"] == rel).map(|(id, _)| id.clone())
}

fn web() -> String {
    std::env::var("MDVIEW_WEB").ok().filter(|w| !w.is_empty()).unwrap_or_else(|| WEB.to_string()).trim_end_matches('/').to_string()
}

/// A link's id that is free, as the web app says it: as short as there is room for (a letter or
/// digit, then two), and one id is one note across every repository — so it is asked for there
/// (web/lib/share.ts, freeId). None: the web app was not reached.
pub fn free_id() -> Option<String> {
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(5)).build();
    let said: Value = serde_json::from_str(&agent.get(&format!("{}/share/free", web())).call().ok()?.into_string().ok()?).ok()?;
    said["id"].as_str().filter(|id| !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())).map(String::from)
}

/// The web app is told that this project's list of shares has changed (it reads the list itself,
/// from the repository: nothing is handed over but the repository's name). Not waited for.
pub fn tell(root: &Path) {
    let Some((owner, repo)) = sync::linked(root).and_then(|url| GITHUB_RE.captures(&url).map(|m| (m[1].to_string(), m[2].to_string()))) else { return };
    let url = format!("{}/share/sync/{}/{}", web(), crate::scan::quote(&owner), crate::scan::quote(&repo));
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(15)).build();
        let _ = agent.post(&url).call();
    });
}

/// Whether the note is shared.
pub fn is_shared(path: &Path) -> bool {
    place(path).is_some_and(|(root, rel)| find(&read(&root), &rel).is_some())
}

/// An id where the web app could not be asked for one: ten letters and digits, at random.
fn new_id() -> String {
    const LETTERS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut out = String::new();
    while out.len() < 10 {
        // (248 = 4 × 62: every letter as likely as any other)
        out.extend(uuid::Uuid::new_v4().as_bytes().iter().filter(|b| **b < 248).map(|b| LETTERS[(*b % 62) as usize] as char));
    }
    out.truncate(10);
    out
}

fn hashed(password: &str) -> Value {
    let salt = *uuid::Uuid::new_v4().as_bytes();
    let mut hash = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha2::Sha256>(password.as_bytes(), &salt, ITERATIONS, &mut hash);
    json!({ "salt": STANDARD.encode(salt), "hash": STANDARD.encode(hash), "iterations": ITERATIONS })
}

/// Whether the file is at the project's other side as it is here (else a link does not show
/// yet what was set here).
pub fn arrived(root: &Path) -> bool {
    let there = || -> Option<Vec<u8>> {
        let repo = git2::Repository::open(root).ok()?;
        let branch = repo.head().ok()?.shorthand().ok().map(String::from)?;
        let tree = repo.find_reference(&format!("refs/remotes/{}/{branch}", sync::REMOTE)).ok()?.peel_to_tree().ok()?;
        let blob = repo.find_blob(tree.get_path(Path::new(FILE)).ok()?.id()).ok()?;
        Some(blob.content().to_vec())
    };
    match (fs::read(root.join(FILE)).ok(), there()) {
        (Some(here), Some(there)) => here == there,
        (None, None) => true,
        _ => false,
    }
}

/// The notes of a folder that are shared, by their paths — for the sidebar, which marks them.
pub fn listed(folder: &Path) -> Vec<String> {
    let (Place::Project(root), true) = (history::place_of(folder), folder.is_dir()) else { return vec![] };
    let mut all: Vec<String> = read(&root).values().filter_map(|e| e["path"].as_str()).map(|rel| root.join(rel)).filter(|p| p.starts_with(folder) && p.is_file()).map(|p| fs::canonicalize(&p).unwrap_or(p).to_string_lossy().into_owned()).collect();
    all.sort();
    all
}

/// How a note's sharing stands, for the page (active/share.js): { path, can, why, link,
/// password, pending }.
pub fn info(path: &Path) -> Value {
    let told = |can: bool, why: Option<&str>, link: Option<String>, password: bool, pending: bool| json!({ "path": path.to_string_lossy(), "can": can, "why": why, "link": link, "password": password, "pending": pending });
    let Some((root, rel)) = place(path) else { return told(false, Some("Turn the history on first: the clock in the sidebar."), None, false, false) };
    let at = sync::linked(&root).and_then(|url| GITHUB_RE.captures(&url).map(|m| (m[1].to_string(), m[2].to_string())));
    let Some(_) = at else { return told(false, Some("Link this project to a repository on GitHub first: Settings › History."), None, false, false) };
    let shares = read(&root);
    let Some(id) = find(&shares, &rel) else { return told(true, None, None, false, false) };
    told(true, None, Some(format!("{}/s/{id}", web())), !shares[&id]["password"].is_null(), !arrived(&root))
}

/// The note shared (if it was not: under the id given, where it is free here), and its password
/// set (Some(Some)), taken away (Some(None)) or left as it is (None). → the project, for its
/// snapshot.
pub fn set(path: &Path, password: Option<Option<&str>>, id: Option<String>) -> Result<PathBuf, String> {
    let (root, rel) = place(path).ok_or("not in a project")?;
    let mut shares = read(&root);
    let id = find(&shares, &rel).unwrap_or_else(|| id.filter(|id| !shares.contains_key(id)).unwrap_or_else(new_id));
    let entry = shares.entry(id).or_insert_with(|| json!({ "path": rel, "created": chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(), "password": null }));
    if let Some(p) = password {
        entry["password"] = p.filter(|p| !p.is_empty()).map_or(Value::Null, hashed);
    }
    write(&root, &shares)?;
    Ok(root)
}

/// The note shared no more. → the project, if anything changed.
pub fn stop(path: &Path) -> Result<Option<PathBuf>, String> {
    moved(path, None)
}

/// A note has another name, or is gone (None): what was shared of it follows, or ends. → the
/// project, if the file changed.
pub fn moved(old: &Path, new: Option<&Path>) -> Result<Option<PathBuf>, String> {
    let Some((root, rel)) = place(old) else { return Ok(None) };
    if !root.join(FILE).is_file() {
        return Ok(None);
    }
    let mut shares = read(&root);
    let Some(id) = find(&shares, &rel) else { return Ok(None) };
    match new.and_then(place) {
        Some((to, now)) if to == root => shares.get_mut(&id).unwrap()["path"] = json!(now),
        _ => { shares.remove(&id); }
    }
    write(&root, &shares)?;
    Ok(Some(root))
}

/// A folder has another path: what was shared of the notes in it follows. → the project, if the
/// file changed. (Both paths as they are now: the folder is moved already.)
pub fn moved_dir(old: &Path, new: &Path) -> Result<Option<PathBuf>, String> {
    let (Place::Project(root), Place::Project(to)) = (history::place_of(old.parent().unwrap_or(old)), history::place_of(new)) else { return Ok(None) };
    if !root.join(FILE).is_file() {
        return Ok(None);
    }
    let rel = |p: &Path| p.strip_prefix(&root).ok().map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"));
    let (Some(was), Some(now)) = (rel(old), rel(new).filter(|_| to == root)) else { return Ok(None) };
    let mut shares = read(&root);
    let mut changed = false;
    for entry in shares.values_mut() {
        let path = entry["path"].as_str().unwrap_or_default().to_string();
        if let Some(rest) = path.strip_prefix(&format!("{was}/")) {
            entry["path"] = json!(format!("{now}/{rest}"));
            changed = true;
        }
    }
    if !changed {
        return Ok(None);
    }
    write(&root, &shares)?;
    Ok(Some(root))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("mdview-share-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(d.join("docs")).unwrap();
        git2::Repository::init(&d).unwrap();
        fs::create_dir_all(d.join(".mdview")).unwrap();
        fs::write(d.join(".mdview/project.json"), "{}").unwrap();
        fs::write(d.join("docs/Note.md"), "# Note\n").unwrap();
        fs::canonicalize(d).unwrap()
    }

    #[test]
    fn shared_with_a_password_renamed_and_stopped() {
        let d = project("a");
        let note = d.join("docs/Note.md");
        assert_eq!(info(&note)["can"], false); // (not linked to GitHub)
        sync::link(&d, "https://github.com/octo/my notes.git").unwrap();
        assert_eq!(info(&note), json!({ "path": note.to_string_lossy(), "can": true, "why": null, "link": null, "password": false, "pending": false }));
        set(&note, Some(None), None).unwrap();
        let shares = read(&d);
        let id = find(&shares, "docs/Note.md").unwrap();
        assert!(id.len() == 10 && id.chars().all(|c| c.is_ascii_alphanumeric()));
        let told = info(&note);
        assert_eq!(told["link"], json!(format!("{WEB}/s/{id}")));
        assert_eq!((&told["password"], &told["pending"]), (&json!(false), &json!(true))); // (not at GitHub yet)
        // a password: what the web app works out again from the same password
        set(&note, Some(Some("sesame")), None).unwrap();
        let p = read(&d)[&id]["password"].clone();
        let (salt, mut again) = (STANDARD.decode(p["salt"].as_str().unwrap()).unwrap(), [0u8; 32]);
        pbkdf2::pbkdf2_hmac::<sha2::Sha256>(b"sesame", &salt, p["iterations"].as_u64().unwrap() as u32, &mut again);
        assert_eq!(STANDARD.encode(again), p["hash"]);
        assert_eq!(info(&note)["password"], true);
        set(&note, None, Some("x".into())).unwrap(); // (asked for again: the same link, the password left)
        assert_eq!((find(&read(&d), "docs/Note.md").unwrap(), read(&d)[&id]["password"].is_null()), (id.clone(), false));
        // the file as the web app writes it
        let text = fs::read_to_string(d.join(FILE)).unwrap();
        assert!(text.starts_with("{\n  \"version\": 1,\n  \"shares\": {\n    \"") && text.ends_with("}\n"));
        // renamed: the link follows; gone: it ends
        fs::rename(&note, d.join("Other.md")).unwrap();
        moved(&note, Some(&d.join("Other.md"))).unwrap();
        assert_eq!(read(&d)[&id]["path"], "Other.md");
        assert_eq!(stop(&d.join("Other.md")).unwrap(), Some(d.clone()));
        assert!(read(&d).is_empty());
        assert_eq!(stop(&d.join("Other.md")).unwrap(), None);
        // an id the web app said is taken as it is; one that is taken here already is not
        set(&d.join("Other.md"), None, Some("a".into())).unwrap();
        assert_eq!(find(&read(&d), "Other.md").unwrap(), "a");
        fs::write(d.join("docs/Second.md"), "# Second\n").unwrap();
        set(&d.join("docs/Second.md"), None, Some("a".into())).unwrap();
        assert_eq!(find(&read(&d), "docs/Second.md").unwrap().len(), 10);
        let _ = fs::remove_dir_all(d);
    }
}
