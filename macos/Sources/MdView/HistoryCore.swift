// A folder's history: a project is a folder that holds both the app's marker (.mdview/project.json) and a Git
// repository. What changes in it is kept as commits, each naming the device it was made on. A repository without
// the marker is someone else's: it is read (versions, their text), never written to. Rust original: src-tauri/src/history.rs.
import Foundation

enum Place: Equatable {
    case none
    case project(String)
    case foreign(String)
    var root: String? {
        switch self { case .project(let r), .foreign(let r): return r; case .none: return nil }
    }
}

/// Who a commit is made by: the device, the program, and the author where one is known.
struct Stamp {
    var device: String          // "name (id)"
    var client: String          // "desktop 0.1.0"
    var author: (String, String)?
}

struct HistorySnapshot {
    var commit: String?
    var skipped: [String] = []
}

struct HistoryError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

enum Hist {
    static let marker = ".mdview/project.json"
    static let ignore = ".DS_Store\nThumbs.db\n"
    static let big: Int = 50 * 1024 * 1024
    static let named = 3
    static let logLimit = 500
    static let nestDepth = 12
    static let absorbed = "mdview-absorbed"
    static let absorbedKept: TimeInterval = 30 * 24 * 3600
    static let emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    static let fm = FileManager.default

    // MARK: where a path stands

    /// The nearest repository at or above the path decides: with the marker beside it, a project.
    static func placeOf(_ path: String) -> Place {
        var d = Lib.isDir(path) ? path : Lib.dir(path)
        while !d.isEmpty {
            if fm.fileExists(atPath: Lib.join(d, ".git")) {
                return Lib.isFile(Lib.join(d, marker)) ? .project(d) : .foreign(d)
            }
            if d == "/" { break }
            d = Lib.dir(d)
        }
        return .none
    }

    /// Where a folder stands, for the page: { state: "none" | "project" | "inside" | "foreign", own, was, name, root }.
    static func standing(_ folder: String) -> [String: Any] {
        func named(_ r: String) -> String { Lib.name(r).isEmpty ? r : Lib.name(r) }
        switch placeOf(folder) {
        case .none: return ["state": "none"]
        case .project(let r): return ["state": r == folder ? "project" : "inside", "name": named(r), "root": r]
        case .foreign(let r): return ["state": "foreign", "own": r == folder, "was": r == folder && wasProject(r), "name": named(r), "root": r]
        }
    }

    static func branch(_ root: String) -> String? {
        let r = Git.run(["symbolic-ref", "--short", "-q", "HEAD"], in: root)
        return r.ok && !r.text.isEmpty ? r.text : nil
    }

    static func headCommit(_ root: String) -> String? {
        let r = Git.run(["rev-parse", "--verify", "-q", "HEAD^{commit}"], in: root)
        return r.ok ? r.text : nil
    }

