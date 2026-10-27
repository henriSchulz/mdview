//! What is put beside a note: pictures and files pasted, dropped or picked, a graphic kept, a
//! whiteboard's file — and what of it the note no longer names, tidied away.

use super::*;

fn base_folder(note: &Path, folder: Option<&Path>) -> PathBuf {
    if let Place::Project(root) = history::place_of(note) {
        return root;
    }
    folder.filter(|f| note.starts_with(f)).map(Path::to_path_buf).unwrap_or_else(|| dir_of(note))
}

/// Where the settings put what is pasted into a note (`images`), outside a vault.
fn kept_in(note: &Path, base: &Path, wanted: &str) -> PathBuf {
    let (beside, wanted) = (dir_of(note), wanted.trim());
    if matches!(wanted, "" | "beside" | ".") {
        return beside;
    }
    if wanted == scan::ASSETS {
        return base.join(scan::ASSETS);
    }
    let d = normalize(&beside.join(wanted.trim_start_matches('/')));
    if d.starts_with(&beside) { d } else { beside }
}

fn way(target: &Path, note: &Path, base: &Path) -> String {
    if target.parent() == Some(base.join(scan::ASSETS).as_path()) {
        return format!("{}/{}", scan::ASSETS, name_of(target));
    }
    relative(target, &dir_of(note))
}

/// Where what was drawn on a PDF is kept (board/pdf.js): a whiteboard's file in the base
/// folder's `.mdview/pdf`, named by what the PDF holds — Git's name for the file's bytes, the one
/// the web app knows the file by too. So a PDF that is moved or renamed keeps what was drawn on
/// it, a copy of it shows the same, and the PDF itself is never written to.
const PDF_INK: &str = ".mdview/pdf";
fn ink_of(pdf: &Path, base: &Path) -> Result<PathBuf, String> {
    // (a file's name is asked for at every save: worked out once for the file as it is)
    // (known by which file it is too, not only by its length and time: another PDF of the same length put in its place in the
    // same tick of the clock was given the first one's name, and what was drawn on that)
    static KNOWN: LazyLock<std::sync::Mutex<HashMap<PathBuf, (u64, SystemTime, u64, String)>>> = LazyLock::new(Default::default);
    let meta = fs::metadata(pdf).map_err(|e| strerror(&e))?;
    let (len, at) = (meta.len(), meta.modified().unwrap_or(UNIX_EPOCH));
    #[cfg(unix)]
    let which = std::os::unix::fs::MetadataExt::ino(&meta);
    #[cfg(not(unix))]
    let which = meta.created().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos() as u64);
    let mut known = KNOWN.lock().unwrap_or_else(|e| e.into_inner());
    let name = match known.get(pdf) {
        Some((l, t, w, name)) if *l == len && *t == at && *w == which => name.clone(),
        _ => {
            let name = git2::Oid::hash_file(git2::ObjectType::Blob, pdf).map_err(|e| e.message().to_string())?.to_string();
            known.insert(pdf.to_path_buf(), (len, at, which, name.clone()));
            name
        }
    };
    Ok(base.join(PDF_INK).join(format!("{name}.board.svg")))
}
fn ink_read(pdf: &Path, base: &Path) -> Result<Option<String>, String> {
    let file = ink_of(pdf, base)?;
    if !file.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&file).map(Some).map_err(|e| strerror(&e))
}
/// empty: nothing is drawn on the PDF (any more) — then nothing is kept, and no folder for it.
fn ink_save(pdf: &Path, base: &Path, text: &str, empty: bool) -> Result<(), String> {
    let file = ink_of(pdf, base)?;
    if empty {
        if file.is_file() {
            fs::remove_file(&file).map_err(|e| strerror(&e))?;
        }
        let _ = fs::remove_dir(base.join(PDF_INK)); // (if nothing else is in them)
        let _ = fs::remove_dir(base.join(".mdview"));
        return Ok(());
    }
    if !text.contains(BOARD_MARK) {
        return Err("not a whiteboard".into());
    }
    fs::create_dir_all(dir_of(&file)).and_then(|()| fs::write(&file, text.as_bytes())).map_err(|e| strerror(&e))
}

