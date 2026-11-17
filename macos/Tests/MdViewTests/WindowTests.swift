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
