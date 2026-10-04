# mdview — development

Nothing in this folder is needed to run the app. It holds the build of the
vendored editor libraries, the tests, and a rig that runs the app off-screen.

```sh
cd dev
npm install          # esbuild, jsdom, ProseMirror (versions pinned in package.json)
npm run build        # -> ../vendor/prosemirror.min.js (committed; rebuild after a version bump)
./fetch-corpus.sh    # CommonMark + GFM spec examples and ~40 real documents -> corpus/ (not committed)
npm test
```

## Tests (`npm test`)

They load the page's own scripts (the vendored libraries and `viewer.js`) into
jsdom, so they run against the parser exactly as the app configures it.

| File | What it checks |
|---|---|
| `tests/store.test.mjs` | how a file is cut into segments and put together again |
| `tests/roundtrip.test.mjs` | load → active mode → serialize gives the file back byte for byte: fixtures, spec examples, real documents, each with LF, CRLF, CR, mixed endings, a BOM, with and without a final newline, in and outside a vault |
| `tests/edit.test.mjs` | tests B and C: a word typed at a random place changes the file only there, and the file then says what the editor shows |
| `tests/commands.test.mjs` | keys and commands with the Markdown expected afterwards; escaping; random sequences of edits (`MDVIEW_FUZZ=200` for more rounds) |
| `tests/islands.test.mjs` | code blocks, formulas and frontmatter taken apart for their dialogs and put together again |
| `tests/tables.test.mjs` | cells edited in place, the table's own formatting kept, keys, rows and columns |
| `tests/notes.test.mjs` | footnote definitions found and written back, a new note |
| `tests/clip.test.mjs` | Markdown pasted keeps its spelling, HTML reduced to Markdown, copy |
| `tests/edges.test.mjs` | the spec's edge cases: byte-exact round trip and local edits for nested structures, fences, dollars, broken Markdown, comments, line endings, BOM, Unicode |
| `tests/dom.test.mjs` | the active mode's DOM shows what the reading view's shows (structure; layout is the rig's job) |

Without `corpus/` the spec and real-document tests are skipped. Notes that
must not be committed can be added per run: `MDVIEW_CORPUS=~/Documents/Notes npm test`.

## Rig (`rig.sh`)

Runs this checkout inside a nested Hyprland with its own D-Bus session and
state directory, so neither the installed app nor the desktop is touched.
`mdview.py` evaluates a probe script in the page (`MDVIEW_PROBE`) and writes
what it reports to `MDVIEW_PROBE_OUT`.

```sh
./rig.sh start
./rig.sh compare tests/fixtures/*.md corpus/docs/*.md   # active mode laid out like the reading view?
./rig.sh modes tests/fixtures/obsidian.md               # switching modes, find, outline, a task
./rig.sh folder                                         # the active mode in a folder window
./rig.sh overview                                       # all notes of a folder as tiles
./rig.sh panel                                          # the panel at the right: Insert and Format
./rig.sh columns                                        # columns: made, typed in, their gap pulled, blocks dragged beside others
./rig.sh callout                                        # callouts made from the / menu, their titles typed in place
./rig.sh edit                                           # typing: rules, keys, lists, undo, saving
./rig.sh native                                         # the browser's own typing path: spaces, deleting, hard break
./rig.sh link                                           # the link popover
./rig.sh islands                                        # dialogs and popovers for code, formulas, properties, raw Markdown
./rig.sh m4                                             # tables, footnotes, paste and copy
./rig.sh clip                                           # Ctrl+Shift+V, a pasted picture, 1 MB pasted (nested clipboard)
./rig.sh edges                                          # empty document, one island, file changed under a dialog, narrow window, keyboard only
./rig.sh perf FILE…                                     # the spec's performance figures (node gen-big.mjs LINES > file for large ones)
MDVIEW_THEME_DIR=/nonexistent ./rig.sh m5               # any probe in the light fallback theme
./rig.sh m5                                             # context menu, formatting bar, undo and caret across modes, closing question
./rig.sh typing corpus/docs/pandoc-manual.md            # time per keystroke and per save
./rig.sh regress tests/fixtures/basics.md               # reading view and source editor unchanged since main?
./rig.sh stop
```

- `compare` measures every word and box in both views, checks the round trip
  in the real engine, and compares screenshots. Output lands in
  `~/.cache/mdview-rig/out/`.
- `regress` runs the same probe against the page as it is on `main` (or
  `BASE=<ref>`) and against this checkout: rendered HTML, layout, the editor's
  typing helpers, the saved file and screenshots must be identical. Run it
  whenever `viewer.js` or `viewer.css` changes.
