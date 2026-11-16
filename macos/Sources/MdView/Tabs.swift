// The tabs of a folder window: made, shown, chosen, closed, opened again, moved. Rust: shell/tabs.rs.
import Foundation

extension NoteWindow {
    func makeTab(_ p: String?) -> Tab { tabSeq += 1; return Tab(id: tabSeq, path: p.map(Lib.resolve)) }

    /// A folder below the window's (a folder's tab shows one).
    func dirOfFolder(_ d: String) -> Bool { Lib.isDir(d) && folder.map { d != $0 && d.hasPrefix($0 + "/") } ?? false }

    func tabIndex(_ id: Int) -> Int? { tabs.firstIndex { $0.id == id } }

    /// What the window shows, written into its tab.
    func stashTab() {
        guard tabs.indices.contains(tab) else { return }
        tabs[tab].path = path ?? dirTab
        tabs[tab].back = back
        tabs[tab].fwd = fwd
    }

    /// The tabs as they stand: kept for the folder's next opening, and told to the page.
    func sendTabs() {
        guard let folder else { return }
        if tabs.isEmpty { tabs = [makeTab(path)]; tab = 0 }
        stashTab()
        let kept: [String: Any] = ["paths": tabs.map { $0.path ?? "" }, "active": tab]
        var every = store.sub("tabs")
        if jsonString(every[folder] ?? NSNull()) != jsonString(kept) {
            every[folder] = kept
            if every.count > 20, let drop = every.keys.first(where: { $0 != folder }) { every[drop] = nil }
            store.set("tabs", every)
        }
        guard ready else { return }
        let payload: [String: Any] = [
            "tabs": tabs.map { t -> [String: Any] in
                var d: [String: Any] = ["id": t.id, "path": t.path as Any? ?? NSNull(), "name": t.path.map(Lib.name) ?? ""]
                if let p = t.path, Lib.isDir(p) { d["dir"] = true }
                return d
            },
            "active": tabs[tab].id, "closed": !closedTabs.isEmpty,
        ]
        let blob = jsonString(payload)
        if tabsJSON != blob { tabsJSON = blob; js("MdView.setTabs", [payload]) }
    }

    /// Tab i takes the window (the one shown before is written down already).
    func showTab(_ i: Int, fragment: String? = nil) {
        tab = i
        let t = tabs[i]
        back = t.back; fwd = t.fwd
        if let p = t.path, Lib.isFile(p) { openPath(p, fragment: fragment, push: false) }
        else if let d = t.path, dirOfFolder(d) {
            dirTab = d
            showNothing()
            dirTab = d
            setTitle(Lib.name(d))
            sendTabs()
        } else { dirTab = nil; showNothing() }
    }

    func selectTab(_ id: Int) {
        if let i = tabIndex(id), i != tab { stashTab(); showTab(i) }
    }

    func newTab(_ p: String?, fragment: String? = nil, at: Int? = nil) {
        guard folder != nil else { return }
        stashTab()
        let i = min(tabs.count, at ?? tab + 1)
        tabs.insert(makeTab(p), at: i)
        showTab(i, fragment: fragment)
    }

    func linkTab(_ p: String, _ fragment: String?, own: Bool) {
        let real = Lib.resolve(p)
        if own, let there = tabs.indices.first(where: { $0 != tab && tabs[$0].path == real }) {
            stashTab(); showTab(there, fragment: fragment)
        } else { newTab(p, fragment: fragment) }
    }

    private func remember(_ p: String, _ at: Int) {
        closedTabs.append((p, at))
        if closedTabs.count > 20 { closedTabs.removeFirst(closedTabs.count - 20) }
    }

    func closeTab(_ id: Int) {
        guard let i = tabIndex(id) else { return }
        if tabs.count == 1 {
            // the last one: its note goes, the window stays — with an empty tab (closed once more, empty as it is, the window goes with it)
            stashTab()
            guard let p = tabs[0].path, folder != nil else { return close() }
            remember(p, 0)
            tabs[0] = makeTab(nil)
            return showTab(0)
        }
        stashTab()
        let gone = tabs.remove(at: i)
        if let p = gone.path { remember(p, i) }
        if i == tab { showTab(min(i, tabs.count - 1)) } else { if i < tab { tab -= 1 }; sendTabs() }
    }

    func closeOtherTabs(_ id: Int) {
        guard let i = tabIndex(id), tabs.count > 1 else { return }
        stashTab()
        let wasShown = i == tab
        for (k, t) in tabs.enumerated() where k != i { if let p = t.path { remember(p, k) } }
        tabs = [tabs[i]]
        if wasShown { tab = 0; sendTabs() } else { showTab(0) }
    }

    func reopenTab() {
        while let (p, at) = closedTabs.popLast() {
            if Lib.isFile(p) || dirOfFolder(p) { return newTab(p, at: at) }
        }
        sendTabs()
    }

    func moveTab(_ id: Int, _ to: Int) {
        guard let i = tabIndex(id) else { return }
        stashTab()
        let shown = tabs[tab].id
        let t = tabs.remove(at: i)
        tabs.insert(t, at: min(max(to, 0), tabs.count))
        tab = tabIndex(shown) ?? 0
        sendTabs()
    }

    func tabOp(_ msg: [String: Any]) {
        guard folder != nil, !tabs.isEmpty else { return }
        var id = tabs[tab].id
        if let n = msg["id"] as? Int { id = n } else if let s = msg["id"] as? String, let n = Int(s) { id = n }
        switch msg["op"] as? String {
        case "select": selectTab(id)
        case "new":
            let d = (msg["dir"] as? String).map(Lib.resolve).flatMap { dirOfFolder($0) ? $0 : nil }
            newTab(d)
        case "close": closeTab(id)
        case "others": closeOtherTabs(id)
        case "reopen": reopenTab()
        case "move":
            if let to = (msg["to"] as? Int) ?? (msg["to"] as? String).flatMap({ Int($0.trimmingCharacters(in: .whitespaces)) }) { moveTab(id, to) }
        default: break
        }
    }
}
