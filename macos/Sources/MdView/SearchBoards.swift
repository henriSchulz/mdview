// Whiteboards (board.js): a board for a note, a board's text for the page and back, pictures put on it, the
// folder's boards for All Notes, and what is drawn on a PDF. Rust: shell/files.rs (board_*, ink_*), shell/folder.rs
// (new_board, send_boards, board_free), attach.rs (owner, own, disown — the same attachments.json).
import AppKit
import CryptoKit
import UniformTypeIdentifiers

let boardMark = "<metadata id=\"mdview-board\">"

/// The files the application put beside notes (attach.rs, the part boards need): attachments.json beside state.json.
enum SearchAttach {
    static var file: URL { Store.shared.dir.appendingPathComponent("attachments.json") }
    static func load() -> [String: Any] {
        (try? Data(contentsOf: file)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    }
    static func save(_ all: [String: Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: all) { try? d.write(to: file, options: .atomic) }
    }
    /// The application made this file for that note.
    static func own(_ f: String, note: String) { var a = load(); a[f] = ["note": note]; save(a) }
    /// The note the application made this file for, if it did.
    static func owner(_ f: String) -> String? {
        guard let v = load()[f] as? [String: Any], v["gone"] == nil else { return nil }
        return v["note"] as? String
    }
    /// The file is its own from now on — a file of the folder like any other.
    static func disown(_ f: String) { var a = load(); if a.removeValue(forKey: f) != nil { save(a) } }
}

func searchQuote(_ s: String) -> String {
    let ok = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~/")
    return s.addingPercentEncoding(withAllowedCharacters: ok) ?? s
}

/// A new file in folder, named by name(1), name(2) … — the first that is free; one that is there is never overwritten.
func searchWriteNew(_ folder: String, tries: Int = 100, data: Data, name: (Int) -> String) throws -> String {
    try Lib.fm.createDirectory(atPath: folder, withIntermediateDirectories: true)
    for n in 1..<tries {
        let target = Lib.join(folder, name(n))
        let fd = open(target, O_WRONLY | O_CREAT | O_EXCL, 0o644)
        if fd >= 0 {
            let h = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
            do { try h.write(contentsOf: data) } catch { try? Lib.fm.removeItem(atPath: target); throw error }
            return target
        }
        if errno != EEXIST { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    }
    throw POSIXError(.EEXIST)
}

/// Every file below dir — names with a dot and what is built left out, as the folder's list does.
private func searchEachFile(_ dir: String, _ depth: Int, _ f: (String) -> Void) {
    for name in (try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? [] where !name.hasPrefix(".") {
        let p = Lib.join(dir, name)
        if Lib.isDir(p) { if depth < 12 && !Lib.skipDirs.contains(name) { searchEachFile(p, depth + 1, f) } }
        else if Lib.isFile(p) { f(p) }
    }
}

/// A notebook: a whiteboard whose head says how its paper is (board/paper.js).
private func searchIsNotebook(_ path: String) -> Bool {
    guard let head = Lib.read(path, limit: 4096), let r = head.range(of: "<![CDATA[") else { return false }
    let lines = head[r.lowerBound...].components(separatedBy: "\n")
    return lines.count > 1 && lines[1].hasPrefix("{\"board\"") && lines[1].contains("\"paper\":{")
}

/// Does the note's text name the file? (as it is, or as an address writes it: %20 for a space)
private func searchMentions(_ text: String, _ name: String) -> Bool {
    !name.isEmpty && (text.contains(name) || (text.removingPercentEncoding ?? text).contains(name))
}

extension NoteWindow {
    // MARK: where what is put beside a note goes (shell/files.rs: base_of, attachment_dir, kept_in, way_to)

    /// A note's base folder: the one folder whose `assets` holds what is put into its notes — the root of the project
    /// the note is in, else the window's folder, else (a note opened by itself) the folder the note lies in.
    func searchBase(_ note: String) -> String {
        var d = Lib.dir(note)
        while d != "/" && !d.isEmpty {
            if Lib.exists(Lib.join(d, ".git")) {
                if Lib.isFile(Lib.join(d, ".mdview/project.json")) { return d }
                break
            }
            d = Lib.dir(d)
        }
        if let f = folder, note.hasPrefix(f + "/") { return f }
        return Lib.dir(note)
    }

    private func searchKeptIn(_ note: String, _ base: String, _ wanted: String) -> String {
        let beside = Lib.dir(note), w = wanted.trimmingCharacters(in: .whitespaces)
        if ["", "beside", "."].contains(w) { return beside }
        if w == Lib.assets { return Lib.join(base, Lib.assets) }
        var rel = w
        while rel.hasPrefix("/") { rel.removeFirst() }
        let d = URL(fileURLWithPath: Lib.join(beside, rel)).standardized.path
        return d == beside || d.hasPrefix(beside + "/") ? d : beside
    }

    /// Where a pasted image goes: the base folder's `assets`, or beside the note, or in a folder relative to it, as the
    /// settings say; or wherever the Obsidian vault keeps its attachments (default: the vault root).
    func searchAttachmentDir(_ note: String) -> String {
        var vault = resolver?.vault
        // (a folder of notes of its own inside a vault: what is pasted stays in that folder)
        if let v = vault, let f = folder, f != v, f.hasPrefix(v + "/") { vault = nil }
        guard let vault else { return searchKeptIn(note, searchBase(note), (store.prefs["images"] as? String) ?? Lib.assets) }
        let conf = (Lib.fm.contents(atPath: Lib.join(vault, ".obsidian/app.json"))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard let c = (conf?["attachmentFolderPath"] as? String), !c.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty else { return vault }
        let d = c.hasPrefix("./") ? URL(fileURLWithPath: Lib.join(Lib.dir(note), String(c.dropFirst(2)))).standardized.path
                                  : URL(fileURLWithPath: Lib.join(vault, c)).standardized.path
        return d == vault || d.hasPrefix(vault + "/") ? d : vault
    }

    func searchImageMarkup(_ target: String, _ note: String, vault: Bool) -> String {
        if vault { return "![[\(Lib.name(target))]]" }
        let base = searchBase(note)
        let way = Lib.dir(target) == Lib.join(base, Lib.assets) ? "\(Lib.assets)/\(Lib.name(target))" : Lib.relative(target, Lib.dir(note))
        return "![](\(searchQuote(way)))"
    }

    // MARK: a whiteboard for a note, its text, pictures for it

    /// A whiteboard for the note: its file (the page wrote what an empty one holds) where the note's pictures go, the
    /// note's own from now on, and how the note names it.
    func boardNew(_ note: String, _ text: String, _ id: Any) {
        func failed(_ e: String) { js("MdView.boardMade", [["id": id, "error": e]]) }
        guard let path, !Lib.shownAsPDF(path), path == note else { return failed("another note") }
        guard text.contains(boardMark) else { return failed("not a whiteboard") }
        let vault = resolver?.vault != nil
        let df = DateFormatter(); df.dateFormat = "'board-'yyyyMMdd-HHmmss"; df.locale = Locale(identifier: "en_US_POSIX")
        let stem = df.string(from: Date())
        do {
            let target = try searchWriteNew(searchAttachmentDir(path), data: Data(text.utf8)) { $0 == 1 ? "\(stem).board.svg" : "\(stem)-\($0).board.svg" }
            SearchAttach.own(target, note: path)
            js("MdView.boardMade", [["id": id, "path": path, "markup": searchImageMarkup(target, path, vault: vault), "file": target]])
        } catch { failed(searchErr(error)) }
    }

    /// A whiteboard's text for the page (it may not read files itself).
    func boardRead(_ path: String, _ id: Any) {
        let p = foundAsset(Lib.resolve(path)) // (named as `assets/…` by a note of a subfolder: the base folder's)
        var text: String?, err: String?
        if !Lib.isBoard(p) || !Lib.isFile(p) { err = "not a whiteboard" }
        else if ((try? Lib.fm.attributesOfItem(atPath: p)[.size]) as? Int ?? 0) > 50_000_000 { err = "larger than 50 MB" }
        else if let d = Lib.fm.contents(atPath: p) { text = String(decoding: d, as: UTF8.self) }
        else { err = "Can't read file" }
        js("MdView.boardText", [id, text as Any? ?? NSNull(), err as Any? ?? NSNull()])
    }

    /// … and the board as it is to be. Only into a whiteboard that is there, and only a whiteboard's text: this is no way
    /// to write any file.
    func boardSave(_ path: String, _ text: String, _ id: Any) {
        let p = foundAsset(Lib.resolve(path))
        var err: String?
        if !Lib.isBoard(p) || !Lib.isFile(p) || !text.contains(boardMark) { err = "not a whiteboard" }
        else { do { try Lib.writeWhole(p, Data(text.utf8)) } catch { err = searchErr(error) } } // (whole, its tags kept)
        js("MdView.boardSaved", [id, err as Any? ?? NSNull()])
    }

    /// A picture from the clipboard (data and ending), if it holds one.
    private func searchClipboardImage() -> (Data, String)? {
        let pb = NSPasteboard.general
        if let d = pb.data(forType: .png), !d.isEmpty { return (d, ".png") }
        if let d = pb.data(forType: NSPasteboard.PasteboardType("public.jpeg")), !d.isEmpty { return (d, ".jpg") }
        if let d = pb.data(forType: .tiff), let rep = NSBitmapImageRep(data: d), let png = rep.representation(using: .png, properties: [:]) { return (png, ".png") }
        return nil
    }

    /// A picture from the clipboard for a whiteboard: a file beside the board's own — the note's from now on where the
    /// board is a note's, a file of the folder like the board where it is one. The page is told its name (none: the
    /// clipboard holds no picture).
    func boardPaste(_ board: String, _ id: Any) {
        func done(_ names: [String], _ e: String?) { js("MdView.boardPut", [id, names, e as Any? ?? NSNull()]) }
        let p = foundAsset(Lib.resolve(board))
        guard Lib.isBoard(p), Lib.isFile(p) else { return done([], "not a whiteboard") }
        let note = SearchAttach.owner(p)
        guard let (data, ext) = searchClipboardImage() else { return done([], nil) }
        let df = DateFormatter(); df.dateFormat = "'pasted-'yyyyMMdd-HHmmss"; df.locale = Locale(identifier: "en_US_POSIX")
        let stem = df.string(from: Date())
        do {
            let target = try searchWriteNew(Lib.dir(p), data: data) { $0 == 1 ? "\(stem)\(ext)" : "\(stem)-\($0)\(ext)" }
            if let note { SearchAttach.own(target, note: note) }
            done([Lib.name(target)], nil)
        } catch { done([], searchErr(error)) }
    }

    /// Pictures for a whiteboard, chosen in the system's own window (the board's Picture button): what is chosen comes in
    /// as files dropped on the board do.
    func boardPick(_ board: String, _ id: Any) {
        let panel = NSOpenPanel()
        panel.title = "Insert Picture"
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"].compactMap { UTType(filenameExtension: $0) }
        panel.beginSheetModal(for: window) { [weak self] r in
            guard let self else { return }
            let uris = r == .OK ? panel.urls.map { $0.absoluteString } : []
            self.boardDrop(board, uris, id)
        }
    }

    /// The file a dropped address names (file:// or the page's own md://localhost/file/…).
    private func searchURLPath(_ uri: String) -> String? {
        guard let u = URL(string: uri) else { return nil }
        if u.scheme == "file" { return u.path }
        if u.scheme == "md", u.path.hasPrefix("/file/") { return String(u.path.dropFirst(5)) }
        return nil
    }

    /// Files dropped on a whiteboard: one that lies beside the board already is used where it is, any other is copied
    /// there (a picture stands on the board as itself, any other file as a card). Notes and whiteboards are left out.
    func boardDrop(_ board: String, _ uris: [Any], _ id: Any) {
        let p = foundAsset(Lib.resolve(board))
        guard Lib.isBoard(p), Lib.isFile(p) else { return js("MdView.boardPut", [id, [String](), "not a whiteboard"]) }
        let note = SearchAttach.owner(p) // (none: a whiteboard that is a file of its own — what is put on it is the folder's too)
        let beside = Lib.dir(p)
        var names: [String] = [], failed: String?
        for uri in uris {
            guard let u = uri as? String, let src = searchURLPath(u) else { continue }
            let size = (try? Lib.fm.attributesOfItem(atPath: src)[.size]) as? Int ?? Int.max
            if !Lib.isFile(src) || Lib.isMd(src) || Lib.isBoard(src) || size > 50_000_000 { continue }
            if Lib.dir(Lib.resolve(src)) == beside { names.append(Lib.name(src)); continue }
            let stem = ((Lib.name(src)) as NSString).deletingPathExtension
            let dot = (src as NSString).pathExtension.isEmpty ? "" : "." + (src as NSString).pathExtension
            do {
                guard let data = Lib.fm.contents(atPath: src) else { throw POSIXError(.EACCES) }
                let target = try searchWriteNew(beside, data: data) { $0 == 1 ? Lib.name(src) : "\(stem)-\($0)\(dot)" }
                if let note { SearchAttach.own(target, note: note) }
                names.append(Lib.name(target))
            } catch { failed = searchErr(error) }
        }
        js("MdView.boardPut", [id, names, failed as Any? ?? NSNull()])
    }

    // MARK: whiteboards that are files of their own, and all of the folder's for All Notes

    /// A new whiteboard's file, made without asking for a name: under the first name that is free.
    private func searchBoardFree(_ into: String, _ stem: String, _ text: String) throws -> String {
        try searchWriteNew(into, tries: 1000, data: Data(text.utf8)) { $0 == 1 ? "\(stem).board.svg" : "\(stem) \($0).board.svg" }
    }

    func newBoard(name: String, wanted: String?, text: String) {
        guard let folder, text.contains(boardMark) else { return }
        let into = targetDir(folder, wanted)
        var stem = Lib.clean(name)
        for ending in [".board.svg", ".svg", ".board"] where stem.lowercased().hasSuffix(ending) {
            stem = String(stem.dropLast(ending.count)).trimmingCharacters(in: .whitespaces)
        }
        if stem.isEmpty { stem = "Whiteboard" }
        let path: String
        do { path = try searchBoardFree(into, stem, text) } catch { return toast("Couldn't create the whiteboard: \(searchErr(error))") }
        did(.made([path]))
        rescan()
        boardPaths.insert(path)
        js("MdView.revealRows", [[path]])
        js("MdView.openBoardFile", [path])
    }

    /// Every whiteboard of the folder, for All Notes: those that are files of their own and those a note keeps (which the
    /// folder's list leaves out), each with the notes that show it.
    func sendBoards() {
        guard let folder else { return }
        var boards: [String] = [], notes: [String] = []
        searchEachFile(folder, 0) { p in
            if Lib.isBoard(p) && boards.count < 2000 { boards.append(p) } else if Lib.isMd(p) && notes.count < 4000 { notes.append(p) }
        }
        var out: [[String: Any]] = boards.map { b in
            ["path": b, "name": Lib.name(b), "url": Page.fileURL(b), "mtime": Lib.mtime(b), "kept": SearchAttach.owner(b) != nil,
             "book": searchIsNotebook(b), "in": [String]()]
        }
        if !boards.isEmpty {
            for note in notes {
                guard let text = Lib.read(note, limit: 4_000_000), text.contains(".board.svg") else { continue }
                for (k, b) in boards.enumerated() where searchMentions(text, Lib.name(b)) {
                    var list = out[k]["in"] as? [String] ?? []
                    list.append(note)
                    out[k]["in"] = list
                }
            }
        }
        boardPaths = Set(boards)
        js("MdView.setBoards", [out])
    }

    /// A whiteboard a note keeps becomes a file of its own: listed in the folder, and no longer taken away with what
    /// the note no longer shows.
    func boardFree(_ path: String) {
        guard knows(path), Lib.isBoard(path) else { return }
        SearchAttach.disown(path)
        rescan()
        sendBoards()
    }

    // MARK: what is drawn on a PDF (board/pdf.js): a whiteboard's file in the base folder's .mdview/pdf, never the PDF

    /// Git's name for the file's bytes (`git hash-object`), the one the web app knows the file by too: a PDF that is
    /// moved or renamed keeps what was drawn on it.
    private func searchInkOf(_ pdf: String, _ base: String) throws -> String {
        let attr = try Lib.fm.attributesOfItem(atPath: pdf)
        let len = (attr[.size] as? UInt64) ?? UInt64((attr[.size] as? Int) ?? 0)
        let at = ((attr[.modificationDate] as? Date)?.timeIntervalSince1970) ?? 0
        let ino = (attr[.systemFileNumber] as? UInt64) ?? 0
        let name: String
        if let k = searchS.inkKnown[pdf], k.0 == len, k.1 == at, k.2 == ino { name = k.3 } else {
            guard let h = FileHandle(forReadingAtPath: pdf) else { throw POSIXError(.EACCES) }
            defer { try? h.close() }
            var sha = Insecure.SHA1()
            sha.update(data: Data("blob \(len)\0".utf8))
            while let chunk = try h.read(upToCount: 1 << 20), !chunk.isEmpty { sha.update(data: chunk) }
            name = sha.finalize().map { String(format: "%02x", $0) }.joined()
            searchS.inkKnown[pdf] = (len, at, ino, name)
        }
        return Lib.join(Lib.join(base, ".mdview/pdf"), "\(name).board.svg")
    }

    func pdfinkRead(_ path: String, _ id: Any) {
        let p = foundAsset(Lib.resolve(path))
        var text: String?, err: String?
        if Lib.shownAsPDF(p) && Lib.isFile(p) {
            do {
                let f = try searchInkOf(p, searchBase(p))
                if Lib.isFile(f) { if let d = Lib.fm.contents(atPath: f) { text = String(decoding: d, as: UTF8.self) } else { err = "Can't read file" } }
            } catch { err = searchErr(error) }
        } else { err = "not a PDF file" }
        js("MdView.boardText", [id, text as Any? ?? NSNull(), err as Any? ?? NSNull()])
    }

    /// … and as it is to be. The PDF is not touched. empty: nothing is drawn on the PDF (any more) — then nothing is
    /// kept, and no folder for it.
    func pdfinkSave(_ path: String, _ text: String, empty: Bool, _ id: Any) {
        let p = foundAsset(Lib.resolve(path))
        var err: String?
        if Lib.shownAsPDF(p) && Lib.isFile(p) {
            let base = searchBase(p)
            do {
                let f = try searchInkOf(p, base)
                if empty {
                    if Lib.isFile(f) { try Lib.fm.removeItem(atPath: f) }
                    rmdir(Lib.join(base, ".mdview/pdf")) // (if nothing else is in them)
                    rmdir(Lib.join(base, ".mdview"))
                } else if !text.contains(boardMark) { err = "not a whiteboard" }
                else {
                    try Lib.fm.createDirectory(atPath: Lib.dir(f), withIntermediateDirectories: true)
                    try Lib.writeWhole(f, Data(text.utf8))
                }
            } catch { err = searchErr(error) }
        } else { err = "not a PDF file" }
        js("MdView.boardSaved", [id, err as Any? ?? NSNull()])
    }
}
