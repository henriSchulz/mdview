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

    /// The colours of the theme (--c-*), by the system's appearance, until the Velum roles take over.
    static func themeCSS(dark: Bool) -> String {
        let c: [String: String] = dark
            ? ["background": "#1c1c1e", "foreground": "#e5e5e7", "muted": "#8e8e93", "accent": "#0a84ff", "selection": "#3a3a5c",
               "red": "#ff453a", "orange": "#ff9f0a", "yellow": "#ffd60a", "green": "#32d74b", "cyan": "#64d2ff",
               "blue": "#0a84ff", "magenta": "#bf5af2", "brown": "#ac8e68", "bright-red": "#ff6961", "bright-yellow": "#ffe066"]
            : ["background": "#ffffff", "foreground": "#1d1d1f", "muted": "#6e6e73", "accent": "#007aff", "selection": "#cfe0ff",
               "red": "#d70015", "orange": "#c93400", "yellow": "#a05a00", "green": "#248a3d", "cyan": "#0071a4",
               "blue": "#0040dd", "magenta": "#ad0e98", "brown": "#7f6545", "bright-red": "#ff3b30", "bright-yellow": "#b38600"]
        let body = c.sorted { $0.key < $1.key }.map { "--c-\($0.key):\($0.value)" }.joined(separator: ";")
        return ":root{\(body);color-scheme:\(dark ? "dark" : "light")}"
    }

    static func html(prefs: String, baseDir: String, dark: Bool, mode: String) -> String {
        let a = origin + "/app"
        let host = "window.MdHost = { post: (m) => { window.webkit.messageHandlers.msg.postMessage(m); }, files: \(jsonString(origin + "/file")) };"
        var scr = "<script>\(host)window.MdPrefs = \(prefs);</script>"
        for s in scripts { scr += "<script src=\"\(a)/\(s)\"></script>" }
        let base = escape(fileURL(baseDir) + "/")
        let links = styles.map { "<link rel='stylesheet' href='\(a)/viewer/\($0).css'>" }.joined()
        return "<!doctype html><html lang='en'><head><meta charset='utf-8'><base href='\(base)'>"
            + "<link rel='stylesheet' href='\(a)/velum.css'><link rel='stylesheet' href='\(a)/motion.css'>"
            + "<style id='theme'>\(themeCSS(dark: dark))</style>"
            + "<link rel='stylesheet' href='\(a)/vendor/katex/katex.min.css'>\(links)"
            + "<link rel='stylesheet' href='\(a)/overview.css'></head>"
            + "<body data-mode='\(dark ? "dark" : "light")'><main id='content'></main>\(scr)</body></html>"
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
