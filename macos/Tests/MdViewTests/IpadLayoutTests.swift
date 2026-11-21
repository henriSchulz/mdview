// The iPad's layout in the Mac app, chosen in the settings (Henri, 2026-11-21: "können wir so einen modus hier in die native
// macos app einbauen aktivierbar über einstellungen"): the page lays itself out as on an iPad (viewer/tablet.js), the system's
// bar goes (MacChrome) and so does the sidebar's card (NativeSidebar) — always, or while the window stands on an iPad's screen.
import AppKit
import XCTest
@testable import MdView

final class IpadLayoutTests: ShellTest {
    private var shows: ((NSScreen) -> Bool)!
    override func setUp() {
        super.setUp()
        shows = CastHost.shows
        CastHost.shows = { _ in false }
    }
    override func tearDown() {
        CastHost.shows = shows
        super.tearDown()
    }

    func attr(_ w: NoteWindow, _ name: String) -> Bool { (page(w, "document.documentElement.hasAttribute('\(name)')") as? Bool) == true }
    /// Whether something of the page is there to be seen and pressed.
    func shown(_ w: NoteWindow, _ sel: String) -> Bool {
        (page(w, "(() => { const e = document.querySelector('\(sel)'); if (!e) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; })()") as? Bool) == true
    }
    func overview(_ w: NoteWindow) -> Bool { (page(w, "document.body.hasAttribute('data-overview')") as? Bool) == true }

