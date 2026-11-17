// Where a figure Claude drew is kept (Assistant.swift saveGraphic): where a picture pasted into the same note goes —
// the assets of the project the note is in, not of the folder shown (review 2026-11-17: in ~/Notes with the linked
// project ~/Notes/Uni, a figure of Uni's note went to ~/Notes/assets, and was never committed or synced).
import XCTest
@testable import MdView

final class FigurePlaceTests: ShellTest {
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"10\" height=\"10\" viewBox=\"0 0 10 10\"><path d=\"M0 0 L10 10\" stroke=\"currentColor\"/></svg>"

    func testAFigureOfALinkedProjectsNoteGoesToThatProjectsAssets() throws {
        try FileManager.default.createDirectory(atPath: Lib.join(dir, "Uni/.git"), withIntermediateDirectories: true)
        write("Uni/.mdview/project.json", "{}\n")
        let note = write("Uni/Analysis/n.md", "# n\n")
        let w = open(folder: dir)
        w.openPath(note)
        XCTAssertTrue(wait(5) { (self.page(w, "!!(window.MdPage && MdPage.current && MdPage.current.path.endsWith('n.md'))") as? Bool) == true })
        w.saveGraphic(svg: svg, name: "Figure")
        XCTAssertTrue(Lib.isFile(Lib.join(dir, "Uni/assets/Figure.svg")), "not in the project's assets")
        XCTAssertFalse(Lib.exists(Lib.join(dir, "assets/Figure.svg")), "kept in the folder's assets, outside the project")
        XCTAssertTrue(attachments().owned().contains(Lib.join(dir, "Uni/assets/Figure.svg")), "not known as the note's")
    }
}
