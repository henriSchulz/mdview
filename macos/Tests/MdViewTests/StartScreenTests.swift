// A window with nothing open shows the system's start screen (StartView.swift) over the page, whose own is hidden;
// what is chosen there opens in that window; the page's Settings and the like are not covered by it.
import AppKit
import XCTest
@testable import MdView

final class StartScreenTests: ShellTest {
    func testNothingOpenShowsTheSystemsStartScreenAndNotThePages() {
        let w = open()
        XCTAssertNotNil(w.startHost)
        XCTAssertTrue(wait(5) { (self.page(w, "document.querySelector('#content .start-state') && getComputedStyle(document.querySelector('#content .start-state')).display") as? String) == "none" },
                      "the page's own start screen is shown beneath")
    }

    func testAFolderChosenOpensInThisWindowAndTheStartScreenGoes() {
        write("Notes/A.md", "# A\n")
        let w = open()
        w.openHere(Lib.join(dir, "Notes"))
        XCTAssertEqual(w.folder, Lib.join(dir, "Notes"))
        XCTAssertNil(w.startHost)
        XCTAssertEqual(AppDelegate.shared.windows.count, 1, "another window was opened")
    }

    func testAFileDroppedOpensInThisWindow() {
        let note = write("B.md", "# B\n")
        let w = open()
        w.openHere([URL(fileURLWithPath: note)])
        XCTAssertEqual(w.path, note)
        XCTAssertNil(w.startHost)
    }

    func testThePagesSettingsPushItBackAndItComesAgain() {
        let w = open()
        XCTAssertTrue(wait(5) { w.startHost?.isHidden == false })
        // (the gear opens the system's settings window — SettingsWindow.swift —, over which the start screen stays)
        page(w, "(document.getElementById('settings-btn').click(), 1)")
        XCTAssertTrue(wait(10) { SettingsWindow.shared.window?.isVisible == true }, "the gear did not open the settings window")
        XCTAssertEqual(w.startHost?.isHidden, false)
        SettingsWindow.shared.window?.close()
        // the page's own settings (a row of its own, reached from the settings window) push it back
        page(w, "(MdPage.loadActive().then(() => MdActive.prefs.open('history')), 1)")
        XCTAssertTrue(wait(5) { w.startHost?.isHidden == true }, "the start screen stands over the page's Settings")
        page(w, "(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), document.querySelector('#settings') && document.querySelector('#settings').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1)")
        XCTAssertTrue(wait(5) { w.startHost?.isHidden == false && w.startHost?.alphaValue == 1 }, "the start screen did not come again")
    }

    func testAToastDoesNotPushItBack() {
        let w = open()
        page(w, "(MdView.toast ? MdView.toast('Hello') : (()=>{ const t = document.createElement('div'); t.id = 'toast'; t.dataset.open = ''; document.body.appendChild(t); })(), 1)")
        wait(0.5)
        XCTAssertEqual(w.startHost?.isHidden, false)
    }

    func testOnlyItsContentTakesTheMouse() {
        Store.shared.state["recents"] = [dir]
        let w = open()
        XCTAssertTrue(wait(5) { (w.startHost?.hot ?? .zero) != .zero })
        let host = w.startHost!
        let corner = NSPoint(x: host.frame.minX + 3, y: host.frame.minY + 3)
        XCTAssertNil(host.hitTest(corner), "a click beside the start screen does not reach the page")
        let hot = host.hot
        let middle = host.convert(NSPoint(x: hot.midX, y: host.isFlipped ? hot.midY : host.bounds.height - hot.midY), to: host.superview)
        XCTAssertNotNil(host.hitTest(middle))
    }

    func testAFolderRemovedFromTheList() {
        let a = Lib.join(dir, "A"), b = Lib.join(dir, "B")
        for p in [a, b] { try? FileManager.default.createDirectory(atPath: p, withIntermediateDirectories: true) }
        Store.shared.state["folder"] = a
        Store.shared.state["recents"] = [a, b]
        Store.shared.forgetFolder(a)
        XCTAssertEqual(Store.shared.recents().compactMap { $0["path"] as? String }, [b])
    }
}
