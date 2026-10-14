//! What the page says — one message, handed to what does it. (The page: viewer/*.js, viewer.js,
//! active/*.js; the web app's list of the same messages: web/host/contract.ts.)

use super::*;

impl Win {
    pub(super) fn on_message(&mut self, app: &mut App, msg: &Value) {
        let text_of = |key: &str| msg[key].as_str().unwrap_or("");
        // (what writes into the folder: its project's snapshot follows — the watcher sees only
        // the directories a window shows)
        if matches!(text_of("type"), "save" | "toggle" | "pasteimage" | "dropfiles" | "graphic-save" | "board-new" | "board-save" | "pdfink-save" | "note-save" | "board-paste" | "board-drop" | "newnote" | "quicknote" | "newfolder" | "rename" | "move" | "trash" | "untrash" | "pastefiles" | "duplicate" | "import" | "newboard" | "hide") {
            if let Some(p) = self.path.clone().or_else(|| self.folder.clone()) {
                app.touch(&p);
            }
        }
        match text_of("type") {
            // (a project's history, its other side, sharing: project.rs — what Claude is asked: claude.rs)
            t if t.starts_with("history-") || t.starts_with("sync-") || t.starts_with("github-") || t.starts_with("share-") || t.starts_with("paste-") => self.on_project_message(app, msg),
            "graphic" | "graphic-cancel" | "ai-ask" | "ai-pick" | "ai-stop" | "graphic-image" | "graphic-save" | "complete" => self.on_claude_message(app, msg),
            // (tab: true — a tab of its own, always; "own" — the tab the file has already, else a new one)
            "link" => self.handle_link(app, text_of("href"), truthy(&msg["tab"]), msg["tab"] == "own"),
            "wikilink" => self.open_wikilink(app, text_of("target"), truthy(&msg["tab"]), msg["tab"] == "own"),
            "tab" => self.tab_op(app, msg),
            "toggle" => self.toggle_task(app, msg["line"].as_i64().unwrap_or(-1), truthy(&msg["checked"])),
            "editcmd" => {
                // the page's text menu: the command runs where the focus is, as the key would
                if let (Some(window), cmd @ ("Cut" | "Copy" | "Paste" | "SelectAll")) = (&self.window, text_of("cmd")) {
                    host::edit_command(window, cmd);
                }
            }
            "copyimage" => self.copy_image(app, text_of("src")),
            "copy" => host::copy_text(&app.handle, text_of("text").to_string()),
            "mode" => {
                self.editing = truthy(&msg["edit"]);
                if let name @ ("read" | "edit" | "active" | "split") = text_of("name") {
                    if app.state.get("mode").and_then(Value::as_str) != Some(name) {
                        app.state.insert("mode".into(), json!(name)); // the next window starts in it
                        app.save_state();
                    }
                }
            }
            "prefs" => {
                let new = msg["prefs"].as_object().cloned().unwrap_or_default();
                let prefs = Value::Object(app.store_prefs(&new));
                let lists = new.keys().any(|k| k.starts_with("sidebar") || k == "showHidden"); // (what the sidebar or All Notes lists may have changed)
                let told = |w: &mut Win, app: &mut App| {
                    w.js("MdView.setPrefs", &[prefs.clone()]);
                    if lists && w.folder.is_some() {
                        w.rescan(app);
                    }
                };
                told(self, app);
                app.each_win(told);
            }
            "dropfiles" => self.drop_files(app, &msg["uris"], msg["path"].as_str()),
            "pickfiles" => self.pick_attach(app, msg["kind"] == "image", text_of("path")),
            "closehold" => {
                // the page has a question to ask before the window may go
                self.close_turn += 1;
                self.closing = false;
            }
            "save" => {
                // a late autosave must not land in whatever note is open by now
                if msg["path"].is_null() || msg["path"].as_str() == self.path.as_deref().map(s).as_deref() {
                    if truthy(&msg["seq"]) {
                        self.save_seq = msg["seq"].clone();
                    }
                    self.save_text(msg["text"].as_str(), truthy(&msg["exact"]));
                    if truthy(&msg["exact"]) {
                        self.tidy_attachments(msg["text"].as_str()); // (the active mode: what it no longer shows goes)
                    }
                }
            }
            "pasteimage" => self.paste_image(app, msg["path"].as_str(), truthy(&msg["append"])),
            "pasteclip" => {
                let html = host::clipboard_html(&app.handle);
                let text = host::clipboard_text(&app.handle).unwrap_or_default();
                self.js("MdView.pasteClip", &[json!({ "text": text, "html": html })]);
            }
            "pastetext" => {
                if let Some(text) = host::clipboard_text(&app.handle) {
                    self.js("MdView.pasteText", &[json!({ "text": text })]);
                }
            }
            "external" => {
                if let Some(path) = &self.path {
                    host::open_in_editor(path);
                }
            }
            "note" => self.open_note(app, text_of("path"), truthy(&msg["tab"])),
            "resolve" => {
                // a link written after the note was read: where it points
                let target = text_of("target");
                let found = if target.is_empty() { None } else { self.resolver.as_mut().and_then(|r| r.resolve(target)) };
                let info = found.map_or(Value::Null, |p| match embedded_text(&p).filter(|_| file_kind(&p) == "file") {
                    Some(text) => json!({ "path": s(&p), "url": file_url(&p), "kind": "text", "text": text }),
                    None => json!({ "path": s(&p), "url": file_url(&p), "kind": file_kind(&p) }),
                });
                self.js("MdView.linkResolved", &[json!(target), info]);
            }
            "painted" => {
                // (the page's content is drawn: the web view, not shown until now, is)
                if let Some(window) = &self.window {
                    host::show_view(window);
                }
            }
            "fileop" => self.file_op(text_of("op"), text_of("path")),
            // whiteboards (board.js): a new one beside the note, a board's text for the page, and back
            "board-new" => self.board_new(app, text_of("path"), text_of("text"), &msg["id"]),
            "board-read" => self.board_read(text_of("path"), &msg["id"]),
            "board-save" => self.board_save(text_of("path"), text_of("text"), &msg["id"]),
            // a note's text and what its links lead to, for the sheet beside the note (viewer/split.js): read, and nothing else
            "note-read" => self.note_read(text_of("path"), &msg["id"]),
            "note-save" => self.note_save(text_of("path"), msg["text"].as_str(), &msg["id"]),
            // what was drawn on a PDF (board/pdf.js): a whiteboard's file in the folder's .mdview, never the PDF
            "pdfink-read" => self.pdfink_read(text_of("path"), &msg["id"]),
            "pdfink-save" => self.pdfink_save(text_of("path"), text_of("text"), msg["empty"].as_bool().unwrap_or(false), &msg["id"]),
            "board-open" => self.board_open = msg["on"].as_bool().unwrap_or(false),
            "board-paste" => self.board_paste(app, text_of("path"), &msg["id"]),
            "board-drop" => self.board_drop(text_of("path"), &msg["uris"], &msg["id"]),
            "board-pick" => self.board_pick(app, text_of("path"), &msg["id"]),
            "board-watch" => {
                // the whiteboards the note shows: their folders are looked at (no more than a few, and only where a board is)
                self.board_dirs = msg["paths"].as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(Value::as_str).map(|p| scan::found(&resolve(Path::new(p)))).filter(|p| is_board(p) && p.is_file()).map(|p| dir_of(&p)).take(8).collect();
                self.watch();
            }
            "pdfdata" => {
                let id = match &msg["id"] {
                    Value::String(t) => t.clone(),
                    other => other.to_string(),
                };
                self.send_pdf(text_of("path"), &id);
            }
            "pdfnote" => {
                // from a highlight in a PDF to the note it comes from, at the line of its link
                let p = PathBuf::from(text_of("path"));
                if p.is_file() && is_md(&p) {
                    let line = msg["line"].as_f64().unwrap_or(0.0) as i64;
                    self.open_path(app, &p, Some(format!("^line={line}")), true);
                }
            }
            "newnote" => self.new_note(app, text_of("name"), msg["dir"].as_str()),
            "quicknote" => self.new_quick(app),
            "newfolder" => self.new_folder(app, text_of("name"), msg["dir"].as_str()),
            "rename" => self.rename_note(app, text_of("path"), text_of("name")),
            "move" => self.move_to(app, text_of("path"), text_of("dir")),
            // a colour and a sign for a folder of the window's folder (kept in the folder: looks.rs)
            "folderlook" => {
                let dir = PathBuf::from(text_of("path"));
                if let Some(folder) = self.folder.clone().filter(|f| dir.is_dir() && dir.starts_with(f) && dir != *f) {
                    match crate::looks::set(&folder, &dir, text_of("color"), text_of("icon"), msg["fav"].as_bool().unwrap_or(false)) {
                        Ok(()) => self.send_folder(app),
                        Err(e) => self.toast(format!("Couldn't keep the folder's look: {e}")),
                    }
                }
            }
            "trash" => match msg["paths"].as_array() {
                // (several at once: what is selected in All Notes)
                Some(many) => self.trash_paths(app, &many.iter().filter_map(|p| p.as_str().map(String::from)).collect::<Vec<_>>()),
                None => self.trash_note(app, text_of("path")),
            },
            "untrash" => self.untrash(app),
            // a folder's list as a place to work with files: put out of sight, copied, put in, brought in from elsewhere
            "hide" => self.hide(app, &msg["paths"], msg["on"].as_bool().unwrap_or(true)),
            "copyfiles" => self.copy_files(app, &msg["paths"], truthy(&msg["cut"])),
            "pastefiles" => self.paste_files(app, msg["dir"].as_str()),
            "duplicate" => self.duplicate(app, &msg["paths"]),
            "import" => self.import(app, &msg["uris"], msg["dir"].as_str()),
            "addfiles" => self.add_files(app, msg["dir"].as_str()),
            // whiteboards that are files of their own, and all of the folder's for All Notes
            "newboard" => self.new_board(app, text_of("name"), msg["dir"].as_str(), text_of("text")),
            "boards" => self.send_boards(),
            "board-free" => self.board_free(app, text_of("path")),
            "sidebar" => self.sidebar_pref(app, msg),
            "previews" => self.send_previews(&msg["paths"]),
            // a folder chosen in the system's window — or, here: the folder the note on screen lies in, opened beside it
            "folder" => match self.path.clone().filter(|_| truthy(&msg["here"]) && self.folder.is_none()) {
                Some(note) => self.set_folder(app, &dir_of(&note)),
                None => self.pick(app, Pick::Folder),
            },
            "open" => self.choose_file(app),
            "reload" => {
                self.new_resolver();
                self.render(app, true, None, false);
            }
            "zoom" if PROBE.is_some() => {
                // (tests only: the page larger, to see it in a narrow window — the app itself has one size)
                self.zoom = match msg["step"].as_f64().filter(|s| *s != 0.0) {
                    Some(step) => (self.zoom + 0.1 * step).min(2.5),
                    None => 1.0,
                };
                if let Some(window) = &self.window {
                    let _ = window.set_zoom(self.zoom);
                }
            }
            "settings-info" => self.settings_info(app),
            "aikey" => {
                if let Err(e) = ai::store_ai_key(text_of("key")) {
                    self.toast(format!("Couldn't save the key: {}", strerror(&e)));
                }
                self.settings_info(app);
            }
            "help" => {
                let guide = SHARED.assets.join("docs").join("FEATURES.md");
                if guide.is_file() && self.path.as_ref() != Some(&guide) {
                    app.open_file(&guide);
                }
            }
            "print" => {
                if let Some(window) = &self.window {
                    let _ = window.print();
                }
            }
            "close" => self.close(app),
            "back" => self.go(app, true),
            "forward" => self.go(app, false),
            "log" if *DEBUG => eprintln!("[js] {}", text_of("text")),
            "probe" => {
                if let Some(out) = PROBE_OUT.as_ref() {
                    let of = self.path.as_deref().map(name_of).unwrap_or_else(|| "none".into());
                    let name = msg["name"].as_str().unwrap_or("probe");
                    let text = match &msg["text"] {
                        Value::String(t) => t.clone(),
                        other => other.to_string(),
                    };
                    let _ = fs::write(Path::new(out).join(format!("{of}.{name}.json")), text);
                }
            }
            "snapshot" => {
                let rect = ["x", "y", "w", "h"].map(|k| msg[k].as_f64());
                if let (Some(window), [Some(x), Some(y), Some(w), Some(h)]) = (&self.window, rect) {
                    let said = msg["said"].as_str().filter(|t| !t.is_empty()).unwrap_or("Copied").to_string();
                    host::snapshot(window, [x, y, w, h], said, PROBE_OUT.as_ref().map(PathBuf::from));
                }
            }
            "probe-pointer" if PROBE.is_some() => {
                if let Some(window) = &self.window {
                    host::pointer(window, msg);
                }
            }
            _ => {}
        }
    }
}
