# Active mode — final report

(After this report, most of "What is not there" was built: see `active-mode-additions.md`.)

The third mode of mdview: the rendered document, editable in place, with
Markdown as the only thing that is stored. Built in the milestones of
`SPEC-Aktiv-Modus.md` §17; each has its own report (`active-mode-analysis.md`,
`active-mode-m1.md` … `-m6.md`). This is the state at the end of M6, on
branch `active`.

## What it is made of

| | |
|---|---|
| `active/store.js`, `document.js`, `markdown.js`, `tables.js` | the file cut into segments that add up to it byte for byte; the editor document built from them; the way back, where only what changed is written anew and merged into the text as it stood |
| `active/schema.js`, `edit.js`, `view.js` | what the editor knows (blocks, marks, islands, atoms), its keys, input rules and plugins, the view and its hand-over with the reading view |
| `active/islands.js`, `dialog.js`, `notes.js`, `link.js` | code, formulas, properties, raw Markdown, footnotes and links: dialogs and popovers |
| `active/tableui.js`, `menu.js`, `context.js`, `bar.js`, `clip.js` | table handles, menus, the formatting bar, the clipboard |
| `viewer.js`, `mdview.py` | the mode switch, saving, one history across modes, the start mode, clipboard and closing hand-offs |
| `vendor/prosemirror.min.js` | ProseMirror, bundled (271 kB); loaded on first use of the mode |
| `dev/` | 56 unit tests (jsdom, the page's own scripts), probes for the running app in a nested compositor (253 checks), the corpus |

The parser is the reading view's own markdown-it: one parser for both views
is what makes them look the same. About 5 200 lines of new code besides the
tests; reading and source mode start as fast as before.

## Acceptance criteria (§19)

| # | Criterion | State |
|---|---|---|
| 1 | Source and reading mode behave and look as before | **Met, with two intended changes**: screenshots and reports of both modes are identical to `main` for eight documents. Changed on purpose: a window opens in the mode last used (spec §18), and a reload that is older than the app's own last save is ignored |
| 2 | Open → active → save without a change: byte-identical | **Met**: fixtures, the 652 CommonMark examples, the GFM examples, 37 real documents in 8 variants of line endings, BOM and final newline |
| 3 | A change in one block changes only that block in the file | **Met**: 4 168 single-word insertions — 3 769 change exactly that place, 399 change more on their own line (a reference written out, an underline that grows, a table column padded again), 31 land where Markdown cannot say it; none touches another line. List items and table rows count as their own places |
| 4 | Only standard Markdown in the file, read correctly elsewhere | **Met by test, not tried in the named programs**: nothing forbidden comes out of 600 random edit sequences; a second parser reads 9 221 edited files the same way. GitHub, VS Code and Obsidian themselves were not used |
| 5 | At rest the active view cannot be told from the reading view | **Met**: 52 documents, same words, boxes and heights; 51 pixel-identical |
| 6 | Code dialog, formula dialog with preview and errors, popover for inline formulas | **Met** |
| 7 | Shortcuts of §7.3, input rules of §7.2, one undo takes a rule back | **Met** (M2), with the differences listed there |
| 8 | Scroll and caret kept across modes; undo across modes | **Met**: the place on screen between all modes, the caret between active mode and source editor; undo across modes in steps of saved texts |
| 9 | Checklist §11.4 complete | **Partly**: see below |
| 10 | Performance targets measured and met | **Measured; one not met**: changing the mode takes 100–150 ms on real documents of 2 000–10 000 lines (target: under 100 ms up to 5 000). Typing, dialogs, preview, saving and memory meet their targets |
| 11 | All edge cases of §15 tested | **Met but one**: trackpad gestures are not tested |
| 12 | VoiceOver can use document, islands and dialogs | **Not verified**: roles, labels and focus handling are there and tested; no screen reader was run |

## What is not there

Not built:

- Drag and drop: blocks, picture files, an insertion mark.
- Spell checking (off by decision), "syntax at the caret", typographic
  quotes, hard wrapping, and a settings dialog for any of §18.
- The `/` insert menu (optional in the spec; Insert in the context menu).
- Footnote definitions edited in place — they open in a dialog, because the
  notes show in a section at the end as in the reading view.
- Moving table rows and columns by dragging their handle (it is in the menu).
- CodeMirror in the dialogs: the app's own text-area editor is used, so no
  bracket matching, search or completion there.
- KaTeX's MathML output; a block ↔ inline switch and "copy as picture" for
  formulas; a form for frontmatter; resizable dialogs.
- Own tooltips for the window's toolbar (it keeps the browser's).

Not tested:

- Input methods (IME, dead keys), screen readers, real trackpad gestures.
- Selecting table cells by dragging; paste from real programs (the HTML
  cases are samples).
- The light theme beyond a look at dialogs, menus and the bar; contrast
  ratios.
- Any machine other than this one (WebKitGTK on the M1).

Known limits:

- Emphasis that Markdown cannot write (next to punctuation inside a word) is
  saved as close as it gets; 31 of 4 168 insertions in the tests.
- A table with a line break in a cell or rows of unequal length, callouts,
  definition lists and HTML stay islands with the Markdown dialog.
- Pasting 1 MB blocks the app for about three seconds.
- Files over 2 MB are read-only (the app's own limit); from 20 000 lines on
  the mode says it may be slow, and changing the mode takes over a second.

## Open decisions

1. **Language of the new texts.** English is active (the app's other texts
   are English); a German table is in `strings.js`. The spec's examples are
   German.
2. **The start mode.** "Last used" as the spec has it — or always reading,
   as before.
3. **Merging `active` into `main`.** The installed app runs from `main` and
   has none of this yet.
