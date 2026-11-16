// A project and the repository it is linked to: what is fetched from there and pushed to it. The repository is GitHub's,
// reached over HTTPS with the token of the user who signed in; a path on this machine is one too. The token is handed to
// git in memory (an Authorization header for GitHub alone) and stands in no file and in no address. Rust original: sync.rs.
import Foundation

/// What the other side is reached with: the token of the signed-in user (none: an address that asks for nothing).
struct Access { var token: String? }

enum SyncStanding {
    case even
    case pushed(Int)
    case pulled(Int)
    case merged(Int)
    case conflict([String])
    case unreachable(String)
    case signIn(String)
    case refused(String)

    var json: [String: Any] {
        switch self {
        case .even: return ["state": "even"]
        case .pushed(let n): return ["state": "even", "did": "pushed", "count": n]
        case .pulled(let n): return ["state": "even", "did": "pulled", "count": n]
        case .merged(let n): return ["state": "even", "did": "merged", "count": n]
        case .conflict(let f): return ["state": "conflict", "files": f]
        case .unreachable(let w): return ["state": "offline", "why": w]
        case .signIn(let w): return ["state": "signin", "why": w]
        case .refused(let w): return ["state": "error", "why": w]
        }
    }
    var isRefused: Bool { if case .refused = self { return true }; return false }
}

enum Sync {
    static let remote = "origin"
    static let tries = 3
    static let mark = 31
    static let textLimit = 2 * 1024 * 1024

    static func say(_ r: GitResult) -> String {
        let lines = r.err.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let pick = lines.last(where: { $0.hasPrefix("fatal:") || $0.hasPrefix("error:") || $0.hasPrefix("remote:") }) ?? lines.last ?? "git failed"
        for p in ["fatal: ", "error: ", "remote: "] where pick.hasPrefix(p) { return String(pick.dropFirst(p.count)) }
        return pick
    }

    /// An address on GitHub itself (https://github.com/…, with or without a name before the host).
    static func githubURL(_ url: String) -> Bool {
        guard url.hasPrefix("https://") else { return false }
        var host = String(url.dropFirst(8)).components(separatedBy: "/")[0]
        host = host.components(separatedBy: "@").last ?? host
        if host.lowercased() == "github.com" { return true }
        let w = Hosts.current.web
        return w != "https://github.com" && url.hasPrefix(w)
    }

    // MARK: linking

    static func linked(_ root: String) -> String? {
        let r = Git.run(["remote", "get-url", remote], in: root)
        return r.ok && !r.text.isEmpty ? r.text : nil
    }

    static func link(_ root: String, _ url: String) throws {
        let have = Git.run(["remote", "get-url", remote], in: root).ok
        let r = Git.run(have ? ["remote", "set-url", remote, url] : ["remote", "add", remote, url], in: root)
        if !r.ok { throw HistoryError(say(r)) }
    }

    static func unlink(_ root: String) throws {
        guard Git.run(["remote", "get-url", remote], in: root).ok else { return }
        let r = Git.run(["remote", "remove", remote], in: root)
        if !r.ok { throw HistoryError(say(r)) }
    }

    /// The branches the repository at an address has (none: it is empty). Throws where it cannot be reached.
    static func branches(_ url: String, _ access: Access) throws -> [String] {
        let r = Git.run(Git.auth(githubURL(url) ? access.token : nil) + ["ls-remote", "--heads", url])
        if !r.ok { throw HistoryError(say(r)) }
        return r.raw.split(separator: "\n").compactMap { l in
            let p = l.split(whereSeparator: { $0 == "\t" || $0 == " " })
            return p.count == 2 && p[1].hasPrefix("refs/heads/") ? String(p[1].dropFirst(11)) : nil
        }
    }

