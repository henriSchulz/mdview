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
    /// What only the shell knows, of the window the settings were opened from (its folder's history, GitHub): settings-info.
    @Published var info: [String: Any] = [:]
    /// The repositories' chooser on show: "link", "get" or "new".
    @Published var chooser: String?
    var later: [String: String] = [:]
    var strings: [String: String] = [:]
    var velum = false
    /// The kinds this window draws itself; the others are the page's.
    static let drawn: Set<String> = ["switch", "select", "text", "historyState", "about", "link", "github", "get"]
    /// What has no meaning on a Mac (or a build from the sources): not shown.
    static let notHere: Set<String> = ["hinting", "updateCheck", "updateAuto"]

    func load(_ s: [String: Any]) {
        velum = (s["velum"] as? Bool) ?? false
        later = (s["later"] as? [String: String]) ?? [:]
        strings = (s["strings"] as? [String: String]) ?? [:]
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
        switch r.kind {
        case "about": return !(value(r.key) ?? "").isEmpty // (only what there is to say)
        case "link": return ["project", "inside"].contains(historyState) // (a project's to link)
        case "get": return github["user"] is [String: Any]
        default: return true
        }
    }

    // MARK: the history and GitHub, as the shell tells them (History.swift historySettingsInfo)

    /// A word of the page's, filled: {0}, {1} … and %s.
    func t(_ key: String, _ args: String...) -> String {
        var out = strings[key] ?? key
        for (i, a) in args.enumerated() { out = out.replacingOccurrences(of: "{\(i)}", with: a) }
        if let a = args.first { out = out.replacingOccurrences(of: "%s", with: a) }
        return out
    }
    var history: [String: Any] { info["history"] as? [String: Any] ?? [:] }
    var github: [String: Any] { info["github"] as? [String: Any] ?? [:] }
    /// How the folder stands (active/prefs.js historyState): none, project, inside, foreign — or a repository of someone's
    /// that was a project here (paused) or can be one (adopt).
    var historyState: String {
        let h = history, st = h["state"] as? String ?? "none"
        if st == "foreign", (h["own"] as? Bool) == true { return (h["was"] as? Bool) == true ? "paused" : "adopt" }
        return st
    }
    /// An about-row's value (the history's rows as the page words them: active/prefs.js historyRows).
    func value(_ key: String) -> String? {
        let h = history, home = info["home"] as? String ?? ""
        let num = { (k: String) in (h[k] as? NSNumber)?.intValue }
        switch key {
        case "historyName": return h["name"] as? String
        case "historyRoot":
            guard let r = h["root"] as? String else { return nil }
            return !home.isEmpty && r.hasPrefix(home) ? "~" + r.dropFirst(home.count) : r
        case "historyBranch": return h["root"] == nil ? nil : (h["branch"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? t("prefs.history.noBranch")
        case "historyCount": return h["root"] == nil ? nil : num("versions").map(String.init)
        case "historyLast":
            guard let last = h["last"] as? [String: Any], let time = (last["time"] as? NSNumber)?.doubleValue else { return nil }
            let f = DateFormatter()
            f.dateStyle = .medium; f.timeStyle = .short
            f.locale = Locale(identifier: (values["lang"] as? String) == "de" ? "de_DE" : "en_GB")
            let device = (last["device"] as? String ?? "").replacingOccurrences(of: #" \([0-9a-f-]{36}\)$"#, with: "", options: .regularExpression)
            return f.string(from: Date(timeIntervalSince1970: time)) + " · " + device
        case "historyChanged":
            let st = h["state"] as? String
            guard st == "project" || st == "inside" else { return nil }
            let n = num("changed") ?? 0
            if n == 0 { return t("prefs.history.allKept") }
            return t(((h["waiting"] as? Bool) == true ? "prefs.history.waiting" : "prefs.history.changed") + (n == 1 ? ".one" : ""), String(n))
        default:
            if let v = info[key] as? String { return v }
            return (info[key] as? NSNumber).map { "\($0)" }
        }
    }
    /// How a linked project stands to its other side (active/prefs.js: the link row).
    var syncSays: String {
        let sync = history["sync"] as? [String: Any] ?? [:], files = (sync["files"] as? [Any])?.count ?? 0
        switch sync["state"] as? String {
        case "conflict": return t(files == 1 ? "prefs.sync.conflict.one" : "prefs.sync.conflict", String(files))
        case "offline": return t("prefs.sync.offline")
        case "signin": return t("prefs.sync.signin")
        case "error": return sync["why"] as? String ?? ""
        case "even": return t("prefs.sync.even")
        default: return t("prefs.sync.new")
        }
    }
    struct Repo: Identifiable { let name, url, branch: String; let isPrivate: Bool; var id: String { url } }
    var repos: [Repo]? {
        guard let list = github["repos"] as? [[String: Any]] else { return nil }
        return list.map { Repo(name: $0["name"] as? String ?? "", url: $0["url"] as? String ?? "", branch: $0["branch"] as? String ?? "main",
                               isPrivate: ($0["private"] as? Bool) ?? false) }
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

    /// The window the settings were opened from: its folder's history is the one shown, what is done to it is done there.
    weak var source: NoteWindow?

    func open(from: NoteWindow?, page: String? = nil) {
        if let from { source = from } else if source == nil { source = AppDelegate.shared.keyNote }
        source?.sendSettingsInfo()
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

    /// What the shell told a window's settings (settings-info): the settings window's, if it is that window's.
    func heard(_ info: [String: Any], from w: NoteWindow) {
        if source == nil { source = w }
        guard source === w else { return }
        model.info = info
        // (signed in, the repositories are read once — again when the window opens: what the app is given may have changed)
        if (model.github["user"] is [String: Any]), model.github["repos"] is NSNull || model.github["repos"] == nil, !askedRepos {
            askedRepos = true
            history("github-repos")
        }
        if !(model.github["user"] is [String: Any]) { askedRepos = false }
    }
    private var askedRepos = false

    /// A step of the history or of GitHub, done as the page's would be (History.swift handleHistory), in the source window.
    func history(_ type: String, _ msg: [String: Any] = [:]) {
        guard let w = source ?? AppDelegate.shared.keyNote ?? AppDelegate.shared.windows.first else { return }
        var m = msg
        m["type"] = type
        _ = w.handleHistory(type, m)
    }

    func windowWillClose(_ n: Notification) { askedRepos = false; model.chooser = nil }

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
        .sheet(isPresented: Binding(get: { model.chooser != nil }, set: { if !$0 { model.chooser = nil } })) { RepoChooser(model: model) }
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
        case "about":
            LabeledContent { Text(model.value(row.key) ?? "").textSelection(.enabled).multilineTextAlignment(.trailing) } label: { label }
        case "historyState":
            let st = model.historyState
            let fixed = (model.history["fixed"] as? Bool) == true
            LabeledContent {
                HStack {
                    Text(model.t("prefs.history.is." + st)).foregroundStyle(.secondary)
                    if !(st == "inside" || st == "foreign" || (st == "project" && fixed)) {
                        Button(model.t(st == "adopt" ? "prefs.history.adopt" : st == "project" ? "prefs.history.offDo" : "prefs.history.on")) {
                            SettingsWindow.shared.history(st == "project" ? "history-disable" : "history-enable")
                        }
                    }
                }
            } label: { label }
        case "link":
            let linked = model.history["linked"] as? String
            let signedIn = model.github["user"] is [String: Any]
            LabeledContent {
                HStack {
                    if let linked {
                        let short = linked.replacingOccurrences(of: #"^https?://[^/]+/"#, with: "", options: .regularExpression)
                            .replacingOccurrences(of: #"\.git$"#, with: "", options: .regularExpression)
                        Text(short + " · " + model.syncSays).foregroundStyle(.secondary).textSelection(.enabled)
                        if (model.history["fixed"] as? Bool) != true {
                            Button(model.t("prefs.github.unlink")) { SettingsWindow.shared.history("history-link", ["url": ""]) }
                        }
                    } else {
                        Text(model.t(signedIn ? "prefs.github.unlinked" : "prefs.github.first")).foregroundStyle(.secondary)
                        if signedIn { Button(model.t("prefs.github.link")) { model.chooser = "link" } }
                    }
                }
            } label: { label }
        case "github":
            GitHubRowView(model: model, label: AnyView(label))
        case "get":
            LabeledContent {
                Button(model.t("prefs.github.get")) { model.chooser = "get" }
            } label: { label }
        default:
            // (empty, what is taken then: the computer's name, the model the app uses, the quick notes' folder — as the page's)
            let prompt = row.key == "deviceName" ? (model.info["deviceName"] as? String ?? "") : row.key == "aiModel" ? (model.info["aiModel"] as? String ?? "")
                : row.key == "quickDir" ? "~/Documents/Notizen/QuickNotes" : ""
            TextField(text: $text, prompt: Text(prompt.isEmpty ? "—" : prompt)) { label }
                .onAppear { text = model.values[row.key] as? String ?? "" }
                .onSubmit { model.set(row.key, text) }
                .onDisappear { model.set(row.key, text) }
        }
    }
}

/// Who is signed in to GitHub; signing in shows a code, to be given at GitHub in the browser (History.swift: github-*).
struct GitHubRowView: View {
    @ObservedObject var model: SettingsModel
    let label: AnyView

    var body: some View {
        let g = model.github, said = g["said"] as? String ?? ""
        let user = g["user"] as? [String: Any], code = g["code"] as? [String: Any], busy = (g["busy"] as? Bool) == true
        LabeledContent {
            VStack(alignment: .trailing, spacing: 6) {
                if let user {
                    let login = user["login"] as? String ?? "", name = user["name"] as? String ?? ""
                    Text(model.t("prefs.github.in", name.isEmpty ? "@" + login : name + " (@" + login + ")") + (said.isEmpty ? "" : " — " + said))
                        .foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    Button(model.t("prefs.github.out")) { SettingsWindow.shared.history("github-signout") }
                } else if let code {
                    let uri = (code["uri"] as? String ?? "").replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
                    Text(model.t("prefs.github.enter", uri)).foregroundStyle(.secondary).multilineTextAlignment(.trailing)
                    Text(code["code"] as? String ?? "").font(.system(.title2, design: .monospaced).weight(.semibold)).textSelection(.enabled)
                    HStack {
                        Button(model.t("prefs.github.cancel")) { SettingsWindow.shared.history("github-cancel") }
                        Button(model.t("prefs.github.open")) { SettingsWindow.shared.history("github-open") }.keyboardShortcut(.defaultAction)
                    }
                } else if busy {
                    HStack {
                        ProgressView().controlSize(.small)
                        Text(model.t("prefs.github.asking")).foregroundStyle(.secondary)
                        Button(model.t("prefs.github.cancel")) { SettingsWindow.shared.history("github-cancel") }
                    }
                } else {
                    Text(said.isEmpty ? model.t("prefs.github.none") : model.t("prefs.github.failed", said)).foregroundStyle(.secondary)
                        .multilineTextAlignment(.trailing)
                    Button(model.t("prefs.github.signin")) { SettingsWindow.shared.history("github-signin") }
                }
            }
        } label: { label }
    }
}

/// The repositories the app is given on GitHub, to link the project to one, fetch one into a folder of its own, or make one
/// anew for the project (active/prefs.js: chooser).
struct RepoChooser: View {
    @ObservedObject var model: SettingsModel
    @State private var q = ""
    @State private var picked: String?
    @State private var name = ""
    @State private var turn = 0
    @State private var failed = ""

    private var kind: String { model.chooser ?? "link" }
    private var shown: [SettingsModel.Repo] {
        let all = model.repos ?? [], s = q.trimmingCharacters(in: .whitespaces).lowercased()
        guard !s.isEmpty else { return all }
        let starts = all.filter { r in r.name.lowercased().split(separator: "/").contains { $0.hasPrefix(s) } || r.name.lowercased().hasPrefix(s) }
        return starts + all.filter { r in r.name.lowercased().contains(s) && !starts.contains { $0.url == r.url } }
    }
    private var made: [String: Any]? {
        guard let m = model.github["made"] as? [String: Any], (m["n"] as? NSNumber)?.intValue == turn, turn > 0 else { return nil }
        return m
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.t(kind == "new" ? "prefs.github.newTitle" : kind == "link" ? "prefs.github.linkTitle" : "prefs.github.getTitle")).font(.headline)
            if kind == "new" {
                TextField(model.t("prefs.github.newName"), text: $name).textFieldStyle(.roundedBorder).onSubmit(make)
                    .disabled(made?["busy"] as? Bool == true)
                Text(failed.isEmpty ? model.t("prefs.github.newHint") : failed).font(.caption).foregroundStyle(failed.isEmpty ? Color.secondary : Color.red)
                Spacer()
            } else {
                TextField(model.t("prefs.github.search"), text: $q).textFieldStyle(.roundedBorder)
                List(selection: $picked) {
                    ForEach(shown) { r in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.name)
                            Text(model.t(r.isPrivate ? "prefs.github.private" : "prefs.github.public")).font(.caption).foregroundStyle(.secondary)
                        }.tag(Optional(r.url))
                    }
                }
                .frame(minHeight: 220)
                .contextMenu(forSelectionType: String.self) { _ in } primaryAction: { _ in done() }
                let all = model.repos
                let empty = all == nil ? model.t("prefs.github.reading") : all!.isEmpty ? model.t("prefs.github.norepos") : shown.isEmpty ? model.t("prefs.github.nofit") : ""
                if !empty.isEmpty { Text(empty).font(.caption).foregroundStyle(.secondary) }
            }
            HStack {
                if (model.repos?.isEmpty ?? false) || ["unreached", "denied"].contains(made?["error"] as? String ?? "") {
                    Button(model.t("prefs.github.give")) { SettingsWindow.shared.history("github-give") }
                }
                if kind == "link" && model.repos != nil {
                    Button(model.t("prefs.github.new")) {
                        name = model.history["newRepo"] as? String ?? "mdview"
                        model.chooser = "new"
                    }
                }
                Spacer()
                Button(model.t("prefs.github.cancel")) { model.chooser = nil }.keyboardShortcut(.cancelAction)
                Button(model.t(kind == "new" ? (made?["busy"] as? Bool == true ? "prefs.github.newBusy" : "prefs.github.newDo")
                               : kind == "link" ? "prefs.github.linkDo" : "prefs.github.getDo")) { kind == "new" ? make() : done() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(kind == "new" ? name.trimmingCharacters(in: .whitespaces).isEmpty || made?["busy"] as? Bool == true : picked == nil)
            }
        }
        .padding(20)
        .frame(width: 460, height: 420)
        .onAppear { if model.repos == nil { SettingsWindow.shared.history("github-repos") } }
        .onReceive(model.$info) { _ in
            guard let m = made else { return }
            if (m["done"] as? Bool) == true { turn = 0; model.chooser = nil }
            else if let e = m["error"] as? String { failed = model.t("prefs.github.new." + e, m["name"] as? String ?? name, m["why"] as? String ?? "") }
        }
    }

    private func done() {
        guard let url = picked, let r = model.repos?.first(where: { $0.url == url }) else { return }
        let what = kind
        model.chooser = nil
        if what == "link" { SettingsWindow.shared.history("history-link", ["url": r.url]) }
        else { SettingsWindow.shared.history("github-get", ["url": r.url, "name": String(r.name.split(separator: "/").last ?? ""), "branch": r.branch]) }
    }
    private func make() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, made?["busy"] as? Bool != true else { return }
        turn = Int.random(in: 1000...999_999)
        failed = ""
        SettingsWindow.shared.history("github-new", ["name": n, "n": turn])
    }
}

extension NoteWindow {
    /// Where a question of the history's is asked: the settings window, when it is in front and was opened from here.
    var sheetHost: NSWindow {
        if let s = SettingsWindow.shared.window, s.isVisible, s.isKeyWindow, SettingsWindow.shared.source === self { return s }
        return window
    }
}
