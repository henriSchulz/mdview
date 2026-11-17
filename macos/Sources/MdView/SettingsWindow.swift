// The settings are a window of the system's (Phase 5 of the native work, 2026-11-17): ⌘, and the gear open it, a window of
// its own as every Mac application has — its pages at the left in their groups, each page's settings in grouped forms at
// the right (SwiftUI). What the settings are comes from the page (MdView.settingsSchema: active/prefs.js — the pages, the
// rows, their names, hints and choices in the page's language), so a setting added there is here too. A change is kept
// and told to every window as one made in a page is (AppDelegate.applyPrefs). Rows of a kind drawn only by the page — the
// GitHub sign-in, a repository, the model's key, the history's state, the keys of a quick note, what the app says of
// itself — are reached from their page here: the page's own settings, opened there.
import AppKit
import SwiftUI
import WebKit

struct SettingsRow: Identifiable {
    let key, kind, name, hint, when: String
    let choices: [(value: Any, label: String)]
    var id: String { key }
}
struct SettingsSection: Identifiable { let id: Int; let title: String; let rows: [SettingsRow] }
struct SettingsPage: Identifiable { let id, sign, title: String; let sections: [SettingsSection] }
struct SettingsGroup: Identifiable { let id: Int; let title: String; let pages: [String] }

final class SettingsModel: ObservableObject {
    @Published var pages: [SettingsPage] = []
    @Published var groups: [SettingsGroup] = []
    @Published var values: [String: Any] = [:]
    @Published var page: String? = "general"
    @Published var said: String = ""
    var later: [String: String] = [:]
    var velum = false
    /// The kinds this window draws itself; the others are the page's.
    static let drawn: Set<String> = ["switch", "select", "text"]
    /// What has no meaning on a Mac (or a build from the sources): not shown.
    static let notHere: Set<String> = ["hinting", "updateCheck", "updateAuto"]

    func load(_ s: [String: Any]) {
        velum = (s["velum"] as? Bool) ?? false
        later = (s["later"] as? [String: String]) ?? [:]
        values = (s["values"] as? [String: Any]) ?? [:]
        groups = ((s["groups"] as? [[String: Any]]) ?? []).enumerated().map { i, g in
            SettingsGroup(id: i, title: g["title"] as? String ?? "", pages: g["pages"] as? [String] ?? [])
        }
        pages = ((s["pages"] as? [[String: Any]]) ?? []).map { p in
            SettingsPage(id: p["id"] as? String ?? "", sign: p["sign"] as? String ?? "", title: p["title"] as? String ?? "",
                         sections: ((p["sections"] as? [[String: Any]]) ?? []).enumerated().map { i, sec in
                SettingsSection(id: i, title: sec["title"] as? String ?? "", rows: ((sec["rows"] as? [[String: Any]]) ?? []).map { r in
                    SettingsRow(key: r["key"] as? String ?? "", kind: r["kind"] as? String ?? "", name: r["name"] as? String ?? "",
                                hint: r["hint"] as? String ?? "", when: r["when"] as? String ?? "",
                                choices: ((r["choices"] as? [[Any]]) ?? []).compactMap { c in c.count == 2 ? (c[0], c[1] as? String ?? "\(c[1])") : nil })
                })
            })
        }
    }

    /// Settings as they are now (a change made anywhere): the window follows.
    func took(_ prefs: [String: Any]) { for (k, v) in prefs { values[k] = v } }

    /// Whether a row is shown: its kind is this window's, it means something here, and what it waits for is so.
    func shows(_ r: SettingsRow) -> Bool {
        guard SettingsModel.drawn.contains(r.kind), !SettingsModel.notHere.contains(r.key) else { return false }
        if r.key == "look" && !velum { return false }
        if !r.when.isEmpty, (values["style"] as? String) != r.when { return false }
        return true
    }
    /// A page has rows of the page's own: they are reached from here.
    func hasOwn(_ p: SettingsPage) -> Bool {
        p.sections.contains { $0.rows.contains { !SettingsModel.drawn.contains($0.kind) && !SettingsModel.notHere.contains($0.key) } }
    }

    func set(_ key: String, _ value: Any) {
        if let now = values[key], "\(now)" == "\(value)" { return }
        values[key] = value
        AppDelegate.shared.applyPrefs([key: value])
        said = later[key] ?? ""
    }
}

// MARK: the window

final class SettingsWindow: NSObject, NSWindowDelegate {
    static let shared = SettingsWindow()
    let model = SettingsModel()
    private(set) var window: NSWindow?

    /// The page to ask what the settings are: the window's given, else any window's, else the spare's.
    private func pageWindow(_ from: NoteWindow?) -> NoteWindow? {
        if let from, from.ready { return from }
        let app = AppDelegate.shared!
        return app.windows.first { $0.ready } ?? (app.spare?.ready == true ? app.spare : nil)
    }

