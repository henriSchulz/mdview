//! What was done to a folder's files from the sidebar and All Notes, taken back and done again
//! (Ctrl+Z, Ctrl+Shift+Z there): moved, renamed, put in the trash, made (a new note, folder or
//! whiteboard, a copy, what was pasted or added), hidden. One history per window, the newest
//! last; something new done forgets what was taken back.

use super::*;
use std::time::Instant;

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Step {
    /// (from, to), and how: "move" or "rename"
    Moved(Vec<(PathBuf, PathBuf)>, &'static str),
    Trashed(Vec<PathBuf>),
    Made(Vec<PathBuf>),
    /// what was hidden (true) or shown again (false)
    Hidden(Vec<PathBuf>, bool),
}

#[derive(Default)]
pub(super) struct Steps {
    undo: Vec<(Step, Instant)>,
    redo: Vec<Step>,
    replaying: bool,
}

/// Moves that come one right after the other are one step: the page sends a move for each of
/// several things dragged (or cut and pasted) together.
const TOGETHER: Duration = Duration::from_millis(1500);
const KEPT: usize = 100;

impl Steps {
    pub(super) fn did(&mut self, step: Step) {
        if self.replaying {
            return;
        }
        self.redo.clear();
        let now = Instant::now();
        if let (Step::Moved(more, "move"), Some((Step::Moved(had, "move"), at))) = (&step, self.undo.last_mut()) {
            if now.duration_since(*at) < TOGETHER {
                had.extend(more.iter().cloned());
                *at = now;
                return;
            }
        }
        self.undo.push((step, now));
        if self.undo.len() > KEPT {
            self.undo.remove(0);
        }
    }
    /// (the step that Undo would take back: the trash's own Undo goes by it)
    pub(super) fn last(&self) -> Option<&Step> {
        self.undo.last().map(|(s, _)| s)
    }
}

/// What a step did, in a few words: "Move of “Note”", "Move of 3 items".
fn what(step: &Step) -> String {
    let (verb, paths): (&str, Vec<&PathBuf>) = match step {
        Step::Moved(p, "rename") => ("Rename of", p.iter().map(|(from, _)| from).collect()),
        Step::Moved(p, _) => ("Move of", p.iter().map(|(from, _)| from).collect()),
        Step::Trashed(p) => ("Move to Trash of", p.iter().collect()),
        Step::Made(p) => ("Making of", p.iter().collect()),
        Step::Hidden(p, true) => ("Hiding of", p.iter().collect()),
        Step::Hidden(p, false) => ("Showing of", p.iter().collect()),
    };
    if paths.len() == 1 { format!("{verb} “{}”", name_of(paths[0])) } else { format!("{verb} {} items", paths.len()) }
}

impl Win {
    pub(super) fn did(&mut self, step: Step) {
        self.steps.did(step);
    }

    /// Ctrl+Z (back) or Ctrl+Shift+Z: the last step taken back, or the last taken back done again.
    pub(super) fn file_step(&mut self, app: &mut App, back: bool) {
        let step = if back { self.steps.undo.pop().map(|(s, _)| s) } else { self.steps.redo.pop() };
        let Some(step) = step else {
            return self.toast(if back { "Nothing to undo" } else { "Nothing to redo" });
        };
        let said = what(&step);
        self.steps.replaying = true;
        let undone = self.undo_step(app, step);
        self.steps.replaying = false;
        // (what could not be taken back is gone from the history: the toast that said why stands)
        let Some(undone) = undone else { return };
        if back {
            self.steps.redo.push(undone);
        } else {
            self.steps.undo.push((undone, Instant::now()));
        }
        self.toast(format!("{} {said}", if back { "Undid" } else { "Redid" }));
    }

    /// One step taken back → the step that takes that back in turn (None: it could not be).
    fn undo_step(&mut self, app: &mut App, step: Step) -> Option<Step> {
        let folder = self.folder.clone()?;
        match step {
            Step::Moved(pairs, how) => {
                let mut back = vec![];
                for (from, to) in pairs.into_iter().rev() {
                    if !fs::symlink_metadata(&to).is_ok() {
                        continue;
                    }
                    self.relocate(app, &folder, &to, &from, how);
                    if fs::symlink_metadata(&from).is_ok() {
                        back.push((to, from));
                    }
                }
                back.reverse();
                Some(Step::Moved(back, how)).filter(|s| !matches!(s, Step::Moved(p, _) if p.is_empty()))
            }
            Step::Trashed(paths) => {
                let back = self.restore(app, &paths)?;
                Some(Step::Made(back))
            }
            Step::Made(paths) => {
                let there: Vec<String> = paths.iter().filter(|p| fs::symlink_metadata(p).is_ok()).map(|p| s(p)).collect();
                if there.is_empty() {
                    self.toast("It is no longer there");
                    return None;
                }
                self.trash_paths(app, &there);
                Some(Step::Trashed(there.iter().map(PathBuf::from).filter(|p| fs::symlink_metadata(p).is_err()).collect()))
            }
            Step::Hidden(paths, on) => {
                if let Err(e) = crate::hidden::set(&folder, &paths.iter().map(PathBuf::as_path).collect::<Vec<_>>(), !on) {
                    self.toast(format!("Couldn't change it: {e}"));
                    return None;
                }
                self.rescan(app);
                app.each_win(|w, app| if w.folder.as_ref() == Some(&folder) { w.rescan(app) });
                Some(Step::Hidden(paths, !on))
            }
        }
    }

    /// Files and folders put in the trash taken out again, where they stood (what was put there
    /// last under each path). → what came back (None: nothing could, and the toast says why)
    #[cfg(not(target_os = "macos"))]
    pub(super) fn restore(&mut self, app: &mut App, wanted: &[PathBuf]) -> Option<Vec<PathBuf>> {
        let items = match trash::os_limited::list() {
            Ok(items) => items,
            Err(e) => {
                self.toast(format!("Couldn't read the Trash: {e}"));
                return None;
            }
        };
        let back: Vec<_> = wanted.iter().filter_map(|p| items.iter().filter(|i| i.original_path() == *p).max_by_key(|i| i.time_deleted).cloned()).collect();
        if back.is_empty() {
            self.toast("It is no longer in the Trash");
            return None;
        }
        let paths: Vec<PathBuf> = back.iter().map(|i| i.original_path()).collect();
        if let Err(e) = trash::os_limited::restore_all(back) {
            self.toast(format!("Couldn't put it back: {e}"));
            return None;
        }
        for p in paths.iter().filter(|p| p.is_dir()) {
            self.kept_dirs.insert(s(p)); // (a folder that was empty is listed again)
        }
        self.rescan(app);
        Some(paths)
    }
    #[cfg(target_os = "macos")]
    pub(super) fn restore(&mut self, _app: &mut App, _wanted: &[PathBuf]) -> Option<Vec<PathBuf>> {
        self.toast("Things in the Trash can't be put back from here");
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_right_after_each_other_are_one_step_and_something_new_forgets_what_was_taken_back() {
        let mut h = Steps::default();
        let p = |n: &str| PathBuf::from(format!("/f/{n}"));
        h.did(Step::Moved(vec![(p("a"), p("d/a"))], "move"));
        h.did(Step::Moved(vec![(p("b"), p("d/b"))], "move"));
        assert_eq!(h.undo.len(), 1);
        assert_eq!(h.last(), Some(&Step::Moved(vec![(p("a"), p("d/a")), (p("b"), p("d/b"))], "move")));
        h.did(Step::Moved(vec![(p("c"), p("e"))], "rename")); // (a rename is a step of its own)
        h.did(Step::Moved(vec![(p("x"), p("d/x"))], "move"));
        assert_eq!(h.undo.len(), 3);
        h.redo.push(Step::Made(vec![p("n")]));
        h.did(Step::Trashed(vec![p("t")]));
        assert!(h.redo.is_empty());
        h.replaying = true;
        h.did(Step::Made(vec![p("m")])); // (what Undo itself does is no step)
        assert_eq!(h.undo.len(), 4);
    }

    #[test]
    fn a_step_says_what_it_did() {
        assert_eq!(what(&Step::Moved(vec![(PathBuf::from("/f/Note.md"), PathBuf::from("/f/d/Note.md"))], "move")), "Move of “Note.md”");
        assert_eq!(what(&Step::Trashed(vec![PathBuf::from("/f/a"), PathBuf::from("/f/b")])), "Move to Trash of 2 items");
    }
}
