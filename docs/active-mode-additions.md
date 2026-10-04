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
- **All notes as tiles** (branch `craft-feel`, Craft's document overview; `overview.js`, `overview.css`): in a
  folder window the toolbar's grid button or Ctrl+Alt+G shows every note of the folder as a tile — the note
  in small, its name above the beginning of what it says, grouped by folder. A note whose properties say
  `color: red` (one of the theme's colours) has a frame and a wash in that colour. Arrows move, Enter opens,
  Esc closes. The application reads the beginnings (`previews` message, 2.4 KB per note, 60 per request);
  they are rendered once and again only when the file changed. Not there yet: sorting, a new note from the
  overview, pictures embedded with `![[…]]`. Probe: `rig.sh overview` (notes in `dev/tests/overview-notes`).
- **A table as wide as the text column** (branch `craft-feel`): a right click in a table has **Full Width**
  (ticked when on; the / menu in a cell has it too). In the file it is a line `<!-- wide -->` right before
  the table — a comment no renderer shows; the parser takes the line into the table (`wide_tables` core rule,
  `.table-wrap.wide`), the active mode keeps it as the table's `wide` attribute. Tests: `tests/widetable.test.mjs`.
- **Columns** (branch `craft-feel`; `active/columns.js`, nodes `columns` / `column` in schema.js, the `columns`
  core rule in viewer.js): blocks side by side. In the file they stand one under the other between comment
  lines no renderer shows — `<!-- columns 2:1 -->`, `<!-- column -->`, `<!-- /columns -->` (the widths as a
  ratio, left out when all are alike) — so elsewhere the text simply reads top to bottom. Only among the
  document's own blocks, never inside each other, a list or a quote; at least two columns to a row. Under
  640 px they stand one under the other.
  *Making them*: / → Columns → 2 / 3 / 4 (the caret's block becomes the first), the panel's tiles (a new
  empty row), or a block dragged to the side of another: at its right end, or at the very left of the text
  → the two become a row; at a column's edge → a new column of that row (a line down the side shows it;
  list items dragged over a list never do this). *In a column*: Add Column Left / Right, Move Column, Equal
  Widths, Unwrap Columns, Remove Column (what it holds joins the column beside it), also in the panel's
  Format tab; Backspace in a column with nothing in it takes it away; a column a drag has emptied goes, and
  with one column left the row is no row. *Widths*: the gap between two columns is pulled (`.col-grip`; the
  two share what they had, none under 12 % of the row; shown at once by a decoration, written when let go
  as shares of a hundred, alike again when nearly so); a double click makes all alike. Blocks in a column
  have their handles, are dragged, selected and duplicated there. Tests: `tests/columns.test.mjs`; probe
  `rig.sh columns` (the gap with the real pointer, the drags with made-up drag events).
- **The panel at the right** (branch `craft-feel`, Craft's right sidebar; `active/panel.js`, styles at the end
  of active.css; what was found of the original is in `~/Projects/craft-clone/replica/recon.md`, addendum):
  the toolbar's last button or Ctrl+Alt+P — in the active mode only: in the reading view and the source
  editor the button stands dimmed and does nothing.
  **Insert**: tiles with a small picture each, in sections (Blocks, Lists, Decorations, Callout, Separators,
  Media), a search field above them. A click puts the thing below the block the caret is in (inside a quote
  or a list item: in there, as the / menu does); dragged, it goes between the blocks where it is dropped (a
  line shows the gap; top level only). Footnote and Graphic are by click only. **Format**: the / menu's
  entries for the block the caret is in, laid out — text styles, bold/italic/strike/code, lists and indent,
  decorations, colours, callouts, in a table Full Width and its rows and columns; what is on is shown and
  follows the caret (a plugin's view update, once per frame). The panel never takes the focus from the text
  except for its search field. Open or not and the tab are settings (`panel`, `panelTab`). Craft's Style
  and Info tabs are not built. Probe: `rig.sh panel`.
- **Callouts in place, and from the / menu** (branch `craft-feel`): a plain callout — a kind, maybe a title,
  something in it — is no island any more: it is a quote with the attributes `callout` (the kind as written)
  and `title`, drawn as the reading view draws it (title bar not typed in, the text below edited in place;
  `calloutDOM` in schema.js). The / menu's **Callout** group puts one around the block (Note, Info, Tip,
  Success, Question, Warning, Error, Bug, Example, Important); another kind keeps the title, the same kind
  again takes it away, a decoration replaces it. Still islands (their Markdown in a dialog): folded callouts,
  those of PDFs (`[!pdf|yellow]`), those with nothing in them.
  The title is typed in where it stands (`quoteView` in view.js, a node view): a click puts the caret into
  it and shows its Markdown, all of it selected; Enter, ↓ or leaving it writes it, Esc leaves it as it was;
  emptied (or the kind's own name) there is no title of its own. From the keyboard: / → Callout → Edit Title.
  Tests: `tests/callout.test.mjs`, `rig.sh callout`; `rig.sh compare` on obsidian.md shows both views laid out alike.
- **A rectangle pulled over blocks** (branch `craft-feel`, blocks.js): pressed in the empty space beside or
  below the text and pulled, the pointer draws a rectangle (`.blk-band`); the blocks of the document it
  reaches are selected as wholes, never the text in them, and stay so when it is let go — the keyboard and
  the handle's drag go on with them. It starts after 4 px, takes nothing while it is only beside the text,
  scrolls the page near the window's upper and lower edge, Esc gives it up. A press let go where it was is
  a click as before (the selected blocks are let go; below the last block an empty line). The panel at the
  right and the overview count as chrome now: a click there no longer lets the selected blocks go. Top-level
  blocks only. Probe: `rig.sh blocks` (real pointer; `probe-pointer` moves with `held` for a drag).
  Several selected blocks have **one handle**: it stands beside all of them, from the first to the last, its
  grip at the first (`placeGroup`); a click on it leaves them selected, dragging it takes them all. What is
  under the pointer while they are dragged is a picture of all of them on a card (`ghostOf`, at most 340 px
  tall), and the blocks themselves stand back (a class on the page, `blk-dragging` — the editor's own
  elements are not touched: a class set on them makes it draw them anew and lets the selection go).
- **Blocks picked one by one** (branch `craft-feel`, blocks.js): Ctrl+click on a block (or on its handle) adds
  it to the selected blocks, or takes it out; a link keeps its own Ctrl+click. Beside the range
  (`anchor`…`head`) the selection has `more`, positions of blocks picked apart; where the picked blocks stand
  together it is a range again (`selFor`). Not together: a block and one inside it, list items and other
  blocks (what is clicked then begins anew). With blocks picked apart: Backspace deletes them, Ctrl+C / X
  takes each of them one after the other, Ctrl+D makes them once more below the last, Alt+↑ ↓ first brings
  them together where the first stands; dragged (the handle of the one under the pointer takes them all),
  they land together. The **rectangle** now also begins in the empty space inside the text — between two
  blocks, in a row's gap, below a short column (a press let go there is a click: the caret) — and, reaching
  only a row of columns, takes the blocks of the columns it touches instead of the row.
  In columns the handle of a block stays in the gap before its column; the width shown while a gap is
  pulled is a property of its own (`--w-live`; taking a `flex` decoration away took the column's own width
  with it — every press on the grip that changed nothing made the columns alike), and widths are written
  to a tenth so nothing moves when the grip is let go. Columns stay columns when they are moved: with every
  block of every column of a row picked, the row itself is what is selected (`selFor`), and its handle
  shows over any block in it; two or more whole columns of a row, dragged, go as a row of their own (the
  row they leave closes up). Tests: `tests/pick.test.mjs`, `rig.sh columns`.
- **The handle is a part of its block** (branch `craft-feel`, blocks.js `besideAt`): it shows where it stands,
  too — with the pointer beside the block at the handle's place, not only over the block's text. Left of the
  text (up to 44 px out): the block at that height, in a list the item, in a row of columns the block of its
  first column; further out (up to 76 px): the row itself, whose handle stands further out than its blocks'.
  In a row's gap: its right 22 px, at the first line of a block of the next column, are that block's handle;
  the rest of the gap, at any height, pulls the widths (the grip is as wide as the gap and lies under the
  handles; the gap is 36 px). The handle comes at once (`--dur-instant`).
- **Blocks by the keyboard** (branch `craft-feel`, as Craft's block mode): Esc in the text takes the block
  the caret is in (the item in a list, the table around a cell); Esc or Enter gives the caret back where it
  was. On blocks: Space puts an empty block below (Shift: above) with the caret in it, Ctrl+D makes them once
  more below (also in the text, for the block the caret is in), Alt+Shift+↑ ↓ moves them to the top / the end.
  Tests: `tests/blockkeys.test.mjs`.
- **Decorations** (branch `craft-feel`, Craft's Block and Focus): a quote can be a tinted block or carry a bar
  in a colour. In the file it is a callout without a title — `> [!block]`, `> [!focus|red]` (Obsidian's
  metadata place holds the colour: red, orange, yellow, green, cyan, blue, magenta; elsewhere it shows as a
  callout named Block / Focus). The reader keeps it a `<blockquote class="deco …">`, the active mode edits its
  text in place (attrs `deco`, `color` on the quote). The / menu has Decorations and Color; a colour chosen
  for plain text makes a block of it, for a quote a bar. With a title (`[!block] Title`) it stays a callout.
  A block can be both at once (`> [!block-focus|green]`): in the menu Block and Focus are switched on and
  off each by itself, and the last one switched off takes the quote away. A command of the / menu never
  moves the caret out of the block it was called in — Duplicate puts the copy below and leaves the caret
  where it is. Enter that reaches the page as a line break instead of a key (an input method) is taken as
  the choice too (`beforeinput` in menu.js), so no line break gets into the text while the menu is open.
  Craft's separator weights were left out: `***` and `___` would have to mean "strong" and "light", which
  restyles the rules of every note that has them. Tests: `tests/deco.test.mjs`.
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