    /// A repository elsewhere is fetched into a folder that is not there yet (or is empty), on the branch named if the repository
    /// has it. An empty repository gives an empty folder linked to it. Either way the folder is a project afterwards.
    static func fetchNew(_ url: String, into: String, branch: String, _ access: Access) throws {
        if let c = try? Lib.fm.contentsOfDirectory(atPath: into), !c.isEmpty { throw HistoryError("\(into) is there already, and not empty") }
        let there = try branches(url, access)
        if there.isEmpty {
            try Lib.fm.createDirectory(atPath: into, withIntermediateDirectories: true)
            let r = Git.run(["init", "-q", "-b", branch], in: into)
            if !r.ok { throw HistoryError(say(r)) }
            try link(into, url)
        } else {
            let b = there.contains(branch) ? branch : there[0]
            let r = Git.run(Git.auth(githubURL(url) ? access.token : nil) + ["clone", "-q", "--branch", b, url, into])
            if !r.ok { throw HistoryError(say(r)) }
        }
        try Hist.enable(into) // (the marker, where the repository did not bring one)
    }

    // MARK: fetch, push

    @discardableResult
    static func fetch(_ root: String, _ access: Access) -> GitResult {
        let url = linked(root) ?? ""
        return Git.run(Git.auth(githubURL(url) ? access.token : nil) + ["fetch", "-q", "--prune", "--no-tags", remote], in: root)
    }

    /// What is to go to the other side is on the disk first, not only in the system's memory.
    static func durable() { sync() }

    /// The project's branch goes to the other side — only as a continuation of what is there.
    static func push(_ root: String, _ access: Access) throws {
        durable()
        guard let ref = Git.run(["symbolic-ref", "-q", "HEAD"], in: root).text as String?, !ref.isEmpty else { throw HistoryError("no branch") }
        let url = linked(root) ?? ""
        let r = Git.run(Git.auth(githubURL(url) ? access.token : nil) + ["push", "-q", remote, "\(ref):\(ref)"], in: root)
        if !r.ok { throw HistoryError(say(r)) }
    }

    // MARK: reconciling

    static func reconcile(_ root: String, _ access: Access, _ stamp: Stamp) -> SyncStanding {
        do { return try reconcileIn(root, access, stamp) } catch { return .refused("\(error)") }
    }

    static func rev(_ root: String, _ name: String) -> String? {
        let r = Git.run(["rev-parse", "--verify", "-q", name], in: root)
        return r.ok && !r.text.isEmpty ? r.text : nil
    }

    static func count(_ root: String, _ from: String) -> Int {
        Int(Git.run(["rev-list", "--count", from], in: root).text) ?? 0
    }

    static func joinResult(_ root: String, _ ours: String, _ theirs: String) -> (tree: String?, conflicts: [(path: String, stages: [Int: (String, String)])]) {
        let r = Git.run(["merge-tree", "--write-tree", "-z", ours, theirs], in: root)
        let f = r.raw.components(separatedBy: "\0")
        guard let tree = f.first, tree.count >= 40 else { return (nil, []) }
        if r.ok { return (tree, []) }
        var byPath: [String: [Int: (String, String)]] = [:]
        var order: [String] = []
        for e in f.dropFirst() {
            if e.isEmpty { break }
            let t = e.components(separatedBy: "\t")
            guard t.count == 2 else { continue }
            let h = t[0].split(separator: " ")
            guard h.count == 3, let stage = Int(h[2]) else { continue }
            if byPath[t[1]] == nil { order.append(t[1]) }
            byPath[t[1], default: [:]][stage] = (String(h[0]), String(h[1]))
        }
        return (tree, order.sorted().map { ($0, byPath[$0]!) })
    }

