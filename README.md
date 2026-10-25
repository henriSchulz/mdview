# Markdown Notes

Notes in plain Markdown for the desktop (a Tauri shell in Rust around a web view): a reading
view, writing in the rendered document, a source editor, formulas, PDFs
beside the notes. The command and the repository are still called `mdview`;
`mdnotes` starts it too.

- Renders CommonMark and GFM plus Obsidian syntax (wikilinks, embeds,
  callouts, properties, `==highlight==`, `%%comments%%`, `#tags`), KaTeX math,
  Mermaid diagrams, SVG drawn from a ```svg block and highlighted code. Works on any file, no vault needed.
- `Ctrl+E` switches between reading and editing the source in place; edits
  are saved automatically. A third, active mode (`Ctrl+Alt+1`) edits the
  rendered document itself and changes the file only where it was edited; a fourth (`Ctrl+Alt+2`)
  shows the source and the note as it reads side by side. `Ctrl+V` with an image on the clipboard saves it as
  a file and embeds it.
- Opened on a folder (or started bare, which reopens the last folder) the
  window gets a sidebar with the folder's notes: create, rename, trash —
  and tabs, as Craft has them: notes and PDFs open beside each other.
- Stays resident for a while after the last window closes, so reopening is
  instant; a second start hands its files to the running instance.
- Colors follow the Omarchy theme; motion and sizes are the app's own (`motion.css`). The
  sidebar and bars are built as macOS builds them (a floating sidebar card, shortcuts
  as `⌃⇧V`), in sizes measured there; context menus and the `/`
  menu are dark plates, the app's own icons SF Symbols where
  that font is installed.
- Everything it does, with the Markdown it reads: `docs/FEATURES.md`. A Claude skill
  for writing notes it renders: `skill/mdview-notes` (linked by the installer).

## Install

**Installers.** A tagged version is built on GitHub (`.github/workflows/build.yml`) and stands
under *Releases*: `.deb`, `.rpm` and an AppImage for Linux (x64 and arm64), and an installer for
Windows — installed and started on GitHub's Windows before it is released, but not signed, so
Windows warns before it runs it. macOS is not built for now. Which file is whose: the download
page, https://md.henrischulz.com/download.

**From the sources** (Linux; what the author runs):

```sh
git clone https://github.com/henriSchulz/mdview
mdview/bin/mdview-install
```

The installer builds the program (`cargo build --release` in `src-tauri`), which then runs out
of the checkout — move or delete the checkout and it is gone. Besides that it links the launcher
into `~/.local/bin` (which must be on the `PATH`), installs the desktop entries and the icon,
makes mdview the default for Markdown files (`xdg-mime`), and links the Claude skill into
`~/.claude/skills`. To build it needs `cargo` and the development
packages of WebKitGTK 4.1, GTK 3, OpenSSL, D-Bus and librsvg, and `pkg-config`
(Debian: `libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libdbus-1-dev librsvg2-dev pkg-config`).
The fonts Inter and JetBrains Mono Nerd Font are used where they are installed.

The page (`viewer.js` and what it loads) is read from the checkout at every
start: a change to it needs no build, only a new window. A change to
`src-tauri` needs `cargo build`. The installer links `bin/mdview-post-merge` as the checkout's
Git `post-merge` hook, so a `git pull` or merge does that by itself: a change to `src-tauri` is
built in the background (its log in `~/.cache/mdview/build.log`), and a notification says when
a restart brings the new version — or that the build failed. A merge in another worktree of the
checkout does nothing.

## What goes over the network

Nothing, until one of these is used:

- **History and sync.** A folder can keep versions of its notes (a Git repository in the folder)
  and be linked to a repository on GitHub: the notes are then pushed there and pulled from
  there. Signing in goes through the app's GitHub App; the sign-in is kept in the system's
  keyring.
- **Sharing.** A note of a linked folder can be shared as a link on `md.henrischulz.com`, the
  author's server, which reads it from the repository on GitHub. A link without a password is
  short and can be guessed: set a password for what is not public. Another server:
  the environment variable `MDVIEW_WEB`.
- **Writing help** (off by default). With a Gemini API key set in the settings, the text around
  the caret is sent to Google when a continuation is asked for. Figures drawn on request go
  through the `claude` command line, if it is installed.
- **Pictures from elsewhere.** A note that names a picture by an `http(s)` address loads it from
  there when it is shown.

## Layout

| Path | What |
|---|---|
| `src-tauri/` | the shell (Rust, Tauri): windows, files, folder scan, tabs, theme — `src/shell.rs` and `src/shell/` are the windows, `scan.rs` the disk, `host.rs` what is asked of the system, `ai.rs` the models, `main.rs` the start and the `md://` protocol the page is served over |
| `viewer/`, `viewer.js` | renderer, source editor, sidebar and chrome inside the web view: its scripts and styles, by what they are about (`docs/MAP.md` says where what is) |
| `vendor/` | markdown-it and plugins, KaTeX, highlight.js, Mermaid, PDF.js, ProseMirror, diff (minified, committed) |
| `bin/` | launcher and installer |
| `packaging/` | desktop entry and icon |
| `overview.js`, `overview.css` | all notes of a folder as tiles |
| `strings.js` | user-facing strings of the active mode (English, German) |
| `active/` | the active mode: the rendered document, editable in place (in progress, see `docs/`) |
| `docs/` | `FEATURES.md` (what the app does), `MAP.md` (where what is in the code), `BUGS.md` (the rules that came out of bugs), design notes and milestone reports |
| `skill/` | the Claude skill `mdview-notes` |
| `web/` | the notes in the browser, from a repository on GitHub (Next.js; in progress, see `docs/Git-Phase-3.md`) |
| `dev/` | build of the vendored editor libraries, tests, a rig that runs the app off-screen — see `dev/README.md` |

## License

MIT — see `LICENSE`. The libraries in `vendor/` keep their own licenses: `vendor/README.md` names them, `vendor/LICENSES.md` holds their texts.
