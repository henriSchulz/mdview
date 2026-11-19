// From the iPhone or iPad (FromDevice.swift): what the system hands over — a photo, a scan — goes into the note on screen,
// or, in All Notes, into the folder shown (Henri, 2026-11-19).
import AppKit
import XCTest
@testable import MdView

final class FromDeviceTests: ShellTest {
    func board(_ fill: (NSPasteboard) -> Void) -> NSPasteboard {
        let pb = NSPasteboard(name: NSPasteboard.Name("mdview-test-\(UUID().uuidString)"))
        pb.clearContents()
        fill(pb)
        return pb
    }
    var jpeg: Data {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 8, pixelsHigh: 8, bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false, isPlanar: false,
                                   colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        return rep.representation(using: .jpeg, properties: [:])!
    }
    let pdf = Data("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n".utf8)

    func testTheWebViewTakesPicturesAndPDFsWhereThereIsANote() {
        let w = open(write("N.md", "# N\n"))
        XCTAssertNotNil(w.web.validRequestor(forSendType: nil, returnType: .pdf), "a scan is not taken")
        XCTAssertNotNil(w.web.validRequestor(forSendType: nil, returnType: NSPasteboard.PasteboardType("public.jpeg")), "a photo is not taken")
        XCTAssertTrue(w.web.validRequestor(forSendType: nil, returnType: .pdf) as AnyObject? === w.web)
        if NSApp.mainMenu == nil { AppDelegate.shared.buildMenu() }
        let menu = NSApp.mainMenu?.items.compactMap(\.submenu).flatMap(\.items).first { $0.identifier == NSMenuItem.importFromDeviceIdentifier }
        XCTAssertNotNil(menu, "no Import from iPhone or iPad in the menu bar")
    }

    func testAPhotoGoesIntoTheNoteThatIsRead() {
        let note = write("N.md", "# N\n\nText.\n")
        let w = open(note)
        _ = page(w, "(MdPage.setMode('read'), 1)")
        XCTAssertTrue(w.takeFromDevice(board { $0.setData(self.jpeg, forType: NSPasteboard.PasteboardType("public.jpeg")) }))
        XCTAssertTrue(wait(5) { self.read(note).contains("![](assets/Photo%20") }, "the note: \(read(note))")
        XCTAssertTrue(read(note).hasPrefix("# N\n\nText.\n\n![](assets/Photo%20"), "not at the note's end: \(read(note))")
        let kept = (try? Lib.fm.subpathsOfDirectory(atPath: dir))?.filter { $0.hasSuffix(".jpg") } ?? []
        XCTAssertEqual(kept.count, 1, "the photo's file: \(kept)")
    }

    func testAScanIsAFileOfTheFolderInAllNotes() {
        write("Uni/A.md", "# A\n")
        let w = open(folder: dir)
        XCTAssertNotNil(w.web.validRequestor(forSendType: nil, returnType: .pdf))
        // (the folder All Notes shows, as the page says it)
        XCTAssertEqual(w.shownFolder("{\"scope\":\"folders\",\"at\":[\"Uni\"]}"), Lib.join(dir, "Uni"))
        XCTAssertEqual(w.shownFolder("{\"scope\":\"folders\",\"at\":[\"..\"]}"), dir)
        XCTAssertEqual(w.shownFolder(""), dir)
        XCTAssertTrue(w.takeFromDevice(board { $0.setData(self.pdf, forType: .pdf) }))
        XCTAssertTrue(wait(5) { ((try? Lib.fm.contentsOfDirectory(atPath: self.dir)) ?? []).contains { $0.hasPrefix("Scan ") && $0.hasSuffix(".pdf") } },
                      "no scan in the folder: \((try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? [])")
        let name = ((try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? []).first { $0.hasPrefix("Scan ") } ?? ""
        XCTAssertEqual(Lib.fm.contents(atPath: Lib.join(dir, name)), pdf)
    }
}
