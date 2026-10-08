//! Files the application itself put beside a note — a picture pasted, a file dropped in, a figure
//! drawn — are remembered (attachments.json beside state.json), so that they can go again with
//! what shows them: when the note is saved from the active mode and no longer names such a file,
//! and no other note does, the file goes to the trash. A copy is kept aside for a while; when a
//! note names the file again (the removal undone, the block pasted elsewhere), it is put back.
//! A file that was there before, and was only linked, is never touched: it is not in the list.

use crate::scan;
use serde_json::{json, Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// How long a file stays after the note stopped naming it, before it goes. Within that time
/// nothing is taken away: a picture cut and pasted again, an undo, a redo find the file where it
/// was. (It went at the very next save before — and what was undone showed a picture that was
/// not there until the save after.)
pub const GRACE_SECS: u64 = 3600;
/// How long the copy of a removed file is kept for putting it back.
const KEEP_SECS: u64 = 30 * 24 * 3600;
/// How many notes are read at most to see whether another one names a file.
const NOTES_MOST: usize = 4000;

pub struct Store {
    file: PathBuf,
    stash: PathBuf,
}

/// What a save changed: files that went, files that are back (their names, for the page).
#[derive(Default, Debug, PartialEq)]
pub struct Tidied {
    pub removed: Vec<PathBuf>,
    pub restored: Vec<PathBuf>,
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Does the note's text name the file? (as it is, or as an address writes it: %20 for a space)
fn mentions(text: &str, name: &str) -> bool {
    !name.is_empty() && (text.contains(name) || scan::unquote(text).contains(name))
}

/// Another note under root that names the file.
fn elsewhere(root: &Path, note: &Path, name: &str) -> Option<PathBuf> {
    let (mut dirs, mut read) = (vec![(root.to_path_buf(), 0)], 0);
    while let Some((dir, depth)) = dirs.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if name_of(&p).starts_with('.') {
                continue;
            }
            if p.is_dir() {
                if depth < 8 {
                    dirs.push((p, depth + 1));
                }
            } else if scan::is_md(&p) && p != note {
                read += 1;
                if read > NOTES_MOST {
                    return Some(p); // (too many to know: the file stays)
                }
                if fs::read_to_string(&p).is_ok_and(|t| mentions(&t, name)) {
                    return Some(p);
                }
            }
        }
    }
    None
}

impl Store {
    pub fn new(state_dir: &Path, cache_dir: &Path) -> Store {
        Store { file: state_dir.join("attachments.json"), stash: cache_dir.join("removed") }
    }

