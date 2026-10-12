//! What is put beside a note: pictures and files pasted, dropped or picked, a graphic kept, a
//! whiteboard's file — and what of it the note no longer names, tidied away.

use super::*;

impl Win {
    /// After a save from the active mode: a picture or file the application put beside the
    /// note, which the note no longer names (nor any other note), goes to the trash; one that
    /// is named again is put back, and the page shows it again (attach.rs).
    pub(super) fn tidy_attachments(&mut self, text: Option<&str>) {
        let (Some(note), Some(text)) = (self.path.clone().filter(|p| !is_pdf(p)), text) else { return };
        let root = self.vault().or_else(|| self.folder.clone().filter(|f| note.starts_with(f))).unwrap_or_else(|| dir_of(&note));
        // (how long a file stays after the note stopped naming it; another time: for tests)
        let grace = env("MDVIEW_ATTACH_GRACE").and_then(|g| g.parse().ok()).unwrap_or(crate::attach::GRACE_SECS);
        // What a whiteboard of the note names — the pictures put on it — the note names too: the
        // board's own lines (not its drawn picture) are read along with the note's text.
        let mut full = text.to_string();
        for board in attachments().owned_by(&note).into_iter().filter(|b| is_board(b) && crate::attach::mentions(text, &name_of(b))) {
            if let Ok(t) = fs::read_to_string(&board) {
                let lines = t.find(BOARD_MARK).map(|a| &t[a..t[a..].find("]]>").map_or(t.len(), |z| a + z)]).unwrap_or("");
                full.push('\n');
                full.push_str(lines);
            }
        }
        let text = full.as_str();
        let done = attachments().tidy(&note, text, &root, now(), grace, |p| trash::delete(p).is_ok());
        if !done.restored.is_empty() {
            let names: Vec<String> = done.restored.iter().map(|p| name_of(p)).collect();
            self.js("MdView.filesBack", &[json!(names)]);
        }
    }

