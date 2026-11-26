// Sharing a note: a link under which anyone can read it in the web app, with a password if one is set — and nothing else of the
// project with it. What is shared stands in the project itself, in .mdview/shares.json (the web app writes the same file the same
// way). Rust original: share.rs.
import Foundation
import CommonCrypto

/// JSON written as serde_json's pretty printer writes it (keys in order, two spaces): two devices that each share a note change different lines.
func prettyJSON(_ v: Any, _ indent: Int = 0) -> String {
    let pad = String(repeating: "  ", count: indent + 1), end = String(repeating: "  ", count: indent)
    switch v {
    case let d as [String: Any]:
        if d.isEmpty { return "{}" }
        return "{\n" + d.keys.sorted().map { "\(pad)\(jsonString($0)): \(prettyJSON(d[$0]!, indent + 1))" }.joined(separator: ",\n") + "\n\(end)}"
    case let a as [Any]:
        if a.isEmpty { return "[]" }
        return "[\n" + a.map { "\(pad)\(prettyJSON($0, indent + 1))" }.joined(separator: ",\n") + "\n\(end)]"
    case is NSNull: return "null"
    default: return jsonString(v)
    }
}

enum Share {
    static let file = ".mdview/shares.json"
    static let iterations = 600_000
    static var web: String {
        let w = ProcessInfo.processInfo.environment["MDVIEW_WEB"].flatMap { $0.isEmpty ? nil : $0 } ?? "https://md.henrischulz.com"
        return w.hasSuffix("/") ? String(w.dropLast()) : w
    }
    static let githubRx = Lib.rx(#"github\.com[:/]([^/]+)/([^/]+?)(?:\.git)?/?$"#)

    /// The project a note is in, and the note's path in it (as the repository names it).
    static func place(_ path: String) -> (root: String, rel: String)? {
        guard case .project(let root) = Hist.placeOf(path), path.hasPrefix(root + "/") else { return nil }
        return (root, String(path.dropFirst(root.count + 1)))
    }

    static func read(_ root: String) -> [String: [String: Any]] {
        guard let d = Lib.fm.contents(atPath: Lib.join(root, file)), let all = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let s = all["shares"] as? [String: Any] else { return [:] }
        var out: [String: [String: Any]] = [:]
        for (k, v) in s { if let e = v as? [String: Any], e["path"] is String { out[k] = e } }
        return out
    }

    static func write(_ root: String, _ shares: [String: [String: Any]]) throws {
        let text = prettyJSON(["version": 1, "shares": shares]) + "\n"
        try Lib.fm.createDirectory(atPath: Lib.join(root, ".mdview"), withIntermediateDirectories: true)
        try text.write(toFile: Lib.join(root, file), atomically: true, encoding: .utf8)
    }

    static func find(_ shares: [String: [String: Any]], _ rel: String) -> String? {
        shares.first { ($0.value["path"] as? String) == rel }?.key
    }

    /// The repository on GitHub a project is linked to: its owner and its name.
    static func repo(_ root: String) -> (String, String)? {
        guard let url = Sync.linked(root), let m = Lib.first(githubRx, url), m.count >= 3 else { return nil }
        return (m[1], m[2])
    }

    static func quote(_ s: String) -> String {
        var a = CharacterSet.alphanumerics; a.insert(charactersIn: "_.-~/")
        return s.addingPercentEncoding(withAllowedCharacters: a) ?? s
    }

    /// A link's id that is free, as the web app says it — asked for there (nil: the web app was not reached). Blocks: call off the main thread.
    static func freeID() -> String? {
        guard let url = URL(string: "\(web)/share/free") else { return nil }
        guard let (s, d) = GitHub.http(URLRequest(url: url), timeout: 5), s == 200, let id = GitHub.json(d)["id"] as? String else { return nil }
        return !id.isEmpty && id.count <= 64 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) } ? id : nil
    }

    /// The web app is told that this project's list of shares has changed (it reads the list itself, from the repository). Not waited for.
    static func tell(_ root: String) {
        guard let (owner, name) = repo(root), let url = URL(string: "\(web)/share/sync/\(quote(owner))/\(quote(name))") else { return }
        DispatchQueue.global().async { var r = URLRequest(url: url); r.httpMethod = "POST"; _ = GitHub.http(r) }
    }

    static func isShared(_ path: String) -> Bool {
        guard let (root, rel) = place(path) else { return false }
        return find(read(root), rel) != nil
    }

    static func newID() -> String {
        let letters = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
        var out = ""
        while out.count < 10 {
            var b = [UInt8](repeating: 0, count: 16)
            _ = SecRandomCopyBytes(kSecRandomDefault, b.count, &b)
            for x in b where x < 248 { out.append(letters[Int(x % 62)]) }
        }
        return String(out.prefix(10))
    }

    static func hashed(_ password: String) -> [String: Any] {
        var salt = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt)
        var hash = [UInt8](repeating: 0, count: 32)
        let pw = Array(password.utf8)
        pw.withUnsafeBufferPointer { p in
            p.baseAddress!.withMemoryRebound(to: Int8.self, capacity: pw.count) { pp in
                _ = CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pp, pw.count, salt, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &hash, 32)
            }
        }
        return ["salt": Data(salt).base64EncodedString(), "hash": Data(hash).base64EncodedString(), "iterations": iterations]
    }

    /// Whether the file is at the project's other side as it is here (else a link does not show yet what was set here).
    static func arrived(_ root: String) -> Bool {
        var there: Data?
        if let b = Hist.branch(root) {
            let r = Git.run(["cat-file", "blob", "refs/remotes/\(Sync.remote)/\(b):\(file)"], in: root)
            if r.ok { there = r.out }
        }
        let here = Lib.fm.contents(atPath: Lib.join(root, file))
        switch (here, there) { case let (h?, t?): return h == t; case (nil, nil): return true; default: return false }
    }

    /// The notes of a folder that are shared, by their paths — for the sidebar, which marks them.
    static func listed(_ folder: String) -> [String] {
        guard case .project(let root) = Hist.placeOf(folder), Lib.isDir(folder) else { return [] }
        var all: [String] = []
        for e in read(root).values {
            guard let rel = e["path"] as? String else { continue }
            let p = Lib.join(root, rel)
            if (p == folder || p.hasPrefix(folder + "/")) && Lib.isFile(p) { all.append(Lib.resolve(p)) }
        }
        return all.sorted()
    }

    /// How a note's sharing stands, for the page: { path, can, why, link, password, pending, conflict }.
    static func info(_ path: String) -> [String: Any] {
        func told(_ can: Bool, _ why: String?, _ link: String?, _ password: Bool, _ pending: Bool) -> [String: Any] {
            ["path": path, "can": can, "why": why as Any? ?? NSNull(), "link": link as Any? ?? NSNull(), "password": password, "pending": pending, "conflict": [String]()]
        }
        func lacking(_ need: String, _ why: String) -> [String: Any] { var v = told(false, why, nil, false, false); v["need"] = need; return v }
        guard let (root, rel) = place(path) else { return lacking("history", "Turn the history on first: the clock in the sidebar.") }
        guard repo(root) != nil else { return lacking("link", "Link this project to a repository on GitHub first: Settings › History.") }
        let shares = read(root)
        guard let id = find(shares, rel) else { return told(true, nil, nil, false, false) }
        let pending = !arrived(root)
        var v = told(true, nil, "\(web)/\(id)", !(shares[id]?["password"] is NSNull) && shares[id]?["password"] != nil, pending)
        v["conflict"] = pending ? Sync.stuck(root) : [String]()
        return v
    }

    /// The note shared (if it was not: under the id given, where it is free here), and its password set (.some(.some)), taken away
    /// (.some(nil)) or left as it is (nil). → the project, for its snapshot.
    static func set(_ path: String, password: String??, id: String?) throws -> String {
        guard let (root, rel) = place(path) else { throw HistoryError("not in a project") }
        var shares = read(root)
        let use = find(shares, rel) ?? ((id.flatMap { shares[$0] == nil ? $0 : nil }) ?? newID())
        var entry = shares[use] ?? ["path": rel, "created": isoZ(), "password": NSNull()]
        if let p = password { entry["password"] = (p.flatMap { $0.isEmpty ? nil : $0 }).map(hashed) ?? NSNull() }
        shares[use] = entry
        try write(root, shares)
        return root
    }

    static func isoZ() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss'Z'"; f.timeZone = TimeZone(identifier: "UTC"); f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }

    static func stop(_ path: String) throws -> String? { try moved(path, nil) }

    /// A note has another name, or is gone (nil): what was shared of it follows, or ends. → the project, if the file changed.
    static func moved(_ old: String, _ new: String?) throws -> String? {
        guard let (root, rel) = place(old), Lib.isFile(Lib.join(root, file)) else { return nil }
        var shares = read(root)
        guard let id = find(shares, rel) else { return nil }
        if let n = new, let (to, now) = place(n), to == root { shares[id]?["path"] = now } else { shares[id] = nil }
        try write(root, shares)
        return root
    }

    /// A folder has another path: what was shared of the notes in it follows. (Both paths as they are now.)
    static func movedDir(_ old: String, _ new: String) throws -> String? {
        guard case .project(let root) = Hist.placeOf(Lib.dir(old)), case .project(let to) = Hist.placeOf(new), to == root, Lib.isFile(Lib.join(root, file)) else { return nil }
        guard old.hasPrefix(root + "/"), new.hasPrefix(root + "/") else { return nil }
        let (was, now) = (String(old.dropFirst(root.count + 1)), String(new.dropFirst(root.count + 1)))
        var shares = read(root)
        var changed = false
        for k in shares.keys {
            let p = shares[k]?["path"] as? String ?? ""
            if p.hasPrefix(was + "/") { shares[k]?["path"] = "\(now)/\(p.dropFirst(was.count + 1))"; changed = true }
        }
        if !changed { return nil }
        try write(root, shares)
        return root
    }
}
