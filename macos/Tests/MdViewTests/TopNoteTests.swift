// A note whose properties say `top: true` stands first in its folder, before the folders, and is marked (Henri,
// 2026-11-19: "man soll ein dokument per properties als Top, Dashboard, Übersicht … festlegen können, damit es in einem
// ordner gesondert oben hervorgehoben angezeigt wird"). Set from the page (the panel's Style), the list follows.
import AppKit
import XCTest
@testable import MdView

final class TopNoteTests: ShellTest {
    func testWhatTheNoteSays() {
        XCTAssertTrue(Lib.noteTop("---\ntitle: x\ntop: true\n---\n# A\n"))
        XCTAssertTrue(Lib.noteTop("---\r\ntop: True  # the overview\r\n---\r\n"))
        XCTAssertFalse(Lib.noteTop("---\ntop: false\n---\n"))
        XCTAssertFalse(Lib.noteTop("---\ntitle: x\n---\ntop: true\n"))
        XCTAssertFalse(Lib.noteTop("top: true\n"))
        XCTAssertFalse(Lib.noteTop("---\nlook:\n  top: true\n---\n"))
    }

    func testANoteThatSaysTopStandsFirstInItsFolder() {
        let a = write("a.md", "# A\n")
        try? Lib.fm.createDirectory(atPath: Lib.join(dir, "sub"), withIntermediateDirectories: true)
        _ = write("sub/x.md", "# X\n")
        _ = write("z.md", "---\ntop: true\n---\n# Overview\n")
        let w = open(folder: dir)
        w.openPath(a)
        XCTAssertTrue(wait(5) { (self.page(w, "!!(MdPage.current && MdPage.current.path.endsWith('a.md'))") as? Bool) == true })
        let rows = "[...document.querySelectorAll('.sb-list > .sb-item:not(.leaving)')].map((e) => e.dataset.key.split('/').pop() + (e.classList.contains('is-top') ? '*' : '')).join(' ')"
        XCTAssertTrue(wait(8) { (self.page(w, rows) as? String) == "z.md* sub a.md" }, "the list: \(page(w, rows) ?? "nil")")
        // the note on screen made the first one from the page (the panel's switch does this)
        XCTAssertTrue(wait(8) { (self.page(w, "!!(window.MdView && MdView.core && MdView.core.doc)") as? Bool) == true })
        _ = page(w, "MdView.core.doc.set('top', true)")
        XCTAssertTrue(wait(5) { self.read(a).hasPrefix("---\ntop: true\n---\n") }, "the file: \(read(a))")
        XCTAssertTrue(wait(8) { (self.page(w, rows) as? String) == "a.md* z.md* sub" }, "the list after: \(page(w, rows) ?? "nil")")
    }
}
