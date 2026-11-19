// The web view that takes files dropped from Finder (their addresses go to the page as text/uri-list, as the
// Tauri shell's window does it), and the clipboard (area A) — host.rs.
import AppKit
import WebKit

final class FilesWebView: WKWebView {
    /// WebKit hands the page the files of a drop without their addresses; the page works with addresses
    /// (viewer/sidebar.js, overview.js, active/clip.js read "text/uri-list"). The shell reads them from the drag's
    /// pasteboard and lends them to getData. (The page also takes the desktop for what it is — base.js DESKTOP — by
    /// `__TAURI_INTERNALS__`.)
    static let script = """
    window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
    (function () {
      const get = DataTransfer.prototype.getData;
      DataTransfer.prototype.getData = function (type) {
        const r = get.call(this, type);
        if (!r && /^text\\/uri-list$/i.test(type) && window.__mdDropURIs && window.__mdDropURIs.length) return window.__mdDropURIs.join("\\r\\n");
        return r;
      };
      // what the shell says of the pointer just before WebKit hands it on (FilesWebView.penSay; board/pointer.js, told)
      window.__mdPen = function (k, x, y, p, tx, ty) {
        const a = window.__mdPenSaid || (window.__mdPenSaid = []);
        a.push({ k: k, x: x, y: y, p: p, tx: tx * 90, ty: ty * 90, t: performance.now() });
        if (a.length > 48) a.splice(0, a.length - 48);
      };
      const types = Object.getOwnPropertyDescriptor(DataTransfer.prototype, "types");
      if (types) Object.defineProperty(DataTransfer.prototype, "types", { configurable: true, get() {
        const t = types.get.call(this);
        return window.__mdDropURIs && window.__mdDropURIs.length && !t.includes("text/uri-list") ? [...t, "text/uri-list"] : t;
      } });
    })();
    """

