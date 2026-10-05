# Active mode — milestone 5 report (polish)

Spec §17, M5: context menu, formatting bar, micro-interactions, the caret
kept across modes, one undo history, the checklist of §11.4.

## What is there

- **Context menu** (`active/context.js`, `active/menu.js`). A right click in
  the document opens the app's own menu — never the browser's.
  - On text: Cut, Copy, Paste, Paste and Match Style, Add / Edit Link (and
    Open Link on a link), then three menus beside it: **Format** (Bold,
    Italic, Strikethrough, Code, Formula from Selection), **Paragraph**
    (Text, Heading 1–6, Bulleted / Numbered / Task List, Quote) and
    **Insert** (Code Block, Formula, Table, Divider, Footnote). What applies
    to the selection is ticked; shortcuts stand on the right.
  - On an island, an inline formula, a wikilink or a picture: Edit…, Cut,
    Copy as Markdown, Delete.
  - In a table cell: the text menu, with Row and Column menus and Delete
    Table in place of Paragraph and Insert.
  - A right click outside the selection moves the caret there first; inside
    it, the selection stays. Arrow keys, Home/End, Enter and Esc work; Right
    opens a menu beside, Left closes it.
  - Paste from the menu goes through the application (the page may not read
    the clipboard itself) and then the same way as Ctrl+V.
- **Formatting bar** (`active/bar.js`). 150 ms after a text selection it
  fades in above it (below, when there is no room above; never outside the
  window): Bold, Italic, Strikethrough, Code · Link, Formula · a paragraph
  menu (Text, Heading 1–3, lists, Quote). The buttons show what the
  selection is. It goes at once when typing, on Esc and when the selection
  scrolls out of sight; while dragging a selection it waits for the button
  to be let go.
- **Tooltips** for the bar (and a long address in the link popover): the
  app's own, after 700 ms — no browser tooltips in the new parts.
- **One history across the modes.** The texts a note is saved as form a
  trail (`viewer.js`).
  - Active → source: the steps made in the active mode are replayed into the
    source editor's own undo history, so `Ctrl+Z` there takes them back one
    by one (the last twenty).
  - Source → active: when the active mode's own history is used up,
    `Ctrl+Z` steps back along the trail — what was done in the source editor
    is undone, `Ctrl+Shift+Z` brings it back.
- **Undo steps.** An action from a menu, a dialog, a table handle or a paste
  is a step of its own: it does not run together with the typing before or
  after it. After undo and redo the caret is brought into view gently, a
  fifth of the window away from the edge.
- **The caret across the modes.** Between the active mode and the source
  editor the caret stays at the same place in the text (found by its block
  and the word before it). Between reading and active the place on screen
  was already kept.
- **The mode last used** is remembered: a new window opens in it.
- **Closing over an open dialog**: if the window is closed while a dialog
  holds changes, the app asks — Discard, Cancel, Apply — instead of dropping
  them. Saving while a dialog is open saves the document without the
  dialog's content, as specified.

## Tests

| | Result |
|---|---|
| `npm test`: 44 tests | all pass |
| `rig.sh m5`: 44 checks in the running app — the menus by pointer and by keyboard, each kind of action, paste from the menu (real clipboard of the nested session), the bar's timing, position, state and buttons, tooltip, undo and redo both ways across the modes, the caret both ways, the scroll after undo, the question on closing (Cancel keeps window and dialog; Apply saves the change and closes the window), the next start in the mode last used | all pass |
| `rig.sh edit`, `islands`, `m4`, `clip`, `link`, `native`, `modes`, `folder` | all pass |
| `rig.sh compare`: 52 documents | same layout in both views |
| `rig.sh regress`: reading and source mode against `main` | identical |

## §11.4 checklist

| Point | State |
|---|---|
| No layout jumps while editing; no flicker on typing, mode change, saving | kept from M1–M3 (pictures lent between views, sizes reserved, islands redrawn only when their Markdown changes) |
| UI not selectable, document selectable | dialogs, popovers, bar, menus: yes |
| Buttons with the default cursor; the hand only on links (with Ctrl in text) | yes |
| Soft focus rings, only with the keyboard | the app's `:focus-visible` ring |
| No browser tooltips | new parts: own tooltips. The window's toolbar still uses `title`, as before |
| No `alert` / `confirm` / `prompt` | none; the one question is an own dialog |
| Errors where they arise | formula and YAML errors in their dialog |
| Scrollbars, overscroll | the app's own, unchanged |
| Double click selects a word, triple click a paragraph | the browser's own behaviour, untouched |
| Reduced motion | movement is dropped centrally (`motion.css`), fades stay |
| Dark and light | every colour is one of the theme's variables |
| Spell checking, dictionary lookup | off: no spell checking for now (decided) |
| IME, dead keys | not tested (no input method set up here) |
| Drag and drop with a preview and an insertion mark | not built |

## Decisions and deviations

1. **The history across modes steps by saved texts**, not by single
   keystrokes: one step is what was typed between two saves (about a second
   of pause). Inside a mode its own, finer history applies. Changing the
   note ends the trail.
2. **The start mode** follows the spec ("last used"), which means a file
   opened from the file manager shows in the source editor if that was the
   mode last used. Before, every window opened reading.
3. **Leaving the mode or the note with a dialog open** still takes the
   dialog's content (M3); only closing the window asks.
4. **No settings**: the app has no settings dialog, so the bar cannot be
   switched off and nothing of §18 is configurable.
5. **The `/` menu** (optional) is not built; Insert in the context menu does
   its job.
6. **Checking off a task** uses the checkbox's existing transition; no drawn
   check mark.

## Not done

- Drag and drop (blocks, picture files).
- "Syntax at the caret", typographic quotes, hard wrapping (§18).
- The window's own toolbar tooltips.
