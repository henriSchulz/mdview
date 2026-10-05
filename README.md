# Markdown Notes

Notes in plain Markdown for the desktop (a Tauri shell in Rust around a web view): a reading
view, writing in the rendered document, a source editor, formulas, PDFs
beside the notes. The command and the repository are still called `mdview`;
`mdnotes` starts it too.

- Renders CommonMark and GFM plus Obsidian syntax (wikilinks, embeds,
  callouts, properties, `==highlight==`, `%%comments%%`, `#tags`), KaTeX math,
  Mermaid diagrams, SVG drawn from a ```svg block and highlighted code. Works on any file, no vault needed.
- `Ctrl+E` switches between reading and editing the source in place; edits
  are saved automatically. A third, active mode (`Ctrl+Alt+2`) edits the
  rendered document itself and changes the file only where it was edited. `Ctrl+V` with an image on the clipboard saves it as
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

```sh
git clone git@github.com:henriSchulz/mdview ~/Projects/mdview
~/Projects/mdview/bin/mdview-install
```

The installer builds the program (`cargo build --release` in `src-tauri`), which
then runs out of the checkout; besides that it only links the launcher into
`~/.local/bin`, installs the desktop entry and icon, and makes mdview the
default for Markdown files. Needs `cargo`, `webkit2gtk-4.1` and the
fonts Inter and JetBrains Mono Nerd Font.

The page (`viewer.js` and what it loads) is read from the checkout at every
start: a change to it needs no build, only a new window. A change to
`src-tauri` needs `cargo build`.

## Layout

| Path | What |
|---|---|
| `src-tauri/` | the shell (Rust, Tauri): windows, files, folder scan, tabs, theme — `src/shell.rs` is the windows, `scan.rs` the disk, `host.rs` what is asked of the system, `ai.rs` the models, `main.rs` the start and the `md://` protocol the page is served over |
| `viewer.js`, `viewer.css` | renderer, source editor, sidebar and chrome inside the web view |
| `vendor/` | markdown-it and plugins, KaTeX, highlight.js, Mermaid (minified, committed) |
| `bin/` | launcher and installer |
| `packaging/` | desktop entry and icon |
| `overview.js`, `overview.css` | all notes of a folder as tiles |
| `strings.js` | user-facing strings of the active mode (English, German) |
| `active/`, `active.css` | the active mode: the rendered document, editable in place (in progress, see `docs/`) |
| `docs/` | `FEATURES.md` (what the app does), design notes and milestone reports |
| `skill/` | the Claude skill `mdview-notes` |
| `web/` | the notes in the browser, from a repository on GitHub (Next.js; in progress, see `docs/Git-Phase-3.md`) |
| `dev/` | build of the vendored editor libraries, tests, a rig that runs the app off-screen — see `dev/README.md` |

## License

MIT — see `LICENSE`. The libraries in `vendor/` keep their own licenses: `vendor/README.md`.
