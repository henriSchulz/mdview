//! How the folders of a folder look in the sidebar — a colour, a sign — as the folder says
//! itself, in .mdview/folders.json:
//!
//! ```json
//! { "version": 1, "folders": { "Studium": { "color": "blue", "icon": "book" } } }
//! ```
//!
//! The names are paths below the folder, with "/". The file lies in the folder (not in this
//! computer's state), so that the look goes where the folder goes: another device, the web app.
//! A folder with nothing chosen has no entry; with no entry left there is no file.

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

pub const FILE: &str = ".mdview/folders.json";

/// A colour's or a sign's name as the page gives it: a short word (which ones there are is the
/// page's to know — a name it does not know draws as none).
fn word(v: &str) -> Option<String> {
    let w = v.trim();
    (!w.is_empty() && w.len() <= 24 && w.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')).then(|| w.to_string())
}

/// `path` below `root`, with "/" (None: not below it, or the folder itself).
fn below(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// Read forgivingly: a file that cannot be read says nothing.
fn read(root: &Path) -> BTreeMap<String, Value> {
    let all: Value = fs::read_to_string(root.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    all["folders"].as_object().map(|m| m.iter().filter(|(_, e)| e.is_object()).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default()
}

/// Written with the names in order: two devices that each choose for another folder change
/// different lines.
fn write(root: &Path, looks: &BTreeMap<String, Value>) -> Result<(), String> {
    if looks.is_empty() {
        let _ = fs::remove_file(root.join(FILE));
        let _ = fs::remove_dir(root.join(".mdview")); // (if nothing else is in it)
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&json!({ "version": 1, "folders": looks })).map_err(|e| e.to_string())? + "\n";
    fs::create_dir_all(root.join(".mdview")).and_then(|()| fs::write(root.join(FILE), text)).map_err(|e| e.to_string())
}

/// For the page: { path below the folder → { color, icon } }.
pub fn listed(root: &Path) -> Value {
    Value::Object(read(root).into_iter().collect::<Map<String, Value>>())
}

/// A colour and a sign chosen for a folder ("" for either: none).
pub fn set(root: &Path, dir: &Path, color: &str, icon: &str) -> Result<(), String> {
    let Some(rel) = below(root, dir) else { return Err("not a folder of this folder".into()) };
    let mut looks = read(root);
    let mut entry = Map::new();
    if let Some(c) = word(color) { entry.insert("color".into(), json!(c)); }
    if let Some(i) = word(icon) { entry.insert("icon".into(), json!(i)); }
    if entry.is_empty() { looks.remove(&rel); } else { looks.insert(rel, Value::Object(entry)); }
    write(root, &looks)
}

/// A folder under another path (renamed, moved): its look, and that of the folders in it, go along.
pub fn moved(root: &Path, old: &Path, new: &Path) {
    let (Some(was), Some(now)) = (below(root, old), below(root, new)) else { return };
    let looks = read(root);
    let inside = format!("{was}/");
    if !looks.keys().any(|k| *k == was || k.starts_with(&inside)) { return; }
    let next: BTreeMap<String, Value> = looks.into_iter().map(|(k, v)| {
        if k == was { (now.clone(), v) } else if let Some(rest) = k.strip_prefix(&inside) { (format!("{now}/{rest}"), v) } else { (k, v) }
    }).collect();
    let _ = write(root, &next);
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Dir(std::path::PathBuf);
    impl Dir {
        fn new(name: &str) -> Dir {
            let d = std::env::temp_dir().join(format!("mdview-looks-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&d);
            fs::create_dir_all(d.join("a/b")).unwrap();
            Dir(d)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn a_look_is_kept_in_the_folder_and_goes_when_nothing_is_chosen() {
        let d = Dir::new("set");
        let r = &d.0;
        assert_eq!(listed(r), json!({}));
        set(r, &r.join("a"), "blue", "book").unwrap();
        set(r, &r.join("a/b"), "", "star").unwrap();
        assert_eq!(listed(r), json!({ "a": { "color": "blue", "icon": "book" }, "a/b": { "icon": "star" } }));
        assert!(fs::read_to_string(r.join(FILE)).unwrap().ends_with("}\n"));
        // what is no word is no look; the folder itself and what lies outside have none
        set(r, &r.join("a/b"), "<script>", "").unwrap();
        assert_eq!(listed(r), json!({ "a": { "color": "blue", "icon": "book" } }));
        assert!(set(r, r, "red", "").is_err() && set(r, Path::new("/elsewhere"), "red", "").is_err());
        set(r, &r.join("a"), "", "").unwrap();
        assert!(!r.join(FILE).exists() && !r.join(".mdview").exists());
    }

    #[test]
    fn a_folder_renamed_or_moved_keeps_its_look_and_so_do_the_folders_in_it() {
        let d = Dir::new("moved");
        let r = &d.0;
        set(r, &r.join("a"), "red", "").unwrap();
        set(r, &r.join("a/b"), "green", "flag").unwrap();
        set(r, &r.join("ab"), "blue", "").unwrap(); // (a name that only begins the same: left alone)
        moved(r, &r.join("a"), &r.join("x/y"));
        assert_eq!(listed(r), json!({ "ab": { "color": "blue" }, "x/y": { "color": "red" }, "x/y/b": { "color": "green", "icon": "flag" } }));
    }
}
