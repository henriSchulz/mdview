// A note whose file is not UTF-8 (Latin-1, as older editors wrote it): shown, read-only, and its file never written
// over — its text read as UTF-8 and written back would have every "é" as U+FFFD (review 2026-11-17).
import AppKit
import XCTest
@testable import MdView

final class EncodingTests: ShellTest {
    func latin1(_ name: String, _ text: String) -> (String, Data) {
        let data = text.data(using: .isoLatin1)!
        let p = Lib.join(dir, name)
        try? data.write(to: URL(fileURLWithPath: p))
        return (p, data)
    }

    func testANoteThatIsNotUTF8IsReadOnlyAndKeptAsItIs() {
        let (note, bytes) = latin1("Café.md", "# Café\n\n- [ ] Crème brûlée\n")
        let w = open(note)
        XCTAssertEqual(page(w, "MdPage.current.readonly") as? String, "file is not UTF-8")
        // whatever the page sends, the file stays: an autosave, a task ticked
        w.on("save", ["type": "save", "text": "# Caf\u{FFFD}\n\nmore\n", "path": note])
        w.on("toggle", ["type": "toggle", "line": 2, "checked": true])
        wait(0.5)
        XCTAssertEqual(Lib.fm.contents(atPath: note), bytes, "the Latin-1 file was written over")
    }

    func testAUTF8NoteIsWrittenAsBefore() {
        let note = write("Plain.md", "# Plain\n\n- [ ] one\n")
        let w = open(note)
        XCTAssertTrue(page(w, "MdPage.current.readonly") is NSNull)
        w.on("toggle", ["type": "toggle", "line": 2, "checked": true])
        XCTAssertTrue(wait(3) { self.read(note).contains("- [x] one") })
    }
}
