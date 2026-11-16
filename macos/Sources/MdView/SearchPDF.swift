// A PDF in the window: the page gets its name and the links to it, the bytes on request — and a presentation shown as the
// PDF LibreOffice makes of it. Rust: shell.rs (render_pdf, send_pdf), slides.rs, scan.rs (pdf_backlinks).
import AppKit
import CryptoKit

// MARK: slides.rs

/// A presentation (PowerPoint, Impress) shown as the PDF LibreOffice makes of it: made once, in a thread of its own, and
/// kept in the cache under the file's path, size and time — the PDF viewer shows it, read only. Without LibreOffice
/// (`soffice`) the viewer says that it is needed.
enum Slides {
    enum Ready { case pdf(String), failed(String), notYet }

    /// (longer, and it is given up: a presentation LibreOffice cannot finish)
    static let atMost: TimeInterval = 180
    private static let lock = NSLock()
    private static var failed: [String: String] = [:]
    private static var making: [String: [() -> Void]] = [:]
    /// (one LibreOffice at a time: two on one profile get in each other's way)
    private static let queue = DispatchQueue(label: "mdview.slides", qos: .utility)

    static var dir: String { Lib.join(Lib.home(), "Library/Caches/MdView/slides") }

    /// The file as it is now: its path, size and time, made short.
    private static func key(_ src: String) -> String? {
        var st = stat()
        guard stat(src, &st) == 0 else { return nil }
        let ns = Int64(st.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(st.st_mtimespec.tv_nsec)
        var sha = SHA256()
        sha.update(data: Data(Lib.resolve(src).utf8))
        sha.update(data: Data("\0\(st.st_size)\0\(ns)".utf8))
        return sha.finalize().prefix(16).map { String(format: "%02x", $0) }.joined()
    }

    static func ready(_ src: String) -> Ready {
        guard let k = key(src) else { return .failed("Can't read the presentation") }
        lock.lock(); let f = failed[k]; lock.unlock()
        if let f { return .failed(f) }
        let pdf = Lib.join(dir, "\(k).pdf")
        return Lib.isFile(pdf) ? .pdf(pdf) : .notYet
    }

    /// Makes the PDF of src in a thread of its own — or waits for the one making it already; `done` (made or failed) is
    /// called then, on the main thread. → whether it was started now
    @discardableResult static func make(_ src: String, done: @escaping () -> Void) -> Bool {
        guard let k = key(src) else { return false }
        lock.lock()
        if making[k] != nil { making[k]!.append(done); lock.unlock(); return false }
        making[k] = [done]
        lock.unlock()
        queue.async {
            if let e = convert(src, k) { lock.lock(); failed[k] = e; lock.unlock() }
            lock.lock(); let waiting = making.removeValue(forKey: k) ?? []; lock.unlock()
            DispatchQueue.main.async { waiting.forEach { $0() } }
        }
        return true
    }

    private static func soffice() -> String? {
        var dirs = (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        dirs += ["/opt/homebrew/bin", "/usr/local/bin"]
        for d in dirs where Lib.fm.isExecutableFile(atPath: Lib.join(d, "soffice")) { return Lib.join(d, "soffice") }
        for p in ["/Applications/LibreOffice.app/Contents/MacOS/soffice", Lib.join(Lib.home(), "Applications/LibreOffice.app/Contents/MacOS/soffice")]
        where Lib.fm.isExecutableFile(atPath: p) { return p }
        return nil
    }

    /// → what went wrong, or nil
    private static func convert(_ src: String, _ k: String) -> String? {
        let out = Lib.join(dir, "making-\(k)")
        try? Lib.fm.removeItem(atPath: out)
        do { try Lib.fm.createDirectory(atPath: out, withIntermediateDirectories: true) } catch { return "Can't make the cache: \(searchErr(error))" }
        defer { try? Lib.fm.removeItem(atPath: out) }
        guard let exe = soffice() else { return "LibreOffice is needed to show presentations (soffice was not found)" }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        // (a profile of its own: a LibreOffice the user has open is left alone, and is not handed the work)
        p.arguments = ["-env:UserInstallation=file://\(Lib.join(dir, "profile"))", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", out, src]
        p.standardInput = FileHandle.nullDevice; p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return "Couldn't start LibreOffice: \(searchErr(error))" }
        let start = Date()
        while p.isRunning {
            if Date().timeIntervalSince(start) > atMost { p.terminate(); p.waitUntilExit(); return "LibreOffice took too long for this presentation" }
            Thread.sleep(forTimeInterval: 0.1)
        }
        guard let made = ((try? Lib.fm.contentsOfDirectory(atPath: out)) ?? []).first(where: { Lib.ext($0) == "pdf" }) else {
            return "LibreOffice could not read this presentation"
        }
        let to = Lib.join(dir, "\(k).pdf")
        try? Lib.fm.removeItem(atPath: to)
        do { try Lib.fm.moveItem(atPath: Lib.join(out, made), toPath: to) } catch { return "Can't keep the PDF: \(searchErr(error))" }
        return nil
    }
}

// MARK: scan.rs — the links to a PDF in the notes (what the viewer shows as highlights)

private let pdfLinkRx = Lib.rx(#"!?\[\[([^\]\[|#]+\.pdf)(?:#([^\]\[|]*))?(?:\|[^\]\[]*)?\]\]|\]\(<?([^)\s#>]+\.pdf)(?:#([^)\s>]*))?>?\)"#, .caseInsensitive)
private let shownWikiRx = Lib.rx(#"\s*!?\[\[[^\]]*\]\]"#)
private let shownLeadRx = Lib.rx(#"^\s*(?:>\s*)*(?:\[![^\]]*\]\s*)?"#)
private let quoteLeadRx = Lib.rx(#"^\s*(?:>\s*)*"#)

/// The links to this PDF in the notes below root.
func searchPDFBacklinks(_ pdf: String, root: String) -> [[String: Any]] {
    let fileName = Lib.name(pdf)
    let name = fileName.lowercased(), quoted = searchQuote(fileName).lowercased()
    let deadline = Date().addingTimeInterval(1.5)
    var todo: [String] = []
    var stack = [root]
    while let dir = stack.popLast(), todo.count <= 5000, Date() <= deadline {
        var dirs: [String] = []
        for n in ((try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? []).sorted(by: Lib.natural) where !n.hasPrefix(".") {
            let p = Lib.join(dir, n)
            if Lib.isDir(p) { if !Lib.skipDirs.contains(n) { dirs.append(p) } } else if Lib.isMd(p) { todo.append(p) }
        }
        stack.append(contentsOf: dirs.reversed())
    }
    var out: [[String: Any]] = []
    for (seen, p) in todo.enumerated() {
        if seen >= 5000 || Date() > deadline || out.count >= 2000 { break }
        guard let text = Lib.read(p, limit: 2_000_000) else { continue }
        let lower = text.lowercased()
        if !lower.contains(name) && !lower.contains(quoted) { continue }
        let lines = text.components(separatedBy: "\n")
        for (n, line) in lines.enumerated() {
            for m in pdfLinkRx.matches(in: line, range: NSRange(line.startIndex..., in: line)) {
                func g(_ i: Int) -> String { Range(m.range(at: i), in: line).map { String(line[$0]) } ?? "" }
                let (target, frag) = !g(1).isEmpty ? (g(1), g(2)) : ((g(3).removingPercentEncoding ?? g(3)), (g(4).removingPercentEncoding ?? g(4)))
                let targetName = Lib.name(target.trimmingCharacters(in: .whitespaces)).lowercased()
                if targetName != name || frag.isEmpty { continue }
                var shown = Lib.sub(shownWikiRx, line, "")
                shown = Lib.sub(shownLeadRx, shown, "").trimmingCharacters(in: .whitespaces)
                if shown.isEmpty {
                    // the quote of a callout stands in the line below its link
                    shown = Lib.sub(quoteLeadRx, n + 1 < lines.count ? lines[n + 1] : "", "").trimmingCharacters(in: .whitespaces)
                }
                out.append(["path": p, "name": Lib.name(p), "line": n, "frag": frag, "text": String(shown.prefix(240))])
                if out.count >= 2000 { return out }
            }
        }
    }
    return out
}

extension NoteWindow {
    /// A PDF (or a presentation as one) is the note on screen: the page gets its name and the links to it; the bytes on request.
    func renderPDF(fragment: String?) {
        guard let path else { return }
        var mtime = 0.0
        var error: Any = NSNull()
        if Lib.exists(path) { mtime = Lib.mtime(path) } else { error = "Can't read file: No such file or directory" }
        let root = resolver?.vault ?? folder ?? Lib.dir(path)
        modeGiven = true
        let backlinks = error is NSNull ? searchPDFBacklinks(path, root: root) : []
        js("MdView.render", [[
            "kind": "pdf", "text": "", "name": Lib.name(path), "path": path,
            "base": Page.fileURL(Lib.dir(path)) + "/", "readonly": Lib.isSlides(path) ? "a presentation" : "a PDF", "vault": false,
            "links": [String: Any](), "fragment": fragment as Any? ?? NSNull(), "error": error, "canBack": !back.isEmpty,
            "mtime": mtime, "backlinks": backlinks,
        ] as [String: Any]])
    }

    /// The bytes of a PDF for the page (it may not read files itself), in pieces. A presentation: the PDF made of it —
    /// until it is made, nothing is sent; it is asked for again when it is there.
    func sendPDF(_ path: String, _ id: String) {
        func fail(_ e: String) { js("MdView.pdfChunk", [id, 0, 1, "", e]) }
        var p = foundAsset(Lib.resolve(path))
        if Lib.isSlides(p) && Lib.isFile(p) {
            switch Slides.ready(p) {
            case .pdf(let pdf): p = pdf
            case .failed(let e): return fail(e)
            case .notYet:
                Slides.make(p) { [weak self] in self?.sendPDF(path, id) }
                return // (being made)
            }
        }
        guard Lib.isPDF(p), Lib.isFile(p) else { return fail("not a PDF file") }
        let size = (try? Lib.fm.attributesOfItem(atPath: p)[.size]) as? Int ?? 0
        if size > 300_000_000 { return fail("larger than 300 MB") }
        guard let data = Lib.fm.contents(atPath: p) else { return fail("Can't read file") }
        let step = 3_000_000
        let count = max(1, (data.count + step - 1) / step)
        for i in 0..<count {
            let part = data.subdata(in: (i * step)..<min(data.count, (i + 1) * step))
            js("MdView.pdfChunk", [id, i, count, part.base64EncodedString(), NSNull()])
        }
    }
}
