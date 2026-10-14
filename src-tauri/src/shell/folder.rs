//! A folder window's folder: its notes sent to the sidebar (and their previews), quick notes, a
//! note or a folder made, renamed, moved, put in the trash and taken out again.

use super::*;

impl Win {
    pub(super) fn rescan(&mut self, app: &mut App) {
        self.rescan_turn += 1; // (a scan that was still to come is this one)
        let Some(folder) = self.folder.clone() else { return };
        let titles = app.state.get("sidebar_titles").is_some_and(truthy);
        // (everything that lies there; the page shows of it what the sidebar and All Notes are each set to —
        // viewer/sidebar.js, listed. Put away: what was hidden by hand, and what the application keeps for a note.)
        let mut put_away = crate::hidden::listed(&folder);
        put_away.extend(attachments().owned());
        let all = truthy(&app.prefs()["showHidden"]);
        let (tree, walked) = scan::scan_folder(&folder, &mut self.title_cache, titles, &self.kept_dirs, &put_away, all);
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
        if self.folder.is_none() || !self.knows(path) {
            return;
        }
        if self.quick && self.path.as_deref() != Some(Path::new(path)) && self.settle_quick() {
            self.rescan(app);
            if !Path::new(path).exists() {
                return;
            }
        }
        let path = Path::new(path);
        if is_board(path) {
            return self.js("MdView.openBoardFile", &[json!(s(path))]); // a whiteboard: over the window, as one in a note opens
        }
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
        // written at once, in the mode that is worked in: the active one where that is it, the source beside its reading
        // where that is it, else the source
        match app.state.get("mode").and_then(Value::as_str) {
            Some("active") => self.js("MdView.setMode", &[json!("active")]),
            Some("split") => self.js("MdView.setMode", &[json!("split"), json!("end")]),
            _ => self.js("MdView.setMode", &[json!("edit"), json!("end")]),
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
        if !is_dir && !self.knows(path) {
            return;
        }
        // (what a name ends with stays: a whiteboard's two endings both)
        let suffix = if is_dir { String::new() } else if is_board(&old) { name_of(&old)[name_of(&old).len() - ".board.svg".len()..].to_string() } else { old.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default() };
        let mut stem = clean_name(name);
        if !suffix.is_empty() && stem.to_lowercase().ends_with(&suffix.to_lowercase()) {
            stem = stem[..stem.len() - suffix.len()].trim_end().to_string();
        }
        if is_board(&old) && stem.to_lowercase().ends_with(".board") {
            stem = stem[..stem.len() - ".board".len()].trim_end().to_string(); // (… or the first of its two alone)
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
        let known = self.knows(path) || (old.is_dir() && old.starts_with(&folder) && old != folder);
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
        crate::hidden::moved(folder, &old, Some(&new)); // (hidden, it stays hidden)
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
            if !is_dir && !self.knows(path) {
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
            crate::hidden::moved(&folder, p, None);
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

    /// A file of the window's folder, as the page may name one: what the folder's list holds, and
    /// the whiteboards listed for All Notes (those a note keeps are in no list of the folder).
    pub(super) fn knows(&self, path: &str) -> bool {
        self.note_paths.contains(path) || self.board_paths.contains(path)
    }

    /// … or a folder in it.
    fn knows_any(&self, folder: &Path, path: &str) -> bool {
        let p = Path::new(path);
        self.knows(path) || (p.is_dir() && p.starts_with(folder) && p != folder)
    }

    /// Files and folders put out of sight, or shown again (kept in the folder: hidden.rs).
    pub(super) fn hide(&mut self, app: &mut App, paths: &Value, on: bool) {
        let Some(folder) = self.folder.clone() else { return };
        let paths: Vec<PathBuf> = paths.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).filter(|p| self.knows_any(&folder, p)).map(PathBuf::from).collect();
        if paths.is_empty() {
            return;
        }
        match crate::hidden::set(&folder, &paths.iter().map(PathBuf::as_path).collect::<Vec<_>>(), on) {
            Ok(()) if on && !truthy(&app.prefs()["showHidden"]) => {
                let said = if paths.len() == 1 { format!("“{}” is hidden", name_of(&paths[0])) } else { format!("{} items are hidden", paths.len()) };
                self.js("MdView.toast", &[json!(said), json!({ "label": "Undo", "type": "hide", "data": { "paths": paths.iter().map(|p| s(p)).collect::<Vec<_>>(), "on": false } })]);
            }
            Ok(()) => {}
            Err(e) => self.toast(format!("Couldn't hide it: {e}")),
        }
        self.rescan(app);
        app.each_win(|w, app| if w.folder.as_ref() == Some(&folder) { w.rescan(app) });
    }

    /// Copy or Cut in the folder's list: remembered for Paste (in any window), and put on the
    /// system's clipboard as the files' paths, a line each.
    pub(super) fn copy_files(&mut self, app: &mut App, paths: &Value, cut: bool) {
        let Some(folder) = self.folder.clone() else { return };
        let paths: Vec<PathBuf> = paths.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).filter(|p| self.knows_any(&folder, p)).map(PathBuf::from).collect();
        if paths.is_empty() {
            return;
        }
        host::copy_text(&app.handle, paths.iter().map(|p| s(p)).collect::<Vec<_>>().join("\n"));
        let said = match (paths.len(), cut) {
            (1, false) => format!("Copied “{}”", name_of(&paths[0])),
            (1, true) => format!("Cut “{}”: Paste moves it", name_of(&paths[0])),
            (n, false) => format!("Copied {n} items"),
            (n, true) => format!("Cut {n} items: Paste moves them"),
        };
        app.file_clip = (paths, cut);
        self.toast(said);
    }

    /// Paste into a folder of the window's: what was copied here is copied there (cut: moved),
    /// and what the system's clipboard names as files — copied in a file manager — comes in too.
    pub(super) fn paste_files(&mut self, app: &mut App, wanted: Option<&str>) {
        let Some(folder) = self.folder.clone() else { return };
        let into = self.target_dir(&folder, wanted);
        let (mut from, mut cut) = app.file_clip.clone();
        let clip = host::clipboard_text(&app.handle).unwrap_or_default();
        let named: Vec<PathBuf> = clip.lines().map(str::trim).filter(|l| !l.is_empty()).map(|l| url_file(l).map(|(p, _)| p).unwrap_or_else(|| PathBuf::from(l))).collect();
        let files = !named.is_empty() && named.len() <= 500 && named.iter().all(|p| p.is_absolute() && p.exists());
        // (the clipboard says something else by now: that is what is pasted — files it names, or nothing)
        if files && named != from {
            (from, cut) = (named, false);
        } else if !files && !from.is_empty() && clip != from.iter().map(|p| s(p)).collect::<Vec<_>>().join("\n") {
            from.clear();
        }
        from.retain(|p| p.exists());
        if from.is_empty() {
            return self.toast("No files to paste");
        }
        if cut {
            app.file_clip = (vec![], false);
            for p in &from {
                if p.parent() != Some(into.as_path()) {
                    self.move_to(app, &s(p), &s(&into));
                }
            }
            return;
        }
        self.bring_in(app, &from, &into, "Pasted");
    }

    /// Files and folders copied into a folder of the window's, under names that are free there
    /// ("Name 2.pdf"). how: what is said of it ("Pasted", "Added").
    fn bring_in(&mut self, app: &mut App, from: &[PathBuf], into: &Path, how: &str) -> Vec<PathBuf> {
        let mut made = vec![];
        for src in from {
            if into.starts_with(src) && src.is_dir() {
                self.toast(format!("“{}” can't be copied into itself", name_of(src)));
                continue;
            }
            match copy_free(src, into, false) {
                Ok(target) => made.push(target),
                Err(e) => self.toast(format!("Couldn't copy “{}”: {}", name_of(src), strerror(&e))),
            }
        }
        if made.is_empty() {
            return made;
        }
        for d in made.iter().filter(|p| p.is_dir()) {
            self.kept_dirs.insert(s(d));
        }
        self.toast(if made.len() == 1 { format!("{how} “{}”", name_of(&made[0])) } else { format!("{how} {} items", made.len()) });
        app.touch(into);
        self.rescan(app);
        self.js("MdView.revealRows", &[json!(made.iter().map(|p| s(p)).collect::<Vec<_>>())]);
        made
    }

    /// A copy beside the thing itself: "Name copy.md", "Name copy 2.md".
    pub(super) fn duplicate(&mut self, app: &mut App, paths: &Value) {
        let Some(folder) = self.folder.clone() else { return };
        let mut made = vec![];
        for p in paths.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).filter(|p| self.knows_any(&folder, p)) {
            let src = PathBuf::from(p);
            match copy_free(&src, &dir_of(&src), true) {
                Ok(target) => made.push(target),
                Err(e) => self.toast(format!("Couldn't duplicate “{}”: {}", name_of(&src), strerror(&e))),
            }
        }
        if made.is_empty() {
            return;
        }
        for d in made.iter().filter(|p| p.is_dir()) {
            self.kept_dirs.insert(s(d));
        }
        app.touch(&folder);
        self.rescan(app);
        self.js("MdView.revealRows", &[json!(made.iter().map(|p| s(p)).collect::<Vec<_>>())]);
    }

    /// Files and folders from elsewhere — dropped on the folder's list, or chosen in the system's
    /// own window (Add Files…) — copied into a folder of the window's. What lies in the window's
    /// folder already is moved there instead: it was pulled from one place of it to another.
    pub(super) fn import(&mut self, app: &mut App, uris: &Value, wanted: Option<&str>) {
        let Some(folder) = self.folder.clone() else { return };
        let into = self.target_dir(&folder, wanted);
        let from: Vec<PathBuf> = uris.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).filter_map(|u| url_file(u).map(|(p, _)| p)).filter(|p| p.exists()).take(500).collect();
        let (inside, outside): (Vec<PathBuf>, Vec<PathBuf>) = from.into_iter().partition(|p| resolve(p).starts_with(&folder));
        for p in inside.iter().filter(|p| p.parent() != Some(into.as_path())) {
            self.move_to(app, &s(p), &s(&into));
        }
        if !outside.is_empty() {
            self.bring_in(app, &outside, &into, "Added");
        }
    }

