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
      // what the shell says of the pointer just before WebKit hands it on (FilesWebView.penSay): a pen's or a finger's
      // press, move or lift — where, how hard, how tilted —, or "wheel": a finger's scroll (the cast's, its glide after it),
      // "wheelbegan" as the finger begins to move (its first wheel is told so: mdBegan) and "wheelend" as it is lifted
      // (an event of the window's own, "mdwheelend") — the swipe that chooses a block reads them (active/blocks.js)
      window.__mdPen = function (k, x, y, p, tx, ty) {
        if (k === "wheel" || k === "wheelbegan") { window.__mdPenWheel = performance.now(); if (k === "wheelbegan") window.__mdWheelBegan = true; return; }
        if (k === "wheelend") { window.__mdPenWheel = performance.now(); window.__mdWheelBegan = false; dispatchEvent(new Event("mdwheelend")); return; }
        const a = window.__mdPenSaid || (window.__mdPenSaid = []);
        a.push({ k: k, x: x, y: y, p: p, tx: tx * 90, ty: ty * 90, t: performance.now() });
        if (a.length > 48) a.splice(0, a.length - 48);
      };
      /* A "mouse" pointer where and when the shell said a pen (a finger) is one is that, with the pen's pressure and tilt — on
       * the event itself, before anyone on the page hears it (the first listener of all: the whiteboard, viewer/hand.js,
       * viewer/touch.js ask the event). A wheel the shell said is a finger's says "touch" too. (__mdTold: for the samples a
       * move bundles, which no listener hears — board/pointer.js.) */
      const own = function (e, k, v) { try { Object.defineProperty(e, k, { value: v, configurable: true }); } catch (x) { /* (an event that keeps its own) */ } };
      window.__mdTold = function (e) {
        const said = window.__mdPenSaid;
        if (e.pointerType !== "mouse" || !said || !said.length) return e;
        const now = performance.now();
        let best = null, near = 4;
        for (let i = said.length - 1; i >= 0; i--) {
          const s = said[i];
          if (now - s.t > 300) break;
          const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
          if (d <= near) { near = d; best = s; if (d < 0.25) break; }
        }
        if (!best) return e;
        own(e, "pointerType", best.k);
        if (best.k === "pen") { own(e, "pressure", e.type === "pointerup" ? 0 : best.p); own(e, "tiltX", best.tx); own(e, "tiltY", best.ty); }
        return e;
      };
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) addEventListener(type, window.__mdTold, true);
      /* What the hand that makes a trackpad's wheels is doing (FilesWebView.scrollSay): each wheel while it is on the glass says
       * mdPhase "hand", each of the glide after it "glide"; its lift and the glide's end are events of the window's own
       * ("mdscrolllift", "mdglideend"). A glide's steps come every frame: one whose end went unsaid is over after a pause. */
      const sc = { hand: false, glide: false, t: 0 };
      window.__mdScroll = function (k) {
        sc.t = performance.now();
        if (k === "hand") { sc.hand = true; sc.glide = false; }
        else if (k === "lift") { sc.hand = false; dispatchEvent(new Event("mdscrolllift")); }
        else if (k === "glide") { sc.hand = false; sc.glide = true; }
        else if (k === "glideend") { sc.glide = false; dispatchEvent(new Event("mdglideend")); }
      };
      addEventListener("wheel", function (e) {
        const now = performance.now();
        if (sc.glide && now - sc.t > 400) sc.glide = false;
        sc.t = now;
        if (sc.hand || sc.glide) own(e, "mdPhase", sc.hand ? "hand" : "glide");
      }, { capture: true, passive: true });
      addEventListener("wheel", function (e) {
        if (!window.__mdPenWheel || performance.now() - window.__mdPenWheel >= 300) return;
        own(e, "pointerType", "touch");
        if (window.__mdWheelBegan) { window.__mdWheelBegan = false; own(e, "mdBegan", true); }
      }, { capture: true, passive: true });
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
    /// what it is, where, how hard, how tilted — and the page takes the "mouse" there as what it is (`__mdTold` above): the
    /// whiteboard, and the whole page's ways for a finger (viewer/hand.js, viewer/touch.js — Henri, 2026-11-20: the touch
    /// optimizations "wirken in der mdview macos native app nicht"). A finger held and let go is the cast's right click, said
    /// too (the edit menu over it, not the mouse's menu); a finger's scroll and its glide are said as a finger's wheel (the
    /// hand stays a finger). A mouse's or a trackpad's own events are not said: they are what WebKit says they are.
    /// Heard as the application takes them, before any view does: WebKit hands a move to its own tracking object, and a press
    /// to whichever of its views is hit — a method of this view's own heard only some of them (a hover never).
    private var penMonitor: Any?
    deinit { if let m = penMonitor { NSEvent.removeMonitor(m) } }
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let m = penMonitor { NSEvent.removeMonitor(m); penMonitor = nil }
        guard window != nil else { return }
        penMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .leftMouseDragged, .leftMouseUp, .rightMouseDown, .rightMouseDragged, .rightMouseUp,
                                                                 .mouseMoved, .scrollWheel, .tabletProximity]) { [weak self] e in
            guard let self, let w = self.window else { return e }
            if e.type == .tabletProximity {
                // the pen gone from over the glass: the tip the board shows where it would come down goes too — WebKit hands
                // no proximity on (ipad-cast says it as the system's tablet proximity)
                if !e.isEnteringProximity, w.isKeyWindow { self.evaluateJavaScript("window.dispatchEvent(new Event('mdpenout'))", completionHandler: nil) }
                return e
            }
            if e.window === w { self.penSay(e) }
            return e
        }
    }

    /// "pen", "touch" (a finger of the cast), or nil: a mouse, a trackpad — said by the event itself.
    static func kind(of e: NSEvent) -> String? {
        guard let c = e.cgEvent else { return nil }
        if c.getIntegerValueField(.mouseEventSubtype) == Int64(CGEventMouseSubtype.tabletPoint.rawValue) { return "pen" }
        let pid = c.getIntegerValueField(.eventSourceUnixProcessID)
        return pid > 0 && pid == CastHost.pid ? "touch" : nil
    }

    /// What the hand that makes a trackpad's wheels — the Mac's own, or the cast's finger — is doing, said as it changes: "hand"
    /// on the glass, "lift" let go, "glide" the system's (or the cast's) run after it, "glideend" its end. WebKit says none of
    /// it, and a page that guessed it from the steps (ever smaller: a glide) took a glide's steps for a hand's again and again
    /// — a notebook pulled past its edge and let go went back and was pulled out again by the rest of the glide (Henri,
    /// 2026-11-21: "manchmal wackelt es mehrmals hin und her"). board/pointer.js reads it (`mdPhase` on the wheel).
    func scrollSay(_ e: NSEvent) {
        guard e.hasPreciseScrollingDeltas else { return } // (a mouse's wheel: no hand, no glide)
        let p = e.phase, m = e.momentumPhase
        let word = !p.isDisjoint(with: [.began, .mayBegin]) ? "hand" : !p.isDisjoint(with: [.ended, .cancelled]) ? "lift"
            : m.contains(.began) ? "glide" : !m.isDisjoint(with: [.ended, .cancelled]) ? "glideend" : nil
        guard let word else { return }
        evaluateJavaScript("window.__mdScroll&&__mdScroll('\(word)')", completionHandler: nil)
    }

    private var wheelSaid = 0.0
    func penSay(_ e: NSEvent) {
        if e.type == .scrollWheel { scrollSay(e) }
        guard let k = FilesWebView.kind(of: e), let c = e.cgEvent else { return }
        if e.type == .scrollWheel { // (a finger's: said at most every 0.1 s — the page takes a wheel within 0.3 s of it for one)
            let now = ProcessInfo.processInfo.systemUptime
            guard k == "touch" else { return }
            // (… and its beginning and its lift each time: a swipe is read from them — active/blocks.js, BUGS.md 129)
            let word = e.phase.contains(.began) ? "wheelbegan" : !e.phase.isDisjoint(with: [.ended, .cancelled]) ? "wheelend" : "wheel"
            guard word != "wheel" || now - wheelSaid > 0.1 else { return }
            wheelSaid = now
            return evaluateJavaScript("window.__mdPen&&__mdPen('\(word)',0,0,0,0,0)", completionHandler: nil)
        }
        let at = convert(e.locationInWindow, from: nil), z = max(0.01, pageZoom * magnification)
        guard bounds.contains(at) || e.type != .mouseMoved else { return } // (a move over the window's bars is no one's here)
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
    static var fixed: Int64? // (tests: the process whose events are the cast's)
    static var pid: Int64 {
        if let fixed { return fixed }
        if Date().timeIntervalSince(lookedAt) < 5 { return known } // (asked of every event of a mouse: at most every 5 s)
        lookedAt = Date()
        known = Int64(NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first?.processIdentifier ?? 0)
        return known
    }

    /// Whether a screen is the iPad's: the display ipad-cast makes says the vendor and model its VirtualDisplay.m gives it
    /// (0x1A2B, 0x8771 — the system names it "iPad"). Tests say another.
    static var shows: (NSScreen) -> Bool = { s in
        guard let n = s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return false }
        return CGDisplayVendorNumber(n.uint32Value) == 0x1A2B && CGDisplayModelNumber(n.uint32Value) == 0x8771
    }
}
