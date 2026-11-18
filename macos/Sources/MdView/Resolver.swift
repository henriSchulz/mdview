// Where a [[wikilink]] leads, as Obsidian does it: next to the note, at the vault root, then anywhere below the root
// by file name — src-tauri/src/scan.rs `Resolver`.
import Foundation

final class Resolver {
    let noteDir: String
    var vault: String?
    var base: String?
    private var index: [String: [String]]?
    private var retried = false
    /// The index is an older walk's, or one cut short: a name not in it may yet be on the disk.
    private var mayBeStale = false
    private static var kept: [String: (Date, [String: [String]])] = [:]

    init(noteDir: String, base: String?) {
        self.noteDir = noteDir
        var d = noteDir
        let home = Lib.home()
        while true {
            if Lib.isDir(Lib.join(d, ".obsidian")) { vault = d; break }
            if d == home || d == "/" || d.isEmpty { break }
            d = Lib.dir(d)
        }
        if vault == nil {
            if let b = base, noteDir == b || noteDir.hasPrefix(b + "/") { self.base = b }
            else {
                var d = noteDir
                while d != "/" && !d.isEmpty && d != home {
                    if Lib.exists(Lib.join(d, ".git")) { self.base = d; break }
                    d = Lib.dir(d)
                }
            }
        }
    }

    private var root: String { vault ?? base ?? noteDir }

    private func buildIndex() -> [String: [String]] {
        if let i = index { return i }
        if let (at, idx) = Resolver.kept[root], Date().timeIntervalSince(at) < 8 { index = idx; mayBeStale = true; return idx }
        var idx: [String: [String]] = [:]
        let deadline = Date().addingTimeInterval(2.5)
        var stack = [root], count = 0
        // (what is needed of each entry comes with the listing — one call per folder, not two per file: the walk held the
        // main thread 85–95 ms over a folder of 450 notes, each time the kept index was older than its while; 2026-11-18)
        let keys: [URLResourceKey] = [.isDirectoryKey, .isSymbolicLinkKey]
        while let dir = stack.popLast(), Date() < deadline, count < 200_000 {
            for url in (try? Lib.fm.contentsOfDirectory(at: URL(fileURLWithPath: dir, isDirectory: true), includingPropertiesForKeys: keys, options: [])) ?? [] {
                let name = url.lastPathComponent
                let p = Lib.join(dir, name)
                let v = try? url.resourceValues(forKeys: Set(keys))
                let link = v?.isSymbolicLink == true
                if link ? Lib.isDir(p) : v?.isDirectory == true {
                    // (a link to a folder is not gone into: a loop walked until the deadline — scan.rs files_under)
                    if !link && !name.hasPrefix(".") && !Lib.skipDirs.contains(name) { stack.append(p) }
                } else { idx[name.lowercased(), default: []].append(p); count += 1 }
            }
        }
        mayBeStale = !stack.isEmpty // (cut short)
        if Resolver.kept.count > 16 { Resolver.kept.removeAll() } // (never pruned before)
        Resolver.kept[root] = (Date(), idx)
        index = idx
        return idx
    }

    func resolve(_ target: String) -> String? {
        if let f = lookFor(target) { return f }
        // (once more only where the index may not say all — an older walk's, or one cut short: after a fresh whole walk a
        // name not in it is not there, and a dangling [[link]] cost two walks a drawing; scan.rs alike)
        if index != nil, !retried, mayBeStale {
            retried = true
            Resolver.kept[root] = nil
            index = nil
            return lookFor(target)
        }
        return nil
    }

    private func lookFor(_ target: String) -> String? {
        let name = target.split(omittingEmptySubsequences: false, whereSeparator: { "#^".contains($0) }).first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        if name.isEmpty { return nil }
        let cands = Lib.isMd(name) ? [name] : [name + ".md", name]
        var bases = [noteDir]
        if let b = vault ?? base { bases.append(b) }
        for c in cands { for b in bases where Lib.isFile(Lib.join(b, c)) { return Lib.resolve(Lib.join(b, c)) } }
        let idx = buildIndex()
        for c in cands {
            let file = Lib.name(c).lowercased()
            guard var hits = idx[file] else { continue }
            if c.contains("/") {
                let tail = "/" + c.lowercased()
                let narrowed = hits.filter { $0.lowercased().hasSuffix(tail) }
                if !narrowed.isEmpty { hits = narrowed }
            }
            return hits.min { a, b in
                let pa = !a.hasPrefix(noteDir), pb = !b.hasPrefix(noteDir)
                if pa != pb { return !pa }
                let da = a.filter { $0 == "/" }.count, db = b.filter { $0 == "/" }.count
                return da != db ? da < db : a < b
            }
        }
        return nil
    }
}
