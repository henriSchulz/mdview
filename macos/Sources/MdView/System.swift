// The app and the system around the page (area E): what the page asks of the system — print, full screen, a picture of a
// block onto the clipboard, the settings' info, the notice of updates. Rust originals: host.rs, update.rs, shell.rs
// (settings_info, file_op), shell/app.rs. The theme is in Theme.swift, the menus in Menu.swift.
import AppKit
import WebKit

final class SystemState {}

extension NoteWindow {
    func handleSystem(_ type: String, _ msg: [String: Any]) -> Bool {
        switch type {
        case "settings-info": sendSettingsInfo(); return true
        // a build from the sources never looks for another version (update.rs: a checkout is no install): no notice, and the
        // settings show none
        case "update-check": js("MdView.settingsInfo", [["update": NSNull()]]); return true
        case "update-restart", "update-later": return true
        case "print": printPage(); return true
        case "fullscreen": setFullScreen(truthy(msg["on"])); return true
        case "snapshot": snapshot(msg); return true
        case "editcmd":
            // the page's text menu: the command runs where the focus is, as the key would
            let sel: Selector? = ["Cut": #selector(NSText.cut(_:)), "Copy": #selector(NSText.copy(_:)), "Paste": #selector(NSText.paste(_:)),
                                  "SelectAll": #selector(NSText.selectAll(_:))][msg["cmd"] as? String ?? ""]
            if let sel { window.makeFirstResponder(web); NSApp.sendAction(sel, to: web, from: nil) }
            return true
        case "zoom", "probe", "probe-pointer": return true   // (the rig's: a page's size in a test, what a test reads)
        case "log": if ProcessInfo.processInfo.environment["MDVIEW_DEBUG"] != nil { FileHandle.standardError.write(Data("[js] \(msg["text"] as? String ?? "")\n".utf8)) }; return true
        default: return false
        }
    }

    /// What the settings show that only the host knows (MdView.settingsInfo).
    func sendSettingsInfo() {
        var info: [String: Any] = [
            "version": appVersion(), "deviceName": deviceName(), "home": Lib.home(), "update": NSNull(),
        ]
        for (k, v) in settingsExtras() { info[k] = v }
        js("MdView.settingsInfo", [info])
        SettingsWindow.shared.heard(info, from: self) // (the settings window, where it was opened from this window)
    }

    /// What the other areas know of the settings: the history of the folder, the AI's key (kept by them).
    func settingsExtras() -> [String: Any] {
        var out: [String: Any] = [:]
        for (k, v) in aiSettingsInfo() { out[k] = v }   // (area D: the key's state, the model, the config folder)
        for (k, v) in historySettingsInfo() { out[k] = v }   // (area C: the history of the folder shown, and GitHub)
        return out
    }

    func deviceName() -> String {
        if let n = store.prefs["deviceName"] as? String, !n.isEmpty { return n }
        return Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    }

    /// The commit the page is read from, with its date — else the app's version.
    func appVersion() -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = ["-C", Page.root.path, "log", "-1", "--format=%h · %cs"]
        let out = Pipe()
        p.standardOutput = out; p.standardError = Pipe()
        if (try? p.run()) != nil {
            p.waitUntilExit()
            let s = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if !s.isEmpty { return s }
        }
        return (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.1"
    }

    func printPage() {
        let info = NSPrintInfo.shared
        info.horizontalPagination = .fit
        info.isVerticallyCentered = false
        let op = web.printOperation(with: info)
        op.view?.frame = web.bounds
        op.showsPrintPanel = true
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    /// The focus mode (viewer/toolbar.js): the window full screen while it lasts.
    func setFullScreen(_ on: Bool) {
        if on != window.styleMask.contains(.fullScreen) { window.toggleFullScreen(nil) }
    }

    /// A picture of a block, onto the clipboard (host.rs `snapshot`): the rectangle is in the page's pixels.
    func snapshot(_ msg: [String: Any]) {
        let n = { (k: String) in (msg[k] as? NSNumber)?.doubleValue }
        guard let x = n("x"), let y = n("y"), let w = n("w"), let h = n("h") else { return }
        let said = (msg["said"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Copied"
        let pad = 6.0
        let cfg = WKSnapshotConfiguration()
        cfg.rect = CGRect(x: max(x - pad, 0), y: max(y - pad, 0), width: w + 2 * pad, height: h + 2 * pad)
        web.takeSnapshot(with: cfg) { [weak self] image, _ in
            guard let self else { return }
            guard let image else { return self.toast("Couldn't copy the picture") }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.writeObjects([image])
            self.toast(said)
        }
    }
}
