//! A folder window's folder: its notes sent to the sidebar (and their previews), quick notes, a
//! note or a folder made, renamed, moved, put in the trash and taken out again.

use super::*;

impl Win {
    pub(super) fn rescan(&mut self, app: &mut App) {
        self.rescan_turn += 1; // (a scan that was still to come is this one)
        let Some(folder) = self.folder.clone() else { return };
        let titles = app.state.get("sidebar_titles").is_some_and(truthy);
        let prefs = app.prefs();
        // (what the sidebar lists or All Notes does: the page shows each its own part — viewer/sidebar.js, listed)
        let show: HashSet<&'static str> = [("pdf", "sidebarPdf", "ovPdf"), ("image", "sidebarImages", "ovImages"), ("media", "sidebarMedia", "ovMedia"), ("other", "sidebarOther", "ovOther")]
            .into_iter()
            .filter(|(_, sidebar, all)| truthy(&prefs[*sidebar]) || truthy(&prefs[*all]))
            .map(|(group, _, _)| group)
            .collect();
        let (tree, walked) = scan::scan_folder(&folder, &mut self.title_cache, titles, &self.kept_dirs, &show);
        self.note_paths = tree.notes().iter().map(|n| n.path.clone()).collect();
        self.tree = Some(tree);
        self.dir_watch = walked.into_iter().take(WATCH_LIMIT).collect();
        self.watch();
        self.send_folder(app);
    }

    pub(super) fn send_folder(&mut self, app: &mut App) {
        let Some(folder) = self.folder.clone().filter(|_| self.shell_ready) else { return };
        let Some(tree) = self.tree.as_mut() else { return };
        let opened = app.state.get("opened").and_then(Value::as_object);
        tree.each_note(&mut |n| n.opened = opened.and_then(|o| o.get(&n.real)).and_then(Value::as_i64).unwrap_or(0));
        // where the folder stands with a history: "none", a "project" itself, "inside" one above,
        // or in a "foreign" repository (own: the folder is that repository's, and can be taken over)
        let history = app.standing(&folder);
        let st = &app.state;
        let payload = json!({
            "history": history,
            "shared": share::listed(&folder),
            "looks": crate::looks::listed(&folder),   // the colours and signs chosen for its folders
            "root": s(&folder),
            "quick": self.quick,
            "name": if name_of(&folder).is_empty() { s(&folder) } else { name_of(&folder) },
            "tree": tree,
            "titles": st.get("sidebar_titles").is_some_and(truthy),
            "visible": st.get("sidebar").map_or(true, truthy),
            "width": st.get("sidebar_width").cloned().unwrap_or(json!(0)),
        });
        let blob = payload.to_string();
        if self.tree_json.as_ref() != Some(&blob) {
            self.tree_json = Some(blob);
            self.js("MdView.setFolder", &[payload]);
        }
    }

    /// The beginning of notes of this folder, for their tiles in the overview.
    pub(super) fn send_previews(&self, paths: &Value) {
        let mut out = Map::new();
        for p in paths.as_array().map(Vec::as_slice).unwrap_or_default().iter().take(PREVIEW_BATCH) {
            let Some(p) = p.as_str().filter(|p| self.note_paths.contains(*p) && file_kind(Path::new(p)) == "md") else { continue };
            let path = Path::new(p);
            let preview = match (read_text(path, Some(PREVIEW_BYTES)), mtime(path)) {
                (Ok(text), Ok(mtime)) => json!({ "text": text, "mtime": mtime }),
                _ => json!({ "text": "", "mtime": 0 }),
            };
            out.insert(p.to_string(), preview);
        }
        self.js("MdView.setPreviews", &[Value::Object(out)]);
    }

