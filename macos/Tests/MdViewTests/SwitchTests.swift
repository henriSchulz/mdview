// Another note chosen is quick (2026-11-18, „crispy cleane Performance“ — measured in PerfTests C2): what made it slow
// stays away, and what was made quicker finds what it found before.
import XCTest
@testable import MdView

final class SwitchTests: ShellTest {
    /// The room the page's toolbar takes is the tab strip's own (viewer/tabs.js): set on the root, every element of the page
    /// was styled and laid out anew whenever the toolbar came or went — 60 ms of the frame after All Notes was left.
    func testTheToolbarsRoomIsTheStripsOwn() {
        let a = write("Notes/A.md", "# A\n\nSome text.\n")
        let w = open(folder: dir)
        w.on("note", ["path": a])
        XCTAssertTrue(wait(10) { (self.page(w, "!!(MdPage.current && MdPage.current.path === \(jsonString(a)))") as? Bool) == true })
        _ = page(w, "(MdOverview.open(), 1)")
        wait(0.5)
        _ = page(w, "(MdOverview.close(false), 1)")
        XCTAssertTrue(wait(3) { ((self.page(w, "document.getElementById('tabs').style.getPropertyValue('--tb-w')") as? String) ?? "").hasSuffix("px") },
                      "the strip was not told the toolbar's room")
        XCTAssertEqual(page(w, "document.documentElement.style.getPropertyValue('--tb-w')") as? String, "", "the root holds the toolbar's room")
    }

    /// The index of a folder's files (Resolver.swift) is made from the listing with what it needs of each entry: it finds
    /// the files it found before — deep down, through a link to a file — and not those in hidden or heavy folders.
    func testTheLinkIndexFindsWhatItFoundBefore() throws {
        let notes = Lib.join(dir, "Notes")
        let deep = write("Notes/A/B/Deep.md", "# Deep\n")
        write("Notes/.hidden/Secret.md", "# Secret\n")
        write("Notes/node_modules/Package.md", "# Package\n")
        let far = write("Elsewhere/Far.md", "# Far\n")
        write("Notes/Sub/Here.md", "# Here\n")
        try FileManager.default.createSymbolicLink(atPath: Lib.join(notes, "Sub/Linked.md"), withDestinationPath: far)
        let r = Resolver(noteDir: Lib.join(notes, "C"), base: notes)
        XCTAssertEqual(r.resolve("Deep"), deep)
        XCTAssertEqual(r.resolve("Linked").map(Lib.resolve), Lib.resolve(far))
        XCTAssertNil(r.resolve("Secret"))
        XCTAssertNil(r.resolve("Package"))
        XCTAssertEqual(r.resolve("A/B/Deep"), deep)
    }
}
