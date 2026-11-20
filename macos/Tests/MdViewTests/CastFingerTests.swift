// An iPad that is the Mac's screen (ipad-cast): its fingers are a finger's for the whole page, not the whiteboard's alone, and
// a window on its screen is laid out for a finger (Henri, 2026-11-20: the touch optimizations "wirken in der mdview macos
// native app nicht" — "ja mach beides"). The cast's events are made here as it posts them: a mouse's, from its process.
import AppKit
import XCTest
@testable import MdView

final class CastFingerTests: ShellTest {
    override func tearDown() {
        CastHost.fixed = nil
        super.tearDown()
    }

    /// An event as the cast posts it (from its process) or as the Mac's own mouse makes it, at a point of the web view.
    func event(_ w: NoteWindow, _ type: CGEventType, _ x: CGFloat, _ y: CGFloat, cast: Bool) -> NSEvent {
        let web = w.web, top = NSScreen.screens[0].frame.maxY
        let inWindow = web.convert(NSPoint(x: x, y: web.isFlipped ? y : web.bounds.height - y), to: nil)
        let s = w.window.convertPoint(toScreen: inWindow)
        let button: CGMouseButton = [.rightMouseDown, .rightMouseUp].contains(type) ? .right : .left
        let c = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: s.x, y: top - s.y), mouseButton: button)!
        c.setIntegerValueField(.eventSourceUnixProcessID, value: cast ? Int64(getpid()) : 0)
        return NSEvent(cgEvent: c)!
    }
    /// (the application hears them before any view — FilesWebView's monitor; a window nobody sees gets no events of the
    /// system's, so what it says is asked here, then WebKit is handed the event)
    func send(_ w: NoteWindow, _ e: NSEvent) {
        (w.web as! FilesWebView).penSay(e)
        switch e.type {
        case .leftMouseDown: w.web.mouseDown(with: e)
        case .leftMouseUp: w.web.mouseUp(with: e)
        case .rightMouseDown: w.web.rightMouseDown(with: e)
        case .rightMouseUp: w.web.rightMouseUp(with: e)
        default: break
        }
    }
    func attr(_ w: NoteWindow, _ name: String) -> Bool { (page(w, "document.documentElement.hasAttribute('\(name)')") as? Bool) == true }

    /// A finger of the cast is a finger: its tap makes the hand one (the bars of tiles, a finger's sizes), its scroll keeps it
    /// one, held and let go on the note's text it has the edit menu over it; the Mac's own mouse is a mouse.
    func testACastFingerIsAFingerForTheWholePage() {
        CastHost.fixed = Int64(getpid())
        let w = open(write("F.md", "# Finger\n\nSome text to hold a finger on, long enough to be found.\n\nMore text.\n"))
        _ = page(w, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true }, "the active mode did not load")
        wait(0.5)
        let at = (page(w, "(() => { const r = document.querySelector('.pm p').getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2]; })()") as? [NSNumber]) ?? []
        XCTAssertEqual(at.count, 2, "no paragraph in the note")
        guard at.count == 2 else { return }
        let x = CGFloat(at[0].doubleValue), y = CGFloat(at[1].doubleValue)
        XCTAssertFalse(attr(w, "data-finger"))

        // a tap of the cast: a click from its process
        send(w, event(w, .leftMouseDown, x, y, cast: true))
        send(w, event(w, .leftMouseUp, x, y, cast: true))
        XCTAssertTrue(wait(3) { self.attr(w, "data-finger") }, "a finger's tap through the cast did not make the hand a finger")
        XCTAssertTrue(wait(3) { self.attr(w, "data-tiles") }, "the note has not the bars of a finger")

        // the Mac's own mouse: a mouse again (a moment later — what the shell said of the finger is old by then)
        wait(0.4)
        send(w, event(w, .leftMouseDown, x, y, cast: false))
        send(w, event(w, .leftMouseUp, x, y, cast: false))
        XCTAssertTrue(wait(3) { !self.attr(w, "data-finger") }, "the Mac's mouse was taken for a finger")

        // a wheel nobody said is a touchpad's; the cast's finger scrolling (its wheels, said by the shell) is a finger's
        let wheel = "(document.getElementById('content').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 12 })), 1)"
        _ = page(w, wheel)
        XCTAssertFalse(attr(w, "data-finger"), "a touchpad's wheel made the hand a finger")
        let scroll = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -12, wheel2: 0, wheel3: 0)!
        scroll.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        (w.web as! FilesWebView).penSay(NSEvent(cgEvent: scroll)!)
        _ = page(w, wheel)
        XCTAssertTrue(attr(w, "data-finger"), "a finger's scroll through the cast was not a finger's")

        // held and let go on the note's text — the cast's right click —: the edit menu over the finger, not a mouse's menu
        send(w, event(w, .rightMouseDown, x, y, cast: true))
        send(w, event(w, .rightMouseUp, x, y, cast: true))
        XCTAssertTrue(wait(3) { (self.page(w, "!!document.querySelector('#editmenu[data-open]')") as? Bool) == true },
                      "a finger held on the text had no edit menu")
        XCTAssertEqual(page(w, "[...document.querySelectorAll('#editmenu .em-word')].length") as? Int, 2, "Paste and Select All")
    }

    /// A window on the iPad's screen is laid out for a finger — said in its page from the start, and as it goes from one screen
    /// to the other; the native sidebar's rows are a finger's height there.
    func testAWindowOnTheIPadsScreenIsLaidOutForAFinger() {
        let shows = CastHost.shows
        defer { CastHost.shows = shows }
        CastHost.shows = { _ in false }
        write("Notizen/A.md", "# A\n")
        let w = openPainted(folder: dir)
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        XCTAssertTrue(wait(5) { (w.sidebarCard?.rows.count ?? 0) >= 3 }, "the card's rows did not come")
        let card = w.sidebarCard!, row = card.rows.firstIndex { $0["kind"] as? String != "cap" } ?? 0
        XCTAssertFalse(attr(w, "data-touch"), "the Mac's screen laid out for a finger")
        XCTAssertEqual(card.table.rect(ofRow: row).height, 28, accuracy: 0.5)

        // gone to the iPad's screen
        CastHost.shows = { _ in true }
        NotificationCenter.default.post(name: NSWindow.didChangeScreenNotification, object: w.window)
        XCTAssertTrue(wait(3) { self.attr(w, "data-touch") }, "the window on the iPad's screen is not laid out for a finger")
        XCTAssertEqual(card.table.rect(ofRow: row).height, 44, accuracy: 0.5, "the sidebar's rows are not a finger's height")

        // and back
        CastHost.shows = { _ in false }
        NotificationCenter.default.post(name: NSWindow.didChangeScreenNotification, object: w.window)
        XCTAssertTrue(wait(3) { !self.attr(w, "data-touch") }, "back on the Mac's screen the window kept a finger's layout")
        XCTAssertEqual(card.table.rect(ofRow: row).height, 28, accuracy: 0.5)

        // a window made on the iPad's screen has it in its page from the start
        CastHost.shows = { _ in true }
        let v = open(write("S.md", "# S\n"))
        XCTAssertTrue(attr(v, "data-touch-screen") && attr(v, "data-touch"), "a new window on the iPad's screen")
        // the desktop's own tablet mode going off leaves the screen's
        _ = page(v, "(MdHand.setTablet(false), 1)")
        XCTAssertTrue(attr(v, "data-touch"), "tablet mode off took the iPad screen's layout away")
    }

    /// Pictures of a note and of the Library on the iPad's screen, under a finger (not a check): only with MDVIEW_SNAP=<folder>.
    func testPicture() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let shows = CastHost.shows
        defer { CastHost.shows = shows }
        CastHost.shows = { _ in true }
        write("Notizen/A.md", "# A\n\n- [ ] a task\n")
        write("Notizen/B.md", "# B\n")
        let note = write("Notizen/Note.md", "# A note\n\nSome text, a list:\n\n- one\n- two\n\n```js\nconst x = 1;\n```\n")
        let w = openPainted(note)
        w.window.setContentSize(NSSize(width: 1180, height: 780))
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        _ = page(w, "MdView.setMode('active'), true")
        wait(1.5)
        _ = page(w, "(document.documentElement.toggleAttribute('data-finger', true), 1)")
        wait(0.8)
        func shot(_ name: String) throws {
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-o", "-l", String(w.window.windowNumber), Lib.join(snap!, name)]
            try p.run(); p.waitUntilExit()
        }
        try shot("cast-note.png")
        CastHost.shows = { _ in false }
        NotificationCenter.default.post(name: NSWindow.didChangeScreenNotification, object: w.window)
        _ = page(w, "(document.documentElement.toggleAttribute('data-finger', false), 1)")
        wait(0.8)
        try shot("mac-note.png")
    }
}
