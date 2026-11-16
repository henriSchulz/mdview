// Where a [[wikilink]] leads, as Obsidian does it: next to the note, at the vault root, then anywhere below the root
// by file name — src-tauri/src/scan.rs `Resolver`.
import Foundation

final class Resolver {
    let noteDir: String
    var vault: String?
    var base: String?
    private var index: [String: [String]]?
    private var retried = false
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
        if let (at, idx) = Resolver.kept[root], Date().timeIntervalSince(at) < 8 { index = idx; return idx }
        var idx: [String: [String]] = [:]
        let deadline = Date().addingTimeInterval(2.5)
        var stack = [root], count = 0
        while let dir = stack.popLast(), Date() < deadline, count < 200_000 {
            for name in (try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? [] {
                let p = Lib.join(dir, name)
                if Lib.isDir(p) {
                    if !name.hasPrefix(".") && !Lib.skipDirs.contains(name) { stack.append(p) }
                } else { idx[name.lowercased(), default: []].append(p); count += 1 }
            }
        }
        Resolver.kept[root] = (Date(), idx)
        index = idx
        return idx
    }

    func resolve(_ target: String) -> String? {
        if let f = lookFor(target) { return f }
        if index != nil, !retried {
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
