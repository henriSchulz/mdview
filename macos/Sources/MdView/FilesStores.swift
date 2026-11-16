// What the folder says about itself and what the application keeps for notes (area A) — hidden.rs (.mdview/hidden.json),
// looks.rs (.mdview/folders.json), attach.rs (the files the application made for a note: attachments.json).
import Foundation

/// JSON as serde_json's `to_string_pretty` writes it (keys in order, two spaces, one item a line): two devices that
/// each change a different entry change different lines.
func serdePretty(_ v: Any, _ level: Int = 0) -> String {
    let pad = String(repeating: "  ", count: level + 1), end = String(repeating: "  ", count: level)
    switch v {
    case let d as [String: Any]:
        if d.isEmpty { return "{}" }
        // (serde_json with preserve_order: the keys of the files' own shapes in the order they are made — "version" first, a
        // folder's look as color, icon, fav — the names of folders in order, as a BTreeMap has them)
        let first = level == 0 ? ["version"] : level == 2 ? ["color", "icon", "fav"] : []
        let keys = first.filter { d[$0] != nil } + d.keys.filter { !first.contains($0) }.sorted()
        return "{\n" + keys.map { pad + serdeString($0) + ": " + serdePretty(d[$0]!, level + 1) }.joined(separator: ",\n") + "\n" + end + "}"
    case let a as [Any]:
        if a.isEmpty { return "[]" }
        return "[\n" + a.map { pad + serdePretty($0, level + 1) }.joined(separator: ",\n") + "\n" + end + "]"
    case let s as String: return serdeString(s)
    case let n as NSNumber:
        if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
        return "\(n)"
    default: return "null"
    }
}

private func serdeString(_ s: String) -> String {
    var o = "\""
    for u in s.unicodeScalars {
        switch u {
        case "\"": o += "\\\""
        case "\\": o += "\\\\"
        case "\n": o += "\\n"
        case "\r": o += "\\r"
        case "\t": o += "\\t"
        default: o += u.value < 0x20 ? String(format: "\\u%04x", u.value) : String(u)
        }
    }
    return o + "\""
}

/// `path` below `root`, with "/" (nil: not below it, or the folder itself).
func belowFolder(_ root: String, _ path: String) -> String? {
    guard path.hasPrefix(root + "/") else { return nil }
    let rel = String(path.dropFirst(root.count + 1))
    return rel.isEmpty ? nil : rel
}

private func readJSON(_ p: String) -> [String: Any]? {
    guard let d = Lib.fm.contents(atPath: p) else { return nil }
    return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
}

private func writeMdviewFile(_ root: String, _ file: String, _ object: [String: Any]?) throws {
    let full = Lib.join(root, file)
    guard let object else {
        try? Lib.fm.removeItem(atPath: full)
        // (the folder goes if nothing else is in it)
        if let left = try? Lib.fm.contentsOfDirectory(atPath: Lib.join(root, ".mdview")), left.isEmpty { try? Lib.fm.removeItem(atPath: Lib.join(root, ".mdview")) }
        return
    }
    try Lib.fm.createDirectory(atPath: Lib.join(root, ".mdview"), withIntermediateDirectories: true)
    try Data((serdePretty(object) + "\n").utf8).write(to: URL(fileURLWithPath: full))
}

// MARK: hidden.rs

enum Hidden {
    static let file = ".mdview/hidden.json"

    static func read(_ root: String) -> Set<String> {
        Set(((readJSON(Lib.join(root, file))?["hidden"] as? [Any]) ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty })
    }

    static func write(_ root: String, _ hidden: Set<String>) throws {
        try writeMdviewFile(root, file, hidden.isEmpty ? nil : ["version": 1, "hidden": hidden.sorted()])
    }

    /// What is hidden, as whole paths (as the scan names what it walks).
    static func listed(_ root: String) -> Set<String> { Set(read(root).map { Lib.join(root, $0) }) }

    /// These files and folders hidden (on) or shown again.
    static func set(_ root: String, _ paths: [String], on: Bool) throws {
        var hidden = read(root)
        for rel in paths.compactMap({ belowFolder(root, $0) }) { if on { hidden.insert(rel) } else { hidden.remove(rel) } }
        try write(root, hidden)
    }

