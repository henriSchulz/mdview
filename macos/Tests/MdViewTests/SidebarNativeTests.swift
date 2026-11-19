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

    /// In full screen the window's bar is a window of its own over the page, with a ground of its own: the card begins under
    /// it, its top and its round corners in sight (Henri, 2026-11-19: „überlappung bug“ — the bar lay over the card's top).
    /// Out of full screen it runs up behind the window's buttons, as the system's sidebars do. (Full screen itself is not
    /// entered here: it would take a Space of his screen — the window is told it is.)
    func testInFullScreenTheCardBeginsUnderTheBar() {
        let w = folderWindow()
        let sb = w.sidebarCard!, ground = w.window.contentView!
        let bar = ground.bounds.height - w.window.contentLayoutRect.maxY
        XCTAssertGreaterThan(bar, 20, "the window has no bar to lie under")
        XCTAssertEqual(sb.card.frame.maxY, ground.bounds.height - 8, accuracy: 0.5, "out of full screen the card runs up behind the buttons")
        sb.fullScreenNow = { true }
        sb.relayout()
        XCTAssertEqual(sb.card.frame.maxY, w.window.contentLayoutRect.maxY - 8, accuracy: 0.5, "in full screen the bar lies over the card's top")
        sb.card.layoutSubtreeIfNeeded()
        let search = sb.search.convert(sb.search.bounds, to: sb.card)
        XCTAssertLessThan(sb.card.bounds.height - search.maxY, 20, "the search stands as far down as under a see-through bar")
        sb.fullScreenNow = { false }
        sb.relayout()
        XCTAssertEqual(sb.card.frame.maxY, ground.bounds.height - 8, accuracy: 0.5)
    }

    /// The folders' heading begins where the rows' signs begin — not at the card's very edge, where it lay on the card's rim
    /// (a group row is drawn the table's whole width, without the rows' indent).
    func testTheFoldersHeadingStandsInLineWithTheRows() {
        let w = folderWindow()
        let t = w.sidebarCard!.table
        t.layoutSubtreeIfNeeded()
        let cap = index(w, "Folders"), first = 0
        guard let capView = t.view(atColumn: 0, row: cap, makeIfNecessary: true),
              let rowView = t.view(atColumn: 0, row: first, makeIfNecessary: true) as? NSTableCellView, let sign = rowView.imageView else { return XCTFail("no views") }
        capView.layoutSubtreeIfNeeded(); rowView.layoutSubtreeIfNeeded()
        let text = (capView as? NSTableCellView)?.textField ?? capView
        let capX = text.convert(text.bounds, to: t).minX, signX = sign.convert(sign.bounds, to: t).minX
        XCTAssertEqual(capX, signX, accuracy: 2, "the heading at \(capX), the signs at \(signX)")
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

    /// A folder's row clicked while a note is shown: All Notes opens in that folder, and that folder is the marked row — not
    /// the note's (All Notes said where it stood while it was being built, before it was open: 2026-11-18).
    func testAFolderChosenFromANoteIsTheMarkedRow() {
        let w = folderWindow()
        let note = Lib.join(dir, "Notizen/A.md")
        w.on("note", ["path": note])
        XCTAssertTrue(wait(10) { (self.page(w, "!!(MdPage.current && MdPage.current.path === \(jsonString(note)) && !(window.MdOverview && MdOverview.isOpen))") as? Bool) == true })
        _ = page(w, "(MdPage.showSidebar(true, false), 1)")
        XCTAssertTrue(wait(5) { w.sidebarCard!.table.selectedRow == self.index(w, "Notizen") }, "the note's folder is not marked to begin with")
        click(w, "Plans")
        XCTAssertTrue(wait(5) { (self.page(w, "JSON.stringify(MdOverview.where())") as? String)?.contains("Plans") == true }, "the folder is not shown")
        XCTAssertTrue(wait(5) { w.sidebarCard!.table.selectedRow == self.index(w, "Plans") }, "the marked row: \(w.sidebarCard!.table.selectedRow)")
        XCTAssertEqual(page(w, "[...document.querySelectorAll('#sidebar .sb-list .sb-row.on')].map((e) => e.querySelector('.sb-label').textContent.trim()).join()") as? String, "Plans")
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
