// Markdown Notes, native: the app, its menu, and the windows. Run: `swift run`, or ./build.sh and open MdView.app.
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    nonisolated(unsafe) static var shared: AppDelegate!
    var windows: [NoteWindow] = []

    func eachWindow(_ f: (NoteWindow) -> Void) { windows.forEach(f) }

    func applicationDidFinishLaunching(_ n: Notification) {
        AppDelegate.shared = self
        buildMenu()
        let args = CommandLine.arguments.dropFirst().filter { !$0.hasPrefix("-") }
        if windows.isEmpty { args.isEmpty ? openWindow(nil) : args.forEach { openWindow(($0 as NSString).standardizingPath) } }
        NSApp.activate(ignoringOtherApps: true)
    }

    func application(_ app: NSApplication, open urls: [URL]) {
        for u in urls where u.isFileURL { openWindow(u.path) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    func openWindow(_ path: String?) {
        let w = NoteWindow(path: path)
        w.onClose = { [weak self] w in self?.windows.removeAll { $0 === w } }
        windows.append(w)
    }

    @objc func newWindow(_ s: Any?) { openWindow(nil) }

    @objc func openPanel() {
        let p = NSOpenPanel()
        p.allowedContentTypes = [.plainText, .data]
        p.allowsMultipleSelection = true
        p.canChooseDirectories = false
        if p.runModal() == .OK { p.urls.forEach { openWindow($0.path) } }
    }

    @objc func reload(_ s: Any?) { (NSApp.keyWindow?.delegate as? NoteWindow)?.render(keepScroll: true) }

    func buildMenu() {
        let main = NSMenu()
        func item(_ m: NSMenu, _ title: String, _ sel: Selector?, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
            let i = m.addItem(withTitle: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
        }
        func submenu(_ title: String, _ fill: (NSMenu) -> Void) {
            let m = NSMenu(title: title)
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = m
            main.addItem(top)
            fill(m)
        }
        submenu("MdView") { m in
            item(m, "About Markdown Notes", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
            m.addItem(.separator())
            item(m, "Hide Markdown Notes", #selector(NSApplication.hide(_:)), "h")
            item(m, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
            m.addItem(.separator())
            item(m, "Quit Markdown Notes", #selector(NSApplication.terminate(_:)), "q")
        }
        submenu("File") { m in
            item(m, "New Window", #selector(newWindow(_:)), "n")
            item(m, "Open…", #selector(openPanel), "o")
            m.addItem(.separator())
            item(m, "Close Window", #selector(NSWindow.performClose(_:)), "w")
        }
        submenu("Edit") { m in
            item(m, "Undo", Selector(("undo:")), "z")
            item(m, "Redo", Selector(("redo:")), "z", [.command, .shift])
            m.addItem(.separator())
            item(m, "Cut", #selector(NSText.cut(_:)), "x")
            item(m, "Copy", #selector(NSText.copy(_:)), "c")
            item(m, "Paste", #selector(NSText.paste(_:)), "v")
            item(m, "Select All", #selector(NSText.selectAll(_:)), "a")
        }
        submenu("View") { m in
            item(m, "Reload Note", #selector(reload(_:)), "r")
            item(m, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        }
        submenu("Window") { m in
            item(m, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
            item(m, "Zoom", #selector(NSWindow.performZoom(_:)))
            NSApp.windowsMenu = m
        }
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
