// The folder the note on screen is in, renamed from the sidebar (Folder.swift relocate): a save the page sent under the
// note's old path is still the note's (rule 69, as for the note itself renamed — review 2026-11-17: it was dropped).
import XCTest
@testable import MdView

final class FolderRenameTests: ShellTest {
    func testASaveSentBeforeTheFolderWasRenamedIsKept() {
        let note = write("Sub/A.md", "# A\n")
        let w = open(folder: dir)
        w.openPath(note)
        XCTAssertTrue(wait(5) { (self.page(w, "!!(MdPage.current && MdPage.current.path.endsWith('A.md'))") as? Bool) == true })
        w.renameNote(Lib.join(dir, "Sub"), "Uni")
        let now = Lib.join(dir, "Uni/A.md")
        XCTAssertEqual(w.path, now)
        // (sent by the page before it was told of the rename)
        w.on("save", ["type": "save", "text": "# A\n\ntyped just before\n", "path": note])
        XCTAssertEqual(read(now), "# A\n\ntyped just before\n", "the save under the old path was dropped")
        XCTAssertFalse(Lib.exists(note))
    }
}
