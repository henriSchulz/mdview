// The sidebar's card is the system's in the Library layout (NativeSidebar.swift): it holds what the page's card holds, and
// what is done on it is done by the page's.
import AppKit
import WebKit
import XCTest
@testable import MdView

final class SidebarNativeTests: ShellTest {
    func folderWindow() -> NoteWindow {
        write("Notizen/A.md", "# A\n\n- [ ] a task\n")
        write("Notizen/B.md", "# B\n")
        write("Plans/Plan.md", "# Plan\n")
        let w = openPainted(folder: dir)
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        XCTAssertTrue(wait(5) { (w.sidebarCard?.rows.count ?? 0) >= 9 }, "the card's rows did not come (\(w.sidebarCard?.rows.count ?? 0))")
        return w
    }
    func labels(_ w: NoteWindow) -> [String] { w.sidebarCard!.rows.map { $0["label"] as? String ?? "" } }
    func index(_ w: NoteWindow, _ label: String) -> Int { labels(w).firstIndex(of: label) ?? -1 }
    func click(_ w: NoteWindow, _ label: String) {
        let i = index(w, label)
        XCTAssertGreaterThanOrEqual(i, 0, "no row \(label)")
        w.sidebarCard!.activate(i)
    }

    /// The card holds the Library's rows with their counts, the folders' heading and the folders — the page's own unseen.
    func testTheCardHoldsThePagesRows() {
        let w = folderWindow()
        XCTAssertEqual(Array(labels(w).prefix(6)), ["All Notes", "Recents", "Today", "With Tasks", "Shared", "Whiteboards"])
        XCTAssertTrue(labels(w).contains("Folders"))
        XCTAssertEqual(labels(w).suffix(2), ["Notizen", "Plans"])
        XCTAssertEqual(w.sidebarCard!.rows[0]["n"] as? String, "3")
        // (the open tasks are counted from the notes' beginnings, which come later: the card follows)
        XCTAssertTrue(wait(5) { w.sidebarCard!.rows[3]["n"] as? String == "1" }, "With Tasks: \(w.sidebarCard!.rows[3])")
        XCTAssertFalse(w.sidebarCard!.card.isHidden)
        XCTAssertEqual(page(w, "document.documentElement.hasAttribute('data-mac-sb')") as? Bool, true)
        XCTAssertEqual(page(w, "getComputedStyle(document.querySelector('#sidebar .sb-lib')).visibility") as? String, "hidden", "the page's card shows too")
    }

    /// A row clicked is the page's row clicked: All Notes, a folder in All Notes — and the row shown is the card's chosen one.
    func testARowClickedIsThePages() {
        let w = folderWindow()
        click(w, "Plans")
        XCTAssertTrue(wait(5) { (self.page(w, "JSON.stringify(MdOverview.where())") as? String)?.contains("Plans") == true }, "the folder is not shown")
        XCTAssertTrue(wait(5) { w.sidebarCard!.table.selectedRow == self.index(w, "Plans") })
        click(w, "All Notes")
        XCTAssertTrue(wait(5) { (self.page(w, "JSON.stringify(MdOverview.where())") as? String)?.contains("\"at\":[]") == true })
    }

    /// What is typed in the card's search is the page's search: its rows are what is found.
    func testTheSearchIsThePages() {
        let w = folderWindow()
        let card = w.sidebarCard!
        let field = card.search
        field.stringValue = "Plan"
        _ = field.target?.perform(field.action, with: field)
        XCTAssertTrue(wait(5) { self.labels(w).contains("Plan") && !self.labels(w).contains("Notizen") }, "found: \(labels(w))")
        XCTAssertEqual(page(w, "document.querySelector('#sidebar .qn-search').value") as? String, "Plan")
    }

    /// Shut, the card glides out with the page's and is gone; pinned again, it is back at the window's left.
    func testTheCardGoesAndComesWithThePages() {
        let w = folderWindow()
        let card = w.sidebarCard!.card
        _ = page(w, "(MdPage.showSidebar(false, true), 1)")
        XCTAssertTrue(wait(3) { card.isHidden }, "the card stays")
        _ = page(w, "(MdPage.showSidebar(true, true), 1)")
        XCTAssertTrue(wait(3) { !card.isHidden && abs(card.frame.minX - 8) < 0.5 }, "the card is not back (\(card.frame))")
    }

    /// A right click on a row is the page's menu for it, shown as the system's.
    func testARightClickIsThePagesMenu() {
        let w = folderWindow()
        var shown: [String] = []
        let t = Timer(timeInterval: 0.05, repeats: true) { t in
            guard let m = NativeMenu.shown else { return }
            shown = m.items.map(\.title)
            m.cancelTracking()
            t.invalidate()
        }
        RunLoop.main.add(t, forMode: .common)
        let table = w.sidebarCard!.table
        let e = NSEvent.mouseEvent(with: .rightMouseDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: w.window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
        table.rightClick?(index(w, "Plans"), e)
        XCTAssertTrue(wait(5) { shown.contains("Rename") }, "no menu for the folder: \(shown)")
        t.invalidate()
    }

    /// In another layout the card is the page's own, as before.
    func testAnotherLayoutKeepsThePagesCard() {
        let w = folderWindow()
        w.on("prefs", ["prefs": ["sidebarLayout": "source"]])
        XCTAssertTrue(wait(5) { w.sidebarCard!.card.isHidden }, "the system's card stays in the tree layout")
        XCTAssertTrue(wait(3) { (self.page(w, "document.documentElement.hasAttribute('data-mac-sb')") as? Bool) == false })
        w.on("prefs", ["prefs": ["sidebarLayout": "library"]])
        XCTAssertTrue(wait(5) { !w.sidebarCard!.card.isHidden })
    }

    /// A card peeking out stays while the pointer is on it — the page, which no longer sees the pointer, is told where it is.
    func testAPeekingCardStaysUnderThePointer() {
        let w = folderWindow()
        let sb = w.sidebarCard!
        _ = page(w, "(MdPage.showSidebar(false, false), 1)")
        XCTAssertTrue(wait(3) { sb.card.isHidden })
        _ = page(w, "(document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 2, clientY: 300, bubbles: true })), 1)")
        XCTAssertTrue(wait(3) { sb.stand == "peek" && !sb.card.isHidden }, "it did not peek out")
        wait(0.6)
        // the pointer goes onto the system's card: the page hears it leave the document, then the card says where it is
        _ = page(w, "(document.documentElement.dispatchEvent(new MouseEvent('mouseleave')), 1)")
        let inside = sb.card.convert(NSPoint(x: 100, y: sb.card.bounds.midY), to: nil)
        sb.card.moved?(inside)
        wait(0.8)
        XCTAssertEqual(sb.stand, "peek", "the card went from under the pointer")
        XCTAssertEqual(page(w, "document.body.dataset.sidebar") as? String, "peek")
    }
}
