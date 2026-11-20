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

    /// What is said: whose windows, which one, and its areas (none: a finger there is a trackpad's again) — and, for an iPad
    /// that draws the newest bit of a stroke itself until the Mac's picture of it comes (ipad-cast's ink tip): what the pen in
    /// hand draws (colour "c", breadth on the screen "w" in points, opacity "o", tool), and the board's bars, where a pen
    /// presses buttons ("holes", in the screen's coordinates as the rects are).
    static func word(window: NSWindow, on: Bool, ink: [String: Any]? = nil, holes: [[Double]] = [], web: WKWebView? = nil) -> [String: Any] {
        var w: [String: Any] = ["pid": Int(ProcessInfo.processInfo.processIdentifier), "window": window.windowNumber, "rects": on ? [area(of: window)] : [[Double]]()]
        guard on, let ink else { return w }
        let z = max(0.01, (web?.pageZoom ?? 1) * (web?.magnification ?? 1))
        var look = ink
        if let b = (ink["w"] as? NSNumber)?.doubleValue { look["w"] = b * Double(z) }
        w["ink"] = look
        if let web { w["holes"] = holes.map { screen(of: $0, in: web, zoom: z) } }
        return w
    }

    /// A rect of the page (CSS pixels: x, y, width, height) on the screen, from its top left (as events are placed).
    static func screen(of r: [Double], in web: WKWebView, zoom z: CGFloat) -> [Double] {
        guard let window = web.window else { return r }
        let top = NSScreen.screens.first?.frame.maxY ?? 0
        let x = CGFloat(r[0]) * z, y = CGFloat(r[1]) * z, wd = CGFloat(r[2]) * z, ht = CGFloat(r[3]) * z
        let inView = NSRect(x: x, y: web.isFlipped ? y : web.bounds.height - y - ht, width: wd, height: ht)
        let s = window.convertToScreen(web.convert(inView, to: nil))
        return [Double(s.minX), Double(top - s.maxY), Double(s.width), Double(s.height)]
    }

    static var said: [Int: String] = [:] // (per window, what was said last: said once)
    static func say(window: NSWindow, on: Bool, ink: [String: Any]? = nil, holes: [[Double]] = [], web: WKWebView? = nil) {
        let w = word(window: window, on: on, ink: ink, holes: holes, web: web)
        let key = String(describing: w["rects"]!) + String(describing: w["ink"] ?? "") + String(describing: w["holes"] ?? "")
        if said[window.windowNumber] == key || (!on && said[window.windowNumber] == nil) { return }
        said[window.windowNumber] = on ? key : nil
        DistributedNotificationCenter.default().postNotificationName(name, object: "mdview", userInfo: w, deliverImmediately: true)
    }
}

extension NoteWindow {
    func tellDrawArea() { TouchDraw.say(window: window, on: boardDraws && window.isKeyWindow && !window.isMiniaturized, ink: boardInk, holes: boardHoles, web: web) }
    func windowDidMove(_ n: Notification) { tellDrawArea() }
    func windowDidResize(_ n: Notification) { tellDrawArea() }
    func windowDidBecomeKey(_ n: Notification) { tellDrawArea(); tellScreen() }
    func windowDidResignKey(_ n: Notification) { tellDrawArea() }
    func windowDidMiniaturize(_ n: Notification) { tellDrawArea() }
}

/// A window on the iPad's screen is laid out for a finger, as the desktop's tablet mode lays one out on Linux (`<html
/// data-touch>`: larger targets, the chosen tab's cross, a block's handle a finger's size — viewer/hand.js); the native
/// sidebar's rows are a finger's height there too. On the Mac's own screen it is as it was. Said in the page as it is made
/// (Page.html), and again when the window goes to another screen. (Henri, 2026-11-20: the touch optimizations "wirken in der
/// mdview macos native app nicht" — "ja mach beides".)
extension NoteWindow {
    var onFingerScreen: Bool { window.screen.map(CastHost.shows) ?? false }

    func tellScreen() {
        let on = onFingerScreen
        sidebarCard?.fingers = on
        guard ready, on != saidFingerScreen else { return }
        saidFingerScreen = on
        web.evaluateJavaScript("window.MdHand&&MdHand.setScreen(\(on))", completionHandler: nil)
    }
    func windowDidChangeScreen(_ n: Notification) { tellScreen() }
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
