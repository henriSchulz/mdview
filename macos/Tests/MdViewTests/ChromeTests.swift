// The window's bar is the system's (MacChrome.swift): its buttons do what the page's did, and stand as the page's stand.
import AppKit
import WebKit
import XCTest
@testable import MdView

final class ChromeTests: ShellTest {
    func item(_ w: NoteWindow, _ id: NSToolbarItem.Identifier) -> NSToolbarItem? { w.window.toolbar?.items.first { $0.itemIdentifier == id } }

    func folderWindow() -> (NoteWindow, String) {
        let a = write("Notes/A note.md", "# A note\n\n## One\n\nSome text.\n\n## Two\n\nMore.\n")
        write("Notes/Another.md", "# Another\n")
        let w = open(folder: dir)
        w.on("note", ["path": a])
        XCTAssertTrue(wait(10) { (self.page(w, "!!(MdPage.current && MdPage.current.path === \(jsonString(a)))") as? Bool) == true })
        wait(0.3)
        return (w, a)
    }

    /// With a note there is a bar, and the page is told how high it is; the start screen has none.
    func testTheBarIsThereWithANote() {
        let s = open()
        XCTAssertEqual(s.window.toolbar?.isVisible, false, "a bar over the start screen")
        XCTAssertTrue(s.window.titlebarAppearsTransparent)
        let (w, _) = folderWindow()
        XCTAssertEqual(w.window.toolbar?.isVisible, true)
        let top = Int((w.window.contentView!.bounds.height - w.window.contentLayoutRect.height).rounded())
        XCTAssertGreaterThan(top, 40)
        XCTAssertTrue(wait(3) { (self.page(w, "getComputedStyle(document.documentElement).getPropertyValue('--mac-bar').trim()") as? String) == "\(top)px" })
        XCTAssertEqual(page(w, "getComputedStyle(document.getElementById('toolbar')).visibility") as? String, "hidden", "the page's own capsule shows")
    }

    /// A mode chosen in the bar is the page's mode; a mode the page takes by itself (a key) is the bar's.
    func testTheModesAreThePages() {
        let (w, _) = folderWindow()
        let g = item(w, .mdMode) as? NSToolbarItemGroup
        XCTAssertNotNil(g)
        g?.setSelected(true, at: 2)
        _ = g?.target?.perform(g!.action!, with: g)
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.mode") as? String) == "edit" }, "the bar's choice did not reach the page")
        _ = page(w, "(MdPage.setMode('read'), 1)")
        XCTAssertTrue(wait(5) { g?.selectedIndex == 0 }, "the page's mode is not the bar's")
    }

    /// Back is there once there is somewhere to go back to — and goes there.
    func testBackAndForward() {
        let (w, a) = folderWindow()
        let nav = item(w, .mdNav) as? NSToolbarItemGroup
        let b = Lib.join(dir, "Notes/Another.md")
        w.on("note", ["path": b])
        XCTAssertTrue(wait(5) { nav?.subitems.first?.isEnabled == true }, "back stays dimmed")
        XCTAssertEqual(nav?.subitems.last?.isEnabled, false, "forward with nowhere to go")
        w.chrome?.act("navback")
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.current && MdPage.current.path") as? String) == a }, "back did not go back")
        XCTAssertTrue(wait(5) { nav?.subitems.last?.isEnabled == true }, "forward stays dimmed")
    }

    /// A folder's window opens where it was closed, as large as it was.
    func testAWindowOpensWhereItStood() {
        let app = AppDelegate.shared!
        app.openWindow(dir)
        let w = app.windows.last!
        windows.append(w)
        XCTAssertTrue(wait(15) { w.ready })
        let r = NSRect(x: 120, y: 90, width: 760, height: 540)
        w.window.setFrame(r, display: false)
        w.closeNow()
        wait(0.3)
        app.openWindow(dir)
        let again = app.windows.last!
        windows.append(again)
        XCTAssertFalse(again === w)
        XCTAssertEqual(again.window.frame, r)
    }

    /// Pictures of the windows (not a check): only with MDVIEW_SNAP=<folder>.
    func testPictures() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let out = snap!
        let text = (ProcessInfo.processInfo.environment["MDVIEW_SNAP_NOTE"]).flatMap { try? String(contentsOfFile: $0, encoding: .utf8) }
            ?? "# Bildschirm-Spiegel Aufbau\n\nipadcast überträgt den Bildschirm des Macs als H.264-Strom an einen Safari-Tab auf einem iPad.\n\n## Bestandteile\n\n| Teil | Läuft |\n|---|---|\n| zcast | solange ein Zuschauer verbunden ist |\n\n## Ablauf\n\nText.\n"
        let a = write("Notizen/Bildschirm-Spiegel Aufbau.md", text)
        write("Notizen/Current Bugs.md", "# Current Bugs\n")
        write("Plans/Plan.md", "# Plan\n")
        func shoot(_ w: NoteWindow, _ name: String) {
            wait(1.2)
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-o", "-l", String(w.window.windowNumber), Lib.join(out, "chrome-\(name).png")]
            try? p.run(); p.waitUntilExit()
        }
        for (look, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            NSApp.appearance = NSAppearance(named: appearance)
            let w = openPainted(folder: dir)
            if appearance == .darkAqua { w.applyTheme(Theme(mode: "dark", colors: Theme.dark, variant: nil)) }
            w.window.setContentSize(NSSize(width: 1024, height: 706))
            w.on("note", ["path": a])
            wait(10) { (self.page(w, "!!(MdPage.current && MdPage.current.path === \(jsonString(a)))") as? Bool) == true }
            _ = page(w, "(MdPage.showSidebar(false, false), 1)")
            shoot(w, look + "-note")
            _ = page(w, "(MdPage.showSidebar(true, false), 1)")
            shoot(w, look + "-sidebar")
            if look == "dark" {
                w.chrome?.act("outline"); shoot(w, look + "-outline"); w.chrome?.act("outline")
                w.chrome?.act("find"); shoot(w, look + "-find"); _ = page(w, "(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1)")
            }
            if look == "light" {
                w.on("tab", ["op": "new"])
                wait(1)
                w.on("note", ["path": Lib.join(dir, "Plans/Plan.md")])
                shoot(w, look + "-tabs")
                _ = page(w, "(MdOverview.showAt([], 'all'), 1)")
                shoot(w, look + "-allnotes")
            }
            w.closeNow()
            let n = openPainted(Lib.join(dir, "Plans/Plan.md"))
            n.window.setContentSize(NSSize(width: 860, height: 560))
            shoot(n, look + "-alone")
            n.closeNow()
        }
        NSApp.appearance = nil
    }
}
