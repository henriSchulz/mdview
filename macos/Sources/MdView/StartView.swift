// A window with nothing open (no folder, no note): what can be opened, drawn by the system (SwiftUI) over the page —
// the app's icon, the two ways in as the system's buttons, the folders opened last with Finder's icons for them. The
// page's own start screen (viewer/drawer.js startState) is what the Linux app and the web show; here it is hidden.
import AppKit
import SwiftUI

/// The words of the start screen, in the app's language (prefs "lang"; strings.js "start.*" for the page's).
struct StartWords {
    let title, text, recent, folder, file, open, newWindow, finder, forget, choose: String

    static func of(_ lang: String?) -> StartWords {
        lang == "de"
            ? StartWords(title: "Notizen öffnen",
                         text: "Öffne einen Ordner: Seine Notizen stehen in der Seitenleiste, und neue landen dort. Oder öffne eine einzelne Datei.",
                         recent: "Zuletzt geöffnet", folder: "Ordner öffnen …", file: "Datei öffnen …", open: "Öffnen",
                         newWindow: "In neuem Fenster öffnen", finder: "Im Finder zeigen", forget: "Aus der Liste entfernen", choose: "Öffnen")
            : StartWords(title: "Open Your Notes",
                         text: "Open a folder: its notes stand in the sidebar, and new ones are kept there. Or open a single file.",
                         recent: "Recently Opened", folder: "Open Folder…", file: "Open File…", open: "Open",
                         newWindow: "Open in New Window", finder: "Show in Finder", forget: "Remove from List", choose: "Open")
    }
}

/// What the start screen does — the window it stands in answers.
struct StartActions {
    var openFolder: () -> Void
    var openFile: () -> Void
    var open: (String) -> Void
    var openInNewWindow: (String) -> Void
    var forget: (String) -> Void
    var dropped: ([URL]) -> Void
    /// Where the start screen's content stands in its view (top-left origin): only there does it take the mouse.
    var placed: (CGRect) -> Void
}

/// The view the start screen is drawn in: it takes the mouse only where its content is — elsewhere what the page has
/// beneath it (in a small window the assistant's button may reach under it) is clicked as if it were not there.
final class StartHost: NSHostingView<StartView> {
    var hot = CGRect.zero
    override func hitTest(_ point: NSPoint) -> NSView? {
        let p = convert(point, from: superview)
        let q = isFlipped ? p : NSPoint(x: p.x, y: bounds.height - p.y)
        return hot.contains(q) ? super.hitTest(point) : nil
    }
}

struct StartView: View {
    let recents: [String]
    let words: StartWords
    let actions: StartActions
    @State private var dropping = false

    /// The app's icon: the bundle's, or — run from the checkout (swift run, the tests) — the one the bundle is made of.
    static let icon: NSImage = {
        if Bundle.main.bundleIdentifier != nil, Bundle.main.bundlePath.hasSuffix(".app") { return NSApp.applicationIconImage }
        return NSImage(contentsOf: Page.root.appendingPathComponent("src-tauri/icons/icon.png")) ?? NSApp.applicationIconImage
    }()

    var body: some View {
        // (a low window: the same with fewer folders, then without the icon and the words — never cut off)
        ViewThatFits(in: .vertical) {
            content(icon: true, rows: 6)
            content(icon: true, rows: 3)
            content(icon: false, rows: 3)
            content(icon: false, rows: 0)
        }
        .padding(.horizontal, 28)
        .padding(.vertical, 20)
        // (a folder or a file from Finder, dropped here, opens — the place says it takes it)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.accentColor.opacity(dropping ? 0.05 : 0))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color.accentColor.opacity(dropping ? 0.6 : 0), style: StrokeStyle(lineWidth: 2, dash: [8, 6])))
        )
        .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .named("start")) }, action: { actions.placed($0) })
        .animation(.easeOut(duration: 0.15), value: dropping)
        .dropDestination(for: URL.self) { urls, _ in
            let files = urls.filter(\.isFileURL)
            guard !files.isEmpty else { return false }
            actions.dropped(files)
            return true
        } isTargeted: { dropping = $0 }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .coordinateSpace(name: "start")
    }

    @ViewBuilder private func content(icon: Bool, rows: Int) -> some View {
        VStack(spacing: 0) {
            if icon {
                Image(nsImage: StartView.icon)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: 96, height: 96)
                    .shadow(color: .black.opacity(0.12), radius: 6, y: 3)
                    .padding(.bottom, 14)
                    .accessibilityHidden(true)
            }
            Text(words.title)
                .font(.system(size: 24, weight: .semibold))
                .accessibilityAddTraits(.isHeader)
            if icon {
                Text(words.text)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 330)
                    .padding(.top, 6)
            }
            HStack(spacing: 10) {
                Button(action: actions.openFolder) {
                    Label(words.folder, systemImage: "folder").frame(minWidth: 128)
                }
                .buttonStyle(.borderedProminent)
                Button(action: actions.openFile) {
                    Label(words.file, systemImage: "doc.text").frame(minWidth: 128)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)
            .padding(.top, 20)
            if rows > 0 && !recents.isEmpty {
                RecentList(paths: Array(recents.prefix(rows)), words: words, actions: actions)
                    .padding(.top, 30)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// The folders opened last, as a grouped list of the system's (System Settings): rows on a card, a line between.
private struct RecentList: View {
    let paths: [String]
    let words: StartWords
    let actions: StartActions
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(words.recent)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.leading, 6)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(Array(paths.enumerated()), id: \.element) { i, p in
                    if i > 0 { Divider().padding(.leading, 50) }
                    RecentRow(path: p, words: words, actions: actions)
                }
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(scheme == .dark ? Color.white.opacity(0.06) : Color(nsColor: .controlBackgroundColor)))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color(nsColor: .separatorColor), lineWidth: 0.5))
            .shadow(color: .black.opacity(0.04), radius: 1.5, y: 1)
        }
        .frame(maxWidth: 440)
    }
}

