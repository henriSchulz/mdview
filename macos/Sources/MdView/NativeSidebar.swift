// The sidebar is the system's (Phase 4 of the native work, 2026-11-17) — in the Library layout, the one Henri has: a card of
// Liquid Glass over the page (NSGlassEffectView; before macOS 26 the sidebar's material), with the search, the Library's
// rows (All Notes, Recents, Today, With Tasks, Shared, Whiteboards) and their counts, the folders with their colours, and
// at its foot New, the history and the settings. The page stays what it was: it counts, sorts, searches, marks the row
// shown, opens, peeks and pins — its own card is still there, unseen (data-mac-sb), and every row of the system's clicks
// the page's row. The page says what its card holds and how it stands (`macsb`); the system's card glides with it.
// Other layouts (the tree, the rail, the sheets, the tiles) and the quick notes keep the page's own card.
import AppKit
import WebKit

final class SidebarTable: NSTableView {
    var rightClick: ((Int, NSEvent) -> Void)?
    override func menu(for event: NSEvent) -> NSMenu? {
        let row = self.row(at: convert(event.locationInWindow, from: nil))
        if row >= 0 { rightClick?(row, event) }
        return nil // (the page's menu for the row, shown as the system's: NativeMenu.swift)
    }
}

/// The card's own view: where the pointer is on it, said to the page while the card only peeks (the page puts a peeking card
/// away a moment after the pointer left the page — and over the system's card, the page sees it gone).
final class SidebarCardView: NSView {
    var moved: ((NSPoint) -> Void)?
    private var area: NSTrackingArea?
    private var last = 0.0
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let area { removeTrackingArea(area) }
        let a = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(a)
        area = a
    }
    override func mouseEntered(with e: NSEvent) { last = 0; tell(e) }
    override func mouseMoved(with e: NSEvent) { tell(e) }
    private func tell(_ e: NSEvent) {
        let now = ProcessInfo.processInfo.systemUptime
        guard now - last > 0.1 else { return } // (a few times a second is enough to keep it)
        last = now
        moved?(e.locationInWindow)
    }
}

final class NativeSidebar: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSSearchFieldDelegate {
    weak var w: NoteWindow?
    let card = SidebarCardView()
    private let glass: NSView
    let search = NSSearchField()
    let table = SidebarTable()
    private let scroll = NSScrollView()
    private var history = NSButton()
    private(set) var rows: [[String: Any]] = []
    private(set) var on = false
    private(set) var stand = "closed"
    private var width: CGFloat = 260
    private var placing = false
    private var barTop: CGFloat = 52 // (the window's bar's height, as the page has it: --mac-bar)
    /// Whether the window is full screen now (a test says it is: full screen itself would take a Space of the screen).
    var fullScreenNow: () -> Bool = { false }

    init(_ w: NoteWindow) {
        self.w = w
        if #available(macOS 26, *) {
            let g = NSGlassEffectView()
            g.cornerRadius = 18
            glass = g
        } else {
            let v = NSVisualEffectView()
            v.material = .sidebar
            v.blendingMode = .withinWindow
            v.state = .active
            v.wantsLayer = true
            v.layer?.cornerRadius = 18
            v.layer?.masksToBounds = true
            glass = v
        }
        let content = NSView()
        super.init()

        card.wantsLayer = true
        card.isHidden = true
        glass.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(glass)
        NSLayoutConstraint.activate([glass.leadingAnchor.constraint(equalTo: card.leadingAnchor), glass.trailingAnchor.constraint(equalTo: card.trailingAnchor),
                                     glass.topAnchor.constraint(equalTo: card.topAnchor), glass.bottomAnchor.constraint(equalTo: card.bottomAnchor)])
        var hosted = false
        if #available(macOS 26, *), let g = glass as? NSGlassEffectView { g.contentView = content; hosted = true }
        if !hosted {
            content.translatesAutoresizingMaskIntoConstraints = false
            glass.addSubview(content)
            NSLayoutConstraint.activate([content.leadingAnchor.constraint(equalTo: glass.leadingAnchor), content.trailingAnchor.constraint(equalTo: glass.trailingAnchor),
                                         content.topAnchor.constraint(equalTo: glass.topAnchor), content.bottomAnchor.constraint(equalTo: glass.bottomAnchor)])
        }

