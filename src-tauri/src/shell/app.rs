//! The application: what all windows share — the settings and what is kept between runs, the
//! queue of events and the timers, the folders watched, the windows themselves.

use super::*;

impl App {
    /// The event, later. One thread keeps all that is waited for — not a thread each: a folder in
    /// which thousands of files change at once asks for as many, and a thread that cannot be had
    /// would take the one everything runs on with it.
    pub(super) fn after(&self, ms: u64, event: Event) {
        use std::sync::mpsc::RecvTimeoutError;
        use std::time::Instant;
        static TIMER: std::sync::OnceLock<std::sync::Mutex<Sender<(Instant, Event)>>> = std::sync::OnceLock::new();
        let timer = TIMER.get_or_init(|| {
            let (to, due) = std::sync::mpsc::channel::<(Instant, Event)>();
            let tx = self.tx.clone();
            let _ = std::thread::Builder::new().name("timer".into()).spawn(move || {
                let mut waiting: Vec<(Instant, Event)> = vec![];
                loop {
                    let now = Instant::now();
                    let (mut ripe, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut waiting).into_iter().partition(|w| w.0 <= now);
                    waiting = rest;
                    ripe.sort_by_key(|w| w.0); // (in the order they were asked for)
                    for (_, event) in ripe {
                        let _ = tx.send(event);
                    }
                    let got = match waiting.iter().map(|w| w.0).min() {
                        Some(at) => due.recv_timeout(at.saturating_duration_since(Instant::now())),
                        None => due.recv().map_err(|_| RecvTimeoutError::Disconnected),
                    };
                    match got {
                        Ok(w) => waiting.push(w),
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => return,
                    }
                }
            });
            std::sync::Mutex::new(to)
        });
        if let Ok(to) = timer.lock() {
            let _ = to.send((Instant::now() + Duration::from_millis(ms), event));
        }
    }

    pub(super) fn save_state(&self) {
        let file = state_file();
        let _ = fs::create_dir_all(dir_of(&file));
        let _ = write_whole(&file, Value::Object(self.state.clone()).to_string().as_bytes());
    }

    // -- history ----------------------------------------------------------

