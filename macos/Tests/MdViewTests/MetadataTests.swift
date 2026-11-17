// A note saved keeps what Finder knows of it: its tags (and any other extended attribute), its permissions
// (review 2026-11-17: each save wrote a new file without them).
import AppKit
import XCTest
@testable import MdView

final class MetadataTests: ShellTest {
    let tags = "com.apple.metadata:_kMDItemUserTags"

    func set(_ p: String, _ name: String, _ value: String) {
        let d = Array(value.utf8)
        XCTAssertEqual(setxattr(p, name, d, d.count, 0, 0), 0)
    }
    func has(_ p: String, _ name: String) -> Bool { getxattr(p, name, nil, 0, 0, 0) >= 0 }

    func testASavedNoteKeepsItsTagsAndPermissions() throws {
        let note = write("Tagged.md", "# Tagged\n\n- [ ] one\n")
        set(note, tags, "(\"Red\\n6\")")
        set(note, "com.example.mdview-test", "kept")
        chmod(note, 0o600)
        let w = open(note)
        w.on("save", ["type": "save", "text": "# Tagged\n\n- [ ] more\n", "path": note])
        XCTAssertTrue(wait(3) { self.read(note).contains("more") }, "not saved")
        XCTAssertTrue(has(note, tags), "Finder's tags are gone")
        XCTAssertTrue(has(note, "com.example.mdview-test"), "an extended attribute is gone")
        let mode = (try FileManager.default.attributesOfItem(atPath: note)[.posixPermissions] as? NSNumber)?.intValue
        XCTAssertEqual(mode, 0o600)
        // … and so does one written by a task ticked
        w.on("toggle", ["type": "toggle", "line": 2, "checked": true])
        XCTAssertTrue(wait(3) { self.read(note).contains("- [x] more") }, "not ticked")
        XCTAssertTrue(has(note, tags))
    }

    func testANewFileIsWrittenAsBefore() throws {
        let p = Lib.join(dir, "New.md")
        try Lib.writeWhole(p, Data("new\n".utf8))
        XCTAssertEqual(read(p), "new\n")
    }
}
