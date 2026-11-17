// The page's menus as the system's own (MdHost.menu — viewer/base.js hostMenu): the page hands over rows, the shell shows
// an NSMenu where the page would have drawn its own, and answers with the way to the row chosen ([i], or [i, j] in a
// row's menu beside it), or nothing. Rows: { label, key ("Ctrl+Shift+X" as the page writes keys), on (can be chosen),
// check, danger, sign (the page's name of its sign), svg (the sign as the page draws it), sub: [rows] } or null for a rule.
import AppKit
import WebKit

extension NoteWindow: WKScriptMessageHandlerWithReply {
    /// What the page asks and waits for (the "ask" handler: a promise in the page). Answered once the menu is gone — it is
    /// shown after this call has returned, never inside it (its tracking would run within WebKit's own message).
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = m.body as? [String: Any], body["type"] as? String == "menu", let spec = body["spec"] as? [String: Any] else {
            return replyHandler(nil, nil)
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, !self.gone else { return replyHandler(nil, nil) }
            replyHandler(self.showMenu(spec), nil)
        }
    }

    /// The menu shown, until it is gone: the way to what was chosen, or NSNull.
    func showMenu(_ spec: [String: Any]) -> Any {
        var chosen: [Int]?
        let menu = NativeMenu.make(spec["rows"] as? [Any] ?? [], path: []) { chosen = $0 }
        NativeMenu.shown = menu
        defer { NativeMenu.shown = nil }
        let x = (spec["x"] as? NSNumber)?.doubleValue ?? 0, y = (spec["y"] as? NSNumber)?.doubleValue ?? 0
        let point = { (x: Double, y: Double) in NSPoint(x: x, y: self.web.isFlipped ? y : self.web.bounds.height - y) }
        if let at = spec["at"] as? [String: Any] {
            // a menu of a button: under it, its left edge on the button's (its right one, where the page hangs it so)
            let n = { (k: String) in (at[k] as? NSNumber)?.doubleValue ?? 0 }
            let right = (at["right"] as? Bool) == true
            var p = point(right ? n("x") + n("w") : n("x"), n("y") + n("h") + 4)
            if right { p.x -= menu.size.width }
            menu.popUp(positioning: nil, at: p, in: web)
        } else if let e = (web as? FilesWebView)?.lastRightDown, ProcessInfo.processInfo.systemUptime - e.timestamp < 1.5 {
            // a right click: where the system puts its own menu for it
            NSMenu.popUpContextMenu(menu, with: e, for: web)
        } else {
            menu.popUp(positioning: nil, at: point(x, y), in: web) // (a key asked for it: at the place the page names)
        }
        (web as? FilesWebView)?.lastRightDown = nil
        return chosen.map { $0 as Any } ?? NSNull()
    }
}

enum NativeMenu {
    /// The menu on the screen (the tests close it).
    static var shown: NSMenu?
    private static var holders: [MenuAction] = []

