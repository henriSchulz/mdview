// The page a window shows (Page.swift): what of a note may run in it, and that the page itself still runs.
import XCTest
@testable import MdView

final class PageTests: ShellTest {
    /// Bug 1 of the review (2026-11-17): the macOS page had no Content-Security-Policy. A handler the note's HTML
    /// slipped past the page's own filter (`"/onerror=`) ran, with the shell's messages at hand — here it saves.
    func testANotesHandlerDoesNotRun() {
        let attack = #"<img src="missing.png"/onerror="webkit.messageHandlers.msg.postMessage(JSON.stringify({type:'save',text:'PWNED'}))">"#
        let note = write("Note.md", "# Note\n\n<div>\(attack)</div>\n")
        let w = open(note)
        wait(2)
        XCTAssertEqual(read(note), "# Note\n\n<div>\(attack)</div>\n", "the note's own script ran and wrote the note")
        _ = w
    }

    /// The page under the policy: its own scripts, those loaded later too (the active mode), still run.
    func testThePageRunsUnderItsPolicy() {
        let note = write("Note.md", "# Note\n\nText with $x^2$.\n")
        let w = open(note)
        XCTAssertEqual(page(w, "!!document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]')") as? Bool, true)
        XCTAssertEqual(page(w, "!!document.querySelector('#content .katex')") as? Bool, true, "a formula was not drawn")
        _ = page(w, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true },
                      "the active mode did not load")
    }
}