    /// Add Files…: chosen in the system's own window, then as files dropped on the list.
    pub(super) fn add_files(&self, app: &App, wanted: Option<&str>) {
        let (Some(window), Some(folder)) = (&self.window, self.folder.clone()) else { return };
        let into = self.target_dir(&folder, wanted);
        let dialog = app.handle.dialog().file().set_parent(window).set_title(format!("Add Files to “{}”", name_of(&into)));
        let (tx, label) = (app.tx.clone(), self.label.clone());
        dialog.pick_files(move |paths| {
            let uris: Vec<String> = paths.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).filter_map(|p| tauri::Url::from_file_path(p).ok()).map(|u| u.to_string()).collect();
            if !uris.is_empty() {
                let _ = tx.send(Event::Msg { label, json: json!({ "type": "import", "uris": uris, "dir": s(&into) }).to_string() });
            }
        });
    }

    /// A whiteboard as a file of the folder — its own, in no note (one can show it all the
    /// same: it is linked there as a picture is). The page wrote what an empty one holds.
    pub(super) fn new_board(&mut self, app: &mut App, name: &str, wanted: Option<&str>, text: &str) {
        let Some(folder) = self.folder.clone() else { return };
        if !text.contains(BOARD_MARK) {
            return;
        }
        let into = self.target_dir(&folder, wanted);
        let mut stem = clean_name(name);
        for ending in [".board.svg", ".svg", ".board"] {
            if stem.to_lowercase().ends_with(ending) {
                stem = stem[..stem.len() - ending.len()].trim_end().to_string();
            }
        }
        let stem = if stem.is_empty() { "Whiteboard".to_string() } else { stem };
        let path = into.join(format!("{stem}.board.svg"));
        match fs::OpenOptions::new().write(true).create_new(true).open(&path).and_then(|mut f| f.write_all(text.as_bytes())) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => self.toast(format!("“{}” already exists", name_of(&path))),
            Err(e) => return self.toast(format!("Couldn't create the whiteboard: {}", strerror(&e))),
        }
        self.rescan(app);
        self.board_paths.insert(s(&path));
        self.js("MdView.revealRows", &[json!([s(&path)])]);
        self.js("MdView.openBoardFile", &[json!(s(&path))]);
    }

    /// Every whiteboard of the folder, for All Notes: those that are files of their own and
    /// those a note keeps (which the folder's list leaves out), each with the notes that show it.
    pub(super) fn send_boards(&mut self) {
        let Some(folder) = self.folder.clone() else { return };
        let (mut boards, mut notes) = (vec![], vec![]);
        each_file(&folder, 0, &mut |p| {
            if is_board(p) && boards.len() < 2000 {
                boards.push(p.to_path_buf());
            } else if is_md(p) && notes.len() < 4000 {
                notes.push(p.to_path_buf());
            }
        });
        let owned = attachments();
        let mut out: Vec<Value> = boards.iter().map(|b| json!({ "path": s(b), "name": name_of(b), "url": file_url(b), "mtime": mtime(b).unwrap_or(0.0), "kept": owned.owner(b).is_some(), "in": [] })).collect();
        if !boards.is_empty() {
            let names: Vec<String> = boards.iter().map(|b| name_of(b)).collect();
            for note in &notes {
                let Ok(text) = read_text(note, Some(4_000_000)) else { continue };
                if !text.contains(".board.svg") {
                    continue;
                }
                for (k, name) in names.iter().enumerate() {
                    if crate::attach::mentions(&text, name) {
                        if let Some(list) = out[k]["in"].as_array_mut() {
                            list.push(json!(s(note)));
                        }
                    }
                }
            }
        }
        self.board_paths = boards.iter().map(|b| s(b)).collect();
        self.js("MdView.setBoards", &[json!(out)]);
    }

    /// A whiteboard a note keeps becomes a file of its own: listed in the folder, and no
    /// longer taken away with what the note no longer shows.
    pub(super) fn board_free(&mut self, app: &mut App, path: &str) {
        if !self.knows(path) || !is_board(Path::new(path)) {
            return;
        }
        attachments().disown(Path::new(path));
        self.rescan(app);
        self.send_boards();
    }
}

