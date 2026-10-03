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
