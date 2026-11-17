// What is kept between starts: ~/Library/Application Support/MdView/state.json — the settings of the
// active mode ("active", only what differs from the defaults) and the shell's own state (the folder
// last shown, recent folders, tabs per folder, the sidebar, notes opened last …), as state.json of the Rust shell.
import Foundation

final class Store {
    static let shared = Store()
    var state: [String: Any] = [:]
    let dir: URL = {
        // (MDVIEW_STATE_DIR: another place, for the tests — never the user's own state)
        let given = ProcessInfo.processInfo.environment["MDVIEW_STATE_DIR"].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
        let d = given ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MdView")
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private var file: URL { dir.appendingPathComponent("state.json") }
    let defaults: [String: Any] = {
        (try? JSONSerialization.jsonObject(with: Data(defaultPrefsJSON.utf8))) as? [String: Any] ?? [:]
    }()

    init() {
        if let d = try? Data(contentsOf: file), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { state = o }
    }

    func save() {
        if let d = try? JSONSerialization.data(withJSONObject: state) { try? d.write(to: file, options: .atomic) }
    }

    func set(_ key: String, _ value: Any?) { state[key] = value; save() }
    func string(_ key: String) -> String? { state[key] as? String }
    func bool(_ key: String, default d: Bool = false) -> Bool { (state[key] as? Bool) ?? d }

    /// All the settings as they now are: the defaults with what was changed.
    var prefs: [String: Any] {
        var p = defaults
        for (k, v) in (state["active"] as? [String: Any]) ?? [:] where p[k] != nil { p[k] = v }
        return p
    }

    /// What the page changed of the settings, kept (only values of the kind the default has); all of them as they now are.
    @discardableResult func store(prefs new: [String: Any]) -> [String: Any] {
        var p = prefs
        for (k, v) in new {
            guard let d = defaults[k], sameKind(d, v) else { continue }
            p[k] = v
        }
        var changed: [String: Any] = [:]
        for (k, v) in p where !equal(defaults[k], v) { changed[k] = v }
        state["active"] = changed
        save()
        return p
    }

    private func sameKind(_ a: Any, _ b: Any) -> Bool {
        if a is NSNumber, b is NSNumber {
            let (x, y) = (a as! NSNumber, b as! NSNumber)
            return (CFGetTypeID(x) == CFBooleanGetTypeID()) == (CFGetTypeID(y) == CFBooleanGetTypeID())
        }
        return (a is String && b is String) || (a is [Any] && b is [Any]) || (a is [String: Any] && b is [String: Any])
    }
    private func equal(_ a: Any?, _ b: Any?) -> Bool {
        guard let a, let b else { return false }
        return (a as AnyObject).isEqual(b as AnyObject)
    }

    /// A sub-dictionary of the state (tabs per folder, notes last shown …).
    func sub(_ key: String) -> [String: Any] { state[key] as? [String: Any] ?? [:] }
    func put(_ key: String, _ k: String, _ v: Any) { var s = sub(key); s[k] = v; state[key] = s; save() }

    /// The folders opened last, newest first (those gone from the disk left out).
    func recents() -> [[String: Any]] {
        var all: [String] = []
        for p in ([state["folder"]] + ((state["recents"] as? [Any]) ?? [])).compactMap({ $0 as? String }) where Lib.isDir(p) && !all.contains(p) { all.append(p) }
        return all.prefix(12).map { ["name": Lib.name($0), "path": $0] }
    }

    /// A folder off the list of those opened last (the start screen's Remove from List).
    func forgetFolder(_ folder: String) {
        let r = recents().compactMap { $0["path"] as? String }.filter { $0 != folder }
        state["folder"] = r.first
        state["recents"] = r
        save()
    }

    func rememberFolder(_ folder: String) {
        var r = recents().compactMap { $0["path"] as? String }.filter { $0 != folder }
        r.insert(folder, at: 0)
        state["folder"] = folder
        state["recents"] = Array(r.prefix(12))
        save()
    }
}
