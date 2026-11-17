// A project below a project taken in (HistoryCore.swift Hist.merge): what the inner one kept of its own goes on as the
// outer one's — the ink on its PDFs, which files are hidden, how its folders look (review 2026-11-17: deleted with it).
import XCTest
@testable import MdView

final class TakeInTests: ShellTest {
    func testWhatTheInnerProjectKeptGoesOnAsTheOuterOnes() throws {
        write("A.md", "# A\n")
        write("Uni/B.md", "# B\n")
        write("Uni/Docs/secret.md", "# secret\n")
        let uni = Lib.join(dir, "Uni")
        try Hist.enable(uni)
        try Hist.enable(dir)
        XCTAssertEqual(Hist.placeOf(uni), .project(uni), "no inner project to take in")
        write("Uni/.mdview/pdf/0123abcd.board.svg", "<svg>ink</svg>\n")
        try Hidden.write(uni, ["Docs/secret.md"])
        try Looks.write(uni, ["Docs": ["color": "red"]])
        try Hist.merge(dir, child: uni, Stamp(device: "test (1)", client: "macos test", author: nil))
        XCTAssertFalse(Lib.exists(Lib.join(uni, ".mdview")))
        XCTAssertEqual(read(Lib.join(dir, ".mdview/pdf/0123abcd.board.svg")), "<svg>ink</svg>\n", "the ink on the PDF is gone")
        XCTAssertTrue(Hidden.read(dir).contains("Uni/Docs/secret.md"), "the hidden file shows again")
        XCTAssertNotNil(Looks.read(dir)["Uni/Docs"], "the folder's look is gone")
    }
}
