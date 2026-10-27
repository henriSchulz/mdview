# Where what is

Read this before looking for something: it says which file a thing is in, so that the search can
be a small one. What the app does, for its user: [`FEATURES.md`](FEATURES.md). The rules that came
out of bugs: [`BUGS.md`](BUGS.md).

## Looking for something

- Search with `rg` and name the folder or file the map points to: `rg -n --max-columns 200 'name'
  viewer/ active/`. Some lines are very long (a row of the strings, an icon's path); without
  `--max-columns` one hit is a screen of text.
- `.ignore` keeps out of a search what nobody wrote here (`vendor/`, lock files) and what is kept
  to look back at (the test apps `dev/*-lab*.html`, plans of finished work in `docs/`). `rg -u`
  searches them all the same.
- Read the part of a file that is needed, not the file: a function is found by its name
  (`rg -n 'function name'`), and each file's head says what it holds.

## How it is put together

- **The shell** (`src-tauri/src`, Rust) opens windows, reads and writes files, scans folders, keeps
  history. It hands a window its page and the two talk in messages: the page says
  `MdHost.post({ type, … })` (taken in `shell/messages.rs`), the shell calls `MdView.…(…)`
  (the list at the end of `viewer.js`).
- **The page** is `viewer/*.js` and, last, `viewer.js`: plain scripts, each a closure of its own,
  loaded in a fixed order. What one uses of another goes over `P` (`window.MdPage`): a file's
  first lines name what it takes (`const { … } = P; // viewer/render.js`), its last lines what it
  gives. A name from a file loaded later, and state that changes, is written `P.name`.
- **The active mode** (`active/*.js`), **All Notes**, **PDFs**, **AI** and **whiteboards** are
  loaded when first used (`viewer/modes.js`, `viewer.js`) and build on `MdView.core`.
- **The web app** (`web/`) shows the same page in a browser; `web/public/host/host.js` stands
  where the shell does, and `web/host/contract.ts` lists every message and what the web does with it.

## When a file is added, renamed or taken away

The page's files are listed where the page is put together — each list in the same order:

| What | Listed in |
|---|---|
| a script of the page (`viewer/*.js`) | `SCRIPTS` in `src-tauri/src/shell.rs`, `SCRIPTS` in `web/lib/page.ts`, `SCRIPTS` in `dev/tests/harness.mjs` |
| a sheet of the page (`viewer/*.css`) | `STYLES` in `src-tauri/src/shell.rs` and in `web/lib/page.ts`, the links in `dev/board-lab.html` |
| a script or sheet of the active mode | `loadActive` in `viewer/modes.js`; scripts also `ACTIVE` in `dev/tests/harness.mjs` |
| anything else at the top of the checkout | `resources` in `src-tauri/tauri.conf.json`, `files` in `web/scripts/assets.mjs` |

Then `node dev/map.mjs` writes the list below anew (a test fails while it is not up to date).
The installed app loads the files it was built to load: after such a change, `bin/mdview-install`.

## Which check for which change

`cd web && npm test` runs against the web app's last build: the page's files (`viewer/`, `active/` …) are copied into it
when it is built — after a change to them, `npm run build` first (or `node scripts/assets.mjs` for the page's files alone),
or the tests see the old ones.

| Changed | Run |
|---|---|
| `viewer.js`, `viewer/*`, `active/*`, `strings.js` | `cd dev && npm test`; `dev/rig.sh regress dev/tests/fixtures/basics.md`; the rig cases of the part (`dev/rig.sh` lists them at its head: `sidebar`, `tabs`, `edit`, …) |
| `board*`, `pdfview.*`, `overview.*`, `ai.*` | the rig cases of that name; whiteboards on touch: `cd web && npm test` |
| what a finger does in the application on Linux (`viewer/hand.js`, `host.rs`'s pinch, a PDF's fingers) | `dev/rig.sh gtktouch`; `cd web && npm test` (`linux-touch.test.mjs`) |
| `src-tauri/src` | `cd src-tauri && cargo test`; the rig cases of what the change is about |
| `web/`, or a message between page and shell | `cd web && npm test` |
| a release's files (`packaging/release-name.sh`, `packaging/latest-json.mjs`, the Release steps of `.github/workflows/build.yml`) | `cd dev && npm test` (`release-name.test.mjs`, `latest-json.test.mjs`); the download page that reads them: `cd web && npm test` (`download.test.mjs`) |
| the app's updates (`src-tauri/src/update.rs`, the notice, Settings › About) | `cd src-tauri && cargo test` (`update::tests`); `cd dev && npm test` (`update.test.mjs`); `dev/rig.sh update` |

`npm test` and `dev/rig.sh` say only what fails and how many checks held; every line:
`npm run test:all`, `RIG_ALL=1 dev/rig.sh …`.

## The files

<!-- files: written by dev/map.mjs -->

### The page — reading, the source editor, the window around the note

| File | What is in it |
|---|---|
| `viewer/base.js` | its ground: the message to the shell (post), the icons, small helpers. |
| `viewer/chrome.js` | what stands around the note: the toolbar, find, the outline, the toast, the notice of a newer version of the … |
| `viewer/drawer.js` | the sidebar pinned (it makes room) and shut (it peeks out over the note), an empty folder, a new note made at … |
| `viewer/editor.js` | the source editor: a textarea under a coloured copy of its text, saving, and where a place in the text is on … |
| `viewer/hand.js` | the hand: a finger, where the system does not say the screen is touched (Henri, 2026-10-24: the application … |
| `viewer/markdown.js` | markdown-it as the app sets it up: a note's own HTML made harmless, and the rules for what Markdown alone … |
| `viewer/menus.js` | the app's own small menus: a choice among a few (popup, combo) and the menu for text in a field or in the … |
| `viewer/modes.js` | what is loaded when first used and shown over or instead of the note: the active mode (active/*.js), … |
| `viewer/prep.js` | a note's text before it is rendered: frontmatter and comments taken off, the pages inside a note (parsed, … |
| `viewer/render.js` | rendering: a note drawn into #content, the place in it kept across a redraw, the way to a heading or a line, … |
| `viewer/sidebar.js` | the sidebar of a folder window: the folder's notes as a tree reconciled by path, its layouts, sorting, the … |
| `viewer/split.js` | two things side by side: a note and a PDF, and nothing else (Henri, 2026-10-26: "two notes side by side … |
| `viewer/tablet.js` | the iPad's own layout (Henri chose it, 2026-10-20: Craft's look, and no sidebar). |
| `viewer/tabs.js` | the tabs of a folder window. |
| `viewer/toolbar.js` | what the toolbar's buttons and the keys do, the outline closed by a click outside, a note larger and smaller, … |
| `viewer/touch.js` | what a finger has in the note, as the iPad has it (Craft's): no menu under a held finger, bars of tiles at … |
| `viewer/tour.js` | the tour: the app's controls shown one after the other, each with a word on what it does. |
| `viewer/trail.js` | one history for a note across the modes (undo and redo beyond what a mode did itself). |
| `viewer/twin.js` | the source beside its reading: the fourth mode ("split"). |
| `viewer.js` | renderer, source editor, folder sidebar + UI inside the web view. |
| `strings.js` | user-facing strings of the active mode, in one place so they can be translated. |

### The page's styles

| File | What is in it |
|---|---|
| `motion.css` | how the app moves, and the sizes its controls share: durations, curves, springs, corners. One place for them; |
| `viewer/blocks.css` | tables, formulas and diagrams, callouts. |
| `viewer/chrome.css` | what stands around the note: the toolbar, find, the outline, the toast, overlays. |
| `viewer/code.css` | code blocks and code in the text. |
| `viewer/editor.css` | the source editor. |
| `viewer/layouts.css` | the sidebar's layouts. |
| `viewer/menus.css` | the window for a new folder's name, the copy that goes with the pointer in a drag, menus at a point, a choice … |
| `viewer/narrow.css` | scrollbars, tooltips, figures, signs set as text (SF Symbols), and narrow windows (a phone, a split screen). |
| `viewer/page.css` | reading and editing styles. Colors come from the Omarchy theme (--c-*), durations, curves, radii and sizes … |
| `viewer/pages.css` | properties, transclusions, quick notes, the pages in a note, footnotes, an empty or missing note. |
| `viewer/sidebar.css` | the sidebar of a folder window (its layouts: layouts.css). |
| `viewer/split.css` | a note and a PDF side by side (viewer/split.js). The window is two halves of one kind, as an editor's split … |
| `viewer/tablet.css` | the iPad's own layout (viewer/tablet.js): Craft's look — no sidebar and no tabs, round buttons and capsules … |
| `viewer/tabs.css` | the tabs of a folder window, and the rows of the sidebar's list. |
| `viewer/text.css` | the note's text (headings, lists, quotes, links, rules) and tasks. |
| `viewer/twin.css` | the source beside its reading (viewer/twin.js): the source at the left, as the source mode has it, the note … |
| `overview.css` | all notes of the folder as sheets of paper, or as a list (overview.js). Sizes are layout; |
| `pdfview.css` | the PDF viewer and PDFs embedded in notes (pdfview.js). |
| `board.css` | the whiteboard opened over the window (board.js). Colours are the theme's (viewer/*.css), durations, curves, … |
| `ai.css` | AI (ai.js): the chat at the lower right and Transform with AI. |

### The active mode (loaded when first used)

| File | What is in it |
|---|---|
| `active/bar.js` | the formatting bar that floats over a text selection, and the small tooltips of its buttons. |
| `active/blocks.js` | moving blocks by dragging: a handle shows beside the block the pointer is over (only then); |
| `active/clip.js` | the clipboard. Copy puts two things there: the selection's Markdown (what was not changed, as it stands in … |
| `active/columns.js` | columns: blocks side by side (schema.js has the nodes, viewer.js the way they stand in the file). |
| `active/conflict.js` | the conflicts' window: a linked project and its other side both changed the same place of a file, and it is … |
| `active/context.js` | the context menu, and the commands it shares with the formatting bar: what a selection is (bold, a heading, a … |
| `active/dialog.js` | the dialog an island is edited in, the code editor inside it, and the small popover for inline things (a … |
| `active/document.js` | a document: the store, the editor document built from it, and the way back to Markdown. |
| `active/edit.js` | editing: commands, keys, input rules and the plugins that keep the document in order while it is typed in. |
| `active/ghost.js` | a continuation offered while one writes ("ghost text", as GitHub Copilot shows it): in a pause, the next … |
| `active/graphic.js` | a figure drawn by Claude: describe it, show a reference picture, or both; |
| `active/history.js` | the history's window: the versions of the note shown, at the left, and what one of them changed (or how it … |
| `active/islands.js` | islands: what is shown rendered and edited in a dialog. |
| `active/latex-snippets.js` | the default snippets, snippet variables and macro list of Obsidian LaTeX Suite … |
| `active/latexsuite.js` | writing LaTeX fast, the way Obsidian LaTeX Suite does it … |
| `active/link.js` | links: the small popover under a link the caret is in (address, open, edit, remove) and the form to make or … |
| `active/markdown.js` | from the editor's document back to Markdown. Only a block that was changed gets here (document.js writes the … |
| `active/mathtext.js` | LaTeX Suite while a formula is still being typed in the text: with the caret between dollars ("$x\|$", "$x\|", … |
| `active/menu.js` | a menu at a point (the app's menu look and behaviour: highlight follows at once, a chosen entry blinks, then … |
| `active/notes.js` | footnotes. A reference is an atom in the text; the notes themselves show in the section at the end, as in the … |
| `active/panel.js` | the panel at the window's right (its rail at the window's edge, Ctrl+Alt+P), as Craft has one: three tabs. |
| `active/prefs.js` | its settings: a window of their own in the app's look, kept by the application (state.json, "active") and … |
| `active/schema.js` | ProseMirror schema and the builder that turns the store's markdown-it tokens into a document. |
| `active/share.js` | sharing a note: a link under which anyone can read it, with a password if one is set, and nothing else of the … |
| `active/slash.js` | the "/" menu (when the settings have it): "/" at the start of a line or after a space, in an empty line or in … |
| `active/store.js` | document store. The Markdown string is the document. |
| `active/syntax.js` | "Show Markdown at the caret" (a setting, off at first): around the caret the marks of the formatting it is in … |
| `active/tables.js` | tables: how one was written, and each cell's own Markdown. |
| `active/tableui.js` | working on a table: keys in a cell, the handles that show over a row and a column, and the menu with what can … |
| `active/view.js` | the editor view inside #active. viewer.js owns the modes and calls show(); |
| `active/wikilink.js` | a link to another note, made while it is typed. "[[" puts the closing brackets in at once (edit.js), the … |
| `active/bar.css` | the formatting bar over a selection. |
| `active/blocks.css` | blocks moved, selected and dropped: the handle, the drop line, the rectangle. |
| `active/narrow.css` | the active mode in a narrow window. |
| `active/panel.css` | the panel at the right. |
| `active/prefs.css` | the settings' window. |
| `active/tables.css` | tables and footnotes while they are edited. |
| `active/text.css` | active mode. The document inside #active has to look exactly like #content: the same rules apply, and what is … |

### All Notes, PDFs, AI, whiteboards (each loaded when first used)

| File | What is in it |
|---|---|
| `overview.js` | all notes of the folder as tiles (folder windows; the toolbar's grid button, Ctrl+Alt+G). |
| `pdfview.js` | PDFs in the window, the way Obsidian PDF++ works with them (https://github.com/RyotaUshio/obsidian-pdf-plus, … |
| `ai.js` | AI: Claude, asked through the claude command on this computer (the application runs it: src-tauri/src/ai.rs). |
| `board.js` | the whiteboard: a board that stands in a note as a picture (a file *.board.svg, see board/format.js) is … |
| `board/format.js` | a whiteboard's file: an SVG picture that carries its own data. |
| `board/ink.js` | a whiteboard's ink: strokes drawn on a canvas from the same paths the file's picture is made of (render.js), … |
| `board/items.js` | what stands on a whiteboard beside the ink: text boxes, sticky notes, shapes, lines and arrows. |
| `board/layer.js` | a whiteboard's items on the screen: one element each in a layer that is moved and scaled with the view (the … |
| `board/pdf.js` | a whiteboard over a PDF: the PDF's pages lie on the board as sheets of paper, one under the other, and what … |
| `board/pointer.js` | a whiteboard's hands: the one place that listens to pointers. |
| `board/render.js` | a whiteboard as a picture: the outline of a stroke, and the whole board as SVG. |
| `board/select.js` | a whiteboard's items in hand: choosing them (a click, Shift and a click, a box pulled over them), moving them … |
| `board/shape.js` | a whiteboard's cleaner hand: what a stroke was meant to be, when the hand rests at its end — a straight line, … |
| `board/view.js` | a whiteboard's view: which part of the endless board the window shows, and how large. |

### The shell (Rust)

| File | What is in it |
|---|---|
| `src-tauri/src/main.rs` | Markdown Notes (mdview) — notes in plain Markdown: read, write, formulas, PDFs. |
| `src-tauri/src/shell.rs` | The windows and what they do, on one thread: every event (the page said something, a file changed, a timer … |
| `src-tauri/src/shell/app.rs` | The application: what all windows share — the settings and what is kept between runs, the queue of events and … |
| `src-tauri/src/shell/claude.rs` | What the page asks of Claude: a graphic drawn, the chat and Transform with AI, the words that may come next … |
| `src-tauri/src/shell/files.rs` | What is put beside a note: pictures and files pasted, dropped or picked, a graphic kept, a whiteboard's file … |
| `src-tauri/src/shell/folder.rs` | A folder window's folder: its notes sent to the sidebar (and their previews), quick notes, a note or a folder … |
| `src-tauri/src/shell/messages.rs` | What the page says — one message, handed to what does it. (The page: viewer/*.js, viewer.js, active/*.js; |
| `src-tauri/src/shell/project.rs` | A folder as a project: what the page asks about its history, its other side on GitHub, the signing in there, … |
| `src-tauri/src/shell/tabs.rs` | The tabs of a folder window: made, shown, chosen, closed, opened again, moved. |
| `src-tauri/src/shell/undo.rs` | What was done to a folder's files from the sidebar and All Notes, taken back and done again (Ctrl+Z, … |
| `src-tauri/src/ai.rs` | The two things asked of a model: the next words while typing (Gemini, over HTTPS) and a figure drawn as SVG … |
| `src-tauri/src/attach.rs` | Files the application itself put beside a note — a picture pasted, a file dropped in, a figure drawn — are … |
| `src-tauri/src/github.rs` | Signing in with GitHub, for a linked project's other side. |
| `src-tauri/src/hidden.rs` | What of a folder was put out of sight by hand — a file, a folder with all that is in it — as the folder says … |
| `src-tauri/src/history.rs` | A folder's history: a project is a folder that holds both the app's marker (.mdview/project.json) and a Git … |
| `src-tauri/src/host.rs` | What the shell asks of the system it runs on: the clipboard, the web view's own settings, other applications. |
| `src-tauri/src/looks.rs` | How the folders of a folder look in the sidebar — a colour, a sign — as the folder says itself, in … |
| `src-tauri/src/paste.rs` | A project's pasteboard: a small chat of blocks of text for a project that is linked to a repository on … |
| `src-tauri/src/scan.rs` | What is read off the disk without a window: a folder's notes as a tree, a note's title, where a wikilink … |
| `src-tauri/src/share.rs` | Sharing a note: a link under which anyone can read it in the web app, with a password if one is set — and … |
| `src-tauri/src/slides.rs` | A presentation (PowerPoint, Impress) shown as the PDF LibreOffice makes of it: made once, in a thread of its … |
| `src-tauri/src/sync.rs` | A project and the repository it is linked to: what is fetched from there and pushed to it. |
| `src-tauri/src/theme.rs` | Colours follow the desktop: Velum's current colours when Velum is installed … |
| `src-tauri/src/update.rs` | Updates of an install that was downloaded: the AppImage and the Windows installer update themselves … |

### The web app (the same page in a browser)

| File | What is in it |
|---|---|
| `web/lib/app.ts` | The GitHub App acting as itself, not as a user: for a note that was shared, read by someone who is not signed … |
| `web/lib/download.ts` | The download page's ground (app/download): the latest release of the desktop app, read from GitHub, its files … |
| `web/lib/feedback.ts` | Bugs reported and features asked for: a form anyone may send, signed in or not (app/feedback), and a list … |
| `web/lib/firestore.ts` | Firestore, as far as the app needs it, spoken to over its REST interface: no library, and nothing to bundle. |
| `web/lib/github.ts` | GitHub, as the web app speaks to it: signing in (the GitHub App's web flow — the user is sent to GitHub and … |
| `web/lib/page.ts` | The document the desktop app's own page runs in, as the web app writes it: the page's styles, its one … |
| `web/lib/paste.ts` | A project's pasteboard: one text for a repository, to carry something from one device to another — typed or … |
| `web/lib/reponame.ts` | The name a new space's repository gets on GitHub, from the space's name: the same rule as the desktop app's … |
| `web/lib/session.ts` | Who is signed in, kept in a cookie the page's scripts cannot read: the tokens and the user, sealed (encrypted … |
| `web/lib/share.ts` | A note that was shared: read by anyone who has its link, signed in or not — and never anything else of the … |
| `web/lib/sharegate.ts` | Who may see a shared note: anyone with its link — and, where a password was set, only a browser that gave it … |
| `web/lib/sharepage.ts` | The page behind a shared note's link: the note, for whoever has the link — a password asked for first where … |
| `web/lib/store.ts` | What the server keeps about shared notes — the one thing it keeps at all. |
| `web/lib/types.ts` | What kind of content a file of a repository is sent as, by its ending. |
| `web/lib/welcome.ts` | The welcome page: what is seen at the address without signing in. |
| `web/lib/mcp/board.ts` | A whiteboard told in words, for a client of the Model Context Protocol: what is written on it — text, sticky … |
| `web/lib/mcp/guide.gen.ts` | Written by scripts/assets.mjs from skill/mdview-notes/SKILL.md — not to be changed here. |
| `web/lib/mcp/oauth.ts` | Signing a client of the Model Context Protocol in — Claude, Claude Code, any other: OAuth 2.1 as the protocol … |
| `web/lib/mcp/tools.ts` | What a client of the Model Context Protocol may do with the user's notes: the repositories the app was given … |
| `web/host/contract.ts` | The seam between the page (viewer.js and friends, the desktop app's own, unchanged) and whatever hosts it. |
| `web/public/host/core.js` | what the page's host works out, apart from asking and telling: the repository as the tree the sidebar shows, … |
| `web/public/host/demo.js` | the host of the welcome page's notes: the app's own page (viewer.js and friends), with a handful of sample … |
| `web/public/host/host.js` | the page's host in the browser. The page (viewer.js and friends, the desktop app's own) says things with … |
| `web/public/host/share.js` | the host of a note that was shared: one note, for whoever has its link, to be read and nothing else. |
| `web/proxy.ts` | Nothing of the app without signing in: every request without a session goes to the sign-in page — but the … |

<!-- /files -->
