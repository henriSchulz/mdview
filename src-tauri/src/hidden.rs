//! What of a folder was put out of sight by hand — a file, a folder with all that is in it — as
//! the folder says itself, in .mdview/hidden.json:
//!
//! ```json
//! { "version": 1, "hidden": ["Archiv", "Studium/alt.pdf"] }
//! ```
//!
//! The names are paths below the folder, with "/". The file lies in the folder (not in this
//! computer's state), like the folders' looks (looks.rs): what is hidden here is hidden on
//! another device. With nothing hidden there is no file.

use serde_json::{json, Value};
use std::collections::{BTreeSet, HashSet};
use std::fs;
use std::path::Path;

pub const FILE: &str = ".mdview/hidden.json";

/// `path` below `root`, with "/" (None: not below it, or the folder itself).
fn below(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Read forgivingly: a file that cannot be read says nothing.
fn read(root: &Path) -> BTreeSet<String> {
    let all: Value = fs::read_to_string(root.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    all["hidden"].as_array().map(|a| a.iter().filter_map(Value::as_str).filter(|p| !p.is_empty()).map(String::from).collect()).unwrap_or_default()
}

/// Written in order, one name a line: two devices that each hide something change different lines.
fn write(root: &Path, hidden: &BTreeSet<String>) -> Result<(), String> {
    if hidden.is_empty() {
        let _ = fs::remove_file(root.join(FILE));
        let _ = fs::remove_dir(root.join(".mdview")); // (if nothing else is in it)
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&json!({ "version": 1, "hidden": hidden })).map_err(|e| e.to_string())? + "\n";
    fs::create_dir_all(root.join(".mdview")).and_then(|()| fs::write(root.join(FILE), text)).map_err(|e| e.to_string())
}

/// What is hidden, as whole paths (as the scan names what it walks).
pub fn listed(root: &Path) -> HashSet<String> {
    read(root).into_iter().map(|rel| crate::scan::s(&root.join(rel))).collect()
}

/// These files and folders hidden (on) or shown again.
pub fn set(root: &Path, paths: &[&Path], on: bool) -> Result<(), String> {
    let mut hidden = read(root);
    for rel in paths.iter().filter_map(|p| below(root, p)) {
        if on { hidden.insert(rel); } else { hidden.remove(&rel); }
    }
    write(root, &hidden)
}

/// A file or a folder under another path (renamed, moved) — or gone (new: None): what was
/// hidden of it stays hidden, what is gone is no longer named.
pub fn moved(root: &Path, old: &Path, new: Option<&Path>) {
    let Some(was) = below(root, old) else { return };
    let hidden = read(root);
    let inside = format!("{was}/");
    if !hidden.iter().any(|k| *k == was || k.starts_with(&inside)) { return; }
    let now = new.and_then(|n| below(root, n));
    let next: BTreeSet<String> = hidden.into_iter().filter_map(|k| {
        let rest = if k == was { Some("") } else { k.strip_prefix(&inside) };
        match (rest, &now) {
            (None, _) => Some(k),
            (Some(_), None) => None,
            (Some(""), Some(now)) => Some(now.clone()),
            (Some(rest), Some(now)) => Some(format!("{now}/{rest}")),
        }
    }).collect();
    let _ = write(root, &next);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("mdview-hidden-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("a/b")).unwrap();
        d
    }

    #[test]
    fn hidden_is_kept_in_the_folder_and_shown_again() {
        let d = dir("set");
        set(&d, &[&d.join("a"), &d.join("x.pdf"), Path::new("/elsewhere"), &d], true).unwrap();
        assert_eq!(read(&d).into_iter().collect::<Vec<_>>(), ["a", "x.pdf"]);
        assert!(listed(&d).contains(&crate::scan::s(&d.join("x.pdf"))));
        set(&d, &[&d.join("a"), &d.join("x.pdf")], false).unwrap();
        assert!(!d.join(FILE).exists(), "nothing hidden: no file");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn what_is_hidden_follows_a_move_and_goes_with_what_is_gone() {
        let d = dir("moved");
        set(&d, &[&d.join("a"), &d.join("a/b/n.md"), &d.join("ab.md")], true).unwrap();
        moved(&d, &d.join("a"), Some(&d.join("c")));
        assert_eq!(read(&d).into_iter().collect::<Vec<_>>(), ["ab.md", "c", "c/b/n.md"]);
        moved(&d, &d.join("c"), None);
        assert_eq!(read(&d).into_iter().collect::<Vec<_>>(), ["ab.md"]);
        let _ = fs::remove_dir_all(&d);
    }
}