/// Every file below dir — names with a dot and what is built left out, as the folder's list does.
fn each_file(dir: &Path, depth: usize, f: &mut dyn FnMut(&Path)) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for e in read.flatten() {
        let (name, path) = (e.file_name().to_string_lossy().into_owned(), e.path());
        if name.starts_with('.') {
            continue;
        }
        match e.file_type() {
            Ok(t) if t.is_dir() => {
                if depth < 12 && !scan::SKIP_DIRS.contains(&name.as_str()) {
                    each_file(&path, depth + 1, f);
                }
            }
            Ok(_) if path.is_file() => f(&path),
            _ => {}
        }
    }
}

/// A file's name in two: what is kept when a number is put in, and its ending — a whiteboard's
/// both ("a.board.svg": "a", ".board.svg").
fn name_parts(path: &Path) -> (String, String) {
    let name = name_of(path);
    if path.is_dir() {
        return (name, String::new());
    }
    if is_board(path) {
        let at = name.len() - ".board.svg".len();
        return (name[..at].to_string(), name[at..].to_string());
    }
    match path.extension() {
        Some(e) if path.file_stem().is_some_and(|st| !st.is_empty()) => (path.file_stem().unwrap().to_string_lossy().into_owned(), format!(".{}", e.to_string_lossy())),
        _ => (name, String::new()),
    }
}

