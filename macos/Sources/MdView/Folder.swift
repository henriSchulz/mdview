// A folder window's folder: its notes sent to the sidebar, a note or a folder made, renamed, moved, put in the Trash;
// the file watcher. Rust: shell/folder.rs, shell.rs (set_folder, watch, on_fs).
import AppKit
import CoreServices

extension NoteWindow {
    var watchLimit: Int { 400 }

    func setFolder(_ f: String) {
        let f = Lib.resolve(f)
        touch(f)
        folder = f
        treeJSON = nil
        scanner.titleCache.removeAll()
        quick = f == Lib.resolve(quickDir())
        if !quick { store.rememberFolder(f) }
        rescan()
        let known = Set(((tree.map { collectNotes($0) }) ?? []).compactMap { $0["real"] as? String })
        tabs.removeAll(); tab = 0; closedTabs.removeAll()
        let saved = store.sub("tabs")[f] as? [String: Any]
        if let paths = saved?["paths"] as? [String] {
            for (i, p) in paths.enumerated() {
                let shown = (saved?["active"] as? Int) == i
                let opens = !p.isEmpty && Lib.isFile(p) && ["md", "pdf", "slides"].contains(Lib.kind(p))
                let dir = !p.isEmpty && dirOfFolder(p)
                if opens || dir || (p.isEmpty && shown) {
                    if shown { tab = tabs.count }
                    tabs.append(makeTab(p.isEmpty ? nil : p))
                }
            }
        }
        if let path, known.contains(path) {
            if let i = tabs.firstIndex(where: { $0.path == path }) { tab = i } else { tabs.append(makeTab(path)); tab = tabs.count - 1 }
            return sendTabs()
        }
        // a folder opens on All Notes, in the folder itself — not on the note last shown
        if let i = tabs.firstIndex(where: { $0.path == nil }) { tab = i } else { tabs.append(makeTab(nil)); tab = tabs.count - 1 }
        back.removeAll(); fwd.removeAll()
        showTab(tab)
    }

    func collectNotes(_ n: [String: Any]) -> [[String: Any]] {
        var out = (n["notes"] as? [[String: Any]]) ?? []
        for d in (n["dirs"] as? [[String: Any]]) ?? [] { out += collectNotes(d) }
        return out
    }

    /// The folder read again, now — what a step of the window's own needs at once (a note made, renamed, moved: then
    /// shown, revealed, opened).
    func rescan() {
        rescanItem?.cancel()
        guard let folder, !gone else { return }
        scanGen += 1
        let (titles, away, all) = scanInputs(folder)
        took(scanner.scan(root: folder, titles: titles, keep: keptDirs, putAway: away, all: all))
    }

    /// The folder read again off the main thread — what a change on the disk sets off (a save among them, while one
    /// types): the window answers keys and draws meanwhile. Its tree is taken only if no reading came after it began.
    func rescanQuietly() {
        rescanItem?.cancel()
        guard let folder, !gone else { return }
        scanGen += 1
        let gen = scanGen, keep = keptDirs, scanner = quietScanner
        let (titles, away, all) = scanInputs(folder)
        NoteWindow.scanQueue.async {
            let r = scanner.scan(root: folder, titles: titles, keep: keep, putAway: away, all: all)
            DispatchQueue.main.async { [weak self] in
                guard let self, self.scanGen == gen, self.folder == folder, !self.gone else { return }
                self.took(r)
            }
        }
    }

    private func scanInputs(_ folder: String) -> (Bool, Set<String>, Bool) {
        var away = hiddenListed(folder)
        away.formUnion(attachmentsOwned())
        return (store.bool("sidebar_titles"), away, truthy(store.prefs["showHidden"]))
    }

    private func took(_ r: ScanResult) {
        tree = r.tree
        notePaths = Set(r.notes.compactMap { $0["path"] as? String })
        dirWatch = Set(r.walked.prefix(watchLimit))
        watch()
        sendFolder()
    }

