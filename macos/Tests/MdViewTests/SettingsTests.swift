// The settings window is the system's (SettingsWindow.swift): what it holds is the page's settings, and a change in it is a
// change of the settings as one made in a page.
import AppKit
import SwiftUI
import WebKit
import XCTest
@testable import MdView

final class SettingsTests: ShellTest {
    override func tearDown() {
        SettingsWindow.shared.window?.close()
        super.tearDown()
    }

    /// The gear (the page's openSettings) opens the system's window, filled from the page: its pages, rows and names.
    func testTheGearOpensTheSystemsWindow() {
        let w = open(write("A.md", "# A\n"))
        _ = page(w, "(MdPage.openSettings(), 1)")
        XCTAssertTrue(wait(10) { SettingsWindow.shared.window?.isVisible == true }, "no settings window")
        let m = SettingsWindow.shared.model
        XCTAssertEqual(m.pages.map(\.id).prefix(3), ["general", "appearance", "sidebarPage"])
        let general = m.pages.first { $0.id == "general" }!
        XCTAssertTrue(general.sections.flatMap(\.rows).contains { $0.key == "lang" && $0.choices.count == 2 })
        XCTAssertEqual(page(w, "!!document.querySelector('#settings[data-open]')") as? Bool, false, "the page's own settings opened too")
    }

    /// A switch turned in the window is the setting changed: kept, and told to every window's page.
    func testAChangeIsTheSettingsChanged() {
        let w = open(write("A.md", "# A\n"))
        SettingsWindow.shared.open(from: w)
        XCTAssertTrue(wait(10) { !SettingsWindow.shared.model.pages.isEmpty })
        let was = (Store.shared.prefs["slash"] as? Bool) ?? true
        SettingsWindow.shared.model.set("slash", !was)
        XCTAssertEqual(Store.shared.prefs["slash"] as? Bool, !was)
        XCTAssertTrue(wait(5) { (self.page(w, "window.MdPrefs.slash") as? Bool) == !was }, "the page was not told")
        // … and one made in a page is the window's
        w.on("prefs", ["prefs": ["slash": was]])
        XCTAssertEqual(SettingsWindow.shared.model.values["slash"] as? Bool, was)
    }

    /// Rows of the page's own kinds are not drawn here; what means nothing on a Mac is not shown; a row waiting for a style
    /// shows only with it.
    func testWhatIsShown() {
        let w = open(write("A.md", "# A\n"))
        SettingsWindow.shared.open(from: w)
        XCTAssertTrue(wait(10) { !SettingsWindow.shared.model.pages.isEmpty })
        let m = SettingsWindow.shared.model
        let rows = m.pages.flatMap { $0.sections.flatMap(\.rows) }
        func row(_ k: String) -> SettingsRow { rows.first { $0.key == k }! }
        XCTAssertFalse(m.shows(row("githubAccount")))
        XCTAssertFalse(m.shows(row("hinting")))
        XCTAssertTrue(m.shows(row("bar")))
        m.values["style"] = "auto"
        XCTAssertFalse(m.shows(row("bullet")))
        m.values["style"] = "fixed"
        XCTAssertTrue(m.shows(row("bullet")))
        XCTAssertTrue(m.hasOwn(m.pages.first { $0.id == "history" }!))
    }

    /// A picture of the window (not a check): only with MDVIEW_SNAP=<folder>.
    func testPicture() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let w = open(write("A.md", "# A\n"))
        SettingsWindow.shared.open(from: w, page: "editing")
        XCTAssertTrue(wait(10) { SettingsWindow.shared.window?.isVisible == true })
        let win = SettingsWindow.shared.window!
        win.orderBack(nil)
        wait(1)
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-x", "-o", "-l", String(win.windowNumber), Lib.join(snap!, "settings.png")]
        try p.run(); p.waitUntilExit()
    }
}
