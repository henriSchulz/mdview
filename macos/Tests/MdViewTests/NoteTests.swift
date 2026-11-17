// One note in its window (NoteWindow.swift): what is written into it from the reading view.
import XCTest
@testable import MdView

final class NoteTests: ShellTest {
    /// Bug 4 of the review (2026-11-17): a task ticked in the reading view was written to the file, but the shell took
    /// its own write for "on screen already" and the page kept the old text — the source showed it unticked, and its next
    /// save wrote it back unticked.
    func testATaskTickedInTheReadingViewStaysTicked() {
        let note = write("Note.md", "# Tasks\n\n- [ ] milk\n- [ ] bread\n")
        let w = open(note)
        XCTAssertEqual(page(w, "MdPage.mode") as? String, "read")
        _ = page(w, "document.querySelector('#content input.task').click(), true")
        XCTAssertTrue(wait(5) { self.read(note) == "# Tasks\n\n- [x] milk\n- [ ] bread\n" }, "the tick was not written")
        XCTAssertTrue(wait(5) { (self.page(w, "MdPage.current.text") as? String)?.contains("- [x] milk") == true },
                      "the page still has the note unticked")
        _ = page(w, "MdView.setMode('edit'), true")
        XCTAssertTrue(wait(5) { (self.page(w, "document.getElementById('ed-input').value") as? String)?.contains("- [x] milk") == true },
                      "the source shows the task unticked")
    }
}