    private static func reconcileIn(_ root: String, _ access: Access, _ stamp: Stamp) throws -> SyncStanding {
        _ = try Hist.snapshot(root, stamp)
        let sym = Git.run(["symbolic-ref", "-q", "HEAD"], in: root).text
        guard !sym.isEmpty else { throw HistoryError("no branch yet") }
        let short = sym.hasPrefix("refs/heads/") ? String(sym.dropFirst(11)) : sym
        let theirsName = "refs/remotes/\(remote)/\(short)"
        var came = 0
        var did: SyncStanding = .even
        for _ in 0..<tries {
            let f = fetch(root, access)
            if !f.ok {
                let why = say(f), low = f.err.lowercased()
                if ["authentication failed", "could not read username", "invalid username", "permission denied", "terminal prompts disabled", "requested url returned error: 401", "requested url returned error: 403"].contains(where: low.contains) { return .signIn(why) }
                if linked(root) == nil { return .refused("not linked") }
                return .unreachable(why)
            }
            guard let ours = rev(root, sym) else { throw HistoryError("nothing kept yet") }
            guard let theirs = rev(root, theirsName) else {
                // (nothing there yet: this side's is the first)
                do { try push(root, access); return .pushed(count(root, ours)) } catch { return .unreachable("\(error)") }
            }
            if ours == theirs { return did }
            if !Git.run(["merge-base", ours, theirs], in: root).ok {
                return .refused("the repository already holds something else (no version in common with this project). Link an empty repository, or get that one into a folder of its own")
            }
            let ab = Git.run(["rev-list", "--left-right", "--count", "\(ours)...\(theirs)"], in: root).text.split(whereSeparator: { $0 == "\t" || $0 == " " }).compactMap { Int($0) }
            let (ahead, behind) = (ab.first ?? 0, ab.count > 1 ? ab[1] : 0)
            if behind == 0 {
                do { try push(root, access); return came > 0 ? .merged(came) : .pushed(ahead) } catch { continue } // (the other side moved meanwhile: fetch again)
            }
            if ahead == 0 {
                // only they have new commits: the folder becomes what theirs has, the branch follows — where the folder still is what the last commit has
                let m = Git.run(["merge", "--ff-only", "-q", theirs], in: root)
                if !m.ok { return .refused("the folder changed meanwhile") }
                return .pulled(behind)
            }
            // both have commits of their own: joined, nothing touched until it is known to go
            let j = joinResult(root, ours, theirs)
            guard let tree = j.tree else { throw HistoryError("could not join") }
            if !j.conflicts.isEmpty { return .conflict(j.conflicts.map { $0.path }) }
            if !(try join(root, sym, ours, theirs, tree, stamp)) { return .refused("the folder changed meanwhile") }
            came = behind
            did = .merged(behind)
        }
        return .unreachable("the other side kept changing")
    }

    /// The commit that joins two lines; the folder becomes what its tree has, then the branch points to it. false: the folder changed meanwhile.
    static func join(_ root: String, _ branchRef: String, _ ours: String, _ theirs: String, _ tree: String, _ stamp: Stamp) throws -> Bool {
        let message = "Joined with what another device kept\n\nDevice: \(stamp.device)\nClient: \(stamp.client)\n"
        let c = Git.run(["commit-tree", tree, "-m", message, "-p", ours, "-p", theirs], in: root, env: Hist.env(stamp, in: root))
        guard c.ok else { throw HistoryError(say(c)) }
        let co = Git.run(["read-tree", "-m", "-u", ours, tree], in: root)
        if !co.ok { return false }
        let u = Git.run(["update-ref", "-m", "joined", branchRef, c.text], in: root)
        guard u.ok else { throw HistoryError(say(u)) }
        return true
    }

    // MARK: conflicts

    private static func joining(_ root: String) throws -> (sym: String, ours: String, theirs: String, tree: String, conflicts: [(path: String, stages: [Int: (String, String)])]) {
        let sym = Git.run(["symbolic-ref", "-q", "HEAD"], in: root).text
        guard !sym.isEmpty else { throw HistoryError("no branch yet") }
        let short = sym.hasPrefix("refs/heads/") ? String(sym.dropFirst(11)) : sym
        guard let ours = rev(root, sym), let theirs = rev(root, "refs/remotes/\(remote)/\(short)") else { throw HistoryError("nothing fetched yet") }
        let j = joinResult(root, ours, theirs)
        guard let tree = j.tree else { throw HistoryError("could not join") }
        return (sym, ours, theirs, tree, j.conflicts)
    }

    /// The files that keep the project from going to the other side, as it was last fetched. Empty: nothing does.
    static func stuck(_ root: String) -> [String] {
        (try? joining(root).conflicts.map { $0.path }) ?? []
    }

