// The tabs are the system's (NativeTabs.swift): they stand as the page's stand, and what a hand does there the page does.
import AppKit
import XCTest
@testable import MdView

final class TabsNativeTests: ShellTest {
    func two() -> (NoteWindow, String, String) {
        let a = write("Notes/A note.md", "# A note\n\nSome text.\n")
        let b = write("Notes/Another.md", "# Another\n")
        let w = open(folder: dir)
        w.window.setContentSize(NSSize(width: 1024, height: 706))
        w.on("note", ["path": a])
        XCTAssertTrue(wait(10) { (self.page(w, "!!(MdPage.current && MdPage.current.path === \(jsonString(a)))") as? Bool) == true })
        w.on("note", ["path": b, "tab": true])
        XCTAssertTrue(wait(5) { w.tabStrip?.items.count == 2 && w.tabStrip?.strip.isHidden == false }, "no tabs of the system's")
        return (w, a, b)
    }

    func testTheTabsAreThePages() {
        let (w, a, _) = two()
        let t = w.tabStrip!
        XCTAssertEqual(t.items.map(\.title), ["A note", "Another"])
        XCTAssertTrue(wait(5) { t.items[1].shown && !t.items[0].shown })
        XCTAssertEqual(page(w, "getComputedStyle(document.querySelector('#tabs .tab-row')).visibility") as? String, "hidden", "the page's own tabs show")
        t.select(t.items[0].id)
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.current && MdPage.current.path") as? String) == a }, "a tab chosen did not show its note")
        XCTAssertTrue(wait(5) { t.items[0].shown })
        t.new()
        XCTAssertTrue(wait(5) { t.items.count == 3 }, "no new tab")
        let ids = t.items.map(\.id)
        t.close(ids[1])
        XCTAssertTrue(wait(5) { t.items.count == 2 }, "not closed")
        t.close(t.items[1].id)
        XCTAssertTrue(wait(5) { t.strip.isHidden }, "a row of tabs for one tab")
    }

    func testATabPulledIsMoved() {
        let (w, _, _) = two()
        let t = w.tabStrip!
        let first = t.items[0]
        t.pull(first, by: 600)
        t.letGo(first)
        XCTAssertTrue(wait(5) { w.tabs.last?.id == first.id }, "the tab was not moved")
    }

    func testTheyStandBesideTheSidebarAndLeaveADialog() {
        let (w, _, _) = two()
        let t = w.tabStrip!
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        let sbw = { CGFloat((self.page(w, "parseFloat(document.documentElement.style.getPropertyValue('--sb-w')) || 260") as? NSNumber)?.doubleValue ?? 260) }
        XCTAssertTrue(wait(5) { abs(t.strip.frame.minX - sbw() - 6) < 1 }, "at \(t.strip.frame.minX)")
        _ = page(w, "(MdPage.showSidebar(false, false), 1)")
        XCTAssertTrue(wait(5) { abs(t.strip.frame.minX - 12) < 1 }, "at \(t.strip.frame.minX)")
        _ = page(w, "(document.getElementById('search').setAttribute('data-open', ''), 1)")
        XCTAssertTrue(wait(5) { t.strip.isHidden }, "over the search")
        _ = page(w, "(document.getElementById('search').removeAttribute('data-open'), 1)")
        XCTAssertTrue(wait(5) { !t.strip.isHidden })
    }

    /// A picture of the row, light and dark (MDVIEW_SNAP=<folder>).
    func testPicture() throws {
        guard let out = ProcessInfo.processInfo.environment["MDVIEW_SNAP"] else { throw XCTSkip("no MDVIEW_SNAP") }
        let a = write("Notes/11 FPGA (Vivado).md", "# FPGA\n\nSome text.\n")
        let b = write("Notes/Writesdf doc.md", "# Writesdf\n\nSome text.\n")
        let w = openPainted(folder: dir)
        w.window.setContentSize(NSSize(width: 1100, height: 600))
        w.on("note", ["path": b]); wait(1)
        w.on("note", ["path": a, "tab": true]); wait(1)
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        for (name, look) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            NSApp.appearance = NSAppearance(named: look)
            wait(2)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            p.arguments = ["-x", "-o", "-l", "\(w.window.windowNumber)", "\(out)/tabs-\(name).png"]
            try p.run(); p.waitUntilExit()
        }
        NSApp.appearance = nil
    }
}
