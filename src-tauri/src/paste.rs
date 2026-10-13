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
//!
//! `mdview paste` reads and writes it from a command line (cli). Who is signed in is known to
//! the running application alone, so the command hands what it wants to that one (a second
//! start does: `paste-for`, taken in shell/app.rs) and waits for the file it answers in.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

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

fn read(at: &(String, String), token: &str, rev: u64, wait: bool) -> Value {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(if wait { 45 } else { 15 })).build();
    let asked = agent.get(&url(at)).query("rev", &rev.to_string()).set("Authorization", &format!("Bearer {token}"));
    match if wait { asked.query("wait", "1") } else { asked }.call() {
        Ok(res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["text"].is_string() && now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "text": now["text"], "rev": now["rev"] })),
        Err(e) => refused(e),
    }
}

fn write(at: &(String, String), token: &str, text: &str, base: u64, by: &str) -> Value {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
    let body = json!({ "text": text, "base": base, "by": by }).to_string();
    match agent.put(&url(at)).set("Authorization", &format!("Bearer {token}")).set("Content-Type", "application/json").send_string(&body) {
        Ok(res) => res.into_string().ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).filter(|now| now["rev"].is_u64()).map_or(json!({ "error": "unreachable" }), |now| json!({ "rev": now["rev"] })),
        Err(e) => refused(e),
    }
}

/// What stands on the pasteboard — with `wait`, once it is another text than rev `rev`.
pub fn get(tx: Sender<Event>, label: String, n: Value, root: PathBuf, at: (String, String), token: String, rev: u64, wait: bool) {
    std::thread::spawn(move || {
        let said = read(&at, &token, rev, wait);
        copy(&root, &said, None);
        tell(&tx, label, said, n, false);
    });
}

/// The pasteboard written, from rev `base`: taken (its new rev), or not (what stands there instead).
pub fn put(tx: Sender<Event>, label: String, n: Value, root: PathBuf, at: (String, String), token: String, text: String, base: u64, by: String) {
    std::thread::spawn(move || {
        let said = write(&at, &token, &text, base, &by);
        copy(&root, &said, Some(&text));
        tell(&tx, label, said, n, true);
    });
}

// -- from a command line --------------------------------------------------------

/// When this program began: a command that started it waits a moment for the sign-in kept from
/// before to be taken up again.
pub static STARTED: LazyLock<Instant> = LazyLock::new(Instant::now);

const HELP: &str = "mdview paste                 what stands on the project's pasteboard
mdview paste TEXT…           TEXT put there, in place of what stands there
mdview paste -               the same, the text read from standard input
mdview paste --append TEXT…  TEXT added as a new line at its end (-a)
mdview paste --in FOLDER …   the pasteboard of the project FOLDER is in (without: the folder this is run in)

The project has to be linked to a repository on GitHub, and Markdown Notes signed in with it
(Settings › History). While the application shows the pasteboard, what stands on it is in the
project as well: .mdview/pasteboard.md.";

/// What a command line asked for, as the application is handed it:
/// `paste-for REPLY FOLDER read|write|append [TEXTFILE]`.
pub struct Asked {
    pub reply: PathBuf,
    pub folder: PathBuf,
    text: Option<PathBuf>,
    append: bool,
}

impl Asked {
    pub fn of(args: &[String]) -> Option<Asked> {
        let [reply, folder, what, rest @ ..] = args else { return None };
        let text = rest.first().map(PathBuf::from);
        (what == "read" || text.is_some()).then(|| Asked { reply: reply.into(), folder: folder.into(), text: text.filter(|_| what != "read"), append: what == "append" })
    }
}

/// The answer to a command line: the file it waits for, there whole or not at all.
pub fn answer(reply: &Path, said: &Value) {
    let part = reply.with_extension("part");
    let _ = fs::write(&part, said.to_string()).and_then(|()| fs::rename(&part, reply));
}

fn joined(now: &str, more: &str) -> String {
    format!("{now}{}{more}", if now.is_empty() || now.ends_with('\n') { "" } else { "\n" })
}

/// What a command line asked for, done: the pasteboard read — and written, from what was read;
/// written by someone else in between, once more from that.
pub fn command(asked: Asked, root: PathBuf, at: (String, String), token: String, by: String) {
    std::thread::spawn(move || {
        let mut now = read(&at, &token, 0, false);
        copy(&root, &now, None);
        let new = asked.text.as_ref().map(|file| {
            let text = fs::read_to_string(file);
            let _ = fs::remove_file(file);
            text
        });
        let said = match new {
            None => now,
            Some(Err(_)) => json!({ "error": "unreachable" }),
            Some(Ok(new)) => {
                let mut said = json!({ "error": "unreachable" });
                for _ in 0..4 {
                    let (Some(there), Some(rev)) = (now["text"].as_str(), now["rev"].as_u64()) else {
                        said = now;
                        break;
                    };
                    let text = if asked.append { joined(there, &new) } else { new.clone() };
                    said = write(&at, &token, &text, rev, &by);
                    copy(&root, &said, Some(&text));
                    if !said["text"].is_string() {
                        break; // (taken, or refused for good)
                    }
                    now = std::mem::replace(&mut said, json!({ "error": "unreachable" }));
                }
                said
            }
        };
        let mut said = said;
        said["repo"] = json!(format!("{}/{}", at.0, at.1));
        answer(&asked.reply, &said);
    });
}

