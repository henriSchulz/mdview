// Search, previews, the note beside, whiteboards and PDFs (area B). Rust originals: search.rs, slides.rs,
// shell/folder.rs (search, send_previews, new_board, board_free), shell.rs (render_pdf, send_pdf),
// shell/files.rs (board_*, note_read/note_save, pdfink_*). This file: the messages and what the folder's notes
// are asked (search, previews, the note beside); SearchBoards.swift: whiteboards and what is drawn on a PDF;
// SearchPDF.swift: the PDF in the window and presentations.
import AppKit

final class SearchState {
    /// a PDF's Git name, by the file as it was: (length, time, inode) -> name (`ink_of`)
    var inkKnown: [String: (UInt64, Double, UInt64, String)] = [:]
}

// MARK: search.rs — the notes that have every word

/// A note as it was read last: its time, its text, its text in small letters.
private struct Kept {
    var mtime: Double
    var text: String
    var low: NSString
}

enum SearchCache {
    /// The most notes one search hands the page (the best first), and the most of a note read.
    static let most = 60
    static let read = 512 * 1024
    /// (searching reads files: not on the main thread; one search at a time keeps what is kept in order)
    static let queue = DispatchQueue(label: "mdview.search", qos: .userInitiated)
    private static var kept: [String: Kept] = [:]

    /// The words asked for, in small letters: split at spaces, what stands in "quotes" one word.
    static func words(_ q: String) -> [String] {
        var out: [String] = []
        for (i, part) in q.components(separatedBy: "\"").enumerated() {
            if i % 2 == 1 {
                let w = part.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if !w.isEmpty { out.append(w) }
            } else {
                out += part.split(whereSeparator: { $0.isWhitespace }).map { $0.lowercased() }
            }
        }
        return out
    }

    private static func count(_ hay: NSString, _ w: String) -> Int {
        var n = 0, from = 0
        while from < hay.length {
            let r = hay.range(of: w, options: [], range: NSRange(location: from, length: hay.length - from))
            if r.location == NSNotFound { break }
            n += 1
            from = r.location + max(r.length, 1)
        }
        return n
    }

    /// The notes among `paths` (the window's own) that have every word — in the name or anywhere in the text, not
    /// necessarily in one block — the best first: words in the name, then how often the words stand in it, then the
    /// newest. Also how many were found in all. Nothing asked: every note is read into what is kept (the page asks
    /// so when Search opens), and none is handed over.
    static func search(_ paths: [String], _ q: String) -> ([[String: Any]], Int) {
        let words = words(q)
        var hits: [(score: Int, mtime: Double, i: Int, hit: [String: Any])] = []
        for (i, p) in paths.enumerated() where Lib.isMd(p) {
            guard Lib.exists(p) else { continue }
            let mtime = Lib.mtime(p)
            if kept[p]?.mtime != mtime {
                guard let text = Lib.read(p, limit: read) else { continue }
                kept[p] = Kept(mtime: mtime, text: text, low: text.lowercased() as NSString)
            }
            if words.isEmpty { continue }
            let k = kept[p]!
            let name = ((Lib.name(p) as NSString).deletingPathExtension).lowercased()
            let nameNS = name as NSString
            if !words.allSatisfy({ nameNS.range(of: $0).location != NSNotFound || k.low.range(of: $0).location != NSNotFound }) { continue }
            let inName = words.filter { nameNS.range(of: $0).location != NSNotFound }.count
            let often = words.reduce(0) { $0 + count(k.low, $1) }
            hits.append((inName * 10_000 + min(often, 9_999), mtime, i, ["path": p, "text": k.text, "mtime": mtime]))
        }
        let found = hits.count
        hits.sort { a, b in a.score != b.score ? a.score > b.score : (a.mtime != b.mtime ? a.mtime > b.mtime : a.i < b.i) }
        return (hits.prefix(most).map { $0.hit }, found)
    }
}

