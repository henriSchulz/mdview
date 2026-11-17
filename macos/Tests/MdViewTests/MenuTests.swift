// The menu bar (Menu.swift): an item that leaves the note goes through the page, which hands over what was typed first.
import AppKit
import XCTest
@testable import MdView

final class MenuTests: ShellTest {
    func item(_ menu: String, _ title: String) -> MenuAction? {
        if NSApp.mainMenu == nil { AppDelegate.shared.buildMenu() }
        let m = NSApp.mainMenu?.items.first { $0.title == menu }?.submenu
        return m?.items.first { $0.title == title }?.target as? MenuAction
    }

    /// Types into the source editor of the note shown (not yet saved: the autosave waits 800 ms).
    func type(_ w: NoteWindow, _ text: String) {
        _ = page(w, "MdView.setMode('edit'), true")
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.mode") as? String) == "edit" })
        _ = page(w, """
            (() => { const t = document.getElementById('ed-input'); t.value += \(jsonString(text));
              t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); return true; })()
            """)
    }

    /// Bug 3 of the review (2026-11-17): Go › Back (⌘[) told the shell directly; the page never handed over what was typed
    /// a moment ago, and the note shown next dropped it.
    func testBackFromTheMenuKeepsWhatWasJustTyped() throws {
        let a = write("A.md", "# A\n"), b = write("B.md", "# B\n")
        let w = open(a)
        w.openPath(b)
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.current && MdPage.current.path") as? String) == b })
        type(w, "typed")
        XCTAssertEqual(read(b), "# B\n", "saved before Back — the check would prove nothing")
        try XCTUnwrap(item("Go", "Back")).fire(nil)
        XCTAssertTrue(wait(5) { w.path == a }, "Back did not go back")
        wait(0.5)
        XCTAssertEqual(read(b), "# B\ntyped", "what was typed before Back is lost")
    }

    /// … and Forward the same.
    func testForwardFromTheMenuKeepsWhatWasJustTyped() throws {
        let a = write("A.md", "# A\n"), b = write("B.md", "# B\n")
        let w = open(a)
        w.openPath(b)
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.current && MdPage.current.path") as? String) == b })
        w.go(back: true)
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.current && MdPage.current.path") as? String) == a })
        type(w, "typed")
        try XCTUnwrap(item("Go", "Forward")).fire(nil)
        XCTAssertTrue(wait(5) { w.path == b }, "Forward did not go forward")
        wait(0.5)
        XCTAssertEqual(read(a), "# A\ntyped", "what was typed before Forward is lost")
    }
}
