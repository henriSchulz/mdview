// What the cast makes of a finger that holds or moves (ipad-cast: an iPad that is the Mac's screen), read as the iPad's gesture
// (Henri, 2026-11-21: "lange touch von notizen ordner und so geht nicht, blöcke ziehen zum auswählen auch nicht"). The cast
// says nothing while a finger rests — held and let go it is a right click —, and a finger that moves is a trackpad's scroll,
// with its phases. The events are made here as the cast posts them: from its process, through WebKit.
import AppKit
import XCTest
@testable import MdView

final class CastGestureTests: ShellTest {
    override func tearDown() {
        CastHost.fixed = nil
        super.tearDown()
    }

    /// A point of the web view as a windowless event places it (NSEvent(cgEvent:) has no window: its place on the screen is
    /// taken for its place in the window).
    func spot(_ w: NoteWindow, _ x: CGFloat, _ y: CGFloat) -> CGPoint {
        let web = w.web, top = NSScreen.screens[0].frame.maxY
        let at = web.convert(NSPoint(x: x, y: web.isFlipped ? y : web.bounds.height - y), to: nil)
        return CGPoint(x: at.x, y: top - at.y)
    }
    func click(_ w: NoteWindow, _ type: CGEventType, _ x: CGFloat, _ y: CGFloat) {
        let button: CGMouseButton = [.rightMouseDown, .rightMouseUp].contains(type) ? .right : .left
        let c = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: spot(w, x, y), mouseButton: button)!
        c.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        let e = NSEvent(cgEvent: c)!
        (w.web as! FilesWebView).penSay(e)
        switch type {
        case .leftMouseDown: w.web.mouseDown(with: e)
        case .leftMouseUp: w.web.mouseUp(with: e)
        case .rightMouseDown: w.web.rightMouseDown(with: e)
        case .rightMouseUp: w.web.rightMouseUp(with: e)
        default: break
        }
    }
    /// A finger's move as the cast posts it (Input.swift scrollEvent): content follows the finger — the wheel's delta is the
    /// finger's way —, the pointer where the finger came down; phase 1 began, 2 changed, 4 ended.
    func scroll(_ w: NoteWindow, at x: CGFloat, _ y: CGFloat, dx: Double, dy: Double, phase: Int64) {
        let c = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(dy.rounded()), wheel2: Int32(dx.rounded()), wheel3: 0)!
        c.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
        c.setDoubleValueField(.scrollWheelEventPointDeltaAxis1, value: dy)
        c.setDoubleValueField(.scrollWheelEventPointDeltaAxis2, value: dx)
        c.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis1, value: dy)
        c.setDoubleValueField(.scrollWheelEventFixedPtDeltaAxis2, value: dx)
        c.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
        c.location = spot(w, x, y)
        c.setIntegerValueField(.eventSourceUnixProcessID, value: Int64(getpid()))
        let e = NSEvent(cgEvent: c)!
        (w.web as! FilesWebView).penSay(e)
        w.web.scrollWheel(with: e)
    }
    /// A whole move of a finger: down at (x, y), along (dx, dy) in steps, lifted.
    func swipe(_ w: NoteWindow, at x: CGFloat, _ y: CGFloat, dx: Double, dy: Double, steps: Int = 8) {
        let sx = dx / Double(steps), sy = dy / Double(steps)
        scroll(w, at: x, y, dx: sx, dy: sy, phase: 1)
        wait(0.02)
        for _ in 1..<steps { scroll(w, at: x, y, dx: sx, dy: sy, phase: 2); wait(0.016) }
        scroll(w, at: x, y, dx: 0, dy: 0, phase: 4)
        wait(0.9) // (the block back in its place)
    }

    /// In All Notes a tile held by the cast's finger is chosen, and the bar of what the file menu has for it is there — no menu
    /// opens —; in the iPad's layout and in the Mac's own.
    func testAHeldFingerChoosesATile() {
        CastHost.fixed = Int64(getpid())
        write("Notizen/A.md", "# A\n\nSome text.\n")
        write("Notizen/B.md", "# B\n\nMore text.\n")
        for layout in ["off", "always"] {
            let w = openPainted(folder: Lib.join(dir, "Notizen"))
            w.window.setContentSize(NSSize(width: 1180, height: 820))
            w.on("prefs", ["prefs": ["ipadLayout": layout]])
            _ = page(w, "(MdOverview.open(), 1)")
            XCTAssertTrue(wait(5) { (self.page(w, "document.querySelectorAll('#overview[data-open] .ov-item.ov-tile').length") as? Int ?? 0) >= 2 }, "All Notes has no tiles (\(layout))")
            wait(0.6)
            let at = page(w, "(() => { const t = [...document.querySelectorAll('#overview .ov-item.ov-tile')].find((t) => /B\\.md$/.test(t.dataset.path)); const r = t.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()") as? [NSNumber] ?? []
            XCTAssertEqual(at.count, 2)
            guard at.count == 2 else { return }
            click(w, .rightMouseDown, CGFloat(at[0].doubleValue), CGFloat(at[1].doubleValue))
            click(w, .rightMouseUp, CGFloat(at[0].doubleValue), CGFloat(at[1].doubleValue))
            XCTAssertTrue(wait(3) { (self.page(w, "MdOverview.picked.map((p) => p.split('/').pop()).join()") as? String) == "B.md" }, "the held tile was not chosen (\(layout))")
            XCTAssertTrue(wait(3) { (self.page(w, "document.body.hasAttribute('data-ip-picking')") as? Bool) == true }, "no bar for the chosen tile (\(layout))")
            XCTAssertEqual(page(w, "document.getElementById('ctxmenu').hasAttribute('data-open') && !document.body.hasAttribute('data-ip-proxy')") as? Bool, false, "a menu opened (\(layout))")
            w.closeNow()
        }
    }

    /// The cast's finger swiped to the right across a block chooses it, as a finger does on an iPad; a short one or one that
    /// goes down chooses nothing, and the same swipe to the left on a chosen block lets it go.
    func testASwipeOfTheCastChoosesABlock() {
        CastHost.fixed = Int64(getpid())
        let paras = (1...24).map { "Paragraph \($0) of the note, with some words in it to swipe across." }.joined(separator: "\n\n")
        let w = openPainted(write("S.md", "# Swipe\n\n" + paras + "\n"))
        w.window.setFrameOrigin(NSPoint(x: 0, y: 80)) // (WebKit takes made-up wheels only for a window on a screen)
        _ = page(w, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true }, "the active mode did not load")
        wait(0.6)
        let picked = { (self.page(w, "MdActive.blocks.picked(MdActive.view.pm.state).map((x) => x.node.textContent.slice(0, 11)).join('|')") as? String) ?? "?" }
        let at = page(w, "(() => { const r = document.querySelectorAll('.pm p')[1].getBoundingClientRect(); return [r.left + 60, r.top + r.height / 2]; })()") as? [NSNumber] ?? []
        XCTAssertEqual(at.count, 2, "no second paragraph")
        guard at.count == 2 else { return }
        let x = CGFloat(at[0].doubleValue), y = CGFloat(at[1].doubleValue)

        swipe(w, at: x, y, dx: 24, dy: 0)
        XCTAssertEqual(picked(), "", "a short swipe chose the block")
        // up: the note follows the finger, nothing is chosen (and what it left behind ends no later swipe)
        let top = (page(w, "scrollY") as? NSNumber)?.doubleValue ?? 0
        swipe(w, at: x, y, dx: 4, dy: -120)
        XCTAssertEqual(picked(), "", "a finger going up chose the block")
        XCTAssertGreaterThan((page(w, "scrollY") as? NSNumber)?.doubleValue ?? 0, top + 40, "the note did not follow a finger going up")
        _ = page(w, "(scrollTo(0, 0), 1)")
        wait(0.3)
        swipe(w, at: x, y, dx: 110, dy: 3)
        XCTAssertEqual(picked(), "Paragraph 2", "the cast's swipe to the right did not choose the block")
        swipe(w, at: x, y, dx: -110, dy: 0)
        XCTAssertEqual(picked(), "", "a swipe to the left did not let the chosen block go")
    }

    /// At a note's size of 125 % (CSS zoom on the column), the note scrolled: the swipe chooses the block it began on, and the
    /// block's field and its handle stand on it, its field as high as it is — WebKit gives a box inside the zoom in the
    /// column's own pixels, and takes the scroll off after (Henri, 2026-11-21, two pictures: the fields at 80 % of their
    /// place, then still too high in a scrolled note). Where things are is found by what the window has at a point, not by
    /// a box.
    func testAtANotesSizeTheFieldsStandOnTheirBlocks() {
        CastHost.fixed = Int64(getpid())
        _ = AppDelegate.shared.applyPrefs(["docZoom": 125])
        let paras = (1...30).map { "Paragraph \($0) of the note, with some words in it to swipe across, and more of them, so that it takes two lines." }.joined(separator: "\n\n")
        let w = openPainted(write("Z.md", "# Email Client\n\n> [!important] Important\n> Flectar Mail\n\n" + paras + "\n"))
        w.window.setFrameOrigin(NSPoint(x: 0, y: 80))
        _ = page(w, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true }, "the active mode did not load")
        wait(0.6)
        XCTAssertEqual(page(w, "getComputedStyle(document.getElementById('active')).zoom") as? String, "1.25", "the note is not at 125 %")
        _ = page(w, "(scrollTo(0, 420), 1)")
        wait(0.4)
        XCTAssertEqual((page(w, "scrollY") as? NSNumber)?.doubleValue ?? 0, 420, accuracy: 1, "the note did not scroll")
        // (the first paragraph wholly in sight, found down the column by what the window has there; its top and bottom)
        let probe = "(() => { const ps = [...document.querySelectorAll('.pm p')], x = innerWidth * 0.42; let p = null, top = -1, bottom = -1; for (let y = 0; y < innerHeight; y += 1) { const e = document.elementFromPoint(x, y), q = e && ps.find((q) => q === e || q.contains(e)); if (!p) { if (q && y > 40) { const i = ps.indexOf(q); if (y > 0) { p = ps[i + 1]; } } continue; } if (q === p) { if (top < 0) top = y; bottom = y; } else if (top >= 0) break; } return p ? [ps.indexOf(p), x, top, bottom, p.textContent.slice(0, 12)] : null; })()"
        let found = page(w, probe) as? [Any] ?? []
        XCTAssertEqual(found.count, 5, "no paragraph wholly in sight")
        guard found.count == 5, let i = found[0] as? Int, let x = (found[1] as? NSNumber)?.doubleValue,
              let top = (found[2] as? NSNumber)?.doubleValue, let bottom = (found[3] as? NSNumber)?.doubleValue, let name = found[4] as? String else { return }
        let hits = "((x, y) => { const p = document.querySelectorAll('.pm p')[\(i)]; return document.elementsFromPoint(x, y).some((e) => e === p || p.contains(e)); })"
        swipe(w, at: CGFloat(x), CGFloat((top + bottom) / 2), dx: 110, dy: 2)
        XCTAssertEqual(page(w, "MdActive.blocks.picked(MdActive.view.pm.state).map((x) => x.node.textContent.slice(0, 12)).join('|')") as? String, name, "the swipe chose another block")
        let field = page(w, "(() => { const f = document.querySelector('.blk-fields .blk-field'); if (!f) return null; const r = f.getBoundingClientRect(); return [r.left + r.width / 2, r.top, r.bottom, r.width]; })()") as? [NSNumber] ?? []
        XCTAssertEqual(field.count, 4, "no field")
        guard field.count == 4 else { return }
        let ft = field[1].doubleValue, fb = field[2].doubleValue
        XCTAssertTrue(ft <= top + 2 && ft >= top - 20, "the field's top (\(ft)) is not at its block's (\(top))")
        XCTAssertTrue(fb >= bottom - 2 && fb <= bottom + 20, "the field's bottom (\(fb)) is not at its block's (\(bottom))")
        XCTAssertEqual(page(w, "\(hits)(\(field[0]), \((ft + fb) / 2))") as? Bool, true, "the block's field does not stand on it")
        let colW = (page(w, "(() => { let l = 1e9, r = -1e9; for (let x = 0; x < innerWidth; x += 2) if (\(hits)(x, \((top + bottom) / 2))) { l = Math.min(l, x); r = Math.max(r, x); } return r - l; })()") as? NSNumber)?.doubleValue ?? 0
        XCTAssertGreaterThan(colW, 100, "the block's width was not found")
        XCTAssertGreaterThan(field[3].doubleValue, colW - 4, "the field is narrower than its block (\(field[3]) < \(colW))")
        let hy = (page(w, "(() => { const r = document.querySelector('.blk-h').getBoundingClientRect(); return r.top + r.height / 2; })()") as? NSNumber)?.doubleValue ?? -1
        XCTAssertTrue(hy >= top - 2 && hy <= bottom + 2, "the handle (\(hy)) is not beside its block (\(top) … \(bottom))")
    }
}