/// src copied into dir — a folder with all that is in it — under the first name that is free:
/// its own, then "Name 2.x" (copy: "Name copy.x", "Name copy 2.x"). Links are not followed.
fn copy_free(src: &Path, dir: &Path, copy: bool) -> std::io::Result<PathBuf> {
    let (stem, ending) = name_parts(src);
    let stem = if copy { format!("{stem} copy") } else { stem };
    for n in 1..1000 {
        let target = dir.join(if n == 1 { format!("{stem}{ending}") } else { format!("{stem} {n}{ending}") });
        if fs::symlink_metadata(&target).is_ok() {
            continue;
        }
        return copy_tree(src, &target, 0).map(|()| target);
    }
    Err(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "no free name"))
}

fn copy_tree(src: &Path, target: &Path, depth: usize) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.is_dir() {
        if depth > 32 {
            return Err(std::io::Error::other("too deep"));
        }
        fs::create_dir(target)?;
        for e in fs::read_dir(src)? {
            let e = e?;
            copy_tree(&e.path(), &target.join(e.file_name()), depth + 1)?;
        }
        Ok(())
    } else if meta.is_file() {
        fs::copy(src, target).map(|_| ())
    } else {
        Ok(()) // (a link, a device: left where it is)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_copy_takes_the_first_free_name_and_a_folder_comes_whole() {
        let d = std::env::temp_dir().join(format!("mdview-copy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("a/in")).unwrap();
        fs::create_dir_all(d.join("to")).unwrap();
        fs::write(d.join("a/in/n.md"), "x").unwrap();
        fs::write(d.join("b.board.svg"), "b").unwrap();
        fs::write(d.join(".env"), "e").unwrap();
        assert_eq!(copy_free(&d.join("a"), &d.join("to"), false).unwrap(), d.join("to/a"));
        assert_eq!(fs::read_to_string(d.join("to/a/in/n.md")).unwrap(), "x");
        assert_eq!(copy_free(&d.join("a"), &d.join("to"), false).unwrap(), d.join("to/a 2"));
        assert_eq!(copy_free(&d.join("b.board.svg"), &d, true).unwrap(), d.join("b copy.board.svg"));
        assert_eq!(copy_free(&d.join("b.board.svg"), &d, true).unwrap(), d.join("b copy 2.board.svg"));
        assert_eq!(copy_free(&d.join(".env"), &d, true).unwrap(), d.join(".env copy"));
        let _ = fs::remove_dir_all(&d);
    }
}
