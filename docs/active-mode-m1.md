# Active mode — milestone 1 report (foundation and source fidelity)

Spec §17, M1: the third mode exists, shows the document exactly like the
reading view, cannot edit yet, and gives the file back byte for byte.

## What is there

- **Mode control**: the toolbar's edit button became a three-part control
  (source · active · read) whose thumb glides to the chosen mode.
  `Ctrl+Alt+1/2/3` pick a mode; `Ctrl+E` still toggles reading ↔ source.
- **Active mode** (`#active`): a ProseMirror view, not editable yet. Loaded on
  first use (`vendor/prosemirror.min.js` 271 KB and `active/*.js`), so
  reading and editing start as before.
- **Document store** (`active/store.js`): the file cut into segments that
  concatenate back to the original — one per top-level block, hidden ones for
  definition lines, separators in between, each with its own line endings.
- **Builder** (`active/schema.js`): markdown-it tokens → editor document.
  Paragraphs, headings, quotes, lists (bullet, ordered, tasks, tight and
  loose), rules and all inline formatting are real editor nodes; everything
  else is an island rendered by the reading view's own renderer.
- **Serializer skeleton** (`active/document.js`): walks the editor document;
  a block that is as it was loaded is written from its original slice.
- **Switching**: reading ↔ active swaps in place without a fade and without
  moving; source ↔ active crossfades and keeps the source line, as reading ↔
  source does. Find, outline, links, the copy button and task checkboxes work
  in the active view. A file changed on disk is reloaded in place.
- **Strings** in `strings.js` (English and German tables, English active).

## Tests

| | Result |
|---|---|
| `npm test` (jsdom, the app's own parser): store, round trip, structure | 17 pass; an 18th (optional local notes) runs only when asked for |
| Round trip, test A: 12 fixtures, 652 CommonMark examples, the GFM spec and extension examples, 37 real documents — each in 8 line-ending variants × in/outside a vault | byte-identical, all |
| Round trip over the local notes folder (`MDVIEW_CORPUS`) | byte-identical |
| `rig.sh compare`: 13 fixtures + 37 real documents in the running app | see below |
| `rig.sh modes`: 23 checks of switching, shortcuts, scroll, find, outline, task | all pass |
| `rig.sh folder`: 9 checks in a folder window (other notes, sidebar, back) | all pass |
| `rig.sh regress`: reading view and source editor against `main` — rendered HTML, layout, typing helpers, saved file, screenshots | identical |

`rig.sh compare` measures the position of every word and box in both views,
the total height, the round trip in the real engine and a screenshot of each.
All 50 documents: same layout, same height, round trip intact, scroll kept;
screenshots differ in 0 pixels for 49 (the 50th has a live badge that was
fetched twice). Right at the moment of the switch the height is already final
in 45; in 4 it is 1–5 px off until a picture or diagram is there, and 26 px in
one document with a picture that fails to load.

Switch times on this machine (M1 Air), reading → active: first time
60–130 ms for ordinary documents (includes loading the scripts), 4–25 ms
after that. The largest documents (8,000–10,000 lines) take 300–360 ms the
first time and 90–100 ms after; `katex-functions.md` (1,300 lines, 1,700
formulas) 500 / 160 ms. The spec's target (under 100 ms up to 5,000 lines) is
met except for formula-heavy documents and for the first switch; that is M6.

## Decisions taken in M1 (beyond the M0 analysis)

1. **The model holds the text as displayed; the source's spelling is not
   kept in the model.** A soft line break is a space, a run of spaces is one
   space, an emoji shortcode is the emoji. The first version kept the
   original spelling in a mark around such text; the extra element moved
   neighbouring text by up to a pixel, so it was removed. Consequence for M2:
   when a block is edited, the serializer writes it in canonical form and then
   merges that with the block's original text (three-way: canonical old,
   original, canonical new), so everything outside the edit keeps its
   spelling — delimiter style, line breaks, escapes, list markers alike. The
   result is re-parsed and compared with the editor's block; if they differ,
   the canonical form is used.
2. **White space**: the active document uses `white-space: normal`, like the
   reading view. With `pre-wrap` (what an editor normally needs) the space a
   line wraps at sticks out of code spans and highlights. In M2 only the
   block being typed in gets `pre-wrap`.
3. **Open HTML**: blocks that sit under one open HTML element
   (`<details>` … `</details>`, or an element that is never closed) are one
   segment and one island, because the reading view shows them nested.
4. **Fallback to an island** whenever the editor's own rendering could
   differ: a paragraph with inline HTML, an embed (`![[…]]`), `$$…$$` inside
   a line, nested highlights or sub/superscripts, an empty link, an empty
   heading or quote, a block with nothing visible (a formula that only
   defines a macro). In the real-document corpus that is 54 of about 3,300
   text blocks.
5. **Pictures**: the active view would load every picture again on each
   switch (a flash, and a jump until the size is known). Loaded `<img>`
   elements now change places with their counterparts in the other view; for
   those that cannot (inside `<picture>`), the size seen earlier is reserved.
6. **Shared code touched in `viewer.js`**: scroll anchoring, find, outline
   and link lookup take the visible root instead of `#content`; the link
   renderer no longer adds its class twice; `render()` keeps the text as on
   disk (`raw`). Covered by `rig.sh regress`.
7. **Development hook**: `MDVIEW_PROBE` / `MDVIEW_PROBE_OUT` in `mdview.py`
   evaluate a script in the page and store its report; inactive unless set.

## Not done yet, known gaps

- Not editable (M2). Callouts, tables, footnote definitions and frontmatter
  are islands until their milestones.
- An empty file shows an empty line in the active mode where the reading view
  says "This file is empty"; the placeholder comes with editing (M2).
- The last mode is not remembered across files and restarts (spec §4.1); the
  app opens in reading as before. Planned with the settings in M5.
- A picture that failed to load is requested again by the active view; until
  that fails too, the page is off by the height of its alternative text
  (moving the failed element over makes WebKit request it again as well).
- Mermaid diagrams inside islands keep their colours on a theme change until
  the document is shown again.
- First switch and formula-heavy documents are slower than the target, see
  above.
- Emoji typed as shortcuts (`:)`) are not distinguished from `:name:` in the
  model; an edited block gets them back through the merge of decision 1.
