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

    /// A pinch — a Mac's trackpad, fingers on an iPad that is the Mac's screen (ipad-cast) — makes the board larger and
    /// smaller: WebKit on the Mac says it as gesture events (Henri, 2026-11-19; until then nothing took them).
    func testAPinchSizesTheBoard() throws {
        let sample = Lib.join(ShellTest.checkout, "web/public/welcome/samples/Empty.board.svg")
        let board = write("assets/P.board.svg", read(sample))
        let w = open(write("P.md", "# Pinch\n\n![](assets/P.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the board did not open")
        wait(0.5)
        let pinch = """
        const stage = document.querySelector('#board .bd-stage'), r = stage.getBoundingClientRect(), z0 = MdBoard.state().zoom;
        const say = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { scale, rotation: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); stage.dispatchEvent(e); return e.defaultPrevented; };
        const taken = say('gesturestart', 1);
        for (const s of [1.1, 1.25, 1.4, 1.5]) say('gesturechange', s);
        say('gestureend', 1.5);
        return [taken, MdBoard.state().zoom / z0];
        """
        var got: [Any]?
        var done = false
        w.web.callAsyncJavaScript(pinch, arguments: [:], in: nil, in: .page) { r in if case .success(let v) = r { got = v as? [Any] }; done = true }
        wait(5) { done }
        XCTAssertEqual(got?.first as? Bool, true, "the pinch is left to the system")
        XCTAssertEqual((got?.last as? NSNumber)?.doubleValue ?? 0, 1.5, accuracy: 0.01, "the board is not one and a half times as large")
    }

    /// With a pen or the eraser in hand on an open board the shell knows it (and says where a finger draws at once: ipad-cast
    /// made a drag of a finger only after it rested — Henri, 2026-11-19: "man muss beim zeichnen lange drücken"); with the
    /// pointer in hand, and with the board shut, not.
    func testThePenInHandIsSaid() throws {
        let sample = Lib.join(ShellTest.checkout, "web/public/welcome/samples/Empty.board.svg")
        let board = write("assets/D.board.svg", read(sample))
        let w = open(write("D.md", "# Draw\n\n![](assets/D.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the board did not open")
        page(w, "(document.querySelector('#board [data-kind=\"pen\"]').click(), 1)")
        XCTAssertTrue(wait(5) { w.boardDraws }, "a pen in hand, and the shell does not know")
        page(w, "(document.querySelector('#board [data-kind=\"lasso\"]').click(), 1)")
        XCTAssertTrue(wait(5) { !w.boardDraws }, "the pointer in hand, and a finger would still draw")
        page(w, "(document.querySelector('#board [data-kind=\"eraser\"]').click(), 1)")
        XCTAssertTrue(wait(5) { w.boardDraws }, "the eraser in hand")
        page(w, "(MdBoard.close(), 1)")
        XCTAssertTrue(wait(5) { !w.boardDraws }, "the board shut, and a finger would still draw")

        // what is said: the window's part under the bar, counted from the screen's top left — and heard by whoever listens
        let word = TouchDraw.word(window: w.window, on: true)
        let r = (word["rects"] as? [[Double]])?.first ?? []
        XCTAssertEqual(r.count, 4)
        XCTAssertEqual(r[2], Double(w.window.frame.width), accuracy: 0.5)
        XCTAssertEqual(r[3], Double(w.window.contentLayoutRect.height), accuracy: 0.5)
        XCTAssertEqual(r[1], Double(NSScreen.screens[0].frame.maxY - w.window.frame.minY - w.window.contentLayoutRect.height), accuracy: 0.5)
        XCTAssertEqual(word["pid"] as? Int, Int(getpid()))
        var heard: [AnyHashable: Any]?
        let o = DistributedNotificationCenter.default().addObserver(forName: TouchDraw.name, object: nil, queue: .main) { heard = $0.userInfo }
        defer { DistributedNotificationCenter.default().removeObserver(o) }
        TouchDraw.say(window: w.window, on: true)
        XCTAssertTrue(wait(5) { heard != nil }, "nothing was said")
        XCTAssertEqual((heard?["rects"] as? [[Double]])?.first, r)
        TouchDraw.say(window: w.window, on: false)
        XCTAssertTrue(wait(5) { (heard?["rects"] as? [Any])?.isEmpty == true }, "the area was not taken back")
    }

    /// A notebook keeps its pages in sight, as GoodNotes' do (Henri, 2026-11-19: "nicht intuitiv … das verschieben des
    /// notizbuches, das ist man ganz noch außerhalb des bildes"): it opens with its first page across the window under the
    /// bars; two fingers (wheel steps, as a trackpad and ipad-cast's fingers send them) pulled past its top give way less
    /// and less and it goes back when they stop; a pinch smaller than a page whole comes back to the page whole.
    func testANotebookKeepsItsPagesInSight() throws {
        let book = """
        <svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">
        <metadata id="mdview-board"><![CDATA[
        {"board":1,"bg":"auto","grid":false,"paper":{"bg":"grid","color":"white","size":"a4","n":4}}
        ]]></metadata>
        </svg>
        """
        let board = write("assets/Heft.board.svg", book)
        let w = open(write("H.md", "# Heft\n\n![](assets/Heft.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && MdBoard.state().book && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the notebook did not open")
        wait(0.6)
        let sheet = "(() => { const b = document.querySelector('#board'), r = b.getBoundingClientRect(), s = b.querySelector('.bd-sheet').getBoundingClientRect(), t = b.querySelector('.bd-title'); return [s.left - r.left, s.top - r.top, s.width, r.width, t.offsetTop + t.offsetHeight, MdBoard.state().view.z]; })()"
        let opened = (page(w, sheet) as? [NSNumber])?.map(\.doubleValue) ?? []
        XCTAssertEqual(opened.count, 6)
        guard opened.count == 6 else { return }
        XCTAssertGreaterThan(opened[1], opened[4], "the first page's top lies under the bars")
        XCTAssertLessThan(opened[1], opened[4] + 20, "the first page's top is not right under the bars")
        XCTAssertGreaterThan(opened[2], opened[3] * 0.75, "the first page is not across the window")
        // two fingers pulled down past the top (a trackpad's stream of small steps), then still — how far the page came down is
        // read from the view, in the window's pixels: the page itself is moved with the next frame, which a hidden window may not draw
        let pull = """
        const stage = document.querySelector('#board .bd-stage'), r = stage.getBoundingClientRect();
        const v0 = MdBoard.state().view;
        for (let i = 0; i < 50; i++) stage.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -20, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
        const v1 = MdBoard.state().view;
        return (v0.y - v1.y) * v1.z;
        """
        var pulled: Double?
        var done = false
        w.web.callAsyncJavaScript(pull, arguments: [:], in: nil, in: .page) { r in
            switch r { case .success(let v): pulled = (v as? NSNumber)?.doubleValue; if pulled == nil { print("pull said", v) }; case .failure(let e): print("pull failed", e) }
            done = true
        }
        wait(5) { done }
        let by = pulled ?? 0
        XCTAssertGreaterThan(by, 40, "1000 px pulled, and the page did not give way")
        XCTAssertLessThan(by, 600, "1000 px pulled, and the page went \(by) — no edge")
        XCTAssertTrue(wait(3) { abs(((self.page(w, sheet) as? [NSNumber])?[1].doubleValue ?? 0) - opened[1]) < 1 }, "the page did not go back under the bars")
        // a pinch to a fifth: back to the page whole in the window
        let pinch = """
        const stage = document.querySelector('#board .bd-stage'), r = stage.getBoundingClientRect();
        const say = (type, scale) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { scale, rotation: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }); stage.dispatchEvent(e); };
        say('gesturestart', 1);
        for (const s of [0.8, 0.6, 0.4, 0.3, 0.2]) say('gesturechange', s);
        say('gestureend', 0.2);
        return 1;
        """
        done = false
        w.web.callAsyncJavaScript(pinch, arguments: [:], in: nil, in: .page) { _ in done = true }
        wait(5) { done }
        let whole = "(() => { const b = document.querySelector('#board'), r = b.getBoundingClientRect(), s = b.querySelector('.bd-sheet').getBoundingClientRect(); return [s.top - r.top, s.bottom - r.top, r.height]; })()"
        XCTAssertTrue(wait(3) {
            guard let g = (self.page(w, whole) as? [NSNumber])?.map(\.doubleValue), g.count == 3 else { return false }
            return g[0] >= opened[4] - 1 && g[1] <= g[2] && g[1] > g[2] - 40
        }, "pinched small, the page did not come back whole in the window: \(String(describing: page(w, whole)))")
    }
}

