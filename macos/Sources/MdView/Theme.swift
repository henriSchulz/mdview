// Colours follow the desktop: Velum's current colours when Velum is installed (~/.local/state/velum/colors.toml, kept on
// the desktop's variant and light/dark by Velum), else the system's appearance with the app's own light and dark palette —
// src-tauri/src/theme.rs. Motion and sizes are the app's own (motion.css, viewer/*.css).
import AppKit

struct Theme {
    var mode: String                     // "light" | "dark"
    var colors: [(String, String)]
    var variant: String?                 // Velum's variant ("opal" …) when the colours are Velum's
    var tablet = false

    static let keys = ["background", "foreground", "accent", "muted", "selection", "red", "green", "yellow", "orange", "blue", "cyan",
                       "magenta", "brown", "bright_red", "bright_green", "bright_yellow", "bright_blue", "bright_magenta", "bright_cyan"]
    static let light: [(String, String)] = [
        ("background", "#f5f5f7"), ("foreground", "#1d1d1f"), ("accent", "#0071e3"), ("muted", "#a1a1a6"), ("selection", "#b4d5fe"),
        ("red", "#d70015"), ("green", "#248a3d"), ("yellow", "#a05a00"), ("orange", "#c93400"), ("blue", "#0071e3"), ("cyan", "#0071a4"),
        ("magenta", "#8944ab"), ("brown", "#7f6545"), ("bright_red", "#ff3b30"), ("bright_green", "#34c759"), ("bright_yellow", "#d18b00"),
        ("bright_blue", "#0a84ff"), ("bright_magenta", "#af52de"), ("bright_cyan", "#30b0c7")]
    static let dark: [(String, String)] = [
        ("background", "#1e1e20"), ("foreground", "#f5f5f7"), ("accent", "#0a84ff"), ("muted", "#6e6e73"), ("selection", "#3a5f8f"),
        ("red", "#ff453a"), ("green", "#32d74b"), ("yellow", "#ffd60a"), ("orange", "#ff9f0a"), ("blue", "#0a84ff"), ("cyan", "#64d2ff"),
        ("magenta", "#bf5af2"), ("brown", "#ac8e68"), ("bright_red", "#ff6961"), ("bright_green", "#4cd964"), ("bright_yellow", "#ffe066"),
        ("bright_blue", "#409cff"), ("bright_magenta", "#da8fff"), ("bright_cyan", "#70d7ff")]

    /// Velum's state directory (MDVIEW_VELUM_STATE says another, for tests).
    static var velumDir: String {
        if let d = ProcessInfo.processInfo.environment["MDVIEW_VELUM_STATE"], !d.isEmpty { return d }
        return Lib.join(Lib.home(), ".local/state/velum")
    }

    static var systemDark: Bool { NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }

    /// A TOML file of `key = "value"` lines, as the theme files are.
    static func parseTOML(_ text: String) -> [String: String] {
        var out: [String: String] = [:]
        for line in text.components(separatedBy: "\n") {
            let l = line.trimmingCharacters(in: .whitespaces)
            guard !l.hasPrefix("#"), let eq = l.firstIndex(of: "=") else { continue }
            let k = l[..<eq].trimmingCharacters(in: .whitespaces)
            var v = l[l.index(after: eq)...].trimmingCharacters(in: .whitespaces)
            if let hash = v.range(of: " #"), !v.hasPrefix("\"") { v = String(v[..<hash.lowerBound]) }
            v = v.trimmingCharacters(in: CharacterSet(charactersIn: "\"' "))
            out[k] = v
        }
        return out
    }

