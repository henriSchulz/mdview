# Active mode — milestone 3 report (islands and dialogs)

Spec §17, M3: what is not edited inline — code, formulas, frontmatter, HTML,
pictures — stays rendered and opens in a dialog or popover.

## What is there

- **Dialog** (`active/dialog.js`). It grows out of the island and shrinks
  back into it (transform and opacity, henri-ui's `gentle` spring in, the
  usual faster exit out); an island taller than 60 % of the window gets a
  sheet from above instead. The page behind dims and blurs slightly, the
  dialog itself is a blurred translucent panel. `Ctrl+Enter` or a click
  beside it takes what was entered, `Esc` drops it; `Tab` stays inside. One
  dialog is one undo step; nothing changed writes nothing. Leaving the mode
  or the note with a dialog open takes its content.
- **Code editor in the dialog**: the source editor's kind — a text area under
  a highlighted copy of its text — highlighted by highlight.js with the
  document's own colours, so code looks the same in the dialog as on the
  page. Line numbers, the current line, Tab / Shift+Tab to indent, Enter
  keeps the indentation.
- **Code block** (fenced, indented, Mermaid, ```` ```math ````): language
  field with the known languages and the ones used last, the rest of the info
  string in a field of its own and otherwise untouched, line and character
  count, Copy. Mermaid and math blocks preview below the editor. Written
  back: the fence character and length stay (longer if the code holds a
  fence), indentation inside a list item is taken off for editing and put
  back, indented code stays indented until it gets a language.
- **Formula** (`$$…$$`): preview on top, at every keystroke; on an error the
  last good preview stays, dimmed, with KaTeX's message and a wavy mark at
  the place. Brackets close themselves, `\begin{x}` + Enter adds `\end{x}`,
  a row of buttons inserts common constructs. How the dollars stand (own
  lines or on one line) is kept; the LaTeX is written exactly as entered.
  Blank lines get a hint with a Remove button.
- **Inline formula**: a click opens a small popover with one field and a
  live preview; Enter takes it, Esc drops it, Shift+Enter moves to the big
  dialog. **Wikilink** and **picture**: fields in the same popover (note and
  alias; description, address, title) on double click or Enter.
- **Properties** (frontmatter): YAML with validation; an invalid document can
  still be saved, the message stays visible.
- **Everything else** — HTML, callouts, tables (until M4), definition lists,
  blocks that fell back to an island: their Markdown in the editor, with the
  rendering below it. What is entered is parsed again; if it is an ordinary
  block now, it becomes editable inline.
- **Opening**: a click on the island (not on its copy button, a link or a
  fold marker in it), Enter or Space when it is selected. Arrow keys select
  an island rather than skip it; Backspace on a selected island deletes it;
  below the last island the gap cursor lets one type.
- **Made by typing**: ```` ```lang ```` + Enter and `$$` + Enter create the
  block and open its dialog; left empty and cancelled, it is gone again.
- **Hints**: islands tint on hover and show a pencil; after a change the
  block shimmers once instead of blinking. Islands carry a role and a label
  ("Code block, 3 lines. Press Enter to edit.").

## Tests

| | Result |
|---|---|
| `npm test`: 33 tests, new: islands taken apart and put together (code, formula, frontmatter), random edits now also over a document full of islands | all pass |
| `rig.sh islands`: 45 checks in the running app — every dialog and popover, undo, Esc, click beside, nested and indented code, blocks made by typing, Mermaid preview, leaving the mode with a dialog open | all pass; the file on disk holds exactly the edits |
| `rig.sh edit`, `link`, `native`, `modes`, `folder`, `regress`, `compare` | all pass, layout unchanged |

## Decisions and deviations

1. **No CodeMirror.** The spec recommends CodeMirror 6 "or the editor the
   existing edit mode uses". The second was chosen: the app's own
   text-area editor with highlight.js. It keeps the dialog's highlighting
   identical to the document's, adds no bundle (CodeMirror with languages is
   0.6–1 MB), and keeps native undo and input methods. What it lacks against
   CodeMirror: bracket matching, multiple cursors, search inside the dialog,
   LaTeX autocompletion.
2. **Tab** indents in the editor, so the keyboard leaves the editor with
   `Ctrl+Enter` (done) or `Esc` (cancel) rather than by tabbing to the
   buttons.
3. **`Esc`** discards without asking, as specified; the "restore discarded
   changes" offer is not built.
4. **Indented code right after a list** would read as part of the list's last
   item once the list is new or changed; it is then written with a fence.
5. **Pictures**: the popover has the three text fields; "Choose file…" and
   drag and drop come with paste in M4.

## Not done

- Block ↔ inline switch in the formula dialog; "copy as picture".
- The dialog is not resizable and does not remember a size; the island's
  change of height after a dialog is not animated.
- A form view for frontmatter; a chip bar for frontmatter that renders
  nothing (empty properties cannot be opened by click).
- Footnote references and definitions, tables with cell editing: M4.
- Closing the window with a changed dialog open discards its content without
  asking.
