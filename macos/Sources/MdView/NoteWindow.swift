// One window: a WKWebView with the page, and the shell's half of the conversation — what the page
// says (MdHost.post -> `on`) and what the shell tells it (`js` -> MdView.…). The Rust original is
// src-tauri/src/shell.rs and shell/messages.rs; this takes the messages over one at a time.
import AppKit
import WebKit

final class NoteWindow: NSObject, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    let window: NSWindow
    let web: WKWebView
    let scheme = SchemeHandler()
    var path: String?
    var shell = 0
    var ready = false
    var back: [String] = []
    var onClose: ((NoteWindow) -> Void)?

    init(path: String?) {
        self.path = path
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(scheme, forURLScheme: "md")
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        web = WKWebView(frame: .zero, configuration: cfg)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 760),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()
        cfg.userContentController.add(self, name: "msg")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        window.contentView = web
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.title = path.map { ($0 as NSString).lastPathComponent } ?? "Markdown Notes"
        window.setFrameAutosaveName("NoteWindow")
        window.center()
        loadShell()
        window.makeKeyAndOrderFront(nil)
    }

    var dark: Bool { NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

    func loadShell() {
        ready = false
        shell += 1
        let dir = path.map { ($0 as NSString).deletingLastPathComponent } ?? NSHomeDirectory()
        let route = "/shell/\(shell)"
        scheme.pages[route] = Page.html(prefs: jsonString(Store.shared.prefs), baseDir: dir, dark: dark,
                                        mode: dark ? "dark" : "light")
        web.load(URLRequest(url: URL(string: Page.origin + route)!))
    }

    // MARK: the shell tells the page

    func js(_ fn: String, _ args: [Any]) {
        let a = args.map { jsonString($0) }.joined(separator: ",")
        web.evaluateJavaScript("\(fn)(\(a))", completionHandler: nil)
    }

    func toast(_ text: String) { js("MdView.toast", [text]) }

    func render(keepScroll: Bool = false, fragment: String? = nil) {
        guard ready, let path else { return }
        var text = "", error: Any = NSNull()
        let isText = !(path.hasSuffix(".md") || path.hasSuffix(".markdown"))
        if let data = FileManager.default.contents(atPath: path) {
            text = String(decoding: data, as: UTF8.self)
        } else {
            error = "File not found: \(path)"
        }
        var payload: [String: Any] = [
            "kind": isText ? "text" : NSNull(), "text": text, "name": (path as NSString).lastPathComponent,
            "path": path, "base": Page.fileURL((path as NSString).deletingLastPathComponent) + "/",
            "readonly": NSNull(), "vault": false, "links": [String: String](), "keepScroll": keepScroll,
            "fragment": fragment ?? NSNull(), "toEnd": false, "error": error, "canBack": !back.isEmpty, "seq": 0,
        ]
        if let m = Store.shared.state["mode"] { payload["startMode"] = m }
        js("MdView.render", [payload])
    }

    func open(_ p: String, fragment: String? = nil, push: Bool = true) {
        if push, let old = path, old != p { back.append(old) }
        path = p
        window.title = (p as NSString).lastPathComponent
        window.representedFilename = p
        render(fragment: fragment)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !ready, web.url?.path == "/shell/\(shell)" else { return }
        ready = true
        if path != nil { render() } else { js("MdView.clear", [["recents": [Any]()]]) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // the page leaves by messages, never by a link followed in the view
        decisionHandler(action.navigationType == .linkActivated ? .cancel : .allow)
    }

    // MARK: the page tells the shell

    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let msg = message.body as? [String: Any], let type = msg["type"] as? String else { return }
        on(type, msg)
    }

    func on(_ type: String, _ msg: [String: Any]) {
        let str = { (k: String) in msg[k] as? String ?? "" }
        switch type {
        case "save":
            // a late autosave must not land in whatever note is open by now
            if let at = msg["path"] as? String, at != path { return }
            guard let path, let text = msg["text"] as? String else { return }
            do { try text.write(toFile: path, atomically: true, encoding: .utf8) }
            catch { js("MdView.saveFailed", [error.localizedDescription]) }
        case "link": link(str("href"), fragment: nil)
        case "wikilink": wikilink(str("target"))
        case "reload": render(keepScroll: true)
        case "back": if let p = back.popLast() { open(p, push: false) }
        case "copy":
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(str("text"), forType: .string)
        case "mode":
            if let name = msg["name"] as? String, ["read", "edit", "active", "split"].contains(name), !(msg["plain"] as? Bool ?? false) {
                Store.shared.state["mode"] = name
            }
        case "prefs":
            if let new = msg["prefs"] as? [String: Any] {
                Store.shared.prefs.merge(new) { _, n in n }
                AppDelegate.shared.eachWindow { $0.js("MdView.setPrefs", [Store.shared.prefs]) }
            }
        case "open", "folder": AppDelegate.shared.openPanel()
        case "close": window.performClose(nil)
        default: break // the messages not yet taken over (docs/MACOS.md lists them)
        }
    }

    func link(_ href: String, fragment: String?) {
        guard let url = URL(string: href) else { return }
        var frag = url.fragment?.removingPercentEncoding
        if url.scheme == "md" || url.scheme == "file" {
            let p = url.scheme == "md" ? String(url.path.dropFirst(5)) : url.path
            var file = p.removingPercentEncoding ?? p
            let fm = FileManager.default
            if !fm.fileExists(atPath: file), fm.fileExists(atPath: file + ".md") { file += ".md" }
            guard fm.fileExists(atPath: file) else { return toast("Not found: \((file as NSString).lastPathComponent)") }
            if file.hasSuffix(".md") || file.hasSuffix(".markdown") || file.hasSuffix(".txt") {
                if file == path, let f = frag { js("MdView.scrollToFragment", [f, true]) } else { open(file, fragment: frag) }
            } else { NSWorkspace.shared.open(URL(fileURLWithPath: file)) }
            frag = nil
        } else if url.scheme != "about" {
            NSWorkspace.shared.open(url)
        }
    }

    func wikilink(_ target: String) {
        guard let path else { return }
        let name = target.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? target
        let dir = (path as NSString).deletingLastPathComponent
        for cand in [name, name + ".md"] {
            let p = (dir as NSString).appendingPathComponent(cand)
            if FileManager.default.fileExists(atPath: p) { return open(p) }
        }
        toast("Note “\(name)” doesn't exist")
    }

    func windowWillClose(_ n: Notification) { onClose?(self) }
}

/// What is kept between starts: ~/Library/Application Support/MdView/state.json.
final class Store {
    static let shared = Store()
    var prefs: [String: Any] = ["lang": "en", "startMode": "last"] { didSet { save() } }
    var state: [String: Any] = [:] { didSet { save() } }
    private let file: URL = {
        let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MdView")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d.appendingPathComponent("state.json")
    }()
    init() {
        if let d = try? Data(contentsOf: file), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            prefs.merge(o["prefs"] as? [String: Any] ?? [:]) { _, n in n }
            state = o["state"] as? [String: Any] ?? [:]
        }
    }
    private func save() {
        if let d = try? JSONSerialization.data(withJSONObject: ["prefs": prefs, "state": state]) { try? d.write(to: file) }
    }
}