    /// A file or a folder under another path (renamed, moved) — or gone (new: nil): what was hidden of it stays hidden,
    /// what is gone is no longer named.
    static func moved(_ root: String, _ old: String, _ new: String?) {
        guard let was = belowFolder(root, old) else { return }
        let hidden = read(root), inside = was + "/"
        guard hidden.contains(where: { $0 == was || $0.hasPrefix(inside) }) else { return }
        let now = new.flatMap { belowFolder(root, $0) }
        var next = Set<String>()
        for k in hidden {
            let rest: String? = k == was ? "" : (k.hasPrefix(inside) ? String(k.dropFirst(inside.count)) : nil)
            switch (rest, now) {
            case (nil, _): next.insert(k)
            case (_, nil): break
            case (let r?, let n?): next.insert(r.isEmpty ? n : "\(n)/\(r)")
            }
        }
        try? write(root, next)
    }
}

// MARK: looks.rs

enum Looks {
    static let file = ".mdview/folders.json"

    /// A colour's or a sign's name as the page gives it: a short word.
    static func word(_ v: String) -> String? {
        let w = v.trimmingCharacters(in: .whitespaces)
        guard !w.isEmpty, w.utf8.count <= 40, w.utf8.allSatisfy({ ($0 >= 97 && $0 <= 122) || ($0 >= 48 && $0 <= 57) || $0 == 45 }) else { return nil }
        return w
    }

    /// A colour as the page gives it: a theme colour's name, or any as `#rrggbb`.
    static func colour(_ v: String) -> String? {
        let w = v.trimmingCharacters(in: .whitespaces).lowercased()
        if w.utf8.count == 7, w.hasPrefix("#"), w.dropFirst().utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }) { return w }
        return word(w)
    }

    static func read(_ root: String) -> [String: Any] {
        ((readJSON(Lib.join(root, file))?["folders"] as? [String: Any]) ?? [:]).filter { $0.value is [String: Any] }
    }

    static func write(_ root: String, _ looks: [String: Any]) throws {
        try writeMdviewFile(root, file, looks.isEmpty ? nil : ["version": 1, "folders": looks])
    }

    /// For the page: { path below the folder → { color, icon } }.
    static func listed(_ root: String) -> [String: Any] { read(root) }

    /// A colour and a sign chosen for a folder ("" for either: none).
    static func set(_ root: String, _ dir: String, color: String, icon: String, fav: Bool) throws {
        guard let rel = belowFolder(root, dir) else { throw NSError(domain: "mdview", code: 1, userInfo: [NSLocalizedDescriptionKey: "not a folder of this folder"]) }
        var looks = read(root)
        var entry: [String: Any] = [:]
        if let c = colour(color) { entry["color"] = c }
        if let i = word(icon) { entry["icon"] = i }
        if fav { entry["fav"] = true }
        if entry.isEmpty { looks[rel] = nil } else { looks[rel] = entry }
        try write(root, looks)
    }

    /// A folder under another path (renamed, moved): its look, and that of the folders in it, go along.
    static func moved(_ root: String, _ old: String, _ new: String) {
        guard let was = belowFolder(root, old), let now = belowFolder(root, new) else { return }
        let looks = read(root), inside = was + "/"
        guard looks.keys.contains(where: { $0 == was || $0.hasPrefix(inside) }) else { return }
        var next: [String: Any] = [:]
        for (k, v) in looks {
            if k == was { next[now] = v } else if k.hasPrefix(inside) { next["\(now)/\(k.dropFirst(inside.count))"] = v } else { next[k] = v }
        }
        try? write(root, next)
    }
}

// MARK: attach.rs

/// What a save changed: files that went, files that are back.
struct Tidied { var removed: [String] = []; var restored: [String] = [] }

/// The files the application made for a notes (pasted pictures, figures, whiteboards): one place that knows whose they are,
/// so that a picture goes with what showed it — and comes back when it is named again.
final class Attachments {
    static let graceSecs: UInt64 = 3600           // how long a file stays after the note stopped naming it
    static let keepSecs: UInt64 = 30 * 24 * 3600  // how long the copy of a removed file is kept
    static let notesMost = 4000

    static let shared: Attachments = {
        let cache = Lib.fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("MdView").path
        return Attachments(stateDir: Store.shared.dir.path, cacheDir: cache)
    }()

    let file: String
    let stash: String
    init(stateDir: String, cacheDir: String) { file = Lib.join(stateDir, "attachments.json"); stash = Lib.join(cacheDir, "removed") }

    private func load() -> [String: [String: Any]] {
        (readJSON(file) ?? [:]).compactMapValues { $0 as? [String: Any] }
    }
    private func save(_ all: [String: [String: Any]]) {
        try? Lib.fm.createDirectory(atPath: Lib.dir(file), withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: all) { try? d.write(to: URL(fileURLWithPath: file)) }
    }
    private func stashed(_ f: String) -> String {
        var h: UInt64 = 0xcbf29ce484222325
        for b in f.utf8 { h = (h ^ UInt64(b)) &* 0x100000001b3 }   // (FNV-1a: the same name every run)
        let e = (f as NSString).pathExtension
        return Lib.join(stash, String(format: "%016llx", h) + (e.isEmpty ? "" : "." + e))
    }

