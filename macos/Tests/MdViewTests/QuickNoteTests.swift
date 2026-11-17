// Quick notes (Folder.swift newQuick, as shell/folder.rs new_quick): a new one is empty and goes again when it is left
// so; the one before is named after its first line; a note's own window is not made the quick folder (review 2026-11-17).
import XCTest
@testable import MdView

final class QuickNoteTests: ShellTest {
    var quickDir = ""
    override func setUp() {
        super.setUp()
        quickDir = Lib.join(dir, "Quick")
        Store.shared.state["active"] = ["quickDir": quickDir] // (never the user's own QuickNotes)
        try? FileManager.default.createDirectory(atPath: quickDir, withIntermediateDirectories: true)
    }
    func notes() -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: quickDir)) ?? []).filter { $0.hasSuffix(".md") }.sorted() }

    func testANewQuickNoteLeftEmptyGoesAndOneWrittenInIsNamedByItsTitle() {
        let w = open(folder: quickDir)
        XCTAssertTrue(w.quick)
        w.newQuick()
        XCTAssertEqual(notes().count, 1)
        XCTAssertEqual(read(w.path!), "", "a new quick note is not empty")
        wait(1.1) // (a second later: another time for a name)
        w.newQuick()
        XCTAssertEqual(notes().count, 1, "the one left empty is still there: \(notes())")
        let written = w.path!
        w.on("save", ["type": "save", "text": "Milk\n", "path": written])
        wait(1.1)
        w.newQuick()
        XCTAssertTrue(notes().contains("Milk.md"), "the one before kept its time for a name: \(notes())")
    }

    func testANotesOwnWindowIsNotMadeTheQuickFolder() {
        let note = write("Note.md", "# Note\n")
        let w = open(note)
        defer { for q in AppDelegate.shared.windows where q.quick { q.closeNow() } } // (the quick notes' window it opened)
        w.newQuick()
        XCTAssertNil(w.folder, "the note's window became the quick folder")
        XCTAssertEqual(w.path, note)
        XCTAssertEqual(notes().count, 1, "no quick note was made in the quick notes' own window")
    }
}