    /// A folder's note in a window wide enough for the layout (as on an iPad: 761 × 600 and more), the sidebar open.
    func window() -> NoteWindow {
        write("Notizen/A.md", "# A\n\nSome text.\n")
        let note = write("Notizen/B.md", "# B\n\nMore text.\n")
        let w = openPainted(folder: dir)
        w.window.setContentSize(NSSize(width: 1180, height: 820))
        w.openNote(note, tab: false, fragment: nil)
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdPage && MdPage.current)") as? Bool) == true }, "the note was not drawn")
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        XCTAssertTrue(wait(5) { (w.sidebarCard?.rows.count ?? 0) >= 2 }, "the card's rows did not come")
        return w
    }

    /// Chosen in the settings, the window is laid out as on an iPad at once — the system's bar and the sidebar's card gone, the
    /// iPad's buttons in the corners, below the window's own three —; a mouse keeps its menus, a finger has the iPad's bars; and
    /// set off again, the window is as it was, its sidebar open again.
    func testTheSettingLaysTheWindowOutAsAnIPad() {
        let w = window()
        let card = w.sidebarCard!.card, bar = w.chrome!.toolbar
        XCTAssertFalse(attr(w, "data-ipad"), "laid out as an iPad before it was chosen")
        XCTAssertTrue(wait(3) { bar.isVisible && !card.isHidden }, "the bar and the card are not there to begin with")
        let keys = page(w, "MdView.settingsSchema().then((s) => s.pages.flatMap((p) => p.sections.flatMap((c) => c.rows.map((r) => r.key))))") as? [String] ?? []
        XCTAssertTrue(keys.contains("ipadLayout"), "the settings do not offer it")

        w.on("prefs", ["prefs": ["ipadLayout": "always"]])
        XCTAssertTrue(wait(3) { self.attr(w, "data-ipad") }, "the setting did not lay the window out as an iPad")
        XCTAssertTrue(wait(3) { !bar.isVisible && card.isHidden }, "the system's bar (\(bar.isVisible)) or the card (hidden: \(card.isHidden)) stayed")
        XCTAssertTrue(wait(3) { self.shown(w, "#ipad-nav .ip-all") && self.shown(w, "#ipad-tools") && self.shown(w, "#toolbar") }, "the iPad's buttons are not there")
        XCTAssertFalse(shown(w, "#tabs"), "the tabs stayed")
        let macBar = (page(w, "parseFloat(document.documentElement.style.getPropertyValue('--mac-bar')) || 0") as? NSNumber)?.doubleValue ?? -1
        let top = (page(w, "document.getElementById('ipad-nav').getBoundingClientRect().top") as? NSNumber)?.doubleValue ?? -1
        XCTAssertEqual(top, macBar + 10, accuracy: 1, "the iPad's buttons are not under the window's own")
        let text = (page(w, "document.querySelector('#content h1, #active h1').getBoundingClientRect().top") as? NSNumber)?.doubleValue ?? -1
        XCTAssertGreaterThan(text, top + 44, "the note begins under the iPad's buttons")

        // a mouse keeps its menus; a finger has the iPad's bars
        XCTAssertEqual(page(w, "MdPage.tiles.on()") as? Bool, false, "a mouse lost its menus")
        _ = page(w, "(document.documentElement.toggleAttribute('data-finger', true), 1)")
        XCTAssertEqual(page(w, "MdPage.tiles.on()") as? Bool, true, "a finger has no bars")
        _ = page(w, "(document.documentElement.toggleAttribute('data-finger', false), 1)")

        // the button of four parts: to All Notes and back
        _ = page(w, "(document.querySelector('#ipad-nav .ip-all').click(), 1)")
        XCTAssertTrue(wait(3) { self.overview(w) }, "All Notes did not open")
        _ = page(w, "(document.querySelector('#ipad-nav .ip-all').click(), 1)")
        XCTAssertTrue(wait(3) { !self.overview(w) }, "the note did not come back")

        w.on("prefs", ["prefs": ["ipadLayout": "off"]])
        XCTAssertTrue(wait(3) { !self.attr(w, "data-ipad") }, "set off, the layout stayed")
        XCTAssertTrue(wait(3) { bar.isVisible && !card.isHidden && card.frame.minX > 0 }, "the bar (\(bar.isVisible)) or the open card (\(card.frame)) did not come back")
        XCTAssertFalse(shown(w, "#ipad-nav"), "the iPad's buttons stayed")
        XCTAssertFalse(shown(w, "#toolbar"), "the page's own toolbar shows beside the system's")
    }

    /// "On an iPad's screen": the layout comes as the window goes to the iPad that is the Mac's screen (ipad-cast) and goes as it
    /// comes back; a window made there has it from the start.
    func testOnAnIPadsScreenOnly() {
        _ = AppDelegate.shared.applyPrefs(["ipadLayout": "screen"])
        let w = window()
        XCTAssertFalse(attr(w, "data-ipad"), "laid out as an iPad on the Mac's own screen")
        XCTAssertTrue(wait(3) { w.chrome!.toolbar.isVisible })

        CastHost.shows = { _ in true }
        NotificationCenter.default.post(name: NSWindow.didChangeScreenNotification, object: w.window)
        XCTAssertTrue(wait(3) { self.attr(w, "data-ipad") }, "the window on the iPad's screen is not laid out as an iPad")
        XCTAssertTrue(wait(3) { !w.chrome!.toolbar.isVisible && w.sidebarCard!.card.isHidden }, "the bar or the card stayed on the iPad's screen")

        CastHost.shows = { _ in false }
        NotificationCenter.default.post(name: NSWindow.didChangeScreenNotification, object: w.window)
        XCTAssertTrue(wait(3) { !self.attr(w, "data-ipad") }, "back on the Mac's screen the iPad's layout stayed")
        XCTAssertTrue(wait(3) { w.chrome!.toolbar.isVisible && !w.sidebarCard!.card.isHidden }, "the bar or the card did not come back")

        CastHost.shows = { _ in true }
        let v = open(write("S.md", "# S\n"))
        XCTAssertTrue(attr(v, "data-ipad"), "a window made on the iPad's screen is not laid out as an iPad")
    }

    /// Pictures of the layout in a window and of All Notes (not a check): only with MDVIEW_SNAP=<folder>.
    func testPicture() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let w = window()
        write("Notizen/C.md", "# C\n\n- one\n- two\n")
        w.on("prefs", ["prefs": ["ipadLayout": "always"]])
        XCTAssertTrue(wait(3) { self.attr(w, "data-ipad") })
        wait(1.2)
        func shot(_ name: String) throws {
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-o", "-l", String(w.window.windowNumber), Lib.join(snap!, name)]
            try p.run(); p.waitUntilExit()
        }
        try shot("ipad-note.png")
        _ = page(w, "MdView.setMode('active'), true")
        wait(1.5)
        try shot("ipad-active.png")
        _ = page(w, "(document.querySelector('#ipad-nav .ip-all').click(), 1)")
        wait(1.5)
        try shot("ipad-all.png")
    }
}
