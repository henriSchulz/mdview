// A folder's history, its other side, and sharing (area C). Rust originals: history.rs, shell/project.rs, sync.rs, github.rs,
// share.rs, paste.rs, shell/app.rs (stamp, touch, sync timers, github, reconciled/snapshotted). The git side is in HistoryGit.swift /
// HistoryCore.swift / HistorySync.swift, GitHub's sign-in in HistoryGitHub.swift, sharing and the pasteboard in HistoryShare.swift.
// This file: what the windows share (HistoryHub) and the messages of the page (handleHistory).
import AppKit

final class HistoryState {
    var shareAsked: String?
    var getting: (url: String, name: String, branch: String)?
}

/// What all windows share of the history: the device, the sign-in with GitHub, the snapshots waiting for a quiet moment, and how each
/// linked project stood when last reconciled. (The Rust shell's App; the git work runs on one serial queue, the Historian.)
final class HistoryHub {
    static let shared = HistoryHub()

    let queue = DispatchQueue(label: "mdview.historian")
    var unsnapped: [String: Int] = [:]
    var snapTurn = 0
    var synced: [String: [String: Any]] = [:]
    var shareDirty: Set<String> = []
    var saidBig: Set<String> = []
    var session: Session?
    var signing: (stop: GitHub.StopFlag, shown: (String, String)?)?
    var repos: [[String: Any]]?
    var githubSaid = ""
    var made: Any = NSNull()
    var making: (root: String, n: Any)?
    var renewTurn = 0
    var started = false

    init() {
        DispatchQueue.main.async { [self] in start() }
    }

