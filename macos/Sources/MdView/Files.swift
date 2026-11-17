// Files (area A): what is done to the files of the folder from its list and All Notes — copy, cut, paste,
// duplicate, import, hide, folder looks, the history of these steps (undo), pictures and files put into a note,
// files dropped on a window, "open with", the clipboard. Rust originals: shell/files.rs, shell/undo.rs, hidden.rs,
// looks.rs, attach.rs (FilesStores.swift), shell/folder.rs (hide … add_files), host.rs (clipboard: FilesWeb.swift).
import AppKit
import UniformTypeIdentifiers

/// What was done to files, so it can be taken back (shell/undo.rs).
enum UndoStep {
    case made([String])
    case moved([(String, String)], String)   // (old, new) pairs, "rename" | "move"
    case trashed([(String, URL?)])           // (where it stood, where the Trash keeps it)
    case hidden([String], Bool)              // what was hidden (true) or shown again (false)
}

final class FilesState {
    var undo: [(UndoStep, Date)] = []
    var redo: [UndoStep] = []
    var replaying = false
    /// Copy / Cut in the folder's list, remembered for Paste in any window.
    static var clip: ([String], Bool) = ([], false)
}

let imageExt: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"]
private let filesBoardMark = "<metadata id=\"mdview-board\">"

/// The files the application made for notes (attach.rs).
func attachments() -> Attachments { Attachments.shared }

/// urllib's quote: what it leaves as it is — letters, digits and `_ . - ~ /`.
func quotePath(_ s: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "_.-~/")
    return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
}

/// The file an address names — ours (md://localhost/file/…) or file:// — and its fragment (shell.rs `url_file`).
func fileOfURL(_ href: String) -> (String, String?)? {
    guard let u = URL(string: href) else { return nil }
    let frag = u.fragment?.removingPercentEncoding.flatMap { $0.isEmpty ? nil : $0 }
    if u.scheme == "md" {
        guard u.path.hasPrefix("/file") else { return nil }
        return (String(u.path.dropFirst(5)), frag)
    }
    if u.scheme == "file" { return (u.path, frag) }
    return nil
}

/// Dots and double dots taken out of a path.
func normalizePath(_ p: String) -> String {
    var out: [Substring] = []
    for c in p.split(separator: "/", omittingEmptySubsequences: true) {
        if c == "." { continue }
        if c == ".." { if !out.isEmpty { out.removeLast() }; continue }
        out.append(c)
    }
    return "/" + out.joined(separator: "/")
}

func isUnder(_ p: String, _ dir: String) -> Bool { p == dir || p.hasPrefix(dir.hasSuffix("/") ? dir : dir + "/") }

extension NoteWindow {
    // MARK: what core calls

    /// Core calls this after it did something to files.
    func did(_ step: UndoStep) {
        let s = filesS
        if s.replaying { return }
        s.redo.removeAll()
        let now = Date()
        // moves that come one right after the other are one step: the page sends a move for each of several things dragged
        if case .moved(let more, "move") = step, let last = s.undo.last, case .moved(let had, "move") = last.0, now.timeIntervalSince(last.1) < 1.5 {
            s.undo[s.undo.count - 1] = (.moved(had + more, "move"), now)
            return
        }
        s.undo.append((step, now))
        if s.undo.count > 100 { s.undo.removeFirst() }
    }

    /// A new note named after its title by the app (settleFresh): no step of its own — the step that made it makes it under
    /// the name it has now. (Core may call this after the rename that settles a fresh note.)
    func filesNamed(old: String, new: String) {
        let s = filesS
        if let last = s.undo.last, case .moved(let p, "rename") = last.0, p.count == 1, p[0].0 == old, p[0].1 == new { s.undo.removeLast() }
        let swap = { (p: String) in p == old ? new : p }
        let each = { (step: UndoStep) -> UndoStep in
            switch step {
            case .moved(let pairs, let how): return .moved(pairs.map { (swap($0.0), swap($0.1)) }, how)
            case .trashed(let p): return .trashed(p.map { (swap($0.0), $0.1) })
            case .made(let p): return .made(p.map(swap))
            case .hidden(let p, let on): return .hidden(p.map(swap), on)
            }
        }
        s.undo = s.undo.map { (each($0.0), $0.1) }
        s.redo = s.redo.map(each)
    }

