// What is done to the files of a folder and taken back (Files.swift, Folder.swift).
import XCTest
@testable import MdView

final class FileStepTests: ShellTest {
    /// The test's own names: nothing of the user's in the Trash is ever touched, and what this test put there goes again.
    let stem = "mdviewtest-\(UUID().uuidString.prefix(8))"

    override func tearDown() {
        let trash = Lib.join(Lib.home(), ".Trash")
        for n in (try? FileManager.default.contentsOfDirectory(atPath: trash)) ?? [] where n.hasPrefix(stem) {
            try? FileManager.default.removeItem(atPath: Lib.join(trash, n))
        }
        super.tearDown()
    }

    /// Bug 5 of the review (2026-11-17): Undo of a move to the Trash took the newest item of the Trash whose name looked
    /// like the file's — "Note 2.md" for "Note.md" —, and put another file's text under the name.
    func testUndoOfTrashPutsBackTheFileThatWasTrashed() throws {
        let note = write("\(stem).md", "the note itself\n")
        let w = open(folder: dir)
        XCTAssertTrue(wait(5) { w.knows(note) }, "the folder's list does not have the note")
        w.trashPaths([note])
        XCTAssertFalse(Lib.exists(note))
        // later, another file of a name like it goes to the Trash (from Finder, another window …)
        wait(1.1)
        let other = write("\(stem) 2.md", "another note\n")
        try FileManager.default.trashItem(at: URL(fileURLWithPath: other), resultingItemURL: nil)
        w.fileStep(back: true)
        XCTAssertEqual(read(note), "the note itself\n", "Undo put back another file under the note's name")
        // Redo moves it to the Trash again, and Undo once more brings that one back
        w.fileStep(back: false)
        XCTAssertFalse(Lib.exists(note), "Redo did not move it to the Trash")
        w.fileStep(back: true)
        XCTAssertEqual(read(note), "the note itself\n", "the second Undo did not bring it back")
    }
}