impl Win {
    /// After a save from the active mode: a picture or file the application put beside the
    /// note, which the note no longer names (nor any other note), goes to the trash; one that
    /// is named again is put back, and the page shows it again (attach.rs).
    pub(super) fn tidy_attachments(&mut self, text: Option<&str>) {
        let (Some(note), Some(text)) = (self.path.clone().filter(|p| !shows_as_pdf(p)), text) else { return };
        // (whose notes may name the file too: the base folder's — what is put into them lies in one place)
        let base = self.base_of(&note);
        let root = self.vault().or_else(|| self.folder.clone().filter(|f| base.starts_with(f))).unwrap_or(base);
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

    /// A note's base folder: the one folder whose `assets` holds what is put into its notes,
    /// whatever subfolder they are in — the root of the project the note is in (history.rs), else
    /// the window's folder, else (a note opened by itself) the folder the note lies in.
    pub(super) fn base_of(&self, note: &Path) -> PathBuf {
        base_folder(note, self.folder.as_deref())
    }

    /// Where a pasted image goes: the base folder's `assets` — one place for the notes of every
    /// subfolder, so that a note moved to another one names its pictures as before (it had an
    /// `assets` of its own in each subfolder, and a note moved lost its pictures) —, or beside
    /// the note, or in a folder relative to it, as the settings say; or wherever the Obsidian
    /// vault keeps its attachments (default: the vault root).
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
            return kept_in(note, &self.base_of(note), prefs["images"].as_str().unwrap_or(scan::ASSETS));
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
        format!("![]({})", quote(&self.way_to(target, note)))
    }

    /// How a note names a file: the way to it from the note's folder — but what lies in the base
    /// folder's `assets` is `assets/x.png` in a note of any subfolder: the same words wherever
    /// the note is moved and wherever the block is pasted, found from there (scan::found).
    pub(super) fn way_to(&self, target: &Path, note: &Path) -> String {
        way(target, note, &self.base_of(note))
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
            let markup = |target: &Path| if picture { self.image_markup(target, &note, vault.is_some()) } else { format!("[{}]({})", name_of(target).replace('[', "\\[").replace(']', "\\]"), quote(&self.way_to(target, &note))) };
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
        let Some(note) = self.path.clone().filter(|p| !shows_as_pdf(p)) else { return };
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
        let Some(path) = self.path.clone().filter(|p| !shows_as_pdf(p) && s(p) == note) else { return failed(self, "another note".into()) };
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
        let p = scan::found(&resolve(Path::new(path))); // (named as `assets/…` by a note of a subfolder: the base folder's)
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
        let p = scan::found(&resolve(Path::new(path)));
        let done = if !is_board(&p) || !p.is_file() || !text.contains(BOARD_MARK) {
            Err("not a whiteboard".to_string())
        } else {
            fs::write(&p, text.as_bytes()).map_err(|e| strerror(&e))
        };
        self.js("MdView.boardSaved", &[id.clone(), done.err().map(|e| json!(e)).unwrap_or(Value::Null)]);
    }

    /// A note beside the one in the window (viewer/split.js): its text, and what its links lead
    /// to — worked out from where that note lies, not from the one on screen.
    pub(super) fn note_read(&mut self, path: &str, id: &Value) {
        let p = scan::found(&resolve(Path::new(path)));
        if !is_md(&p) || !p.is_file() {
            return self.js("MdView.noteRead", &[id.clone(), Value::Null, json!("not a note")]);
        }
        match fs::read(&p) {
            Ok(raw) => {
                let text = String::from_utf8_lossy(&raw).into_owned();
                let own = self.resolver.take();
                self.resolver = Some(Resolver::in_base(&dir_of(&p), &home(), self.folder.as_deref()));
                let links = if text.contains("[[") { self.build_links(&text) } else { json!({}) };
                self.resolver = own;
                self.js("MdView.noteRead", &[id.clone(), json!({ "path": s(&p), "text": text, "links": links }), Value::Null]);
            }
            Err(e) => self.js("MdView.noteRead", &[id.clone(), Value::Null, json!(strerror(&e))]),
        }
    }

