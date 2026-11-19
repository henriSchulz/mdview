// Where a finger draws at once. An iPad that is the Mac's screen (ipad-cast) hands its fingers on as a trackpad's: one finger
// scrolls, and only a finger that rested 0.45 s drags — on a whiteboard one had to press that long before a stroke began
// (Henri, 2026-11-19: "man muss beim zeichnen lange drücken, bis erst der touch ankommt"). While a pen or the eraser is in
// hand on a board (the page's `board-draw`) and the window is the key one, the shell says where the board is — a distributed
// notification, `com.henri.touch.drawAreas` — and ipad-cast makes a drag of a finger that moves there (its DrawAreas.swift).
// Nobody listening: nothing happens. Said again when the window moves, is sized, comes to the front or leaves it.
import AppKit
import WebKit

enum TouchDraw {
    static let name = Notification.Name("com.henri.touch.drawAreas")

    /// The window's part under the bar, as the display's own coordinates have it (from the top left of the main screen, as
    /// events are placed): [x, y, width, height].
    static func area(of window: NSWindow) -> [Double] {
        let r = window.convertToScreen(window.contentLayoutRect)
        let top = NSScreen.screens.first?.frame.maxY ?? r.maxY
        return [Double(r.minX), Double(top - r.maxY), Double(r.width), Double(r.height)]
    }

    /// What is said: whose windows, which one, and its areas (none: a finger there is a trackpad's again).
    static func word(window: NSWindow, on: Bool) -> [String: Any] {
        ["pid": Int(ProcessInfo.processInfo.processIdentifier), "window": window.windowNumber, "rects": on ? [area(of: window)] : [[Double]]()]
    }

    static var said: [Int: String] = [:] // (per window, what was said last: said once)
    static func say(window: NSWindow, on: Bool) {
        let w = word(window: window, on: on), key = String(describing: w["rects"]!)
        if said[window.windowNumber] == key || (!on && said[window.windowNumber] == nil) { return }
        said[window.windowNumber] = on ? key : nil
        DistributedNotificationCenter.default().postNotificationName(name, object: "mdview", userInfo: w, deliverImmediately: true)
    }
}

extension NoteWindow {
    func tellDrawArea() { TouchDraw.say(window: window, on: boardDraws && window.isKeyWindow && !window.isMiniaturized) }
    func windowDidMove(_ n: Notification) { tellDrawArea() }
    func windowDidResize(_ n: Notification) { tellDrawArea() }
    func windowDidBecomeKey(_ n: Notification) { tellDrawArea() }
    func windowDidResignKey(_ n: Notification) { tellDrawArea() }
    func windowDidMiniaturize(_ n: Notification) { tellDrawArea() }
}


/// The Apple Pencil's own double tap and squeeze from an iPad that is the Mac's screen: ipad-cast says them as a distributed
/// notification, `com.henri.pencil` — action ("tap" | "squeeze"), phase (a squeeze's "began" … "ended"), preferred (what the
/// iPad's own setting says: "switchEraser", "switchPrevious", "showColorPalette", "showInkAttributes",
/// "showContextualPalette", "ignore", …) and x, y where the Pencil hovers (the screen's own coordinates, from the top left,
/// as events are placed). The front window's whiteboard takes them (board.js: MdBoard.pencil) — Henri, 2026-11-19: Whiteboard
/// und Notizbuch "so gut wie es nur geht auf den Apple Pencil und den Cast optimieren".
enum PencilActions {
    static let name = Notification.Name("com.henri.pencil")
    private static var token: NSObjectProtocol?

    static func listen() {
        guard token == nil else { return }
        token = DistributedNotificationCenter.default().addObserver(forName: name, object: nil, queue: .main) { n in
            take(n.userInfo ?? [:])
        }
    }

    /// What the page is told: the action as it came, the place turned into the web view's own (CSS pixels).
    static func word(_ info: [AnyHashable: Any], in web: WKWebView) -> [String: Any] {
        var a: [String: Any] = [:]
        for k in ["action", "phase", "preferred"] { if let v = info[k] as? String { a[k] = v } }
        if let x = (info["x"] as? NSNumber)?.doubleValue, let y = (info["y"] as? NSNumber)?.doubleValue, let window = web.window {
            let top = NSScreen.screens.first?.frame.maxY ?? 0
            let inWindow = window.convertPoint(fromScreen: NSPoint(x: x, y: top - y))
            let p = web.convert(inWindow, from: nil), z = max(0.01, web.pageZoom * web.magnification)
            a["x"] = Double(p.x / z)
            a["y"] = Double((web.isFlipped ? p.y : web.bounds.height - p.y) / z)
        }
        return a
    }

    static func take(_ info: [AnyHashable: Any]) {
        guard let w = NSApp.keyWindow?.delegate as? NoteWindow else { return }
        w.web.evaluateJavaScript("window.MdBoard&&MdBoard.pencil&&MdBoard.pencil(\(jsonString(word(info, in: w.web))))", completionHandler: nil)
    }
}
