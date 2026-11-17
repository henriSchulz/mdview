// A figure's own <style> (viewer/markdown.js svgPicture) in the real engine: it styles the figure, and nothing else of
// the window (review 2026-11-17).
import XCTest
@testable import MdView

final class FigureStyleTests: ShellTest {
    func testAFiguresStyleHoldsForItAlone() {
        let note = write("Fig.md", "# Fig\n\n```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"40\" viewBox=\"0 0 100 40\"><style>path { stroke: rgb(255, 0, 0) }</style><path d=\"M0 0 L100 40\"/></svg>\n```\n")
        let w = open(note)
        XCTAssertTrue(wait(5) { (self.page(w, "!!document.querySelector('#content svg path')") as? Bool) == true }, "no figure")
        // the figure's own path is red; a path of the window's (an icon) is not
        XCTAssertEqual(page(w, "getComputedStyle(document.querySelector('#content svg path')).stroke") as? String, "rgb(255, 0, 0)")
        let other = page(w, "(() => { const p = [...document.querySelectorAll('svg path')].find((p) => !p.closest('#content')); return p ? getComputedStyle(p).stroke : 'none found'; })()") as? String
        XCTAssertNotEqual(other, "rgb(255, 0, 0)", "an icon of the window took the figure's style")
        XCTAssertNotEqual(other, "none found")
    }
}
