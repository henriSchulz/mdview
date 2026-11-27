// The tabs are the system's: a row under the window's bar as Finder's and Safari's — a capsule of Liquid Glass over the
// whole width (beside a pinned sidebar), the tabs in equal parts of it, the one shown a plate that glides, and a round
// button for a new one. The page stays what it was: its own strip is still laid out, unseen, so the note begins under
// it; it says which tabs there are (`mactabs`), and what a hand does here is done by the page (`__macTab`) — a tab
// chosen there writes what was typed first, goes back from All Notes, and so on. The application keeps the tabs
// (Tabs.swift), as before.
import AppKit
import WebKit

/// A plate or ground whose colours follow the appearance.
final class TabFill: NSView {
    var fill: (_ dark: Bool) -> NSColor = { _ in .clear } { didSet { needsDisplay = true } }
    var lifted = false
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        let dark = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        layer?.backgroundColor = fill(dark).cgColor
        layer?.cornerRadius = bounds.height / 2
        layer?.cornerCurve = .continuous
        if lifted {
            layer?.borderWidth = 0.5
            layer?.borderColor = (dark ? NSColor(white: 1, alpha: 0.12) : NSColor(white: 0, alpha: 0.12)).cgColor
            layer?.shadowColor = NSColor.black.cgColor
            layer?.shadowOpacity = dark ? 0.35 : 0.10
            layer?.shadowRadius = 2
            layer?.shadowOffset = CGSize(width: 0, height: -1)
        }
    }
    override func layout() { super.layout(); needsDisplay = true }
    override func hitTest(_ p: NSPoint) -> NSView? { nil }
}

/// One tab: its sign and name in the middle, the ✕ at its left while the pointer is on it.
final class TabItemView: NSView {
    let id: Int
    weak var bar: NativeTabs?
    private let icon = NSImageView(), label = NSTextField(labelWithString: "")
    private let hover = TabFill()
    let closeButton = NSButton()
    private var area: NSTrackingArea?
    private var over = false { didSet { showOver() } }
    var shown = false { didSet { if shown != oldValue { style() } } }
    private var downAt: NSPoint?
    private(set) var title = ""

    init(id: Int, bar: NativeTabs) {
        self.id = id
        self.bar = bar
        super.init(frame: .zero)
        wantsLayer = true
        hover.fill = { NSColor(white: $0 ? 1 : 0, alpha: $0 ? 0.07 : 0.05) }
        hover.isHidden = true
        addSubview(hover)
        label.lineBreakMode = .byTruncatingTail
        label.maximumNumberOfLines = 1
        icon.imageScaling = .scaleProportionallyDown
        closeButton.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Close tab")?
            .withSymbolConfiguration(.init(pointSize: 10, weight: .semibold))
        closeButton.isBordered = false
        closeButton.imagePosition = .imageOnly
        closeButton.contentTintColor = .secondaryLabelColor
        closeButton.refusesFirstResponder = true
        closeButton.target = self
        closeButton.action = #selector(closeIt)
        closeButton.isHidden = true
        for v in [icon, label, closeButton] as [NSView] { addSubview(v) }
        setAccessibilityElement(true)
        setAccessibilityRole(.radioButton)
        style()
    }
    required init?(coder: NSCoder) { fatalError() }

    func set(title: String, image: NSImage?, tip: String?) {
        self.title = title
        label.stringValue = title
        icon.image = image
        toolTip = tip
        setAccessibilityLabel(title)
        needsLayout = true
    }

    private func style() {
        label.font = .systemFont(ofSize: NSFont.systemFontSize, weight: shown ? .medium : .regular)
        label.textColor = shown ? .labelColor : .secondaryLabelColor
        icon.contentTintColor = shown ? .labelColor : .secondaryLabelColor
        setAccessibilityValue(shown)
        showOver()
        needsLayout = true
    }
    private func showOver() {
        closeButton.isHidden = !over
        hover.isHidden = !over || shown
    }

