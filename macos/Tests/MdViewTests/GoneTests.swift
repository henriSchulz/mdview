// The note on screen renamed or deleted outside its window (another window, Finder, a sync): what the page still saves
// does not bring it back under its old name (review 2026-11-17: the autosave wrote it anew, and the sync sent it on).
import XCTest
@testable import MdView

final class GoneTests: ShellTest {
    func testANoteRenamedElsewhereIsNotWrittenAgainUnderItsOldName() throws {
        let note = write("A.md", "# A\n\ntext\n")
        let w = open(note)
        try FileManager.default.moveItem(atPath: note, toPath: Lib.join(dir, "B.md"))
        for exact in [false, true] {
            w.on("save", ["type": "save", "text": "# A\n\ntext and more\n", "path": note, "exact": exact])
        }
        wait(0.5)
        XCTAssertFalse(Lib.exists(note), "the note came back under its old name")
        XCTAssertEqual(read(Lib.join(dir, "B.md")), "# A\n\ntext\n")
    }

    func testANoteDeletedElsewhereIsNotBroughtBack() throws {
        let note = write("C.md", "# C\n")
        let w = open(note)
        try FileManager.default.removeItem(atPath: note)
        w.on("save", ["type": "save", "text": "# C\n\nmore\n", "path": note])
        wait(0.5)
        XCTAssertFalse(Lib.exists(note), "the deleted note was written again")
    }
}