    /// The web view's own menu is never shown: every menu here is the app's (the page's, as the system's — NativeMenu.swift),
    /// and where the page did not take a secondary click — inside an HTML block's frame, whose document it cannot listen
    /// in — WebKit's came, "Open Frame in New Window" and "Inspect Element" (Henri, 2026-11-19: "was ist das für ein menu …
    /// inspect soll es nicht geben"). Emptied, nothing opens. The app's own menu opens over the web view too, and is left
    /// as it is (NativeMenu.shown).
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        if menu === NativeMenu.shown { return super.willOpenMenu(menu, with: event) }
        menu.removeAllItems()
        menu.cancelTrackingWithoutAnimation()
    }

    // From the iPhone or iPad (FromDevice.swift): the system asks the first responder whether it takes a picture or a PDF —
    // yes, where the window has a note or a folder to put it —, and hands it over here.
    override func validRequestor(forSendType sendType: NSPasteboard.PasteboardType?, returnType: NSPasteboard.PasteboardType?) -> Any? {
        if sendType == nil, FromDevice.takes(returnType), (window?.delegate as? NoteWindow)?.takesFromDevice == true { return self }
        return super.validRequestor(forSendType: sendType, returnType: returnType)
    }
    /// (Named as the system calls it — readSelectionFromPasteboard: —, said outright: written as a method of this class
    /// alone, Swift called it readSelectionFrom:, the system reached WebKit's own instead, and that one takes nothing:
    /// "The operation couldn't be completed. (Cocoa error 66563.)", Henri, 2026-11-19, twice.)
    @objc(readSelectionFromPasteboard:) func readSelection(from pboard: NSPasteboard) -> Bool {
        (window?.delegate as? NoteWindow)?.takeFromDevice(pboard) ?? false
    }

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        configuration.userContentController.addUserScript(WKUserScript(source: FilesWebView.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        super.init(frame: frame, configuration: configuration)
    }
    required init?(coder: NSCoder) { fatalError() }

    // MARK: the Pencil and the fingers of an iPad that is the Mac's screen

    /// ipad-cast hands an iPad's Pencil on as the system's tablet events (mouse events of the tablet-point kind, with the
    /// pen's pressure and tilt in their tablet fields) and a finger's tap, or its drag after it rested, as a mouse's. WebKit
    /// on the Mac makes a mouse of all of it — pointerType "mouse", pressure 0, no tilt (measured 2026-11-19) — so a whiteboard
    /// had no pressure under the Pencil, and could not tell a pen from a finger (Henri, 2026-11-19: Whiteboard und Notizbuch
    /// "so gut wie es nur geht auf den Apple Pencil und den Cast optimieren"). Each such event is said to the page first —
    /// what it is, where, how hard, how tilted — and the board takes the "mouse" there as what it is (board/pointer.js: told).
    /// A mouse's or a trackpad's own events are not said: they are what WebKit says they are.
    override func mouseDown(with event: NSEvent) { penSay(event); super.mouseDown(with: event) }
    override func mouseDragged(with event: NSEvent) { penSay(event); super.mouseDragged(with: event) }
    override func mouseUp(with event: NSEvent) { penSay(event); super.mouseUp(with: event) }
    override func mouseMoved(with event: NSEvent) { penSay(event); super.mouseMoved(with: event) }
    /// The pen gone from over the glass (ipad-cast says it as the system's tablet proximity): the tip the board shows where it
    /// would come down goes too — WebKit hands no proximity on.
    override func tabletProximity(with event: NSEvent) {
        if !event.isEnteringProximity { evaluateJavaScript("window.dispatchEvent(new Event('mdpenout'))", completionHandler: nil) }
        super.tabletProximity(with: event)
    }

    /// "pen", "touch" (a finger of the cast), or nil: a mouse, a trackpad — said by the event itself.
    static func kind(of e: NSEvent) -> String? {
        guard let c = e.cgEvent else { return nil }
        if c.getIntegerValueField(.mouseEventSubtype) == Int64(CGEventMouseSubtype.tabletPoint.rawValue) { return "pen" }
        let pid = c.getIntegerValueField(.eventSourceUnixProcessID)
        return pid > 0 && pid == CastHost.pid ? "touch" : nil
    }

    private func penSay(_ e: NSEvent) {
        guard let k = FilesWebView.kind(of: e), let c = e.cgEvent else { return }
        let at = convert(e.locationInWindow, from: nil), z = max(0.01, pageZoom * magnification)
        let x = at.x / z, y = (isFlipped ? at.y : bounds.height - at.y) / z
        let pen = k == "pen"
        let p = pen ? max(0, min(1, c.getDoubleValueField(.tabletEventPointPressure))) : 0
        let tx = pen ? c.getDoubleValueField(.tabletEventTiltX) : 0, ty = pen ? c.getDoubleValueField(.tabletEventTiltY) : 0
        let f = { (v: Double) in String(format: "%.3f", v.isFinite ? v : 0) }
        evaluateJavaScript("window.__mdPen&&__mdPen('\(k)',\(f(x)),\(f(y)),\(f(p)),\(f(tx)),\(f(ty)))", completionHandler: nil)
    }

    /// The last right click on the page: a menu the page asks for after it is shown where the system shows its own
    /// (NativeMenu.swift).
    var lastRightDown: NSEvent?
    override func rightMouseDown(with event: NSEvent) {
        lastRightDown = event
        super.rightMouseDown(with: event)
    }

    private func lend(_ info: NSDraggingInfo?) {
        let urls = (info?.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        evaluateJavaScript("window.__mdDropURIs=\(jsonString(urls.map { $0.absoluteString }))", completionHandler: nil)
    }
    private func forget() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.evaluateJavaScript("window.__mdDropURIs=[]", completionHandler: nil) }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { lend(sender); return super.draggingEntered(sender) }
    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { super.draggingUpdated(sender) }
    override func draggingExited(_ sender: NSDraggingInfo?) { forget(); super.draggingExited(sender) }
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool { let r = super.performDragOperation(sender); forget(); return r }
    /// (WKWebView has no draggingEnded: of its own — handed on, it was an unknown selector, and the app was gone at the end
    /// of every drag over the window: a block moved, a file dropped. Handed on only where WebKit has one.)
    override func draggingEnded(_ sender: NSDraggingInfo) {
        forget()
        if WKWebView.instancesRespond(to: #selector(NSDraggingDestination.draggingEnded(_:))) { super.draggingEnded(sender) }
    }
}

/// The system's clipboard.
enum Clip {
    static var pb: NSPasteboard { .general }

    static func text() -> String? { pb.string(forType: .string).flatMap { $0.isEmpty ? nil : $0 } }

    static func html() -> String {
        if let h = pb.string(forType: .html) { return h }
        if let d = pb.data(forType: .html) { return String(decoding: d, as: UTF8.self) }
        return ""
    }

    static func setText(_ t: String) { pb.clearContents(); pb.setString(t, forType: .string) }

    /// The files the clipboard names (copied in Finder).
    static func fileURLs() -> [String] {
        ((pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []).map { $0.path }
    }

    /// The image on the clipboard as (bytes, file extension with its dot), or nil. Formats the web keeps as they are; any
    /// other is saved as PNG.
    static func image() -> (Data, String)? {
        let kept: [(String, String)] = [("public.png", ".png"), ("public.jpeg", ".jpg"), ("org.webmproject.webp", ".webp"),
                                        ("com.compuserve.gif", ".gif"), ("public.avif", ".avif"), ("public.svg-image", ".svg")]
        for (t, ext) in kept {
            if let d = pb.data(forType: NSPasteboard.PasteboardType(t)), !d.isEmpty { return (d, ext) }
        }
        for t in [NSPasteboard.PasteboardType.tiff, NSPasteboard.PasteboardType("public.heic")] {
            if let d = pb.data(forType: t), let rep = NSBitmapImageRep(data: d), let png = rep.representation(using: .png, properties: [:]) { return (png, ".png") }
        }
        return nil
    }

    /// A picture, by its file, onto the clipboard.
    static func copyImage(file: String) -> Bool {
        guard let img = NSImage(contentsOfFile: file) else { return false }
        pb.clearContents()
        return pb.writeObjects([img])
    }
}

/// ipad-cast's host (the iPad as the Mac's screen): its process makes the events of the iPad's fingers. Looked up at most
/// every 5 s (a restart of the cast is known again within that).
enum CastHost {
    static let bundle = "com.henri.ipadcast"
    private static var known: Int64 = 0, lookedAt = Date.distantPast
    static var pid: Int64 {
        if Date().timeIntervalSince(lookedAt) < 5 { return known } // (asked of every event of a mouse: at most every 5 s)
        lookedAt = Date()
        known = Int64(NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first?.processIdentifier ?? 0)
        return known
    }
}
