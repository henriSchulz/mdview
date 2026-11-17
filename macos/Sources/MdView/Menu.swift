// The menu bar. Where a command is the page's (the modes, the sidebar, Find …) the item sends the key the page listens for
// into it — the page takes Ctrl and Cmd alike, but WebKit gives the Option combinations a composed character, and the page
// reads `key` — so the menu is also what makes ⌘⌥S and its kind work on a Mac. Where it is the shell's (back, new window,
// open, reveal) the item does it itself.
import AppKit

private struct KeySpec {
    var key: String
    var code: String?
    var shift = false
    var alt = false
}

final class MenuAction: NSObject {
    let run: () -> Void
    init(_ run: @escaping () -> Void) { self.run = run }
    @objc func fire(_ s: Any?) { run() }
}

extension AppDelegate {
    private static var holders: [MenuAction] = []

    func sendKey(_ spec: (key: String, code: String?, shift: Bool, alt: Bool), ctrl: Bool = true, to w: NoteWindow?) {
        guard let w else { return }
        let code = spec.code.map { jsonString($0) } ?? "''"
        let script = "(function(){var e=new KeyboardEvent('keydown',{key:\(jsonString(spec.key)),code:\(code),ctrlKey:\(ctrl),shiftKey:\(spec.shift),altKey:\(spec.alt),bubbles:true,cancelable:true});(document.activeElement||document.body).dispatchEvent(e);})()"
        w.web.evaluateJavaScript(script, completionHandler: nil)
    }

    /// Back and Forward as the page has them (Alt+←/→): among the pages of the note first, then the places of a folder
    /// window, then the shell's — and what was typed a moment ago is handed over before the note is left (base.js LEAVING).
    func step(_ dir: Int) {
        guard let w = keyNote else { return }
        guard w.ready else { return w.on(dir < 0 ? "back" : "forward", [:]) }
        let key = dir < 0 ? "ArrowLeft" : "ArrowRight"
        sendKey((key, key, false, true), ctrl: false, to: w)
    }

    /// What the shell does when the page has handed over what is not saved yet (a message the page itself would post
    /// through base.js `post`, which saves first for those that leave the note).
    func afterFlush(_ w: NoteWindow?, _ then: @escaping () -> Void) {
        guard let w, w.ready else { return then() }
        w.web.evaluateJavaScript("MdView.flush(false)") { _, _ in then() } // (the page's save message is handled before this answer)
    }