    /// … and written in there: kept as the window's own note is (save_text) — its line endings as
    /// they were, a link followed. Only a note, only one that is there, and not the one in the
    /// window (that one is written in the window).
    pub(super) fn note_save(&mut self, path: &str, text: Option<&str>, id: &Value) {
        let p = scan::found(&resolve(Path::new(path)));
        let done = || -> Result<(), String> {
            let text = text.ok_or("no text")?;
            if !is_md(&p) || !p.is_file() {
                return Err("not a note".into());
            }
            if self.path.as_deref().map(resolve).as_deref() == Some(p.as_path()) {
                return Err("open in the window".into());
            }
            let old = fs::read(&p).map_err(|e| strerror(&e))?;
            let crlf = old.windows(2).any(|w| w == b"\r\n");
            let data = if crlf { text.replace('\n', "\r\n").into_bytes() } else { text.as_bytes().to_vec() };
            if data != old {
                write_whole(&p, &data).map_err(|e| strerror(&e))?;
            }
            Ok(())
        };
        let r = done();
        self.js("MdView.noteSaved", &[id.clone(), r.err().map(|e| json!(e)).unwrap_or(Value::Null)]);
    }

    /// What was drawn on a PDF, for the page: a whiteboard's text, or nothing where nothing was
    /// drawn yet …
    pub(super) fn pdfink_read(&self, path: &str, id: &Value) {
        let p = scan::found(&resolve(Path::new(path)));
        let read = if shows_as_pdf(&p) && p.is_file() { ink_read(&p, &self.base_of(&p)) } else { Err("not a PDF file".into()) };
        match read {
            Ok(text) => self.js("MdView.boardText", &[id.clone(), json!(text), Value::Null]),
            Err(e) => self.js("MdView.boardText", &[id.clone(), Value::Null, json!(e)]),
        }
    }

    /// … and as it is to be. The PDF is not touched.
    pub(super) fn pdfink_save(&mut self, path: &str, text: &str, empty: bool, id: &Value) {
        let p = scan::found(&resolve(Path::new(path)));
        let done = if shows_as_pdf(&p) && p.is_file() { ink_save(&p, &self.base_of(&p), text, empty) } else { Err("not a PDF file".into()) };
        self.js("MdView.boardSaved", &[id.clone(), done.err().map(|e| json!(e)).unwrap_or(Value::Null)]);
    }

