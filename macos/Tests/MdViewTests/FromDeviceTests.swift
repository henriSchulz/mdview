// From the iPhone or iPad (FromDevice.swift): what the system hands over — a photo, a scan — goes into the note on screen,
// or, in All Notes, into the folder shown (Henri, 2026-11-19).
import AppKit
import XCTest
@testable import MdView

final class FromDeviceTests: ShellTest {
    func pasteboard(_ fill: (NSPasteboard) -> Void) -> NSPasteboard {
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
        // (built for this look alone and taken away again: its rows hold this test's app, which is gone after it)
        let built = NSApp.mainMenu == nil
        if built { AppDelegate.shared.buildMenu() }
        defer { if built { NSApp.mainMenu = nil } }
        let menu = NSApp.mainMenu?.items.compactMap(\.submenu).flatMap(\.items).first { $0.identifier == NSMenuItem.importFromDeviceIdentifier }
        XCTAssertNotNil(menu, "no Import from iPhone or iPad in the menu bar")
    }

    func testAPhotoGoesIntoTheNoteThatIsRead() {
        let note = write("N.md", "# N\n\nText.\n")
        let w = open(note)
        _ = page(w, "(MdPage.setMode('read'), 1)")
        XCTAssertTrue(w.takeFromDevice(pasteboard { $0.setData(self.jpeg, forType: NSPasteboard.PasteboardType("public.jpeg")) }))
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
        XCTAssertTrue(w.takeFromDevice(pasteboard { $0.setData(self.pdf, forType: .pdf) }))
        XCTAssertTrue(wait(5) { ((try? Lib.fm.contentsOfDirectory(atPath: self.dir)) ?? []).contains { $0.hasPrefix("Scan ") && $0.hasSuffix(".pdf") } },
                      "no scan in the folder: \((try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? [])")
        let name = ((try? Lib.fm.contentsOfDirectory(atPath: dir)) ?? []).first { $0.hasPrefix("Scan ") } ?? ""
        XCTAssertEqual(Lib.fm.contents(atPath: Lib.join(dir, name)), pdf)
    }

    /// With a whiteboard open the photo goes onto the board, kept beside it — and whatever kind of picture comes is read
    /// (Henri, 2026-11-19: on a board the system said "The operation couldn't be completed. (Cocoa error 66563.)").
    func testAPhotoGoesOntoTheOpenWhiteboard() {
        let sample = Lib.join(ShellTest.checkout, "web/public/welcome/samples/Empty.board.svg")
        let board = write("assets/B.board.svg", read(sample))
        let w = open(write("B.md", "# Board\n\n![](assets/B.board.svg)\n"))
        page(w, "(MdPage.openBoardFile(\(jsonString(board))), 1)")
        XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdBoard && MdBoard.state && MdBoard.state() && document.querySelector('#board[data-ready]'))") as? Bool) == true }, "the board did not open")
        XCTAssertTrue(wait(5) { w.boardOpen })
        let pictures = "document.querySelectorAll('#board image, #board img').length"
        let before = (page(w, pictures) as? Int) ?? -1
        // (a TIFF, as a camera hands a picture over: read all the same)
        let tiff = NSBitmapImageRep(data: jpeg)!.tiffRepresentation!
        XCTAssertTrue(w.takeFromDevice(pasteboard { $0.setData(tiff, forType: .tiff) }), "a TIFF is not taken")
        XCTAssertTrue(wait(8) { ((self.page(w, pictures) as? Int) ?? -1) == before + 1 }, "nothing came onto the board")
        let kept = ((try? Lib.fm.contentsOfDirectory(atPath: Lib.join(dir, "assets"))) ?? []).filter { $0.hasPrefix("Photo ") }
        XCTAssertEqual(kept.count, 1, "beside the board: \(kept)")
        XCTAssertEqual(read(Lib.join(dir, "B.md")), "# Board\n\n![](assets/B.board.svg)\n", "the note was written to")
    }

    func testWhatIsNoPictureIsNotTaken() {
        let w = open(write("N.md", "# N\n"))
        XCTAssertFalse(w.takeFromDevice(pasteboard { $0.setString("just text", forType: .string) }))
        XCTAssertEqual(read(Lib.join(dir, "N.md")), "# N\n")
    }
}