    /// Does the note's text name the file? (as it is, or as an address writes it: %20 for a space)
    static func mentions(_ text: String, _ name: String) -> Bool {
        !name.isEmpty && (text.contains(name) || (text.removingPercentEncoding ?? text).contains(name))
    }

    /// The application made this file for that note.
    func own(_ f: String, _ note: String) { var a = load(); a[f] = ["note": note]; save(a) }

    /// Every file the application made for a note and that is still there (a folder's list leaves them out).
    func owned() -> Set<String> { Set(load().filter { $0.value["gone"] == nil }.keys) }

    /// The note the application made this file for, if it did.
    func owner(_ f: String) -> String? {
        guard let e = load()[f], e["gone"] == nil else { return nil }
        return e["note"] as? String
    }

    /// The file is its own from now on — a file of the folder like any other.
    func disown(_ f: String) { var a = load(); if a.removeValue(forKey: f) != nil { save(a) } }

    /// The files the application made for that note, as far as they are still there.
    func ownedBy(_ note: String) -> [String] {
        load().filter { ($0.value["note"] as? String) == note && $0.value["gone"] == nil }.map { $0.key }
    }

    /// Another note under root that names the file.
    private func elsewhere(_ root: String, _ note: String, _ name: String) -> String? {
        var dirs = [(root, 0)], read = 0
        while let (dir, depth) = dirs.popLast() {
            for e in (try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? [] {
                if e.hasPrefix(".") { continue }
                let p = Lib.join(dir, e)
                if Lib.isDir(p) { if depth < 8 { dirs.append((p, depth + 1)) } }
                else if Lib.isMd(p) && p != note {
                    read += 1
                    if read > Attachments.notesMost { return p }   // (too many to know: the file stays)
                    if let t = Lib.read(p), Attachments.mentions(t, name) { return p }
                }
            }
        }
        return nil
    }

    /// The note was saved with this text. root: the folder whose notes may name the file too. remove: how a file goes (the
    /// Trash) — true when it is gone.
    func tidy(note: String, text: String, root: String, now: UInt64, grace: UInt64, remove: (String) -> Bool) -> Tidied {
        var all = load()
        if all.isEmpty { return Tidied() }
        var out = Tidied(), changed = false
        for key in all.keys {
            let name = Lib.name(key), stash = stashed(key)
            let named = Attachments.mentions(text, name)
            let entry = all[key]!
            if let gone = (entry["gone"] as? NSNumber)?.uint64Value {
                // removed before: back when a note names it again; forgotten after a while
                if named && !Lib.exists(key) && Lib.isFile(stash) {
                    let ok = (try? Lib.fm.createDirectory(atPath: Lib.dir(key), withIntermediateDirectories: true)) != nil && (try? Lib.fm.copyItem(atPath: stash, toPath: key)) != nil
                    if ok { try? Lib.fm.removeItem(atPath: stash); all[key] = ["note": note]; out.restored.append(key); changed = true }
                } else if named && Lib.exists(key) {
                    all[key] = ["note": note]; changed = true   // (put back by other means)
                } else if now > gone && now - gone > Attachments.keepSecs {
                    try? Lib.fm.removeItem(atPath: stash); all[key] = nil; changed = true
                }
                continue
            }
            if (entry["note"] as? String) != note { continue }
            if named {
                if entry["unnamed"] != nil { all[key] = ["note": note]; changed = true }   // (named again in time: nothing happened)
                continue
            }
            // no longer named: noted, and left where it is for the time of grace
            let since = (entry["unnamed"] as? NSNumber)?.uint64Value
            if since == nil && grace > 0 { all[key] = ["note": note, "unnamed": now]; changed = true; continue }
            if let s = since, now > s, now - s < grace { continue }
            if !Lib.isFile(key) { all[key] = nil; changed = true; continue }   // (taken away by other means)
            if let other = elsewhere(root, note, name) { all[key] = ["note": other]; changed = true; continue }   // (it is that note's now)
            // a copy aside first: without one the file stays where it is
            if (try? Lib.fm.createDirectory(atPath: self.stash, withIntermediateDirectories: true)) == nil { continue }
            try? Lib.fm.removeItem(atPath: stash)
            if (try? Lib.fm.copyItem(atPath: key, toPath: stash)) == nil { continue }
            if remove(key) { all[key] = ["note": note, "gone": now]; out.removed.append(key); changed = true }
            else { try? Lib.fm.removeItem(atPath: stash) }
        }
        if changed { save(all) }
        return out
    }
}