    override func layout() {
        super.layout()
        hover.frame = bounds
        closeButton.frame = NSRect(x: 5, y: (bounds.height - 20) / 2, width: 20, height: 20)
        let side: CGFloat = 28, gap: CGFloat = 6, sign: CGFloat = icon.image == nil ? 0 : 16
        let size = label.cell?.cellSize ?? label.intrinsicContentSize // (as the cell draws it: the field's own size cut the name short)
        let wide = min(ceil(size.width), max(0, bounds.width - 2 * side - (sign > 0 ? sign + gap : 0)))
        var x = ((bounds.width - wide - (sign > 0 ? sign + gap : 0)) / 2).rounded()
        icon.isHidden = sign == 0
        icon.frame = NSRect(x: x, y: ((bounds.height - 16) / 2).rounded(), width: 16, height: 16)
        if sign > 0 { x += sign + gap }
        label.frame = NSRect(x: x, y: ((bounds.height - size.height) / 2).rounded(), width: wide, height: ceil(size.height))
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let a = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(a)
        area = a
        // (moved from under the pointer by a tab closed: no "exited" comes)
        if over, let w = window, !bounds.contains(convert(w.mouseLocationOutsideOfEventStream, from: nil)) { over = false }
    }
    override func mouseEntered(with e: NSEvent) { over = true }
    override func mouseExited(with e: NSEvent) { over = false }

    @objc private func closeIt() { bar?.close(id) }
    override func accessibilityPerformPress() -> Bool { bar?.select(id); return true }
    override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
    override func hitTest(_ p: NSPoint) -> NSView? {
        guard !isHidden, frame.contains(p) else { return nil }
        let q = convert(p, from: superview)
        return !closeButton.isHidden && closeButton.frame.contains(q) ? closeButton : self
    }
    override func mouseDown(with e: NSEvent) {
        downAt = e.locationInWindow
        bar?.select(id)
    }
    override func mouseDragged(with e: NSEvent) {
        if let from = downAt { bar?.pull(self, by: e.locationInWindow.x - from.x) }
    }
    override func mouseUp(with e: NSEvent) { downAt = nil; bar?.letGo(self) }
    override func otherMouseDown(with e: NSEvent) {}
    override func otherMouseUp(with e: NSEvent) { if e.buttonNumber == 2 { bar?.close(id) } }
    override func rightMouseDown(with e: NSEvent) { bar?.menu(id, e) }
}

/// The capsule the tabs lie in; a double click on its empty room opens a tab.
final class TabTrack: NSView {
    var doubled: (() -> Void)?
    override var mouseDownCanMoveWindow: Bool { false }
    override func mouseDown(with e: NSEvent) { if e.clickCount == 2 { doubled?() } }
}

final class NativeTabs: NSObject {
    weak var w: NoteWindow?
    let strip = NSView()
    private let track = TabTrack()
    private let plate = TabFill()
    private let trackGlass: NSView, plusGlass: NSView
    let plus = NSButton()
    private(set) var items: [TabItemView] = []
    private(set) var active = 0
    private var overview = false
    private var said: [String: Any] = [:]
    private var barTop: CGFloat = 52
    private var edge: CGFloat = 0 // (the right edge of a pinned sidebar)
    private var pulled: TabItemView?
    private var from = 0, to = 0

    static let height: CGFloat = 32

