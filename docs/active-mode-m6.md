# Active mode — milestone 6 report (hardening)

Spec §17, M6: the performance figures measured, property tests, the edge
cases of §15, accessibility, visual regression, final report
(`active-mode-final.md`).

## Performance (§12)

Measured in the running app (`dev/rig.sh perf`, WebKitGTK on the M1) on real
documents and on generated ones (`dev/gen-big.mjs`: dense — one block in
eight is code, a formula, a table or a list, a formula in every paragraph).

| Document | Lines | Keystroke (median / p95) | Mode change | Dialog opens | Formula preview | Written back |
|---|---|---|---|---|---|---|
| mermaid-flow (real) | 2 289 | 3 / 7 ms | 99–114 ms | 18 ms | – | 14 ms |
| generated, dense | 5 004 | 4 / 6 ms | 305–310 ms | 36 ms | 5 ms | 15 ms |
| pandoc-manual (real) | 8 283 | 15 / 18 ms | 147 ms | 32 ms | – | 34 ms |
| commonmark-spec (real) | 9 812 | 11 / 18 ms | 137–145 ms | 36 ms | – | 33 ms |
| generated, dense | 20 002 | 20 / 28 ms | 1.3 s | 40 ms | 3 ms | 49 ms |
| generated, light | 50 002 | 36 / 43 ms | 1.6 s | 34 ms | 3 ms | 54 ms |

| Target | Result |
|---|---|
| Keystroke < 16 ms up to 5 000 lines, < 32 ms up to 20 000 | **met**: 4 ms at 5 000 (dense), 11–15 ms at 8–10 000 (real), 20 ms at 20 000 |
| Mode change reading ↔ active < 100 ms up to 5 000 lines | **not met**: about 100 ms at 2 300 lines, 140–150 ms at 8–10 000 real lines, 300 ms on the dense 5 000. After an edit the reading view is drawn again: 110–450 ms |
| Dialog interactive < 120 ms | **met**: 18–40 ms |
| Formula preview ≤ 1 frame | **met**: 3–5 ms |
| Writing back < 50 ms up to 5 000 lines | **met**: 15 ms; 49 ms at 20 000 |
| Nothing left behind by 100 dialogs | **met**: the page has the same number of elements before and after; the same after 30 and after 60 quick changes of mode |

The mode change is the cost of laying out the view that comes into sight
(the other one is taken out of the page). Keeping both laid out and changing
only their visibility was built and measured — 95–100 ms at 8–10 000 real
lines, 160 ms on the dense 5 000 — and taken out again: with both views
present WebKit lays some things out differently (a scrollbar's height is
left out of a code block inside a grid or flex item; the tag of a numbered
formula comes out wider) and the page's height moved for a moment on the
first change. The views looking the same counts for more than those 50 ms.

Two measuring mistakes were found on the way and are fixed in the probes:
typed text has to be dispatched with `scrollIntoView` as the editor does it
(without it ProseMirror hit-tests the page to keep the scroll position:
34 ms instead of 5), and a file above the app's 2 MB editing limit is
read-only — the editor now refuses every change to such a file.

## Property tests (§16.1)

- **Random edits** now also change tables (rows, columns, alignment), paste
  Markdown, change code blocks and formulas as their dialogs do, and insert
  footnotes: 600 sequences of 12 edits; after every step the file says what
  the editor shows and holds nothing forbidden.
- **Portability (test D)**: every file the random edits produce is also read
  by a second, independent parser (micromark with its GFM extension). Where
  both agreed on the text before the edits (652 of 668 texts: the CommonMark
  examples and the fixtures), they agree after every edit: 9 221 files, no
  difference. In 5 of them the parsers differ only in whether a bare piece
  of text is an e-mail address — GFM leaves that open.

What they found, all fixed:

| Found | Fix |
|---|---|
| A block added below a code block that was never closed ended up inside it | the fence is closed when something follows |
| Items pasted into a list kept their own bullet character, which starts a new list | one bullet per list |
| `a*~~*x~~`: a literal `*` touching a delimiter is read differently by other parsers | such characters are escaped |
| A backslash line break right behind an address is taken into the address by GFM parsers | there the break is written with two spaces |
| Typed emoticons (`<3`, `:)`) came back as emoji | they are escaped |
| After a paste the file could end in an extra blank line | the end of the file is the original's |
| A line break in an empty paragraph (M4) | refused |

## Edge cases (§15)

`dev/tests/edges.test.mjs` (the document) and `dev/rig.sh edges` (the app).

| # | Case | State |
|---|---|---|
| 1 | Empty document: placeholder, never in the file | tested |
| 2 | Only frontmatter / a code block / a formula: text above and below | tested |
| 3 | Lines over 10 000 characters; 50 000 lines | tested; from 20 000 lines on the app says that the active mode may be slow; over 2 MB the file is read-only (the app's own limit) |
| 4 | List in quote in list; code in a list item; formula in a table; code with backticks | tested |
| 5 | Code holding a fence; unclosed code block at the end | tested |
| 6 | Prices, `$$` in code, `\$` | tested (also typed) |
| 7 | Broken Markdown stays as it is | tested |
| 8 | HTML comments are never lost | tested |
| 9 | Reference link without definition | tested |
| 10 | Setext headings, two-space line breaks | tested |
| 11 | Mixed line endings, BOM, no final newline | tested |
| 12 | Emoji, combining characters, right-to-left, CJK | tested (text and bytes; not how the caret moves in right-to-left text) |
| 13 | Dialog open and the file changes on disk | tested: the dialog stays, its change lands in the block it was opened for; if that block is gone, nothing is overwritten and the text goes to the clipboard |
| 14 | Quick changes of mode | tested: 60 at ten a second, no error, text kept |
| 15 | Undo across modes | tested (M5) |
| 16 | 1 MB pasted | tested (M4): 3.3 s |
| 17 | Narrow window | tested with the page zoomed to 445 CSS pixels: dialog, bar, menus and link form stay inside the window |
| 18 | Trackpad, pinch, Force Touch | not tested |

Also found here: a reload that was read from disk before the app's own last
save could replace newer text when the page was busy for seconds (very large
files) — saves are numbered now and an older reload is dropped.

## Accessibility (§14)

- Everything is reachable from the keyboard: the context menu opens with
  `Shift+F10` or the menu key at the caret; menus, dialogs, popovers and
  tables were already driven by keys.
- The editor is `role="textbox"`, multi-line, labelled. Islands are buttons
  that say what they are: "Code block, python, 12 lines. Press Enter to
  edit.", "Formula: a^2 + b^2. Press Enter to edit." Dialogs are modal,
  labelled, hold the focus, and hand it back to their block.
- `prefers-contrast: more` strengthens the edges and lines of the active
  mode's own parts.
- **Not done**: KaTeX's MathML output stays off, as in the reading view
  (turning it on would change that view); a formula is read out by its
  source instead. No screen reader was run (no VoiceOver here, Orca not set
  up); contrast was not measured.

## Visual regression (§16.4)

- Reading against active view: 52 documents, same words, same boxes, same
  heights; 51 pixel-identical (one has a live badge).
- Reading and source mode against `main`: report and screenshots identical
  for eight documents.
- Dialogs, menus and the bar were looked at in the dark theme and in the
  light fallback theme (`MDVIEW_THEME_DIR`).

## Other changes

- After a save the saved text is read again some seconds later; if it lost a
  block the editor holds, that is logged (§13).
- Stars behind a backtick that is still open stay stars (typing code).
- A dialog's block is selected while the dialog is up; menus scroll when the
  window is lower than they are; hidden popovers no longer add to the page's
  height.
