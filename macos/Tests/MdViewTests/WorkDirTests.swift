// Where claude runs for a talk or a figure (Assistant.swift Claude.workDir): a folder of its own each time — two windows
// asking at once never share one (review 2026-11-17: named by the window's channel, one deleted the other's files).
import XCTest
@testable import MdView

final class WorkDirTests: XCTestCase {
    func testEachTalkAndFigureHasAFolderOfItsOwn() {
        let a = Claude.workDir("talk"), b = Claude.workDir("talk"), c = Claude.workDir("graphic")
        XCTAssertNotEqual(a, b)
        XCTAssertNotEqual(a, c)
        XCTAssertTrue(a.hasPrefix(NSTemporaryDirectory() + "mdview-talk-"))
    }
}