    /// A capsule of the system's glass (before macOS 26 a faint fill) holding `content`.
    private static func capsule(_ content: NSView) -> NSView {
        if #available(macOS 26, *) {
            let g = NSGlassEffectView()
            g.cornerRadius = height / 2
            g.contentView = content
            return g
        }
        let v = NSView()
        let fill = TabFill()
        fill.fill = { NSColor(white: $0 ? 1 : 0, alpha: 0.07) }
        for s in [fill, content] as [NSView] { s.autoresizingMask = [.width, .height]; v.addSubview(s) }
        return v
    }

    init(_ w: NoteWindow) {
        self.w = w
        plate.fill = { $0 ? NSColor(white: 1, alpha: 0.16) : NSColor(white: 1, alpha: 0.95) }
        plate.lifted = true
        trackGlass = NativeTabs.capsule(track)
        let plusBox = NSView()
        plusGlass = NativeTabs.capsule(plusBox)
        super.init()
        track.wantsLayer = true
        track.addSubview(plate)
        track.doubled = { [weak self] in self?.new() }
        let label = Store.shared.prefs["lang"] as? String == "de" ? "Neuer Tab" : "New Tab"
        plus.image = NSImage(systemSymbolName: "plus", accessibilityDescription: label)?.withSymbolConfiguration(.init(pointSize: 13, weight: .medium))
        plus.isBordered = false
        plus.imagePosition = .imageOnly
        plus.contentTintColor = .secondaryLabelColor
        plus.refusesFirstResponder = true
        plus.toolTip = label + " (⌘T)"
        plus.target = self
        plus.action = #selector(new)
        plus.frame = NSRect(x: 0, y: 0, width: NativeTabs.height, height: NativeTabs.height)
        plusBox.addSubview(plus)
        strip.wantsLayer = true
        strip.isHidden = true
        strip.setAccessibilityRole(.tabGroup)
        strip.addSubview(trackGlass)
        strip.addSubview(plusGlass)
        strip.postsFrameChangedNotifications = true
        NotificationCenter.default.addObserver(self, selector: #selector(resized), name: NSView.frameDidChangeNotification, object: strip)
        // (under the sidebar's card: a card that peeks out lies over the tabs)
        if let ground = w.window.contentView { ground.addSubview(strip, positioned: .above, relativeTo: w.web) }
    }

    // MARK: what the page says (mactabs, macsb)

    func update(_ s: [String: Any]) {
        guard let w, let ground = w.window.contentView else { return }
        said = s
        barTop = CGFloat((s["top"] as? NSNumber)?.doubleValue ?? 52)
        overview = (s["overview"] as? Bool) == true
        let list = s["tabs"] as? [[String: Any]] ?? []
        let had = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var next: [TabItemView] = []
        var fresh: [TabItemView] = []
        for t in list {
            guard let id = (t["id"] as? NSNumber)?.intValue else { continue }
            let item = had[id] ?? TabItemView(id: id, bar: self)
            if had[id] == nil { track.addSubview(item); fresh.append(item) }
            item.set(title: t["label"] as? String ?? "", image: NativeTabs.sign(t), tip: t["tip"] as? String)
            next.append(item)
        }
        for old in items where !next.contains(where: { $0 === old }) { old.removeFromSuperview() }
        if let p = pulled, !next.contains(where: { $0 === p }) { pulled = nil }
        let was = items.count
        items = next
        active = (s["active"] as? NSNumber)?.intValue ?? 0
        // (all notes over a note: its tab is the way back, and is not marked)
        for (i, item) in items.enumerated() { item.shown = item.id == active && !(overview && (list[i]["path"] as? String ?? "") != "") }
        let show = shouldShow
        let came = show && strip.isHidden
        strip.isHidden = !show
        place(in: ground, animate: false)
        // (a tab come is where it belongs at once; those there already glide)
        let glide = !came && was > 0
        arrange(animate: glide, at: Set(fresh.map(\.id)))
    }

    private var shouldShow: Bool {
        guard let w else { return false }
        return (said["on"] as? Bool) == true && !w.boardFull && w.chrome?.toolbar.isVisible == true
    }

    /// The window's own state changed (a whiteboard over the whole window).
    func again() { if !said.isEmpty { update(said) } }

    /// The page's word on its sidebar: the tabs stand beside a pinned one.
    func sidebar(_ s: [String: Any]) {
        guard let w, let ground = w.window.contentView else { return }
        let state = s["state"] as? String
        let beside = state == "open" || (state == "peek" && (s["on"] as? Bool) != true) // (the page's own card, peeking: not covered by the system's views)
        let now: CGFloat = beside ? max(180, CGFloat((s["sbw"] as? NSNumber)?.doubleValue ?? 260)) : 0
        if now == edge { return }
        edge = now
        place(in: ground, animate: !strip.isHidden && (s["glide"] as? Bool) != false)
    }

    private func place(in ground: NSView, animate: Bool) {
        let left = edge > 0 ? edge + 6 : 12, h = NativeTabs.height
        let frame = NSRect(x: left, y: ground.bounds.height - barTop - 4 - h, width: max(h * 3, ground.bounds.width - left - 12), height: h)
        strip.autoresizingMask = [.width, .minYMargin]
        guard animate else { strip.frame = frame; return }
        NSAnimationContext.runAnimationGroup { c in
            c.duration = 0.45
            c.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1.0, 0.36, 1.0)
            strip.animator().frame = frame
        }
    }

    @objc private func resized() { arrange(animate: false) }

    /// Where tab i of n lies in the track.
    private func slot(_ i: Int) -> NSRect {
        let inner = NSRect(x: 0, y: 0, width: max(0, strip.frame.width - NativeTabs.height - 8), height: NativeTabs.height).insetBy(dx: 2, dy: 2)
        let each = inner.width / CGFloat(max(1, items.count))
        return NSRect(x: inner.minX + CGFloat(i) * each, y: inner.minY, width: each, height: inner.height)
    }

    private func arrange(animate: Bool, at once: Set<Int> = []) {
        let h = NativeTabs.height, wide = max(0, strip.frame.width - h - 8)
        trackGlass.frame = NSRect(x: 0, y: 0, width: wide, height: h)
        plusGlass.frame = NSRect(x: wide + 8, y: 0, width: h, height: h)
        track.frame = trackGlass.bounds
        let on = items.firstIndex { $0.shown }
        plate.isHidden = on == nil
        let move = animate && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        NSAnimationContext.runAnimationGroup { c in
            c.duration = move ? 0.3 : 0
            c.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1.0, 0.36, 1.0)
            for (i, item) in items.enumerated() where item !== pulled {
                if move && !once.contains(item.id) { item.animator().frame = slot(i) } else { item.frame = slot(i) }
            }
            if let on { if move && plate.frame.width > 0 { plate.animator().frame = slot(on) } else { plate.frame = slot(on) } }
        }
    }

    static func sign(_ t: [String: Any]) -> NSImage? {
        let kind = t["kind"] as? String ?? "note"
        if kind == "custom", let img = NativeMenu.image(sign: "", svg: t["svg"] as? String ?? "") { return img }
        let name = ["all": "square.grid.2x2", "dir": "folder", "pdf": "doc.richtext", "board": "scribble.variable"][kind] ?? "doc.text"
        return NSImage(systemSymbolName: name, accessibilityDescription: nil)
    }

    // MARK: what a hand does: the page's own

    private func page(_ op: String, _ id: Int, _ arg: Int? = nil) {
        guard let w, w.ready else { return }
        w.web.evaluateJavaScript("window.__macTab && __macTab(\(jsonString(op)), \(id), \(arg.map(String.init) ?? "null"))", completionHandler: nil)
    }
    func select(_ id: Int) { page("select", id) }
    func close(_ id: Int) { page("close", id) }
    @objc func new() { page("new", 0) }
    func menu(_ id: Int, _ e: NSEvent) {
        (w?.web as? FilesWebView)?.lastRightDown = e // (the menu stands where the hand is: NativeMenu.swift)
        page("ctx", id)
    }

    // pulled sideways, a tab goes along and the others make room; let go, it lands in the gap
    func pull(_ item: TabItemView, by dx: CGFloat) {
        if pulled == nil {
            guard abs(dx) >= 4, items.count > 1, let i = items.firstIndex(where: { $0 === item }) else { return }
            pulled = item; from = i; to = i
            track.addSubview(item) // (over the others)
        }
        guard pulled === item else { return }
        let home = slot(from), d = max(slot(0).minX - home.minX, min(slot(items.count - 1).minX - home.minX, dx))
        item.frame = home.offsetBy(dx: d, dy: 0)
        if item.shown { plate.frame = item.frame }
        let want = max(0, min(items.count - 1, from + Int((d / home.width).rounded())))
        guard want != to else { return }
        to = want
        NSAnimationContext.runAnimationGroup { c in
            c.duration = 0.2
            for (i, other) in items.enumerated() where other !== item {
                let at = i > from && i <= to ? i - 1 : i < from && i >= to ? i + 1 : i
                other.animator().frame = slot(at)
                if other.shown { plate.animator().frame = slot(at) }
            }
        }
    }
    func letGo(_ item: TabItemView) {
        guard pulled === item else { return }
        pulled = nil
        if to != from {
            items.remove(at: from)
            items.insert(item, at: to)
            page("move", item.id, to)
        }
        arrange(animate: true)
    }

    /// What the page is given: its own strip's tabs unseen, and a word whenever they change.
    static let script = """
    (function () {
      var html = document.documentElement;
      var style = document.createElement("style");
      style.textContent = ":root[data-mac] #tabs .tab-row{visibility:hidden!important}" +
        // (what drops from the bar's buttons drops below the row of tabs, not under it)
        ":root[data-mac][data-mac-tabs] :is(#findbar,#outline){top:calc(var(--tabs-h) + 2px)}" +
        // (… and the rail and its panel at the right begin below it: they lay on the button for a new tab)
        ":root[data-mac][data-mac-tabs]:not([data-ipad]){--rail-top:calc(var(--tabs-h) - var(--sb-inset,8px) + 4px)}";
      document.head.appendChild(style);
      var start = function () {
        var q = function (s) { return document.querySelector(s); };
        var strip = q("#tabs");
        if (!strip) return;
        var tabEl = function (id) { return q('#tabs .tab[data-id="' + id + '"]:not(.leaving)'); };
        window.__macTab = function (op, id, arg) {
          var P = window.MdPage;
          if (op === "select") P.selectTab(id);
          else if (op === "close") P.closeTab(id);
          else if (op === "new") P.post("tab", { op: "new" });
          else if (op === "move") P.post("tab", { op: "move", id: id, to: arg });
          else if (op === "ctx") {
            var el = tabEl(id);
            if (!el) return;
            var r = el.getBoundingClientRect();
            el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2, button: 2 }));
          }
        };
        var was = "", soon = 0;
        var tell = function () {
          soon = 0;
          var b = document.body, P = window.MdPage || {};
          var tabs = Array.prototype.map.call(document.querySelectorAll("#tabs .tab-list > .tab:not(.leaving)"), function (el) {
            var path = el.dataset.path || "", icon = el.querySelector(".tab-icon");
            var kind = el.hasAttribute("data-dir") ? "dir" : !path ? "all" : /\\.pdf$/i.test(path) ? "pdf" : /\\.board\\.svg$/i.test(path) ? "board" : "note";
            if (kind === "note" && icon && P.ICON && icon.innerHTML.indexOf("<svg") === 0) {
              var plain = document.createElement("span");
              plain.innerHTML = P.ICON.note;
              if (plain.innerHTML !== icon.innerHTML) kind = "custom";
            }
            return { id: Number(el.dataset.id), label: el.querySelector(".tab-label").textContent, path: path, tip: el.dataset.tip || "",
              kind: kind, svg: kind === "custom" ? icon.innerHTML : "", on: el.getAttribute("aria-selected") === "true" };
          });
          var chosen = tabs.filter(function (t) { return t.on; })[0];
          var covered = !!q(":is(#settings,#dlg,#share,#newdlg,#codeview,#zoom,#tour,#search,#palette)[data-open]");
          var st = { on: b.hasAttribute("data-tabs") && tabs.length > 1 && !covered && !b.hasAttribute("data-focus") &&
              !b.hasAttribute("data-quick") && !html.hasAttribute("data-ipad"),
            tabs: tabs, active: chosen ? chosen.id : 0, overview: b.hasAttribute("data-overview"),
            top: parseFloat(html.style.getPropertyValue("--mac-bar")) || 52 };
          var s = JSON.stringify(st);
          if (s !== was) { was = s; window.webkit.messageHandlers.msg.postMessage(Object.assign({ type: "mactabs" }, st)); }
        };
        var later = function () { if (!soon) soon = setTimeout(tell, 0); };
        var mo = new MutationObserver(later);
        mo.observe(strip, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-selected", "data-path", "data-tip", "class"] });
        mo.observe(document.body, { attributes: true, attributeFilter: ["data-tabs", "data-focus", "data-overview", "data-quick"] });
        mo.observe(html, { attributes: true, attributeFilter: ["style", "data-ipad"] });
        new MutationObserver(later).observe(html, { subtree: true, attributes: true, attributeFilter: ["data-open"] });
        tell();
      };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    })();
    """
}
