// The page a window shows — what src-tauri/src/shell.rs `load_shell` builds: the scripts and sheets
// in their fixed order (kept in step with SCRIPTS and STYLES there), the theme's colours, and
// MdHost, the one way the page talks to the shell.
import AppKit
import Foundation

enum Page {
    static let origin = "md://localhost"

    static let scripts = [
        "vendor/markdown-it.min.js", "vendor/footnote.min.js", "vendor/deflist.min.js", "vendor/mark.min.js",
        "vendor/sub.min.js", "vendor/sup.min.js", "vendor/abbr.min.js", "vendor/emoji.min.js",
        "vendor/js-yaml.min.js", "vendor/highlight.min.js", "vendor/highlight-extra.min.js",
        "vendor/katex/katex.min.js", "strings.js", "viewer/base.js", "viewer/hand.js", "viewer/markdown.js",
        "viewer/prep.js", "viewer/render.js", "viewer/chrome.js", "viewer/editor.js", "viewer/trail.js",
        "viewer/modes.js", "viewer/sidebar.js", "viewer/menus.js", "viewer/drawer.js", "viewer/tabs.js",
        "viewer/toolbar.js", "viewer/split.js", "viewer/twin.js", "viewer/touch.js", "viewer/tablet.js",
        "viewer/tour.js", "viewer/search.js", "viewer.js", "overview.js", "viewer/meter.js",
    ]
    static let styles = ["page", "text", "code", "blocks", "pages", "editor", "chrome", "sidebar", "tabs",
                         "menus", "narrow", "layouts", "split", "twin", "tablet", "meter", "roles", "look"]

    /// Where the page's files are: the checkout this was built from, or MDVIEW_ROOT.
    static let root: URL = {
        if let r = ProcessInfo.processInfo.environment["MDVIEW_ROOT"], !r.isEmpty { return URL(fileURLWithPath: r) }
        if let r = Bundle.main.object(forInfoDictionaryKey: "MdViewRoot") as? String, !r.isEmpty { return URL(fileURLWithPath: r) }
        // macos/Sources/MdView/Page.swift -> the checkout
        return URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }()

    /// The address of a file, as the page asks for it (md://localhost/file/<path>).
    static func fileURL(_ path: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "#?%")
        return origin + "/file" + (path.addingPercentEncoding(withAllowedCharacters: allowed) ?? path)
    }

    /// `dark` and `mode` are the caller's guess; the page takes the theme of ThemeCenter (Velum, else the system's appearance).
    /// The user's own LaTeX snippets (`snippets.js` in the config folder: `export default [ … ]`, or the list alone), as
    /// the page takes them — window.MdSnippets (shell.rs user_snippets). They were never handed to the page here
    /// (review 2026-11-17: FEATURES' own snippets did nothing on macOS).
    static func userSnippets() -> String {
        guard let source = Lib.read(Lib.join(AIKey.configDir, "snippets.js")),
              !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        let body: String
        if let r = source.range(of: #"export\s+default"#, options: .regularExpression) {
            body = source.replacingCharacters(in: r, with: "return ")
        } else {
            var t = source
            while let last = t.last, last.isWhitespace || last == ";" { t.removeLast() }
            body = "return (\(t)\n)"
        }
        return "window.MdSnippets = function (require) {\n\(body.replacingOccurrences(of: "</", with: "<\\/"))\n};"
    }

    static func html(prefs: String, baseDir: String, dark: Bool, mode: String, fingerScreen: Bool = false) -> String {
        let theme = ThemeCenter.shared.current
        let a = origin + "/app"
        let host = "window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {}; window.MdHost = { post: (m) => { window.webkit.messageHandlers.msg.postMessage(m); }, files: \(jsonString(origin + "/file")), menu: (spec) => window.webkit.messageHandlers.ask.postMessage({ type: 'menu', spec }), settings: () => window.webkit.messageHandlers.msg.postMessage({ type: 'opensettings' }) };"
        // Only the page's own scripts run — those it loads later carry the same nonce (viewer/base.js NONCE) —,
        // never a handler or a javascript: link in a note's HTML (shell.rs load_shell: the same policy).
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let csp = "default-src 'none'; script-src 'nonce-\(nonce)'; style-src 'unsafe-inline' md: https:; "
            + "img-src md: data: blob: https: http:; font-src md: data:; media-src md: https: http:; connect-src 'none'"
        let prefs = prefs.replacingOccurrences(of: "</", with: "<\\/")
        var scr = "<script nonce=\"\(nonce)\">\(host)window.MdPrefs = \(prefs);</script>"
        let own = userSnippets()
        if !own.isEmpty { scr += "<script nonce=\"\(nonce)\">\(own)</script>" }
        for s in scripts { scr += "<script nonce=\"\(nonce)\" src=\"\(a)/\(s)\"></script>" }
        let base = escape(fileURL(baseDir) + "/")
        let links = styles.map { "<link rel='stylesheet' href='\(a)/viewer/\($0).css'>" }.joined()
        return "<!doctype html><html lang='en'\(theme.htmlAttrs)\(fingerScreen ? " data-touch-screen" : "")><head><meta charset='utf-8'>"
            + "<meta http-equiv='Content-Security-Policy' content=\"\(csp)\"><base href='\(base)'>"
            + "<link rel='stylesheet' href='\(a)/velum.css'><link rel='stylesheet' href='\(a)/motion.css'>"
            + "<style id='theme'>\(theme.css)</style>"
            + "<link rel='stylesheet' href='\(a)/vendor/katex/katex.min.css'>\(links)"
            + "<link rel='stylesheet' href='\(a)/overview.css'></head>"
            + "<body data-mode='\(theme.mode)'><main id='content'></main>\(scr)</body></html>"
    }

    static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "'", with: "&#x27;")
            .replacingOccurrences(of: "\"", with: "&quot;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

/// A value as JSON text, to be put into a script (`</` kept from closing it).
func jsonString(_ v: Any) -> String {
    guard let d = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]),
          let s = String(data: d, encoding: .utf8) else { return "null" }
    return s.replacingOccurrences(of: "</", with: "<\\/")
}
