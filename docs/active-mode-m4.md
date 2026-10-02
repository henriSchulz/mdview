# Active mode — milestone 4 report (tables, footnotes, paste and copy)

Spec §17, M4.

## Tables

- **Cells are edited in place.** A table is a real table in the editor
  (`table` › `table_row` › `table_cell`), looks exactly as in the reading
  view, and takes text, emphasis, code, links, formulas in its cells.
- **Keys**: `Tab` / `Shift+Tab` go from cell to cell (the content of the cell
  is selected), `Tab` behind the last cell makes a row. `Enter` goes to the
  cell below, in the last row it makes one. `Shift+Enter` does nothing: a
  cell is one line. What starts a heading or a list elsewhere (`# `, `- `)
  is text in a cell. A selection across cells selects cells; Delete empties
  them.
- **Handles**: with the pointer in a table, a small handle shows above the
  column and beside the row it is in — nothing is there otherwise. A click
  opens a menu: insert row above/below, move up/down, delete; insert column
  left/right, move left/right, align left/center/right (the one in use is
  ticked; choosing it again clears it), delete. A right click in a cell
  offers all of it, and "Delete Table". Each action is one undo step; a new
  row or column shimmers once.
- **Typed**: `| a | b |` and Enter make a table with these columns and one
  empty row.
- **Written back** (`active/tables.js`): the table keeps the way it was
  written — padded columns or not, pipes at the ends or not, spaces around
  the cells or not, the delimiter row's own form, numbers padded towards
  their alignment. A line whose cells did not change is the line that was
  there; only when a cell outgrows (or frees) its column are the other lines
  padded again — in their spaces and dashes, nothing else. Cells that were
  not edited keep their own Markdown (`__bold__`, `` `` ` `` ``). `|` in a
  cell is written `\|`. New tables are padded.

## Footnotes

- A reference `[^1]` is an atom in the text. Pointing at it shows the note
  in a small popover; a click scrolls to the note in the section at the end,
  which lights up for a second.
- The notes show where the reading view shows them — in the section at the
  end, numbered in reading order. A click on a note there (or Enter / double
  click on a reference) opens it in a dialog: its Markdown with a preview.
  It is written where its definition stands in the file; the other
  definitions in the same block are not touched.
- `[^label]` typed makes a reference. A label without a definition gets one
  at the end of the file and its dialog opens; left empty, both go again.
  `Ctrl+Alt+F` inserts a new note with the next free number.
- After every change to a reference or a definition the numbers and the
  section are drawn again (not part of the undo history).

## Paste

- **Text is read as Markdown** and keeps the way it is written: the pasted
  blocks become segments of the document's store, so `* item`, `__bold__`,
  a setext heading or a `~~~` fence are written as they came. Definitions in
  the pasted text come along. A single line goes into the line at the caret;
  the file's line endings are used.
- **HTML from a browser or a word processor** is reduced to what Markdown
  can say (`active/clip.js`): headings, paragraphs, lists (also task lists),
  quotes, tables, code blocks with their language, bold, italic, strike,
  code, links, pictures by address. Styles, classes, colours, sizes, scripts
  and embedded (`data:`) pictures are dropped. The editor then reads it with
  the schema's own rules and writes plain Markdown — no HTML ends up in the
  file. (HTML that is only styled text, as code editors put it on the
  clipboard, counts as plain text.)
- **Ctrl+Shift+V** pastes text as text: nothing in it is read as Markdown,
  special characters are escaped when written. So does any paste into inline
  code. The dialogs' editors are plain text fields anyway.
- **A picture on the clipboard** is saved as a file beside the note (or in
  the vault's attachment folder), as the source editor already does, and
  embedded by its name. Nothing is ever embedded as data.
- **An address pasted over a selection** links the selection.
- In a table cell, anything pasted is one line of text.

## Copy

- `Ctrl+C` / `Ctrl+X` put two things on the clipboard: `text/plain` is the
  selection's Markdown — whole blocks that were not changed exactly as they
  stand in the file, a part of a block by what it holds — and `text/html`
  is its rendering, with code blocks, formulas and footnotes as the page
  shows them. A selected island or table copies as its Markdown.

## Tests

| | Result |
|---|---|
| `npm test`: 44 tests. New: tables (style kept, keys, rows and columns, typed), footnotes, clipboard (Markdown in, HTML reduced, copy). Word insertions and random edits now also run through tables | all pass |
| `rig.sh m4`: 37 checks in the running app — the table against the reading view's, cell editing, keys, handles, menus, context menu, typed table, footnote popover / jump / dialog / new note, paste of Markdown and HTML, link by paste, copy | all pass |
| `rig.sh clip`: Ctrl+Shift+V and a pasted picture through the application (the nested session's own clipboard), 1 MB of Markdown pasted (3.3 s, written back verbatim, one undo step) | all pass |
| `rig.sh edit`, `islands`, `link`, `native`, `modes`, `folder` | all pass |
| `rig.sh compare`: 51 documents | same layout in both views (50 pixel-identical; `deno.md` has a live badge) |
| `rig.sh regress`: reading and source mode against `main` | identical |

## Decisions and deviations

1. **Footnote definitions are edited in a dialog, not in place.** The spec
   wants them editable inline "at the end of the document (or where they
   stand)". The reading view shows notes in a section at the end, in reading
   order, whatever the place of their definitions in the file — and the
   active mode has to look the same. An inline-editable copy there would be
   a second place for text that lives elsewhere in the file. So the section
   stays rendered and each note opens like an island.
2. **A table is not rewritten as a whole** when a cell changes (spec §5.4.7
   allows it): lines that need no change stay byte for byte.
3. **Tables the editor does not take apart** stay islands with the Markdown
   dialog: a cell with a line break (`<br>`), rows of unequal length.
4. **Moving rows and columns** is in the menu, not by dragging the handle.
5. **Pasted HTML**: highlight, sub- and superscript are dropped (not part of
   the syntax allowed for new content, §2.2).
6. **Pasted pictures** go where the app already puts them (beside the note),
   not into `./assets/`.
7. **Ctrl+Shift+V** asks the application for the clipboard's text (the page
   cannot read the clipboard by itself).
8. **A line break in an empty paragraph** is refused: Markdown has no
   paragraph of nothing but line breaks (found by the random edits).

## Not tested

- Selecting cells by dragging with a real pointer (emptying a cell selection
  is tested; the drag itself is the table library's own handling).
- Paste from real applications (browser, LibreOffice): the HTML cases are
  samples written for the tests.

## Not done

- Dropping a picture file onto the document.
- "Copy as Markdown" / "Copy as Text" in a context menu (M5, with the menu).
- A footnote's popover is not clickable; orphaned definitions (no reference
  left) stay in the file and are not shown.
- Pasting 1 MB takes about three seconds, during which the app does not
  respond.
