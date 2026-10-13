//! A project's pasteboard: one text for a project that is linked to a repository on GitHub, the
//! same on every device that shows it — to carry something from one to another. It is no file
//! and in no version: the web app's server keeps it (web/lib/paste.ts), and the page asks for
//! it and writes it through here (overview.js: paste-get, paste-put). The server knows the
//! application by the token of its sign-in with GitHub, which it asks GitHub about.
//!
//! Every asking is a thread of its own — one that waits for the next text may wait half a
//! minute — and its answer comes back as an event, for the window that asked.

use std::path::Path;
use std::sync::mpsc::Sender;
use std::time::Duration;

use serde_json::{json, Value};

use crate::history::{self, Place};
use crate::{share, Event};

/// Whose pasteboard a folder has: the repository its project is linked to. None: no project, or
/// not linked.
pub fn place(folder: &Path) -> Option<(String, String)> {
    match history::place_of(folder) {
        Place::Project(root) => share::repo(&root),
        _ => None,
    }
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

fn tell(tx: &Sender<Event>, label: String, mut said: Value, n: Value, put: bool) {
    said["n"] = n;
    if put {
        said["put"] = json!(true);
    }
    let _ = tx.send(Event::Paste { label, said });
}

/// What stands on the pasteboard — with `wait`, once it is another text than rev `rev`.
pub fn get(tx: Sender<Event>, label: String, n: Value, at: (String, String), token: String, rev: u64, wait: bool) {
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(if wait { 45 } else { 15 })).build();
        let asked = agent.get(&url(&at)).query("rev", &rev.to_string()).set("Authorization", &format!("Bearer {token}"));
        let said = match if wait { asked.query("wait", "1") } else { asked }.call() {
            Ok(res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["text"].is_string() && now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "text": now["text"], "rev": now["rev"] })),
            Err(e) => refused(e),
        };
        tell(&tx, label, said, n, false);
    });
}

/// The pasteboard written, from rev `base`: taken (its new rev), or not (what stands there instead).
pub fn put(tx: Sender<Event>, label: String, n: Value, at: (String, String), token: String, text: String, base: u64, by: String) {
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
        let body = json!({ "text": text, "base": base, "by": by }).to_string();
        let said = match agent.put(&url(&at)).set("Authorization", &format!("Bearer {token}")).set("Content-Type", "application/json").send_string(&body) {
            Ok(res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "rev": now["rev"] })),
            Err(e) => refused(e),
        };
        tell(&tx, label, said, n, true);
    });
}