    /// The paths put away by hand in this folder (.mdview/hidden.json).
    func hiddenListed(_ folder: String) -> Set<String> { Hidden.listed(folder) }
    /// … and what the application keeps for a note.
    func attachmentsOwned() -> Set<String> { attachments().owned() }
    /// A folder's colours and signs, for MdView.setFolder.
    func looksListed(_ folder: String) -> Any { Looks.listed(folder) }
    /// A path of this folder moved: its hidden mark and its look go along.
    func filesMoved(folder: String, old: String, new: String?) {
        Hidden.moved(folder, old, new)
        if let new, Lib.isDir(new) { Looks.moved(folder, old, new) }
    }

    // MARK: the messages

    func handleFiles(_ type: String, _ msg: [String: Any]) -> Bool {
        let str = { (k: String) in msg[k] as? String ?? "" }
        switch type {
        case "dropfiles": dropFiles(msg["uris"] as? [String] ?? [], note: msg["path"] as? String)
        case "pickfiles": pickAttach(pictures: (msg["kind"] as? String) == "image", note: str("path"))
        case "pasteimage": pasteImage(path: msg["path"] as? String, append: truthy(msg["append"]))
        case "pasteclip": js("MdView.pasteClip", [["text": Clip.text() ?? "", "html": Clip.html()]])
        case "pastetext": if let t = Clip.text() { js("MdView.pasteText", [["text": t]]) }
        case "editcmd": editCommand(str("cmd"))
        case "copyimage": copyImage(str("src"))
        case "fileop": fileOp(str("op"), str("path"))
        case "folderlook": folderLook(msg)
        case "untrash": untrash()
        case "fileundo": fileStep(back: true)
        case "fileredo": fileStep(back: false)
        case "hide": hideFiles(msg["paths"], on: (msg["on"] as? Bool) ?? true)
        case "copyfiles": copyFiles(msg["paths"], cut: truthy(msg["cut"]))
        case "pastefiles": pasteFiles(wanted: msg["dir"] as? String)
        case "duplicate": duplicateFiles(msg["paths"])
        case "import": importFiles(msg["uris"] as? [String] ?? [], wanted: msg["dir"] as? String)
        case "addfiles": addFiles(wanted: msg["dir"] as? String)
        default: return false
        }
        return true
    }

    private func pathList(_ v: Any?) -> [String] { (v as? [Any] ?? []).compactMap { $0 as? String } }

    /// A file of the window's folder, or a folder in it.
    func knowsAny(_ folder: String, _ p: String) -> Bool { knows(p) || (Lib.isDir(p) && p.hasPrefix(folder + "/")) }

    /// Every window that shows this folder looks at it again.
    private func rescanFolderWindows(_ folder: String) {
        rescan()
        AppDelegate.shared.eachWindow { if $0 !== self && $0.folder == folder { $0.rescan() } }
    }

    // MARK: hide, copy, paste, duplicate, import

    func hideFiles(_ v: Any?, on: Bool) {
        guard let folder else { return }
        let paths = pathList(v).filter { knowsAny(folder, $0) }
        if paths.isEmpty { return }
        do {
            try Hidden.set(folder, paths, on: on)
            did(.hidden(paths, on))
            if on && !truthy(store.prefs["showHidden"]) {
                let said = paths.count == 1 ? "“\(Lib.name(paths[0]))” is hidden" : "\(paths.count) items are hidden"
                js("MdView.toast", [said, ["label": "Undo", "type": "hide", "data": ["paths": paths, "on": false] as [String: Any]] as [String: Any]])
            }
        } catch { toast("Couldn't hide it: \(error.localizedDescription)") }
        rescanFolderWindows(folder)
    }

