// Drags over a window (FilesWebView, FilesWeb.swift): the page's own (blocks moved, rows of the sidebar) and files from Finder.
import AppKit
import XCTest
@testable import MdView

/// What AppKit tells a view about a drag over it — as little as a drag that ends there has.
final class EndedDrag: NSObject, NSDraggingInfo {
    let pasteboard = NSPasteboard(name: NSPasteboard.Name("mdview-test-drag-\(UUID().uuidString)"))
    var draggingDestinationWindow: NSWindow? { nil }
    var draggingSourceOperationMask: NSDragOperation { .move }
    var draggingLocation: NSPoint { NSPoint(x: 40, y: 40) }
    var draggedImageLocation: NSPoint { NSPoint(x: 40, y: 40) }
    var draggedImage: NSImage? { nil }
    var draggingPasteboard: NSPasteboard { pasteboard }
    var draggingSource: Any? { nil }
    var draggingSequenceNumber: Int { 1 }
    func slideDraggedImage(to screenPoint: NSPoint) {}
    var draggingFormation: NSDraggingFormation = .default
    var animatesToDestination = false
    var numberOfValidItemsForDrop = 0
    func enumerateDraggingItems(options enumOpts: NSDraggingItemEnumerationOptions = [], for view: NSView?, classes classArray: [AnyClass],
                                searchOptions: [NSPasteboard.ReadingOptionKey: Any] = [:],
                                using block: (NSDraggingItem, Int, UnsafeMutablePointer<ObjCBool>) -> Void) {}
    var springLoadingHighlight: NSSpringLoadingHighlight { .none }
    func resetSpringLoading() {}
}

final class DragTests: ShellTest {
    /// Henri, 2026-11-17: "wenn man blöcke verschiebt crasht die app". Moving a block is a drag of the page's own; when it
    /// ends, AppKit tells the view (draggingEnded:) — and FilesWebView handed that on to WKWebView, which has no such
    /// method: an exception, and the app was gone. (A file dropped from Finder ended the same way.)
    func testADragThatEndsOverTheWindowDoesNotTakeTheAppWithIt() {
        let w = open(write("Note.md", "# Note\n\nOne block.\n\nAnother.\n"))
        let drag = EndedDrag()
        w.web.draggingExited(drag)
        w.web.draggingEnded(drag)
        XCTAssertEqual(page(w, "1 + 1") as? Int, 2, "the page is gone after the drag")
    }
}