    func sendFolder() {
        guard let folder, ready, var t = tree else { return }
        let opened = store.sub("opened")
        func stamp(_ n: inout [String: Any]) {
            if var notes = n["notes"] as? [[String: Any]] {
                for i in notes.indices { notes[i]["opened"] = (opened[notes[i]["real"] as? String ?? ""] as? Int) ?? 0 }
                n["notes"] = notes
            }
            if var dirs = n["dirs"] as? [[String: Any]] {
                for i in dirs.indices { stamp(&dirs[i]) }
                n["dirs"] = dirs
            }
        }
        stamp(&t)
        let st = store.state
        let payload: [String: Any] = [
            "history": historyStanding(folder), "shared": sharedListed(folder), "looks": looksListed(folder),
            "root": folder, "quick": quick, "name": Lib.name(folder).isEmpty ? folder : Lib.name(folder), "tree": t,
            "titles": truthy(st["sidebar_titles"]), "visible": (st["sidebar"] == nil) ? true : truthy(st["sidebar"]),
            "width": st["sidebar_width"] ?? 0,
        ]
        let blob = jsonString(payload)
        if treeJSON != blob { treeJSON = blob; js("MdView.setFolder", [payload]) }
    }

    func knows(_ p: String) -> Bool { notePaths.contains(p) || boardPaths.contains(p) }

    func openNote(_ p: String, tab useTab: Bool, fragment: String?) {
        guard folder != nil, knows(p) else { return }
        if quick, path != p, settleQuick() { rescan(); if !Lib.exists(p) { return } }
        if Lib.isBoard(p) { return js("MdView.openBoardFile", [p]) }
        if !["md", "pdf", "slides"].contains(Lib.kind(p)) && !Lib.isText(p) {
            NSWorkspace.shared.open(URL(fileURLWithPath: p)); return
        }
        let real = Lib.resolve(p)
        let there = tabs.indices.first { $0 != tab && tabs[$0].path == real }
        if useTab { newTab(real, fragment: fragment) }
        else if let there { stashTab(); showTab(there, fragment: fragment) }
        else { openPath(p, fragment: fragment) }
    }

    // MARK: quick notes

