//! Search (viewer/search.js, Ctrl+K in a folder window): the notes whose name or text has every
//! word asked for. The shell only finds the notes and hands over their text; the page takes each
//! apart into the blocks the reading view draws (a heading, a paragraph, an item of a list …),
//! so that a block found is the block shown. A note's text is kept, in small letters too, as
//! long as the file's time stays the same: a search at every key reads no file twice.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// The most notes one search hands the page (the best first), and the most of a note read.
pub const MOST: usize = 60;
const READ: usize = 512 * 1024;

/// A note as it was read last: its time, its text, its text in small letters.
struct Kept {
    mtime: f64,
    text: String,
    low: String,
}
static KEPT: Mutex<Option<HashMap<PathBuf, Kept>>> = Mutex::new(None);

pub struct Hit {
    pub path: String,
    pub text: String,
    pub mtime: f64,
    score: usize,
}

/// The words asked for, in small letters: split at spaces, what stands in "quotes" one word.
pub fn words(q: &str) -> Vec<String> {
    let mut out = vec![];
    for (i, part) in q.split('"').enumerate() {
        if i % 2 == 1 {
            let w = part.trim().to_lowercase();
            if !w.is_empty() {
                out.push(w);
            }
        } else {
            out.extend(part.split_whitespace().map(str::to_lowercase));
        }
    }
    out
}

fn name_of(path: &Path) -> String {
    path.file_stem().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// The notes among `paths` (the window's own: BUGS.md rule 17) that have every word — in the name or
/// anywhere in the text, not necessarily in one block — the best first: words in the name, then
/// how often the words stand in it, then the newest. Also how many were found in all. Nothing
/// asked: every note is read into what is kept (the page asks so when Search opens), and none is
/// handed over.
pub fn search(paths: &[String], q: &str) -> (Vec<Hit>, usize) {
    let words = words(q);
    let mut kept = KEPT.lock().unwrap();
    let kept = kept.get_or_insert_with(HashMap::new);
    let mut hits = vec![];
    for p in paths {
        let path = Path::new(p);
        if !crate::scan::is_md(path) {
            continue;
        }
        let Ok(meta) = fs::metadata(path) else { continue };
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64());
        let fresh = kept.get(path).is_some_and(|k| k.mtime == mtime);
        if !fresh {
            let Ok(text) = crate::scan::read_text(path, Some(READ)) else { continue };
            let low = text.to_lowercase();
            kept.insert(path.to_path_buf(), Kept { mtime, text, low });
        }
        if words.is_empty() {
            continue;
        }
        let k = &kept[path];
        let name = name_of(path);
        if !words.iter().all(|w| name.contains(w.as_str()) || k.low.contains(w.as_str())) {
            continue;
        }
        let in_name = words.iter().filter(|w| name.contains(w.as_str())).count();
        let often: usize = words.iter().map(|w| k.low.matches(w.as_str()).count()).sum();
        hits.push(Hit { path: p.clone(), text: k.text.clone(), mtime, score: in_name * 10_000 + often.min(9_999) });
    }
    let found = hits.len();
    hits.sort_by(|a, b| b.score.cmp(&a.score).then(b.mtime.total_cmp(&a.mtime)));
    hits.truncate(MOST);
    (hits, found)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own for a test, gone when the test is.
    struct Dir(PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn folder(files: &[(&str, &str)]) -> (Dir, Vec<String>) {
        let dir = std::env::temp_dir().join(format!("mdview-search-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let paths = files
            .iter()
            .map(|(name, text)| {
                let p = dir.join(name);
                fs::write(&p, text).unwrap();
                p.to_string_lossy().into_owned()
            })
            .collect();
        (Dir(dir), paths)
    }
    fn names(hits: &[Hit]) -> Vec<String> {
        hits.iter().map(|h| Path::new(&h.path).file_stem().unwrap().to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn words_are_split_at_spaces_and_quotes_keep_them_together() {
        assert_eq!(words("  Dini  Proof "), ["dini", "proof"]);
        assert_eq!(words(r#"uniform "power series" x"#), ["uniform", "power series", "x"]);
        assert!(words("   ").is_empty());
    }

    #[test]
    fn a_note_has_every_word_somewhere_and_the_name_counts_most() {
        let (_dir, paths) = folder(&[
            ("Dini.md", "# Dini\n\nThe proof uses compactness."),
            ("Sheet.md", "Problem 5: Dini on a non-compact domain.\n\nNo proof yet."),
            ("Other.md", "Dini, but nothing else."),
            ("picture.png", "Dini proof"),
        ]);
        let (hits, found) = search(&paths, "dini PROOF");
        assert_eq!(found, 2);
        assert_eq!(names(&hits), ["Dini", "Sheet"]); // (the name has a word: first; the picture is no note)
        assert!(hits[1].text.starts_with("Problem 5"));
    }

    #[test]
    fn a_note_changed_is_read_anew() {
        let (_dir, paths) = folder(&[("Note.md", "apples")]);
        assert_eq!(search(&paths, "apples").1, 1);
        fs::write(&paths[0], "pears").unwrap();
        let later = fs::File::options().write(true).open(&paths[0]).unwrap();
        later.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(search(&paths, "apples").1, 0);
        assert_eq!(search(&paths, "pears").1, 1);
    }

    #[test]
    fn nothing_asked_finds_nothing_and_no_more_than_most_are_handed_over() {
        let files: Vec<(String, String)> = (0..MOST + 5).map(|i| (format!("n{i}.md"), "same word".to_string())).collect();
        let refs: Vec<(&str, &str)> = files.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let (_dir, paths) = folder(&refs);
        assert_eq!(search(&paths, "").1, 0);
        let (hits, found) = search(&paths, "word");
        assert_eq!((hits.len(), found), (MOST, MOST + 5));
    }
}
