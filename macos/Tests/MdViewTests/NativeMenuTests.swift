// The page's menus as the system's own (NativeMenu.swift, viewer/base.js hostMenu).
import AppKit
import WebKit
import XCTest
@testable import MdView

final class NativeMenuTests: ShellTest {
    /// The rows as an NSMenu: names, keys as the system shows them (Ctrl is ⌘), a tick, a menu beside, a rule, and a sign
    /// on every row that has one — the system's symbol where there is one, else the page's drawing (docs/BUGS.md 117).
    func testRowsMakeTheMenu() {
        let svg = #"<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/></svg>"#
        let rows: [Any] = [
            ["label": "Copy", "key": "Ctrl+C", "sign": "copy", "svg": svg],
            NSNull(),
            ["label": "Redo", "key": "Ctrl+Shift+Z", "svg": svg],
            ["label": "Move to Trash", "key": "Del", "danger": true, "sign": "trash", "svg": svg],
            ["label": "Rename", "key": "F2", "on": false, "sign": "rename", "svg": svg],
            ["label": "Show", "sign": "list", "svg": svg, "sub": [["label": "PDFs", "check": true], ["label": "Pictures", "check": false]]],
        ]
        let m = NativeMenu.make(rows, path: []) { _ in }
        XCTAssertEqual(m.items.map(\.title), ["Copy", "", "Redo", "Move to Trash", "Rename", "Show"])
        XCTAssertTrue(m.items[1].isSeparatorItem)
        XCTAssertEqual(m.items[0].keyEquivalent, "c"); XCTAssertEqual(m.items[0].keyEquivalentModifierMask, [.command])
        XCTAssertEqual(m.items[2].keyEquivalent, "z"); XCTAssertEqual(m.items[2].keyEquivalentModifierMask, [.command, .shift])
        XCTAssertEqual(m.items[3].keyEquivalent, String(Character(UnicodeScalar(NSBackspaceCharacter)!)))
        XCTAssertEqual(m.items[4].keyEquivalent, String(Character(UnicodeScalar(NSF2FunctionKey)!)))
        XCTAssertFalse(m.items[4].isEnabled)
        XCTAssertEqual(m.items[5].submenu?.items.map(\.state), [.on, .off])
        for (i, item) in m.items.enumerated() where !item.isSeparatorItem { XCTAssertNotNil(item.image, "row \(i) has no sign") }
        XCTAssertNotNil(m.items[2].image, "the page's own drawing, where the system has no symbol")
    }

    /// A menu the page asks for at a point is the system's: shown by the shell, and the row chosen in it is what the page
    /// does — the page draws no menu of its own meanwhile.
    func testTheMenuIsTheSystems() {
        let w = open(write("Menu.md", "# Menu\n\ntext\n"))
        var shown: [String] = []
        // (inside the menu's own tracking: what it shows, then its third row chosen — as a hand would)
        let t = Timer(timeInterval: 0.05, repeats: true) { t in
            guard let m = NativeMenu.shown else { return }
            shown = m.items.map(\.title)
            m.performActionForItem(at: 2)
            m.cancelTracking()
            t.invalidate()
        }
        RunLoop.main.add(t, forMode: .common)
        _ = page(w, "(MdPage.menuAt(30, 40, [['One', 'Ctrl+C', true, () => { window.__ran = 'one'; }, '', MdPage.sign('menu.copy')], null, ['Two', '', true, () => { window.__ran = 'two'; }, '', MdPage.sign('menu.paste')]]), 1)")
        XCTAssertTrue(wait(5) { (self.page(w, "window.__ran || ''") as? String) == "two" }, "the row chosen did not run (shown: \(shown))")
        XCTAssertEqual(shown, ["One", "", "Two"])
        XCTAssertEqual(page(w, "document.getElementById('textmenu').hasAttribute('data-open')") as? Bool, false)
        t.invalidate()
    }

    /// … and a menu gone without a choice leaves the page as it was, its menu no longer held open.
    func testAMenuLeftWithoutAChoice() {
        let w = open(write("Menu.md", "# Menu\n\ntext\n"))
        let t = Timer(timeInterval: 0.05, repeats: true) { t in
            guard let m = NativeMenu.shown else { return }
            m.cancelTracking()
            t.invalidate()
        }
        RunLoop.main.add(t, forMode: .common)
        _ = page(w, "(MdPage.loadActive ? MdPage.loadActive().then(() => 1) : 1)")
        _ = page(w, "(MdActive.menu.open({ x: 10, y: 10, items: [{ label: 'A', run: () => { window.__ran = 'a'; } }], closed: () => { window.__ran = 'closed'; } }), 1)")
        XCTAssertTrue(wait(5) { (self.page(w, "window.__ran || ''") as? String) == "closed" })
        XCTAssertEqual(page(w, "MdActive.menu.isOpen") as? Bool, false)
        t.invalidate()
    }

    /// Pictures of the menus as the system draws them (not a check): only with MDVIEW_SNAP=<folder>.
    func testMenuPictures() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let out = snap!
        write("Notes/A note.md", "# A note\n\nSome text.\n")
        write("Notes/Another.md", "# Another\n")
        write("Plans/Plan.md", "# Plan\n")
        let w = open(folder: dir)
        paint(w)
        w.window.setContentSize(NSSize(width: 900, height: 620))
        wait(1)
        func shoot(_ name: String, _ js: String) {
            var done = false
            let t = Timer(timeInterval: 0.25, repeats: true) { t in
                guard let m = NativeMenu.shown else { return }
                let menus = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
                let mine = menus.filter { ($0[kCGWindowOwnerPID as String] as? Int32) == getpid() && (($0[kCGWindowLayer as String] as? Int) ?? 0) >= 20 }
                for (i, info) in mine.enumerated() {
                    guard let id = info[kCGWindowNumber as String] as? Int else { continue }
                    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                    p.arguments = ["-x", "-l", String(id), Lib.join(out, "menu-\(name)\(i == 0 ? "" : "-\(i)").png")]
                    try? p.run(); p.waitUntilExit()
                }
                m.cancelTracking(); done = true; t.invalidate()
            }
            RunLoop.main.add(t, forMode: .common)
            _ = page(w, js)
            wait(5) { done }
            t.invalidate()
            wait(0.3)
        }
        shoot("folder", "(MdPage.showSidebar(true, false), MdPage.openCtx(document.querySelector('#sidebar [data-key$=\"/Notes\"], #overview .ov-item[data-dir]'), 120, 140, document.querySelector('#sidebar [data-key$=\"/Notes\"]') ? 'dir' : 'ovdir'), 1)")
        shoot("text", "(MdPage.menuAt(300, 200, [['Cut', 'Ctrl+X', true, () => {}, '', MdPage.sign('menu.cut')], ['Copy', 'Ctrl+C', true, () => {}, '', MdPage.sign('menu.copy')], ['Paste', 'Ctrl+V', true, () => {}, '', MdPage.sign('menu.paste')], null, ['Settings…', 'Ctrl+,', true, () => {}, '', MdPage.sign('prefs.open')]]), 1)")
    }
}