    private static func textOf(_ root: String, _ oid: String?) -> String? {
        guard let oid else { return nil }
        let r = Git.run(["cat-file", "blob", oid], in: root)
        guard r.ok, r.out.count <= textLimit, !r.out.contains(0) else { return nil }
        return String(data: r.out, encoding: .utf8)
    }

    /// A file merged with the places that differ marked, cut into parts: { same } where both sides agree, { mine, theirs, base } where both changed.
    static func parts(_ merged: String) -> [[String: Any]] {
        func line(_ c: String) -> String { String(repeating: c, count: mark) }
        let (open, base, mid, close) = (line("<"), line("|"), line("="), line(">"))
        var out: [[String: Any]] = []
        var same = "", mine = "", was = "", theirs = ""
        var at = 0
        var rest = Substring(merged)
        while !rest.isEmpty {
            let nl = rest.firstIndex(of: "\n").map { rest.index(after: $0) } ?? rest.endIndex
            let l = String(rest[rest.startIndex..<nl]); rest = rest[nl...]
            if at == 0 && l.hasPrefix(open) { if !same.isEmpty { out.append(["same": same]); same = "" }; at = 1 }
            else if at == 1 && l.hasPrefix(base) { at = 2 }
            else if (at == 1 || at == 2) && l.trimmingCharacters(in: .newlines).trimmingCharacters(in: CharacterSet(charactersIn: "\r")) == mid { at = 3 }
            else if at == 3 && l.hasPrefix(close) { out.append(["mine": mine, "base": was, "theirs": theirs]); mine = ""; was = ""; theirs = ""; at = 0 }
            else { switch at { case 0: same += l; case 1: mine += l; case 2: was += l; default: theirs += l } }
        }
        if !same.isEmpty { out.append(["same": same]) }
        return out
    }

    /// Who a commit is by, for the page: the device it names (else its author), and when.
    static func by(_ root: String, _ commit: String) -> [String: Any] {
        let r = Git.run(["log", "-1", "--format=%ct%x1f%an%x1f%B", commit], in: root)
        let p = r.raw.components(separatedBy: "\u{1f}")
        guard p.count >= 3 else { return ["device": "", "time": 0] }
        return ["device": Hist.trailer(p[2], "Device") ?? p[1], "time": Int(p[0]) ?? 0]
    }

    /// What stands in the way of joining the project with its other side, for the user to say. Nothing is changed.
    static func conflicts(_ root: String) throws -> [String: Any] {
        let j = try joining(root)
        var files: [[String: Any]] = []
        let tmp = NSTemporaryDirectory() + "mdview-conflict-\(UUID().uuidString)"
        try Lib.fm.createDirectory(atPath: tmp, withIntermediateDirectories: true)
        defer { try? Lib.fm.removeItem(atPath: tmp) }
        for c in j.conflicts {
            let (a, o, t) = (c.stages[1], c.stages[2], c.stages[3])
            let (mine, their) = (textOf(root, o?.1), textOf(root, t?.1))
            var file: [String: Any] = ["path": c.path, "kind": "file", "mine": o != nil, "theirs": t != nil]
            if let mine, let their, o != nil, t != nil {
                var merged: String?
                if let a, let base = Git.run(["cat-file", "blob", a.1], in: root).out as Data? {
                    let (pm, pb, pt) = (tmp + "/m", tmp + "/b", tmp + "/t")
                    try mine.write(toFile: pm, atomically: false, encoding: .utf8)
                    try base.write(to: URL(fileURLWithPath: pb))
                    try their.write(toFile: pt, atomically: false, encoding: .utf8)
                    let r = Git.run(["merge-file", "-p", "--diff3", "--marker-size=\(mark)", "-L", "mine", "-L", "base", "-L", "theirs", pm, pb, pt], in: root)
                    if r.status >= 0 && r.status < 128 { merged = String(data: r.out, encoding: .utf8) }
                }
                file["kind"] = "text"
                file["parts"] = merged.map { parts($0) } ?? [["mine": mine, "base": "", "theirs": their]] // (made on both sides: the whole of it is the place)
            }
            files.append(file)
        }
        files.sort { ($0["path"] as? String ?? "") < ($1["path"] as? String ?? "") }
        return ["theirs": j.theirs, "mine": by(root, j.ours), "their": by(root, j.theirs), "files": files]
    }

