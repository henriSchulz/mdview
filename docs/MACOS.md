# The macOS app

A native Swift shell around the page: `macos/` (Swift package `MdView`, macOS 13+). It does what
`src-tauri/src/shell*` does on Linux and Windows — windows, menus, files, tabs, watching, history — and
shows the same page (`viewer.js` and what it loads) in a `WKWebView`. Nothing of the page is changed for it.

## Build and run

```sh
macos/build.sh            # MdView.app next to the script (release, ad-hoc signed)
macos/build.sh --install  # … and a copy in ~/Applications
bin/mdview-mac [file-or-folder …]     # start it, or hand it files; --quick for the quick notes
swift run --package-path macos MdView <file-or-folder>   # a debug run, no bundle
```

Like the Linux app it runs out of the checkout: the page is read from there at every start (`MdViewRoot` in
`Info.plist`, or `MDVIEW_ROOT`), so a change to `viewer/*.js` needs no build, only a new window.
Move or delete the checkout and the app shows nothing. Needs Xcode's command line tools (`swift`, `iconutil`, `sips`).

## How it is put together

| Part | File(s) in `macos/Sources/MdView` |
|---|---|
| The page, its files, `md://localhost/{app,file,shell}/…` | `Page.swift`, `Scheme.swift` |
| One window: state, the message switch, rendering a note | `NoteWindow.swift` |
| Folder, sidebar, new note/folder, rename, move, Trash, FSEvents | `Folder.swift`, `Scan.swift`, `Resolver.swift` |
| Tabs | `Tabs.swift` |
| Files: copy/paste, hide, import, looks, undo of file steps | `Files*.swift` |
| Search, previews, the note beside, whiteboards, PDFs | `Search*.swift` |
| History, GitHub, sync, sharing | `History*.swift` |
| AI | `Assistant*.swift` |
| Theme, menus, Dock, print, full screen, settings info | `Theme.swift`, `Menu.swift`, `System.swift`, `main.swift` |
| What is kept (state.json), the settings' defaults | `Store.swift`, `DefaultPrefs.swift` |

What the page says is one message (`MdHost.post({ type, … })`, listed in `web/host/contract.ts`); a message is taken
in `NoteWindow.on` or handed to the area's `handleFiles` / `handleSearch` / `handleHistory` / `handleAssistant` /
`handleSystem`. What the shell tells the page is `MdView.<name>(…)`, called with `NoteWindow.js`.

## What differs from the other shells

- **Colours** follow the system's light/dark appearance (live), or Velum's colours if `~/.local/state/velum`
  exists (`Theme.swift`; the Omarchy theme is Linux's).
- **Keys.** The page reads `Ctrl` and `Cmd` alike. Its `Ctrl+Alt+…` keys arrive on a Mac as composed characters
  (⌥S is `ß`), so the menu bar sends the key the page waits for (`Menu.swift`): the modes ⌘⌥1–4, the sidebar ⌘⌥S,
  All Notes ⌘⌥G, the panel ⌘⌥P, history ⌘⌥H, Open Folder ⌘⌥O, Back and Forward ⌘[ ⌘] (the page's ⌥← ⌥→: what was
  typed a moment ago is saved before the note is left). The page gets a key first; the menu only when
  the page does not take it.
- **Stays resident** 15 minutes after the last window (`MDVIEW_RESIDENT_MS`), so the next one opens at once.
- **A window is there at once** (`AppDelegate.spare`, main.swift): a window is made 1.5 s after the last one opened, its
  page loaded and warmed (`MdView.warm`: the active mode's scripts, mermaid, the Markdown renderer — viewer/render.js),
  never shown and not among the app's windows; the next window opened takes it over (`NoteWindow.takeOver`) — its note on
  the screen in some 80 ms instead of 650. A change of the theme or the settings lets it go (`dropSpare`), and another
  is made later. A folder's own window asks for its page before it reads the folder (`loading`: asked for once).
- **The folder is read aside** when it changes on the disk (`rescanQuietly`, Folder.swift: a save among the changes, while
  one types): its tree is taken on the main thread only if no reading of the window's own came after. A step of the
  window's own (a note made, renamed, moved) reads it at once, as before (`rescan`). One reading lists each folder in
  one call with what is needed of its files (Scan.swift). The page's own files are read once for all windows
  (`AppFiles`, Scheme.swift; checked against their time at each asking).
- **Numbers** for how quick it is: `MDVIEW_PERF=<a copy of notes> swift test --filter PerfTests` (a new window, a
  folder's, a note switched to, the sidebar's glide, the modes, typing while the folder is read, scrolling, a window
  pulled, All Notes, a diagram, the spare). A window nobody sees is painted as a seen one there (`paint`, Harness.swift).
  In Low Power Mode WebKit holds a page to 30 frames a second (requestAnimationFrame; Safari does the same) — what the
  page draws frame by frame is half as smooth on battery then; the system's own controls are not held so.
- **No updates**: a build from the sources never looks for a newer version (no notice, Settings › About says so).
- **Files** are opened from Finder (Open With, document types for Markdown, text, folders, PDFs), from
  `bin/mdview-mac`, or by `mdview://open?path=…` / `mdview://quick`. A second start hands its files to the running app.
- **Menus are the system's.** A menu of plain rows the page would draw — the right click on text, a file or a folder (in
  the sidebar, on a tile, on a tab), the "+" and history buttons, a block's or a table's, a whiteboard's — is handed to the
  shell (`MdHost.menu`, viewer/base.js `hostMenu`; NativeMenu.swift) and shown as an NSMenu: the Finder's signs (SF
  Symbols, by command — the page's own drawing where there is none), its keys as the system shows them (Ctrl is ⌘), ticks,
  a menu beside, the system's highlight. The page's own stays "open", unseen (`data-hosted`), for whatever waits for it to
  go. Menus with more than rows (the "/" menu, a searched one, colours and signs, a choice in a field) stay the page's.
- **The start screen** (a window with nothing open) is drawn by the system, not by the page (`StartView.swift`;
  the page's own is hidden): the app's icon, Open Folder… and Open File… as the system's buttons, the folders opened
  last (up to six, fewer in a low window) with Finder's icon for each and where it lies. A click opens a folder in
  that window; its context menu also opens it in a new window, shows it in Finder or takes it off the list. A folder
  or file dropped on it opens there; the Open window comes as a sheet of it, and File › Open… and Open Recent fill it
  too. It steps back while the page has something open over it (Settings, the assistant), and takes the mouse only
  where it stands, so the page's buttons at the foot stay at hand.
- **State** is `~/Library/Application Support/MdView/state.json`.

Not done: the rig (`dev/rig.sh` drives the GTK build) does not drive this app; there is no notarization or
installer (a local, ad-hoc signed build).
