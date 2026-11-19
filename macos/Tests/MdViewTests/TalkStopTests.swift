// A talk stopped at once, and a window closed while its talk runs (Assistant.swift): claude is ended — not left to run
// its ten minutes with nobody to read it (review 2026-11-17).
import XCTest
@testable import MdView

final class TalkStopTests: ShellTest {
    var pidFile = "", kept: String?

    override func setUp() {
        super.setUp()
        // a claude that says who it is and then waits — the one stopped is to be gone
        let fake = Lib.join(dir, "claude")
        pidFile = Lib.join(dir, "pid")
        try? "#!/bin/sh\necho $$ > '\(pidFile)'\nexec sleep 30\n".write(toFile: fake, atomically: true, encoding: .utf8)
        chmod(fake, 0o755)
        kept = Claude.cached
        Claude.cached = fake
        unsetenv("MDVIEW_TALK_FAKE")
    }
    override func tearDown() {
        Claude.cached = kept
        if let p = Int32((try? String(contentsOfFile: pidFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") { kill(p, SIGKILL) }
        super.tearDown()
    }
    func alive() -> Bool {
        guard let p = Int32((try? String(contentsOfFile: pidFile, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "") else { return false }
        return kill(p, 0) == 0
    }
    func talk() -> NoteWindow.Talk { NoteWindow.Talk(id: 1, channel: "chat", system: "", prompt: "hello", model: "", attach: [], pictures: [], effort: "") }

    func testATalkStoppedAtOnceEnds() {
        let w = open(write("N.md", "# N\n"))
        w.startTalk(talk())
        w.stopTalk("chat") // (before its process is known: it is ended as soon as it is — perhaps before it says who it is)
        wait(1.5)
        XCTAssertFalse(alive(), "the talk stopped at once runs on")
    }

    func testAWindowClosedEndsItsTalk() {
        let w = open(write("N.md", "# N\n"))
        w.startTalk(talk())
        XCTAssertTrue(wait(5) { Lib.exists(self.pidFile) && self.alive() })
        wait(0.3)
        w.closeNow()
        XCTAssertTrue(wait(3) { !self.alive() }, "the closed window's talk runs on")
    }
}
