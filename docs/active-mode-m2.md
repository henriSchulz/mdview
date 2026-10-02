# Active mode — milestone 2 report (inline editing)

Spec §17, M2: paragraphs, headings, emphasis, links, lists, tasks and quotes
are edited in place; Enter and Backspace behave as specified; keys, input
rules and undo work; tests B (locality) and C (semantics) are green.

## What is there

- **Typing in the rendered document.** A click places the caret; the caret
  block keeps its look. Text blocks are paragraphs, headings, quotes, bullet
  and numbered lists, tasks.
- **Back to Markdown** (`active/markdown.js`). A changed block is written in
  canonical form and then merged three ways with its original text, so what
  was not edited keeps its spelling: line breaks inside a paragraph, `_` or
  `*`, escapes, list markers and indentation, reference links. The result is
  parsed again and compared with the editor's block; if it does not say the
  same, the merge gives up the original's spelling step by step around the
  edit, then escaping is raised, and at the end the plain canonical form is
  used. A list is written item by item, so an edit in one item cannot touch
  another. New text follows the document's style (bullet, emphasis and rule
  characters, numbering, hard-break form, nested indentation), found by
  majority.
- **Escaping** is minimal: `3 * 4`, `snake_case`, `a < b`, `$5` stay as
  typed; `# `, `1. `, `- `, `> ` at the start of a line, `<div>`, `&amp;` and
  — only if it would otherwise turn into formatting — `*`, `_`, `` ` ``, `[`
  get a backslash.
- **Keys** (`Ctrl` where the spec says `⌘`):

  | Key | Does |
  |---|---|
  | `Ctrl+B`, `Ctrl+I`, `Ctrl+Shift+X`, `` Ctrl+` `` | bold, italic, strike, code |
  | `Ctrl+K` | link form |
  | `Ctrl+Shift+1…6`, `Ctrl+Shift+0` | heading 1–6 (again: back to paragraph), paragraph |
  | `Ctrl+Shift+7`, `8`, `9` | numbered list, bullet list, task list |
  | `Tab` / `Shift+Tab`, `Ctrl+]` / `Ctrl+[` | indent / outdent a list item |
  | `Ctrl+Enter` | tick or untick the task |
  | `Shift+Enter` | hard line break |
  | `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` | undo, redo |
  | `Ctrl+A` | the block, then the document |
  | `Esc` | drop the selection |

- **Input rules**: `# ` … `###### `, `- ` / `* ` / `+ `, `1. ` / `1) `,
  `[ ] `, `> `, `---` + Enter; `**bold**`, `*em*` / `_em_`, `~~strike~~`,
  `` `code` ``, `==mark==`, `[text](url)`, `<https://…>`, a bare address or a
  `#tag` followed by a space, `$x^2$`, `[[Note]]`, `:smile:`. Backspace right
  after a rule, or `Ctrl+Z`, gives the typed characters back; they are then
  written escaped.
- **Enter**: new paragraph; after a heading a paragraph, inside one the rest
  becomes a paragraph; in a list a new item (a task starts unticked); in an
  empty item one level out, at the top out of the list; an empty quote line
  leaves the quote. **Backspace** at the start of a block first takes its
  formatting off (heading, list item, quote), then joins; an island above is
  selected first.
- **Links**: a click places the caret, `Ctrl+click` follows. The caret
  resting in a link shows a popover with its address and Open / Edit /
  Remove. The form (also `Ctrl+K`) edits text and address; a reference link
  stays one — its definition gets the new address.
- **What cannot be lost**: link, footnote and abbreviation definitions are
  hidden blocks that come back if a deletion takes them; comments and
  frontmatter are never part of an edited block.
- **Saving**: 800 ms after the last change, on `Ctrl+S`, on leaving the mode,
  the note or the window — byte-exact (`exact` flag to Python). A file
  changed on disk reloads in place unless there are unsaved edits, which win.
- **Undo** keeps working after going to another mode and back, as long as
  the text was not changed there.

## Tests

| | Result |
|---|---|
| `npm test`: 28 tests (store, round trip, structure, serializer, commands, random edits) | all pass |
| Test B + C: one word typed at a random place, 3,988 times over fixtures, the CommonMark examples and 37 real documents | 0 failed. 3,704 strictly local (take the word out and the old file is back); 284 changed more on their own line for a reason (an edited reference link needs its label, `__bold__` right after a letter has to become `**bold**`); 31 hit what Markdown cannot write |
| Random edits: 480 sequences of 12 operations (type, delete, marks, Enter, Backspace, headings, lists, tasks, indent, line break) | after every step the file says what the editor shows, and holds no HTML or invisible characters; 48 sequences ended in something Markdown cannot write |
| Canonical form of every editable block of the corpus (3,955) reads back as the same block | all but one (an image whose alternative text holds a link) |
| `rig.sh edit`, `link`, `native`, `modes`, `folder` in the running app | all pass |
| `rig.sh compare`: 49 documents, reading view against the (now editable) active mode at rest | same layout in all; screenshots identical except one live badge |
| `rig.sh regress`: reading view and source editor against `main` | identical |
| `rig.sh typing`: time per keystroke (transaction, plugins, redraw, layout) | median 4 ms in ordinary documents, 10–13 ms at 8,000–10,000 lines (95th percentile 17–19 ms) |
| … and to write the document back after an edit | 9–59 ms the first time, 1–17 ms after |

## Decisions and deviations

1. **White space while typing.** Only the block with the caret has
   `white-space: pre-wrap`, and only while the editor has the focus. WebKit
   lays out editable content differently by default (`-webkit-nbsp-mode`,
   `line-break`); both are reset so that the active view stays identical to
   the reading view. Typed spaces arrive as plain spaces; a trailing space is
   not written to the file.
2. **Text the parser formats by itself** (a bare address, a tag) gets its
   mark when typed, so the editor shows what the file will say. A bare
   address edited into something that is no address loses its link.
3. **What Markdown cannot say.** Emphasis that begins or ends next to
   punctuation inside a word (`x*(y)*`, `Text**, then** more`) is not
   emphasis in CommonMark. Such a block is written in plain canonical form;
   on reload the delimiters show as characters. No HTML is used to force it.
4. **Typing right after a link** does not extend the link.
5. **Lists**: two lists of one kind next to each other are joined in the
   editor (in Markdown they are one list); if they must stay apart the second
   takes another marker. A task needs a paragraph to start with.
6. **Shortcuts** differ from the spec where `⌘` combinations have no Linux
   counterpart or are taken: headings on `Ctrl+Shift+1…6`, inline code on
   `` Ctrl+` `` (`Ctrl+E` stays the mode toggle).

7. **Pictures that fail to load**: the room their placeholder takes in the
   reading view is reserved in the active view until its own request has
   failed too, so the page no longer jumps on the switch (the open point of
   M1).

## Not in this milestone

- Islands open no dialog yet (M3): code, math, frontmatter, HTML, callouts,
  tables and definition lists can be selected and deleted, not edited. The
  input rules for code fences, `$$` and tables come with their dialogs.
- Paste and copy are the browser's and ProseMirror's defaults; Markdown and
  HTML paste, images and "copy as Markdown" are M4.
- Context menu, formatting bar, shared undo with the source editor, the
  remembered mode and settings are M5; performance work and the property
  tests in full are M6.
- Not tested: input methods (IME, dead keys), a screen reader.