/// `mdview paste …`: the running application is asked, and what it answers is said. The code
/// the program ends with: 0 done, 1 not done, 2 not understood.
pub fn cli(args: &[String]) -> i32 {
    let (mut append, mut stdin, mut folder, mut words, mut plain) = (false, false, None::<PathBuf>, vec![], false);
    let mut args = args.iter();
    while let Some(a) = args.next() {
        match a.as_str() {
            _ if plain => words.push(a.as_str()),
            "--" => plain = true,
            "-h" | "--help" => {
                println!("{HELP}");
                return 0;
            }
            "-a" | "--append" => append = true,
            "-" => stdin = true,
            "--in" => match args.next() {
                Some(dir) => folder = Some(dir.into()),
                None => {
                    eprintln!("mdview paste: --in needs a folder");
                    return 2;
                }
            },
            _ => words.push(a.as_str()),
        }
    }
    let text = if stdin {
        let mut text = String::new();
        if std::io::Read::read_to_string(&mut std::io::stdin(), &mut text).is_err() {
            eprintln!("mdview paste: what came on standard input is no text");
            return 1;
        }
        Some(text)
    } else if words.is_empty() {
        None
    } else {
        Some(words.join(" "))
    };
    if append && text.is_none() {
        eprintln!("mdview paste: --append needs a text");
        return 2;
    }
    let folder = folder.or_else(|| std::env::current_dir().ok()).and_then(|d| fs::canonicalize(d).ok());
    let Some(folder) = folder.filter(|d| d.is_dir()) else {
        eprintln!("mdview paste: no such folder");
        return 1;
    };
    let dir = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).filter(|d| d.is_dir()).unwrap_or_else(std::env::temp_dir);
    let reply = dir.join(format!("mdview-paste-{}.json", uuid::Uuid::new_v4()));
    let file = reply.with_extension("text");
    let mut hand = vec!["paste-for".to_string(), crate::scan::s(&reply), crate::scan::s(&folder), if text.is_none() { "read" } else if append { "append" } else { "write" }.to_string()];
    if let Some(text) = &text {
        if fs::write(&file, text).is_err() {
            eprintln!("mdview paste: could not write {}", file.display());
            return 1;
        }
        hand.push(crate::scan::s(&file));
    }
    let done = (|| {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut app = std::process::Command::new(exe).args(&hand).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().map_err(|e| e.to_string())?;
        // (handed to the running application, that start is gone at once; with none running it
        // is the application — which ends by itself after a while)
        let until = Instant::now() + Duration::from_secs(60);
        loop {
            if let Ok(said) = fs::read_to_string(&reply) {
                return serde_json::from_str::<Value>(&said).map_err(|e| e.to_string());
            }
            if matches!(app.try_wait(), Ok(Some(end)) if !end.success()) {
                return Err("Markdown Notes could not be started".into());
            }
            if Instant::now() > until {
                return Err("no answer from Markdown Notes".into());
            }
            std::thread::sleep(Duration::from_millis(30));
        }
    })();
    let _ = (fs::remove_file(&reply), fs::remove_file(&file));
    let said = match done {
        Ok(said) => said,
        Err(e) => {
            eprintln!("mdview paste: {e}");
            return 1;
        }
    };
    if let Some(why) = said["error"].as_str() {
        eprintln!(
            "mdview paste: {}",
            match why {
                "off" => format!("{} is in no project that is linked to a repository on GitHub", folder.display()),
                "signin" => "Markdown Notes is not signed in with GitHub (Settings › History)".to_string(),
                "missing" => format!("{}: no such repository, or not one this sign-in may write to", said["repo"].as_str().unwrap_or("")),
                "large" => "too long: the pasteboard takes 200 000 characters".to_string(),
                _ => "the server could not be reached".to_string(),
            }
        );
        return 1;
    }
    match text {
        None => print!("{}", said["text"].as_str().unwrap_or("")),
        Some(_) => eprintln!("On the pasteboard of {}.", said["repo"].as_str().unwrap_or("")),
    }
    0
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

    #[test]
    fn what_a_command_line_hands_over_is_understood() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let read = Asked::of(&args(&["/run/r.json", "/notes", "read"])).unwrap();
        assert!(read.text.is_none() && !read.append && read.folder == Path::new("/notes") && read.reply == Path::new("/run/r.json"));
        let add = Asked::of(&args(&["/run/r.json", "/notes", "append", "/run/r.text"])).unwrap();
        assert!(add.append && add.text.as_deref() == Some(Path::new("/run/r.text")));
        assert!(!Asked::of(&args(&["/run/r.json", "/notes", "write", "/run/r.text"])).unwrap().append);
        assert!(Asked::of(&args(&["/run/r.json", "/notes", "write"])).is_none() && Asked::of(&args(&["/run/r.json"])).is_none());
        assert_eq!((joined("", "b"), joined("a", "b"), joined("a\n", "b")), ("b".to_string(), "a\nb".to_string(), "a\nb".to_string()));
    }
}
