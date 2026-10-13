//! A folder as a project: what the page asks about its history, its other side on GitHub, the
//! signing in there, and a note shared under a link (history.rs, sync.rs, github.rs, share.rs).

use super::*;

impl Win {
    /// The messages that begin with history-, sync-, github-, share- and paste- (messages.rs hands them over).
    pub(super) fn on_project_message(&mut self, app: &mut App, msg: &Value) {
        let text_of = |key: &str| msg[key].as_str().unwrap_or("");
        match text_of("type") {
            // the history's window (active/history.js): a note's versions, one of them as text, one of
            // them put back as the note
            "history-log" => {
                let Some(path) = msg["path"].as_str().map(PathBuf::from).or_else(|| self.path.clone()) else { return };
                let standing = history::standing(&dir_of(&path));
                let versions = history::log(&path).unwrap_or_default();
                self.js("MdView.history", &[json!({ "path": s(&path), "versions": versions, "state": standing["state"], "own": standing["own"] })]);
            }
            "history-text" => {
                let path = PathBuf::from(text_of("path"));
                let text = history::text(&path, text_of("id"), msg["at"].as_str()).ok().map(|b| String::from_utf8_lossy(&b).into_owned());
                self.js("MdView.historyText", &[json!({ "path": s(&path), "id": text_of("id"), "text": text })]);
            }
            "history-restore" => {
                let path = PathBuf::from(text_of("path"));
                // (only a note this window knows, written as any change from outside: the watcher shows it)
                let known = self.path.as_deref() == Some(path.as_path()) || self.note_paths.contains(text_of("path"));
                match history::text(&path, text_of("id"), msg["at"].as_str()).ok().filter(|_| known && is_md(&path)) {
                    Some(bytes) => match fs::write(&path, bytes) {
                        Ok(()) => {
                            app.touch(&path);
                            self.js("MdView.historyRestored", &[json!({ "path": s(&path), "id": text_of("id") })]);
                        }
                        Err(e) => self.toast(format!("Couldn't restore: {}", strerror(&e))),
                    },
                    None => self.toast("Couldn't restore this version"),
                }
            }
            // the conflicts' window (active/conflict.js): what stands in the way of joining the
            // project with its other side, and joining with what the user picked
            // Sync Now (the sidebar's button): what waits in the project is kept at once, and the
            // project brought in line with its other side — not after the quiet while, or the minute
            "sync-now" => {
                match self.here().map(|h| history::place_of(&h)) {
                    Some(Place::Project(root)) if sync::linked(&root).is_some() => app.keep_now(&root),
                    _ => self.toast("Nothing to sync with: this folder is not linked to a repository"),
                }
            }
            "sync-conflicts" | "sync-resolve" => {
                let Some(root) = self.here().and_then(|h| match history::place_of(&h) {
                    Place::Project(r) => Some(r),
                    _ => None,
                }) else { return };
                if text_of("type") == "sync-conflicts" {
                    match sync::conflicts(&root) {
                        Ok(all) => self.js("MdView.conflicts", &[all]),
                        Err(e) => self.toast(format!("Couldn't read the conflicts: {e}")),
                    }
                } else if let Some(picks) = msg["picks"].as_object() {
                    app.unsnapped.remove(&root); // (what waits is kept by the joining itself)
                    let (stamp, access) = (app.stamp(), app.access());
                    app.historian.resolve(&root, text_of("theirs").to_string(), picks.clone(), stamp, access);
                }
            }
            // signing in with GitHub (the settings): begun — the code comes with the settings' info —,
            // the browser opened with the code on the clipboard, given up, signed out
            "github-signin" => {
                if app.signing.is_none() {
                    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                    app.signing = Some((stop.clone(), None));
                    app.github_said.clear();
                    github::sign_in(app.tx.clone(), app.keyring_place(), stop);
                    self.settings_info(app);
                }
            }
            "github-open" => {
                if let Some((code, uri)) = app.signing.as_ref().and_then(|(_, shown)| shown.clone()) {
                    host::copy_text(&app.handle, code);
                    if PROBE.is_none() {
                        host::launch_uri(&uri); // (a test's click opens no browser)
                    }
                }
            }
            "github-cancel" => {
                if let Some((stop, _)) = app.signing.take() {
                    stop.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                self.settings_info(app);
            }
            // the repositories the app was given (read anew), where they are chosen on GitHub, and
            // one of them fetched into a folder of its own
            "github-repos" => {
                if let Some(session) = app.session.clone() {
                    github::repos(app.tx.clone(), session);
                }
            }
            "github-give" => host::launch_uri(github::GIVE),
            "github-get" => {
                if let (Some(url), Some(name)) = (msg["url"].as_str(), msg["name"].as_str().map(clean_name).filter(|n| !n.is_empty())) {
                    self.getting = Some((url.to_string(), name, msg["branch"].as_str().unwrap_or("main").to_string()));
                    self.pick(app, Pick::Parent);
                }
            }
            "github-signout" => {
                github::sign_out(&app.keyring_place());
                app.session = None;
                app.repos = None;
                app.renew_turn += 1;
                app.github_said.clear();
                app.each_win(|w, app| w.settings_info(app));
                self.settings_info(app);
            }
            "history-link" => {
                // the project is told where its other side is (url) or that it has none (no url);
                // linked, the two are reconciled at once
                let Some(root) = self.here().and_then(|h| match history::place_of(&h) {
                    Place::Project(r) => Some(r),
                    _ => None,
                }) else { return };
                app.synced.remove(&root);
                match msg["url"].as_str().filter(|u| !u.is_empty()) {
                    Some(url) => {
                        // (linked and reconciled on the history's thread; how it went comes back)
                        let (stamp, access) = (app.stamp(), app.access());
                        app.historian.link(&root, url.to_string(), stamp, access);
                    }
                    None => {
                        if let Err(e) = sync::unlink(&root) {
                            self.toast(format!("Couldn't unlink: {e}"));
                        }
                        self.tree_json = None;
                        self.send_folder(app);
                        self.settings_info(app);
                    }
                }
            }
            // the project's pasteboard (overview.js): asked for, or written — by the web app's server,
            // which keeps it (paste.rs); the answer comes as an event. Without a repository to name
            // it by, or anyone signed in, there is none, and the page says why.
            "paste-get" | "paste-put" => {
                let put = text_of("type") == "paste-put";
                let why = match (self.here().and_then(|h| paste::place(&h)), app.session.as_ref().map(|s| s.access.clone())) {
                    (None, _) => "off",
                    (_, None) => "signin",
                    (Some((root, at)), Some(token)) => {
                        let (tx, label, n) = (app.tx.clone(), self.label.clone(), msg["n"].clone());
                        if put {
                            let by = app.stamp().device;
                            paste::put(tx, label, n, root, at, token, text_of("text").to_string(), msg["base"].as_u64().unwrap_or(0), by);
                        } else {
                            paste::get(tx, label, n, root, at, token, msg["rev"].as_u64().unwrap_or(0), msg["wait"] == true);
                        }
                        return;
                    }
                };
                self.js("MdView.pasteboard", &[json!({ "n": msg["n"], "put": put, "error": why })]);
            }
            // sharing a note (active/share.js): how it stands, shared or its password set, shared no
            // more — written into the project (share.rs), kept and sent on at once
            "share-info" => {
                let path = PathBuf::from(text_of("path"));
                self.js("MdView.share", &[share::info(&path)]);
                self.share_asked = Some(path);
            }
            "share-set" | "share-stop" => {
                let path = PathBuf::from(text_of("path"));
                let known = self.path.as_deref() == Some(path.as_path()) || self.note_paths.contains(text_of("path"));
                let done = if !known || !is_md(&path) || share::info(&path)["can"] != true {
                    Ok(None)
                } else if text_of("type") == "share-stop" {
                    share::stop(&path)
                } else {
                    // (password: a text sets it, null takes it away, none said leaves it)
                    let password = msg.get("password").map(|p| p.as_str().filter(|p| !p.is_empty()));
                    // (a note shared for the first time: the web app says a short id that is free)
                    let id = if share::is_shared(&path) { None } else { share::free_id() };
                    share::set(&path, password, id).map(Some)
                };
                match done {
                    Ok(Some(root)) => {
                        app.share_dirty.insert(root.clone());
                        app.keep_now(&root);
                    }
                    Ok(None) => {}
                    Err(e) => self.toast(format!("Couldn't share: {e}")),
                }
                self.js("MdView.share", &[share::info(&path)]);
                self.share_asked = Some(path);
                self.send_folder(app); // (the sidebar marks what is shared)
            }
            "history-now" => {
                // Ctrl+S: what waits in the project is kept now, and a linked one reconciled — not
                // after the quiet while
                if let Some(Place::Project(root)) = self.here().map(|h| history::place_of(&h)) {
                    app.unsnapped.remove(&root);
                    let (stamp, access) = (app.stamp(), app.access());
                    app.historian.snapshot(&root, stamp, access);
                }
            }
            "history-disable" => {
                // the folder's history is switched off: its versions stay, nothing more is kept
                let Some(root) = self.here().filter(|h| history::place_of(h) == Place::Project(h.clone())) else { return };
                app.unsnapped.remove(&root);
                app.historian.wait(); // (a snapshot under way is finished first)
                let stamp = app.stamp();
                match history::disable(&root, &stamp) {
                    Ok(()) => {
                        self.tree_json = None;
                        self.send_folder(app);
                        self.settings_info(app);
                        self.toast("History is off. Its versions are kept");
                    }
                    Err(e) => self.toast(format!("Couldn't switch the history off: {e}")),
                }
            }
            "history-enable" => {
                // the folder (or the one named) becomes a project; its first snapshot follows
                let Some(root) = msg["root"].as_str().map(PathBuf::from).or_else(|| self.here()) else { return };
                // (a repository that is there already is someone's: taken over only when they say so)
                if history::place_of(&root) == Place::Foreign(root.clone()) && !truthy(&msg["sure"]) && !history::was_project(&root) {
                    return self.ask_adopt(app, &root);
                }
                // (projects of their own below it: a part of this one from now on, or left as they are?)
                let below = history::nested(&root);
                if !below.is_empty() && msg["nested"].is_null() {
                    return self.ask_nested(app, &root, &below);
                }
                match history::enable(&root) {
                    Ok(()) => {
                        if msg["nested"] == "merge" {
                            let stamp = app.stamp();
                            app.historian.merge(&root, below, stamp);
                        }
                        app.touch(&root);
                        self.send_folder(app);
                        self.settings_info(app);
                    }
                    Err(e) => self.toast(format!("No history here: {e}")),
                }
            }
            _ => {}
        }
    }

    /// Before a repository that exists becomes a project: what follows from it, to be agreed to.
    pub(super) fn ask_adopt(&self, app: &App, root: &Path) {
        let Some(window) = &self.window else { return };
        let onto = history::branch(root).map(|b| format!(" on the branch “{b}”")).unwrap_or_default();
        let text = format!("“{}” is a Git repository already. As a project, Markdown Notes keeps every change in it as a commit of its own{onto}, a little while after it was made.", name_of(root));
        let (tx, label, root) = (app.tx.clone(), self.label.clone(), s(root));
        app.handle
            .dialog()
            .message(text)
            .title("Use This Repository for History?")
            .buttons(MessageDialogButtons::OkCancelCustom("Use Repository".into(), "Cancel".into()))
            .parent(window)
            .show(move |sure| {
                if sure {
                    let _ = tx.send(Event::Msg { label, json: json!({ "type": "history-enable", "root": root, "sure": true }).to_string() });
                }
            });
    }

    /// Before a folder with projects in it becomes one: are they taken in, or left separate?
    pub(super) fn ask_nested(&self, app: &App, root: &Path, below: &[PathBuf]) {
        let Some(window) = &self.window else { return };
        let names: Vec<String> = below.iter().map(|b| format!("“{}”", relative(b, root))).collect();
        let (they, their) = if names.len() == 1 { ("is a project of its own", "its") } else { ("are projects of their own", "their") };
        let text = format!("{} in this folder {they}. Taken in, {their} history becomes a part of this project's, and there is one project from now on. Left separate, each keeps a history of its own.", names.join(", "));
        let (take, leave) = ("Take In", "Leave Separate");
        let (tx, label, root, sure) = (app.tx.clone(), self.label.clone(), s(root), true);
        app.handle
            .dialog()
            .message(text)
            .title("Projects in This Folder")
            .buttons(MessageDialogButtons::YesNoCancelCustom(take.into(), leave.into(), "Cancel".into()))
            .parent(window)
            .show_with_result(move |answer| {
                let nested = match answer {
                    MessageDialogResult::Yes => "merge",
                    MessageDialogResult::No => "separate",
                    MessageDialogResult::Custom(l) if l == take => "merge",
                    MessageDialogResult::Custom(l) if l == leave => "separate",
                    _ => return,
                };
                let _ = tx.send(Event::Msg { label, json: json!({ "type": "history-enable", "root": root, "sure": sure, "nested": nested }).to_string() });
            });
    }
}
