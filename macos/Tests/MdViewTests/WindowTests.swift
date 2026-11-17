// A window's life (NoteWindow.swift): closed, it lets go of everything — its page, its watching, its timers.
import WebKit
import XCTest
@testable import MdView

final class WindowTests: ShellTest {
    /// Bug 7 of the review (2026-11-17): the page's message handler held its window, so no closed window was ever let go —
    /// each kept its web view and its WebContent process for as long as the app ran.
    func testAClosedWindowIsLetGo() {
        weak var gone: NoteWindow?
        weak var view: WKWebView?
        autoreleasepool {
            let w = open(write("Note.md", "# Note\n"))
            gone = w; view = w.web
            w.closeNow()
            windows.removeAll()
        }
        XCTAssertTrue(wait(5) { gone == nil }, "the closed window is kept")
        XCTAssertTrue(wait(5) { view == nil }, "the closed window's page is kept")
    }

    /// … a folder window too (it watches its folder and rescans it).
    func testAClosedFolderWindowIsLetGo() {
        weak var gone: NoteWindow?
        autoreleasepool {
            write("A.md", "# A\n")
            let w = open(folder: dir)
            gone = w
            write("B.md", "# B\n") // (a change the window is told of while it closes)
            wait(0.1)
            w.closeNow()
            windows.removeAll()
        }
        XCTAssertTrue(wait(5) { gone == nil }, "the closed folder window is kept")
    }
}

final class ClosingTests: ShellTest {
    /// The page as it is when a dialog of the active mode has changes in it (editor.js `flush`): asked to hand over before
    /// the window goes, it holds the window ("closehold") and asks; answered, it says "close".
    func asking(_ w: NoteWindow) {
        w.editing = true
        _ = page(w, "(MdView.flush = (close) => { if (close) MdHost.post(JSON.stringify({ type: 'closehold' })); }, true)")
    }

    func answered(_ w: NoteWindow) {
        _ = page(w, "(MdView.flush = (close) => { if (close) MdHost.post(JSON.stringify({ type: 'close' })); }, MdHost.post(JSON.stringify({ type: 'close' })), true)")
    }

    /// Bug 8 of the review (2026-11-17): the page held the window to ask whether a dialog's changes are kept — and the
    /// window went 1.5 s later all the same, with the dialog's changes.
    func testAWindowWhosePageAsksStaysUntilItIsAnswered() {
        let w = open(write("Note.md", "# Note\n"))
        asking(w)
        w.close()
        wait(2.5)
        XCTAssertTrue(w.window.isVisible, "the window went while its page was asking")
        answered(w)
        XCTAssertTrue(wait(3) { !w.window.isVisible }, "answered, the window did not go")
    }

    /// … and quitting: the app stays while a page asks.
    func testQuittingWaitsForAPageThatAsks() {
        let w = open(write("Note.md", "# Note\n"))
        asking(w)
        var answer: Bool?
        let was = AppDelegate.shared.answerQuit
        AppDelegate.shared.answerQuit = { answer = $0 }
        defer { AppDelegate.shared.answerQuit = was }
        XCTAssertEqual(AppDelegate.shared.applicationShouldTerminate(NSApp), .terminateLater)
        XCTAssertTrue(wait(3) { answer != nil }, "no answer to quitting")
        XCTAssertEqual(answer, false, "the app quit while a page was asking")
        XCTAssertTrue(w.window.isVisible)
    }

    /// A page that has nothing to ask: the window goes, and the app quits.
    func testAWindowWhosePageHandsOverGoes() {
        let w = open(write("Note.md", "# Note\n"))
        w.editing = true
        w.close()
        XCTAssertTrue(wait(3) { !w.window.isVisible }, "the window did not go")
    }
}
