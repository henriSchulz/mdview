// Links to folders in a notes folder (Scan.swift, Resolver.swift): not gone into — a link to elsewhere does not fill the
// sidebar, a loop does not repeat the folder or hold the link lookup to its deadline (review 2026-11-17).
import XCTest
@testable import MdView

final class SymlinkTests: ShellTest {
    func testALinkToAFolderIsNotGoneInto() throws {
        let elsewhere = Lib.join(dir, "Elsewhere")
        write("Elsewhere/Far.md", "# Far\n")
        let notes = Lib.join(dir, "Notes")
        let mine = write("Notes/Mine.md", "# Mine\n\n[[Nowhere]]\n")
        try FileManager.default.createSymbolicLink(atPath: Lib.join(notes, "Code"), withDestinationPath: elsewhere)
        try FileManager.default.createSymbolicLink(atPath: Lib.join(notes, "self"), withDestinationPath: notes)
        let w = open(folder: notes)
        XCTAssertTrue(w.notePaths.contains(mine))
        XCTAssertFalse(w.notePaths.contains { $0.contains("/Code/") || $0.contains("/self/") }, "a linked folder was gone into: \(w.notePaths.sorted())")
        // a [[link]] that leads nowhere is looked for once, and not through the loop until the deadline
        let t = Date()
        XCTAssertNil(Resolver(noteDir: notes, base: notes).resolve("Nowhere"))
        XCTAssertLessThan(Date().timeIntervalSince(t), 1.0, "the lookup walked the loop")
    }
}
