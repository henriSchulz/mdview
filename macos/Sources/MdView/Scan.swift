// The folder as a tree for the sidebar — src-tauri/src/scan.rs `scan_folder`.
import Foundation

struct ScanResult {
    var tree: [String: Any]
    var walked: [String]
    var notes: [[String: Any]]
}

final class Scanner {
    /// path -> (mtime, size, title)
    var titleCache: [String: (Double, Int, String?)] = [:]
    private var count = 0
    private var walked: [String] = []
    private var deadline = Date()
    private let noteLimit = 5000

    func scan(root: String, titles: Bool, keep: Set<String>, putAway: Set<String>, all: Bool) -> ScanResult {
        count = 0; walked = []; deadline = Date().addingTimeInterval(1.5)
        let (tree, _) = walk(root, 0, false, titles, keep, putAway, all)
        var notes: [[String: Any]] = []
        func collect(_ n: [String: Any]) {
            notes += (n["notes"] as? [[String: Any]]) ?? []
            for d in (n["dirs"] as? [[String: Any]]) ?? [] { collect(d) }
        }
        collect(tree)
        return ScanResult(tree: tree, walked: walked, notes: notes)
    }

    private static let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey, .contentModificationDateKey, .fileSizeKey]

    /// One folder: its entries with what is needed of each fetched along with the listing (one call per folder, not
    /// three per file), and a real path asked for only where a link lies on the way (`linked`) — the folder itself is
    /// real already (setFolder resolves it), so is what lies in it.
    private func walk(_ d: String, _ depth: Int, _ hidden: Bool, _ titles: Bool, _ keep: Set<String>, _ putAway: Set<String>, _ all: Bool, linked: Bool = false) -> ([String: Any], Bool) {
        var dirs: [[String: Any]] = [], notes: [[String: Any]] = []
        var leftOut = false
        walked.append(d)
        let urls = (try? Lib.fm.contentsOfDirectory(at: URL(fileURLWithPath: d, isDirectory: true), includingPropertiesForKeys: Scanner.keys, options: [])) ?? []
        let entries = urls.map { ($0.lastPathComponent, $0) }.sorted { Lib.natural($0.0, $1.0) }
        for (name, url) in entries {
            let path = Lib.join(d, name)
            let v = try? url.resourceValues(forKeys: Set(Scanner.keys))
            let isLink = v?.isSymbolicLink == true
            // (a link to a folder is not gone into — `Code -> ~/Projects` filled the sidebar with all of it, `self -> .`
            // repeated the folder twelve deep; scan.rs takes the entry's own type alike. Review 2026-11-17. A link to a
            // file is followed as before: its own time and size are the link's.)
            if isLink && Lib.isDir(path) { continue }
            let isDir = !isLink && v?.isDirectory == true
            let heavy = isDir && (Lib.skipDirs.contains(name) || name == ".git")
            let away = hidden || heavy || name.hasPrefix(".") || putAway.contains(path)
            if away && !all { leftOut = true; continue }
            if isDir {
                if depth >= 12 || count >= noteLimit || Date() > deadline { continue }
                if heavy { dirs.append(["name": name, "path": path, "dirs": [Any](), "notes": [Any](), "hidden": true]); continue }
                let (sub, less) = walk(path, depth + 1, away, titles, keep, putAway, all, linked: linked || isLink)
                if !(sub["dirs"] as! [Any]).isEmpty || !(sub["notes"] as! [Any]).isEmpty || !less || keep.contains(path) { dirs.append(sub) } else { leftOut = true }
                continue
            }
            if count >= noteLimit { continue }
            var mtime: Double, size: Int
            if isLink {
                guard let attr = try? Lib.fm.attributesOfItem(atPath: path), (attr[.type] as? FileAttributeType) != .typeDirectory else { continue }
                mtime = ((attr[.modificationDate] as? Date)?.timeIntervalSince1970) ?? 0
                size = (attr[.size] as? Int) ?? 0
            } else {
                guard v != nil else { continue } // (gone between the listing and now)
                mtime = v?.contentModificationDate?.timeIntervalSince1970 ?? 0
                size = v?.fileSize ?? 0
            }
            let real = linked || isLink ? Lib.resolve(path) : path
            if Lib.isMd(path) {
                var title: String?
                if titles {
                    if let h = titleCache[path], h.0 == mtime, h.1 == size { title = h.2 } else {
                        title = Lib.noteTitle(path)
                        titleCache[path] = (mtime, size, title)
                    }
                }
                var n: [String: Any] = ["name": (name as NSString).deletingPathExtension, "path": path, "real": real,
                                        "title": title as Any? ?? NSNull(), "mtime": Int(mtime), "opened": 0]
                if away { n["hidden"] = true }
                notes.append(n)
            } else {
                let kind = Lib.isBoard(path) ? "board" : Lib.kind(path)
                let shown = kind == "board" ? String(name.dropLast(".board.svg".count)) : name
                var n: [String: Any] = ["name": shown, "path": path, "real": real, "title": NSNull(), "pdf": true, "kind": kind, "opened": 0]
                if kind == "board" && isNotebook(path, mtime: mtime, size: size) { n["book"] = true }
                if away { n["hidden"] = true }
                notes.append(n)
            }
            count += 1
        }
        var node: [String: Any] = ["name": Lib.name(d), "path": d, "dirs": dirs, "notes": notes]
        if hidden { node["hidden"] = true }
        return (node, leftOut)
    }

    /// path -> (mtime, size, notebook): a board's head is read again only when the board changed.
    private var bookCache: [String: (Double, Int, Bool)] = [:]

    /// A notebook: a whiteboard whose head says how its paper is (board/paper.js).
    private func isNotebook(_ path: String, mtime: Double, size: Int) -> Bool {
        if let h = bookCache[path], h.0 == mtime, h.1 == size { return h.2 }
        let b = readNotebook(path)
        bookCache[path] = (mtime, size, b)
        return b
    }

    private func readNotebook(_ path: String) -> Bool {
        guard let head = Lib.read(path, limit: 4096), let r = head.range(of: "<![CDATA[") else { return false }
        let lines = head[r.lowerBound...].components(separatedBy: "\n")
        return lines.count > 1 && lines[1].hasPrefix("{\"board\"") && lines[1].contains("\"paper\":{")
    }
}
