// One window: a WKWebView with the page, and the shell's half of the conversation — what the page says
// (MdHost.post -> `on`) and what the shell tells it (`js` -> MdView.…). The Rust original is src-tauri/src/shell.rs
// with shell/{messages,folder,tabs}.rs. The window's state lives here; what an area does is in its own file
// (Folder.swift, Tabs.swift, Files.swift, Search.swift, History.swift, Assistant.swift, System.swift).
import AppKit
import SwiftUI
import WebKit

struct Tab {
    var id: Int
    var path: String?
    var back: [String] = []
    var fwd: [String] = []
}

final class NoteWindow: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    let window: NSWindow
    let web: WKWebView
    let scheme = SchemeHandler()

    // the note and the ways back
    var path: String? { didSet { if (oldValue == nil) != (path == nil) { updateStart() } } }
    var back: [String] = []
    var fwd: [String] = []
    var shell = 0
    var ready = false
    /// A page on its way (loadShell, until didFinish): another asked for meanwhile would only start it again — what is to
    /// be shown by then is shown when it is there.
    var loading = false
    var editing = false
    var modeGiven = false
    var saveSeq: Any = 0
    var pendingFragment: String?
    var ownWrite: Data?
    var ownText: String?
    var renamedFrom: String?
    var fresh: String?
    var freshTurn = 0
    var resolver: Resolver?

    // the folder
    var folder: String? { didSet { if (oldValue == nil) != (folder == nil) { updateStart() } } }
    /// The start screen over the page, while the window has nothing open (StartView.swift).
    var startHost: StartHost?
    var pageCovers = false
    var quick = false
    var tree: [String: Any]?
    var notePaths: Set<String> = []
    var boardPaths: Set<String> = []
    var boardDirs: Set<String> = []
    var boardOpen = false
    var keptDirs: Set<String> = []
    var dirWatch: Set<String> = []
    let scanner = Scanner()
    /// The scanner of the folder read off the main thread (rescanQuietly) — its own, used on `scanQueue` alone.
    let quietScanner = Scanner()
    static let scanQueue = DispatchQueue(label: "mdview.scan", qos: .utility)
    /// Counts the folder's readings: a quiet one's tree is taken only if no other reading came after it began.
    var scanGen = 0
    var treeJSON: String?
    var tabsJSON: String?

    // tabs
    var tabs: [Tab] = []
    var tab = 0
    var tabSeq = 0
    var closedTabs: [(String, Int)] = []
    var dirTab: String?

    // timers and watching
    var reloadItem: DispatchWorkItem?
    var rescanItem: DispatchWorkItem?
    var freshItem: DispatchWorkItem?
    var stream: FSEventStreamRef?
    var watchedRoots: Set<String> = []
    var closing = false
    /// Counts the times the window was to go: a later close, or the page holding it to ask, makes an older wait come to nothing.
    var closeTurn = 0
    /// Closed: nothing is watched, scanned or drawn for it any more (what was on its way when it closed comes to nothing).
    var gone = false

    // state of the areas
    let filesS = FilesState()
    let searchS = SearchState()
    let historyS = HistoryState()
    let aiS = AIState()
    let sysS = SystemState()

    var onClose: ((NoteWindow) -> Void)?

    /// A window made before it is asked for (AppDelegate.spare): its page loaded, nothing shown, not on the screen and
    /// not among the app's windows — taken over by the next window opened (takeOver), so that one is there at once.
    private(set) var isSpare = false

    init(path: String?, folder: String?, spare: Bool = false) {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(scheme, forURLScheme: "md")
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        // (a window nobody sees — the tests' — runs its page's timers as a seen one does: WebKit would hold them)
        if Lib.headless, #available(macOS 14, *) { cfg.preferences.inactiveSchedulingPolicy = .none }
        // (the start screen is the system's here — StartView.swift — and not the page's)
        cfg.userContentController.addUserScript(WKUserScript(source: NoteWindow.noPageStart, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = FilesWebView(frame: .zero, configuration: cfg)   // (Files.swift: takes files dropped from Finder)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: folder != nil ? 1180 : 980, height: 780),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()
        scheme.topOf = { [weak self] p in self?.topOf(p) }
        cfg.userContentController.add(self, name: "msg")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        let ground = NSView()
        window.contentView = ground
        web.frame = ground.bounds
        web.autoresizingMask = [.width, .height]
        ground.addSubview(web)
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.title = "Markdown Notes"
        window.tabbingMode = .disallowed
        window.center()
        // (a folder's page is asked for before its scan: the web process starts and the page comes while the folder is read)
        if let folder { loadShell(); setFolder(folder) } else if let path { openPath(path, push: false) } else { loadShell() }
        updateStart()
        isSpare = spare
        window.isExcludedFromWindowsMenu = spare
        if spare { return }
        show()
    }

    private func show() {
        if Lib.headless { window.alphaValue = 0; window.ignoresMouseEvents = true; window.orderBack(nil) }
        else { window.makeKeyAndOrderFront(nil) }
    }

    /// The spare takes what a new window was asked to show, and comes on the screen.
    func takeOver(path: String?, folder: String?) {
        isSpare = false
        window.isExcludedFromWindowsMenu = false
        if let folder { setFolder(folder) }
        else if let path { openPath(path, push: false) }
        else if ready { js("MdView.clear", [["recents": store.recents()]]) } // (the start screen: the folders opened by now)
        show()
    }

    /// A spare no longer wanted (the theme or the settings changed under its page): closed without a trace.
    func dispose() { window.close() }

    /// What the page is told on macOS (StartView.swift): its start screen is not shown, and it says when something of its
    /// own is open over the middle of the window.
    static let noPageStart = """
    (function () {
      var s = document.createElement("style");
      s.textContent = "#content .start-state{display:none!important}";
      document.documentElement.appendChild(s);
      var was = false;
      var look = function () {
        var on = !!document.querySelector("[data-open]:not(#toast):not(#update):not(#apptip):not(#acttip)");
        if (on !== was) { was = on; window.webkit.messageHandlers.msg.postMessage({ type: "startcovered", on: on }); }
      };
      new MutationObserver(look).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["data-open"], childList: true });
    })();
    """

    deinit { stopStream() } // (closed, it was stopped already: windowWillClose)

    var dark: Bool { NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }
    var store: Store { Store.shared }

    // MARK: loading the page

    func loadShell(force: Bool = false) {
        if ready && !force { return render() }
        if loading && !force { return }
        loading = true
        let dir = path.map { Lib.dir($0) } ?? folder ?? Lib.home()
        treeJSON = nil; tabsJSON = nil
        ready = false
        editing = false
        shell += 1
        let route = "/shell/\(shell)"
        scheme.pages[route] = Page.html(prefs: jsonString(store.prefs), baseDir: dir, dark: dark, mode: dark ? "dark" : "light")
        web.load(URLRequest(url: URL(string: Page.origin + route)!))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !ready, web.url?.path == "/shell/\(shell)" else { return }
        ready = true
        loading = false
        sendFolder()
        sendTabs()
        let frag = pendingFragment; pendingFragment = nil
        render(fragment: frag)
        if path == nil && folder == nil { js("MdView.clear", [["recents": store.recents()]]) }
        if isSpare { js("MdView.warm") } // (what the first note and mode would load, loaded while nobody waits)
        pageLoaded()
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // the page leaves by messages, never by a link followed in the view — and the view shows nothing but the page
        if action.navigationType == .linkActivated, let u = action.request.url { link(u.absoluteString, tab: false, own: false); return decisionHandler(.cancel) }
        let u = action.request.url
        let ownPage = u?.scheme == "md" && u?.host == "localhost" && (u?.path.hasPrefix("/shell/") ?? false)
        decisionHandler(action.targetFrame?.isMainFrame == false || ownPage ? .allow : .cancel)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { loadShell(force: true) }

    // (a page that did not come is asked for again by the next that needs it — not held off as though it were on its way)
    private func failed(_ error: Error) { if !ready && (error as NSError).code != NSURLErrorCancelled { loading = false } }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }

    // MARK: the shell tells the page

    func js(_ fn: String, _ args: [Any] = []) {
        let a = args.map { jsonString($0) }.joined(separator: ",")
        web.evaluateJavaScript("\(fn)(\(a))", completionHandler: nil)
    }

    func toast(_ text: String) { js("MdView.toast", [text]) }

    func setTitle(_ t: String) { window.title = t }

    // MARK: the note

    func newResolver() {
        resolver = path.map { Resolver(noteDir: Lib.dir($0), base: folder) }
    }

    func render(keepScroll: Bool = false, fragment: String? = nil, toEnd: Bool = false) {
        guard ready, let path else { return }
        if Lib.shownAsPDF(path) { return renderPDF(fragment: fragment) }
        var text = "", error: Any = NSNull(), readonly: Any = NSNull()
        if let data = Lib.fm.contents(atPath: path) {
            text = String(decoding: data, as: UTF8.self)
            readonly = readonlyReason(path, data).map { $0 as Any } ?? NSNull()
        } else if !Lib.exists(path) {
            error = "File not found: \(path)"
            readonly = readonlyReason(path, nil).map { $0 as Any } ?? NSNull()
        } else { error = "Can't read file: \(path)"; readonly = "file can't be read" }
        let plain = Lib.isText(path)
        let links: [String: Any] = (!plain && text.contains("[[")) ? buildLinks(text) : [:]
        var payload: [String: Any] = [
            "kind": plain ? "text" : NSNull(), "text": text, "name": Lib.name(path), "path": path,
            "base": Page.fileURL(Lib.dir(path)) + "/", "readonly": readonly, "vault": resolver?.vault != nil,
            "links": links, "keepScroll": keepScroll, "fragment": fragment ?? NSNull(), "toEnd": toEnd, "error": error,
            "canBack": !back.isEmpty, "seq": saveSeq,
        ]
        if !modeGiven {
            let start = (store.prefs["startMode"] as? String) ?? "last"
            payload["startMode"] = start == "last" ? (store.state["mode"] ?? "read") : start
        }
        modeGiven = true
        js("MdView.render", [payload])
    }

    /// Where the wikilinks of a note lead (shell.rs `build_links`), embedded notes followed into.
    func buildLinks(_ text: String) -> [String: Any] {
        guard let r = resolver else { return [:] }
        var out: [String: Any] = [:]
        var texts = [text]
        let rx = Lib.rx(#"!?\[\[([^\[\]\n]+?)\]\]"#)
        let limit = 200_000
        while let chunk = texts.popLast() {
            for m in rx.matches(in: chunk, range: NSRange(chunk.startIndex..., in: chunk)) {
                guard let rg = Range(m.range(at: 1), in: chunk), let whole = Range(m.range, in: chunk) else { continue }
                let target = chunk[rg].components(separatedBy: "|")[0].trimmingCharacters(in: .whitespaces)
                if out[target] != nil || target.hasPrefix("#") { continue }
                guard let p = r.resolve(target) else { out[target] = NSNull(); continue }
                var kind = Lib.kind(p)
                var info: [String: Any] = ["path": p, "url": Page.fileURL(p), "kind": kind]
                let embed = chunk[whole].hasPrefix("!")
                if kind == "md" && embed && out.count < 400 {
                    if let t = Lib.read(p, limit: limit) { info["text"] = t; texts.append(t) }
                } else if kind == "file" && embed, let t = embeddedText(p, limit: limit) {
                    kind = "text"; info["kind"] = kind; info["text"] = t
                }
                out[target] = info
            }
        }
        return out
    }

    /// The text of a file that is one — UTF-8 without a NUL, not too large — for showing it in a note as code.
    func embeddedText(_ p: String, limit: Int) -> String? {
        guard let d = Lib.fm.contents(atPath: p), d.count <= limit, !d.contains(0) else { return nil }
        return String(data: d, encoding: .utf8)
    }

    func openPath(_ p: String, fragment: String? = nil, push: Bool = true) {
        let p = Lib.resolve(p)
        dirTab = nil
        if let f = fresh, f == path, path != p { settleFresh(last: true) }
        touch(p)
        let same = path == p
        if !same { renamedFrom = nil }
        if push && !same, let old = path { back.append(old); fwd.removeAll() }
        path = p
        setTitle(Lib.name(p))
        window.representedFilename = p
        newResolver()
        if !same { ownText = nil; watch() }
        if let folder, p.hasPrefix(folder + "/") { store.put("last_notes", folder, p) }
        if !tabs.isEmpty { sendTabs() }
        store.put("opened", p, Int(Date().timeIntervalSince1970))
        if ready { render(fragment: fragment) } else { pendingFragment = fragment; loadShell() }
    }

    /// Something at this path changed, or may have: its project's snapshot follows once it is quiet (app.touch).
    func touch(_ p: String) { HistoryHub.shared.touch(p) }

    func showNothing() {
        if fresh != nil, fresh == path { settleFresh(last: true) }
        renamedFrom = nil
        path = nil
        watch()
        back.removeAll(); fwd.removeAll()
        let f = folder ?? ""
        setTitle(Lib.name(f).isEmpty ? f : Lib.name(f))
        if ready { js("MdView.clear", []) } else { loadShell() }
        sendTabs()
    }

    func go(back isBack: Bool) {
        guard let to = isBack ? back.popLast() : fwd.popLast() else { return }
        if let here = path { if isBack { fwd.append(here) } else { back.append(here) } }
        openPath(to, push: false)
    }

    static let gone = "the note is no longer there (moved or deleted outside this window)"

    /// How large a note may be to be edited (shell.rs EDIT_LIMIT).
    static let editLimit = 2 * 1024 * 1024

    /// Why the note can't be edited, or nil (shell.rs readonly_reason). A file that is not UTF-8 — Latin-1, UTF-16 — is
    /// shown as its letters read as UTF-8: written back, every letter that is not became U+FFFD (review 2026-11-17).
    func readonlyReason(_ path: String, _ data: Data?) -> String? {
        guard let data else { return Lib.fm.isWritableFile(atPath: Lib.dir(path)) ? nil : "folder is read-only" }
        if !Lib.fm.isWritableFile(atPath: path) { return "file is read-only" }
        if data.count > NoteWindow.editLimit { return "file is too large" }
        if String(data: data, encoding: .utf8) == nil { return "file is not UTF-8" }
        return nil
    }

    func saveText(_ text: String, exact: Bool) {
        guard let path, !Lib.shownAsPDF(path) else { return }
        // (gone from the disk — renamed or deleted elsewhere: another window, Finder, a sync from another device. Written
        // again it came back under its old name, and went to every device (review 2026-11-17). What is typed stays in
        // the editor, and the page says why it is not kept.)
        guard Lib.exists(path) else { return js("MdView.saveFailed", [NoteWindow.gone]) }
        // (shown read-only for it — and never written over, whatever the page sends: its letters would be lost)
        if let old = Lib.fm.contents(atPath: path), String(data: old, encoding: .utf8) == nil {
            return js("MdView.saveFailed", ["Can't edit: file is not UTF-8"])
        }
        if exact {
            do { try writeWhole(path, Data(text.utf8)); ownWrite = Data(text.utf8) } catch { js("MdView.saveFailed", [error.localizedDescription]) }
            return
        }
        let old = Lib.fm.contents(atPath: path) ?? Data()
        let crlf = old.range(of: Data("\r\n".utf8)) != nil
        let data = Data((crlf ? text.replacingOccurrences(of: "\n", with: "\r\n") : text).utf8)
        if data != old {
            do { try writeWhole(path, data) } catch { return js("MdView.saveFailed", [error.localizedDescription]) }
        }
        ownText = text
    }

    /// Written whole: a link is followed, the permissions, Finder's tags and the rest of what the system keeps stay (Lib).
    func writeWhole(_ p: String, _ data: Data) throws { try Lib.writeWhole(p, data) }

    /// A task ticked in the reading view: written into the file, and the note drawn anew from it — the page has only
    /// ticked the box, its text is still the one before (shell.rs `toggle_task`, where the watcher draws it).
    func toggleTask(line: Int, checked: Bool) {
        guard let path, line >= 0, let data = Lib.fm.contents(atPath: path) else { return }
        // (a note that is only read — not UTF-8, too large, not to be written: shell.rs toggle_task)
        if let why = readonlyReason(path, data) { toast("Can't edit: \(why)"); return render(keepScroll: true) }
        let text = String(decoding: data, as: UTF8.self)
        var lines = text.components(separatedBy: "\n")
        guard line < lines.count else { return render(keepScroll: true) }
        let rx = Lib.rx(#"^([\s>]*(?:[-*+]|\d+[.)])\s+\[)(.)(\])"#)
        let l = lines[line]
        guard let m = rx.firstMatch(in: l, range: NSRange(l.startIndex..., in: l)), let r = Range(m.range(at: 2), in: l) else {
            return render(keepScroll: true)
        }
        lines[line] = l.replacingCharacters(in: r, with: checked ? "x" : " ")
        let new = Data(lines.joined(separator: "\n").utf8)
        do { try writeWhole(path, new); ownWrite = new } // (the watcher's echo of it: no second drawing)
        catch { toast("Couldn't save: \(error.localizedDescription)") }
        render(keepScroll: true)
    }

    // MARK: links

    func link(_ href: String, tab useTab: Bool, own: Bool) {
        guard let url = URL(string: href) else { return }
        let frag = url.fragment?.removingPercentEncoding.flatMap { $0.isEmpty ? nil : $0 }
        guard url.scheme == "md" || url.scheme == "file" else {
            if url.scheme != "about" && url.scheme != nil { NSWorkspace.shared.open(url) }
            return
        }
        var file: String
        if url.scheme == "md" {
            guard url.path.hasPrefix("/file/") else { return }
            file = String(url.path.dropFirst(5))
        } else { file = url.path } // (URL.path is decoded: once more, a "%20" in a file's own name was a space)
        if !Lib.exists(file), !Lib.isMd(file), Lib.exists(file + ".md") { file += ".md" }
        if !Lib.exists(file) { file = foundAsset(file) }
        let useTab = useTab && !tabs.isEmpty
        if path == file && (!useTab || own) {
            if let frag { js("MdView.scrollToFragment", [frag, true]) }
            return
        }
        guard Lib.exists(file) else { return toast("Not found: \(Lib.name(file))") }
        if Lib.isFile(file) && (Lib.isMd(file) || Lib.isText(file) || Lib.shownAsPDF(file)) {
            useTab ? linkTab(file, frag, own: own) : openPath(file, fragment: frag)
        } else { NSWorkspace.shared.open(URL(fileURLWithPath: file)) }
    }

    func wikilink(_ target: String, tab useTab: Bool, own: Bool) {
        let heading = target.firstIndex(of: "#").map { String(target[target.index(after: $0)...]) }
        guard let p = resolver?.resolve(target) else {
            return toast("Note “\(target.components(separatedBy: "#")[0])” doesn't exist")
        }
        if !["md", "pdf", "slides"].contains(Lib.kind(p)) && !Lib.isText(p) { NSWorkspace.shared.open(URL(fileURLWithPath: p)) }
        else if useTab && !tabs.isEmpty && !(own && path == p) { linkTab(p, heading, own: own) }
        else if path == p, let h = heading { js("MdView.scrollToFragment", [h, true]) }
        else { openPath(p, fragment: heading) }
    }

    /// The file a note names, where it is (Lib.found): a picture named `assets/x.png` from a subfolder is the base folder's.
    func foundAsset(_ p: String) -> String { Lib.found(p, top: topOf(p)) }

    /// The base folder a path lies in, as far as can be told (scan.rs `top_of`): the project's root, else a folder a
    /// window shows, else a repository's or a vault's above it.
    func topOf(_ p: String) -> String? {
        if case .project(let root) = Hist.placeOf(p) { return root }
        let shown = Set([folder].compactMap { $0 } + (AppDelegate.shared?.windows.compactMap { $0.folder } ?? []))
        let above = sequence(first: Lib.dir(p)) { $0.count > 1 ? Lib.dir($0) : nil }.prefix(32)
        return above.first { shown.contains($0) }
            ?? above.first { Lib.exists(Lib.join($0, ".git")) || Lib.isDir(Lib.join($0, ".obsidian")) }
    }

    // MARK: the page tells the shell

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        // (the page posts its message as JSON text: MdHost.post(JSON.stringify({ type, … })) — viewer/base.js)
        var body = message.body
        if let text = body as? String, let data = text.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: data) { body = o }
        guard let msg = body as? [String: Any], let type = msg["type"] as? String else { return }
        on(type, msg)
    }

    func truthy(_ v: Any?) -> Bool {
        switch v {
        case let b as Bool: return b
        case let n as NSNumber: return n.doubleValue != 0
        case let s as String: return !s.isEmpty && s != "0" && s != "false"
        case nil, is NSNull: return false
        default: return true
        }
    }

    func on(_ type: String, _ msg: [String: Any]) {
        let str = { (k: String) in msg[k] as? String ?? "" }
        // what writes into the folder: its project's snapshot follows (history, area C)
        if ["save", "toggle", "pasteimage", "dropfiles", "graphic-save", "board-new", "board-save", "pdfink-save", "note-save",
            "board-paste", "board-drop", "newnote", "quicknote", "newfolder", "rename", "move", "trash", "untrash", "pastefiles",
            "duplicate", "import", "newboard", "hide"].contains(type) {
            if let p = path ?? folder { touch(p) }
        }
        if type.hasPrefix("history-") || type.hasPrefix("sync-") || type.hasPrefix("github-") || type.hasPrefix("share-") || type.hasPrefix("paste-") {
            _ = handleHistory(type, msg); return
        }
        switch type {
        case "startcovered": startCovered(truthy(msg["on"]))
        case "link": link(str("href"), tab: truthy(msg["tab"]), own: (msg["tab"] as? String) == "own")
        case "wikilink": wikilink(str("target"), tab: truthy(msg["tab"]), own: (msg["tab"] as? String) == "own")
        case "tab": tabOp(msg)
        case "toggle": toggleTask(line: (msg["line"] as? Int) ?? -1, checked: truthy(msg["checked"]))
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(str("text"), forType: .string)
        case "mode":
            editing = truthy(msg["edit"])
            let name = truthy(msg["plain"]) ? "" : str("name")
            if ["read", "edit", "active", "split"].contains(name), store.string("mode") != name { store.set("mode", name) }
        case "prefs":
            if let new = msg["prefs"] as? [String: Any] {
                let prefs = store.store(prefs: new)
                AppDelegate.shared.dropSpare() // (its page holds the settings it was made with)
                let lists = new.keys.contains { $0.hasPrefix("sidebar") || $0 == "showHidden" }
                AppDelegate.shared.eachWindow { w in
                    w.js("MdView.setPrefs", [prefs])
                    if lists && w.folder != nil { w.rescan() }
                }
            }
        case "note": openNote(str("path"), tab: truthy(msg["tab"]), fragment: (msg["fragment"] as? String).flatMap { $0.isEmpty ? nil : $0 })
        case "resolve":
            let target = str("target")
            var info: Any = NSNull()
            if !target.isEmpty, let p = resolver?.resolve(target) {
                info = ["path": p, "url": Page.fileURL(p), "kind": Lib.kind(p)]
            }
            js("MdView.linkResolved", [target, info])
        case "painted": break
        case "pdfnote":
            let p = str("path")
            if Lib.isFile(p) && Lib.isMd(p) { openPath(p, fragment: "^line=\(Int((msg["line"] as? Double) ?? 0))", push: true) }
        case "board-open": boardOpen = truthy(msg["on"])
        case "board-watch":
            boardDirs = Set((msg["paths"] as? [String] ?? []).prefix(16).map { foundAsset(Lib.resolve($0)) }.filter { Lib.isBoard($0) && Lib.isFile($0) }.map { Lib.dir($0) })
            watch()
        case "newnote": newNote(name: str("name"), wanted: msg["dir"] as? String)
        case "quicknote": newQuick()
        case "newfolder": newFolder(name: str("name"), wanted: msg["dir"] as? String)
        case "rename": renameNote(str("path"), str("name"))
        case "move": moveTo(str("path"), str("dir"))
        case "trash":
            if let many = msg["paths"] as? [String] { trashPaths(many) } else { trashPaths([str("path")]) }
        case "sidebar": sidebarPref(msg)
        case "folder":
            if truthy(msg["here"]), folder == nil, let p = path { setFolder(Lib.dir(p)) } else { AppDelegate.shared.openPanel() }
        case "recent":
            let f = Lib.resolve(str("path"))
            if Lib.isDir(f), path == nil, folder == nil { setFolder(f) }
        case "open": AppDelegate.shared.openPanel()
        case "reload": newResolver(); render(keepScroll: true)
        case "help":
            let guide = Page.root.appendingPathComponent("docs/FEATURES.md").path
            if Lib.isFile(guide), path != guide { AppDelegate.shared.openWindow(guide) }
        case "external":
            if let p = path { NSWorkspace.shared.open(URL(fileURLWithPath: p)) }
        case "close": close()
        case "closehold":
            // the page has a question to ask before the window may go (shell/messages.rs) — and before the app may quit
            closeTurn += 1
            closing = false
            AppDelegate.shared?.quitHeld = true
        case "back": go(back: true)
        case "forward": go(back: false)
        case "save":
            // a late autosave must not land in whatever note is open by now
            // (… but one sent under the name the note on screen had a moment ago is its own: renamed meanwhile)
            let at = msg["path"] as? String
            if at == nil || at == path || (at != nil && at == renamedFrom) {
                if truthy(msg["seq"]) { saveSeq = msg["seq"] as Any }
                saveText(str("text"), exact: truthy(msg["exact"]))
                if truthy(msg["exact"]) { tidyAttachments(msg["text"] as? String) }   // (the active mode: what it no longer shows goes)
                if let f = fresh, f == path {
                    freshTurn += 1
                    let turn = freshTurn
                    freshItem?.cancel()
                    let item = DispatchWorkItem { [weak self] in if let self, self.freshTurn == turn { self.settleFresh(last: false) } }
                    freshItem = item
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: item)
                }
            }
        default:
            if handleFiles(type, msg) || handleSearch(type, msg) || handleAssistant(type, msg) || handleSystem(type, msg) { return }
        }
    }

    // MARK: closing

    /// The window is to go. While a note is being written the page hands over unsaved text first.
    func close() {
        if (editing || boardOpen) && ready && !closing {
            closing = true
            closeTurn += 1
            let turn = closeTurn
            js("MdView.flush", [true])
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in if let self, self.closeTurn == turn { self.closeNow() } }
            return
        }
        closeTurn += 1
        closeNow()
    }

    func closeNow() {
        guard window.isVisible || closing else { return }
        closing = false
        window.close()
    }

    func windowWillClose(_ n: Notification) {
        stopAssistant() // (its talks and figures: run on for minutes with nobody to answer — review 2026-11-17)
        _ = settleQuick()
        settleFresh(last: true)
        stopWatching()
        gone = true
        reloadItem?.cancel(); rescanItem?.cancel(); freshItem?.cancel()
        // (the page's message handler holds the window: without this, no closed window — nor its page — is ever let go)
        web.configuration.userContentController.removeScriptMessageHandler(forName: "msg")
        web.navigationDelegate = nil
        web.stopLoading()
        // (a spare was never seen: its size is nobody's)
        if !isSpare {
            store.set(folder != nil ? "folder_width" : "width", Int(window.frame.width))
            store.set(folder != nil ? "folder_height" : "height", Int(window.frame.height))
        }
        onClose?(self)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if (editing || boardOpen) && ready && !closing { close(); return false }
        return true
    }

    /// Hooks the areas may fill when the page is up (a new page for a window).
    func pageLoaded() {}
}