    /// Who this program's commits are made by: the device (state.json "device": an id made
    /// once, and a name that is the computer's until another is set).
    pub(super) fn stamp(&mut self) -> Stamp {
        let known = |d: &Value, k: &str| d.get(k).and_then(Value::as_str).filter(|v| !v.is_empty()).map(String::from);
        let device = self.state.get("device").cloned().unwrap_or(Value::Null);
        let (id, name) = match (known(&device, "id"), known(&device, "name")) {
            (Some(id), Some(name)) => (id, name),
            (id, name) => {
                let (id, name) = (id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()), name.unwrap_or_else(host_name));
                self.state.insert("device".into(), json!({ "id": id, "name": name }));
                self.save_state();
                (id, name)
            }
        };
        let name = self.prefs()["deviceName"].as_str().map(str::trim).filter(|n| !n.is_empty()).map(String::from).unwrap_or(name);
        Stamp { device: format!("{name} ({id})"), client: format!("desktop {}", env!("CARGO_PKG_VERSION")), author: self.session.as_ref().map(Session::author) }
    }

    /// Something at this path changed, or may have: its project, if it is in one, gets a
    /// snapshot once it has been quiet for a while.
    pub(super) fn touch(&mut self, path: &Path) {
        if path.components().any(|c| c.as_os_str() == ".git") {
            return; // (the history's own writing)
        }
        if paste::is_copy(path) {
            return; // (the pasteboard's copy: in no version)
        }
        let Place::Project(root) = history::place_of(path) else { return };
        self.snap_turn += 1;
        self.unsnapped.insert(root.clone(), self.snap_turn);
        let quiet = env("MDVIEW_HISTORY_QUIET_MS").and_then(|ms| ms.parse().ok()).unwrap_or_else(|| self.prefs()["historyQuiet"].as_u64().unwrap_or(30).max(1) * 1000);
        self.after(quiet, Event::Snapshot { root, turn: self.snap_turn });
    }

    pub(super) fn access(&self) -> Access {
        Access { token: self.session.as_ref().map(|s| s.access.clone()) }
    }

    /// What waits in a project is kept now, and a linked one reconciled — not after the quiet while.
    pub(super) fn keep_now(&mut self, root: &Path) {
        self.unsnapped.remove(root);
        let (stamp, access) = (self.stamp(), self.access());
        self.historian.snapshot(root, stamp, access);
    }

    /// The name the sign-in is kept under in the keyring: the folder this instance's state is in.
    pub(super) fn keyring_place(&self) -> String {
        s(&dir_of(&state_file()))
    }

    /// For the page's settings: who is signed in, a code waiting to be confirmed, why it did not go.
    pub(super) fn github_shown(&self) -> Value {
        json!({
            "user": self.session.as_ref().map(github::shown),
            "code": self.signing.as_ref().and_then(|(_, code)| code.as_ref()).map(|(code, uri)| json!({ "code": code, "uri": uri })),
            "busy": self.signing.is_some(),
            "repos": self.repos,
            "said": self.github_said,
            "made": self.made,
        })
    }

    pub(super) fn on_github(&mut self, news: News) {
        match news {
            News::Code { code, uri } => {
                if let Some((_, shown)) = self.signing.as_mut() {
                    *shown = Some((code, uri));
                }
            }
            News::In(session, note) => {
                // (renewed a while before it ends; a linked project's other side is looked at now)
                let left = session.expires.saturating_sub(now()).saturating_sub(600).max(60);
                self.renew_turn += 1;
                self.after(left * 1000, Event::GitHubRenew { turn: self.renew_turn });
                self.session = Some(session);
                self.signing = None;
                self.github_said = note.unwrap_or_default();
                self.sync_shown();
            }
            News::Out(why) => {
                if self.signing.take().is_none() {
                    self.session = None; // (a sign-in kept from before that GitHub takes no more)
                    self.repos = None;
                }
                self.github_said = why;
            }
            News::Repos(Ok(list)) => self.repos = Some(list),
            News::Repos(Err(e)) => {
                self.repos = Some(vec![]);
                self.github_said = e;
            }
            // a repository made for a project: linked as Link… links it (an empty one takes the
            // project as it is); not made, or not reached, and the project stays as it was
            News::Made(Ok(repo)) => {
                if let (Some((root, n)), Some(url)) = (self.making.take(), repo["url"].as_str()) {
                    self.synced.remove(&root);
                    let (stamp, access) = (self.stamp(), self.access());
                    self.historian.link(&root, url.to_string(), stamp, access);
                    self.made = json!({ "n": n, "done": true, "name": repo["name"] });
                }
            }
            News::Made(Err(mut no)) => {
                no["n"] = self.making.take().map_or(Value::Null, |(_, n)| n);
                self.made = no;
            }
            News::Later => {
                self.renew_turn += 1;
                self.after(60_000, Event::GitHubRenew { turn: self.renew_turn });
            }
        }
        self.each_win(|w, app| w.settings_info(app));
    }

    pub(super) fn sync_ms(&self) -> u64 {
        env("MDVIEW_SYNC_MS").and_then(|ms| ms.parse().ok()).unwrap_or(SYNC_MS) // (the override: for tests)
    }

    /// The projects the windows show.
    pub(super) fn shown_projects(&self) -> HashSet<PathBuf> {
        self.wins.values().filter_map(|w| w.path.as_deref().or(w.folder.as_deref())).filter_map(|p| match history::place_of(p) {
            Place::Project(root) => Some(root),
            _ => None,
        }).collect()
    }

    /// The linked projects on screen are reconciled with their other side — not one that has
    /// changes waiting to be kept: its snapshot comes, and reconciles (and nothing is fetched
    /// into a folder that is being written in).
    pub(super) fn sync_shown(&mut self) {
        for root in self.shown_projects() {
            if !self.unsnapped.contains_key(&root) && sync::linked(&root).is_some() {
                let (stamp, access) = (self.stamp(), self.access());
                self.historian.sync(&root, stamp, access);
            }
        }
    }

    /// Where a folder stands with a history, for the page: history::standing, and for a linked
    /// project where its other side is and how the two stood when last reconciled.
    pub(super) fn standing(&self, folder: &Path) -> Value {
        let mut all = history::standing(folder);
        if let Some(root) = all["root"].as_str().map(PathBuf::from).filter(|_| all["state"] == "project" || all["state"] == "inside") {
            if let Some(url) = sync::linked(&root) {
                all["linked"] = json!(url);
                all["sync"] = self.synced.get(&root).cloned().unwrap_or(Value::Null);
            }
        }
        all
    }

    /// The snapshots still waiting are made now — all of them, or (keep) only those of projects
    /// no window shows any more.
    pub(super) fn snapshot_waiting(&mut self, keep: bool) {
        let shown = if keep { self.shown_projects() } else { HashSet::new() };
        let due: Vec<PathBuf> = self.unsnapped.keys().filter(|root| !shown.contains(*root)).cloned().collect();
        for root in due {
            self.unsnapped.remove(&root);
            let (stamp, access) = (self.stamp(), self.access());
            self.historian.snapshot(&root, stamp, access);
        }
    }

    pub(super) fn sub(&mut self, key: &str) -> &mut Map<String, Value> {
        let slot = self.state.entry(key.to_string()).or_insert_with(|| json!({}));
        if !slot.is_object() {
            *slot = json!({});
        }
        slot.as_object_mut().unwrap()
    }

    pub(super) fn prefs(&self) -> Map<String, Value> {
        let mut prefs = default_prefs();
        if let Some(stored) = self.state.get("active").and_then(Value::as_object) {
            for (k, v) in stored {
                if prefs.contains_key(k) {
                    prefs.insert(k.clone(), v.clone());
                }
            }
        }
        prefs
    }

    /// What the page changed of the settings, kept; all of them as they now are.
    pub(super) fn store_prefs(&mut self, new: &Map<String, Value>) -> Map<String, Value> {
        let defaults = default_prefs();
        let mut prefs = self.prefs();
        for (k, v) in new {
            if defaults.get(k).is_some_and(|d| std::mem::discriminant(d) == std::mem::discriminant(v)) {
                prefs.insert(k.clone(), v.clone());
            }
        }
        let changed: Map<String, Value> = prefs.iter().filter(|(k, v)| defaults.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone())).collect();
        self.state.insert("active".into(), Value::Object(changed));
        self.save_state();
        prefs
    }

    pub(super) fn blank_page(&self) {
        let bg = self.theme.color("background");
        *SHARED.blank.lock().unwrap() = format!("<!doctype html><html><head><meta charset='utf-8'><style>html{{background:{bg}}}</style></head><body></body></html>");
    }

    pub(super) fn watch_theme(&mut self) {
        let tx = self.tx.clone();
        let Ok(mut watcher) = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(ev) = res else { return };
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            let _ = tx.send(Event::ThemeChanged);
        }) else {
            return;
        };
        let dir = theme::theme_dir();
        for d in [dir.clone(), dir.join("theme")] {
            let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
        }
        // Velum's colours change with the desktop's variant and light/dark
        if let Some(d) = theme::velum_dir() {
            let _ = watcher.watch(&d, RecursiveMode::NonRecursive);
        }
        self.watcher = Some(watcher);
    }

    pub(super) fn apply_theme(&mut self) {
        self.theme = theme::load_theme();
        self.blank_page();
        // (the theme's folder may be another one now: a link put elsewhere)
        if let Some(w) = self.watcher.as_mut() {
            let _ = w.watch(&theme::theme_dir().join("theme"), RecursiveMode::NonRecursive);
        }
        let (r, g, b) = self.theme.background();
        let css = theme::theme_css(&self.theme);
        for w in self.wins.values() {
            if let Some(window) = &w.window {
                let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
            }
            w.js("MdView.setTheme", &[json!(css), json!(self.theme.mode)]);
        }
    }

    pub(super) fn with_win(&mut self, label: &str, f: impl FnOnce(&mut Win, &mut App)) {
        let Some(mut w) = self.wins.remove(label) else { return };
        f(&mut w, self);
        if w.gone {
            SHARED.pages.lock().unwrap().remove(label);
            self.snapshot_waiting(true); // (a project no window shows any more is kept as it was left)
            self.rest();
        } else {
            self.wins.insert(label.to_string(), w);
        }
    }

    pub(super) fn each_win(&mut self, mut f: impl FnMut(&mut Win, &mut App)) {
        let labels: Vec<String> = self.wins.keys().cloned().collect();
        for label in labels {
            self.with_win(&label, &mut f);
        }
    }

    /// No window left: the process stays for a while, so that the next one opens at once.
    pub(super) fn rest(&mut self) {
        if self.restarting && self.wins.is_empty() {
            // (Restart to Update: the new version starts — once the window being handled is back in the list or gone too)
            let _ = self.tx.send(Event::UpdateDo("restarted"));
            return;
        }
        if self.wins.is_empty() {
            self.idle_turn += 1;
            // (the override: for tests)
            let resident = env("MDVIEW_RESIDENT_MS").and_then(|ms| ms.parse().ok()).unwrap_or(RESIDENT_MS);
            self.after(resident, Event::Idle { turn: self.idle_turn });
        }
    }

    pub(super) fn on_event(&mut self, event: Event) {
        match event {
            Event::Open { args, cwd } => self.open(args, &cwd),
            Event::Msg { label, json } => {
                if let Ok(msg) = serde_json::from_str::<Value>(&json) {
                    self.with_win(&label, |w, app| w.on_message(app, &msg));
                }
            }
            Event::Loaded { label, url } => self.with_win(&label, |w, app| w.on_loaded(app, &url)),
            Event::Link { label, href } => self.with_win(&label, |w, app| w.handle_link(app, &href, false, false)),
            Event::Fs { label, paths } => {
                for p in &paths {
                    self.touch(p);
                }
                self.with_win(&label, |w, app| w.on_fs(app, &paths))
            }
            Event::Reload { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.reload_turn {
                    w.reload_after_change(app);
                }
            }),
            Event::Rescan { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.rescan_turn {
                    w.rescan(app);
                }
            }),
            Event::CloseNow { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.close_turn {
                    w.close(app);
                }
            }),
            Event::SettleFresh { label, turn } => self.with_win(&label, |w, app| {
                if turn == w.fresh_turn && w.fresh.is_some() && w.fresh == w.path {
                    w.settle_fresh(app, false);
                }
            }),
            Event::CloseRequested { label } => self.with_win(&label, |w, app| w.close(app)),
            Event::Closed { label } => {
                if self.wins.remove(&label).is_some() {
                    SHARED.pages.lock().unwrap().remove(&label);
                    self.snapshot_waiting(true);
                    self.rest();
                }
            }
            Event::Crashed { label } => self.with_win(&label, |w, app| w.load_shell(app, true)),
            Event::Picked { label, what, path } => self.with_win(&label, |w, app| w.picked(app, what, path)),
            Event::Completion { label, id, text, error } => {
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.completion", &[id, json!(text), json!(error)]);
                }
            }
            Event::Graphic { label, id, svg, error } => {
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.graphic", &[id, json!(svg), json!(error)]);
                }
            }
            Event::AiDelta { label, id, text } => {
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.aiDelta", &[id, json!(text)]);
                }
            }
            Event::AiDone { label, id, text, error } => {
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.aiDone", &[id, json!(text), json!(error)]);
                }
            }
            Event::ThemeChanged => {
                self.theme_turn += 1;
                self.after(150, Event::ApplyTheme { turn: self.theme_turn });
            }
            Event::ApplyTheme { turn } => {
                if turn == self.theme_turn {
                    self.apply_theme();
                }
            }
            Event::Idle { turn } => {
                if turn == self.idle_turn && self.wins.is_empty() {
                    self.snapshot_waiting(false);
                    self.historian.wait();
                    self.handle.exit(0);
                }
            }
            Event::Snapshot { root, turn } => {
                if self.unsnapped.get(&root) == Some(&turn) {
                    self.unsnapped.remove(&root);
                    let (stamp, access) = (self.stamp(), self.access());
                    self.historian.snapshot(&root, stamp, access);
                }
            }
            Event::GitHub(news) => self.on_github(news),
            Event::Paste { label, mut said } => {
                // (what a block made here is said to come from)
                said["device"] = json!(paste::device_name(&self.stamp().device));
                if let Some(w) = self.wins.get(&label) {
                    w.js("MdView.pasteboard", &[said]);
                }
            }
            Event::Fetched { label, done } => match done {
                Ok(folder) => self.open_folder(&folder),
                Err(e) => {
                    if let Some(w) = self.wins.get(&label) {
                        w.toast(format!("Couldn't get the repository: {e}"));
                    }
                }
            },
            Event::GitHubRenew { turn } => {
                if turn == self.renew_turn {
                    github::resume(self.tx.clone(), self.keyring_place());
                }
            }
            Event::UpdateTick => {
                if truthy(&self.prefs()["updateAuto"]) {
                    update::check(&self.handle, self.tx.clone(), false);
                }
                self.after(UPDATE_EVERY_MS, Event::UpdateTick);
            }
            Event::Update(news) => self.on_update(news),
            Event::UpdateDo(what) => match what {
                "check" => self.check_update(),
                "restart" => self.restart_to_update(),
                "later" => self.update_later(),
                _ if self.restarting && self.wins.is_empty() => self.restart_updated(),
                _ => {}
            },
            Event::SyncTick => {
                self.sync_shown();
                self.after(self.sync_ms(), Event::SyncTick);
            }
            Event::Reconciled { root, mut standing, asked } => {
                standing["at"] = json!(now());
                let here = |w: &Win| w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root));
                if asked && standing["state"] == "error" {
                    // (what the user asked for did not go — linking, joining: said, and the state before stays)
                    let text = format!("GitHub: {}", standing["why"].as_str().unwrap_or(""));
                    self.each_win(|w, app| {
                        if w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root)) {
                            w.toast(text.clone());
                            w.js("MdView.conflictsFailed", &[]);
                            w.tree_json = None;
                            w.send_folder(app);
                            w.settings_info(app);
                        }
                    });
                    return;
                }
                let odds = standing["state"] == "conflict" && self.synced.get(&root).is_none_or(|was| was["state"] != "conflict");
                if odds {
                    let n = standing["files"].as_array().map_or(0, Vec::len);
                    let text = format!("{} changed here and on another device. Resolve from the clock in the sidebar", if n == 1 { "A file was".to_string() } else { format!("{n} files were") });
                    for w in self.wins.values().filter(|w| here(w)) {
                        w.toast(text.clone());
                    }
                }
                // (what goes wrong without having been asked for is said too, once when it begins: a project
                // that has stopped being sent is not found out about from a tooltip weeks later.
                // "offline" is not said — a machine without a network is no news)
                let failing = |v: &Value| matches!(v["state"].as_str(), Some("error" | "signin"));
                if failing(&standing) && !asked && !self.synced.get(&root).is_some_and(failing) {
                    let text = if standing["state"] == "signin" { "GitHub: sign in again — this folder is not being synced (Settings › History)".to_string() } else { format!("Not synced: {}", standing["why"].as_str().unwrap_or("GitHub refused")) };
                    for w in self.wins.values().filter(|w| here(w)) {
                        w.toast(text.clone());
                    }
                }
                if *DEBUG {
                    eprintln!("[sync] {}: {standing}", root.display());
                }
                let changed = self.synced.get(&root).map(|was| (&was["state"], &was["files"])) != Some((&standing["state"], &standing["files"])) || !standing["did"].is_null();
                self.synced.insert(root.clone(), standing);
                if changed {
                    // (the clock and the settings say how the project stands)
                    self.each_win(|w, app| {
                        if w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root)) {
                            w.send_folder(app);
                            w.js("MdView.historyKept", &[]);
                        }
                    });
                }
                // (the list of shares changed here and is at GitHub now: the web app is told, so that
                // a link finds its repository and its overview of what is shared is right)
                if self.share_dirty.contains(&root) && share::arrived(&root) {
                    self.share_dirty.remove(&root);
                    share::tell(&root);
                }
                // (a share's window says whether its link shows yet what was set)
                for w in self.wins.values() {
                    if let Some(path) = w.share_asked.as_deref().filter(|p| p.starts_with(&root)) {
                        w.js("MdView.share", &[share::info(path)]);
                    }
                }
            }
            Event::Snapshotted { root, kept, skipped, error, asked } => {
                if asked {
                    let said = error.as_ref().map(|e| format!("Couldn't take in: {e}"));
                    self.each_win(|w, app| {
                        if w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root)) {
                            w.send_folder(app);
                            if let Some(text) = &said {
                                w.toast(text.clone());
                            }
                        }
                    });
                }
                if kept {
                    // (settings that show the folder's history are no longer right)
                    for w in self.wins.values().filter(|w| w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root))) {
                        w.js("MdView.historyKept", &[]);
                    }
                }
                if let (Some(e), true) = (&error, *DEBUG) {
                    eprintln!("[history] {}: {e}", root.display());
                }
                let new: Vec<String> = skipped.into_iter().filter(|f| self.said_big.insert(format!("{}/{f}", root.display()))).collect();
                if !new.is_empty() {
                    let text = format!("Too large for the history (over 50 MB): {}", new.join(", "));
                    for w in self.wins.values().filter(|w| w.path.as_deref().or(w.folder.as_deref()).is_some_and(|p| p.starts_with(&root))) {
                        w.toast(text.clone());
                    }
                }
            }
        }
    }

    /// The process stays resident, the page (viewer.js) is read fresh for every window: after
    /// an update the two would not match. With no window open, start over from the new program.
    pub(super) fn restart_if_stale(&self, args: &[String]) {
        if !self.wins.is_empty() {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        // (a program built anew is another file in the old one's place: Linux then names the
        // running one "… (deleted)" — the new one is at the name without that)
        let exe = exe.to_str().and_then(|e| e.strip_suffix(" (deleted)")).map(PathBuf::from).unwrap_or(exe);
        let stamp = fs::metadata(&exe).ok().and_then(|m| m.modified().ok());
        if stamp.is_none() || stamp == self.started {
            return;
        }
        self.historian.wait(); // (a snapshot under way is finished first)
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            let _ = std::process::Command::new(exe).args(args).exec();
        }
        #[cfg(not(unix))]
        let _ = args;
    }

    // -- updates of the app (update.rs) ------------------------------------

    /// For the settings: what this install does about a newer version, and how the last look
    /// went. Null where nothing is done (a checkout's build): the rows are then not shown.
    pub(super) fn update_shown(&self) -> Value {
        let kind = *update::KIND;
        if kind == update::Install::Checkout {
            return Value::Null;
        }
        let mut shown = self.update.clone();
        shown["install"] = json!(kind.name());
        shown["version"] = json!(update::VERSION);
        shown
    }

    /// What the settings show of it, told to every window (only that part of what they know).
    fn tell_update(&mut self) {
        let info = json!({ "update": self.update_shown() });
        self.each_win(|w, _| w.js("MdView.settingsInfo", &[info.clone()]));
    }

    /// The notice every window shows (None: taken away).
    fn notice(&mut self, notice: Option<Value>) {
        self.update_notice = notice.clone();
        let notice = notice.unwrap_or(Value::Null);
        self.each_win(|w, _| w.js("MdView.updateNotice", &[notice.clone()]));
    }

    /// Check Now, in the settings: said there how it went, errors too.
    fn check_update(&mut self) {
        if *update::KIND == update::Install::Checkout {
            return;
        }
        self.update = json!({ "state": "checking" });
        self.tell_update();
        update::check(&self.handle, self.tx.clone(), true);
    }

    fn on_update(&mut self, news: update::News) {
        use update::News;
        match news {
            News::Current { .. } => self.update = json!({ "state": "current" }),
            News::Ready { version, asked } => {
                self.update = json!({ "state": "ready", "latest": version });
                if asked || self.update_later.as_deref() != Some(version.as_str()) {
                    self.notice(Some(json!({ "version": version, "kind": "restart", "url": update::notes_url(&version) })));
                }
            }
            News::Available { version, asked } => {
                self.update = json!({ "state": "available", "latest": version });
                if asked || self.update_later.as_deref() != Some(version.as_str()) {
                    self.notice(Some(json!({ "version": version, "kind": "download", "url": update::DOWNLOAD_PAGE, "notes": update::notes_url(&version) })));
                }
            }
            // (a look of its own that did not go says nothing: offline is no news)
            News::Failed { why, asked } => {
                if !asked && self.update["state"] != "checking" {
                    return;
                }
                self.update = json!({ "state": "failed", "why": why });
            }
        }
        self.tell_update();
    }

    /// Later: the notice goes from every window, and this version is not shown again by itself.
    fn update_later(&mut self) {
        self.update_later = self.update_notice.as_ref().and_then(|n| n["version"].as_str()).map(String::from);
        self.notice(None);
    }

    /// Restart to Update: on Linux the AppImage is replaced at once (what does not go is said, and
    /// nothing closes); then every window closes the way it does (a note being written is saved
    /// first, a question it asks is asked) and, once the last one is gone, the new version starts.
    fn restart_to_update(&mut self) {
        if !update::KIND.updates_itself() || self.update["state"] != "ready" || self.restarting {
            return;
        }
        #[cfg(not(windows))]
        if let Err(e) = update::install() {
            self.update = json!({ "state": "failed", "why": e });
            self.notice(None);
            self.tell_update();
            let said = format!("Couldn't update: {}", self.update["why"].as_str().unwrap_or(""));
            return self.each_win(|w, _| w.toast(said.clone()));
        }
        self.restarting = true;
        self.notice(None);
        if self.wins.is_empty() {
            return self.restart_updated();
        }
        self.each_win(|w, app| w.close(app));
    }

    /// The last window is gone: what waits to be kept is kept, and the new version starts.
    fn restart_updated(&mut self) {
        self.snapshot_waiting(false);
        self.historian.wait();
        // (Windows: the installer is started, and it ends this process and starts the new one)
        #[cfg(windows)]
        if let Err(e) = update::install() {
            self.restarting = false;
            self.update = json!({ "state": "failed", "why": e });
            return self.new_window(None, None); // (where the settings say why)
        }
        self.handle.request_restart();
    }

    pub(super) fn present(&self, label: &str) {
        if let Some(window) = self.wins.get(label).and_then(|w| w.window.as_ref()) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }

    /// The folders opened last, newest first, as the start window lists them (those gone from the disk left out).
    pub(super) fn recents(&self) -> Vec<Value> {
        let listed = self.state.get("recents").and_then(Value::as_array).cloned().unwrap_or_default();
        let old = self.state.get("folder").cloned().into_iter(); // (kept before the list was: still the newest of it)
        old.chain(listed).filter_map(|v| v.as_str().map(PathBuf::from)).filter(|p| p.is_dir())
            .fold(Vec::<PathBuf>::new(), |mut all, p| { if !all.contains(&p) { all.push(p); } all })
            .into_iter().take(RECENT_FOLDERS)
            .map(|p| json!({ "name": name_of(&p), "path": s(&p) })).collect()
    }

    pub(super) fn open_folder(&mut self, folder: &Path) {
        match self.wins.iter().find(|(_, w)| w.folder.as_deref() == Some(folder)).map(|(l, _)| l.clone()) {
            Some(label) => self.present(&label),
            None => self.new_window(None, Some(folder)),
        }
    }

    pub(super) fn open_file(&mut self, path: &Path) {
        let p = resolve(path);
        if p.is_dir() {
            return self.open_folder(&p);
        }
        match self.wins.iter().find(|(_, w)| w.path.as_deref() == Some(p.as_path())).map(|(l, _)| l.clone()) {
            Some(label) => self.present(&label),
            None => self.new_window(Some(&p), None),
        }
    }

    /// `mdview paste` (paste.rs: cli) asks for a project's pasteboard, read or written: done with
    /// this instance's sign-in, and answered in the file the command waits for. Started by the
    /// command itself, the sign-in kept from before is waited for a moment.
    fn paste_for(&mut self, args: Vec<String>, cwd: &str) {
        let Some(asked) = paste::Asked::of(&args[1..]) else { return self.rest() };
        let why = match (paste::place(&asked.folder), self.session.as_ref().map(|s| s.access.clone())) {
            (None, _) => "off",
            (_, None) if paste::STARTED.elapsed() < std::time::Duration::from_secs(10) => return self.after(300, Event::Open { args, cwd: cwd.to_string() }),
            (_, None) => "signin",
            (Some((root, at)), Some(token)) => {
                let by = self.stamp().device;
                paste::command(asked, root, at, token, by);
                return self.rest();
            }
        };
        paste::answer(&asked.reply, &json!({ "error": why }));
        self.rest();
    }

    pub(super) fn open(&mut self, args: Vec<String>, cwd: &str) {
        if args.first().is_some_and(|a| a == "paste-for") {
            return self.paste_for(args, cwd);
        }
        let quick = args.iter().any(|a| a == "--quick");
        let files: Vec<String> = args.into_iter().filter(|a| !a.starts_with('-')).collect();
        self.restart_if_stale(&if quick { vec!["--quick".to_string()] } else { files.clone() });
        if quick {
            // the quick notes: their folder (made if it is not there), in a window of its own kind
            let dir = quick_dir(&self.prefs());
            if let Err(e) = fs::create_dir_all(&dir) {
                eprintln!("[quick] {}: {e}", dir.display());
                return;
            }
            return self.open_folder(&resolve(&dir));
        }
        if files.is_empty() {
            // Started bare: the start window, which offers the folders opened last (a window that already waits there is shown).
            return match self.wins.iter().find(|(_, w)| w.path.is_none() && w.folder.is_none()).map(|(l, _)| l.clone()) {
                Some(label) => self.present(&label),
                None => self.new_window(None, None),
            };
        }
        for f in files {
            if f.contains("://") {
                match url_file(&f) {
                    Some((p, _)) => self.open_file(&p),
                    None => host::launch_uri(&f),
                }
            } else {
                self.open_file(&Path::new(cwd).join(&f));
            }
        }
    }

    pub(super) fn new_window(&mut self, path: Option<&Path>, folder: Option<&Path>) {
        self.seq += 1;
        self.idle_turn += 1; // (no longer resting)
        let label = format!("w{}", self.seq);
        let mut w = Win::new(&label, self);
        match (folder, path) {
            (Some(folder), _) => w.set_folder(self, folder),
            (None, Some(path)) => w.open_path(self, path, None, false),
            // (neither: the window says what can be opened — a folder, a file — and waits; see on_loaded)
            _ => w.load_shell(self, false),
        }
        let num = |key: &str| self.state.get(key).and_then(Value::as_f64);
        let (width, height) = if folder.is_some() {
            (num("folder_width").unwrap_or(num("width").unwrap_or(900.0) + SIDEBAR_WIDTH as f64), num("folder_height").or(num("height")).unwrap_or(1040.0))
        } else {
            (num("width").unwrap_or(900.0), num("height").unwrap_or(1040.0))
        };
        let (r, g, b) = self.theme.background();
        let url: tauri::Url = format!("{ORIGIN}/shell/{label}/{}", w.shell_n).parse().unwrap();
        let (nav, loaded, own) = (self.tx.clone(), self.tx.clone(), label.clone());
        let own2 = label.clone();
        // (A probe's page keeps nothing: what an earlier run left — the place a note was scrolled
        // to, an embed's size — would decide how the next one starts, and would land in the real store.)
        let built = WebviewWindowBuilder::new(&self.handle, &label, WebviewUrl::CustomProtocol(url))
            .title(if w.title.is_empty() { "Markdown Notes" } else { &w.title })
            .inner_size(width, height)
            .background_color(tauri::window::Color(r, g, b, 255))
            .incognito(PROBE.is_some())
            .disable_drag_drop_handler() // (a picture dropped on a note is the page's to take)
            .on_navigation(move |url| {
                // The window's own page may load; anything else is a link, and the shell's to follow.
                let own_page = url.as_str().starts_with(ORIGIN) && url.path().starts_with("/shell/");
                if own_page || url.scheme() == "about" {
                    return true;
                }
                let _ = nav.send(Event::Link { label: own.clone(), href: url.to_string() });
                false
            })
            .on_page_load(move |_window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let _ = loaded.send(Event::Loaded { label: own2.clone(), url: payload.url().to_string() });
                }
            })
            .build();
        let Ok(window) = built else { return self.rest() };
        let (crash, own) = (self.tx.clone(), label.clone());
        host::setup(&window, *DEBUG, move || {
            let _ = crash.send(Event::Crashed { label: own.clone() });
        });
        w.window = Some(window);
        self.wins.insert(label, w);
    }
}
