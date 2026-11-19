// An HTML block: a fence of "htmlblock" is shown as the HTML it holds, with styles of its own (Henri, 2026-11-19: "es soll
// nun einen htmlblock geben wie jeglicher html mit css styles usw geladen werden kann") — in a frame of its own: its styles
// stay in it, nothing in it runs, and it is as high as what it holds.
import AppKit
import XCTest
@testable import MdView

final class HtmlBlockTests: ShellTest {
    let note = """
    # Page

    Before.

    ```htmlblock
    <style>
      body { background: rgb(10, 20, 30); }
      p { color: rgb(1, 2, 3); }
      .box { height: 180px; margin: 0; color: rgb(200, 100, 50); }
    </style>
    <div class="box" id="box" onclick="window.top.__clicked = 1">A box</div>
    <script>window.top.__ran = 1</script>
    ```

    After.

    ```html
    <p>shown as code</p>
    ```
    """

    func frame(_ w: NoteWindow, in root: String, _ js: String) -> Any? {
        page(w, "(() => { const f = document.querySelector('\(root) .html-block iframe.html-frame'), d = f && f.contentDocument; if (!d || !d.getElementById('box')) return null; return (\(js)); })()")
    }

    func testAnHtmlBlockIsShownWithItsOwnStyles() {
        let w = open(write("H.md", note))
        _ = page(w, "(MdPage.setMode('read'), 1)")
        XCTAssertTrue(wait(8) { self.frame(w, in: "#content", "true") as? Bool == true }, "no frame with the block's HTML in the reading view")
        XCTAssertEqual(frame(w, in: "#content", "getComputedStyle(d.getElementById('box')).color") as? String, "rgb(200, 100, 50)", "its own style does not hold in it")
        // as high as what it holds
        XCTAssertTrue(wait(5) { ((self.frame(w, in: "#content", "f.getBoundingClientRect().height") as? NSNumber)?.doubleValue ?? 0) == 180 },
                      "the frame is \(frame(w, in: "#content", "f.getBoundingClientRect().height") ?? "nil") high, its content 180")
        // its styles stay in it: the note's paragraphs and ground are the note's
        XCTAssertNotEqual(page(w, "getComputedStyle([...document.querySelectorAll('#content p')].find((p) => p.textContent === 'After.')).color") as? String, "rgb(1, 2, 3)")
        XCTAssertNotEqual(page(w, "getComputedStyle(document.body).backgroundColor") as? String, "rgb(10, 20, 30)")
        // nothing in it runs: not its script, not a handler
        _ = frame(w, in: "#content", "(d.getElementById('box').click(), 1)")
        XCTAssertEqual(page(w, "[window.__ran || 0, window.__clicked || 0].join()") as? String, "0,0", "something of the block ran")
        // a fence of html is code, as before
        XCTAssertEqual(page(w, "[...document.querySelectorAll('#content .code-block code')].some((c) => c.textContent.includes('shown as code'))") as? Bool, true)
        XCTAssertEqual(page(w, "document.querySelectorAll('#content iframe').length") as? Int, 1)

        // the active mode shows it the same, and leaves the file as it is
        _ = page(w, "(MdPage.setMode('active'), 1)")
        XCTAssertTrue(wait(10) { self.frame(w, in: ".ProseMirror", "getComputedStyle(d.getElementById('box')).color") as? String == "rgb(200, 100, 50)" }, "not shown in the active mode")
        wait(1)
        XCTAssertEqual(read(Lib.join(dir, "H.md")), note)
    }
}