private struct RecentRow: View {
    let path: String
    let words: StartWords
    let actions: StartActions
    @State private var hover = false

    /// Where it is, as Finder says it: the home folder as ~.
    private var place: String { (Lib.dir(path) as NSString).abbreviatingWithTildeInPath }

    var body: some View {
        Button { actions.open(path) } label: {
            HStack(spacing: 10) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: path))
                    .resizable()
                    .frame(width: 30, height: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(Lib.name(path))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Text(place)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .opacity(hover ? 1 : 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.primary.opacity(hover ? 0.06 : 0)))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help(path)
        .accessibilityLabel(Lib.name(path))
        .accessibilityHint(place)
        .contextMenu {
            Button(words.open) { actions.open(path) }
            Button(words.newWindow) { actions.openInNewWindow(path) }
            Divider()
            Button(words.finder) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
            Divider()
            Button(words.forget) { actions.forget(path) }
        }
    }
}

extension NoteWindow {
    /// The start screen stands over the page while the window has nothing open, and goes when it has.
    func updateStart() {
        if let c = chrome { c.update(c.state) } // (the bar: there with a note or a folder, not over the start screen)
        let want = path == nil && folder == nil && !gone
        if !want {
            startHost?.removeFromSuperview()
            startHost = nil
            return
        }
        let view = StartView(recents: store.recents().compactMap { $0["path"] as? String },
                             words: StartWords.of(store.prefs["lang"] as? String), actions: startActions())
        if let host = startHost { host.rootView = view; return }
        guard let ground = window.contentView, ground !== web else { return }
        let host = StartHost(rootView: view)
        startHost = host // (before it is laid out: where its content stands is told it then)
        host.appearance = startAppearance
        host.sizingOptions = [] // (the window's least size stays the page's)
        host.translatesAutoresizingMaskIntoConstraints = false
        ground.addSubview(host)
        // the window but its title bar and the foot, where the page keeps its buttons (Settings, the assistant)
        NSLayoutConstraint.activate([
            host.topAnchor.constraint(equalTo: ground.topAnchor, constant: 30),
            host.bottomAnchor.constraint(equalTo: ground.bottomAnchor, constant: -72),
            host.leadingAnchor.constraint(equalTo: ground.leadingAnchor, constant: 12),
            host.trailingAnchor.constraint(equalTo: ground.trailingAnchor, constant: -12),
        ])
        startCovered(pageCovers)
    }

    /// Light or dark as the page is (the app's theme, which need not be the system's).
    var startAppearance: NSAppearance? { NSAppearance(named: ThemeCenter.shared.current.mode == "dark" ? .darkAqua : .aqua) }

    /// The page has something open over its middle (Settings, the assistant, a dialog — anything with data-open but a
    /// toast): the start screen steps back for it, and comes again when it is gone.
    func startCovered(_ on: Bool) {
        pageCovers = on
        guard let host = startHost else { return }
        if !on { host.isHidden = false }
        NSAnimationContext.runAnimationGroup({ c in
            c.duration = 0.18
            host.animator().alphaValue = on ? 0 : 1
        }, completionHandler: { [weak self] in
            if let self, self.pageCovers, self.startHost === host { host.isHidden = true }
        })
    }

    private func startActions() -> StartActions {
        StartActions(
            openFolder: { [weak self] in self?.chooseToOpen(folders: true) },
            openFile: { [weak self] in self?.chooseToOpen(folders: false) },
            open: { [weak self] p in self?.openHere(p) },
            openInNewWindow: { p in AppDelegate.shared?.openWindow(p) },
            forget: { [weak self] p in self?.store.forgetFolder(p); self?.updateStart() },
            dropped: { [weak self] urls in self?.openHere(urls) },
            placed: { [weak self] r in self?.startHost?.hot = r })
    }

    /// The system's Open window, as a sheet of this one: what is chosen first opens here, the rest in windows of their own.
    func chooseToOpen(folders: Bool) {
        guard window.attachedSheet == nil else { return }
        let w = StartWords.of(store.prefs["lang"] as? String)
        let p = NSOpenPanel()
        p.canChooseDirectories = folders
        p.canChooseFiles = !folders
        p.allowsMultipleSelection = !folders
        p.canCreateDirectories = folders
        p.prompt = w.choose
        p.directoryURL = URL(fileURLWithPath: store.recents().first?["path"] as? String ?? Lib.home())
        p.beginSheetModal(for: window) { [weak self] r in
            guard r == .OK else { return }
            self?.openHere(p.urls)
        }
    }

    func openHere(_ urls: [URL]) {
        guard let first = urls.first else { return }
        openHere(first.path)
        urls.dropFirst().forEach { AppDelegate.shared?.openWindow($0.path) }
    }

    /// A folder or a file, in this window while it has nothing open — or, shown already in another, that one comes forward.
    func openHere(_ p: String) {
        let p = Lib.resolve(p)
        guard path == nil, folder == nil else { AppDelegate.shared?.openWindow(p); return }
        if let other = AppDelegate.shared?.windows.first(where: { $0 !== self && ($0.folder == p || $0.path == p) }) {
            other.window.makeKeyAndOrderFront(nil)
            return
        }
        if Lib.isDir(p) { setFolder(p) } else if Lib.isFile(p) { openPath(p) }
    }
}
