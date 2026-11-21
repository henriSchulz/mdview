// A notebook pulled past its edge by a finger — the cast's (ipad-cast: an iPad that is the Mac's screen) or a trackpad's — and
// let go: it goes back once, straight, as an iPad's list does (Henri, 2026-11-21: "wenn man vom dokument wegscrollt
// funktioniert das zurückspringen noch nicht ganz clean. manchmal wackelt es mehrmals hin und her"). The events are made as
// the cast posts them (Input.swift: scrollEvent, momentumEvent) — the finger's steps with their phases, then the glide after
// it with its momentum phases —, through WebKit, as the window gets them.
import AppKit
import XCTest
@testable import MdView

final class NotebookScrollTests: ShellTest {
    override func tearDown() {
        CastHost.fixed = nil
        super.tearDown()
    }

    func spot(_ w: NoteWindow, _ x: CGFloat, _ y: CGFloat) -> CGPoint {
        let web = w.web, top = NSScreen.screens[0].frame.maxY
        let at = web.convert(NSPoint(x: x, y: web.isFlipped ? y : web.bounds.height - y), to: nil)
        return CGPoint(x: at.x, y: top - at.y)
    }
    /// A wheel as the cast posts it: content follows the finger (a positive dy brings the top of the page down);
    /// phase: the finger's (1 began, 2 changed, 4 ended), momentum: the glide's after it (1 began, 2 on, 3 ended).
    func wheel(_ w: NoteWindow, at p: CGPoint, dy: Double, phase: Int64 = 0, momentum: Int64 = 0) {
        let c = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(dy.rounded()), wheel2: 0, wheel3: 0)!
        c.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        c.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: dy)
        c.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: dy)
        if phase != 0 { c.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase) }
        if momentum != 0 { c.setIntegerValueField(.scrollWheelEventMomentumPhase, value: momentum) }
        c.location = spot(w, p.x, p.y)
        c.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        let e = NSEvent(cgEvent: c)!
        (w.web as! FilesWebView).penSay(e)
        w.web.scrollWheel(with: e)
    }

    /// How far the first page is beyond the top edge, every few milliseconds, while `act` runs and a while after: window pixels.
    func record(_ w: NoteWindow, top: Double, after: Double = 1.6, _ act: () -> Void) -> [Double] {
        _ = page(w, "(clearInterval(window.__recT), window.__rec = [], window.__recT = setInterval(() => { const v = MdBoard.state().view; __rec.push(Math.round((\(top) - v.y) * v.z * 10) / 10); }, 8), 1)")
        act()
        wait(after)
        return ((page(w, "(clearInterval(window.__recT), __rec)") as? [NSNumber]) ?? []).map(\.doubleValue)
    }
    /// How often the page went back toward the edge and then away from it again (more than `slack` pixels each way).
    func wobbles(_ s: [Double], slack: Double = 3) -> Int {
        var n = 0, peak = -Double.infinity, low = Double.infinity, falling = false
        for v in s {
            if !falling { peak = max(peak, v); if v < peak - slack { falling = true; low = v } }
            else { low = min(low, v); if v > low + slack { n += 1; falling = false; peak = v } }
        }
        return n
    }

    func openNotebook() -> NoteWindow? {
        let book = """
        <svg xmlns="http://www.w3.org/2000/svg" width="640" height="900" viewBox="0 0 640 900">
        <metadata id="mdview-board"><![CDATA[
        {"board":1,"bg":"auto","grid":false,"paper":{"bg":"grid","color":"white","size":"a4","n":4}}
        ]]></metadata>
        </svg>
        """
        let board = write("assets/Heft.board.svg", book)
        let w = openPainted(write("H.md", "# Heft\n\n![](assets/Heft.board.svg)\n"))
        w.window.setFrameOrigin(NSPoint(x: 0, y: 80)) // (WebKit takes made-up wheels only for a window on a screen)
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdPage && MdPage.current)") as? Bool) == true }, "the note was not drawn")
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        guard wait(10, until: { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && MdBoard.state().book && document.querySelector('#board[data-ready]'))") as? Bool) == true }) else {
            XCTFail("the notebook did not open"); return nil
        }
        wait(0.6)
        return w
    }

    /// Pulled down past the top, let go while still moving, the glide after it running out in ever smaller steps — some two in
    /// one, as WebKit hands on wheels it could not take in time: the page comes down once and goes back once, and stays.
    func testANotebookPulledPastItsTopGoesBackOnce() {
        for cast in [true, false] {
            CastHost.fixed = cast ? Int64(getpid()) : nil
            guard let w = openNotebook() else { return }
            let mid = (page(w, "(() => { const r = document.querySelector('#board .bd-stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()") as? [NSNumber]) ?? []
            XCTAssertEqual(mid.count, 2)
            guard mid.count == 2 else { return }
            let at = CGPoint(x: mid[0].doubleValue, y: mid[1].doubleValue), top = (page(w, "MdBoard.state().view.y") as? NSNumber)?.doubleValue ?? 0
            let s = record(w, top: top) {
                wheel(w, at: at, dy: 6, phase: 1)
                wait(0.016)
                for _ in 0..<14 { wheel(w, at: at, dy: 22, phase: 2); wait(0.016) }
                wheel(w, at: at, dy: 0, phase: 4)
                var d = 24.0, i = 0
                while d >= 0.4 {
                    wheel(w, at: at, dy: i % 6 == 5 ? 2 * d : d, momentum: i == 0 ? 1 : 2)
                    d *= 0.967; i += 1
                    wait(0.016)
                }
                wheel(w, at: at, dy: 0, momentum: 3)
            }
            let peak = s.max() ?? 0, end = s.last ?? 99
            XCTAssertGreaterThan(peak, 30, "\(cast ? "cast" : "trackpad"): the page did not come down past its top: \(s)")
            XCTAssertLessThan(abs(end), 1, "\(cast ? "cast" : "trackpad"): the page did not go back under the bars: \(s)")
            XCTAssertEqual(wobbles(s), 0, "\(cast ? "cast" : "trackpad"): the page went back and away again: \(s)")
            w.window.close()
            wait(0.3)
        }
    }

    /// A flick toward the top from further down: the glide runs into the edge, the page comes down a little past it and goes
    /// back once; and a finger that pulled the page down past its top and rests there holds it there until it lifts.
    func testAGlideBouncesOnceAndARestingFingerHolds() {
        CastHost.fixed = Int64(getpid())
        guard let w = openNotebook() else { return }
        let mid = (page(w, "(() => { const r = document.querySelector('#board .bd-stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()") as? [NSNumber]) ?? []
        XCTAssertEqual(mid.count, 2)
        guard mid.count == 2 else { return }
        let at = CGPoint(x: mid[0].doubleValue, y: mid[1].doubleValue), top = (page(w, "MdBoard.state().view.y") as? NSNumber)?.doubleValue ?? 0
        // down into the notebook first (300 px), let go still
        wheel(w, at: at, dy: -5, phase: 1)
        for _ in 0..<10 { wheel(w, at: at, dy: -30, phase: 2); wait(0.016) }
        wheel(w, at: at, dy: 0, phase: 4)
        wait(0.5)
        let down = record(w, top: top) {
            wheel(w, at: at, dy: 5, phase: 1)
            wait(0.016)
            for _ in 0..<4 { wheel(w, at: at, dy: 30, phase: 2); wait(0.016) }
            wheel(w, at: at, dy: 0, phase: 4)
            var d = 30.0, i = 0
            while d >= 0.4 {
                wheel(w, at: at, dy: i % 5 == 4 ? 2 * d : d, momentum: i == 0 ? 1 : 2)
                d *= 0.967; i += 1
                wait(0.016)
            }
            wheel(w, at: at, dy: 0, momentum: 3)
        }
        let peak = down.max() ?? 0
        XCTAssertGreaterThan(peak, 1, "the glide did not reach the top: \(down)")
        XCTAssertLessThan(peak, 40, "the glide went far past the top: \(down)")
        XCTAssertLessThan(abs(down.last ?? 99), 1, "the page did not go back under the bars: \(down)")
        XCTAssertEqual(wobbles(down, slack: 1.5), 0, "the page went back and away again: \(down)")

        // pulled down past the top, then the finger rests (the cast says nothing while it does), then lifts
        let held = record(w, top: top, after: 1.2) {
            wheel(w, at: at, dy: 5, phase: 1)
            wait(0.016)
            for _ in 0..<8 { wheel(w, at: at, dy: 25, phase: 2); wait(0.016) }
            wait(0.6)
            _ = page(w, "(window.__heldAt = MdBoard.state().view.y, 1)")
            wheel(w, at: at, dy: 0, phase: 4)
        }
        let rested = (page(w, "(\(top) - __heldAt) * MdBoard.state().view.z") as? NSNumber)?.doubleValue ?? 0
        XCTAssertGreaterThan(rested, 30, "the page went back under a finger that rested on it: \(held)")
        XCTAssertLessThan(abs(held.last ?? 99), 1, "the page did not go back once the finger lifted: \(held)")
        XCTAssertEqual(wobbles(held), 0, "the page went back and away again: \(held)")
    }
}
