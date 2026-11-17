// Children of the app (git, claude) given something on their stdin (HistoryGit.swift, Assistant.swift).
import XCTest
@testable import MdView

final class PipeTests: XCTestCase {
    /// Bug 9 of the review (2026-11-17): a child that went before it had read all it was given — git refusing at once
    /// (an index.lock left behind), claude stopped while its question was still being written — closed the pipe, and the
    /// write killed the whole app (SIGPIPE).
    func testAChildThatGoesBeforeReadingItsInputDoesNotKillTheApp() {
        let r = Git.run(["--version"], input: Data(count: 4 << 20)) // (git --version reads nothing of it)
        XCTAssertEqual(r.status, 0)
        XCTAssertTrue(String(decoding: r.out, as: UTF8.self).hasPrefix("git version"))
    }
}