    func buildMenu() {
        let main = NSMenu()
        func add(_ m: NSMenu, _ title: String, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command, run: @escaping () -> Void) {
            let a = MenuAction(run)
            AppDelegate.holders.append(a)
            let i = NSMenuItem(title: title, action: #selector(MenuAction.fire(_:)), keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
            i.target = a
            m.addItem(i)
        }
        /// An item for a key of the page: it only works where a window with a page is.
        func page(_ m: NSMenu, _ title: String, _ key: String, _ mods: NSEvent.ModifierFlags = .command, send: String? = nil, code: String? = nil) {
            let shift = mods.contains(.shift), alt = mods.contains(.option)
            add(m, title, key, mods) { [unowned self] in
                self.sendKey((send ?? key, code, shift, alt), to: self.keyNote)
            }
        }
        func std(_ m: NSMenu, _ title: String, _ sel: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
            let i = m.addItem(withTitle: title, action: sel, keyEquivalent: key)
            i.keyEquivalentModifierMask = mods
        }
        func submenu(_ title: String, _ fill: (NSMenu) -> Void) -> NSMenu {
            let m = NSMenu(title: title)
            let top = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            top.submenu = m
            main.addItem(top)
            fill(m)
            return m
        }

        _ = submenu("Markdown Notes") { m in
            std(m, "About Markdown Notes", #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
            m.addItem(.separator())
            add(m, "Settings…", ",") { [weak self] in SettingsWindow.shared.open(from: self?.keyNote) } // (the settings window: SettingsWindow.swift)
            m.addItem(.separator())
            let services = NSMenu(title: "Services")
            let sItem = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
            sItem.submenu = services
            m.addItem(sItem)
            NSApp.servicesMenu = services
            m.addItem(.separator())
            std(m, "Hide Markdown Notes", #selector(NSApplication.hide(_:)), "h")
            std(m, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
            std(m, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
            m.addItem(.separator())
            std(m, "Quit Markdown Notes", #selector(NSApplication.terminate(_:)), "q")
        }

        _ = submenu("File") { m in
            page(m, "New Note", "n")
            add(m, "New Quick Note") { [unowned self] in
                guard let w = self.keyNote else { return self.openQuick() }
                self.afterFlush(w) { w.on("quicknote", [:]) }
            }
            add(m, "New Window", "n", [.command, .shift]) { [unowned self] in self.openWindow(nil) }
            page(m, "New Tab", "t")
            m.addItem(.separator())
            add(m, "Open…", "o") { [unowned self] in self.openPanel(folders: false) }
            add(m, "Open Folder…", "o", [.command, .option]) { [unowned self] in self.openPanel(folders: true) }
            let recent = NSMenu(title: "Open Recent")
            recent.delegate = self
            let rItem = NSMenuItem(title: "Open Recent", action: nil, keyEquivalent: "")
            rItem.submenu = recent
            m.addItem(rItem)
            m.addItem(.separator())
            page(m, "Close Tab", "w")
            add(m, "Close Window", "w", [.command, .shift]) { [unowned self] in self.keyNote?.window.performClose(nil) }
            page(m, "Reopen Closed Tab", "t", [.command, .shift])
            m.addItem(.separator())
            page(m, "Save", "s")
            add(m, "Show in Finder", "r", [.command, .shift]) { [unowned self] in
                guard let w = self.keyNote else { return }
                if let p = w.path { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) }
                else if let f = w.folder { NSWorkspace.shared.open(URL(fileURLWithPath: f)) }
            }
            page(m, "Open in Default App", "o", [.command, .shift], send: "e") // (the page's Ctrl+Shift+E: saved first)
            m.addItem(.separator())
            page(m, "Print…", "p")
        }

        _ = submenu("Edit") { m in
            std(m, "Undo", Selector(("undo:")), "z")
            std(m, "Redo", Selector(("redo:")), "z", [.command, .shift])
            m.addItem(.separator())
            std(m, "Cut", #selector(NSText.cut(_:)), "x")
            std(m, "Copy", #selector(NSText.copy(_:)), "c")
            std(m, "Paste", #selector(NSText.paste(_:)), "v")
            std(m, "Select All", #selector(NSText.selectAll(_:)), "a")
            m.addItem(.separator())
            page(m, "Find in Note", "f")
            page(m, "Find Next", "g")
            page(m, "Find Previous", "g", [.command, .shift])
            page(m, "Search Notes", "k")
            m.addItem(.separator())
            std(m, "Start Dictation…", Selector(("startDictation:")), "")
            std(m, "Emoji & Symbols", #selector(NSApplication.orderFrontCharacterPalette(_:)), "e", [.command, .control])
        }

        _ = submenu("View") { m in
            let modes = NSMenu(title: "Mode")
            let mItem = NSMenuItem(title: "Mode", action: nil, keyEquivalent: "")
            mItem.submenu = modes
            m.addItem(mItem)
            page(modes, "Active", "1", [.command, .option], code: "Digit1")
            page(modes, "Source and Reading", "2", [.command, .option], code: "Digit2")
            page(modes, "Source", "3", [.command, .option], code: "Digit3")
            page(modes, "Reading", "4", [.command, .option], code: "Digit4")
            modes.addItem(.separator())
            page(modes, "Switch Reading ↔ Source", "e")
            m.addItem(.separator())
            page(m, "Show Sidebar", "s", [.command, .option])
            page(m, "All Notes", "g", [.command, .option])
            page(m, "Panel", "p", [.command, .option])
            page(m, "Note History", "h", [.command, .option])
            page(m, "Outline", "o", [.command, .shift])
            m.addItem(.separator())
            page(m, "Focus Mode", "f", [.command, .shift])
            page(m, "Actual Size", "0")
            page(m, "Zoom In", "=")
            page(m, "Zoom Out", "-")
            m.addItem(.separator())
            page(m, "Reload Note", "r")
            std(m, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
        }

        _ = submenu("Go") { m in
            add(m, "Back", "[") { [unowned self] in self.step(-1) }
            add(m, "Forward", "]") { [unowned self] in self.step(1) }
            m.addItem(.separator())
            page(m, "Next Tab", "\t", [.control], send: "Tab")
            page(m, "Previous Tab", "\t", [.control, .shift], send: "Tab")
            let tabs = NSMenu(title: "Go to Tab")
            let tItem = NSMenuItem(title: "Go to Tab", action: nil, keyEquivalent: "")
            tItem.submenu = tabs
            m.addItem(tItem)
            for n in 1...9 { page(tabs, "Tab \(n)", "\(n)", [.command], code: "Digit\(n)") }
            m.addItem(.separator())
            add(m, "Open Another Folder…") { [unowned self] in self.openPanel(folders: true) }
        }

        let windowMenu = submenu("Window") { m in
            std(m, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
            std(m, "Zoom", #selector(NSWindow.performZoom(_:)))
            m.addItem(.separator())
            std(m, "Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
        }
        NSApp.windowsMenu = windowMenu

        let helpMenu = submenu("Help") { m in
            add(m, "Markdown Notes Guide") { [unowned self] in self.keyNote?.on("help", [:]) ?? self.openGuide() }
            add(m, "Tour of the Controls") { [unowned self] in self.keyNote?.js("MdView.tour", []) }
        }
        NSApp.helpMenu = helpMenu
        NSApp.mainMenu = main
    }

    func openGuide() {
        let g = Page.root.appendingPathComponent("docs/FEATURES.md").path
        if Lib.isFile(g) { openWindow(g) }
    }

    // Open Recent: filled when it opens.
    func menuNeedsUpdate(_ menu: NSMenu) {
        guard menu.title == "Open Recent" else { return }
        menu.removeAllItems()
        for r in Store.shared.recents() {
            guard let p = r["path"] as? String else { continue }
            let a = MenuAction { [unowned self] in self.openChosen([URL(fileURLWithPath: p)]) }
            AppDelegate.holders.append(a)
            let i = NSMenuItem(title: Lib.name(p), action: #selector(MenuAction.fire(_:)), keyEquivalent: "")
            i.target = a
            i.toolTip = p
            menu.addItem(i)
        }
        if menu.items.isEmpty { let i = NSMenuItem(title: "No Recent Folders", action: nil, keyEquivalent: ""); i.isEnabled = false; menu.addItem(i) }
    }
}
