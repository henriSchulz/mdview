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
  All Notes ⌘⌥G, the panel ⌘⌥P, history ⌘⌥H, Open Folder ⌘⌥O. The page gets a key first; the menu only when
  the page does not take it.
- **Stays resident** 15 minutes after the last window (`MDVIEW_RESIDENT_MS`), so the next one opens at once.
- **No updates**: a build from the sources never looks for a newer version (no notice, Settings › About says so).
- **Files** are opened from Finder (Open With, document types for Markdown, text, folders, PDFs), from
  `bin/mdview-mac`, or by `mdview://open?path=…` / `mdview://quick`. A second start hands its files to the running app.
- **State** is `~/Library/Application Support/MdView/state.json`.

Not done: the rig (`dev/rig.sh` drives the GTK build) does not drive this app; there is no notarization or
installer (a local, ad-hoc signed build).
