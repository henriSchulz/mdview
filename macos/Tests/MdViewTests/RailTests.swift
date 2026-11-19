// The rail at the window's right (insert, format, style, information) stands beside the reading view too
// (Henri, 2026-11-19: "dieses menu soll auch in der readonly ansicht da sein") — there with Insert and Format dimmed,
// and its Style opens the panel. Beside the source it is away.
import AppKit
import XCTest
@testable import MdView

final class RailTests: ShellTest {
    func testTheRailStandsBesideTheReadingView() {
        let w = open(write("Rail.md", "# Rail\n\nA paragraph.\n"))
        _ = page(w, "MdPage.setMode('read')")
        // (the rail is the active mode's script: fetched in a quiet moment after the note is shown)
        XCTAssertTrue(wait(8) { (self.page(w, "MdPage.mode === 'read' && document.body.hasAttribute('data-rail')") as? Bool) == true },
                      "no rail beside the reading view")
        XCTAssertEqual(page(w, "[...document.querySelectorAll('#rrail .rp-tab')].filter((b) => b.disabled).map((b) => b.dataset.tab).join()") as? String, "insert,format")
        _ = page(w, "document.querySelector('#rrail .rp-tab[data-tab=\"style\"]').click()")
        XCTAssertTrue(wait(3) { (self.page(w, "document.body.hasAttribute('data-panel') && document.getElementById('rpanel').dataset.tab === 'style'") as? Bool) == true },
                      "the rail's Style did not open the panel beside the reading view")
        _ = page(w, "MdPage.setMode('edit')")
        XCTAssertTrue(wait(3) { (self.page(w, "!document.body.hasAttribute('data-rail')") as? Bool) == true }, "a rail beside the source")
    }
}