    static func luminance(_ hex: String) -> Double {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count >= 6, let n = UInt32(h.prefix(6), radix: 16) else { return 1 }
        let (r, g, b) = (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    static func load() -> Theme {
        let file = Lib.join(velumDir, "colors.toml")
        var data: [String: String] = [:]
        var velum = false
        if Lib.isFile(file), let t = Lib.read(file) { data = parseTOML(t); velum = true }
        // (what the theme does not name is the fallback's: the dark one under a dark ground, or — no theme at all — a dark system)
        let dark: Bool
        switch data["mode"] {
        case "dark": dark = true
        case "light": dark = false
        default: dark = data["background"].map { luminance($0) <= 0.5 } ?? systemDark
        }
        var colors = dark ? Theme.dark : Theme.light
        for k in keys { if let v = data[k], let i = colors.firstIndex(where: { $0.0 == k }) { colors[i].1 = v } }
        var theme = Theme(mode: dark ? "dark" : "light", colors: colors, variant: nil)
        if let m = data["mode"], m == "light" || m == "dark" { theme.mode = m }
        else if let bg = colors.first(where: { $0.0 == "background" }) { theme.mode = luminance(bg.1) > 0.5 ? "light" : "dark" }
        if velum, let t = Lib.read(Lib.join(velumDir, "settings.json")),
           let j = try? JSONSerialization.jsonObject(with: Data(t.utf8)) as? [String: Any] {
            if let v = (j["variant"] as? String)?.trimmingCharacters(in: .whitespaces), !v.isEmpty, v.allSatisfy({ $0.isLowercase && $0.isASCII }) { theme.variant = v }
            theme.tablet = (j["tablet"] as? Bool) ?? false
        }
        return theme
    }

    func color(_ k: String) -> String { colors.first { $0.0 == k }?.1 ?? "#ffffff" }

    /// `:root{--c-…}` — what the page's #theme style holds.
    var css: String {
        let body = colors.map { "--c-\($0.0.replacingOccurrences(of: "_", with: "-")):\($0.1)" }.joined(separator: ";")
        return ":root{\(body);color-scheme:\(mode)}"
    }

    /// What the page's <html> carries for Velum (the variant and the appearance) and for a finger.
    var htmlAttrs: String {
        let touch = tablet ? " data-touch" : ""
        guard let v = variant else { return touch }
        return " data-velum='\(v)' data-appearance='\(mode)'\(touch)"
    }

    var backgroundColor: NSColor {
        let h = color("background").trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count >= 6, let n = UInt32(h.prefix(6), radix: 16) else { return .windowBackgroundColor }
        return NSColor(srgbRed: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255, blue: CGFloat(n & 255) / 255, alpha: 1)
    }
}

/// The theme the windows show now, and what keeps them in step with the desktop.
final class ThemeCenter: NSObject {
    static let shared = ThemeCenter()
    private(set) var current = Theme.load()
    private var observer: NSKeyValueObservation?
    private var source: DispatchSourceFileSystemObject?
    private var pending: DispatchWorkItem?

    func start() {
        current = Theme.load()
        observer = NSApp.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in DispatchQueue.main.async { self?.changed() } }
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(changedNote), name: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil)
        watchVelum()
    }

    @objc private func changedNote() { changed() }

    private func watchVelum() {
        source?.cancel()
        let fd = open(Theme.velumDir, O_EVTONLY)
        guard fd >= 0 else { return }
        let s = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete, .attrib], queue: .main)
        s.setEventHandler { [weak self] in self?.changed() }
        s.setCancelHandler { close(fd) }
        s.resume()
        source = s
    }

    /// The desktop's colours may have changed: read them, and tell every window once the dust has settled.
    func changed() {
        pending?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.apply() }
        pending = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: item)
    }

    func apply() {
        let t = Theme.load()
        let same = t.css == current.css && t.variant == current.variant && t.tablet == current.tablet
        current = t
        watchVelum()
        guard !same else { return }
        AppDelegate.shared?.eachWindow { $0.applyTheme(t) }
    }
}

extension NoteWindow {
    /// The window and its page take a theme: the ground, the colours, Velum's variant on <html>.
    func applyTheme(_ t: Theme) {
        window.backgroundColor = t.backgroundColor
        startHost?.appearance = NSAppearance(named: t.mode == "dark" ? .darkAqua : .aqua)
        guard ready else { return }
        let attrs = "var h=document.documentElement;" + (t.variant.map { "h.dataset.velum=\(jsonString($0));h.dataset.appearance=\(jsonString(t.mode));" } ?? "delete h.dataset.velum;delete h.dataset.appearance;")
        web.evaluateJavaScript(attrs, completionHandler: nil)
        js("MdView.setTheme", [t.css, t.mode, t.tablet])
    }
}
