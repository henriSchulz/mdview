// What the tests of the shell stand on: windows that are there but never seen (MDVIEW_HEADLESS), the page of this
// checkout (MDVIEW_ROOT), a state of their own (MDVIEW_STATE_DIR — never the user's), no keyring, a folder of
// their own per test. A test drives a NoteWindow as the page would (`on`), asks the page what it shows (`page`),
// and lets the main run loop turn while it waits (`wait`).
import AppKit
import WebKit
import XCTest
@testable import MdView

class ShellTest: XCTestCase {
    /// The checkout: macos/Tests/MdViewTests/Harness.swift, four folders up.
    static let checkout = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().path

    override class func setUp() {
        super.setUp()
        let state = NSTemporaryDirectory() + "mdview-tests-state-\(getpid())"
        try? FileManager.default.createDirectory(atPath: state, withIntermediateDirectories: true)
        setenv("MDVIEW_ROOT", checkout, 1)
        setenv("MDVIEW_HEADLESS", "1", 1)
        setenv("MDVIEW_STATE_DIR", state, 1)
        setenv("MDVIEW_NO_KEYRING", "1", 1)
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        AppDelegate.shared = AppDelegate() // (the app's list of windows: what the shell asks of the others)
    }

    /// This test's own folder (its real path: /private/var/…, as the shell resolves it).
    var dir = ""
    var windows: [NoteWindow] = []

    override func setUp() {
        super.setUp()
        let d = NSTemporaryDirectory() + "mdview-test-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: d, withIntermediateDirectories: true)
        dir = Lib.resolve(d)
    }

    override func tearDown() {
        for w in windows where w.window.isVisible { w.closeNow() }
        windows.removeAll()
        wait(0.1)
        try? FileManager.default.removeItem(atPath: dir)
        super.tearDown()
    }

    /// A file of this test's folder, written; its path.
    @discardableResult func write(_ rel: String, _ text: String) -> String {
        let p = Lib.join(dir, rel)
        try? FileManager.default.createDirectory(atPath: Lib.dir(p), withIntermediateDirectories: true)
        try? Data(text.utf8).write(to: URL(fileURLWithPath: p))
        return p
    }

    func read(_ p: String) -> String { (try? String(contentsOfFile: p, encoding: .utf8)) ?? "" }

    /// Lets the main run loop turn for a while — or until `done` holds; whether it did.
    @discardableResult func wait(_ seconds: Double, until done: (() -> Bool)? = nil) -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if let done, done() { return true }
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        return done?() ?? true
    }

    /// A window for a note or a folder, its page up and the note drawn.
    func open(_ path: String? = nil, folder: String? = nil, file: StaticString = #filePath, line: UInt = #line) -> NoteWindow {
        let w = NoteWindow(path: path, folder: folder)
        windows.append(w)
        AppDelegate.shared.windows.append(w)
        w.onClose = { w in AppDelegate.shared.windows.removeAll { $0 === w } }
        XCTAssertTrue(wait(15) { w.ready }, "the page did not come up", file: file, line: line)
        if path != nil {
            XCTAssertTrue(wait(10) { (self.page(w, "!!(window.MdPage && MdPage.current)") as? Bool) == true }, "the note was not drawn", file: file, line: line)
        }
        return w
    }

    /// What a script says in the window's page (a promise is waited for).
    func page(_ w: NoteWindow, _ script: String) -> Any? {
        var result: Any?
        var done = false
        w.web.callAsyncJavaScript("return (\(script))", arguments: [:], in: nil, in: .page) { r in
            if case .success(let v) = r { result = v }
            done = true
        }
        wait(10) { done }
        return result
    }
}

final class HarnessTests: ShellTest {
    /// The ground of all the others: a note opened in a window nobody sees is drawn by the page.
    func testANoteIsDrawn() {
        let note = write("Note.md", "# Hello\n\nSome text.\n")
        let w = open(note)
        XCTAssertEqual(page(w, "document.querySelector('#content h1')?.textContent") as? String, "Hello")
        XCTAssertFalse(w.window.isKeyWindow)
    }
}