    /// A picture from the clipboard for a whiteboard: a file beside the board's own — the note's
    /// from now on where the board is a note's, a file of the folder like the board where it is
    /// one. The page is told its name (none: the clipboard holds no picture).
    pub(super) fn board_paste(&mut self, app: &mut App, board: &str, id: &Value) {
        let done = |w: &Self, names: Vec<String>, e: Option<String>| w.js("MdView.boardPut", &[id.clone(), json!(names), e.map(|e| json!(e)).unwrap_or(Value::Null)]);
        let p = scan::found(&resolve(Path::new(board)));
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
        let p = scan::found(&resolve(Path::new(board)));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_drawn_on_a_pdf_is_kept_in_the_folder_under_what_the_pdf_holds() {
        let d = resolve(&std::env::temp_dir()).join(format!("mdview-pdfink-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("Sub")).unwrap();
        let (pdf, bytes) = (d.join("Sub/paper.pdf"), b"%PDF-1.4 a paper".to_vec());
        fs::write(&pdf, &bytes).unwrap();
        assert_eq!(ink_read(&pdf, &d), Ok(None));
        // nothing drawn: nothing kept, and no folder made for it
        ink_save(&pdf, &d, "", true).unwrap();
        assert!(!d.join(".mdview").exists());
        let board = format!("<svg>{BOARD_MARK}<![CDATA[\n{{\"board\":1}}\n]]></metadata></svg>");
        assert!(ink_save(&pdf, &d, "<svg/>", false).is_err());
        ink_save(&pdf, &d, &board, false).unwrap();
        // named as Git names the PDF's bytes (`git hash-object`): the web app finds the same file
        let file = d.join(".mdview/pdf").join(format!("{}.board.svg", git2::Oid::hash_object(git2::ObjectType::Blob, &bytes).unwrap()));
        assert_eq!(fs::read_to_string(&file).unwrap(), board);
        assert_eq!(ink_read(&pdf, &d), Ok(Some(board.clone())));
        assert_eq!(fs::read(&pdf).unwrap(), bytes); // the PDF is as it was
        // moved and renamed: still its own
        let moved = d.join("renamed.pdf");
        fs::rename(&pdf, &moved).unwrap();
        assert_eq!(ink_read(&moved, &d), Ok(Some(board)));
        // another PDF has nothing on it — even of the same length, written in the same tick of the clock (CI, 2026-10-27: the
        // name worked out for the first was given to it)
        fs::write(&pdf, b"%PDF-1.4 another").unwrap();
        fs::File::options().write(true).open(&pdf).unwrap().set_modified(fs::metadata(&moved).unwrap().modified().unwrap()).unwrap();
        assert_eq!(ink_read(&pdf, &d), Ok(None));
        // all of it rubbed out: the file goes, and the folders made for it
        ink_save(&moved, &d, "", true).unwrap();
        assert!(!file.exists() && !d.join(".mdview").exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn what_is_put_into_a_note_of_any_subfolder_goes_to_the_base_folders_assets() {
        let d = resolve(&std::env::temp_dir()).join(format!("mdview-files-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        for dir in ["plain/Sub/Deep", "project/.git", "project/.mdview", "project/Sub"] {
            fs::create_dir_all(d.join(dir)).unwrap();
        }
        fs::write(d.join("project/.mdview/project.json"), "{}").unwrap();
        let (plain, project) = (d.join("plain"), d.join("project"));
        // the window's folder is the base of every note in it; a project's root is, whatever the window shows
        assert_eq!(base_folder(&plain.join("Sub/Deep/n.md"), Some(&plain)), plain);
        assert_eq!(base_folder(&project.join("Sub/n.md"), Some(&project.join("Sub"))), project);
        assert_eq!(base_folder(&project.join("Sub/n.md"), None), project);
        // (a note opened by itself, or one outside the window's folder: the folder it lies in)
        assert_eq!(base_folder(&plain.join("Sub/n.md"), None), plain.join("Sub"));
        assert_eq!(base_folder(&plain.join("Sub/n.md"), Some(&project)), plain.join("Sub"));
        // one assets for all of them — not one in each subfolder
        let (top, deep) = (plain.join("n.md"), plain.join("Sub/Deep/n.md"));
        assert_eq!(kept_in(&top, &plain, "assets"), plain.join("assets"));
        assert_eq!(kept_in(&deep, &plain, "assets"), plain.join("assets"));
        assert_eq!(kept_in(&deep, &plain, "beside"), plain.join("Sub/Deep"));
        assert_eq!(kept_in(&deep, &plain, "media"), plain.join("Sub/Deep/media"));
        assert_eq!(kept_in(&deep, &plain, "../../.."), plain.join("Sub/Deep"));
        // … named the same in every note, wherever it lies; any other file by the way to it
        let pic = plain.join("assets/x y.png");
        assert_eq!(way(&pic, &top, &plain), "assets/x y.png");
        assert_eq!(way(&pic, &deep, &plain), "assets/x y.png");
        assert_eq!(way(&plain.join("Sub/Deep/x.png"), &deep, &plain), "x.png");
        assert_eq!(way(&plain.join("Sub/other.pdf"), &deep, &plain), "../other.pdf");
        // and what a note of a subfolder names so is found there (scan::found; the folder is a window's)
        scan::shown(&plain);
        fs::create_dir_all(plain.join("assets")).unwrap();
        fs::write(&pic, b"png").unwrap();
        assert_eq!(scan::found(&dir_of(&deep).join(way(&pic, &deep, &plain))), pic);
        let _ = fs::remove_dir_all(d);
    }
}
