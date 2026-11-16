// Small things about files and names that the shell shares — src-tauri/src/scan.rs (the kinds, the
// order, a note's title) and the helpers at the top of shell.rs.
import Foundation

enum Lib {
    static let mdExt: Set<String> = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"]
    static let textExt: Set<String> = ["txt", "text"]
    static let imgExt: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"]
    static let audioExt: Set<String> = ["mp3", "wav", "ogg", "m4a", "flac", "opus", "webm"]
    static let videoExt: Set<String> = ["mp4", "mkv", "mov", "ogv"]
    static let slidesExt: Set<String> = ["pptx", "ppt", "pps", "ppsx", "odp"]
    static let skipDirs: Set<String> = ["node_modules", "__pycache__", "target", "venv", ".venv", "dist", "build"]
    static let assets = "assets"

    static let fm = FileManager.default

    static func ext(_ p: String) -> String { (p as NSString).pathExtension.lowercased() }
    static func name(_ p: String) -> String { (p as NSString).lastPathComponent }
    static func dir(_ p: String) -> String { (p as NSString).deletingLastPathComponent }
    static func join(_ a: String, _ b: String) -> String { (a as NSString).appendingPathComponent(b) }
    static func isMd(_ p: String) -> Bool { mdExt.contains(ext(p)) }
    static func isText(_ p: String) -> Bool { textExt.contains(ext(p)) }
    static func isPDF(_ p: String) -> Bool { ext(p) == "pdf" }
    static func isSlides(_ p: String) -> Bool { slidesExt.contains(ext(p)) }
    static func shownAsPDF(_ p: String) -> Bool { isPDF(p) || isSlides(p) }
    static func isBoard(_ p: String) -> Bool { name(p).lowercased().hasSuffix(".board.svg") }
    static func isDir(_ p: String) -> Bool { var d: ObjCBool = false; return fm.fileExists(atPath: p, isDirectory: &d) && d.boolValue }
    static func isFile(_ p: String) -> Bool { var d: ObjCBool = false; return fm.fileExists(atPath: p, isDirectory: &d) && !d.boolValue }
    static func exists(_ p: String) -> Bool { fm.fileExists(atPath: p) }

    static func kind(_ p: String) -> String {
        let e = ext(p)
        if mdExt.contains(e) { return "md" }
        if imgExt.contains(e) { return "image" }
        if audioExt.contains(e) { return "audio" }
        if videoExt.contains(e) { return "video" }
        if e == "pdf" { return "pdf" }
        if slidesExt.contains(e) { return "slides" }
        return "file"
    }

    /// The path made absolute, links followed where the file exists.
    static func resolve(_ p: String) -> String {
        let url = URL(fileURLWithPath: (p as NSString).expandingTildeInPath)
        if let r = realpath(url.path, nil) { defer { free(r) }; return String(cString: r) }
        return url.standardizedFileURL.path
    }

    static func mtime(_ p: String) -> Double {
        ((try? fm.attributesOfItem(atPath: p)[.modificationDate]) as? Date)?.timeIntervalSince1970 ?? 0
    }

    static func read(_ p: String, limit: Int? = nil) -> String? {
        guard let h = FileHandle(forReadingAtPath: p) else { return nil }
        defer { try? h.close() }
        let data = limit.map { h.readData(ofLength: $0) } ?? h.readDataToEndOfFile()
        return String(decoding: data, as: UTF8.self)
    }

    /// "note 2" before "note 10": digits compared as numbers, the rest without case.
    static func natural(_ a: String, _ b: String) -> Bool {
        func parts(_ s: String) -> [(Bool, String)] {
            var out: [(Bool, String)] = []
            for c in s.lowercased() {
                let d = c.isASCII && c.isNumber
                if let last = out.last, last.0 == d { out[out.count - 1].1.append(c) } else { out.append((d, String(c))) }
            }
            return out
        }
        let (x, y) = (parts(a), parts(b))
        for (p, q) in zip(x, y) {
            if p.0 && q.0 {
                let m = p.1.drop { $0 == "0" }, n = q.1.drop { $0 == "0" }
                if m.count != n.count { return m.count < n.count }
                if m != n { return m < n }
            } else if p.0 != q.0 { return p.0 } else if p.1 != q.1 { return p.1 < q.1 }
        }
        return x.count < y.count
    }

    /// A typed name as a safe file name (no path, not hidden).
    static func clean(_ name: String) -> String {
        var s = name.unicodeScalars.map { ($0.value < 32 || $0 == "/" || $0 == "\\") ? " " : String($0) }.joined()
        s = s.trimmingCharacters(in: .whitespaces)
        while s.hasPrefix(".") || s.hasPrefix(" ") { s.removeFirst() }
        return s
    }

