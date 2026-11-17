// A whiteboard in the real page (board.js): what is kept in its file while a gesture is under way.
import AppKit
import XCTest
@testable import MdView

final class BoardTests: ShellTest {
    /// Review of 2026-11-17: the board was kept in the middle of erasing (the timer of a stroke drawn just before); a second
    /// finger then took the erasing back on the screen — and the file kept the half-erased board, with nothing kept again.
    func testAGestureTakenBackLeavesTheFileAsTheBoardIs() throws {
        let sample = Lib.join(ShellTest.checkout, "web/public/welcome/samples/Empty.board.svg")
        let board = write("assets/S.board.svg", read(sample))
        let note = write("N.md", "# Sketch\n\n![](assets/S.board.svg)\n")
        let w = open(note)
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the board did not open")
        wait(1)
        // made-up pointers on the board's stage, as dev/probe-board.js makes them (a pen's, in one go: a made-up mouse, or one
        // drawn over timers, never lets go of the board in a window nobody sees)
        let setup = """
        window.__bd = {
          stage: () => document.querySelector('#board .bd-stage'),
          ev(type, x, y, id) { this.stage().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: 'pen', isPrimary: true, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, pressure: 0.5 })); },
          stroke(y, id) { this.ev('pointerdown', 200, y, id); for (let i = 1; i < 30; i++) this.ev('pointermove', 200 + i * 8, y + Math.sin(i / 3) * 20, id); this.ev('pointerup', 432, y, id); return MdBoard.state().items; },
        };
        document.querySelector('#board [data-kind="pen"]').click();
        return 1;
        """
        var done = false
        w.web.callAsyncJavaScript(setup, arguments: [:], in: nil, in: .page) { _ in done = true }
        wait(5) { done }
        XCTAssertEqual(page(w, "__bd.stroke(200, 7)") as? Int, 1, "the stroke was not drawn")
        XCTAssertTrue(wait(5) { self.read(board).contains("\"k\":\"ink\"") }, "the first stroke was not kept")
        let first = read(board).components(separatedBy: "\n").filter { $0.contains("\"k\":\"ink\"") }
        XCTAssertEqual(first.count, 1)
        guard first.count == 1 else { return }

        // a second stroke (its save waits 800 ms) — and at once the eraser through the first, held past that
        XCTAssertEqual(page(w, "__bd.stroke(320, 8)") as? Int, 2)
        page(w, "(document.querySelector('#board [data-kind=\"eraser\"]').click(), __bd.ev('pointerdown', 150, 200, 9), [180, 220, 260, 300, 340, 380, 420, 460].forEach((x) => __bd.ev('pointermove', x, 200, 9)), MdBoard.state().items)")
        wait(1.5)
        // a second finger: the erasing is taken back
        page(w, "(__bd.ev('pointercancel', 460, 200, 9), 1)")
        wait(1.5)
        let shown = page(w, "MdBoard.state().items") as? Int
        let kept = read(board).components(separatedBy: "\n").filter { $0.contains("\"k\":\"ink\"") }
        XCTAssertEqual(shown, 2, "the board on the screen")
        XCTAssertEqual(kept.count, 2, "the file does not hold the board as it is shown:\n" + kept.joined(separator: "\n"))
        XCTAssertTrue(kept.contains(first[0]), "the first stroke is not in the file as it was drawn")
    }

    /// Review of 2026-11-17: Space held to move the board, the window left, Space let go in another app — every pull moved
    /// the board from then on, and nothing could be drawn until Space was pressed again.
    func testSpaceHeldWhenTheWindowIsLeftIsLetGo() throws {
        let sample = Lib.join(ShellTest.checkout, "web/public/welcome/samples/Empty.board.svg")
        let board = write("assets/S.board.svg", read(sample))
        let w = open(write("N.md", "# Sketch\n\n![](assets/S.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!document.querySelector('#board[data-ready]')") as? Bool) == true }, "the board did not open")
        page(w, "(document.getElementById('board').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })), 1)")
        XCTAssertEqual(page(w, "document.querySelector('#board .bd-stage').dataset.space !== undefined") as? Bool, true, "Space did not take hold")
        page(w, "(dispatchEvent(new Event('blur')), 1)")
        XCTAssertEqual(page(w, "document.querySelector('#board .bd-stage').dataset.space === undefined") as? Bool, true, "Space is still held after the window was left")
    }
}

