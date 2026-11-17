// The spare window (AppDelegate.spare): a page loaded before a window is asked for, taken over by the next one opened.
import AppKit
import WebKit
import XCTest
@testable import MdView

final class SpareTests: ShellTest {
    var app: AppDelegate { AppDelegate.shared }

    override func tearDown() {
        app.sparesOn = false
        app.spare?.dispose()
        app.spare = nil
        super.tearDown()
    }

    func spare() -> NoteWindow {
        app.sparesOn = true
        app.makeSpare()
        let s = app.spare!
        XCTAssertTrue(wait(15) { s.ready }, "the spare's page did not come up")
        return s
    }

    /// A window opened while a spare is ready is the spare: its page is not loaded again, the note is drawn in it.
    func testANewWindowIsTheSpare() {
        let p = write("Spare.md", "# Spare\n\nshown at once\n")
        let s = spare()
        let shell = s.shell
        XCTAssertFalse(app.windows.contains { $0 === s }, "a spare is not among the app's windows")
        app.openWindow(p)
        let w = app.windows.last!
        windows.append(w)
        XCTAssertTrue(w === s, "the new window was made anew")
        XCTAssertFalse(w.isSpare)
        XCTAssertNil(app.spare)
        XCTAssertEqual(w.shell, shell, "the page was loaded again")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdPage && MdPage.current && MdPage.current.path === \(jsonString(p)))") as? Bool) == true })
    }

    /// … and a folder too: its notes listed, the page the same.
    func testAFolderWindowIsTheSpare() {
        write("In.md", "# In\n")
        let s = spare()
        let shell = s.shell
        app.openWindow(dir)
        let w = app.windows.last!
        windows.append(w)
        XCTAssertTrue(w === s)
        XCTAssertEqual(w.shell, shell)
        XCTAssertTrue(w.knows(Lib.join(dir, "In.md")))
        XCTAssertTrue(wait(10) { (self.page(w, "!!(MdPage.folder && MdPage.folder.root === \(jsonString(self.dir)))") as? Bool) == true })
    }

    /// A spare let go leaves nothing: its page is let go, and its size (never seen) is not kept as the windows' size.
    func testASpareLeavesNoTrace() {
        Store.shared.state["width"] = 777
        let s = spare()
        app.dropSpare()
        XCTAssertNil(app.spare)
        XCTAssertTrue(s.gone, "its page was not let go")
        XCTAssertEqual((Store.shared.state["width"] as? NSNumber)?.intValue, 777)
    }

    /// A change of the settings goes past the spare's page (made with the old ones): the spare goes.
    func testSettingsChangedLetTheSpareGo() {
        let w = open(write("Open.md", "# Open\n"))
        _ = spare()
        w.on("prefs", ["prefs": ["sidebarSort": "name"]])
        XCTAssertNil(app.spare)
    }
}

final class QuietScanTests: ShellTest {
    /// A change on the disk is read off the main thread: the folder's notes as they were until the reading is done.
    func testAChangeOnTheDiskIsReadAside() {
        write("A.md", "# A\n")
        let w = open(folder: dir)
        XCTAssertTrue(w.knows(Lib.join(dir, "A.md")))
        let b = write("B.md", "# B\n")
        w.rescanQuietly()
        XCTAssertFalse(w.knows(b), "the folder was read on the main thread")
        XCTAssertTrue(wait(5) { w.knows(b) }, "the reading aside was not taken")
    }

    /// A reading of the window's own after a quiet one began is the one that holds.
    func testAReadingAfterItHolds() {
        let w = open(folder: dir)
        let b = write("B.md", "# B\n")
        w.rescanQuietly()
        w.rescan()
        XCTAssertTrue(w.knows(b))
        try? FileManager.default.removeItem(atPath: b)
        w.rescan()
        wait(1)
        XCTAssertFalse(w.knows(b), "a reading from before brought back what is gone")
    }

    /// A folder's window asks for its page once — before its folder is read, and not again when what it opens on is shown.
    func testAFolderWindowLoadsItsPageOnce() {
        write("Kept.md", "# Kept\n")
        let w = open(folder: dir)
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdPage && MdPage.folder && MdPage.folder.root === \(jsonString(self.dir)))") as? Bool) == true })
        wait(0.5)
        XCTAssertEqual(w.shell, 1, "the page was loaded more than once")
    }
}