        // the search, under the window's bar
        search.placeholderString = Store.shared.prefs["lang"] as? String == "de" ? "Suchen" : "Search"
        search.sendsSearchStringImmediately = true
        search.delegate = self
        search.target = self
        search.action = #selector(searched(_:))
        // the rows
        let col = NSTableColumn(identifier: .init("row"))
        table.addTableColumn(col)
        table.headerView = nil
        table.style = .sourceList
        table.backgroundColor = .clear
        table.rowSizeStyle = .default
        table.intercellSpacing = NSSize(width: 0, height: 2)
        table.refusesFirstResponder = true // (the keys stay the page's: a folder chosen, All Notes takes them)
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.action = #selector(clicked(_:))
        table.rightClick = { [weak self] row, e in self?.rightClicked(row, e) }
        table.registerForDraggedTypes([.fileURL])
        scroll.documentView = table
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        // the foot: New, the history, the settings
        let new = NSButton(title: Store.shared.prefs["lang"] as? String == "de" ? "Neu" : "New", image: NSImage(systemSymbolName: "plus", accessibilityDescription: nil)!, target: self, action: #selector(newMenu(_:)))
        new.isBordered = false
        new.imagePosition = .imageLeading
        new.contentTintColor = .secondaryLabelColor
        history = NSButton(image: NSImage(systemSymbolName: "clock.arrow.circlepath", accessibilityDescription: "History")!, target: self, action: #selector(historyMenu(_:)))
        history.isBordered = false
        history.contentTintColor = .secondaryLabelColor
        let gear = NSButton(image: NSImage(systemSymbolName: "gearshape", accessibilityDescription: "Settings")!, target: self, action: #selector(settings(_:)))
        gear.isBordered = false
        gear.contentTintColor = .secondaryLabelColor
        let foot = NSStackView(views: [new, NSView(), history, gear])
        foot.orientation = .horizontal
        foot.spacing = 12
        foot.edgeInsets = NSEdgeInsets(top: 0, left: 14, bottom: 0, right: 14)

        for v in [search, scroll, foot] as [NSView] { v.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(v) }
        let top = search.topAnchor.constraint(equalTo: content.topAnchor, constant: 44)
        top.identifier = "top"
        NSLayoutConstraint.activate([
            top,
            search.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 12),
            search.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -12),
            scroll.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: foot.topAnchor, constant: -6),
            foot.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            foot.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            foot.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -12),
            foot.heightAnchor.constraint(equalToConstant: 26),
        ])
        searchTop = top

        if let ground = w.window.contentView {
            ground.addSubview(card, positioned: .above, relativeTo: w.web)
        }
        card.moved = { [weak self] p in self?.pointer(at: p) }
        fullScreenNow = { [weak w] in w?.window.styleMask.contains(.fullScreen) == true }
    }

    /// Laid out again where the window's bar changed (full screen entered or left): NoteWindow.windowDidEnterFullScreen.
    func relayout() {
        guard let w, let ground = w.window.contentView else { return }
        fitTop()
        place(in: ground, animate: false)
    }
    private func fitTop() {
        let want = fullScreenNow() ? 12 : barTop - 8 + 2 // (in full screen the card begins under the bar: the search at its top)
        if abs(searchTop.constant - want) > 0.5 { searchTop.constant = want }
    }

    private var searchTop: NSLayoutConstraint!

    // MARK: what the page says (macsb)

    func update(_ s: [String: Any]) {
        guard let w, let ground = w.window.contentView else { return }
        let use = (s["on"] as? Bool) == true
        if use != on {
            on = use
            w.web.evaluateJavaScript("window.__macSbOn && __macSbOn(\(use))", completionHandler: nil)
        }
        if let r = s["rows"] as? [[String: Any]], !(r as NSArray).isEqual(to: rows) {
            rows = r
            table.reloadData()
        }
        selectShown()
        if let q = s["search"] as? String, q != search.stringValue, w.window.firstResponder !== search.currentEditor() { search.stringValue = q }
        if let hist = s["hist"] as? String { history.contentTintColor = hist == "warn" ? .systemOrange : hist == "quiet" ? .tertiaryLabelColor : .secondaryLabelColor }
        barTop = CGFloat((s["top"] as? NSNumber)?.doubleValue ?? 52)
        fitTop()
        let sbw = CGFloat((s["sbw"] as? NSNumber)?.doubleValue ?? 260)
        let was = stand
        stand = use ? (s["state"] as? String ?? "closed") : "closed"
        width = max(180, sbw)
        place(in: ground, animate: (s["glide"] as? Bool) != false && was != stand)
    }

    /// The card where the page's stands: in at the window's left (pinned or peeking), or out of it — gliding as the page glides.
    private func place(in ground: NSView, animate: Bool) {
        let inset: CGFloat = 8
        let wide = width - inset - 4 // (the page's grip at the card's edge stays free to pull: #sb-grip, 8 px over the edge)
        let shown = stand == "open" || stand == "peek"
        // (full screen: the window's bar is a window of its own over the page, with a ground of its own — it lay over the
        // card's top and its round corners, Henri 2026-11-19 „überlappung bug“; out of it the bar is see-through and the card
        // runs up behind the window's buttons, as the system's sidebars do)
        let under = fullScreenNow() ? max(0, ground.bounds.height - (w?.window.contentLayoutRect.maxY ?? ground.bounds.height)) : 0
        let frame = NSRect(x: shown ? inset : -wide - 24, y: inset, width: wide, height: ground.bounds.height - 2 * inset - under)
        if shown { card.isHidden = false }
        card.autoresizingMask = [.height]
        if !animate || card.frame.width < 1 {
            card.frame = frame
            card.isHidden = !shown
            return
        }
        placing = true
        NSAnimationContext.runAnimationGroup({ c in
            c.duration = 0.45
            c.timingFunction = CAMediaTimingFunction(controlPoints: 0.22, 1.0, 0.36, 1.0) // (the page's --spring-gentle, near enough)
            card.animator().frame = frame
        }, completionHandler: { [weak self] in
            guard let self else { return }
            self.placing = false
            if self.stand == "closed" { self.card.isHidden = true }
        })
    }

    private func selectShown() {
        let i = rows.firstIndex { ($0["on"] as? Bool) == true }
        let want = i.map { IndexSet(integer: $0) } ?? IndexSet()
        if table.selectedRowIndexes != want { table.selectRowIndexes(want, byExtendingSelection: false) }
    }

    // MARK: the rows

    func numberOfRows(in t: NSTableView) -> Int { rows.count }
    func tableView(_ t: NSTableView, isGroupRow row: Int) -> Bool { rows[row]["kind"] as? String == "cap" }
    func tableView(_ t: NSTableView, shouldSelectRow row: Int) -> Bool { rows[row]["kind"] as? String != "cap" }
    func tableView(_ t: NSTableView, heightOfRow row: Int) -> CGFloat { rows[row]["kind"] as? String == "cap" ? 26 : 28 }

    func tableView(_ t: NSTableView, viewFor col: NSTableColumn?, row: Int) -> NSView? {
        let r = rows[row], kind = r["kind"] as? String ?? ""
        if kind == "cap" { // (a group row is drawn the table's whole width, without the rows' indent: the heading begins where their signs do)
            let cell = NSTableCellView(), f = NSTextField(labelWithString: r["label"] as? String ?? "")
            f.font = .systemFont(ofSize: NSFont.smallSystemFontSize, weight: .semibold)
            f.textColor = .secondaryLabelColor
            f.translatesAutoresizingMaskIntoConstraints = false
            cell.addSubview(f)
            cell.textField = f
            NSLayoutConstraint.activate([f.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: NativeSidebar.capIndent),
                                         f.trailingAnchor.constraint(lessThanOrEqualTo: cell.trailingAnchor, constant: -8),
                                         f.centerYAnchor.constraint(equalTo: cell.centerYAnchor)])
            return cell
        }
        let cell = NSTableCellView()
        let img = NSImageView(), label = NSTextField(labelWithString: r["label"] as? String ?? ""), n = NSTextField(labelWithString: r["n"] as? String ?? "")
        label.lineBreakMode = .byTruncatingTail
        label.font = .systemFont(ofSize: NSFont.systemFontSize)
        n.font = .monospacedDigitSystemFont(ofSize: NSFont.smallSystemFontSize, weight: .regular)
        n.textColor = .secondaryLabelColor
        n.alignment = .right
        img.image = NativeSidebar.sign(r)
        if let c = NativeSidebar.color(r["color"] as? String) { img.contentTintColor = c }
        for v in [img, label, n] as [NSView] { v.translatesAutoresizingMaskIntoConstraints = false; cell.addSubview(v) }
        cell.imageView = img
        cell.textField = label
        n.setContentCompressionResistancePriority(.required, for: .horizontal)
        NSLayoutConstraint.activate([
            img.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 4),
            img.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            img.widthAnchor.constraint(equalToConstant: 18),
            label.leadingAnchor.constraint(equalTo: img.trailingAnchor, constant: 7),
            label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            n.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 6),
            n.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -6),
            n.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }

    /// Where the folders' heading begins in its row: where a row's sign begins (the source list's indent 16 + the sign's 4).
    static let capIndent: CGFloat = 20
    /// The Library's rows have the system's signs; a folder the folder's own (its colour, or the sign chosen for it).
    static let smartSigns = ["smart:all": "square.stack", "smart:recent": "clock", "smart:today": "calendar", "smart:tasks": "checkmark.circle",
                             "smart:shared": "person.2", "smart:boards": "scribble.variable"]
    static func sign(_ r: [String: Any]) -> NSImage? {
        let key = r["k"] as? String ?? ""
        if let s = smartSigns[key] { return NSImage(systemSymbolName: s, accessibilityDescription: nil) }
        if (r["plain"] as? Bool) == true || (r["svg"] as? String ?? "").isEmpty {
            return NSImage(systemSymbolName: (r["kind"] as? String) == "dir" ? "folder" : "doc.text", accessibilityDescription: nil)
        }
        return NativeMenu.image(sign: "", svg: r["svg"] as? String ?? "")
    }
    /// A folder's colour as the page writes it (a theme colour's name, a #hex, an rgb()) as the system's.
    static func color(_ css: String?) -> NSColor? {
        guard var c = css?.trimmingCharacters(in: .whitespaces), !c.isEmpty else { return nil }
        if c.hasPrefix("var(--c-") { c = String(c.dropFirst(8).prefix { $0 != ")" && $0 != "," }) }
        let named: [String: NSColor] = ["red": .systemRed, "orange": .systemOrange, "yellow": .systemYellow, "green": .systemGreen, "blue": .systemBlue,
                                        "cyan": .systemCyan, "magenta": .systemPurple, "purple": .systemPurple, "pink": .systemPink, "brown": .systemBrown,
                                        "gray": .systemGray, "grey": .systemGray, "teal": .systemTeal, "indigo": .systemIndigo, "mint": .systemMint]
        if let n = named[c.lowercased().replacingOccurrences(of: "bright-", with: "")] { return n }
        if c.hasPrefix("#") {
            let h = String(c.dropFirst())
            guard h.count >= 6, let v = UInt32(h.prefix(6), radix: 16) else { return nil }
            return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
        }
        guard let m = c.range(of: #"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)"#, options: .regularExpression) else { return nil }
        let nums = c[m].components(separatedBy: CharacterSet(charactersIn: "rgba(), ")).compactMap(Double.init)
        guard nums.count >= 3 else { return nil }
        return NSColor(srgbRed: nums[0] / 255, green: nums[1] / 255, blue: nums[2] / 255, alpha: 1)
    }

    /// The pointer on the peeking card, told to the page as a pointer over its own card (drawer.js pointerAt).
    private func pointer(at p: NSPoint) {
        guard stand == "peek", let w else { return }
        let v = w.web.convert(p, from: nil)
        let x = Int(v.x), y = Int(w.web.isFlipped ? v.y : w.web.bounds.height - v.y)
        page("document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: \(x), clientY: \(y), bubbles: true }))")
    }

    // MARK: what the card's hand does: the page's own

    private func page(_ js: String) { guard let w, w.ready else { return }; w.web.evaluateJavaScript(js, completionHandler: nil) }
    @objc private func clicked(_ t: NSTableView) { activate(t.clickedRow) }
    /// Row i chosen by a hand: the page's row is clicked.
    func activate(_ i: Int) {
        guard rows.indices.contains(i), let key = rows[i]["k"] as? String else { return }
        page("window.__macSb && __macSb('click', \(jsonString(key)))")
    }
    private func rightClicked(_ i: Int, _ e: NSEvent) {
        guard rows.indices.contains(i), let key = rows[i]["k"] as? String else { return }
        (w?.web as? FilesWebView)?.lastRightDown = e // (the menu stands where the hand is: NativeMenu.swift)
        page("window.__macSb && __macSb('ctx', \(jsonString(key)))")
    }
    @objc private func searched(_ f: NSSearchField) { page("window.__macSb && __macSb('search', '', \(jsonString(f.stringValue)))") }
    @objc private func newMenu(_ s: Any?) { page("window.__macSb && __macSb('act', 'newmenu')") }
    @objc private func historyMenu(_ s: Any?) { page("window.__macSb && __macSb('act', 'historymenu')") }
    @objc private func settings(_ s: Any?) { page("window.__macSb && __macSb('settings')") }

    // MARK: files dropped on a folder: moved there (a note of the folder) or taken in (from elsewhere)

    func tableView(_ t: NSTableView, validateDrop info: NSDraggingInfo, proposedRow row: Int, proposedDropOperation op: NSTableView.DropOperation) -> NSDragOperation {
        guard rows.indices.contains(row), rows[row]["kind"] as? String == "dir" else { return [] }
        t.setDropRow(row, dropOperation: .on)
        return .move
    }
    func tableView(_ t: NSTableView, acceptDrop info: NSDraggingInfo, row: Int, dropOperation op: NSTableView.DropOperation) -> Bool {
        guard let w, let dir = rows[row]["k"] as? String, let root = w.folder else { return false }
        let urls = (info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
        guard !urls.isEmpty else { return false }
        let inside = urls.filter { Lib.resolve($0.path).hasPrefix(root + "/") }, outside = urls.filter { !Lib.resolve($0.path).hasPrefix(root + "/") }
        for u in inside { w.on("move", ["path": Lib.resolve(u.path), "dir": dir]) }
        if !outside.isEmpty { w.on("import", ["uris": outside.map(\.absoluteString), "dir": dir]) }
        return true
    }

    /// What the page is given for the system's card: its own card unseen while that one is used, and a word whenever what
    /// its card holds, or how it stands, changes.
    static let script = """
    (function () {
      var html = document.documentElement;
      var css = ":root[data-mac-sb] #sidebar{background:transparent!important;box-shadow:none!important}" +
        ":root[data-mac-sb] #sidebar>*{visibility:hidden!important}" +
        ":root[data-mac-sb] body::before{visibility:hidden!important}" +
        ":root[data-mac-sb] #settings-btn{visibility:hidden!important}";
      var style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      var start = function () {
        var q = function (s) { return document.querySelector(s); };
        var sb = q("#sidebar");
        if (!sb) return;
        window.__macSbOn = function (on) { html.toggleAttribute("data-mac-sb", !!on); };
        var find = function (key) {
          if (key.indexOf("smart:") === 0) return q('#sidebar .sb-lib[data-smart="' + key.slice(6) + '"]');
          var item = q('#sidebar .sb-item[data-key="' + CSS.escape(key) + '"]');
          return item && (item.querySelector(".sb-row") || item);
        };
        window.__macSb = function (what, key, text) {
          if (what === "search") { var f = q("#sidebar .qn-search"); if (f) { f.value = text; f.dispatchEvent(new Event("input", { bubbles: true })); } return; }
          if (what === "settings") { var g = q("#settings-btn"); if (g) g.click(); return; }
          if (what === "act") { var b = q('#sidebar [data-act="' + key + '"]'); if (b) b.click(); return; }
          var el = find(key);
          if (!el) return;
          if (what === "click") el.click();
          else if (what === "ctx") {
            var r = el.getBoundingClientRect();
            el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2, button: 2 }));
          }
        };
        var was = "", soon = 0, rowsSoon = 0, glide = false, rows = [], rowsDirty = true;
        var text = function (el) { return el ? el.textContent.trim() : ""; };
        // (what is shown of the card, read without asking for its layout: what the library hides is hidden by its sheet or [hidden])
        var shown = function (el) { return !el.closest("[hidden], .sb-rail, .sb-crumb, .sb-recent, .sb-foot") && !el.closest(".sb-item.is-dir .sb-kids, .sb-item:not(.open) > .sb-kids"); };
        var readRows = function () {
          var out = [], P = window.MdPage || {};
          var searching = !!((q("#sidebar .qn-search") || {}).value || "").trim();
          document.querySelectorAll("#sidebar .sb-lib, #sidebar .sb-cap-folders, #sidebar .sb-item").forEach(function (el) {
            if (!shown(el)) return;
            var flat = !!el.closest(".sb-flat");
            if (searching ? !flat : flat) return; // (searched: the notes found alone; else the Library and the folders)
            if (el.classList.contains("sb-lib")) { out.push({ k: "smart:" + el.dataset.smart, kind: "smart", label: text(el.querySelector(".sb-label")), n: text(el.querySelector(".sb-lib-n")), on: el.classList.contains("on") }); return; }
            if (el.classList.contains("sb-cap-folders")) { out.push({ kind: "cap", label: text(el) }); return; }
            var dir = el.classList.contains("is-dir");
            if (!flat && !dir) return; // (the library lists the folders, not their notes)
            var row = el.querySelector(".sb-row") || el, icon = el.querySelector(".sb-icon"), tail = el.querySelector(".sb-tail");
            var c = (el.style.getPropertyValue("--c") || (row.style && row.style.getPropertyValue("--c")) || "").trim();
            out.push({ k: el.dataset.key, kind: dir ? "dir" : "note", label: text(el.querySelector(".sb-label")),
              n: tail ? (tail.dataset.says || "") : "", on: row.classList.contains("on") || row.classList.contains("active") || el.classList.contains("active"),
              svg: icon ? icon.innerHTML : "", plain: !c && !!icon && !!P.ICON && (icon.innerHTML === P.ICON.folder || icon.innerHTML === P.ICON.note), color: c });
          });
          return out;
        };
        var sbw = function () { var v = (document.documentElement.style.getPropertyValue("--sb-w") || "").trim(); return /px$/.test(v) ? parseFloat(v) : 260; };
        var tell = function () {
          soon = 0;
          var b = document.body, P = window.MdPage || {}, f = P.folder;
          var on = sb.dataset.layout === "library" && !!f && !f.quick && !b.hasAttribute("data-focus") && !html.hasAttribute("data-ipad");
          if (on && rowsDirty) { rows = readRows(); rowsDirty = false; }
          var hb = q('#sidebar [data-act="historymenu"]');
          var st = { on: on, state: b.dataset.sidebar || "closed", sbw: sbw(), rows: on ? rows : [],
            search: (q("#sidebar .qn-search") || {}).value || "", hist: hb ? (hb.classList.contains("warn") ? "warn" : hb.classList.contains("quiet") ? "quiet" : "") : "",
            top: parseFloat(html.style.getPropertyValue("--mac-bar")) || 52, glide: glide };
          var s = JSON.stringify(st);
          if (s !== was) { was = s; window.webkit.messageHandlers.msg.postMessage(Object.assign({ type: "macsb" }, st)); }
          glide = true;
        };
        // (how the card stands goes at once — the system's glides with it; what it holds, once the page has come to rest)
        var rowsLater = function () { rowsDirty = true; clearTimeout(rowsSoon); rowsSoon = setTimeout(tell, 120); };
        var later = function () { if (!soon) soon = setTimeout(tell, 0); };
        var mo = new MutationObserver(later);
        mo.observe(document.body, { attributes: true, attributeFilter: ["data-sidebar", "data-focus", "data-folder", "data-quick"] });
        mo.observe(html, { attributes: true, attributeFilter: ["style", "data-ipad"] });
        new MutationObserver(rowsLater).observe(sb, { attributes: true, subtree: true, childList: true, characterData: true, attributeFilter: ["class", "data-layout", "hidden", "data-says", "aria-pressed", "style"] });
        sb.addEventListener("input", rowsLater, true);
        tell();
      };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    })();
    """
}