    func quickDir() -> String {
        let q = store.prefs["quickDir"] as? String ?? ""
        return q.isEmpty ? Lib.join(Lib.home(), "Documents/Notizen/QuickNotes") : q
    }
    private var quickName: NSRegularExpression { Lib.rx(#"^\d{4}-\d{2}-\d{2}[ _T-]\d{2}[-:.]\d{2}([-:.]\d{2})?( \d+)?$"#) }

    /// A quick note is left: one with nothing in it goes, one that still has the time for a name is named after what its first line says.
    @discardableResult func settleQuick() -> Bool {
        guard quick, let p = path, Lib.isFile(p), Lib.dir(p) == folder else { return false }
        let stem = ((p as NSString).lastPathComponent as NSString).deletingPathExtension
        if Lib.first(quickName, stem) == nil { return false }
        guard let text = Lib.read(p) else { return false }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return (try? Lib.fm.removeItem(atPath: p)) != nil }
        let name = Lib.titleName(text)
        guard !name.isEmpty, let t = Lib.freeName(p, name) else { return false }
        return (try? Lib.fm.moveItem(atPath: p, toPath: t)) != nil
    }

    func newQuick() {
        let dir = quickDir()
        try? Lib.fm.createDirectory(atPath: dir, withIntermediateDirectories: true)
        if folder == nil { setFolder(dir) }
        guard quick, let folder else { return AppDelegate.shared.openWindow(dir) }
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd HH-mm-ss"
        let stem = df.string(from: Date())
        guard let p = try? Lib.writeNew(folder, data: Data("# ".utf8), name: { $0 == 1 ? "\(stem).md" : "\(stem) \($0).md" }) else { return }
        rescan()
        openPath(p)
        fresh = path
        js("MdView.titleFresh", [Lib.resolve(p)])
    }

    // MARK: a new note named after its title

    /// A note made by New Note ("Untitled") is named after what its first line says — once it has been left alone a moment
    /// while it is written (`last` false), and when it is left (`last`).
    func settleFresh(last: Bool) {
        guard let f = fresh else { return }
        if last { fresh = nil }
        guard Lib.isFile(f), let text = Lib.read(f) else { fresh = nil; return }
        let stem = ((f as NSString).lastPathComponent as NSString).deletingPathExtension
        let untitled = stem == "Untitled" || (stem.hasPrefix("Untitled ") && Int(stem.dropFirst(9)) != nil)
        let name = Lib.titleName(text)
        if !untitled && name != stem { if last { fresh = nil }; return }
        guard !name.isEmpty, name != stem, let target = Lib.freeName(f, name), target != f, let folder else { return }
        relocate(folder, f, target, "rename")
        filesNamed(old: f, new: Lib.resolve(target))
        fresh = last ? nil : path
    }

    // MARK: new note, folder, rename, move, trash

    func targetDir(_ folder: String, _ wanted: String?) -> String {
        let t = wanted.flatMap { $0.isEmpty ? nil : Lib.resolve($0) } ?? folder
        return Lib.isDir(t) && (t == folder || t.hasPrefix(folder + "/")) ? t : folder
    }

    func newNote(name: String, wanted: String?) {
        guard let folder else { return }
        let target = targetDir(folder, wanted)
        if Lib.clean(name).isEmpty {
            // no name asked for: "Untitled", its title empty and the caret in it — the name follows the title (settleFresh)
            guard let p = try? Lib.writeNew(target, data: Data("# ".utf8), name: { $0 == 1 ? "Untitled.md" : "Untitled \($0).md" }) else { return toast("Couldn't create note") }
            let real = Lib.resolve(p)
            did(.made([real]))
            rescan()
            openPath(real)
            ownWrite = Data("# ".utf8)
            fresh = path
            js("MdView.titleFresh", [real])
            return
        }
        let clean = Lib.clean(name)
        let stem = clean.lowercased().hasSuffix(".md") ? String(clean.dropLast(3)).trimmingCharacters(in: .whitespaces) : clean
        let p = Lib.join(target, (stem.isEmpty ? "Untitled" : stem) + ".md")
        if Lib.exists(p) {
            toast("“\(Lib.name(p))” already exists")
            if Lib.isFile(p) { rescan(); openPath(p) }
            return
        }
        guard Lib.fm.createFile(atPath: p, contents: Data("# \(stem)\n\n".utf8)) else { return toast("Couldn't create note") }
        did(.made([p]))
        rescan()
        openPath(p)
        // written at once, in the mode that is worked in
        switch store.string("mode") {
        case "active": js("MdView.setMode", ["active"])
        case "split": js("MdView.setMode", ["split", "end"])
        default: js("MdView.setMode", ["edit", "end"])
        }
    }

    func newFolder(name: String, wanted: String?) {
        guard let folder else { return }
        let target = targetDir(folder, wanted)
        let n = Lib.clean(name)
        let p = Lib.join(target, n.isEmpty ? "New Folder" : n)
        if Lib.exists(p) { return toast("“\(Lib.name(p))” already exists") }
        do { try Lib.fm.createDirectory(atPath: p, withIntermediateDirectories: false) } catch { return toast("Couldn't create folder: \(error.localizedDescription)") }
        did(.made([p]))
        keptDirs.insert(p)
        rescan()
    }

    func renameNote(_ p: String, _ name: String) {
        guard let folder else { return }
        let isDir = Lib.isDir(p) && p.hasPrefix(folder + "/") && p != folder
        guard isDir || knows(p) else { return }
        let n = Lib.name(p)
        let suffix: String = isDir ? "" : Lib.isBoard(p) ? String(n.suffix(".board.svg".count)) : ((p as NSString).pathExtension.isEmpty ? "" : "." + (p as NSString).pathExtension)
        var stem = Lib.clean(name)
        if !suffix.isEmpty, stem.lowercased().hasSuffix(suffix.lowercased()) { stem = String(stem.dropLast(suffix.count)).trimmingCharacters(in: .whitespaces) }
        if Lib.isBoard(p), stem.lowercased().hasSuffix(".board") { stem = String(stem.dropLast(".board".count)).trimmingCharacters(in: .whitespaces) }
        let new = Lib.join(Lib.dir(p), stem + suffix)
        if stem.isEmpty || new == p { return }
        if let f = fresh, f == p || f == Lib.resolve(p) { fresh = nil }
        relocate(folder, p, new, "rename")
    }

    func moveTo(_ p: String, _ dir: String) {
        guard let folder else { return }
        let known = knows(p) || (Lib.isDir(p) && p.hasPrefix(folder + "/") && p != folder)
        if !known || !Lib.isDir(dir) || !(dir == folder || dir.hasPrefix(folder + "/")) || Lib.dir(p) == dir || dir == p || dir.hasPrefix(p + "/") { return }
        relocate(folder, p, Lib.join(dir, Lib.name(p)), "move")
    }

    /// A file or a folder under another path, and everything that knew it by the old one told:
    /// the ways back, the tabs, the note on screen, the page.
    func relocate(_ folder: String, _ old: String, _ new: String, _ how: String) {
        let isDir = Lib.isDir(old)
        let oldReal = Lib.resolve(old)
        let taken = Lib.exists(new) && Lib.resolve(new) != oldReal
        if taken { return toast("“\(Lib.name(new))” already exists") }
        do { try Lib.fm.moveItem(atPath: old, toPath: new) } catch { return toast("Couldn't \(how): \(error.localizedDescription)") }
        did(.moved([(old, new)], how == "rename" ? "rename" : "move"))
        let newReal = Lib.resolve(new)
        filesMoved(folder: folder, old: old, new: new)
        let swap: (String) -> String = { p in
            if p == oldReal { return newReal }
            if isDir && p.hasPrefix(oldReal + "/") { return newReal + p.dropFirst(oldReal.count) }
            return p
        }
        back = back.map(swap); fwd = fwd.map(swap)
        dirTab = dirTab.map(swap)
        for i in tabs.indices {
            tabs[i].path = tabs[i].path.map(swap); tabs[i].back = tabs[i].back.map(swap); tabs[i].fwd = tabs[i].fwd.map(swap)
        }
        if let f = fresh, f == old || f == oldReal { fresh = newReal }
        if path == oldReal, newReal != oldReal {
            // the note on screen: it stays as it is (also mid-edit), under its new name
            renamedFrom = oldReal
            ownWrite = Lib.fm.contents(atPath: newReal)
            path = newReal
            setTitle(Lib.name(newReal))
            watch()
            store.put("last_notes", folder, newReal)
        }
        if !isDir {
            js("MdView.noteRenamed", [["old": old, "path": new, "oldReal": oldReal, "real": newReal, "name": Lib.name(newReal)]])
        } else if let p = path, p.hasPrefix(oldReal + "/") {
            // the note on screen is in the folder: under its new path — and a save the page sent under the old one is its
            // own (rule 69, as for a note renamed: it was dropped, and the last edits with it; review 2026-11-17)
            let was = p, now = newReal + p.dropFirst(oldReal.count)
            renamedFrom = was
            ownWrite = Lib.fm.contents(atPath: String(now))
            path = String(now); watch()
            store.put("last_notes", folder, String(now))
            js("MdView.noteRenamed", [["old": was, "path": String(now), "oldReal": was, "real": String(now), "name": Lib.name(String(now))]])
        }
        rescan()
        sendTabs()
    }

    /// → what went to the Trash, and where the Trash keeps it (for Undo)
    @discardableResult func trashPaths(_ paths: [String]) -> [(String, URL?)] {
        guard let folder else { return [] }
        var going: [(String, String, Bool)] = []   // (as named, as it is, a folder)
        for p in paths {
            let isDir = Lib.isDir(p) && p.hasPrefix(folder + "/") && p != folder
            if !isDir && !knows(p) { continue }
            going.append((p, Lib.resolve(p), isDir))
        }
        if going.isEmpty { return [] }
        func gone(_ q: String, _ list: [(String, String, Bool)]) -> Bool { list.contains { q == $0.1 || ($0.2 && q.hasPrefix($0.1 + "/")) } }
        let wasCurrent = path.map { gone($0, going) } ?? false
        var next: String?
        if wasCurrent, let t = tree {
            let notes = collectNotes(t).compactMap { $0["real"] as? String }
            if let i = notes.firstIndex(where: { $0 == path }) {
                let stays = { (n: String) in !gone(n, going) }
                next = notes[(i + 1)...].first(where: stays) ?? notes[..<i].reversed().first(where: stays)
            }
        }
        var done: [(String, String, Bool)] = [], kept: [(String, URL?)] = []
        for g in going {
            var into: NSURL?
            do { try Lib.fm.trashItem(at: URL(fileURLWithPath: g.0), resultingItemURL: &into); done.append(g); kept.append((g.0, into as URL?)) }
            catch { toast("Couldn't move “\(Lib.name(g.0))” to Trash: \(error.localizedDescription)") }
        }
        if done.isEmpty { return [] }
        back.removeAll { gone($0, done) }; fwd.removeAll { gone($0, done) }
        if let d = dirTab, gone(d, done) { dirTab = nil }
        if !tabs.isEmpty {
            stashTab()
            let shown = tabs[tab].id
            for i in tabs.indices { tabs[i].back.removeAll { gone($0, done) }; tabs[i].fwd.removeAll { gone($0, done) } }
            tabs.removeAll { $0.id != shown && ($0.path.map { gone($0, done) } ?? false) }
            tab = tabs.firstIndex { $0.id == shown } ?? 0
            closedTabs.removeAll { gone($0.0, done) }
        }
        for d in done { keptDirs.remove(d.0); filesMoved(folder: folder, old: d.0, new: nil) }
        did(.trashed(kept))
        toast(done.count == 1 ? "Moved “\(Lib.name(done[0].0))” to Trash" : "Moved \(done.count) items to Trash")
        let currentGone = path.map { gone($0, done) } ?? false
        rescan()
        if !currentGone { sendTabs() }
        else if let next { openPath(next, push: false) } else { showNothing() }
        return kept
    }

    func sidebarPref(_ msg: [String: Any]) {
        if let w = msg["width"] {
            if let n = (w as? NSNumber)?.doubleValue ?? (w as? String).flatMap(Double.init) { store.state["sidebar_width"] = Int(min(max(n, 180), 640)) }
            if let v = msg["visible"] { store.state["sidebar"] = truthy(v) }
            return store.save()
        }
        if let v = msg["visible"] { store.state["sidebar"] = truthy(v) }
        guard let titles = msg["titles"] else {
            store.save()
            return AppDelegate.shared.eachWindow { $0.sendFolder() }
        }
        store.state["sidebar_titles"] = truthy(titles)
        store.save()
        rescan()
        AppDelegate.shared.eachWindow { if $0 !== self { $0.rescan() } }
    }

    // MARK: watching the files (FSEvents)

    func watch() {
        if gone { return }
        var want = dirWatch
        if let p = path { want.insert(Lib.dir(p)) }
        want.formUnion(boardDirs)
        guard want != watchedRoots else { return }
        watchedRoots = want
        stopStream()
        guard !want.isEmpty else { return }
        var ctx = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let cb: FSEventStreamCallback = { _, info, n, paths, _, _ in
            guard let info else { return }
            let me = Unmanaged<NoteWindow>.fromOpaque(info).takeUnretainedValue()
            let list = Unmanaged<CFArray>.fromOpaque(paths).takeUnretainedValue() as! [String]
            DispatchQueue.main.async { me.onFS(Array(list.prefix(n))) }
        }
        let flags = UInt32(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        guard let s = FSEventStreamCreate(nil, cb, &ctx, Array(want) as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.15, flags) else { return }
        stream = s
        FSEventStreamSetDispatchQueue(s, .main)
        FSEventStreamStart(s)
    }

    func stopStream() {
        if let s = stream { FSEventStreamStop(s); FSEventStreamInvalidate(s); FSEventStreamRelease(s); stream = nil }
    }

    func stopWatching() { stopStream(); watchedRoots = [] }

    func onFS(_ paths: [String]) {
        if gone { return }
        let real = paths.map { Lib.resolve($0) }
        for p in paths { touch(p) } // (a change in a project: its snapshot follows once it is quiet)
        for p in paths where Lib.isBoard(p) && Lib.isFile(p) { js("MdView.boardChanged", [p]) }
        if let cur = path, paths.contains(cur) || real.contains(cur) {
            // editors save by delete + rename; wait for the dust to settle
            reloadItem?.cancel()
            let item = DispatchWorkItem { [weak self] in self?.reloadAfterChange() }
            reloadItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.09, execute: item)
        }
        if folder != nil, paths.contains(where: { dirWatch.contains($0) || dirWatch.contains(Lib.dir($0)) }) {
            rescanItem?.cancel()
            let item = DispatchWorkItem { [weak self] in self?.rescanQuietly() }
            rescanItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: item)
        }
    }

    func reloadAfterChange() {
        guard let p = path, Lib.exists(p) else { return }
        if let own = ownWrite {
            ownWrite = nil
            if Lib.fm.contents(atPath: p) == own { return }   // already on screen
        }
        if editing, let own = ownText, let now = Lib.read(p), now.replacingOccurrences(of: "\r\n", with: "\n") == own { return }
        newResolver()
        render(keepScroll: true)
    }
}
