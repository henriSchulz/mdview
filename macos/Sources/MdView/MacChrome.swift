// The window's bar is the system's (Phase 3 of the native work, 2026-11-17): the title bar is clear and holds no title,
// an NSToolbar holds what the page's strip and capsule held — the sidebar, back and forward, All Notes; the outline, find,
// share and the modes — as SF Symbols, the window's buttons in the same row. The page keeps doing what the buttons do: a
// button of the bar clicks the page's own (unseen, still laid out, so what hangs from one hangs under the bar's), and the
// page says how its buttons stand (`macbar`, a script of the window's own) — nothing of what they do is written twice.
// The page is told how high the bar is (--mac-bar); under it the note goes on, seen through it (#mac-bar). The tabs stand in
// a row under the bar while there are two or more, as the Finder's and Safari's.
import AppKit
import WebKit

extension NSToolbarItem.Identifier {
    static let mdSidebar = Self("md.sidebar"), mdNav = Self("md.nav"), mdOverview = Self("md.overview")
    static let mdSync = Self("md.sync"), mdFolder = Self("md.notefolder"), mdOutline = Self("md.outline"), mdFind = Self("md.find")
    static let mdShare = Self("md.share"), mdMode = Self("md.mode")
}

final class MacChrome: NSObject, NSToolbarDelegate {
    weak var w: NoteWindow?
    let toolbar = NSToolbar(identifier: "md.bar")
    private var items: [NSToolbarItem.Identifier: NSToolbarItem] = [:]
    private(set) var state: [String: Any] = [:]
    static let modes = ["read", "active", "edit", "split"]

    init(_ w: NoteWindow) {
        self.w = w
        super.init()
        toolbar.delegate = self
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        let win = w.window
        win.titlebarAppearsTransparent = true
        win.titleVisibility = .hidden
        win.toolbarStyle = .unified
        win.toolbar = toolbar
        toolbar.isVisible = false // (until there is a note or a folder: the start screen has none)
    }

    // MARK: the items