    /// A quick note is left: one with nothing in it goes, one that still has the time for a
    /// name is named after what its first line says. → the folder's list has to be read anew
    pub(super) fn settle_quick(&mut self) -> bool {
        let Some(path) = self.path.clone().filter(|p| self.quick && p.is_file() && Some(dir_of(p)) == self.folder) else { return false };
        let stem = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !QUICK_NAME.is_match(&stem) {
            return false;
        }
        let Ok(text) = fs::read_to_string(&path) else { return false };
        if text.trim().is_empty() {
            return fs::remove_file(&path).is_ok();
        }
        let first = text.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("---") && !l.starts_with("<!--")).unwrap_or("");
        let plain = first.trim_start_matches(|c: char| matches!(c, '#' | '>' | '-' | '*' | '+' | ' ')).trim_start_matches("[ ] ").trim_start_matches("[x] ");
        let plain: String = plain.chars().filter(|c| !matches!(c, '*' | '_' | '`' | '$' | '[' | ']')).collect();
        let name = clean_name(&take(plain.trim(), 60));
        let name = name.trim().trim_end_matches('.').to_string();
        if name.is_empty() {
            return false;
        }
        let dir = dir_of(&path);
        let target = (1..100).map(|n| dir.join(if n == 1 { format!("{name}.md") } else { format!("{name} {n}.md") })).find(|t| !t.exists());
        target.is_some_and(|t| fs::rename(&path, t).is_ok())
    }

    /// A new quick note: made at once, under the time for a name, shown and ready to be written in.
    pub(super) fn new_quick(&mut self, app: &mut App) {
        let Some(folder) = self.folder.clone().filter(|_| self.quick) else { return };
        self.settle_quick();
        let stem = chrono::Local::now().format("%Y-%m-%d %H.%M.%S").to_string();
        let path = match write_new(&folder, |n| if n == 1 { format!("{stem}.md") } else { format!("{stem}-{n}.md") }, b"", 50) {
            Ok(path) => path,
            Err(e) => return self.toast(format!("Couldn't create note: {}", strerror(&e))),
        };
        self.rescan(app);
        self.open_path(app, &path, None, true);
        self.js("MdView.setMode", &[json!("active")]);
        self.js("MdView.quickFresh", &[json!(s(&path))]);
    }

    pub(super) fn open_note(&mut self, app: &mut App, path: &str, tab: bool) {
        if self.folder.is_none() || !self.note_paths.contains(path) {
            return;
        }
        if self.quick && self.path.as_deref() != Some(Path::new(path)) && self.settle_quick() {
            self.rescan(app);
            if !Path::new(path).exists() {
                return;
            }
        }
        let path = Path::new(path);
        if !matches!(file_kind(path), "md" | "pdf") {
            return host::launch_path(path); // a picture, a film, any other file: in its own application
        }
        // in a tab of its own where that was asked for; a note that has a tab already: that tab
        let real = crate::scan::canon(path).unwrap_or_else(|_| path.to_path_buf());
        let there = self.tabs.iter().enumerate().position(|(k, t)| k != self.tab && t.path.as_ref() == Some(&real));
        if tab {
            self.new_tab(app, Some(&real), None, None);
        } else if let Some(there) = there {
            self.stash_tab();
            self.show_tab(app, there, None);
        } else {
            self.open_path(app, path, None, true);
        }
    }

    /// Where a new note or folder goes: the folder asked for if it is one of this window's, else the root.
    pub(super) fn target_dir(&self, folder: &Path, wanted: Option<&str>) -> PathBuf {
        let target = wanted.filter(|w| !w.is_empty()).map(|w| resolve(Path::new(w))).unwrap_or_else(|| folder.to_path_buf());
        if target.is_dir() && target.starts_with(folder) { target } else { folder.to_path_buf() }
    }

    pub(super) fn new_note(&mut self, app: &mut App, name: &str, wanted: Option<&str>) {
        let Some(folder) = self.folder.clone() else { return };
        let target = self.target_dir(&folder, wanted);
        let name = Some(clean_name(name)).filter(|n| !n.is_empty()).unwrap_or_else(|| "Untitled".into());
        let stem = if name.to_lowercase().ends_with(".md") { name[..name.len() - 3].trim_end().to_string() } else { name };
        let path = target.join(format!("{}.md", if stem.is_empty() { "Untitled" } else { &stem }));
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                if let Err(e) = f.write_all(format!("# {stem}\n\n").as_bytes()) {
                    return self.toast(format!("Couldn't create note: {}", strerror(&e)));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                self.toast(format!("“{}” already exists", name_of(&path)));
                if path.is_file() {
                    self.rescan(app);
                    self.open_path(app, &path, None, true);
                }
                return;
            }
            Err(e) => return self.toast(format!("Couldn't create note: {}", strerror(&e))),
        }
        self.rescan(app);
        self.open_path(app, &path, None, true);
        // written at once, in the mode that is worked in: the active one where that is it, else the source
        if app.state.get("mode").and_then(Value::as_str) == Some("active") {
            self.js("MdView.setMode", &[json!("active")]);
        } else {
            self.js("MdView.setMode", &[json!("edit"), json!("end")]);
        }
    }

    pub(super) fn new_folder(&mut self, app: &mut App, name: &str, wanted: Option<&str>) {
        let Some(folder) = self.folder.clone() else { return };
        let target = self.target_dir(&folder, wanted);
        let path = target.join(Some(clean_name(name)).filter(|n| !n.is_empty()).unwrap_or_else(|| "New Folder".into()));
        match fs::create_dir(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => self.toast(format!("“{}” already exists", name_of(&path))),
            Err(e) => return self.toast(format!("Couldn't create folder: {}", strerror(&e))),
        }
        self.kept_dirs.insert(s(&path));
        self.rescan(app);
    }

    pub(super) fn rename_note(&mut self, app: &mut App, path: &str, name: &str) {
        let Some(folder) = self.folder.clone() else { return };
        let old = PathBuf::from(path);
        let is_dir = old.is_dir() && old.starts_with(&folder) && old != folder; // (a folder of the window's: renamed like a file, without an ending to keep)
        if !is_dir && !self.note_paths.contains(path) {
            return;
        }
        let suffix = old.extension().filter(|_| !is_dir).map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let mut stem = clean_name(name);
        if !suffix.is_empty() && stem.to_lowercase().ends_with(&suffix.to_lowercase()) {
            stem = stem[..stem.len() - suffix.len()].trim_end().to_string();
        }
        let new = old.with_file_name(format!("{stem}{suffix}"));
        if stem.is_empty() || new == old {
            return;
        }
        self.relocate(app, &folder, &old, &new, "rename");
    }

    /// A note, another file or a folder dragged into another folder of the window's (or to its
    /// top): the same thing in another place.
    pub(super) fn move_to(&mut self, app: &mut App, path: &str, dir: &str) {
        let Some(folder) = self.folder.clone() else { return };
        let (old, into) = (PathBuf::from(path), PathBuf::from(dir));
        let known = self.note_paths.contains(path) || (old.is_dir() && old.starts_with(&folder) && old != folder);
        if !known || !into.is_dir() || !into.starts_with(&folder) || old.parent() == Some(into.as_path()) || into.starts_with(&old) {
            return; // (not this window's, where it is already, or into itself)
        }
        let Some(name) = old.file_name() else { return };
        let new = into.join(name);
        self.relocate(app, &folder, &old, &new, "move");
    }

    /// A file or a folder under another path, and everything that knew it by the old one told:
    /// the ways back, the tabs, the note on screen, what was shared of it, the page.
    pub(super) fn relocate(&mut self, app: &mut App, folder: &Path, old: &Path, new: &Path, how: &str) {
        let (old, new) = (old.to_path_buf(), new.to_path_buf());
        let is_dir = old.is_dir();
        let old_real = crate::scan::canon(&old).unwrap_or_else(|_| old.clone());
        // (a name that differs only in case is the same file where the file system says so)
        let taken = fs::symlink_metadata(&new).is_ok() && crate::scan::canon(&new).ok().as_ref() != Some(&old_real);
        if taken {
            return self.toast(format!("“{}” already exists", name_of(&new)));
        }
        if let Err(e) = fs::rename(&old, &new) {
            return self.toast(format!("Couldn't {how}: {}", strerror(&e)));
        }
        let new_real = crate::scan::canon(&new).unwrap_or_else(|_| new.clone());
        if is_dir {
            crate::looks::moved(folder, &old, &new); // (its colour and its sign go along)
        }
        // (a link to a note goes on showing it)
        if let Ok(Some(root)) = if is_dir { share::moved_dir(&old_real, &new_real) } else { share::moved(&old_real, Some(&new_real)) } {
            app.share_dirty.insert(root);
        }
        // (a folder: everything in it is under the new path with it)
        let swap = |p: &mut PathBuf| {
            if *p == old_real {
                *p = new_real.clone();
            } else if is_dir {
                if let Ok(rest) = p.strip_prefix(&old_real) {
                    *p = new_real.join(rest);
                }
            }
        };
        self.back.iter_mut().for_each(swap);
        self.fwd.iter_mut().for_each(swap);
        for t in &mut self.tabs {
            // (the one shown is written down from the window again)
            t.path.iter_mut().for_each(swap);
            t.back.iter_mut().for_each(swap);
            t.fwd.iter_mut().for_each(swap);
        }
        if self.path.as_ref() == Some(&old_real) && new_real != old_real {
            // the note on screen: it stays as it is (also mid-edit), under its new name
            self.path = Some(new_real.clone());
            self.set_title(name_of(&new_real));
            self.watch();
            app.sub("last_notes").insert(s(folder), json!(s(&new_real)));
            app.save_state();
        }
        if !is_dir {
            self.js("MdView.noteRenamed", &[json!({ "old": s(&old), "path": s(&new), "oldReal": s(&old_real), "real": s(&new_real), "name": name_of(&new_real) })]);
        } else if let Some(rest) = self.path.as_ref().and_then(|p| p.strip_prefix(&old_real).ok().map(Path::to_path_buf)) {
            // the note on screen is in the folder: it stays as it is, under its new path
            let (was, now) = (old_real.join(&rest), new_real.join(&rest));
            self.path = Some(now.clone());
            self.watch();
            app.sub("last_notes").insert(s(folder), json!(s(&now)));
            app.save_state();
            self.js("MdView.noteRenamed", &[json!({ "old": s(&was), "path": s(&now), "oldReal": s(&was), "real": s(&now), "name": name_of(&now) })]);
        }
        self.rescan(app);
        self.send_tabs(app);
    }

    pub(super) fn trash_note(&mut self, app: &mut App, path: &str) {
        self.trash_paths(app, &[path.to_string()]);
    }

    /// Notes, other files and folders of the window's to the trash, in one go (All Notes: what
    /// is selected). Nothing stays on what is gone: no tab, no way back, no link.
    pub(super) fn trash_paths(&mut self, app: &mut App, paths: &[String]) {
        let Some(folder) = self.folder.clone() else { return };
        let mut going: Vec<(PathBuf, PathBuf, bool)> = vec![]; // (as it was named, as it is, a folder)
        for path in paths {
            let p = PathBuf::from(path);
            let is_dir = p.is_dir() && p.starts_with(&folder) && p != folder;
            if !is_dir && !self.note_paths.contains(path.as_str()) {
                continue;
            }
            let real = crate::scan::canon(&p).unwrap_or_else(|_| p.clone());
            going.push((p, real, is_dir));
        }
        if going.is_empty() {
            return;
        }
        let gone = |q: &Path, going: &[(PathBuf, PathBuf, bool)]| going.iter().any(|(_, real, dir)| q == real || (*dir && q.starts_with(real)));
        let was_current = self.path.as_ref().is_some_and(|p| gone(p, &going));
        // the note on screen goes: the one after it that stays, else the one before
        let mut next = None;
        let mut shared = vec![];
        if let Some(tree) = &self.tree {
            let notes = tree.notes();
            if was_current {
                if let Some(i) = notes.iter().position(|n| self.path.as_deref() == Some(Path::new(&n.real))) {
                    let stays = |n: &&&scan::Note| !gone(Path::new(&n.real), &going);
                    next = notes[i + 1..].iter().find(stays).or_else(|| notes[..i].iter().rev().find(stays)).map(|n| PathBuf::from(&n.real));
                }
            }
            shared = notes.iter().map(|n| PathBuf::from(&n.real)).filter(|p| gone(p, &going)).collect();
        }
        let mut done: Vec<(PathBuf, PathBuf, bool)> = vec![];
        for g in going {
            match trash::delete(&g.0) {
                Ok(()) => done.push(g),
                Err(e) => self.toast(format!("Couldn't move “{}” to Trash: {e}", name_of(&g.0))),
            }
        }
        if done.is_empty() {
            return;
        }
        for real in shared.iter().filter(|p| gone(p, &done)) {
            if let Ok(Some(root)) = share::moved(real, None) {
                app.share_dirty.insert(root); // (a link to it shows nothing any more)
            }
        }
        self.back.retain(|p| !gone(p, &done));
        self.fwd.retain(|p| !gone(p, &done));
        if !self.tabs.is_empty() {
            // other tabs: none stays on what is gone, none goes back to it
            self.stash_tab();
            let shown = self.tabs[self.tab].id;
            for t in &mut self.tabs {
                t.back.retain(|p| !gone(p, &done));
                t.fwd.retain(|p| !gone(p, &done));
            }
            self.tabs.retain(|t| t.id == shown || !t.path.as_ref().is_some_and(|p| gone(p, &done)));
            self.tab = self.tab_index(shown).unwrap_or(0);
            self.closed_tabs.retain(|(p, _)| !gone(p, &done));
        }
        for (p, _, _) in &done {
            self.kept_dirs.remove(&s(p));
        }
        let said = if done.len() == 1 { format!("Moved “{}” to Trash", name_of(&done[0].0)) } else { format!("Moved {} items to Trash", done.len()) };
        let current_gone = self.path.as_ref().is_some_and(|p| gone(p, &done));
        // (it can be taken back while the message stands — where the system's trash can be read: not on macOS)
        self.trashed = done.iter().map(|(p, _, _)| p.clone()).collect();
        self.trashed_shown = self.path.clone().filter(|_| current_gone);
        if cfg!(target_os = "macos") {
            self.toast(said);
        } else {
            self.js("MdView.toast", &[json!(said), json!({ "label": "Undo", "type": "untrash" })]);
        }
        self.rescan(app);
        if !current_gone {
            return self.send_tabs(app);
        }
        match next {
            Some(next) => self.open_path(app, &next, None, false),
            None => self.show_nothing(app),
        }
    }

    /// Undo of the last move to the trash: its files and folders back where they stood, the
    /// note that was on screen shown again. (Tabs that were closed for it stay closed.)
    #[cfg(not(target_os = "macos"))]
    pub(super) fn untrash(&mut self, app: &mut App) {
        let wanted = std::mem::take(&mut self.trashed);
        let shown = self.trashed_shown.take();
        if wanted.is_empty() {
            return;
        }
        let items = match trash::os_limited::list() {
            Ok(items) => items,
            Err(e) => return self.toast(format!("Couldn't read the Trash: {e}")),
        };
        // (of each, what was put there last under that path)
        let back: Vec<_> = wanted.iter().filter_map(|p| items.iter().filter(|i| i.original_path() == *p).max_by_key(|i| i.time_deleted).cloned()).collect();
        if back.is_empty() {
            return self.toast("It is no longer in the Trash");
        }
        let n = back.len();
        if let Err(e) = trash::os_limited::restore_all(back) {
            self.toast(format!("Couldn't put it back: {e}"));
        } else {
            self.toast(if n == 1 { format!("Put back “{}”", name_of(&wanted[0])) } else { format!("Put back {n} items") });
        }
        for p in wanted.iter().filter(|p| p.is_dir()) {
            self.kept_dirs.insert(s(p)); // (a folder that was empty is listed again)
        }
        self.rescan(app);
        match shown.filter(|p| p.is_file()) {
            Some(p) => self.open_path(app, &p, None, true),
            None => self.send_tabs(app),
        }
    }
    #[cfg(target_os = "macos")]
    pub(super) fn untrash(&mut self, _app: &mut App) {}

    pub(super) fn sidebar_pref(&mut self, app: &mut App, msg: &Value) {
        if let Some(width) = msg.get("width") {
            // pulled to another width: kept, nothing to scan again for
            if let Some(w) = width.as_f64().or_else(|| width.as_str().and_then(|t| t.trim().parse().ok())) {
                app.state.insert("sidebar_width".into(), json!((w as i64).clamp(180, 640)));
            }
            if let Some(visible) = msg.get("visible") {
                app.state.insert("sidebar".into(), json!(truthy(visible)));
            }
            return app.save_state();
        }
        if let Some(visible) = msg.get("visible") {
            app.state.insert("sidebar".into(), json!(truthy(visible)));
        }
        if let Some(titles) = msg.get("titles") {
            app.state.insert("sidebar_titles".into(), json!(truthy(titles)));
        }
        app.save_state();
        self.rescan(app);
        app.each_win(|w, app| w.rescan(app));
    }
}