    /// Copy or Cut in the folder's list: remembered for Paste (in any window), and put on the system's clipboard as the
    /// files' paths, a line each.
    func copyFiles(_ v: Any?, cut: Bool) {
        guard let folder else { return }
        let paths = pathList(v).filter { knowsAny(folder, $0) }
        if paths.isEmpty { return }
        Clip.setText(paths.joined(separator: "\n"))
        let said: String
        switch (paths.count, cut) {
        case (1, false): said = "Copied “\(Lib.name(paths[0]))”"
        case (1, true): said = "Cut “\(Lib.name(paths[0]))”: Paste moves it"
        case (let n, false): said = "Copied \(n) items"
        case (let n, true): said = "Cut \(n) items: Paste moves them"
        }
        FilesState.clip = (paths, cut)
        toast(said)
    }

    /// Paste into a folder of the window's: what was copied here is copied there (cut: moved), and what the system's
    /// clipboard names as files — copied in Finder — comes in too.
    func pasteFiles(wanted: String?) {
        guard let folder else { return }
        let into = targetDir(folder, wanted)
        var (from, cut) = FilesState.clip
        let clip = Clip.text() ?? ""
        var named = clip.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            .map { fileOfURL($0)?.0 ?? $0 }
        func usable(_ n: [String]) -> Bool { !n.isEmpty && n.count <= 500 && n.allSatisfy { $0.hasPrefix("/") && Lib.exists($0) } }
        if !usable(named) {
            let finder = Clip.fileURLs()
            if usable(finder) { named = finder }
        }
        let files = usable(named)
        // (the clipboard says something else by now: that is what is pasted — files it names, or nothing)
        if files && named != from { (from, cut) = (named, false) }
        else if !files && !from.isEmpty && clip != from.joined(separator: "\n") { from.removeAll() }
        from = from.filter { Lib.exists($0) }
        if from.isEmpty { return toast("No files to paste") }
        if cut {
            FilesState.clip = ([], false)
            for p in from where Lib.dir(p) != into { moveTo(p, into) }
            return
        }
        bringIn(from, into: into, how: "Pasted")
    }

    /// Files and folders copied into a folder of the window's, under names that are free there ("Name 2.pdf").
    @discardableResult func bringIn(_ from: [String], into: String, how: String) -> [String] {
        var made: [String] = []
        for src in from {
            if Lib.isDir(src) && isUnder(into, src) { toast("“\(Lib.name(src))” can't be copied into itself"); continue }
            do { made.append(try Lib.copyFree(src, into: into, copy: false)) }
            catch { toast("Couldn't copy “\(Lib.name(src))”: \(error.localizedDescription)") }
        }
        if made.isEmpty { return made }
        for d in made where Lib.isDir(d) { keptDirs.insert(d) }
        did(.made(made))
        toast(made.count == 1 ? "\(how) “\(Lib.name(made[0]))”" : "\(how) \(made.count) items")
        touch(into)
        rescan()
        js("MdView.revealRows", [made])
        return made
    }

    /// A copy beside the thing itself: "Name copy.md", "Name copy 2.md".
    func duplicateFiles(_ v: Any?) {
        guard let folder else { return }
        var made: [String] = []
        for src in pathList(v).filter({ knowsAny(folder, $0) }) {
            do { made.append(try Lib.copyFree(src, into: Lib.dir(src), copy: true)) }
            catch { toast("Couldn't duplicate “\(Lib.name(src))”: \(error.localizedDescription)") }
        }
        if made.isEmpty { return }
        for d in made where Lib.isDir(d) { keptDirs.insert(d) }
        did(.made(made))
        touch(folder)
        rescan()
        js("MdView.revealRows", [made])
    }

    /// Files and folders from elsewhere — dropped on the folder's list, or chosen in the system's own window (Add Files…) —
    /// copied into a folder of the window's. What lies in the window's folder already is moved there instead: it was pulled
    /// from one place of it to another.
    func importFiles(_ uris: [String], wanted: String?) {
        guard let folder else { return }
        let into = targetDir(folder, wanted)
        let from = Array(uris.compactMap { fileOfURL($0)?.0 }.filter { Lib.exists($0) }.prefix(500))
        let inside = from.filter { isUnder(Lib.resolve($0), folder) }, outside = from.filter { !isUnder(Lib.resolve($0), folder) }
        for p in inside where Lib.dir(p) != into { moveTo(p, into) }
        if !outside.isEmpty { bringIn(outside, into: into, how: "Added") }
    }

