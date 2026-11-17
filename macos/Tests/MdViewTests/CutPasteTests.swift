// Files cut in one window and pasted in another (Files.swift pasteFiles): moved there, under a free name (review
// 2026-11-17: the paste did nothing, said nothing, and the cut was forgotten).
import AppKit
import XCTest
@testable import MdView

final class CutPasteTests: ShellTest {
    func testWhatIsCutInOneWindowIsMovedByAPasteInAnother() {
        // (a cut writes the system's clipboard — the user's: what is on it is put back after)
        let pb = NSPasteboard.general
        let kept = (pb.pasteboardItems ?? []).map { item in item.types.compactMap { t in item.data(forType: t).map { (t, $0) } } }
        defer {
            pb.clearContents()
            pb.writeObjects(kept.map { pairs -> NSPasteboardItem in let i = NSPasteboardItem(); for (t, d) in pairs { i.setData(d, forType: t) }; return i })
        }
        let a = Lib.join(dir, "A"), b = Lib.join(dir, "B")
        let note = write("A/Note.md", "# from A\n")
        write("B/Note.md", "# B's own\n")
        let wa = open(folder: a), wb = open(folder: b)
        XCTAssertTrue(wait(5) { wa.knows(note) }, "A does not know its note")
        wa.on("copyfiles", ["type": "copyfiles", "paths": [note], "cut": true])
        wb.on("pastefiles", ["type": "pastefiles", "dir": b])
        XCTAssertFalse(Lib.exists(note), "the note cut in A is still there")
        XCTAssertEqual(read(Lib.join(b, "Note 2.md")), "# from A\n")
        XCTAssertEqual(read(Lib.join(b, "Note.md")), "# B's own\n")
    }
}