extension NoteWindow {
    func handleSearch(_ type: String, _ msg: [String: Any]) -> Bool {
        let str = { (k: String) in msg[k] as? String ?? "" }
        let id: Any = msg["id"] ?? NSNull()
        switch type {
        case "search": search(str("q"), id)
        case "previews": sendPreviews(msg["paths"])
        case "note-read": noteRead(str("path"), id)
        case "note-save": noteSave(str("path"), msg["text"] as? String, id)
        case "board-new": boardNew(str("path"), str("text"), id)
        case "board-read": boardRead(str("path"), id)
        case "board-save": boardSave(str("path"), str("text"), id)
        case "board-paste": boardPaste(str("path"), id)
        case "board-drop": boardDrop(str("path"), msg["uris"] as? [Any] ?? [], id)
        case "board-pick": boardPick(str("path"), id)
        case "newboard": newBoard(name: str("name"), wanted: msg["dir"] as? String, text: str("text"))
        case "pdfink-read": pdfinkRead(str("path"), id)
        case "pdfink-save": pdfinkSave(str("path"), str("text"), empty: (msg["empty"] as? Bool) ?? false, id)
        case "pdfdata":
            let pid: String
            if let s = msg["id"] as? String { pid = s } else if let n = msg["id"] as? NSNumber { pid = n.stringValue } else { pid = "" }
            sendPDF(str("path"), pid)
        default: return false
        }
        return true
    }

    /// The notes of this window's folder that have every word, with their text (the page takes each apart into blocks).
    func search(_ q: String, _ id: Any) {
        let paths = Array(notePaths)
        SearchCache.queue.async { [weak self] in
            let (notes, found) = SearchCache.search(paths, q)
            DispatchQueue.main.async { self?.js("MdView.searchResults", [id, ["notes": notes, "found": found]]) }
        }
    }

    /// The beginning of notes of this folder, for their tiles in the overview.
    func sendPreviews(_ paths: Any?) {
        var out: [String: Any] = [:]
        for p in (paths as? [Any] ?? []).prefix(60) {
            guard let p = p as? String, notePaths.contains(p), Lib.kind(p) == "md" else { continue }
            if let text = Lib.read(p, limit: 2400), Lib.exists(p) { out[p] = ["text": text, "mtime": Lib.mtime(p)] }
            else { out[p] = ["text": "", "mtime": 0] }
        }
        js("MdView.setPreviews", [out])
    }

    /// A note beside the one in the window (viewer/split.js): its text, and what its links lead to — worked out from
    /// where that note lies, not from the one on screen.
    func noteRead(_ path: String, _ id: Any) {
        let p = foundAsset(Lib.resolve(path))
        guard Lib.isMd(p), Lib.isFile(p) else { return js("MdView.noteRead", [id, NSNull(), "not a note"]) }
        guard let data = Lib.fm.contents(atPath: p) else { return js("MdView.noteRead", [id, NSNull(), "Can't read file"]) }
        let text = String(decoding: data, as: UTF8.self)
        let own = resolver
        resolver = Resolver(noteDir: Lib.dir(p), base: folder)
        let links: [String: Any] = text.contains("[[") ? buildLinks(text) : [:]
        resolver = own
        js("MdView.noteRead", [id, ["path": p, "text": text, "links": links], NSNull()])
    }

    /// … and written in there: kept as the window's own note is — its line endings as they were, a link followed.
    /// Only a note, only one that is there, and not the one in the window (that one is written in the window).
    func noteSave(_ path: String, _ text: String?, _ id: Any) {
        let p = foundAsset(Lib.resolve(path))
        var err: String?
        if let text {
            if !Lib.isMd(p) || !Lib.isFile(p) { err = "not a note" }
            else if let cur = self.path, Lib.resolve(cur) == p { err = "open in the window" }
            else if let old = Lib.fm.contents(atPath: p) {
                let crlf = old.range(of: Data("\r\n".utf8)) != nil
                let data = Data((crlf ? text.replacingOccurrences(of: "\n", with: "\r\n") : text).utf8)
                if data != old { do { try writeWhole(p, data) } catch { err = searchErr(error) } }
            } else { err = "Can't read file" }
        } else { err = "no text" }
        js("MdView.noteSaved", [id, err as Any? ?? NSNull()])
    }
}

/// What went wrong, as the system words it ("Permission denied").
func searchErr(_ e: Error) -> String {
    let ns = e as NSError
    if ns.domain == NSPOSIXErrorDomain { return String(cString: strerror(Int32(ns.code))) }
    if let u = ns.userInfo[NSUnderlyingErrorKey] as? NSError, u.domain == NSPOSIXErrorDomain { return String(cString: strerror(Int32(u.code))) }
    return e.localizedDescription
}
