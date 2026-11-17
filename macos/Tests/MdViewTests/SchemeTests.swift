// What the page asks for under md://localhost/file/… (Scheme.swift): the file a note names, where it is.
import XCTest
@testable import MdView

final class SchemeTests: ShellTest {
    /// A picture of one pixel.
    let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")!

    func picture(_ rel: String) {
        let p = Lib.join(dir, rel)
        try? FileManager.default.createDirectory(atPath: Lib.dir(p), withIntermediateDirectories: true)
        try? png.write(to: URL(fileURLWithPath: p))
    }

    func shown(_ w: NoteWindow) -> Bool {
        (page(w, "(() => { const i = document.querySelector('#content img'); return !!i && i.complete && i.naturalWidth > 0; })()") as? Bool) == true
    }

    /// Bug 6 of the review (2026-11-17): a picture pasted into a note of a subfolder is kept in the base folder's assets
    /// and named `assets/x.png` (Files.swift wayTo) — but the file server looked only where the link says.
    func testAPictureOfASubfoldersNoteIsFoundInTheBaseFoldersAssets() {
        picture("assets/x.png")
        let note = write("Sub/Note.md", "# Note\n\n![](assets/x.png)\n")
        let w = open(folder: dir)
        w.openPath(note)
        XCTAssertTrue(wait(5) { self.shown(w) }, "the picture is not shown")
    }

    /// … and one kept beside a note that was moved away from it: in an `assets` anywhere in the base folder.
    func testAPictureLeftBehindIsFoundInAnAssetsBelowTheBaseFolder() {
        picture("Old/assets/y.png")
        let note = write("New/Note.md", "# Note\n\n![](assets/y.png)\n")
        let w = open(folder: dir)
        w.openPath(note)
        XCTAssertTrue(wait(5) { self.shown(w) }, "the picture is not shown")
    }

    /// Where the link says, it is taken from there (and not from the base folder's assets).
    func testAPictureWhereTheLinkSaysIsTakenFromThere() {
        picture("Sub/assets/z.png")
        let note = write("Sub/Note.md", "# Note\n\n![](assets/z.png)\n")
        let w = open(folder: dir)
        w.openPath(note)
        XCTAssertTrue(wait(5) { self.shown(w) }, "the picture is not shown")
    }
}
