// A note's project keeps versions of its own (History.swift): what is written in a window is kept once it is quiet.
import XCTest
@testable import MdView

final class HistoryTests: ShellTest {
    /// Bug 2 of the review (2026-11-17): NoteWindow.touch was an empty stub, so what a window wrote never waited for a
    /// snapshot — versions came only from Ctrl+S.
    func testASaveInAProjectWaitsForItsSnapshot() throws {
        let note = write("Note.md", "# A\n")
        try Hist.enable(dir)
        let w = open(note)
        HistoryHub.shared.unsnapped[dir] = nil
        w.on("save", ["type": "save", "text": "# A\n\nmore\n", "path": note])
        XCTAssertEqual(read(note), "# A\n\nmore\n")
        XCTAssertNotNil(HistoryHub.shared.unsnapped[dir], "the save did not ask for a snapshot")
    }

    /// … and once it is quiet, the version is there.
    func testTheVersionFollowsWhenItIsQuiet() throws {
        setenv("MDVIEW_HISTORY_QUIET_MS", "200", 1)
        defer { unsetenv("MDVIEW_HISTORY_QUIET_MS") }
        let note = write("Note.md", "# A\n")
        try Hist.enable(dir)
        let w = open(note)
        let before = Git.lines(Git.run(["log", "--format=%H"], in: dir)).count
        w.on("save", ["type": "save", "text": "# A\n\nkept\n", "path": note])
        XCTAssertTrue(wait(10) { Git.lines(Git.run(["log", "--format=%H"], in: self.dir)).count > before }, "no version was made")
        XCTAssertEqual(String(decoding: Git.run(["show", "HEAD:Note.md"], in: dir).out, as: UTF8.self), "# A\n\nkept\n")
    }
}
