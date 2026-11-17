// A figure to be changed (Assistant.swift drawRun): the figure goes to claude on its way in, not as an argument — a
// detailed one is longer than a command line may be (review 2026-11-17).
import XCTest
@testable import MdView

final class FigurePromptTests: XCTestCase {
    func testTheFigureToBeChangedGoesInOnItsWayIn() throws {
        let dir = NSTemporaryDirectory() + "mdview-fakeclaude-\(UUID().uuidString)"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: dir) }
        let fake = dir + "/claude", args = dir + "/args", input = dir + "/stdin"
        try "#!/bin/sh\nprintf '%s\\n' \"$@\" > '\(args)'\ncat > '\(input)'\nprintf '%s' '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><path d=\"M0 0L10 10\"/></svg>'\n"
            .write(toFile: fake, atomically: true, encoding: .utf8)
        chmod(fake, 0o755)
        let kept = Claude.cached
        Claude.cached = fake
        defer { Claude.cached = kept }
        let previous = "<svg xmlns=\"http://www.w3.org/2000/svg\">" + String(repeating: "<path d=\"M0 0L1 1\"/>", count: 12_000) + "</svg>"
        let state = AIState()
        state.drawTurn = 1
        let got = NoteWindow.drawRun(text: "", image: nil, previous: previous, change: "make it red", mine: 1, state: state)
        XCTAssertNotNil(got?.0, "no figure came back: \(String(describing: got?.1))")
        XCTAssertFalse(try String(contentsOfFile: args, encoding: .utf8).contains("M0 0L1 1"), "the figure was an argument")
        XCTAssertTrue(try String(contentsOfFile: input, encoding: .utf8).contains(previous), "the figure did not go in")
    }
}