    func open(from: NoteWindow?, page: String? = nil) {
        if let window, window.isVisible, !model.pages.isEmpty {
            if let page { model.page = page }
            window.makeKeyAndOrderFront(nil)
            return
        }
        guard let w = pageWindow(from) else { return }
        w.web.callAsyncJavaScript("return await MdView.settingsSchema()", arguments: [:], in: nil, in: .page) { [weak self] r in
            guard let self, case .success(let v) = r, let s = v as? [String: Any] else { return }
            self.model.load(s)
            if let page { self.model.page = page }
            self.show()
        }
    }

    private func show() {
        if window == nil {
            let host = NSHostingController(rootView: SettingsView(model: model))
            let win = NSWindow(contentViewController: host)
            win.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
            win.titlebarAppearsTransparent = true
            win.toolbarStyle = .unified
            win.isReleasedWhenClosed = false
            win.setContentSize(NSSize(width: 760, height: 540))
            win.minSize = NSSize(width: 620, height: 400)
            win.delegate = self
            win.setFrameAutosaveName("md.settings")
            if !win.setFrameUsingName("md.settings") { win.center() }
            window = win
        }
        window?.title = model.pages.isEmpty ? "Settings" : (model.groups.isEmpty ? "Settings" : titleOf())
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    private func titleOf() -> String { (Store.shared.prefs["lang"] as? String) == "de" ? "Einstellungen" : "Settings" }

    /// A page's own rows: these settings, in the window's page, at that page.
    func openInPage(_ id: String) {
        guard let w = AppDelegate.shared.keyNote ?? AppDelegate.shared.windows.first(where: { $0.ready }) else { return }
        w.window.makeKeyAndOrderFront(nil)
        w.web.evaluateJavaScript("MdPage.loadActive().then(function () { MdActive.prefs.open(\(jsonString(id))); })", completionHandler: nil)
    }
}

// MARK: the views

struct SettingsView: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        NavigationSplitView {
            List(selection: $model.page) {
                ForEach(model.groups) { g in
                    Section(g.title) {
                        ForEach(g.pages, id: \.self) { id in
                            if let p = model.pages.first(where: { $0.id == id }) {
                                Label(p.title, systemImage: SettingsView.sign(p.sign)).tag(Optional(id))
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 260)
        } detail: {
            if let p = model.pages.first(where: { $0.id == model.page }) {
                SettingsPageView(model: model, page: p)
            }
        }
    }

    static func sign(_ s: String) -> String {
        ["gear": "gearshape", "title": "textformat", "sidebar": "sidebar.left", "apps": "square.grid.2x2", "history": "clock.arrow.circlepath",
         "pencil": "pencil", "source": "chevron.left.forwardslash.chevron.right", "sigma": "function", "pdf": "doc.richtext", "spark": "sparkles",
         "info": "info.circle"][s] ?? "gearshape"
    }
}

struct SettingsPageView: View {
    @ObservedObject var model: SettingsModel
    let page: SettingsPage

    var body: some View {
        Form {
            ForEach(page.sections) { sec in
                let rows = sec.rows.filter { model.shows($0) }
                if !rows.isEmpty {
                    Section {
                        ForEach(rows) { r in SettingsRowView(model: model, row: r) }
                    } header: {
                        if !sec.title.isEmpty { Text(sec.title) }
                    }
                }
            }
            if model.hasOwn(page) {
                Section {
                    Button(model.values["lang"] as? String == "de" ? "Weitere Einstellungen dieser Seite …" : "More Settings of This Page…") {
                        SettingsWindow.shared.openInPage(page.id)
                    }
                }
            }
            if !model.said.isEmpty {
                Section { Text(model.said).foregroundStyle(.secondary) }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(page.title)
    }
}

struct SettingsRowView: View {
    @ObservedObject var model: SettingsModel
    let row: SettingsRow
    @State private var text = ""

    private var label: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(row.name)
            if !row.hint.isEmpty { Text(row.hint).font(.caption).foregroundStyle(.secondary) }
        }
    }

    var body: some View {
        switch row.kind {
        case "switch":
            Toggle(isOn: Binding(get: { (model.values[row.key] as? Bool) ?? ((model.values[row.key] as? NSNumber)?.boolValue ?? false) },
                                 set: { model.set(row.key, $0) })) { label }
        case "select":
            Picker(selection: Binding(get: { "\(model.values[row.key] ?? "")" },
                                      set: { v in if let c = row.choices.first(where: { "\($0.value)" == v }) { model.set(row.key, c.value) } })) {
                ForEach(Array(row.choices.enumerated()), id: \.offset) { _, c in Text(c.label).tag("\(c.value)") }
            } label: { label }
            .pickerStyle(.menu)
        default:
            TextField(text: $text, prompt: Text("")) { label }
                .onAppear { text = model.values[row.key] as? String ?? "" }
                .onSubmit { model.set(row.key, text) }
                .onDisappear { model.set(row.key, text) }
        }
    }
}
