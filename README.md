# mdview

A fast Markdown viewer and editor for the desktop (Python, GTK 3, WebKitGTK).

- Renders CommonMark and GFM plus Obsidian syntax (wikilinks, embeds,
  callouts, properties, `==highlight==`, `%%comments%%`, `#tags`), KaTeX math,
  Mermaid diagrams and highlighted code. Works on any file, no vault needed.
- `Ctrl+E` switches between reading and editing the source in place; edits
  are saved automatically. `Ctrl+V` with an image on the clipboard saves it as
  a file and embeds it.
- Opened on a folder (or started bare, which reopens the last folder) the
  window gets a sidebar with the folder's notes: create, rename, trash.
- Stays resident for a while after the last window closes, so reopening is
  instant; `bin/mdview` hands files to the running instance over D-Bus.
- Colors follow the Omarchy theme, motion follows `~/.local/share/henri-ui`.

## Install

```sh
git clone git@github.com:henriSchulz/mdview ~/Projects/mdview
~/Projects/mdview/bin/mdview-install
```

The app runs out of the checkout; the installer only links the launcher into
`~/.local/bin`, installs the desktop entry and icon, and makes mdview the
default for Markdown files. Needs `python-gobject`, `webkit2gtk-4.1` and the
fonts Inter and JetBrains Mono Nerd Font.

## Layout

| Path | What |
|---|---|
| `mdview.py` | windows, files, D-Bus, theme |
| `viewer.js`, `viewer.css` | renderer, source editor, sidebar and chrome inside the web view |
| `vendor/` | markdown-it and plugins, KaTeX, highlight.js, Mermaid (minified, committed) |
| `bin/` | launcher and installer |
| `packaging/` | desktop entry and icon |
| `docs/` | design notes |