    func start() {
        guard !started else { return }
        started = true
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { [weak self] _ in
            // (the window is gone from the list a moment later; projects no window shows any more are kept now)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { self?.snapshotWaiting(keep: true) }
        }
        NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { [weak self] _ in
            self?.snapshotWaiting(keep: false)
            self?.wait()
        }
        GitHub.resume(place: keyringPlace) { [weak self] news in DispatchQueue.main.async { self?.onGitHub(news) } } // (a sign-in kept from before)
        // (awake again: a token that ran out meanwhile, or soon will, is renewed now — before the next sync asks with it)
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.renewIfDue()
        }
        scheduleSyncTick()
    }

    /// The sign-in renewed now if it has run out or is about to (within ten minutes); nothing if not signed in.
    func renewIfDue() {
        guard let s = session, signing == nil, s.expires - GitHub.now() < 600 else { return }
        renewTurn += 1
        GitHub.resume(place: keyringPlace) { [weak self] n in self?.tell(n) }
    }

    var windows: [NoteWindow] { AppDelegate.shared?.windows ?? [] }
    var store: Store { Store.shared }
    var keyringPlace: String { store.dir.path }

    func here(_ w: NoteWindow, _ root: String) -> Bool {
        guard let p = w.path ?? w.folder else { return false }
        return p == root || p.hasPrefix(root + "/")
    }

    // MARK: the device

    static func hostName() -> String {
        var buf = [CChar](repeating: 0, count: 256)
        if gethostname(&buf, buf.count) == 0 {
            let n = String(cString: buf).trimmingCharacters(in: .whitespaces)
            if !n.isEmpty { return n }
        }
        return "device"
    }

    /// Who this program's commits are made by: the device (state.json "device": an id made once, and a name that is the computer's
    /// until another is set).
    func stamp() -> Stamp {
        let dev = store.state["device"] as? [String: Any] ?? [:]
        func known(_ k: String) -> String? { (dev[k] as? String).flatMap { $0.isEmpty ? nil : $0 } }
        var id = known("id"), name = known("name")
        if id == nil || name == nil {
            id = id ?? UUID().uuidString.lowercased()
            name = name ?? (Host.current().localizedName ?? Self.hostName())
            store.set("device", ["id": id!, "name": name!])
        }
        let own = (store.prefs["deviceName"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.1"
        return Stamp(device: "\(own.isEmpty ? name! : own) (\(id!))", client: "macos \(version)", author: session?.author)
    }

    var access: Access { Access(token: session?.access) }

    // MARK: snapshots

    /// Something at this path changed, or may have: its project, if it is in one, gets a snapshot once it has been quiet for a while.
    func touch(_ path: String) {
        if path.split(separator: "/").contains(".git") { return } // (the history's own writing)
        if Paste.isCopy(path) { return }
        guard case .project(let root) = Hist.placeOf(path) else { return }
        _ = HistoryHub.shared.started
        snapTurn += 1
        let turn = snapTurn
        unsnapped[root] = turn
        let env = ProcessInfo.processInfo.environment["MDVIEW_HISTORY_QUIET_MS"].flatMap { Double($0) }
        let quiet = (env ?? Double(max(1, (store.prefs["historyQuiet"] as? Int) ?? 30)) * 1000) / 1000
        DispatchQueue.main.asyncAfter(deadline: .now() + quiet) { [weak self] in
            guard let self, self.unsnapped[root] == turn else { return }
            self.unsnapped[root] = nil
            self.snapshot(root)
        }
    }

    /// What waits in a project is kept now, and a linked one reconciled — not after the quiet while.
    func keepNow(_ root: String) {
        unsnapped[root] = nil
        snapshot(root)
    }

    func shownProjects() -> Set<String> {
        var s: Set<String> = []
        for w in windows { if let p = w.path ?? w.folder, case .project(let r) = Hist.placeOf(p) { s.insert(r) } }
        return s
    }

    /// The snapshots still waiting are made now — all of them, or (keep) only those of projects no window shows any more.
    func snapshotWaiting(keep: Bool) {
        let shown = keep ? shownProjects() : []
        for root in unsnapped.keys.filter({ !shown.contains($0) }) {
            unsnapped[root] = nil
            snapshot(root)
        }
    }

    /// Returns when everything asked for so far is done (before the program ends).
    func wait() { queue.sync {} }

    // MARK: the historian's jobs

    func snapshot(_ root: String) {
        let (stamp, access) = (self.stamp(), self.access)
        queue.async { [weak self] in
            var kept = false, skipped: [String] = [], failed: String?
            do { let d = try Hist.snapshot(root, stamp); kept = d.commit != nil; skipped = d.skipped } catch let e { failed = "\(e)" }
            let error = failed
            if kept || !skipped.isEmpty || error != nil { DispatchQueue.main.async { self?.snapshotted(root, kept: kept, skipped: skipped, error: error, asked: false) } }
            // (a project that is linked: what was kept goes over, what is there comes)
            if Sync.linked(root) != nil {
                let standing = Sync.reconcile(root, access, stamp).json
                DispatchQueue.main.async { self?.reconciled(root, standing, asked: false) }
            }
        }
    }

    /// A linked project and its other side are reconciled, nothing kept first here.
    func sync(_ root: String) {
        let (stamp, access) = (self.stamp(), self.access)
        queue.async { [weak self] in
            let standing = Sync.reconcile(root, access, stamp).json
            DispatchQueue.main.async { self?.reconciled(root, standing, asked: false) }
        }
    }

    func resolve(_ root: String, expect: String, picks: [String: Any]) {
        let (stamp, access) = (self.stamp(), self.access)
        queue.async { [weak self] in
            let standing = Sync.resolve(root, expect: expect, picks: picks, access, stamp).json
            DispatchQueue.main.async { self?.reconciled(root, standing, asked: true) }
        }
    }

    /// A project is linked to a repository elsewhere and reconciled with it.
    func link(_ root: String, url: String) {
        let (stamp, access) = (self.stamp(), self.access)
        queue.async { [weak self] in
            var standing: SyncStanding
            do { try Sync.link(root, url); standing = Sync.reconcile(root, access, stamp) } catch { standing = .refused("\(error)") }
            if standing.isRefused { try? Sync.unlink(root) } // (a repository that holds another project is let go of again)
            DispatchQueue.main.async { self?.reconciled(root, standing.json, asked: true) }
        }
    }

    /// A repository elsewhere is fetched into a new folder, as a project (for the window that asked).
    func fetch(window: NoteWindow, url: String, into: String, branch: String) {
        let access = self.access
        weak let w = window
        queue.async {
            var err: String?
            do { try Sync.fetchNew(url, into: into, branch: branch, access) } catch { err = "\(error)" }
            DispatchQueue.main.async {
                if let err { w?.toast("Couldn't get the repository: \(err)") } else { AppDelegate.shared.openWindow(into) }
            }
        }
    }

    /// The projects below a project become parts of it; its snapshot follows.
    func merge(_ root: String, children: [String]) {
        let stamp = self.stamp()
        queue.async { [weak self] in
            let failed = children.compactMap { c -> String? in do { try Hist.merge(root, child: c, stamp); return nil } catch { return "\(error)" } }
            let skipped = (try? Hist.snapshot(root, stamp))?.skipped ?? []
            let error = failed.isEmpty ? nil : failed.joined(separator: "; ")
            DispatchQueue.main.async { self?.snapshotted(root, kept: true, skipped: skipped, error: error, asked: true) }
        }
    }

    // MARK: what the jobs tell

    func snapshotted(_ root: String, kept: Bool, skipped: [String], error: String?, asked: Bool) {
        let mine = windows.filter { here($0, root) }
        if asked {
            for w in mine { w.sendFolder(); if let e = error { w.toast("Couldn't take in: \(e)") } }
        }
        if kept { for w in mine { w.js("MdView.historyKept", []) } } // (settings that show the folder's history are no longer right)
        let new = skipped.filter { saidBig.insert("\(root)/\($0)").inserted }
        if !new.isEmpty { for w in mine { w.toast("Too large for the history (over 50 MB): \(new.joined(separator: ", "))") } }
    }

    func reconciled(_ root: String, _ standing0: [String: Any], asked: Bool) {
        var standing = standing0
        standing["at"] = Int(Date().timeIntervalSince1970)
        let mine = windows.filter { here($0, root) }
        let state = standing["state"] as? String
        if asked && state == "error" {
            // (what the user asked for did not go — linking, joining: said, and the state before stays)
            let text = "GitHub: \(standing["why"] as? String ?? "")"
            for w in mine { w.toast(text); w.js("MdView.conflictsFailed", []); w.treeJSON = nil; w.sendFolder(); settingsChanged(w) }
            return
        }
        let was = synced[root]
        if state == "conflict" && (was?["state"] as? String) != "conflict" {
            let n = (standing["files"] as? [Any])?.count ?? 0
            let text = "\(n == 1 ? "A file was" : "\(n) files were") changed here and on another device. Resolve from the clock in the sidebar"
            for w in mine { w.toast(text) }
        }
        // (what goes wrong without having been asked for is said too, once when it begins; "offline" is not said — a machine without a network is no news)
        func failing(_ v: [String: Any]?) -> Bool { ["error", "signin"].contains(v?["state"] as? String ?? "") }
        if failing(standing) && !asked && !failing(was) {
            let text = state == "signin" ? "GitHub: sign in again — this folder is not being synced (Settings › History)" : "Not synced: \(standing["why"] as? String ?? "")"
            for w in mine { w.toast(text) }
        }
        let changed = (was?["state"] as? String) != state || jsonString(was?["files"] ?? NSNull()) != jsonString(standing["files"] ?? NSNull()) || standing["did"] != nil
        synced[root] = standing
        if changed {
            // (the clock and the settings say how the project stands)
            for w in mine { w.sendFolder(); w.js("MdView.historyKept", []) }
        }
        // (the list of shares changed here and is at GitHub now: the web app is told)
        if shareDirty.contains(root) && Share.arrived(root) { shareDirty.remove(root); Share.tell(root) }
        // (a share's window says whether its link shows yet what was set)
        for w in windows { if let p = w.historyS.shareAsked, p.hasPrefix(root + "/") { w.js("MdView.share", [Share.info(p)]) } }
    }

    func settingsChanged(_ w: NoteWindow) { _ = w.handleSystem("settings-info", [:]) }
    func eachSettings() { for w in windows { settingsChanged(w) } }

    // MARK: syncing the projects on screen

    var syncMs: Double { ProcessInfo.processInfo.environment["MDVIEW_SYNC_MS"].flatMap { Double($0) } ?? 60_000 }

    func scheduleSyncTick() {
        DispatchQueue.main.asyncAfter(deadline: .now() + syncMs / 1000) { [weak self] in
            self?.syncShown()
            self?.scheduleSyncTick()
        }
    }

    /// The linked projects on screen are reconciled with their other side — not one that has changes waiting to be kept: its snapshot comes, and reconciles.
    func syncShown() {
        for root in shownProjects() where unsnapped[root] == nil && Sync.linked(root) != nil { sync(root) }
    }

    /// Where a folder stands with a history, for the page: Hist.standing, and for a linked project where its other side is and how the two stood.
    func standing(_ folder: String) -> [String: Any] {
        var all = Hist.standing(folder)
        if let root = all["root"] as? String, ["project", "inside"].contains(all["state"] as? String ?? "") {
            if let url = Sync.linked(root) { all["linked"] = url; all["sync"] = synced[root] ?? NSNull() }
        }
        return all
    }

    // MARK: GitHub

    func githubShown() -> [String: Any] {
        var code: Any = NSNull()
        if let (c, u) = signing?.shown { code = ["code": c, "uri": u] }
        return ["user": session.map(GitHub.shown) ?? NSNull(), "code": code, "busy": signing != nil, "repos": repos ?? NSNull(),
                "said": githubSaid, "made": made]
    }

    func tell(_ news: GitHubNews) { DispatchQueue.main.async { [weak self] in self?.onGitHub(news) } }

    func onGitHub(_ news: GitHubNews) {
        switch news {
        case .code(let c, let u): if signing != nil { signing?.shown = (c, u) }
        case .signedIn(let s, let note):
            // (renewed a while before it ends; a linked project's other side is looked at now)
            // (by the wall's clock: the other one stands still while the Mac sleeps — the lid shut overnight, the token
            // ran out hours before its renewal came, and every sync said "sign in again"; review 2026-11-17)
            let left = max(60, s.expires - GitHub.now() - 600)
            renewTurn += 1
            let turn = renewTurn
            DispatchQueue.main.asyncAfter(wallDeadline: .now() + left) { [weak self] in
                guard let self, self.renewTurn == turn else { return }
                GitHub.resume(place: self.keyringPlace) { n in self.tell(n) }
            }
            session = s; signing = nil; githubSaid = note ?? ""
            syncShown()
        case .out(let why):
            if signing == nil { session = nil; repos = nil } else { signing = nil }
            githubSaid = why
        case .repos(let r):
            switch r { case .success(let l): repos = l; case .failure(let e): repos = []; githubSaid = e.description }
        // a repository made for a project: linked as Link… links it (an empty one takes the project as it is)
        case .made(.success(let repo)):
            if let m = making, let url = repo["url"] as? String {
                making = nil
                synced[m.root] = nil
                link(m.root, url: url)
                made = ["n": m.n, "done": true, "name": repo["name"] ?? NSNull()]
            }
        case .made(.failure(let no)):
            var j = no.json
            j["n"] = making?.n ?? NSNull()
            making = nil
            made = j
        case .later:
            renewTurn += 1
            let turn = renewTurn
            DispatchQueue.main.asyncAfter(wallDeadline: .now() + 60) { [weak self] in
                guard let self, self.renewTurn == turn else { return }
                GitHub.resume(place: self.keyringPlace) { n in self.tell(n) }
            }
        }
        eachSettings()
    }
}

extension NoteWindow {
    /// The folder this window is about: the one it browses, or the one its note is in.
    func historyHere() -> String? { folder ?? path.map { Lib.dir($0) } }

    func historyProject() -> String? {
        if let h = historyHere(), case .project(let r) = Hist.placeOf(h) { return r }
        return nil
    }

    /// Where the folder stands with a history: "none", a "project" itself, "inside" one above, or "foreign" (shell/app.rs `standing`).
    func historyStanding(_ folder: String) -> [String: Any] { HistoryHub.shared.standing(folder) }

    /// The links shared of this folder's notes (share.rs `listed`), for MdView.setFolder.
    func sharedListed(_ folder: String) -> Any { Share.listed(folder) }

    /// For the settings (System area: settings-info): "history" — the folder shown: where it stands, what is kept, what waits — and "github".
    func historySettingsInfo() -> [String: Any] {
        let hub = HistoryHub.shared
        var h: [String: Any] = ["state": "none"]
        if let f = historyHere() {
            h = Hist.overview(f)
            if let root = h["root"] as? String {
                h["waiting"] = hub.unsnapped[root] != nil
                let linked = hub.standing(f)
                h["linked"] = linked["linked"] ?? NSNull()
                h["sync"] = linked["sync"] ?? NSNull()
                h["newRepo"] = GitHub.newName(Lib.name(root)) // (the name a new repository is offered under)
            }
        }
        return ["history": h, "github": hub.githubShown()]
    }

    private func settingsChanged() { HistoryHub.shared.settingsChanged(self) }

    func handleHistory(_ type: String, _ msg: [String: Any]) -> Bool {
        let hub = HistoryHub.shared
        let str = { (k: String) in msg[k] as? String ?? "" }
        switch type {
        // the history's window: a note's versions, one of them as text, one of them put back as the note
        case "history-log":
            guard let p = (msg["path"] as? String) ?? path else { return true }
            let standing = Hist.standing(Lib.dir(p))
            let versions = (try? Hist.log(p)) ?? []
            js("MdView.history", [["path": p, "versions": versions, "state": standing["state"] as Any, "own": standing["own"] as Any]])
        case "history-text":
            let p = str("path")
            let text = (try? Hist.text(p, id: str("id"), at: msg["at"] as? String)).map { String(decoding: $0, as: UTF8.self) }
            js("MdView.historyText", [["path": p, "id": str("id"), "text": text as Any? ?? NSNull()]])
        case "history-restore":
            let p = str("path")
            // (only a note this window knows, written as any change from outside: the watcher shows it)
            let known = path == p || notePaths.contains(p)
            if known, Lib.isMd(p), let bytes = try? Hist.text(p, id: str("id"), at: msg["at"] as? String) {
                do { try Lib.writeWhole(p, bytes); hub.touch(p); js("MdView.historyRestored", [["path": p, "id": str("id")]]) }
                catch { toast("Couldn't restore: \(error.localizedDescription)") }
            } else { toast("Couldn't restore this version") }
        // Sync Now (the sidebar's button): what waits in the project is kept at once, and the project brought in line with its other side
        case "sync-now":
            if let root = historyProject(), Sync.linked(root) != nil { hub.keepNow(root) }
            else { toast("Nothing to sync with: this folder is not linked to a repository") }
        // the conflicts' window: what stands in the way of joining the project with its other side, and joining with what the user picked
        case "sync-conflicts", "sync-resolve":
            guard let root = historyProject() else { return true }
            if type == "sync-conflicts" {
                do { js("MdView.conflicts", [try Sync.conflicts(root)]) } catch { toast("Couldn't read the conflicts: \(error)") }
            } else if let picks = msg["picks"] as? [String: Any] {
                hub.unsnapped[root] = nil // (what waits is kept by the joining itself)
                hub.resolve(root, expect: str("theirs"), picks: picks)
            }
        // signing in with GitHub: begun — the code comes with the settings' info —, the browser opened with the code on the clipboard, given up, signed out
        case "github-signin":
            if hub.signing == nil {
                let stop = GitHub.StopFlag()
                hub.signing = (stop, nil)
                hub.githubSaid = ""
                GitHub.signIn(place: hub.keyringPlace, stop: stop) { hub.tell($0) }
                settingsChanged()
            }
        case "github-open":
            if let (code, uri) = hub.signing?.shown {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(code, forType: .string)
                if let u = URL(string: uri) { NSWorkspace.shared.open(u) }
            }
        case "github-cancel":
            if let s = hub.signing { s.stop.on = true; hub.signing = nil }
            settingsChanged()
        // the repositories the app was given (read anew), where they are chosen on GitHub, and one of them fetched into a folder of its own
        case "github-repos":
            hub.repos = nil // (read anew each time: what the app is given may have changed since)
            if let s = hub.session { GitHub.repos(session: s) { hub.tell($0) } }
        case "github-give": NSWorkspace.shared.open(URL(string: GitHub.give)!)
        // a new repository on GitHub for the project: made, on a thread, under the name as GitHub takes it, then linked
        case "github-new":
            let name = GitHub.repoName(str("name"))
            let root = historyProject()
            let n = msg["n"] ?? NSNull()
            if hub.making != nil { hub.made = ["n": n, "error": "failed", "why": "a repository is being made already"] }
            else if name.isEmpty { hub.made = ["n": n, "error": "invalid", "name": str("name")] }
            else if root == nil { hub.made = ["n": n, "error": "failed", "why": "this folder is not a project"] }
            else if hub.session == nil { hub.made = ["n": n, "error": "failed", "why": "not signed in"] }
            else {
                hub.making = (root!, n)
                GitHub.make(session: hub.session!, name: name) { hub.tell($0) }
                hub.made = ["n": n, "busy": true, "name": name]
            }
            hub.eachSettings()
        case "github-get":
            let name = Lib.clean(str("name"))
            if let url = msg["url"] as? String, !name.isEmpty {
                historyS.getting = (url, name, (msg["branch"] as? String) ?? "main")
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
                panel.prompt = "Choose"; panel.message = "Choose the folder to put “\(name)” in"
                panel.beginSheetModal(for: window) { [weak self] r in
                    guard let self, r == .OK, let parent = panel.url?.path, let g = self.historyS.getting else { self?.historyS.getting = nil; return }
                    self.historyS.getting = nil
                    hub.fetch(window: self, url: g.url, into: Lib.join(parent, g.name), branch: g.branch)
                }
            }
        case "github-signout":
            GitHub.signOut(hub.keyringPlace)
            hub.session = nil; hub.repos = nil; hub.made = NSNull(); hub.renewTurn += 1; hub.githubSaid = ""
            hub.eachSettings()
        // the project is told where its other side is (url) or that it has none (no url); linked, the two are reconciled at once
        case "history-link":
            guard let root = historyProject() else { return true }
            hub.synced[root] = nil
            if let url = msg["url"] as? String, !url.isEmpty { hub.link(root, url: url) }
            else {
                do { try Sync.unlink(root) } catch { toast("Couldn't unlink: \(error)") }
                treeJSON = nil
                sendFolder()
                settingsChanged()
            }
        // the project's pasteboard: asked for, or written — by the web app's server, which keeps it. Without a repository to name it by, or anyone signed in, there is none.
        case "paste-get", "paste-put":
            let put = type == "paste-put"
            let n = msg["n"] ?? NSNull()
            var why = "off"
            if let h = historyHere(), let (root, at) = Paste.place(h) {
                if let token = hub.session?.access {
                    let done: ([String: Any]) -> Void = { [weak self] said0 in
                        var said = said0
                        said["n"] = n
                        if put { said["put"] = true }
                        said["device"] = Paste.deviceName(hub.stamp().device) // (what a block made here is said to come from)
                        self?.js("MdView.pasteboard", [said])
                    }
                    if put { Paste.put(root: root, at: at, token: token, text: str("text"), base: (msg["base"] as? Int) ?? 0, by: hub.stamp().device, done: done) }
                    else { Paste.get(root: root, at: at, token: token, rev: (msg["rev"] as? Int) ?? 0, wait: (msg["wait"] as? Bool) == true, done: done) }
                    return true
                }
                why = "signin"
            }
            js("MdView.pasteboard", [["n": n, "put": put, "error": why]])
        // sharing a note: how it stands, shared or its password set, shared no more — written into the project, kept and sent on at once
        case "share-info":
            let p = str("path")
            js("MdView.share", [Share.info(p)])
            historyS.shareAsked = p
        case "share-set", "share-stop":
            let p = str("path")
            let known = path == p || notePaths.contains(p)
            let finish: (Result<String?, Error>) -> Void = { [weak self] done in
                guard let self else { return }
                switch done {
                case .success(let root): if let root { hub.shareDirty.insert(root); hub.keepNow(root) }
                case .failure(let e): self.toast("Couldn't share: \(e)")
                }
                self.js("MdView.share", [Share.info(p)])
                self.historyS.shareAsked = p
                self.sendFolder() // (the sidebar marks what is shared)
            }
            if !known || !Lib.isMd(p) || (Share.info(p)["can"] as? Bool) != true { finish(.success(nil)) }
            else if type == "share-stop" { finish(Result { try Share.stop(p) }) }
            else {
                // (password: a text sets it, null takes it away, none said leaves it)
                var password: String??
                if msg.keys.contains("password") { if let s = msg["password"] as? String, !s.isEmpty { password = .some(s) } else { password = .some(nil) } }
                let shared = Share.isShared(p)
                // (a note shared for the first time: the web app says a short id that is free)
                DispatchQueue.global().async {
                    let id = shared ? nil : Share.freeID()
                    DispatchQueue.main.async { finish(Result { try Share.set(p, password: password, id: id) }) }
                }
            }
        // Ctrl+S: what waits in the project is kept now, and a linked one reconciled — not after the quiet while
        case "history-now":
            if let root = historyProject() { hub.keepNow(root) }
        // the folder's history is switched off: its versions stay, nothing more is kept
        case "history-disable":
            guard let h = historyHere(), Hist.placeOf(h) == .project(h) else { return true }
            hub.unsnapped[h] = nil
            hub.wait() // (a snapshot under way is finished first)
            do {
                try Hist.disable(h, hub.stamp())
                treeJSON = nil; sendFolder(); settingsChanged()
                toast("History is off. Its versions are kept")
            } catch { toast("Couldn't switch the history off: \(error)") }
        // the folder (or the one named) becomes a project; its first snapshot follows
        case "history-enable":
            guard let root = (msg["root"] as? String) ?? historyHere() else { return true }
            // (a repository that is there already is someone's: taken over only when they say so)
            if Hist.placeOf(root) == .foreign(root), !truthy(msg["sure"]), !Hist.wasProject(root) { return askAdopt(root) }
            // (projects of their own below it: a part of this one from now on, or left as they are?)
            let below = Hist.nested(root)
            if !below.isEmpty && (msg["nested"] == nil || msg["nested"] is NSNull) { return askNested(root, below) }
            do {
                try Hist.enable(root)
                if (msg["nested"] as? String) == "merge" { hub.merge(root, children: below) }
                touch(root)
                sendFolder()
                settingsChanged()
            } catch { toast("No history here: \(error)") }
        default: return false
        }
        return true
    }

    /// Before a repository that exists becomes a project: what follows from it, to be agreed to.
    @discardableResult
    private func askAdopt(_ root: String) -> Bool {
        let onto = Hist.branch(root).map { " on the branch “\($0)”" } ?? ""
        let a = NSAlert()
        a.messageText = "Use This Repository for History?"
        a.informativeText = "“\(Lib.name(root))” is a Git repository already. As a project, Markdown Notes keeps every change in it as a commit of its own\(onto), a little while after it was made."
        a.addButton(withTitle: "Use Repository"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { [weak self] r in
            if r == .alertFirstButtonReturn { _ = self?.handleHistory("history-enable", ["type": "history-enable", "root": root, "sure": true]) }
        }
        return true
    }

    /// Before a folder with projects in it becomes one: are they taken in, or left separate?
    @discardableResult
    private func askNested(_ root: String, _ below: [String]) -> Bool {
        let names = below.map { "“\(Lib.relative($0, root))”" }
        let (they, their) = names.count == 1 ? ("is a project of its own", "its") : ("are projects of their own", "their")
        let a = NSAlert()
        a.messageText = "Projects in This Folder"
        a.informativeText = "\(names.joined(separator: ", ")) in this folder \(they). Taken in, \(their) history becomes a part of this project's, and there is one project from now on. Left separate, each keeps a history of its own."
        a.addButton(withTitle: "Take In"); a.addButton(withTitle: "Leave Separate"); a.addButton(withTitle: "Cancel")
        a.beginSheetModal(for: window) { [weak self] r in
            let nested: String
            switch r { case .alertFirstButtonReturn: nested = "merge"; case .alertSecondButtonReturn: nested = "separate"; default: return }
            _ = self?.handleHistory("history-enable", ["type": "history-enable", "root": root, "sure": true, "nested": nested])
        }
        return true
    }
}
