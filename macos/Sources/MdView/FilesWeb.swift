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
      const types = Object.getOwnPropertyDescriptor(DataTransfer.prototype, "types");
      if (types) Object.defineProperty(DataTransfer.prototype, "types", { configurable: true, get() {
        const t = types.get.call(this);
        return window.__mdDropURIs && window.__mdDropURIs.length && !t.includes("text/uri-list") ? [...t, "text/uri-list"] : t;
      } });
    })();
    """

    override init(frame: CGRect, configuration: WKWebViewConfiguration) {
        configuration.userContentController.addUserScript(WKUserScript(source: FilesWebView.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        super.init(frame: frame, configuration: configuration)
    }
    required init?(coder: NSCoder) { fatalError() }

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