    /// Where a pasted image goes: next to the note (or where the settings say, relative to
    /// it), or wherever the Obsidian vault keeps its attachments (default: the vault root).
    pub(super) fn attachment_dir(&self, app: &App, note: &Path, vault: Option<&Path>) -> PathBuf {
        let beside = dir_of(note);
        // A folder of notes of its own that lies inside a vault (the window shows a folder below the
        // vault's root — a project with its history, synced on its own): what is pasted stays in
        // that folder, where the settings say. The vault's place for attachments is outside it —
        // the pictures were not part of the project, never synced, and no link from the note's
        // folder led to them.
        let vault = vault.filter(|v| !self.folder.as_ref().is_some_and(|f| f.as_path() != *v && f.starts_with(v)));
        let Some(vault) = vault else {
            let prefs = app.prefs();
            let wanted = prefs["images"].as_str().unwrap_or("assets").trim();
            if matches!(wanted, "" | "beside" | ".") {
                return beside;
            }
            let d = normalize(&beside.join(if wanted == "assets" { "assets" } else { wanted.trim_start_matches('/') }));
            return if d.starts_with(&beside) { d } else { beside };
        };
        let conf = fs::read_to_string(vault.join(".obsidian/app.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        let conf = conf.as_ref().and_then(|c| c["attachmentFolderPath"].as_str()).filter(|c| !c.trim_matches('/').is_empty());
        let Some(conf) = conf else { return vault.to_path_buf() };
        let d = normalize(&match conf.strip_prefix("./") {
            Some(rel) => beside.join(rel),
            None => vault.join(conf),
        });
        if d.starts_with(vault) { d } else { vault.to_path_buf() }
    }

    pub(super) fn image_markup(&self, target: &Path, note: &Path, vault: bool) -> String {
        if vault {
            return format!("![[{}]]", name_of(target));
        }
        format!("![]({})", quote(&relative(target, &dir_of(note))))
    }

    /// Save the clipboard image as a file and embed it: the page inserts the Markdown at the
    /// caret (editing), or it goes to the end of the note (reading).
    pub(super) fn paste_image(&mut self, app: &mut App, path: Option<&str>, append: bool) {
        let Some(note) = self.path.clone().filter(|p| path == Some(s(p).as_str())) else { return };
        let Some((data, ext)) = host::clipboard_image(&app.handle) else { return };
        let mut old = Vec::new();
        if append {
            old = match fs::read(&note) {
                Ok(old) => old,
                Err(e) => return self.toast(format!("Couldn't add image: {}", strerror(&e))),
            };
            if let Some(reason) = readonly_reason(&note, Some(&old)) {
                return self.toast(format!("Can't edit: {reason}"));
            }
        }
        let vault = self.vault();
        let stem = chrono::Local::now().format(if vault.is_some() { "Pasted image %Y%m%d%H%M%S" } else { "pasted-%Y%m%d-%H%M%S" }).to_string();
        let folder = self.attachment_dir(app, &note, vault.as_deref());
        let target = match write_new(&folder, |n| if n == 1 { format!("{stem}{ext}") } else { format!("{stem}-{n}{ext}") }, &data, 100) {
            Ok(target) => target,
            Err(e) => return self.toast(format!("Couldn't save image: {}", strerror(&e))),
        };
        let markup = self.image_markup(&target, &note, vault.is_some());
        if !append {
            attachments().own(&target, &note);
            return self.js("MdView.insertImage", &[json!({ "path": s(&note), "markup": markup })]);
        }
        let nl: &[u8] = if old.windows(2).any(|w| w == b"\r\n") { b"\r\n" } else { b"\n" };
        let end = old.iter().rposition(|b| !matches!(b, b'\r' | b'\n')).map_or(0, |i| i + 1);
        let mut new = old[..end].to_vec();
        if !new.is_empty() {
            new.extend_from_slice(nl);
            new.extend_from_slice(nl);
        }
        new.extend_from_slice(markup.as_bytes());
        new.extend_from_slice(nl);
        if let Err(e) = fs::write(&note, &new) {
            self.toast(format!("Couldn't save: {}", strerror(&e)));
            let _ = fs::remove_file(&target);
            return;
        }
        self.own_write = Some(new);
        self.new_resolver();
        self.render(app, false, None, true);
    }

    /// Files dropped on the document: one inside the note's folder is linked where it is, any
    /// other is copied where pasted pictures go. A picture is put in as a picture, any other
    /// file as a block that names it; the page inserts the Markdown where they were dropped
    /// (insertDropped).
    pub(super) fn drop_files(&mut self, app: &mut App, uris: &Value, path: Option<&str>) {
        let Some(note) = self.path.clone().filter(|p| path == Some(s(p).as_str())) else { return };
        let vault = self.vault();
        let beside = resolve(&dir_of(&note));
        let (mut markups, mut skipped) = (Vec::new(), 0);
        for uri in uris.as_array().map(Vec::as_slice).unwrap_or_default() {
            let src = uri.as_str().and_then(url_file).map(|(p, _)| p).unwrap_or_default();
            if name_of(&src).is_empty() || !src.is_file() {
                skipped += 1; // (a folder, or nothing that is there)
                continue;
            }
            let picture = scan::IMAGE_EXT.contains(&scan::ext_of(&src).as_str());
            // (a picture as a picture; any other file as a link alone in its paragraph: a file block)
            let markup = |target: &Path| if picture { self.image_markup(target, &note, vault.is_some()) } else { format!("[{}]({})", name_of(target).replace('[', "\\[").replace(']', "\\]"), quote(&relative(target, &dir_of(&note)))) };
            // (… as is a file of the window's folder, wherever in it: a row pulled from its list into the note)
            if resolve(&src).starts_with(&beside) || self.folder.as_ref().is_some_and(|f| resolve(&src).starts_with(f)) {
                markups.push(markup(&resolve(&src)));
                continue;
            }
            let copied = fs::read(&src).and_then(|data| {
                let (stem, ext) = (src.file_stem().unwrap_or_default().to_string_lossy().into_owned(), scan::ext_of(&src));
                let dot = src.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or(format!(".{ext}"));
                write_new(&self.attachment_dir(app, &note, vault.as_deref()), |n| if n == 1 { name_of(&src) } else { format!("{stem}-{n}{dot}") }, &data, 100)
            });
            match copied {
                Ok(target) => {
                    attachments().own(&target, &note);
                    markups.push(markup(&target));
                }
                Err(e) => self.toast(format!("Couldn't copy the file: {}", strerror(&e))),
            }
        }
        if skipped > 0 && markups.is_empty() {
            self.toast("Only files can be dropped here");
        }
        if !markups.is_empty() {
            self.js("MdView.insertDropped", &[json!({ "path": s(&note), "markups": markups })]);
        }
    }

    /// A reference picture for a figure: chosen from the files, or the one on the clipboard
    /// (kept in the cache while it is needed). The page gets its path.
    pub(super) fn graphic_image(&mut self, app: &mut App, how: &str, sent: &str) {
        if how != "paste" && how != "data" {
            return self.pick(app, Pick::Reference);
        }
        // (data: a picture the page made itself — a whiteboard as it stands in the note —, a PNG's base64, no larger than 20 MB)
        let got = if how == "data" {
            base64::engine::general_purpose::STANDARD.decode(sent).ok().filter(|d| d.len() <= 20_000_000 && d.starts_with(b"\x89PNG")).map(|d| (d, ".png".to_string()))
        } else {
            host::clipboard_image(&app.handle).map(|(d, ext)| (d, ext.to_string()))
        };
        let Some((data, ext)) = got else {
            return self.js("MdView.graphicImage", &[Value::Null, Value::Null, json!(if how == "data" { "No picture came" } else { "No picture on the clipboard" })]);
        };
        let dir = env("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".cache")).join("mdview");
        let p = dir.join(format!("reference{ext}"));
        if fs::create_dir_all(&dir).and_then(|_| fs::write(&p, data)).is_ok() {
            self.js("MdView.graphicImage", &[json!(s(&p)), json!(format!("{}?{}", file_url(&p), now())), Value::Null]);
        }
    }

    /// The figure as a file where the note's pictures go, and its Markdown at the caret.
    pub(super) fn save_graphic(&mut self, app: &mut App, svg: &str, name: &str) {
        let Some(svg) = ai::clean_svg(svg) else { return };
        let Some(note) = self.path.clone().filter(|p| !is_pdf(p)) else { return };
        let vault = self.vault();
        let clean = clean_name(name);
        let words: Vec<&str> = WORD_RE.find_iter(&clean).take(5).map(|m| m.as_str()).collect();
        let stem = take(&words.join("-"), 48).trim_matches('-').to_string();
        let stem = if stem.is_empty() { "graphic".to_string() } else { stem };
        let folder = self.attachment_dir(app, &note, vault.as_deref());
        match write_new(&folder, |n| if n == 1 { format!("{stem}.svg") } else { format!("{stem}-{n}.svg") }, format!("{svg}\n").as_bytes(), 200) {
            Ok(target) => {
                attachments().own(&target, &note);
                let markup = self.image_markup(&target, &note, vault.is_some());
                self.js("MdView.insertImage", &[json!({ "path": s(&note), "markup": markup })]);
            }
            Err(e) => self.toast(format!("Couldn't save the figure: {}", strerror(&e))),
        }
    }

    /// A whiteboard for the note: its file (the page wrote what an empty one holds) where the
    /// note's pictures go, the note's own from now on, and how the note names it.
    pub(super) fn board_new(&mut self, app: &mut App, note: &str, text: &str, id: &Value) {
        let failed = |w: &Self, e: String| w.js("MdView.boardMade", &[json!({ "id": id, "error": e })]);
        let Some(path) = self.path.clone().filter(|p| !is_pdf(p) && s(p) == note) else { return failed(self, "another note".into()) };
        if !text.contains(BOARD_MARK) {
            return failed(self, "not a whiteboard".into());
        }
        let vault = self.vault();
        let stem = chrono::Local::now().format("board-%Y%m%d-%H%M%S").to_string();
        let folder = self.attachment_dir(app, &path, vault.as_deref());
        match write_new(&folder, |n| if n == 1 { format!("{stem}.board.svg") } else { format!("{stem}-{n}.board.svg") }, text.as_bytes(), 100) {
            Ok(target) => {
                attachments().own(&target, &path);
                let markup = self.image_markup(&target, &path, vault.is_some());
                self.js("MdView.boardMade", &[json!({ "id": id, "path": s(&path), "markup": markup, "file": s(&target) })]);
            }
            Err(e) => failed(self, strerror(&e)),
        }
    }

    /// A whiteboard's text for the page (it may not read files itself).
    pub(super) fn board_read(&self, path: &str, id: &Value) {
        let p = resolve(Path::new(path));
        let read = || -> Result<String, String> {
            if !is_board(&p) || !p.is_file() {
                return Err("not a whiteboard".into());
            }
            if fs::metadata(&p).map_err(|e| strerror(&e))?.len() > 50_000_000 {
                return Err("larger than 50 MB".into());
            }
            fs::read_to_string(&p).map_err(|e| strerror(&e))
        };
        match read() {
            Ok(text) => self.js("MdView.boardText", &[id.clone(), json!(text), Value::Null]),
            Err(e) => self.js("MdView.boardText", &[id.clone(), Value::Null, json!(e)]),
        }
    }

    /// … and the board as it is to be. Only into a whiteboard that is there, and only a
    /// whiteboard's text: this is no way to write any file.
    pub(super) fn board_save(&mut self, path: &str, text: &str, id: &Value) {
        let p = resolve(Path::new(path));
        let done = if !is_board(&p) || !p.is_file() || !text.contains(BOARD_MARK) {
            Err("not a whiteboard".to_string())
        } else {
            fs::write(&p, text.as_bytes()).map_err(|e| strerror(&e))
        };
        self.js("MdView.boardSaved", &[id.clone(), done.err().map(|e| json!(e)).unwrap_or(Value::Null)]);
    }

    /// A picture from the clipboard for a whiteboard: a file beside the board's own — the note's
    /// from now on where the board is a note's, a file of the folder like the board where it is
    /// one. The page is told its name (none: the clipboard holds no picture).
    pub(super) fn board_paste(&mut self, app: &mut App, board: &str, id: &Value) {
        let done = |w: &Self, names: Vec<String>, e: Option<String>| w.js("MdView.boardPut", &[id.clone(), json!(names), e.map(|e| json!(e)).unwrap_or(Value::Null)]);
        let p = resolve(Path::new(board));
        if !is_board(&p) || !p.is_file() {
            return done(self, vec![], Some("not a whiteboard".into()));
        }
        let note = attachments().owner(&p);
        let Some((data, ext)) = host::clipboard_image(&app.handle) else { return done(self, vec![], None) };
        let stem = chrono::Local::now().format("pasted-%Y%m%d-%H%M%S").to_string();
        match write_new(&dir_of(&p), |n| if n == 1 { format!("{stem}{ext}") } else { format!("{stem}-{n}{ext}") }, &data, 100) {
            Ok(target) => {
                if let Some(note) = &note {
                    attachments().own(&target, note);
                }
                done(self, vec![name_of(&target)], None)
            }
            Err(e) => done(self, vec![], Some(strerror(&e))),
        }
    }

    /// Pictures for a whiteboard, chosen in the system's own window (the board's Picture button):
    /// what is chosen comes in as files dropped on the board do.
    pub(super) fn board_pick(&self, app: &App, board: &str, id: &Value) {
        let Some(window) = &self.window else { return };
        let dialog = app.handle.dialog().file().set_parent(window).set_title("Insert Picture").add_filter("Pictures", scan::IMAGE_EXT);
        let (tx, label, board, id) = (app.tx.clone(), self.label.clone(), board.to_string(), id.clone());
        dialog.pick_files(move |paths| {
            let uris: Vec<String> = paths.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).filter_map(|p| tauri::Url::from_file_path(p).ok()).map(|u| u.to_string()).collect();
            let _ = tx.send(Event::Msg { label, json: json!({ "type": "board-drop", "uris": uris, "path": board, "id": id }).to_string() });
        });
    }

    /// Files dropped on a whiteboard: one that lies beside the board already is used where it
    /// is, any other is copied there (a picture stands on the board as itself, any other file
    /// as a card). Notes and whiteboards are left out.
    pub(super) fn board_drop(&mut self, board: &str, uris: &Value, id: &Value) {
        let p = resolve(Path::new(board));
        if !is_board(&p) || !p.is_file() {
            return self.js("MdView.boardPut", &[id.clone(), json!([]), json!("not a whiteboard")]);
        }
        let note = attachments().owner(&p); // (none: a whiteboard that is a file of its own — what is put on it is the folder's too)
        let (beside, mut names, mut failed) = (dir_of(&p), Vec::new(), None);
        for uri in uris.as_array().map(Vec::as_slice).unwrap_or_default() {
            let src = uri.as_str().and_then(url_file).map(|(p, _)| p).unwrap_or_default();
            if !src.is_file() || scan::is_md(&src) || is_board(&src) || fs::metadata(&src).map_or(true, |m| m.len() > 50_000_000) {
                continue;
            }
            if resolve(&src).parent() == Some(beside.as_path()) {
                names.push(name_of(&src));
                continue;
            }
            let (stem, dot) = (src.file_stem().unwrap_or_default().to_string_lossy().into_owned(), src.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default());
            match fs::read(&src).and_then(|data| write_new(&beside, |n| if n == 1 { name_of(&src) } else { format!("{stem}-{n}{dot}") }, &data, 100)) {
                Ok(target) => {
                    if let Some(note) = &note {
                        attachments().own(&target, note);
                    }
                    names.push(name_of(&target));
                }
                Err(e) => failed = Some(strerror(&e)),
            }
        }
        self.js("MdView.boardPut", &[id.clone(), json!(names), failed.map(|e| json!(e)).unwrap_or(Value::Null)]);
    }
}
