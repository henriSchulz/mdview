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