    static func make(_ rows: [Any], path: [Int], chose: @escaping ([Int]) -> Void) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        var hold: [MenuAction] = []
        for (i, any) in rows.enumerated() {
            guard let r = any as? [String: Any] else { menu.addItem(.separator()); continue }
            let item = NSMenuItem(title: r["label"] as? String ?? "", action: nil, keyEquivalent: "")
            item.isEnabled = (r["on"] as? Bool) ?? true
            if (r["check"] as? Bool) == true { item.state = .on }
            item.image = image(id: r["id"] as? String ?? "", sign: r["sign"] as? String ?? "", svg: r["svg"] as? String ?? "")
            if (r["danger"] as? Bool) == true {
                item.attributedTitle = NSAttributedString(string: item.title, attributes: [.foregroundColor: NSColor.systemRed, .font: NSFont.menuFont(ofSize: 0)])
            }
            if let (k, mods) = keyEquivalent(r["key"] as? String ?? "") { item.keyEquivalent = k; item.keyEquivalentModifierMask = mods }
            if let sub = r["sub"] as? [Any] {
                item.submenu = make(sub, path: path + [i], chose: chose)
            } else {
                let a = MenuAction { chose(path + [i]) }
                hold.append(a)
                item.target = a
                item.action = #selector(MenuAction.fire(_:))
            }
            menu.addItem(item)
        }
        holders = path.isEmpty ? hold : holders + hold // (the actions live as long as their menu is the one shown)
        return menu
    }

    /// The page's key ("Ctrl+Shift+Z", "Delete", "F2") as the menu shows keys: Ctrl is ⌘ here, as the page reads it.
    static func keyEquivalent(_ s: String) -> (String, NSEvent.ModifierFlags)? {
        guard !s.isEmpty else { return nil }
        var parts = s.components(separatedBy: "+")
        var key = parts.removeLast()
        if key.isEmpty && s.hasSuffix("++") { key = "+" }
        var mods: NSEvent.ModifierFlags = []
        for p in parts {
            switch p.lowercased() {
            case "ctrl", "cmd", "meta", "mod": mods.insert(.command)
            case "shift": mods.insert(.shift)
            case "alt", "option": mods.insert(.option)
            default: return nil
            }
        }
        let named: [String: Int] = ["del": NSBackspaceCharacter, "delete": NSBackspaceCharacter, "backspace": NSBackspaceCharacter, "enter": NSCarriageReturnCharacter,
                                    "return": NSCarriageReturnCharacter, "tab": NSTabCharacter, "esc": 0x1b, "escape": 0x1b,
                                    "up": NSUpArrowFunctionKey, "down": NSDownArrowFunctionKey, "left": NSLeftArrowFunctionKey,
                                    "right": NSRightArrowFunctionKey, "arrowup": NSUpArrowFunctionKey, "arrowdown": NSDownArrowFunctionKey,
                                    "arrowleft": NSLeftArrowFunctionKey, "arrowright": NSRightArrowFunctionKey, "space": 0x20]
        if let c = named[key.lowercased()], let u = UnicodeScalar(c) { return (String(Character(u)), mods) }
        if key.count > 1, key.lowercased().hasPrefix("f"), let n = Int(key.dropFirst()), (1...20).contains(n), let u = UnicodeScalar(NSF1FunctionKey + n - 1) {
            return (String(Character(u)), mods)
        }
        guard key.count == 1 else { return nil }
        // (a capital asks for Shift by itself in a key equivalent: the letter is given small, Shift by the mask)
        return (key.lowercased(), mods)
    }

    /// The page's signs as the system's symbols where there is one of the same meaning; else the page's own drawing.
    static let symbols: [String: String] = [
        "cut": "scissors", "copy": "doc.on.doc", "clip": "doc.on.clipboard", "pastePlain": "doc.plaintext", "select": "selection.pin.in.out",
        "external": "arrow.up.right.square", "link": "link", "picture": "photo", "pdf": "doc.richtext", "zoom": "plus.magnifyingglass",
        "eye": "eye", "eyeOff": "eye.slash", "gear": "gearshape", "trash": "trash", "spark": "sparkles", "duplicate": "plus.square.on.square",
        "front": "square.3.layers.3d.top.filled", "back": "square.3.layers.3d.bottom.filled", "connect": "point.topleft.down.to.point.bottomright.curvepath",
        "group": "square.on.square.dashed", "ungroup": "square.dashed", "lock": "lock", "unlock": "lock.open", "brush": "paintbrush",
        "chat": "bubble.left", "note": "doc.text", "folder": "folder", "folderPlus": "folder.badge.plus", "plus": "plus", "rename": "pencil",
        "reveal": "magnifyingglass", "apps": "square.grid.2x2", "file": "doc", "list": "list.bullet", "search": "magnifyingglass",
        "pencil": "pencil", "source": "chevron.left.forwardslash.chevron.right", "book": "book", "up": "chevron.up", "down": "chevron.down",
        "x": "xmark", "chevron": "chevron.right", "sidebar": "sidebar.left", "panel": "sidebar.right", "split": "rectangle.split.2x1",
        "title": "textformat", "check": "checkmark", "star": "star", "info": "info.circle", "history": "clock.arrow.circlepath",
        "home": "house", "board": "scribble.variable", "download": "arrow.down.circle", "share": "square.and.arrow.up",
        "tab": "macwindow.badge.plus", "window": "macwindow", "palette": "paintpalette", "undo": "arrow.uturn.backward",
        "redo": "arrow.uturn.forward", "sort": "arrow.up.arrow.down", "hide": "eye.slash", "show": "eye", "import": "square.and.arrow.down",
    ]

    /// What a row is (the file menu's commands — viewer/sidebar.js entry —, the keys of strings.js) as the Finder signs it:
    /// before the page's sign, which one drawing stands for several meanings ("down" adds files and downloads).
    static let byID: [String: String] = [
        "ctx:open": "doc.text", "ctx:opentab": "plus.square.on.square", "ctx:openbeside": "rectangle.split.2x1", "ctx:tab:new": "plus",
        "ctx:tab:reopen": "arrow.uturn.backward", "ctx:tab:split": "rectangle.split.2x1", "ctx:tab:unsplit": "rectangle", "ctx:tab:close": "xmark",
        "ctx:tab:others": "xmark.square", "ctx:history:conflicts": "exclamationmark.triangle", "ctx:history:show": "clock.arrow.circlepath",
        "ctx:history:on": "clock.badge.checkmark", "ctx:history:is": "checkmark.circle", "ctx:history:off": "clock.badge.xmark",
        "ctx:newnote": "square.and.pencil", "ctx:newfolder": "folder.badge.plus", "ctx:newboard": "scribble.variable", "ctx:newbook": "book.closed",
        "ctx:addfiles": "doc.badge.plus", "ctx:pastef": "doc.on.clipboard", "ctx:settings": "gearshape", "ctx:default": "arrow.up.forward.app",
        "ctx:openwith": "square.grid.2x2", "ctx:reveal": "folder", "ctx:download": "arrow.down.circle", "ctx:embed": "rectangle.and.paperclip",
        "ctx:boardnote": "doc.text", "ctx:boardfree": "doc", "ctx:copyf": "doc.on.doc", "ctx:cutf": "scissors", "ctx:duplicate": "plus.square.on.square",
        "ctx:copypath": "link", "ctx:share": "square.and.arrow.up", "ctx:look": "paintpalette", "ctx:fav:off": "star", "ctx:fav:on": "star.fill",
        "ctx:rename": "pencil", "ctx:hide": "eye.slash", "ctx:unhide": "eye", "ctx:trash": "trash", "ctx:sub:show": "eye",
    ]

    static func image(id: String = "", sign: String, svg: String) -> NSImage? {
        if let name = byID[id], let img = NSImage(systemSymbolName: name, accessibilityDescription: nil) { return img }
        if let name = symbols[sign], let img = NSImage(systemSymbolName: name, accessibilityDescription: nil) { return img }
        guard !svg.isEmpty, svg.contains("<svg") else { return nil }
        var text = svg
        if !text.contains("xmlns=") { text = text.replacingOccurrences(of: "<svg", with: "<svg xmlns=\"http://www.w3.org/2000/svg\"") }
        guard let img = NSImage(data: Data(text.utf8)) else { return nil }
        img.size = NSSize(width: 16, height: 16)
        img.isTemplate = true // (drawn in the menu's own colour, as a symbol is)
        return img
    }
}
