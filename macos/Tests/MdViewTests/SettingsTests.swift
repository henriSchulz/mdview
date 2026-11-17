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
        XCTAssertTrue(m.shows(row("githubAccount")), "GitHub is drawn here now")
        XCTAssertFalse(m.shows(row("aiKey")), "the model's key is the page's")
        XCTAssertFalse(m.shows(row("hinting")))
        XCTAssertTrue(m.shows(row("bar")))
        m.values["style"] = "auto"
        XCTAssertFalse(m.shows(row("bullet")))
        m.values["style"] = "fixed"
        XCTAssertTrue(m.shows(row("bullet")))
        XCTAssertFalse(m.hasOwn(m.pages.first { $0.id == "history" }!), "the history's page has rows of the page's own still")
        XCTAssertTrue(m.hasOwn(m.pages.first { $0.id == "ai" }!))
    }

    /// The history of the folder the settings were opened from: how it stands, said in the page's words — and switched on
    /// from here, as from the page's settings; the window follows.
    func testTheHistoryIsSwitchedOnFromHere() {
        write("Notes/A.md", "# A\n")
        let w = open(folder: dir)
        SettingsWindow.shared.open(from: w, page: "history")
        let m = SettingsWindow.shared.model
        XCTAssertTrue(wait(10) { !m.pages.isEmpty && m.info["history"] != nil })
        XCTAssertEqual(m.historyState, "none")
        XCTAssertNotEqual(m.t("prefs.history.is.none"), "prefs.history.is.none", "the page's words did not come")
        let rows = m.pages.first { $0.id == "history" }!.sections.flatMap(\.rows)
        XCTAssertTrue(m.shows(rows.first { $0.key == "historyState" }!))
        XCTAssertFalse(m.shows(rows.first { $0.key == "historyLink" }!), "a link offered where there is no project")
        SettingsWindow.shared.history("history-enable")
        XCTAssertTrue(wait(10) { m.historyState == "project" }, "the history did not come on (\(m.historyState))")
        XCTAssertTrue(m.shows(rows.first { $0.key == "historyLink" }!))
        XCTAssertEqual(m.value("historyName"), Lib.name(dir))
        XCTAssertTrue(wait(10) { m.value("historyCount") != nil })
    }

    /// GitHub as the shell tells it: who is signed in, the code to give, the repositories — the rows say so.
    func testGitHubAsTold() {
        let w = open(write("A.md", "# A\n"))
        SettingsWindow.shared.open(from: w, page: "history")
        let m = SettingsWindow.shared.model
        XCTAssertTrue(wait(10) { !m.pages.isEmpty && m.info["github"] != nil })
        let rows = m.pages.flatMap { $0.sections.flatMap(\.rows) }
        let get = rows.first { $0.key == "githubGet" }!
        XCTAssertNil(m.github["user"] as? [String: Any])
        XCTAssertFalse(m.shows(get), "Get offered to nobody signed in")
        m.info = ["home": NSHomeDirectory(), "github": ["user": ["login": "henri", "name": "Henri"], "repos": [
            ["name": "henri/notes", "url": "https://github.com/henri/notes.git", "private": true, "branch": "main"]]],
                  "history": ["state": "project", "root": NSHomeDirectory() + "/Notes", "name": "Notes", "linked": "https://github.com/henri/notes.git",
                              "sync": ["state": "conflict", "files": ["a.md", "b.md"]], "changed": 1, "waiting": true]]
        XCTAssertTrue(m.shows(get))
        XCTAssertEqual(m.value("historyRoot"), "~/Notes")
        XCTAssertEqual(m.repos?.first?.name, "henri/notes")
        XCTAssertEqual(m.syncSays, m.t("prefs.sync.conflict", "2"))
        XCTAssertEqual(m.value("historyChanged"), m.t("prefs.history.waiting.one", "1"))
    }

    /// A picture of the window (not a check): only with MDVIEW_SNAP=<folder>.
    func testPicture() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let w = open(write("A.md", "# A\n"))
        SettingsWindow.shared.open(from: w, page: ProcessInfo.processInfo.environment["MDVIEW_SNAP_PAGE"] ?? "editing")
        XCTAssertTrue(wait(10) { SettingsWindow.shared.window?.isVisible == true })
        let win = SettingsWindow.shared.window!
        win.orderBack(nil)
        wait(1)
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-x", "-o", "-l", String(win.windowNumber), Lib.join(snap!, "settings.png")]
        try p.run(); p.waitUntilExit()
    }
}