    /// Add Files…: chosen in the system's own window, then as files dropped on the list.
    func addFiles(wanted: String?) {
        guard let folder else { return }
        let into = targetDir(folder, wanted)
        let panel = NSOpenPanel()
        panel.title = "Add Files to “\(Lib.name(into))”"
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK, !panel.urls.isEmpty else { return }
            self?.importFiles(panel.urls.map { $0.absoluteString }, wanted: into)
        }
    }

    func folderLook(_ msg: [String: Any]) {
        let dir = msg["path"] as? String ?? ""
        guard let folder, Lib.isDir(dir), dir.hasPrefix(folder + "/") else { return }
        do {
            try Looks.set(folder, dir, color: msg["color"] as? String ?? "", icon: msg["icon"] as? String ?? "", fav: (msg["fav"] as? Bool) ?? false)
            sendFolder()
        } catch { toast("Couldn't keep the folder's look: \(error.localizedDescription)") }
    }

    // MARK: open with, show in Finder

    func fileOp(_ op: String, _ path: String) {
        let inside = !path.isEmpty && folder.map { Lib.isDir(path) && isUnder(Lib.resolve(path), $0) } ?? false
        if path.isEmpty || !(knows(path) || (op == "reveal" && inside)) { return }
        let url = URL(fileURLWithPath: path)
        switch op {
        case "default": NSWorkspace.shared.open(url)
        case "openwith":
            let panel = NSOpenPanel()
            panel.title = "Open With"
            panel.message = "Choose the application to open “\(Lib.name(path))” with"
            panel.directoryURL = URL(fileURLWithPath: "/Applications")
            panel.allowedContentTypes = [.applicationBundle]
            panel.canChooseDirectories = false
            panel.beginSheetModal(for: window) { r in
                guard r == .OK, let app = panel.url else { return }
                NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
            }
        case "reveal": NSWorkspace.shared.activateFileViewerSelecting([url])
        default: break
        }
    }

    // MARK: the clipboard

    /// The page's text menu: the command runs where the focus is, as the key would.
    func editCommand(_ cmd: String) {
        let sel: String
        switch cmd {
        case "Cut": sel = "cut:"
        case "Copy": sel = "copy:"
        case "Paste": sel = "paste:"
        case "SelectAll": sel = "selectAll:"
        default: return
        }
        window.makeFirstResponder(web)
        NSApp.sendAction(Selector(sel), to: web, from: nil)
    }

    /// A picture of the note, by its file, onto the clipboard.
    func copyImage(_ src: String) {
        guard let (p, _) = fileOfURL(src) else { return toast("Only pictures in files can be copied") }
        if !Clip.copyImage(file: foundAsset(p)) { toast("Couldn't copy the picture") }
    }

    // MARK: undo (shell/undo.rs)

    /// What a step did, in a few words: "Move of “Note”", "Move of 3 items".
    private func said(_ step: UndoStep) -> String {
        let verb: String, paths: [String]
        switch step {
        case .moved(let p, "rename"): verb = "Rename of"; paths = p.map { $0.0 }
        case .moved(let p, _): verb = "Move of"; paths = p.map { $0.0 }
        case .trashed(let p): verb = "Move to Trash of"; paths = p.map { $0.0 }
        case .made(let p): verb = "Making of"; paths = p
        case .hidden(let p, true): verb = "Hiding of"; paths = p
        case .hidden(let p, false): verb = "Showing of"; paths = p
        }
        return paths.count == 1 ? "\(verb) “\(Lib.name(paths[0]))”" : "\(verb) \(paths.count) items"
    }

    /// Ctrl+Z (back) or Ctrl+Shift+Z: the last step taken back, or the last taken back done again.
    func fileStep(back isBack: Bool) {
        let s = filesS
        let step: UndoStep? = isBack ? s.undo.popLast()?.0 : s.redo.popLast()
        guard let step else { return toast(isBack ? "Nothing to undo" : "Nothing to redo") }
        let text = said(step)
        s.replaying = true
        let undone = undoStep(step)
        s.replaying = false
        // (what could not be taken back is gone from the history: the toast that said why stands)
        guard let undone else { return }
        if isBack { s.redo.append(undone) } else { s.undo.append((undone, Date())) }
        toast("\(isBack ? "Undid" : "Redid") \(text)")
    }

    /// One step taken back → the step that takes that back in turn (nil: it could not be).
    private func undoStep(_ step: UndoStep) -> UndoStep? {
        guard let folder else { return nil }
        let exists = { (p: String) in (try? Lib.fm.attributesOfItem(atPath: p)) != nil }
        switch step {
        case .moved(let pairs, let how):
            var back: [(String, String)] = []
            for (from, to) in pairs.reversed() {
                if !exists(to) { continue }
                relocate(folder, to, from, how)
                if exists(from) { back.append((to, from)) }
            }
            back.reverse()
            return back.isEmpty ? nil : .moved(back, how)
        case .trashed(let paths):
            guard let back = restoreFromTrash(paths) else { return nil }
            return .made(back)
        case .made(let paths):
            let there = paths.filter(exists)
            if there.isEmpty { toast("It is no longer there"); return nil }
            let gone = trashPaths(there)
            return gone.isEmpty ? nil : .trashed(gone)
        case .hidden(let paths, let on):
            do { try Hidden.set(folder, paths, on: !on) } catch { toast("Couldn't change it: \(error.localizedDescription)"); return nil }
            rescanFolderWindows(folder)
            return .hidden(paths, !on)
        }
    }

    /// Files and folders put in the Trash taken out again, where they stood: the very item the Trash made of each — never
    /// another one of a name like it. → what came back (nil: nothing could, and the toast says why)
    func restoreFromTrash(_ wanted: [(String, URL?)]) -> [String]? {
        var back: [String] = []
        for (p, kept) in wanted {
            guard let kept, Lib.exists(kept.path) else { continue }
            if Lib.exists(p) { toast("“\(Lib.name(p))” is there again: not put back"); continue }
            do {
                try Lib.fm.createDirectory(atPath: Lib.dir(p), withIntermediateDirectories: true)
                try Lib.fm.moveItem(at: kept, to: URL(fileURLWithPath: p))
                back.append(p)
            } catch { toast("Couldn't put it back: \(error.localizedDescription)") }
        }
        if back.isEmpty { if wanted.allSatisfy({ !Lib.exists($0.0) }) { toast("It is no longer in the Trash") }; return nil }
        for p in back where Lib.isDir(p) { keptDirs.insert(p) }   // (a folder that was empty is listed again)
        rescan()
        return back
    }

    /// The trash's own Undo: the last step, if it was a move to the Trash, taken back.
    func untrash() {
        if let last = filesS.undo.last, case .trashed = last.0 { fileStep(back: true) }
    }

    // MARK: what is put beside a note (shell/files.rs)

    /// A note's base folder: the one folder whose `assets` holds what is put into its notes, whatever subfolder they are in —
    /// the root of the project the note is in (history.rs), else the window's folder, else (a note opened by itself) the
    /// folder the note lies in.
    func baseOf(_ note: String) -> String {
        var d = Lib.dir(note)
        while d.count > 1 {
            if Lib.exists(Lib.join(d, ".git")) {
                if Lib.isFile(Lib.join(d, ".mdview/project.json")) { return d }
                break   // (a foreign repository: no project)
            }
            d = Lib.dir(d)
        }
        if let f = folder, isUnder(note, f) { return f }
        return Lib.dir(note)
    }

    /// Where the settings put what is pasted into a note (`images`), outside a vault.
    private func keptIn(_ note: String, _ base: String, _ wanted: String) -> String {
        let beside = Lib.dir(note), w = wanted.trimmingCharacters(in: .whitespaces)
        if ["", "beside", "."].contains(w) { return beside }
        if w == Lib.assets { return Lib.join(base, Lib.assets) }
        var rel = w
        while rel.hasPrefix("/") { rel.removeFirst() }
        let d = normalizePath(Lib.join(beside, rel))
        return isUnder(d, beside) ? d : beside
    }

    /// Where a pasted image goes: the base folder's `assets` — one place for the notes of every subfolder —, or beside the
    /// note, or in a folder relative to it, as the settings say; or wherever the Obsidian vault keeps its attachments.
    func attachmentDir(_ note: String, vault: String?) -> String {
        let beside = Lib.dir(note)
        // A folder of notes of its own that lies inside a vault: what is pasted stays in that folder, where the settings say.
        var vault = vault
        if let v = vault, let f = folder, f != v, f.hasPrefix(v + "/") { vault = nil }
        guard let vault else { return keptIn(note, baseOf(note), (store.prefs["images"] as? String) ?? Lib.assets) }
        let conf = (try? JSONSerialization.jsonObject(with: Lib.fm.contents(atPath: Lib.join(vault, ".obsidian/app.json")) ?? Data())) as? [String: Any]
        guard let c = (conf?["attachmentFolderPath"] as? String), !c.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty else { return vault }
        let d = normalizePath(c.hasPrefix("./") ? Lib.join(beside, String(c.dropFirst(2))) : Lib.join(vault, c))
        return isUnder(d, vault) ? d : vault
    }

    /// How a note names a file: the way to it from the note's folder — but what lies in the base folder's `assets` is
    /// `assets/x.png` in a note of any subfolder: the same words wherever the note is moved.
    func wayTo(_ target: String, _ note: String) -> String {
        if Lib.dir(target) == Lib.join(baseOf(note), Lib.assets) { return "\(Lib.assets)/\(Lib.name(target))" }
        return Lib.relative(target, Lib.dir(note))
    }

    func imageMarkup(_ target: String, _ note: String, vault: Bool) -> String {
        vault ? "![[\(Lib.name(target))]]" : "![](\(quotePath(wayTo(target, note))))"
    }

    /// After a save from the active mode: a picture or file the application put beside the note, which the note no longer
    /// names (nor any other note), goes to the Trash; one that is named again is put back, and the page shows it again.
    /// (Core calls this after a save with `exact`.)
    func tidyAttachments(_ text: String?) {
        guard let note = path, !Lib.shownAsPDF(note), let text else { return }
        let base = baseOf(note)
        let root = resolver?.vault ?? folder.flatMap { isUnder(base, $0) ? $0 : nil } ?? base
        let grace = ProcessInfo.processInfo.environment["MDVIEW_ATTACH_GRACE"].flatMap(UInt64.init) ?? Attachments.graceSecs
        // What a whiteboard of the note names — the pictures put on it — the note names too: the board's own lines are read along.
        var full = text
        for b in attachments().ownedBy(note) where Lib.isBoard(b) && Attachments.mentions(text, Lib.name(b)) {
            guard let t = Lib.read(b), let a = t.range(of: filesBoardMark) else { continue }
            let tail = t[a.lowerBound...]
            full += "\n" + String(tail[..<(tail.range(of: "]]>")?.lowerBound ?? tail.endIndex)])
        }
        let done = attachments().tidy(note: note, text: full, root: root, now: UInt64(Date().timeIntervalSince1970), grace: grace) { p in
            (try? Lib.fm.trashItem(at: URL(fileURLWithPath: p), resultingItemURL: nil)) != nil
        }
        if !done.restored.isEmpty { js("MdView.filesBack", [done.restored.map { Lib.name($0) }]) }
    }

    /// Save the clipboard image as a file and embed it: the page inserts the Markdown at the caret (editing), or it goes to
    /// the end of the note (reading).
    func pasteImage(path at: String?, append: Bool) {
        guard let note = path, at == note, let (data, ext) = Clip.image() else { return }
        var old = Data()
        if append {
            guard let o = Lib.fm.contents(atPath: note) else { return toast("Couldn't add image: can't read the note") }
            old = o
            if !Lib.fm.isWritableFile(atPath: note) { return toast("Can't edit: file is read-only") }
        }
        let vault = resolver?.vault
        let df = DateFormatter()
        df.dateFormat = vault != nil ? "'Pasted image 'yyyyMMddHHmmss" : "'pasted-'yyyyMMdd-HHmmss"
        let stem = df.string(from: Date())
        let dir = attachmentDir(note, vault: vault)
        let target: String
        do { target = try Lib.writeNew(dir, tries: 100, data: data) { $0 == 1 ? "\(stem)\(ext)" : "\(stem)-\($0)\(ext)" } }
        catch { return toast("Couldn't save image: \(error.localizedDescription)") }
        let markup = imageMarkup(target, note, vault: vault != nil)
        if !append {
            attachments().own(target, note)
            return js("MdView.insertImage", [["path": note, "markup": markup]])
        }
        let crlf = old.range(of: Data("\r\n".utf8)) != nil
        let nl = Data((crlf ? "\r\n" : "\n").utf8)
        var end = old.count
        while end > 0, old[old.startIndex + end - 1] == 10 || old[old.startIndex + end - 1] == 13 { end -= 1 }
        var new = Data(old.prefix(end))
        if !new.isEmpty { new.append(nl); new.append(nl) }
        new.append(Data(markup.utf8)); new.append(nl)
        do { try Lib.writeWhole(note, new) } catch {
            toast("Couldn't save: \(error.localizedDescription)")
            try? Lib.fm.removeItem(atPath: target)
            return
        }
        ownWrite = new
        newResolver()
        render(toEnd: true)
    }

    /// Files dropped on the document: one inside the note's folder is linked where it is, any other is copied where pasted
    /// pictures go. A picture is put in as a picture, any other file as a block that names it; the page inserts the
    /// Markdown where they were dropped (insertDropped).
    func dropFiles(_ uris: [String], note at: String?) {
        guard let note = path, at == note else { return }
        let vault = resolver?.vault
        let beside = Lib.resolve(Lib.dir(note))
        var markups: [String] = [], skipped = 0
        for uri in uris {
            guard let src = fileOfURL(uri)?.0, !Lib.name(src).isEmpty, Lib.isFile(src) else { skipped += 1; continue }   // (a folder, or nothing that is there)
            let picture = imageExt.contains(Lib.ext(src))
            // (a picture as a picture; any other file as a link alone in its paragraph: a file block)
            let markup = { (target: String) -> String in
                picture ? self.imageMarkup(target, note, vault: vault != nil)
                    : "[\(Lib.name(target).replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]"))](\(quotePath(self.wayTo(target, note))))"
            }
            // (… as is a file of the window's folder, wherever in it: a row pulled from its list into the note)
            if isUnder(Lib.resolve(src), beside) || (folder.map { isUnder(Lib.resolve(src), $0) } ?? false) { markups.append(markup(Lib.resolve(src))); continue }
            do {
                let data = try Data(contentsOf: URL(fileURLWithPath: src))
                let (stem, e) = ((Lib.name(src) as NSString).deletingPathExtension, (src as NSString).pathExtension)
                let dot = e.isEmpty ? "" : "." + e
                let target = try Lib.writeNew(attachmentDir(note, vault: vault), tries: 100, data: data) { $0 == 1 ? Lib.name(src) : "\(stem)-\($0)\(dot)" }
                attachments().own(target, note)
                markups.append(markup(target))
            } catch { toast("Couldn't copy the file: \(error.localizedDescription)") }
        }
        if skipped > 0 && markups.isEmpty { toast("Only files can be dropped here") }
        if !markups.isEmpty { js("MdView.insertDropped", [["path": note, "markups": markups]]) }
    }

    /// A picture, or any files, chosen in the system's own window to stand in the note (Insert › Picture, File): what is
    /// chosen comes in as files dropped on the note do.
    func pickAttach(pictures: Bool, note: String) {
        let panel = NSOpenPanel()
        panel.title = pictures ? "Insert Picture" : "Insert File"
        panel.allowsMultipleSelection = true
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        if pictures { panel.allowedContentTypes = imageExt.compactMap { UTType(filenameExtension: $0) } }
        panel.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK, !panel.urls.isEmpty else { return }
            self?.dropFiles(panel.urls.map { $0.absoluteString }, note: note)
        }
    }
}