    static func trailer(_ message: String, _ key: String) -> String? {
        for l in message.components(separatedBy: "\n").reversed() where l.hasPrefix(key + ": ") {
            return String(l.dropFirst(key.count + 2)).trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

    /// The standing, and what the repository holds: its branch, how many commits, the last one, and in a project how many files wait.
    static func overview(_ folder: String) -> [String: Any] {
        var all = standing(folder)
        let place = placeOf(folder)
        guard let root = place.root else { return all }
        all["branch"] = branch(root) ?? NSNull()
        let n = Git.run(["rev-list", "--count", "HEAD"], in: root)
        all["versions"] = n.ok ? Int(n.text) ?? 0 : 0
        let last = Git.run(["log", "-1", "--format=%ct%x1f%an%x1f%s%x1f%B"], in: root)
        if last.ok, !last.text.isEmpty {
            let p = last.raw.components(separatedBy: "\u{1f}")
            if p.count >= 4 {
                let device = trailer(p[3], "Device") ?? p[1]
                all["last"] = ["time": Int(p[0]) ?? 0, "device": device, "subject": p[2]]
            }
        }
        if case .project = place {
            let inner = Inner(root)
            var n = 0
            let st = Git.run(["status", "--porcelain=v1", "-z", "-uall"], in: root)
            for entry in st.raw.split(separator: "\0", omittingEmptySubsequences: true) where entry.count > 3 {
                let rel = String(entry.dropFirst(3))
                if inner.has(rel) { continue }
                if let sz = (try? fm.attributesOfItem(atPath: Lib.join(root, rel)))?[.size] as? Int, sz > big { continue }
                n += 1
            }
            all["changed"] = n
        }
        return all
    }

    /// What of a project's folder is another repository's: none of it is this project's to keep.
    final class Inner {
        let root: String
        var known: [String: Bool] = [:]
        init(_ root: String) { self.root = root }
        func has(_ rel: String) -> Bool {
            let full = Lib.join(root, rel)
            var dirs: [String] = []
            var d = Lib.isDir(full) ? full : Lib.dir(full)
            while d != root && d.hasPrefix(root + "/") { dirs.append(d); d = Lib.dir(d) }
            for dir in dirs.reversed() {
                let k: Bool
                if let c = known[dir] { k = c } else { k = fm.fileExists(atPath: Lib.join(dir, ".git")); known[dir] = k }
                if k { return true }
            }
            return false
        }
    }

    /// The projects of the app's below a folder (not the folder itself, and none inside another repository).
    static func nested(_ root: String) -> [String] {
        var found: [String] = []
        func walk(_ dir: String, _ depth: Int) {
            for name in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] {
                if name.hasPrefix(".") || Lib.skipDirs.contains(name) { continue }
                let sub = Lib.join(dir, name)
                if !Lib.isDir(sub) { continue }
                if fm.fileExists(atPath: Lib.join(sub, ".git")) {
                    if Lib.isFile(Lib.join(sub, marker)) { found.append(sub) }
                } else if depth < nestDepth { walk(sub, depth + 1) }
            }
        }
        walk(root, 0)
        return found.sorted()
    }

    // MARK: identity

    static func env(_ stamp: Stamp, in root: String) -> [String: String] {
        var name: String, mail: String
        if let a = stamp.author { (name, mail) = a } else {
            let n = Git.run(["config", "user.name"], in: root).text, m = Git.run(["config", "user.email"], in: root).text
            if !n.isEmpty && !m.isEmpty { (name, mail) = (n, m) } else {
                let d = stamp.device.components(separatedBy: " (")[0]
                (name, mail) = (d.isEmpty ? "mdview" : d, "device@mdview.invalid")
            }
        }
        return ["GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": mail, "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": mail]
    }

    // MARK: switching on and off

    /// The folder becomes a project: a repository is made in it, or the one that is its own is taken over; the marker is written.
    static func enable(_ root: String) throws {
        switch placeOf(root) {
        case .project(let r):
            if r == root { return }
            throw HistoryError("already part of the project in \(r)")
        case .foreign(let r):
            if r != root { throw HistoryError("inside the repository in \(r)") }
        case .none:
            let r = Git.run(["init", "-q", "-b", "main"], in: root)
            if !r.ok { throw HistoryError(r.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
            let ig = Lib.join(root, ".gitignore")
            if !fm.fileExists(atPath: ig) { try ignore.write(toFile: ig, atomically: true, encoding: .utf8) }
        }
        let m = Lib.join(root, marker)
        try fm.createDirectory(atPath: Lib.dir(m), withIntermediateDirectories: true)
        // (a project whose history was switched off is itself again: the marker its last commit has)
        if let was = keptMarker(root) { try was.write(to: URL(fileURLWithPath: m)); return }
        let iso = ISO8601DateFormatter().string(from: Date())
        let text = "{\n  \"created\": \"\(iso)\",\n  \"id\": \"\(UUID().uuidString.lowercased())\",\n  \"version\": 1\n}\n"
        try text.write(toFile: m, atomically: true, encoding: .utf8)
    }

    static func keptMarker(_ root: String) -> Data? {
        let r = Git.run(["show", "HEAD:\(marker)"], in: root)
        return r.ok ? r.out : nil
    }

    static func wasProject(_ root: String) -> Bool { keptMarker(root) != nil }

    /// The project's history is switched off: what waits is kept, then the marker goes. The repository stays.
    static func disable(_ root: String, _ stamp: Stamp) throws {
        _ = try snapshot(root, stamp)
        try fm.removeItem(atPath: Lib.join(root, marker))
        rmdir(Lib.join(root, ".mdview")) // (only if nothing else is in it)
    }

    // MARK: snapshot

    static func subject(_ changed: [String], first: Bool) -> String {
        if first { return "History switched on" }
        let name = { (p: String) in Lib.name(p).isEmpty ? p : Lib.name(p) }
        if changed.count == 1 { return name(changed[0]) }
        let names = changed.prefix(Hist.named).map(name).joined(separator: ", ")
        return "\(changed.count) files: \(names)\(changed.count > Hist.named ? ", …" : "")"
    }

    static func stateClean(_ root: String) -> Bool {
        let g = Lib.join(root, ".git")
        for f in ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-merge", "rebase-apply"] where fm.fileExists(atPath: Lib.join(g, f)) { return false }
        return true
    }

    /// The project as it is now, kept as a commit — if anything changed since the last one.
    static func snapshot(_ root: String, _ stamp: Stamp) throws -> HistorySnapshot {
        guard placeOf(root) == .project(root) else { throw HistoryError("not a project: \(root)") }
        var done = HistorySnapshot()
        if !stateClean(root) { return done }
        pruneAbsorbed(root)
        // what is to be taken: the files git lists as tracked or new (the .gitignore's own left out), but no other repository's, none too large
        let listed = Git.run(["ls-files", "-z", "-c", "-o", "--exclude-standard"], in: root)
        guard listed.ok else { throw HistoryError(listed.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let inner = Inner(root)
        var take = Data()
        for rel in listed.raw.split(separator: "\0", omittingEmptySubsequences: true).map(String.init) {
            if rel.hasSuffix("/") { continue } // (an untracked repository of its own)
            if inner.has(rel) { continue }
            let full = Lib.join(root, rel)
            if let a = try? fm.attributesOfItem(atPath: full), (a[.type] as? FileAttributeType) == .typeRegular, (a[.size] as? Int ?? 0) > big {
                done.skipped.append(rel); continue
            }
            take.append(Data(rel.utf8)); take.append(0)
        }
        let up = Git.run(["update-index", "--add", "--remove", "-z", "--stdin"], in: root, input: take)
        if !up.ok { throw HistoryError(up.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let wt = Git.run(["write-tree"], in: root)
        guard wt.ok else { throw HistoryError(wt.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let tree = wt.text
        let parent = headCommit(root)
        let before = parent.map { Git.run(["rev-parse", "\($0)^{tree}"], in: root).text }
        if before == tree { return done }
        let diff = Git.run(["diff-tree", "-r", "--no-renames", "--name-only", "-z", before ?? emptyTree, tree], in: root)
        let changed = diff.raw.split(separator: "\0", omittingEmptySubsequences: true).map(String.init)
        let message = "\(subject(changed, first: parent == nil))\n\nDevice: \(stamp.device)\nClient: \(stamp.client)\n"
        var args = ["commit-tree", tree, "-m", message]
        if let parent { args += ["-p", parent] }
        let c = Git.run(args, in: root, env: env(stamp, in: root))
        guard c.ok else { throw HistoryError(c.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let u = Git.run(["update-ref", "-m", "mdview snapshot", "HEAD", c.text], in: root)
        guard u.ok else { throw HistoryError(u.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        done.commit = c.text
        return done
    }

    static func gitDir(_ root: String) -> String { Lib.join(root, ".git") }

    /// The repositories of projects taken in, once they have been kept long enough, go.
    static func pruneAbsorbed(_ root: String) {
        let dir = Lib.join(gitDir(root), absorbed)
        for n in (try? fm.contentsOfDirectory(atPath: dir)) ?? [] {
            let p = Lib.join(dir, n)
            if let d = (try? fm.attributesOfItem(atPath: p))?[.modificationDate] as? Date, Date().timeIntervalSince(d) > absorbedKept { try? fm.removeItem(atPath: p) }
        }
    }

    // MARK: projects below a project taken in

    /// A project below a project becomes a part of it, with its history: one commit whose parents are both projects' last,
    /// and whose tree is the outer project's with the inner one's at its folder.
    static func merge(_ root: String, child: String, _ stamp: Stamp) throws {
        guard placeOf(child) == .project(child), child.hasPrefix(root + "/") else { throw HistoryError("not a project below this one: \(child)") }
        _ = try snapshot(child, stamp)
        _ = try snapshot(root, stamp)
        let name = String(child.dropFirst(root.count + 1))
        guard let inner = headCommit(child) else { throw HistoryError("nothing kept in \(name) yet") }
        guard let ours = headCommit(root) else { throw HistoryError("nothing kept here yet") }
        // everything the inner repository holds, into the outer one
        let f = Git.run(["fetch", "-q", "--no-tags", child, inner], in: root)
        guard f.ok else { throw HistoryError(f.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let tmp = NSTemporaryDirectory() + "mdview-merge-\(UUID().uuidString)"
        defer { try? fm.removeItem(atPath: tmp) }
        func withIndex(_ file: String) -> [String: String] { ["GIT_INDEX_FILE": tmp + file] }
        // the inner project's tree without its marker
        var r = Git.run(["read-tree", inner], in: root, env: withIndex(".inner"))
        guard r.ok else { throw HistoryError(r.err) }
        Git.run(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ".mdview"], in: root, env: withIndex(".inner"))
        r = Git.run(["write-tree"], in: root, env: withIndex(".inner"))
        guard r.ok else { throw HistoryError(r.err) }
        let sub = r.text
        // … at its folder in the outer one's
        r = Git.run(["read-tree", ours], in: root, env: withIndex(".outer"))
        guard r.ok else { throw HistoryError(r.err) }
        Git.run(["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", name], in: root, env: withIndex(".outer"))
        r = Git.run(["read-tree", "--prefix=\(name)/", sub], in: root, env: withIndex(".outer"))
        guard r.ok else { throw HistoryError(r.err) }
        r = Git.run(["write-tree"], in: root, env: withIndex(".outer"))
        guard r.ok else { throw HistoryError(r.err) }
        let tree = r.text
        let message = "\(name) taken in, with its history\n\nDevice: \(stamp.device)\nClient: \(stamp.client)\n"
        let c = Git.run(["commit-tree", tree, "-m", message, "-p", ours, "-p", inner], in: root, env: env(stamp, in: root))
        guard c.ok else { throw HistoryError(c.err) }
        Git.run(["update-ref", "-m", "mdview merge", "HEAD", c.text], in: root)
        Git.run(["read-tree", tree], in: root)
        // the inner repository, aside; its marker, gone: the folder is the outer project's now
        let aside = Lib.join(gitDir(root), absorbed)
        try fm.createDirectory(atPath: aside, withIntermediateDirectories: true)
        let df = DateFormatter(); df.dateFormat = "yyyyMMdd-HHmmss"; df.timeZone = TimeZone(identifier: "UTC")
        let slot = Lib.join(aside, "\(name.replacingOccurrences(of: "/", with: "-"))-\(df.string(from: Date()))")
        try fm.moveItem(atPath: Lib.join(child, ".git"), toPath: slot)
        try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: slot)
        keepOn(root, child: child, name: name)
        try fm.removeItem(atPath: Lib.join(child, ".mdview"))
        _ = try? snapshot(root, stamp) // (what came over is kept as the outer project's at once)
    }

    /// What the inner project kept of its own goes on as the outer one's — it was deleted with its marker (review
    /// 2026-11-17): the ink drawn on its PDFs (named by what a PDF holds: the same name in the outer folder; one there
    /// already stays), which of its files are hidden and how its folders look (by their path in it: now below its folder).
    /// Its links shared stay with its repository, which is aside now.
    static func keepOn(_ root: String, child: String, name: String) {
        let inner = Lib.join(child, ".mdview/pdf"), outer = Lib.join(root, ".mdview/pdf")
        if let inks = try? fm.contentsOfDirectory(atPath: inner), !inks.isEmpty {
            try? fm.createDirectory(atPath: outer, withIntermediateDirectories: true)
            for f in inks where !Lib.exists(Lib.join(outer, f)) { try? fm.moveItem(atPath: Lib.join(inner, f), toPath: Lib.join(outer, f)) }
        }
        let hidden = Hidden.read(child)
        if !hidden.isEmpty { try? Hidden.write(root, Hidden.read(root).union(hidden.map { "\(name)/\($0)" })) }
        let looks = Looks.read(child)
        if !looks.isEmpty {
            var all = Looks.read(root)
            for (k, v) in looks { let key = k.isEmpty ? name : "\(name)/\(k)"; if all[key] == nil { all[key] = v } }
            try? Looks.write(root, all)
        }
    }

    // MARK: versions

    /// The repository a file is in, and the file's path in it.
    static func within(_ path: String) throws -> (String, String) {
        guard let root = placeOf(path).root, path.hasPrefix(root + "/") else { throw HistoryError("no history here") }
        return (root, String(path.dropFirst(root.count + 1)))
    }

    struct Info { var parents: [String]; var time: Int; var author: String; var subject: String; var message: String }

    static func commits(_ root: String) -> [String: Info] {
        let r = Git.run(["log", "--format=%H%x1f%P%x1f%ct%x1f%an%x1f%s%x1f%B%x1e", "HEAD"], in: root)
        var out: [String: Info] = [:]
        for rec in r.raw.components(separatedBy: "\u{1e}") {
            let p = rec.trimmingCharacters(in: .newlines).components(separatedBy: "\u{1f}")
            if p.count < 6 { continue }
            out[p[0]] = Info(parents: p[1].split(separator: " ").map(String.init), time: Int(p[2]) ?? 0, author: p[3], subject: p[4], message: p[5])
        }
        return out
    }

    /// The name a file had in the commit before, if this commit gave it the one it has.
    static func renamedFrom(_ root: String, _ parent: String, _ commit: String, _ rel: String) -> String? {
        let r = Git.run(["diff-tree", "-r", "-M", "--name-status", "-z", parent, commit], in: root)
        let f = r.raw.split(separator: "\0", omittingEmptySubsequences: false).map(String.init)
        var i = 0
        while i < f.count {
            let status = f[i]
            if status.hasPrefix("R"), i + 2 < f.count { if f[i + 2] == rel { return f[i + 1] }; i += 3 } else if status.isEmpty { i += 1 } else { i += 2 }
        }
        return nil
    }

    /// The versions of a file, newest first: [{ id, time, device, subject, path }]. A version is a commit in which the file is
    /// not what it was in the commit before. Where the file came to its name by being renamed, the versions go on under the old one.
    static func log(_ path: String) throws -> [[String: Any]] {
        let (root, rel0) = try within(path)
        guard let head = headCommit(root) else { return [] }
        let info = commits(root)
        let batch = BatchCheck(repo: root)
        var ahead: [(Int, String, String)] = []   // (time, id, rel)
        var seen: Set<String> = []
        func go(_ id: String, _ rel: String) {
            guard let c = info[id], seen.insert(id).inserted else { return }
            ahead.append((c.time, id, rel))
        }
        go(head, rel0)
        var versions: [[String: Any]] = []
        while !ahead.isEmpty {
            var best = 0
            for i in ahead.indices where (ahead[i].0, ahead[i].1) > (ahead[best].0, ahead[best].1) { best = i }
            let (_, id, rel) = ahead.remove(at: best)
            guard let commit = info[id] else { continue }
            guard let here = batch.blob(id, rel) else {
                // (not at this name here: the line it is looked for in goes on)
                if let p = commit.parents.first { go(p, rel) }
                continue
            }
            let with = commit.parents.filter { batch.blob($0, rel) != nil }
            if let same = with.first(where: { batch.blob($0, rel) == here }) { go(same, rel); continue }
            var came: (String, String)?
            if with.isEmpty { for p in commit.parents { if let old = renamedFrom(root, p, id, rel) { came = (p, old); break } } }
            let onlyMoved = came.map { batch.blob($0.0, $0.1) == here } ?? false
            if !onlyMoved {
                let device = trailer(commit.message, "Device") ?? commit.author
                versions.append(["id": id, "time": commit.time, "device": device, "subject": commit.subject, "path": rel])
                if versions.count >= logLimit { break }
            }
            if let (p, old) = came { go(p, old) } else { for p in with { go(p, rel) } }
        }
        return versions
    }

    /// A file as it was in a version (at: its place in the repository then, where it had another name).
    static func text(_ path: String, id: String, at: String?) throws -> Data {
        let (root, rel) = try within(path)
        guard id.allSatisfy({ $0.isHexDigit }) else { throw HistoryError("not a version") }
        let r = Git.run(["cat-file", "blob", "\(id):\(at ?? rel)"], in: root)
        guard r.ok else { throw HistoryError(r.err.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return r.out
    }
}