    static func rx(_ pattern: String, _ opts: NSRegularExpression.Options = []) -> NSRegularExpression {
        try! NSRegularExpression(pattern: pattern, options: opts)
    }
    private static let fenceRx = rx(#"^\s*(`{3,}|~{3,})(.*)$"#)
    private static let h1Rx = rx(#"^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$"#)
    private static let wikiRx = rx(#"!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]"#)
    private static let linkRx = rx(#"!?\[([^\]]*)\]\([^)]*\)"#)
    private static let markRx = rx(#"(\*\*|__|~~|==|[*`])"#)

    static func sub(_ r: NSRegularExpression, _ s: String, _ t: String) -> String {
        r.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: t)
    }
    static func first(_ r: NSRegularExpression, _ s: String) -> [String]? {
        guard let m = r.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) else { return nil }
        return (0..<m.numberOfRanges).map { Range(m.range(at: $0), in: s).map { String(s[$0]) } ?? "" }
    }

    /// The first H1 of a note (frontmatter and code blocks skipped), or nil.
    static func noteTitle(_ path: String) -> String? {
        guard let text = read(path, limit: 16 * 1024) else { return nil }
        let lines = text.components(separatedBy: "\n")
        var start = 0
        if lines.first?.trimmingCharacters(in: .whitespaces) == "---",
           let i = (1..<max(lines.count, 1)).first(where: { ["---", "..."].contains(lines[$0].trimmingCharacters(in: .whitespaces)) }) { start = i + 1 }
        var fence: String?
        for line in lines.dropFirst(min(start, lines.count)) {
            let m = first(fenceRx, line)
            if let open = fence {
                if let m, m[1].first == open.first, m[1].count >= open.count, m[2].trimmingCharacters(in: .whitespaces).isEmpty { fence = nil }
                continue
            }
            if let m { fence = m[1]; continue }
            if let m = first(h1Rx, line) {
                var t = sub(wikiRx, m[1], "$1")
                t = sub(linkRx, t, "$1")
                t = sub(markRx, t, "")
                t = t.trimmingCharacters(in: .whitespaces)
                return t.isEmpty ? nil : t
            }
        }
        return nil
    }

    /// What a note's first line says, as a file's name: Markdown's marks left out, 60 letters at most.
    static func titleName(_ text: String) -> String {
        let first = text.components(separatedBy: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty && !$0.hasPrefix("---") && !$0.hasPrefix("<!--") } ?? ""
        var plain = String(first.drop { "#>-*+ ".contains($0) })
        for p in ["[ ] ", "[x] "] where plain.hasPrefix(p) { plain.removeFirst(p.count) }
        plain = plain.filter { !"*_`$[]".contains($0) }
        var name = clean(String(plain.trimmingCharacters(in: .whitespaces).prefix(60))).trimmingCharacters(in: .whitespaces)
        while name.hasSuffix(".") { name.removeLast() }
        return name
    }

    /// The first name beside the note that is free for `name` ("name.md", "name 2.md" …); the note's own counts as free.
    static func freeName(_ path: String, _ name: String) -> String? {
        let d = dir(path)
        return (1..<100).map { join(d, $0 == 1 ? "\(name).md" : "\(name) \($0).md") }.first { $0 == path || !exists($0) }
    }

    /// A file's name in two: what is kept when a number is put in, and its ending.
    static func nameParts(_ p: String) -> (String, String) {
        let n = name(p)
        if isDir(p) { return (n, "") }
        if isBoard(p) { return (String(n.dropLast(".board.svg".count)), String(n.suffix(".board.svg".count))) }
        let e = (n as NSString).pathExtension
        let stem = (n as NSString).deletingPathExtension
        return e.isEmpty || stem.isEmpty ? (n, "") : (stem, "." + e)
    }

    /// src copied into dir — a folder with all that is in it — under the first free name: its own, then
    /// "Name 2.x" (copy: "Name copy.x", "Name copy 2.x"). Links are not followed.
    static func copyFree(_ src: String, into dir: String, copy: Bool) throws -> String {
        var (stem, ending) = nameParts(src)
        if copy { stem += " copy" }
        for n in 1..<1000 {
            let target = join(dir, n == 1 ? "\(stem)\(ending)" : "\(stem) \(n)\(ending)")
            if (try? fm.attributesOfItem(atPath: target)) != nil { continue }
            try copyTree(src, target, 0)
            return target
        }
        throw CocoaError(.fileWriteFileExists)
    }

    static func copyTree(_ src: String, _ target: String, _ depth: Int) throws {
        let t = try fm.attributesOfItem(atPath: src)[.type] as? FileAttributeType
        if t == .typeDirectory {
            if depth > 32 { throw CocoaError(.fileWriteUnknown) }
            try fm.createDirectory(atPath: target, withIntermediateDirectories: false)
            for e in try fm.contentsOfDirectory(atPath: src) { try copyTree(join(src, e), join(target, e), depth + 1) }
        } else if t == .typeRegular {
            try fm.copyItem(atPath: src, toPath: target)
        }
    }

    /// A new file in folder named by name(1), name(2) … — the first that is free.
    static func writeNew(_ folder: String, tries: Int = 1000, data: Data, name: (Int) -> String) throws -> String {
        try fm.createDirectory(atPath: folder, withIntermediateDirectories: true)
        for n in 1..<tries {
            let target = join(folder, name(n))
            let fd = open(target, O_WRONLY | O_CREAT | O_EXCL, 0o644)   // never over a file that is there
            if fd < 0 { if errno == EEXIST { continue }; throw CocoaError(.fileWriteUnknown) }
            defer { close(fd) }
            let ok = data.withUnsafeBytes { buf -> Bool in
                var off = 0
                while off < buf.count { let w = write(fd, buf.baseAddress! + off, buf.count - off); if w <= 0 { return false }; off += w }
                return true
            }
            if !ok { throw CocoaError(.fileWriteUnknown) }
            return target
        }
        throw CocoaError(.fileWriteFileExists)
    }

    /// A path relative to a base (for links).
    static func relative(_ target: String, _ base: String) -> String {
        let t = target.split(separator: "/"), b = base.split(separator: "/")
        var i = 0
        while i < t.count, i < b.count, t[i] == b[i] { i += 1 }
        return (Array(repeating: "..", count: b.count - i) + t[i...].map(String.init)).joined(separator: "/")
    }

    static func home() -> String { NSHomeDirectory() }
}
