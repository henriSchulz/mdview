// Pictures of what a window shows, for looking at a design (not a check): only with MDVIEW_SNAP=<folder>, where
// the PNGs go. `MDVIEW_SNAP=/tmp/snap swift test --filter SnapshotTests`
import AppKit
import WebKit
import XCTest
@testable import MdView

final class SnapshotTests: ShellTest {
    var out: String? { ProcessInfo.processInfo.environment["MDVIEW_SNAP"] }

    func save(_ rep: NSBitmapImageRep?, _ name: String) {
        guard let out, let png = rep?.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: URL(fileURLWithPath: Lib.join(out, name + ".png")))
    }

    /// The whole content of the window: the page as WebKit draws it, and the system's start screen over it.
    func shoot(_ w: NoteWindow, _ name: String, page: Bool = true) {
        let v = w.window.contentView!
        var image: NSImage?
        var done = false
        w.web.takeSnapshot(with: nil) { i, _ in image = i; done = true }
        wait(10) { done }
        let canvas = NSImage(size: v.bounds.size)
        canvas.lockFocus()
        // (a page changed to dark in a window nobody sees is drawn again only in part: its ground then, not its picture)
        w.window.backgroundColor.setFill()
        NSRect(origin: .zero, size: v.bounds.size).fill()
        if page { image?.draw(in: w.web.frame) }
        if let h = w.startHost, let rep = h.bitmapImageRepForCachingDisplay(in: h.bounds) {
            h.cacheDisplay(in: h.bounds, to: rep)
            NSImage(cgImage: rep.cgImage!, size: h.bounds.size).draw(in: h.frame)
        }
        canvas.unlockFocus()
        save(NSBitmapImageRep(data: canvas.tiffRepresentation!), name)
    }

    func testStartScreen() throws {
        try XCTSkipIf(out == nil, "only with MDVIEW_SNAP")
        // (folders that are there on any Mac, for Finder's icons for them)
        Store.shared.state["recents"] = ["Documents", "Desktop", "Downloads", "Pictures"].map { Lib.join(Lib.home(), $0) }
        let looks: [(String, NSAppearance.Name, NSSize, String)] = [
            ("light", .aqua, NSSize(width: 980, height: 720), "en"), ("dark", .darkAqua, NSSize(width: 980, height: 720), "en"),
            ("small", .aqua, NSSize(width: 520, height: 400), "de"), ("low", .aqua, NSSize(width: 900, height: 560), "de")]
        for (look, appearance, size, lang) in looks {
            NSApp.appearance = NSAppearance(named: appearance)
            Store.shared.state["active"] = ["lang": lang]
            let w = open()
            if appearance == .darkAqua { w.applyTheme(Theme(mode: "dark", colors: Theme.dark, variant: nil)) }
            w.window.setContentSize(size)
            wait(10) { (self.page(w, "!!document.querySelector('#content .start-state')") as? Bool) == true }
            wait(appearance == .darkAqua ? 2 : 0.5)
            shoot(w, "start-" + look, page: appearance != .darkAqua)
            w.closeNow()
        }
        Store.shared.state["active"] = nil
        NSApp.appearance = nil
    }
}
