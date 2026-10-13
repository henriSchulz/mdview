//! A project's pasteboard: one text for a project that is linked to a repository on GitHub, the
//! same on every device that shows it — to carry something from one to another. It is no file
//! and in no version: the web app's server keeps it (web/lib/paste.ts), and the page asks for
//! it and writes it through here (overview.js: paste-get, paste-put). The server knows the
//! application by the token of its sign-in with GitHub, which it asks GitHub about.
//!
//! Every asking is a thread of its own — one that waits for the next text may wait half a
//! minute — and its answer comes back as an event, for the window that asked.
//!
//! What the server says stands on the pasteboard is written into the project as well
//! (.mdview/pasteboard.md), for who reads the folder and not the window — an agent at work in
//! it. A copy: nothing reads it back, and the history leaves it out (.git/info/exclude).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

use crate::history::{self, Place};
use crate::{share, Event};

/// The copy of the pasteboard in a project, as the pasteboard last stood while a window showed it.
pub const FILE: &str = ".mdview/pasteboard.md";
const LEFT_OUT: &str = "/.mdview/pasteboard.md*";

/// The rev each project's copy was last written at: of two answers, the later text stays.
static KEPT: Mutex<Option<HashMap<PathBuf, u64>>> = Mutex::new(None);

/// Whose pasteboard a folder has: the project, and the repository it is linked to. None: no
/// project, or not linked.
pub fn place(folder: &Path) -> Option<(PathBuf, (String, String))> {
    match history::place_of(folder) {
        Place::Project(root) => share::repo(&root).map(|at| (root, at)),
        _ => None,
    }
}

/// Is this the pasteboard's copy (or the file it is written as first)? Its changing is no change
/// of the project.
pub fn is_copy(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("pasteboard.md")) && path.parent().is_some_and(|d| d.ends_with(".mdview"))
}

/// The pasteboard as it stands at rev `rev`, written into the project — once the history is told
/// to leave it out; where it cannot be told, there is no copy.
pub fn keep(root: &Path, text: &str, rev: u64) {
    let mut kept = KEPT.lock().unwrap();
    let kept = kept.get_or_insert_with(HashMap::new);
    if kept.get(root).is_some_and(|&last| last > rev) {
        return;
    }
    kept.insert(root.to_path_buf(), rev);
    let file = root.join(FILE);
    if fs::read_to_string(&file).is_ok_and(|now| now == text) || leave_out(root).is_err() {
        return;
    }
    let part = root.join(format!("{FILE}.part"));
    if fs::write(&part, text).and_then(|()| fs::rename(&part, &file)).is_err() {
        let _ = fs::remove_file(&part);
    }
}

fn leave_out(root: &Path) -> std::io::Result<()> {
    let repo = git2::Repository::open(root).map_err(std::io::Error::other)?;
    let info = repo.path().join("info");
    let list = info.join("exclude");
    let now = fs::read_to_string(&list).unwrap_or_default();
    if now.lines().any(|l| l.trim() == LEFT_OUT) {
        return Ok(());
    }
    fs::create_dir_all(&info)?;
    fs::write(&list, format!("{now}{}{LEFT_OUT}\n", if now.is_empty() || now.ends_with('\n') { "" } else { "\n" }))
}

fn url(at: &(String, String)) -> String {
    format!("{}/paste/{}/{}", share::web(), crate::scan::quote(&at.0), crate::scan::quote(&at.1))
}

/// What the page is told where the server did not answer with a text.
fn refused(e: ureq::Error) -> Value {
    match e {
        ureq::Error::Status(401, _) => json!({ "error": "signin" }),
        ureq::Error::Status(404, _) => json!({ "error": "missing" }),
        ureq::Error::Status(413, _) => json!({ "error": "large" }),
        // (written from another text than stands there: what does)
        ureq::Error::Status(409, res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["text"].is_string() && now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "text": now["text"], "rev": now["rev"] })),
        _ => json!({ "error": "unreachable" }),
    }
}

/// An answer's text into the project's copy — `put`: the text that was written, where the answer
/// is that it was taken (and names no text of its own).
fn copy(root: &Path, said: &Value, put: Option<&str>) {
    if let (Some(text), Some(rev)) = (said["text"].as_str().or(put), said["rev"].as_u64()) {
        keep(root, text, rev);
    }
}

fn tell(tx: &Sender<Event>, label: String, mut said: Value, n: Value, put: bool) {
    said["n"] = n;
    if put {
        said["put"] = json!(true);
    }
    let _ = tx.send(Event::Paste { label, said });
}

/// What stands on the pasteboard — with `wait`, once it is another text than rev `rev`.
pub fn get(tx: Sender<Event>, label: String, n: Value, root: PathBuf, at: (String, String), token: String, rev: u64, wait: bool) {
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(if wait { 45 } else { 15 })).build();
        let asked = agent.get(&url(&at)).query("rev", &rev.to_string()).set("Authorization", &format!("Bearer {token}"));
        let said = match if wait { asked.query("wait", "1") } else { asked }.call() {
            Ok(res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["text"].is_string() && now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "text": now["text"], "rev": now["rev"] })),
            Err(e) => refused(e),
        };
        copy(&root, &said, None);
        tell(&tx, label, said, n, false);
    });
}

/// The pasteboard written, from rev `base`: taken (its new rev), or not (what stands there instead).
pub fn put(tx: Sender<Event>, label: String, n: Value, root: PathBuf, at: (String, String), token: String, text: String, base: u64, by: String) {
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
        let body = json!({ "text": text, "base": base, "by": by }).to_string();
        let said = match agent.put(&url(&at)).set("Authorization", &format!("Bearer {token}")).set("Content-Type", "application/json").send_string(&body) {
            Ok(res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "rev": now["rev"] })),
            Err(e) => refused(e),
        };
        copy(&root, &said, Some(&text));
        tell(&tx, label, said, n, true);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::history::{enable, snapshot, Stamp};

    #[test]
    fn the_copy_is_written_and_no_version_has_it() {
        let d = std::env::temp_dir().join(format!("mdview-paste-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("a.md"), "one\n").unwrap();
        enable(&d).unwrap();
        let stamp = Stamp { device: "test".into(), client: "test".into(), author: None };
        snapshot(&d, &stamp).unwrap();
        keep(&d, "carried over\n", 3);
        assert_eq!(fs::read_to_string(d.join(FILE)).unwrap(), "carried over\n");
        assert!(is_copy(&d.join(FILE)) && is_copy(&d.join(format!("{FILE}.part"))) && !is_copy(&d.join("pasteboard.md")));
        assert!(snapshot(&d, &stamp).unwrap().commit.is_none()); // (nothing changed, as the history sees it)
        assert_eq!(crate::history::overview(&d)["changed"], 0);
        keep(&d, "an answer that came late", 2);
        assert_eq!(fs::read_to_string(d.join(FILE)).unwrap(), "carried over\n");
        keep(&d, "", 4); // (cleared)
        assert_eq!(fs::read_to_string(d.join(FILE)).unwrap(), "");
        keep(&d, "again", 5);
        assert_eq!(fs::read_to_string(d.join(".git/info/exclude")).unwrap().matches(LEFT_OUT).count(), 1);
        fs::remove_dir_all(&d).unwrap();
    }
}
