// Markdown Notes, native: the app, its windows, the Dock. Run: `swift run`, or ./build.sh and open MdView.app.
// The menu bar is in Menu.swift, the theme in Theme.swift, what the page asks of the system in System.swift.
import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    nonisolated(unsafe) static var shared: AppDelegate!
    var windows: [NoteWindow] = []
    private var idleItem: DispatchWorkItem?
    /// How long the app stays when the last window is closed, so that opening one again is instant (shell.rs RESIDENT_MS).
    private var resident: TimeInterval {
        (ProcessInfo.processInfo.environment["MDVIEW_RESIDENT_MS"].flatMap(Double.init) ?? 15 * 60 * 1000) / 1000
    }

    func eachWindow(_ f: (NoteWindow) -> Void) { windows.forEach(f) }

    /// The window the user is in: the key one, else the last made.
    var keyNote: NoteWindow? {
        (NSApp.keyWindow?.delegate as? NoteWindow) ?? (NSApp.mainWindow?.delegate as? NoteWindow) ?? windows.last
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        AppDelegate.shared = self
        ThemeCenter.shared.start()
        buildMenu()
        let args = Array(CommandLine.arguments.dropFirst())
        let files = args.filter { !$0.hasPrefix("-") }
        if args.contains("--quick") { openQuick() }
        else if windows.isEmpty {
            if files.isEmpty { if !launchedByOpen { openWindow(nil) } }
            else { files.forEach { openArg($0) } }
        }
        NSApp.activate(ignoringOtherApps: true)
        spareSoon()
    }

    /// Started by a file or an address (open events come right after launch): no bare window of its own then.
    private var launchedByOpen = false
    func applicationWillFinishLaunching(_ n: Notification) {
        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)), forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func openArg(_ a: String) {
        if a.contains("://"), let u = URL(string: a) { return openURL(u) }
        openWindow(a.hasPrefix("/") ? a : Lib.join(FileManager.default.currentDirectoryPath, a))
    }

    func application(_ app: NSApplication, open urls: [URL]) {
        launchedByOpen = true
        for u in urls { openURL(u) }
    }

    @objc func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        launchedByOpen = true
        if let s = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue, let u = URL(string: s) { openURL(u) }
    }

    /// A file, or mdview://quick, mdview://open?path=… (what `mdview-mac` and other programs hand over).
    func openURL(_ u: URL) {
        if u.isFileURL { return openWindow(u.path) }
        guard u.scheme == "mdview" || u.scheme == "mdnotes" else { return }
        let c = URLComponents(url: u, resolvingAgainstBaseURL: false)
        if u.host == "quick" { return openQuick() }
        if let p = c?.queryItems?.first(where: { $0.name == "path" })?.value { openWindow(p) }
        else { newWindow(nil) }
    }

    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { windows.isEmpty ? openWindow(nil) : windows.last?.window.makeKeyAndOrderFront(nil) }
        return true
    }

    // The app stays a while after its last window, so that the next one is instant; then it goes (README: resident).
    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }

    private func scheduleIdleExit() {
        idleItem?.cancel()
        let item = DispatchWorkItem { [weak self] in if self?.windows.isEmpty == true { NSApp.terminate(nil) } }
        idleItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + resident, execute: item)
    }

    /// How the app's answer to quitting is given (the tests listen to it instead).
    var answerQuit: (Bool) -> Void = { NSApp.reply(toApplicationShouldTerminate: $0) }

    /// Quitting hands unsaved text over first (the page's flush), as closing a window does.
    func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
        let writing = windows.filter { $0.editing || $0.boardOpen }
        if writing.isEmpty { return .terminateNow }
        quitHeld = false
        writing.forEach { $0.js("MdView.flush", [true]) }
        // (a page with a question to ask first holds its window, and the quitting with it: the app stays, the page asks)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            guard let self else { return }
            self.answerQuit(!self.quitHeld)
        }
        return .terminateLater
    }

    /// A page held its window to ask, while the app was to quit (NoteWindow "closehold").
    var quitHeld = false

    func openWindow(_ path: String?) {
        var file = path, folder: String? = nil
        if let p = path.map(Lib.resolve), Lib.isDir(p) { folder = p; file = nil } else if let p = path { file = Lib.resolve(p) }
        idleItem?.cancel()
        // a window that shows it already comes forward
        if let f = folder, let w = windows.first(where: { $0.folder == f }) { w.window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        if let f = file, let w = windows.first(where: { $0.path == f }) { w.window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return }
        let w: NoteWindow
        if let s = spare, s.ready {
            // the page of the spare is up already: what is asked for is shown in it, now
            spare = nil
            w = s
            w.window.backgroundColor = ThemeCenter.shared.current.backgroundColor
            sizeWindow(w, folder: folder, file: file)
            w.takeOver(path: file, folder: folder)
        } else {
            w = NoteWindow(path: file, folder: folder)
            w.window.backgroundColor = ThemeCenter.shared.current.backgroundColor
            sizeWindow(w, folder: folder, file: file)
        }
        w.onClose = { [weak self] w in
            guard let self else { return }
            self.windows.removeAll { $0 === w }
            if self.windows.isEmpty { self.scheduleIdleExit() }
        }
        windows.append(w)
        NSApp.activate(ignoringOtherApps: true)
        spareSoon()
    }

    // MARK: the spare window

    /// A window whose page is loaded before it is asked for (NoteWindow.isSpare): the next one opened is there at once,
    /// not half a second later. One at a time; made a while after a window opened (not to slow that one down).
    var spare: NoteWindow?
    /// Off in the tests unless a test turns it on (MDVIEW_HEADLESS windows are made by the tests themselves).
    var sparesOn = !Lib.headless
    private var spareItem: DispatchWorkItem?

    func spareSoon(after: Double = 1.5) {
        guard sparesOn, spare == nil else { return }
        spareItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.makeSpare() }
        spareItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + after, execute: item)
    }

    func makeSpare() {
        guard sparesOn, spare == nil else { return }
        spare = NoteWindow(path: nil, folder: nil, spare: true)
    }

    /// The spare's page no longer is what a new one would be (the theme, the settings): it goes, another comes later.
    func dropSpare() {
        spareItem?.cancel()
        spare?.dispose()
        spare = nil
        spareSoon(after: 3)
    }

    /// The size the window was last left with (state: folder_width/height, width/height), kept on a screen it is on; cascaded from the last one.
    private func sizeWindow(_ w: NoteWindow, folder f: String?, file: String?) {
        // (a folder or a note opened before: its window where it stood, as large as it was — on a screen it is on)
        if let key = f ?? file, let r = Store.shared.frame(of: key),
           NSScreen.screens.contains(where: { $0.visibleFrame.intersection(r).width > 120 && $0.visibleFrame.intersection(r).height > 120 }),
           !windows.contains(where: { $0.window.isVisible && $0.window.frame.origin == r.origin }) {
            return w.window.setFrame(r, display: false)
        }
        let folder = f != nil
        let st = Store.shared.state
        let num = { (k: String) in (st[k] as? NSNumber)?.doubleValue }
        let width = folder ? (num("folder_width") ?? 1180) : (num("width") ?? 980)
        let height = folder ? (num("folder_height") ?? 800) : (num("height") ?? 800)
        let screen = (w.window.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let size = NSSize(width: min(max(width, 480), screen.width), height: min(max(height, 360), screen.height))
        w.window.setContentSize(size)
        if let last = windows.last?.window, last.isVisible {
            var p = last.frame.origin
            p.x += 28; p.y -= 28
            w.window.setFrameOrigin(p)
            if !screen.intersects(w.window.frame) || w.window.frame.maxX > screen.maxX || w.window.frame.minY < screen.minY { w.window.center() }
        } else { w.window.center() }
    }

    /// The quick notes: their folder, in a window of its own kind (`mdview --quick`).
    func openQuick() {
        let q = Store.shared.prefs["quickDir"] as? String ?? ""
        let dir = q.isEmpty ? Lib.join(Lib.home(), "Documents/Notizen/QuickNotes") : q
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        openWindow(dir)
    }

    @objc func newWindow(_ s: Any?) { openWindow(nil) }

    /// Files and folders, chosen in the system's window (the page's Open and Open Another Folder).
    @objc func openPanel() { openPanel(folders: false) }

    func openPanel(folders: Bool) {
        let p = NSOpenPanel()
        p.allowsMultipleSelection = !folders
        p.canChooseDirectories = true
        p.canChooseFiles = !folders
        p.canCreateDirectories = folders
        p.prompt = folders ? "Open Folder" : "Open"
        if let d = keyNote?.folder ?? keyNote?.path.map({ Lib.dir($0) }) { p.directoryURL = URL(fileURLWithPath: d) }
        if p.runModal() == .OK { openChosen(p.urls) }
    }

    /// What was chosen to open: into the window in front if that has nothing open yet (its start screen), else each in a window.
    func openChosen(_ urls: [URL]) {
        if let k = keyNote, k.path == nil, k.folder == nil, !k.gone { k.openHere(urls) } else { urls.forEach { openWindow($0.path) } }
    }
}

_ = Pipes.safe // (a child that went before reading its input does not take the app with it)
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