    func toolbarDefaultItemIdentifiers(_ t: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.mdSidebar, .mdNav, .mdOverview, .mdSync, .mdFolder, .flexibleSpace, .mdOutline, .mdFind, .mdShare, .mdMode]
    }
    func toolbarAllowedItemIdentifiers(_ t: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(t) }

    func toolbar(_ t: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let T = { (en: String, de: String) in (Store.shared.prefs["lang"] as? String) == "de" ? de : en }
        let item: NSToolbarItem
        switch id {
        case .mdSidebar: item = button(id, "sidebar.left", T("Sidebar", "Seitenleiste"), "sidebar"); item.visibilityPriority = .high
        case .mdNav:
            let g = NSToolbarItemGroup(itemIdentifier: id, images: [symbol("chevron.left"), symbol("chevron.right")], selectionMode: .momentary,
                                       labels: [T("Back", "Zurück"), T("Forward", "Vor")], target: self, action: #selector(navigate(_:)))
            g.controlRepresentation = .expanded
            g.label = T("Back/Forward", "Zurück/Vor")
            item = g
        case .mdOverview: item = button(id, "square.grid.2x2", T("All Notes", "Alle Notizen"), "overview")
        case .mdSync: item = button(id, "arrow.triangle.2.circlepath", T("Sync Now", "Jetzt abgleichen"), "syncnow")
        case .mdFolder: item = button(id, "folder", T("Open Its Folder", "Ordner öffnen"), "notefolder")
        case .mdOutline: item = button(id, "list.bullet.indent", T("Outline", "Gliederung"), "outline")
        case .mdFind: item = button(id, "magnifyingglass", T("Find", "Suchen"), "find")
        case .mdShare: item = button(id, "square.and.arrow.up", T("Share", "Teilen"), "share")
        case .mdMode:
            let g = NSToolbarItemGroup(itemIdentifier: id, images: ["book", "pencil", "chevron.left.forwardslash.chevron.right", "rectangle.split.2x1"].map(symbol),
                                       selectionMode: .selectOne,
                                       labels: [T("Read", "Lesen"), T("Write", "Schreiben"), T("Source", "Quelltext"), T("Source and Reading", "Quelltext und Lesen")],
                                       target: self, action: #selector(chooseMode(_:)))
            g.controlRepresentation = .expanded
            g.label = T("Mode", "Modus")
            g.setSelected(true, at: 0)
            g.visibilityPriority = .high
            item = g
        default: return nil
        }
        items[id] = item
        return item
    }

    private func symbol(_ name: String) -> NSImage { NSImage(systemSymbolName: name, accessibilityDescription: nil) ?? NSImage() }

    private var acts: [NSToolbarItem.Identifier: String] = [:]
    private func button(_ id: NSToolbarItem.Identifier, _ sym: String, _ label: String, _ act: String) -> NSToolbarItem {
        let it = NSToolbarItem(itemIdentifier: id)
        it.image = NSImage(systemSymbolName: sym, accessibilityDescription: label)
        it.label = label
        it.toolTip = label
        it.isBordered = true
        it.target = self
        it.action = #selector(fire(_:))
        acts[id] = act
        return it
    }

    // MARK: what the buttons do: the page's own buttons, clicked

    @objc private func fire(_ s: NSToolbarItem) { if let a = acts[s.itemIdentifier] { act(a) } }
    @objc private func navigate(_ g: NSToolbarItemGroup) { act(g.selectedIndex == 0 ? "navback" : "navfwd") }
    @objc private func chooseMode(_ g: NSToolbarItemGroup) {
        guard MacChrome.modes.indices.contains(g.selectedIndex) else { return }
        act("mode", mode: MacChrome.modes[g.selectedIndex])
    }

    func act(_ a: String, mode: String? = nil) {
        guard let w, w.ready else { return }
        w.web.evaluateJavaScript("window.__macAct && __macAct(\(jsonString(a)), \(mode.map(jsonString) ?? "null"))", completionHandler: nil)
    }

    // MARK: how the page's buttons stand (macbar)

    func update(_ s: [String: Any]) {
        state = s
        guard let w else { return }
        let b = { (k: String) in (s[k] as? Bool) == true }
        // (a spare has its bar already: what it is taken for is mostly a note or a folder, and a bar that comes then lays the
        // window out anew — 55 ms of the 70 the shell took to show a spare's note)
        let shown = (w.path != nil || w.folder != nil || w.isSpare) && !b("focus")
        if toolbar.isVisible != shown { toolbar.isVisible = shown; tellHeight() }
        let note = !b("nonote"), folder = b("folder")
        items[.mdOutline]?.isEnabled = note
        items[.mdFind]?.isEnabled = note || b("overview")
        items[.mdShare]?.isEnabled = note
        if let g = items[.mdMode] as? NSToolbarItemGroup {
            g.isEnabled = note && !b("overview")
            if let i = MacChrome.modes.firstIndex(of: s["mode"] as? String ?? "read"), g.selectedIndex != i { g.setSelected(true, at: i) }
        }
        if let g = items[.mdNav] as? NSToolbarItemGroup {
            g.subitems.first?.isEnabled = b("back")
            g.subitems.last?.isEnabled = b("fwd")
        }
        items[.mdSidebar]?.isEnabled = folder
        items[.mdOverview]?.isEnabled = folder
        if #available(macOS 15, *) {
            items[.mdSidebar]?.isHidden = !folder
            items[.mdOverview]?.isHidden = !folder
            items[.mdSync]?.isHidden = !b("sync")
            items[.mdFolder]?.isHidden = folder
        }
    }

    /// The bar's height, told to the page (--mac-bar): its note, sidebar and All Notes begin under it.
    func tellHeight() {
        guard let w, w.ready, let v = w.window.contentView else { return }
        let top = max(0, v.bounds.height - w.window.contentLayoutRect.height)
        w.web.evaluateJavaScript("document.documentElement.style.setProperty('--mac-bar', '\(Int(top.rounded()))px')", completionHandler: nil)
    }

    /// What the page is given on macOS: its own buttons of the bar out of sight (still there, still clicked), the band under
    /// the bar, and a word to the shell whenever a button of its changes.
    static let script = """
    (function () {
      var html = document.documentElement;
      html.setAttribute("data-mac", "");
      var css = ":root[data-mac]{--tabs-h:var(--mac-bar,52px)}" +
        ":root[data-mac][data-mac-tabs]{--tabs-h:calc(var(--mac-bar,52px) + 40px)}" +
        ":root[data-mac] #toolbar{visibility:hidden!important;pointer-events:none!important}" +
        ":root[data-mac] #tabs{background:transparent!important;padding-top:calc(var(--mac-bar,52px) + 2px)!important}" +
        ":root[data-mac] #tabs::after{display:none!important}" +
        ":root[data-mac] #tabs :is(.tab-side,.tab-nav,[data-act=overview],.tab-sync){display:none!important}" +
        ":root[data-mac]:not([data-mac-tabs]) #tabs .tab-row{visibility:hidden!important}" +
        "#mac-bar{position:fixed;top:0;left:0;right:0;height:calc(var(--tabs-h) + 16px);z-index:14;pointer-events:none;" +
        "-webkit-mask-image:linear-gradient(#000 calc(100% - 16px),transparent);mask-image:linear-gradient(#000 calc(100% - 16px),transparent);" +
        "background:color-mix(in srgb,var(--bg) 74%,transparent);-webkit-backdrop-filter:saturate(1.8) blur(18px);backdrop-filter:saturate(1.8) blur(18px)}" +
        "body[data-focus] #mac-bar,body:not([data-tabs])[data-nonote] #mac-bar{display:none}" +
        ":root[data-mac] body:not([data-tabs]) :is(#content,#active,#editor){padding-top:calc(var(--mac-bar,52px) + 28px)}" +
        ":root[data-mac] #sidebar{padding-top:calc(var(--mac-bar,52px) - var(--sb-inset,8px))}" +
        ":root[data-mac] :is(#ctxmenu,.actmenu){--accent:var(--c-accent)}";
      var style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      var start = function () {
        var bar = document.createElement("div");
        bar.id = "mac-bar";
        document.body.appendChild(bar);
        window.__macAct = function (act, mode) {
          var b = mode ? document.querySelector('#toolbar .seg-btn[data-mode="' + mode + '"]')
            : document.querySelector('#toolbar [data-act="' + act + '"], #tabs [data-act="' + act + '"]');
          if (b && !b.disabled) b.click();
        };
        var was = "", soon = 0;
        var q = function (s) { return document.querySelector(s); };
        var tell = function () {
          soon = 0;
          var b = document.body, P = window.MdPage || {};
          var tabs = document.querySelectorAll("#tabs .tab-list > .tab:not(.leaving)").length;
          html.toggleAttribute("data-mac-tabs", b.hasAttribute("data-tabs") && tabs > 1);
          var back = q('#tabs [data-act="navback"]'), fwd = q('#tabs [data-act="navfwd"]'), seg = q('#toolbar .seg-btn[aria-checked="true"]');
          var sync = q('#tabs .tab-sync');
          var st = { nonote: b.hasAttribute("data-nonote"), folder: !!P.folder, sidebar: b.dataset.sidebar || "",
            focus: b.hasAttribute("data-focus"),
            overview: b.hasAttribute("data-overview"), back: !!back && !back.disabled, fwd: !!fwd && !fwd.disabled,
            mode: seg ? seg.dataset.mode : "read", sync: !!sync && b.hasAttribute("data-linked"), tabs: tabs };
          var s = JSON.stringify(st);
          if (s !== was) { was = s; window.webkit.messageHandlers.msg.postMessage(Object.assign({ type: "macbar" }, st)); }
        };
        var later = function () { if (!soon) soon = setTimeout(tell, 0); };
        var mo = new MutationObserver(later);
        mo.observe(document.body, { attributes: true, attributeFilter: ["data-sidebar", "data-nonote", "data-focus", "data-overview", "data-tabs", "data-linked", "data-folder"] });
        var watch = function () {
          ["#toolbar", "#tabs"].forEach(function (s) { var el = q(s); if (el) mo.observe(el, { attributes: true, subtree: true, childList: true, attributeFilter: ["disabled", "aria-checked", "class"] }); });
        };
        watch();
        tell();
      };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    })();
    """
}

extension NoteWindow {
    // (full screen: the bar's height changes with it — and left by the window's own button, the page's focus ends too,
    // which it did not hear of before)
    func windowDidEnterFullScreen(_ n: Notification) { chrome?.tellHeight() }
    func windowDidExitFullScreen(_ n: Notification) {
        chrome?.tellHeight()
        if ready { web.evaluateJavaScript("document.body.hasAttribute('data-focus') && window.MdPage && MdPage.setFocus && MdPage.setFocus(false)", completionHandler: nil) }
    }
}