    /// The name a file gets beside the one it would have: "Note (device).md".
    static func beside(_ path: String, _ device: String) -> String {
        let d = String((device.components(separatedBy: " (").first ?? "").filter { !"/\\:".contains($0) })
        let dir = path.contains("/") ? String(path[..<path.lastIndex(of: "/")!]) : ""
        let name = path.contains("/") ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
        var stem = name, ext = ""
        if let dot = name.lastIndex(of: "."), dot != name.startIndex { stem = String(name[..<dot]); ext = String(name[dot...]) }
        return "\(dir)\(dir.isEmpty ? "" : "/")\(stem) (\(d.isEmpty ? "other device" : d))\(ext)"
    }

    /// The user said how it is to be: for every file in conflict a pick — { text } or { take: "mine" | "theirs" | "both" }.
    /// expect: the commit of the other side the picks were made against.
    static func resolve(_ root: String, expect: String, picks: [String: Any], _ access: Access, _ stamp: Stamp) -> SyncStanding {
        do {
            if try resolveIn(root, expect: expect, picks: picks, stamp) { return reconcile(root, access, stamp) }
            return .refused("the folder changed meanwhile")
        } catch { return .refused("\(error)") }
    }

    private static func resolveIn(_ root: String, expect: String, picks: [String: Any], _ stamp: Stamp) throws -> Bool {
        _ = try Hist.snapshot(root, stamp)
        let j = try joining(root)
        if j.theirs != expect { throw HistoryError("the other side has changed since: look again") }
        let theirDevice = (by(root, j.theirs)["device"] as? String) ?? ""
        let idx = NSTemporaryDirectory() + "mdview-resolve-\(UUID().uuidString)"
        defer { try? Lib.fm.removeItem(atPath: idx) }
        let env = ["GIT_INDEX_FILE": idx]
        let rt = Git.run(["read-tree", j.tree], in: root, env: env)
        guard rt.ok else { throw HistoryError(say(rt)) }
        func put(_ mode: String, _ oid: String, _ path: String) throws {
            let u = Git.run(["update-index", "--add", "--cacheinfo", "\(mode),\(oid),\(path)"], in: root, env: env)
            if !u.ok { throw HistoryError(say(u)) }
        }
        func drop(_ path: String) { Git.run(["update-index", "--force-remove", "--", path], in: root, env: env) }
        for c in j.conflicts {
            guard let pick = picks[c.path] as? [String: Any] else { throw HistoryError("nothing said for \(c.path)") }
            let (o, t) = (c.stages[2], c.stages[3])
            let mode = o?.0 ?? t?.0 ?? "100644"
            if let text = pick["text"] as? String {
                let h = Git.run(["hash-object", "-w", "--stdin"], in: root, input: Data(text.utf8))
                guard h.ok else { throw HistoryError(say(h)) }
                try put(mode, h.text, c.path)
                continue
            }
            switch pick["take"] as? String {
            case "mine": if let o { try put(o.0, o.1, c.path) } else { drop(c.path) }
            case "theirs": if let t { try put(t.0, t.1, c.path) } else { drop(c.path) }
            case "both":
                switch (o, t) {
                case let (o?, t?): try put(o.0, o.1, c.path); try put(t.0, t.1, beside(c.path, theirDevice))
                case let (e?, nil), let (nil, e?): try put(e.0, e.1, c.path)
                default: break
                }
            default: throw HistoryError("nothing said for \(c.path)")
            }
        }
        let w = Git.run(["write-tree"], in: root, env: env)
        guard w.ok else { throw HistoryError(say(w)) }
        return try join(root, j.sym, j.ours, j.theirs, w.text, stamp)
    }
}
