// The panel's Style part (active/panel.js): its "Page width" menu under the Mac's mouse and the cast's finger, and what the
// choice does to the note (Henri, 2026-11-20: the button stood out of its row on the iPad's screen, and the width "wirkt nicht").
import AppKit
import XCTest
@testable import MdView

final class PanelStyleTests: ShellTest {
    override func tearDown() {
        CastHost.fixed = nil
        super.tearDown()
    }

    /// An event as the cast posts it (from its process) or as the Mac's own mouse makes it, at a point of the web view. (An
    /// event of no window has its place on the screen for its place in the window: that place is given.)
    func tap(_ w: NoteWindow, _ x: CGFloat, _ y: CGFloat, cast: Bool) {
        let web = w.web, top = NSScreen.screens[0].frame.maxY
        let at = web.convert(NSPoint(x: x, y: web.isFlipped ? y : web.bounds.height - y), to: nil)
        for type in [CGEventType.leftMouseDown, .leftMouseUp] {
            let c = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: CGPoint(x: at.x, y: top - at.y), mouseButton: .left)!
            c.setIntegerValueField(.eventSourceUnixProcessID, value: cast ? Int64(getpid()) : 0)
            let e = NSEvent(cgEvent: c)!
            (web as! FilesWebView).penSay(e)
            if type == .leftMouseDown { web.mouseDown(with: e) } else { web.mouseUp(with: e) }
        }
    }
    func middle(_ w: NoteWindow, _ sel: String) -> (CGFloat, CGFloat)? {
        let r = page(w, "(() => { const e = document.querySelector('\(sel)'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()") as? [NSNumber]
        guard let r, r.count == 2 else { return nil }
        return (CGFloat(r[0].doubleValue), CGFloat(r[1].doubleValue))
    }
    func text(_ f: String) -> String { (try? String(contentsOfFile: f, encoding: .utf8)) ?? "" }

    /// On the Mac's screen with its mouse and on the iPad's under a finger: the width's button stands in its row (a finger's
    /// control is 40 px there), opens its menu, and what is chosen in it is the note's width.
    func testTheWidthsMenuUnderTheMouseAndAFinger() {
        let shows = CastHost.shows
        defer { CastHost.shows = shows }
        for cast in [false, true] {
            CastHost.fixed = cast ? Int64(getpid()) : nil
            CastHost.shows = { _ in cast }
            let f = write("W\(cast).md", "# Width\n\nSome text.\n")
            let w = openPainted(f)
            _ = page(w, "MdView.setMode('active'), true")
            XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true })
            XCTAssertEqual(page(w, "document.documentElement.hasAttribute('data-touch')") as? Bool, cast)
            _ = page(w, "(MdActive.panel.show(true), MdActive.panel.setTab('style'), 1)") // (open or not as the window before left it)
            XCTAssertTrue(wait(3) { (self.page(w, "document.body.hasAttribute('data-panel') && document.getElementById('rpanel').dataset.tab") as? String) == "style" })
            wait(0.6) // (the panel comes in)
            let g = (page(w, "(() => { const l = document.querySelector('#rpanel .rp-pane[data-pane=style] .rp-line'), a = l.getBoundingClientRect(), b = l.querySelector('.pop').getBoundingClientRect(); return [a.top, a.bottom, b.top, b.bottom, b.right, a.right]; })()") as? [NSNumber])?.map { $0.doubleValue } ?? []
            XCTAssertEqual(g.count, 6)
            if g.count == 6 { XCTAssertTrue(g[2] >= g[0] && g[3] <= g[1] && g[4] <= g[5], "the width's button stands out of its row (finger \(cast)): \(g)") }
            guard let pop = middle(w, "#rpanel .rp-pane[data-pane=style] .pop") else { return XCTFail("no button for the width") }
            tap(w, pop.0, pop.1, cast: cast)
            XCTAssertTrue(wait(3) { (self.page(w, "!!document.querySelector('#pickmenu[data-open]')") as? Bool) == true }, "the width's menu did not open (finger \(cast))")
            guard let wide = middle(w, "#pickmenu .menu-item[data-v=\"wide\"]") else { return XCTFail("no Wide in the menu") }
            tap(w, wide.0, wide.1, cast: cast)
            XCTAssertTrue(wait(3) { self.text(f).hasPrefix("---\nwidth: wide\n---\n") }, "the note does not say width: wide (finger \(cast)): \(text(f).debugDescription)")
            XCTAssertTrue(wait(3) { (self.page(w, "document.documentElement.style.getPropertyValue('--measure')") as? String)?.contains("66%") == true }, "the column is not wide")
            w.window.close()
        }
    }

    /// A note that begins with blank lines: in the active mode the properties the panel makes stand on its first line — where
    /// they are properties —, so the width is the note's at once and when it is opened again, and the next choice changes
    /// them instead of making another block under them. (A comment before the first block goes below them.)
    func testPropertiesStandOnTheFirstLine() {
        let f = write("Lead.md", "\n\n# Laplace\n\nSome text.\n")
        let w = open(f)
        _ = page(w, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true })
        let set = { (v: String) in _ = self.page(w, "(() => { const s = document.querySelector('#rpanel .rp-width'); s.value = '\(v)'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()") }
        set("wide")
        XCTAssertTrue(wait(3) { self.text(f) == "---\nwidth: wide\n---\n\n# Laplace\n\nSome text.\n" }, "the properties are not on the first line: \(text(f).debugDescription)")
        XCTAssertTrue(wait(3) { (self.page(w, "document.documentElement.style.getPropertyValue('--measure')") as? String)?.contains("66%") == true }, "the column is not wide")
        w.window.close()
        let v = open(f)
        _ = page(v, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(v, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true })
        XCTAssertTrue(wait(3) { (self.page(v, "document.documentElement.style.getPropertyValue('--measure')") as? String)?.contains("66%") == true }, "opened again, the column is not wide")
        _ = page(v, "(() => { const s = document.querySelector('#rpanel .rp-width'); s.value = 'narrow'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()")
        XCTAssertTrue(wait(3) { self.text(f) == "---\nwidth: narrow\n---\n\n# Laplace\n\nSome text.\n" }, "a second block of properties: \(text(f).debugDescription)")
        v.window.close()

        let c = write("Comment.md", "\n%% a note to myself %%\n\n# A\n")
        let u = open(c)
        _ = page(u, "MdView.setMode('active'), true")
        XCTAssertTrue(wait(10) { (self.page(u, "!!(window.MdActive && MdActive.view && MdActive.view.pm)") as? Bool) == true })
        _ = page(u, "(() => { const s = document.querySelector('#rpanel .rp-width'); s.value = 'full'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()")
        XCTAssertTrue(wait(3) { self.text(c) == "---\nwidth: full\n---\n\n%% a note to myself %%\n\n# A\n" }, "the comment before the first block: \(text(c).debugDescription)")
    }
}