    fn load(&self) -> Map<String, Value> {
        fs::read_to_string(&self.file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default()
    }

    fn save(&self, all: &Map<String, Value>) {
        if let Some(dir) = self.file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(&self.file, Value::Object(all.clone()).to_string());
    }

    fn stashed(&self, file: &Path) -> PathBuf {
        let mut h = DefaultHasher::new();
        s(file).hash(&mut h);
        let ext = file.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        self.stash.join(format!("{:016x}{ext}", h.finish()))
    }

    /// The application made this file for that note.
    pub fn own(&self, file: &Path, note: &Path) {
        let mut all = self.load();
        all.insert(s(file), json!({ "note": s(note) }));
        self.save(&all);
    }

    /// The note was saved with this text. root: the folder whose notes may name the file too.
    /// remove: how a file goes (the trash) — true when it is gone.
    pub fn tidy(&self, note: &Path, text: &str, root: &Path, now: u64, grace: u64, remove: impl Fn(&Path) -> bool) -> Tidied {
        let mut all = self.load();
        if all.is_empty() {
            return Tidied::default();
        }
        let (mut out, mut changed) = (Tidied::default(), false);
        for key in all.keys().cloned().collect::<Vec<_>>() {
            let file = PathBuf::from(&key);
            let (name, stash) = (name_of(&file), self.stashed(&file));
            let named = mentions(text, &name);
            let entry = all[&key].clone();
            if let Some(gone) = entry["gone"].as_u64() {
                // removed before: back when a note names it again; forgotten after a while
                if named && !file.exists() && stash.is_file() {
                    let back = file.parent().map(fs::create_dir_all).transpose().is_ok() && fs::copy(&stash, &file).is_ok();
                    if back {
                        let _ = fs::remove_file(&stash);
                        all.insert(key, json!({ "note": s(note) }));
                        out.restored.push(file);
                        changed = true;
                    }
                } else if named && file.exists() {
                    all.insert(key, json!({ "note": s(note) })); // (put back by other means)
                    changed = true;
                } else if now.saturating_sub(gone) > KEEP_SECS {
                    let _ = fs::remove_file(&stash);
                    all.remove(&key);
                    changed = true;
                }
                continue;
            }
            if entry["note"].as_str() != Some(s(note).as_str()) {
                continue;
            }
            if named {
                if !entry["unnamed"].is_null() {
                    all.insert(key, json!({ "note": s(note) })); // (named again in time: nothing happened)
                    changed = true;
                }
                continue;
            }
            // no longer named: noted, and left where it is for the time of grace
            let since = entry["unnamed"].as_u64();
            if since.is_none() && grace > 0 {
                all.insert(key, json!({ "note": s(note), "unnamed": now }));
                changed = true;
                continue;
            }
            if since.is_some_and(|t| now.saturating_sub(t) < grace) {
                continue;
            }
            if !file.is_file() {
                all.remove(&key); // (taken away by other means: nothing to look after any more)
                changed = true;
                continue;
            }
            if let Some(other) = elsewhere(root, note, &name) {
                all.insert(key, json!({ "note": s(&other) })); // (it is that note's now)
                changed = true;
                continue;
            }
            // a copy aside first: without one the file stays where it is
            if fs::create_dir_all(&self.stash).is_err() || fs::copy(&file, &stash).is_err() {
                continue;
            }
            if remove(&file) {
                all.insert(key, json!({ "note": s(note), "gone": now }));
                out.removed.push(file);
                changed = true;
            } else {
                let _ = fs::remove_file(&stash);
            }
        }
        if changed {
            self.save(&all);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dirs(name: &str) -> (PathBuf, Store) {
        let base = std::env::temp_dir().join(format!("mdview-attach-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("notes")).unwrap();
        let store = Store::new(&base.join("state"), &base.join("cache"));
        (base, store)
    }
    fn gone(p: &Path) -> bool {
        fs::remove_file(p).is_ok()
    }

    #[test]
    fn a_picture_goes_with_what_shows_it_and_comes_back() {
        let (base, store) = dirs("back");
        let (note, pic) = (base.join("notes/a.md"), base.join("notes/pasted 1.png"));
        fs::write(&pic, b"png").unwrap();
        store.own(&pic, &note);
        // still named (as an address writes it): it stays
        assert_eq!(store.tidy(&note, "![](pasted%201.png)\n", &base.join("notes"), 10, 0, gone), Tidied::default());
        assert!(pic.is_file());
        // no longer named: it goes
        let t = store.tidy(&note, "text\n", &base.join("notes"), 20, 0, gone);
        assert_eq!(t.removed, vec![pic.clone()]);
        assert!(!pic.exists());
        // named again (undone): it is back, with what was in it
        let t = store.tidy(&note, "![](pasted%201.png)\n", &base.join("notes"), 30, 0, gone);
        assert_eq!(t.restored, vec![pic.clone()]);
        assert_eq!(fs::read(&pic).unwrap(), b"png");
        // … and goes again
        assert_eq!(store.tidy(&note, "", &base.join("notes"), 40, 0, gone).removed.len(), 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn only_what_the_application_put_there_and_no_other_note_names() {
        let (base, store) = dirs("own");
        let notes = base.join("notes");
        let (note, other) = (notes.join("a.md"), notes.join("sub/b.md"));
        fs::create_dir_all(notes.join("sub")).unwrap();
        // a file that was there before is not in the list: never touched
        fs::write(notes.join("old.png"), b"x").unwrap();
        assert_eq!(store.tidy(&note, "", &notes, 1, 0, gone), Tidied::default());
        assert!(notes.join("old.png").is_file());
        // one that another note names stays, and is that note's from then on
        let pic = notes.join("shared.png");
        fs::write(&pic, b"x").unwrap();
        fs::write(&other, "![](../shared.png)\n").unwrap();
        store.own(&pic, &note);
        assert_eq!(store.tidy(&note, "", &notes, 2, 0, gone), Tidied::default());
        assert!(pic.is_file());
        assert_eq!(store.tidy(&note, "", &notes, 3, 0, gone), Tidied::default()); // (not a's any more)
        assert_eq!(store.tidy(&other, "nothing\n", &notes, 4, 0, gone).removed, vec![pic.clone()]);
        // a save of another note leaves a note's files alone
        let mine = notes.join("mine.png");
        fs::write(&mine, b"x").unwrap();
        store.own(&mine, &note);
        assert_eq!(store.tidy(&other, "nothing\n", &notes, 5, 0, gone), Tidied::default());
        assert!(mine.is_file());
        // what cannot be removed keeps no copy aside
        assert_eq!(store.tidy(&note, "", &notes, 6, 0, |_| false), Tidied::default());
        assert!(mine.is_file());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn what_is_no_longer_named_stays_for_a_while_first() {
        let (base, store) = dirs("grace");
        let (note, pic) = (base.join("notes/a.md"), base.join("notes/p.png"));
        fs::write(&pic, b"png").unwrap();
        store.own(&pic, &note);
        let notes = base.join("notes");
        // cut out of the note: saved without it, again and again — the file stays
        for now in [100, 130, 100 + GRACE_SECS - 1] {
            assert_eq!(store.tidy(&note, "text\n", &notes, now, GRACE_SECS, gone), Tidied::default());
            assert!(pic.is_file());
        }
        // pasted again, or undone: as if nothing had happened, and the time starts anew when it is cut once more
        assert_eq!(store.tidy(&note, "![](p.png)\n", &notes, 200 + GRACE_SECS, GRACE_SECS, gone), Tidied::default());
        assert_eq!(store.tidy(&note, "text\n", &notes, 300 + GRACE_SECS, GRACE_SECS, gone), Tidied::default());
        assert!(pic.is_file());
        // left out for longer than that: at the next save it goes — and comes back when it is named again
        assert_eq!(store.tidy(&note, "text\n", &notes, 300 + 2 * GRACE_SECS, GRACE_SECS, gone).removed, vec![pic.clone()]);
        assert!(!pic.exists());
        assert_eq!(store.tidy(&note, "![](p.png)\n", &notes, 400 + 2 * GRACE_SECS, GRACE_SECS, gone).restored, vec![pic.clone()]);
        assert_eq!(fs::read(&pic).unwrap(), b"png");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_copy_kept_aside_is_forgotten_after_a_while() {
        let (base, store) = dirs("old");
        let (note, pic) = (base.join("notes/a.md"), base.join("notes/p.png"));
        fs::write(&pic, b"x").unwrap();
        store.own(&pic, &note);
        store.tidy(&note, "", &base.join("notes"), 100, 0, gone);
        assert!(store.stashed(&pic).is_file());
        store.tidy(&note, "", &base.join("notes"), 100 + KEEP_SECS + 1, 0, gone);
        assert!(!store.stashed(&pic).exists());
        assert!(store.load().is_empty());
        let _ = fs::remove_dir_all(base);
    }
}
