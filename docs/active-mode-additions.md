# Active mode — what was built after M6

Henri's list of what was still missing (final report, "Not built"), built on
branch `active`.

| Was missing | Now |
|---|---|
| Settings (§18) | A settings dialog (Ctrl+, or the context menu), kept by the application in its state file and handed to every window: language, start mode, formatting bar, the `/` menu, Markdown at the caret, typographic quotes, wrapping of new paragraphs, where pictures go, a fixed style for new Markdown (bullets, numbers, italic, bold) |
| Drag and drop | A handle beside the block under the pointer; dragged, the block is the drag picture, a line shows where it goes, dropped it moves (one undo step, written back as it stood). Picture files dropped from the file manager are copied where pasted pictures go — or linked where they are when already in the note's folder |
| `/` insert menu | `/` at the start of an empty line (when switched on): headings, lists, task list, quote, code block, formula, table, divider, picture, footnote; typing filters it |
| Syntax at the caret | The marks of bold, italic, strikethrough, code, highlight, links and a heading's `#` show where the caret is (decorations; never in the file) |
| Typographic quotes | “…” ‘…’ (English) or „…“ ‚…‘ (German), apostrophes in words; never in code |
| Wrapping | New paragraphs are wrapped at 72–120 characters; existing ones stay as they are |
| Picture folder | Beside the note, or `./assets` |
| Table rows / columns by dragging | Drag a handle: a line shows where it goes; a click still opens the menu |
| Tables with `<br>` in a cell | Self-contained inline HTML (`<br>`, `<wbr>`, comments, `<img>`) is an atom; such a table is edited in its cells |
| Formula dialog | Block ↔ in the line, Copy LaTeX, Copy as Picture (the application takes a picture of the preview) |
| Resizable dialogs | Pulled larger at the corner, the size is kept; double click: its own size again |
| Restore after Esc | Opened again, a dialog offers what was thrown away |
| Properties as a form | Simple values (text, numbers, dates, yes/no, lists) open as a form; changes are written into the YAML line by line, everything else stays as it was; deeper values: YAML |
| Editor in dialogs | The partner of the bracket at the caret is marked; Ctrl+F searches; LaTeX commands are offered while typed (Enter or Tab takes one, the caret inside its braces) |
| Drawn tick | A ticked task's check is drawn left to right (a cover slides off it — only a transform moves) |
| Own tooltips | Every title in the window (toolbar, sidebar, pictures) shows as the app's own tooltip after 700 ms; at once when moving on from one |

Found on the way: a ProseMirror helper behind a `<br>` at the end of a
paragraph added a line (one document laid out 26 px taller) — fixed.

## Not built, still

- **Footnote definitions in place.** The reading view shows the notes in a
  section at the end, numbered in reading order, whatever the place of their
  definitions in the file; the active mode must look the same. An editable
  copy there would be a second place for text that lives elsewhere. They open
  in a dialog — with the editor's search and the preview.
- **CodeMirror.** Its useful parts are now in the app's own editor (bracket
  partner, search, LaTeX completion); CodeMirror itself would add 0.6–1 MB
  and a second way code is highlighted.
- **Spell checking**: off, as decided.

## Tests

- `npm test`: 58 (new: tables with `<br>`, the properties form).
- New probes: `prefs` (21 checks), `dnd` (11), `more` (19); the others
  extended. Real pointer events through the application for clicks and
  drags (`probe-pointer`, test builds only).
- Reading and active view: 53 documents laid out the same.

Not verified at the time of writing: the nested test compositor had no
screen to draw on (only the spare output was connected), so animations stood
still and screenshots came out empty. The checks that wait for an animation
to end (dialog settled, bar faded in, table handles, sidebar), and the
pixel comparisons of reading and source mode against `main`, could not be
run; everything that does not depend on frames passed.

## Blocks as wholes (2026-10-03)

`active/blocks.js`; probes `blocks` (28 checks) and `lists` (35).

- **Selecting.** A click on a block's handle selects the block (Shift+click
  extends). Then the keys work on blocks: ↑ ↓, Shift+↑ ↓, Ctrl+↑ ↓ (first /
  last), Alt+↑ ↓ (move), Ctrl+A (siblings, then everything), Enter (into
  the block; an island's dialog), Esc, Backspace / Delete, copy and cut as
  Markdown. A typed character continues at the end of the block. A click
  into the empty space beside the text lets the selection go. A table is
  not node-selected (the table plugin would make cells of it); the caret
  waits in its first cell.
- **Dragging.** The handle does the whole move itself: `dragover` and
  `drop` are handled on the document in the capture phase, a line of its own
  (`.blk-line`) shows the gap. Several selected blocks move together; what
  was moved stays selected.
- **List items.** The depth follows the pointer's way sideways from where
  the item was taken (`drag.dx`): straight up or down keeps it, right goes
  under the item above, left goes out. Every gap offers only the depths
  possible there; the line starts at the depth the item will have. Outside
  a list the items get a list of their kind.
- **The handle.** On a list's own space (bullets, indent) it is the item's
  at that height. To drag a whole list: select an item, Ctrl+A, drag.
- **A click below the last block** starts an empty line there (nothing in
  the file until something is written).
- **The / menu** also opens in a line with text and applies to that block.
- **The / menu, built as Craft builds its own** (branch `craft-feel`): every entry has a sign; text styles,
  lists and formats are groups with a menu beside them (→ opens, ← leaves, the block's own style is ticked);
  **Actions** duplicates, moves, selects, copies or deletes the block the caret is in (in a list: the item).
  Typing filters all of it into one flat list. The panel is at most 9.5 entries tall and keeps the height it
  opened with while it is filtered, so it does not jump under the eyes. Where the caret is decides what is
  offered: a task can be ticked, a table's cell gets its rows and columns. Motion and colours stay the
  app's (henri-ui tokens); Craft's own menu fades in in about 100 ms (measured from its help video).
  Tests: `tests/slash.test.mjs`, `rig.sh prefs`. For screenshots with no monitor attached, give the nested
  compositor an output of its own (`hyprctl output create headless` in the nested instance) and take the
  picture there with `grim -o`; without it the page gets no frames and every transition stays at its start.

Dragging is tested with made-up drag events, sent to the element under the
pointer; a drag with the real pointer cannot be started in the rig.
