// A notebook made more as GoodNotes' (Henri, 2026-11-19: „das notizbuch noch intuitiver machen“ — he chose: a double tap fits
// the page, a page comes by itself where the last one is written full, the pages at a glance). The real page (board.js,
// board/pointer.js) with made-up fingers and a made-up pen.
import AppKit
import XCTest
@testable import MdView

final class NotebookPagesTests: ShellTest {
    /// A notebook of n squared pages, open in a window WebKit paints, with helpers to touch it.
    func notebook(_ n: Int) -> NoteWindow {
        let book = """
        <svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">
        <metadata id="mdview-board"><![CDATA[
        {"board":1,"bg":"auto","grid":false,"paper":{"bg":"grid","color":"white","size":"a4","n":\(n)}}
        ]]></metadata>
        </svg>
        """
        let board = write("assets/Heft.board.svg", book)
        let w = openPainted(write("H.md", "# Heft\n\n![](assets/Heft.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && MdBoard.state().book && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the notebook did not open")
        wait(0.6)
        let setup = """
        const stage = () => document.querySelector('#board .bd-stage');
        window.__nb = {
          stage,
          ev(type, x, y, id, kind) { const r = stage().getBoundingClientRect(); stage().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, pointerId: id, pointerType: kind, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: 0.5 })); },
          async tap(x, y) { this.ev('pointerdown', x, y, 21, 'touch'); this.ev('pointerup', x, y, 21, 'touch'); },
          async twice(x, y) { await this.tap(x, y); await new Promise((r) => setTimeout(r, 90)); await this.tap(x, y); },
          // a line written with the pen at a place of the board (its pixels), wherever the view is
          write(bx, by) { const v = MdBoard.state().view, x = (bx - v.x) * v.z, y = (by - v.y) * v.z; this.ev('pointerdown', x, y, 22, 'pen'); for (let i = 1; i <= 20; i++) this.ev('pointermove', x + i * 4, y + Math.sin(i / 3) * 6, 22, 'pen'); this.ev('pointerup', x + 80, y, 22, 'pen'); return MdBoard.state().items; },
          pages: () => MdBoard.paper.pages(Object.assign({ bg: 'grid', color: 'white', size: 'a4' }, { n: MdBoard.state().book.pages })),
          // where all the ink is: chosen all, its box read, let go again
          inkBox() { document.getElementById('board').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true })); const b = MdBoard.state().chosenBox; document.getElementById('board').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return b; },
          undo() { document.getElementById('board').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true })); return MdBoard.state().book.pages; },
        };
        return 1;
        """
        var done = false
        w.web.callAsyncJavaScript(setup, arguments: [:], in: nil, in: .page) { _ in done = true }
        wait(5) { done }
        return w
    }
    func run(_ w: NoteWindow, _ body: String) -> Any? {
        var out: Any?, done = false
        w.web.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { r in if case .success(let v) = r { out = v } else { print("script failed", r) }; done = true }
        wait(5) { done }
        return out
    }
    func z(_ w: NoteWindow) -> Double { (page(w, "MdBoard.state().view.z") as? NSNumber)?.doubleValue ?? 0 }

    /// A finger's double tap: from the page across the window to the page whole in it, and back (Henri: „Doppeltipp = Seite
    /// einpassen“); the lasso in hand, so a finger does not draw.
    func testADoubleTapFitsThePage() {
        let w = notebook(3)
        page(w, "(document.querySelector('#board [data-kind=\"lasso\"]').click(), 1)")
        let across = z(w)
        XCTAssertGreaterThan(across, 0.2)
        _ = run(w, "await __nb.twice(400, 400); return 1;")
        XCTAssertTrue(wait(3) { self.z(w) < across * 0.95 }, "a double tap did not make the page whole in the window: \(z(w)) from \(across)")
        let whole = z(w)
        wait(0.5)
        // (from the view, not the sheets' rectangles: a window nobody sees may not have drawn the last frame)
        let fits = page(w, "(() => { const v = MdBoard.state().view, b = document.querySelector('#board'), top = v.y, bottom = v.y + b.clientHeight / v.z; return __nb.pages().some((p) => p.y >= top - 1 && p.y + p.h <= bottom + 1); })()") as? Bool
        XCTAssertEqual(fits, true, "the page is not whole in the window at \(whole)")
        _ = run(w, "await new Promise((r) => setTimeout(r, 500)); await __nb.twice(400, 400); return 1;")
        XCTAssertTrue(wait(3) { abs(self.z(w) - across) < across * 0.03 }, "a second double tap did not bring the page back across the window: \(z(w)) for \(across)")
        // two taps far apart, or slow, are no double tap
        _ = run(w, "await new Promise((r) => setTimeout(r, 500)); await __nb.tap(200, 300); await new Promise((r) => setTimeout(r, 90)); await __nb.tap(600, 500); return 1;")
        wait(0.6)
        XCTAssertEqual(z(w), across, accuracy: across * 0.03, "two taps far apart fitted the page")
    }

    /// Written at the foot of the last page, the next page comes by itself — one step back takes the line and the page; written
    /// higher up, or on a page before, none comes.
    func testWritingAtTheFootOfTheLastPageBringsANewOne() {
        let w = notebook(2)
        page(w, "(document.querySelector('#board [data-kind=\"pen\"]').click(), 1)")
        XCTAssertEqual(run(w, "const p = __nb.pages(); return __nb.write(p[1].x + 100, p[1].y + p[1].h * 0.5);") as? Int, 1)
        XCTAssertEqual(page(w, "MdBoard.state().book.pages") as? Int, 2, "written in the middle of the last page, a page came")
        XCTAssertEqual(run(w, "const p = __nb.pages(); return __nb.write(p[0].x + 100, p[0].y + p[0].h * 0.92);") as? Int, 2)
        XCTAssertEqual(page(w, "MdBoard.state().book.pages") as? Int, 2, "written at the foot of the first page, a page came")
        XCTAssertEqual(run(w, "const p = __nb.pages(); return __nb.write(p[1].x + 100, p[1].y + p[1].h * 0.92);") as? Int, 3)
        XCTAssertEqual(page(w, "MdBoard.state().book.pages") as? Int, 3, "written at the foot of the last page, no page came")
        XCTAssertEqual(run(w, "return __nb.undo();") as? Int, 2, "one step back did not take the page away with the line")
        XCTAssertEqual(page(w, "MdBoard.state().items") as? Int, 2)
    }

    /// The pages at a glance: each a small picture with what is on it; pressed, the notebook goes there; pulled onto another
    /// page, it goes there with what is on it; copied, its copy follows it — each one step back.
    func testThePagesAtAGlance() {
        let w = notebook(3)
        page(w, "(document.querySelector('#board [data-kind=\"pen\"]').click(), 1)")
        XCTAssertEqual(run(w, "const p = __nb.pages(); return __nb.write(p[0].x + 100, p[0].y + 200);") as? Int, 1)
        page(w, "(document.querySelector('#board .bd-zoom [data-do=\"pages\"]').click(), 1)")
        XCTAssertTrue(wait(3) { (self.page(w, "MdBoard.state().overview") as? Bool) == true }, "the pages' button did not open them at a glance")
        XCTAssertEqual(page(w, "document.querySelectorAll('#board .bd-pages .bd-pg').length") as? Int, 3)
        XCTAssertEqual(page(w, "!!document.querySelector('#board .bd-pg[data-i=\"0\"] svg path[id]') && !document.querySelector('#board .bd-pg[data-i=\"1\"] svg path[id]')") as? Bool, true, "the first page's picture does not show its line (or the second shows it)")
        XCTAssertEqual(page(w, "!!document.querySelector('#board .bd-pg[data-i=\"0\"][data-now]')") as? Bool, true, "the page in sight is not marked")
        // pressed: the notebook goes to page 3, the pages at a glance shut
        page(w, "(document.querySelector('#board .bd-pg[data-i=\"2\"] .bd-pg-go').click(), 1)")
        XCTAssertEqual(page(w, "MdBoard.state().overview") as? Bool, false)
        XCTAssertEqual(page(w, "(() => { const p = __nb.pages()[2], v = MdBoard.state().view; return v.y >= p.y - 200 && v.y <= p.y + 10; })()") as? Bool, true, "the notebook did not go to the page pressed")
        // pulled: page 1 onto page 3 — its line goes with it
        page(w, "(document.querySelector('#board .bd-zoom [data-do=\"pages\"]').click(), 1)")
        XCTAssertTrue(wait(3) { (self.page(w, "MdBoard.state().overview") as? Bool) == true })
        let pull = """
        const a = document.querySelector('#board .bd-pg[data-i="0"] .bd-pg-go'), b = document.querySelector('#board .bd-pg[data-i="2"] .bd-pg-go');
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const ev = (t, el, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 31, pointerType: 'mouse', isPrimary: true, button: 0, buttons: t === 'pointerup' ? 0 : 1 }));
        ev('pointerdown', a, ra.left + 20, ra.top + 20);
        for (let i = 1; i <= 10; i++) ev('pointermove', a, ra.left + 20 + (rb.left - ra.left) * i / 10, ra.top + 20 + (rb.top - ra.top) * i / 10);
        ev('pointerup', a, rb.left + 20, rb.top + 20);
        a.click();
        await new Promise((r) => setTimeout(r, 50));
        const open = MdBoard.state().overview, p = __nb.pages(), box = __nb.inkBox(); // (inkBox's Escape shuts them: read first)
        return [box[1] >= p[2].y && box[3] <= p[2].y + p[2].h, open];
        """
        let moved = run(w, pull) as? [Bool] ?? []
        XCTAssertEqual(moved.first, true, "pulled onto the third page, the first page's line is not on the third")
        XCTAssertEqual(moved.last, true, "a pull shut the pages at a glance (the click after it was taken as a press)")
        XCTAssertEqual(run(w, "__nb.undo(); const p = __nb.pages(), box = __nb.inkBox(); return box[1] >= p[0].y && box[3] <= p[0].y + p[0].h;") as? Bool, true, "one step back did not bring the line back to the first page")
        // copied: four pages, the line on the first and on the second
        page(w, "(MdBoard.page('dup', 0), 1)")
        XCTAssertEqual(page(w, "MdBoard.state().book.pages") as? Int, 4)
        XCTAssertEqual(page(w, "MdBoard.state().items") as? Int, 2, "the copy of the page has no copy of its line")
        XCTAssertEqual(run(w, "return __nb.undo();") as? Int, 3)
        XCTAssertEqual(page(w, "MdBoard.state().items") as? Int, 1)
    }

    /// A picture of the pages at a glance (not a check): only with MDVIEW_SNAP=<folder>.
    func testPicture() throws {
        let snap = ProcessInfo.processInfo.environment["MDVIEW_SNAP"]
        try XCTSkipIf(snap == nil, "only with MDVIEW_SNAP")
        let w = notebook(5)
        w.window.setContentSize(NSSize(width: 1100, height: 760))
        wait(0.5)
        page(w, "(document.querySelector('#board [data-kind=\"pen\"]').click(), 1)")
        _ = run(w, "const p = __nb.pages(); for (const [i, dy] of [[0, 150], [0, 260], [1, 200], [3, 400]]) __nb.write(p[i].x + 90, p[i].y + dy); return 1;")
        page(w, "(document.querySelector('#board .bd-zoom [data-do=\"pages\"]').click(), 1)")
        wait(1)
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-x", "-o", "-l", String(w.window.windowNumber), Lib.join(snap!, "pages.png")]
        try p.run(); p.waitUntilExit()
    }
}
