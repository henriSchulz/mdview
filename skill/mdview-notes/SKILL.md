---
name: mdview-notes
description: Write Markdown files for Henri's notes app Markdown Notes (mdview / mdnotes) so they use what the app renders — callouts, decorations, columns, wide tables, KaTeX, Mermaid, svg fences, wikilinks, properties with a tile colour, PDF links and figures embedded straight out of a PDF (PDF++ style, no extracted images). Use whenever a note, summary, cheat sheet, lecture notes, study sheet, documentation page or any .md file is written for Henri to read in mdview, or when he asks for "eine Notiz", "eine md-Datei", "für mdview", "für meine Notizen", "Zusammenfassung als Markdown". Triggers: mdview, mdnotes, Markdown Notes, Notiz, note, .md, Zusammenfassung, Lernzettel, cheat sheet.
---

# Notes for Markdown Notes (mdview)

Henri reads and writes his notes in his own app (`mdview`, `~/Projects/mdview`). A file written for
it should be plain Markdown that also reads well elsewhere, and use the app's extras where they make
the note better. The full reference, with every example rendered, is
`~/Projects/mdview/docs/FEATURES.md` — read it when unsure whether something is supported.

## Rules

1. **One `# Title`** as the first line after the properties; the file name is the title in the
   sidebar, so name the file like the title (`Fourier Transform.md`, spaces are fine).
2. **Properties** only when they say something: `tags`, `date`, and `color` (red, orange, yellow,
   green, cyan, blue, magenta) to mark the note with a dot in that colour in All Notes.
3. **Write the note, not a demo.** Use an extra only where it carries content: a callout for the
   one thing not to miss, columns for a real side-by-side, a diagram where structure matters.
4. **Language**: the language Henri asked in (usually German) for the text; keep technical terms.
5. **Blank line** before and after every block (lists, fences, callouts, tables, column markers).
6. **Save** where Henri says; without a place, ask or use the folder he has open. Open it for him
   only if he asks: `mdview "FILE.md"`.
7. **Keep and send** what you wrote when the folder is a project with its history on — see
   *Keeping a version and sending it* below. Elsewhere, write the files and leave Git alone.

## What the app renders

| Want | Write |
|---|---|
| highlight | `==text==` |
| tag | `#tag`, `#nested/tag` |
| task | `- [ ] open`, `- [x] done` |
| footnote | `text[^1]` and `[^1]: the note` |
| key | `<kbd>Ctrl</kbd>` |
| sub / superscript | `H~2~O`, `x^2^` |
| definition | `Term` then a line `: meaning` |
| hidden comment | `%% not shown %%` |
| link to a note | `[[Note]]`, `[[Note\|text]]`, `[[Note#Heading]]` |
| a note shown in place | `![[Note]]` |
| picture | `![alt](file.png)` or `![[file.png]]` (relative to the note) |
| picture at a width | `![alt\|400](file.png)`, `![[file.png\|400]]`; `\|full` for the column's whole width (PDF embeds too) |
| formula in the line | `$a^2 + b^2 = c^2$` |
| formula as a block | `$$` on its own line, the LaTeX, `$$` on its own line |
| diagram | a fence named `mermaid` |
| a source or text file shown as code, read from the file | `![[src/main.c]]`, lines only: `![[src/main.c#L10-L42]]`, put away behind a card: `![[src/main.c\|hide The title]]` (`hide:small`, `hide:large`) |
| code put away behind a card | a fence's head `python hide The title` (`hide:small`, `hide:large` for the card's size) |
| drawing | a fence named `svg` with one `<svg>` element |
| a link to a note as a block of its own: a row, a card (a colour after it) | alone in its paragraph: `[[Note]] <!-- link row -->`, `[[Note]] <!-- link card blue -->` |
| PDF page link / embed | `[[paper.pdf#page=3]]`, `![[paper.pdf#page=3]]` |
| a figure out of a PDF | `![[paper.pdf#page=3&rect=72,400,300,520]]` — see *Pictures from a PDF* |

### Pictures from a PDF

When a note is written from a PDF (a summary, lecture notes, a paper read) and needs its figures,
tables or formulas as pictures, **do not extract them to PNG files**. Embed the region of the page
the way PDF++ does — the app shows the region in the note and a click opens the PDF there:

```markdown
![[paper.pdf#page=3&rect=72,400,300,520]]
```

- `rect` is `x1,y1,x2,y2` in PDF points (1/72 in), **origin at the lower left** of the page, as in
  the PDF itself. The path is relative to the note, like a picture.
- Find the region with PyMuPDF: `page.get_image_info()` or `page.get_drawings()` give the bounding
  boxes of a figure's parts, `page.search_for("Figure 3")` the caption. PyMuPDF counts y from the
  **top**, so convert: `y_pdf = page.rect.height - y_fitz`, and swap so that `y1 < y2`. Round to
  whole points and leave a few points of air around the figure.
- No clear box (a figure drawn in many pieces, a scanned page): embed the whole page,
  `![[paper.pdf#page=3]]`, or a region guessed from the caption's position.
- Quote the PDF with a link to the page, `[[paper.pdf#page=3|S. 3]]`, so the claim can be checked;
  a `selection=` link needs the viewer's text indices and is made in the app, not by hand.
- The PDF stays beside the note (or in the folder the note refers to); nothing is written into it.

### Callouts

```markdown
> [!warning] Title of its own
> Text.

> [!tip]- Folded until clicked
> Text.
```

Kinds: note, info, todo, abstract, tip, success, question, warning, failure, danger, bug, example,
quote, important. No title → the kind's name is the title.

### Decorations (a quieter emphasis than a callout)

```markdown
> [!block|green]
> A tinted block.

> [!focus|red]
> A quote with a coloured bar.
```

`[!block-focus|blue]` is both. Colours as for `color` above; the colour is optional.

### Columns

```markdown
<!-- columns 2:1 -->

Left block(s).

<!-- column -->

Right block(s).

<!-- /columns -->
```

The ratio is optional. Top level only: never inside a list, a quote, a callout or other columns.
Two to four columns; elsewhere they read as blocks one under the other.

### Tables and rules

A table is as wide as the text column by itself. A line right before it changes how it looks:
`narrow` (as wide as what it holds), `head=…` (its head row in a colour: red, orange, yellow,
green, cyan, blue, magenta, or any `#rrggbb`).

```markdown
<!-- table head=#cfeefc -->
| A | B |
|---|---|
| 1 | 2 |
```

A rule's look follows how it is written: `---` thin, `***` three dots, `___` heavy, `- - -` dotted.

### SVG drawings

````markdown
```svg
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120">
  <rect x="10" y="30" width="100" height="60" rx="8" fill="none" stroke="currentColor" stroke-width="2"/>
  <text x="60" y="66" text-anchor="middle" font-size="14" fill="currentColor">Block</text>
</svg>
```
````

- One `<svg>` root with `xmlns`, `width`, `height` and `viewBox`; at most about 700 px wide.
- `currentColor` for lines and text, so it reads in the light and the dark theme; add fixed colours
  only for accents. No white background rectangle.
- No scripts, event attributes or `foreignObject` (they are removed). Blank lines inside are fine.
- Text: `font-family="SF Pro, Inter, sans-serif"`, 12–14 px.
- Prefer `mermaid` for flowcharts, sequences and graphs; `svg` for figures Mermaid cannot draw
  (circuits, geometry, annotated sketches).

## Keeping a version and sending it

An agent may commit the notes it wrote, and push them, the way the app does — but only where the
app itself would. The app's rules are in `docs/FEATURES.md` under *History*; the code is
`src-tauri/src/history.rs` and `sync.rs`.

**When you may commit.** All three must hold; if one does not, do not commit — say so instead.

- The folder is a **project**: the nearest repository at or above the note has
  `.mdview/project.json` beside its `.git`. A repository without the marker is someone else's
  (source code, say) and is never written to.
- Its **history is on**: the marker file is there in the working folder. Switched off, the app
  takes the marker away (the last commit still has it) — then nothing is kept.
- Nothing is half done: no merge or rebase in progress (`git status` says so). That is Henri's or
  the app's to finish.

**How to commit.** One commit for what you wrote, as the app would have made it.

- Stage **only your own files** (`git add -- <paths>`). Other changes waiting in the folder are
  the app's to keep. Leave out what `.gitignore` leaves out and any file over 50 MB.
- **Subject**: one file → its file name (`Fourier Transform.md`, no folder). Several →
  `N files: a.md, b.md, c.md, …` — the first three names in path order, `, …` only when there are
  more than three.
- **Body**: the two lines the app reads, then nothing of your own in between:

  ```text
  14 files: A.md, B.md, C.md, …

  Device: omarchy-m1 (61cf07db-381b-4bee-ad76-3bec773b1f82)
  Client: claude-code
  ```

  `Device` is this computer as the app names it: `name (id)` from
  `~/.local/state/mdview/state.json` — the id is `device.id`, the name is `active.deviceName`
  where that is set, else `device.name`. `Client` names the program: `claude-code` (the app
  writes `desktop 0.1.0`, the browser `web`). An attribution line the session asks for
  (`Co-Authored-By: …`) goes after these, behind a blank line.
- **Author**: whatever Git is configured with in that repository; do not set one.
- Commit on the branch that is checked out. Never amend or rewrite a commit that has been sent.

**When you may push.** Only when the project is **linked**: the repository has a remote named
`origin`. Without one, the commit stays here and that is the end of it.

**How to push.** The repository on GitHub is what counts, and nothing is ever overwritten.

1. `git fetch origin`, then compare: `git rev-list --left-right --count <branch>...origin/<branch>`.
2. Nothing new there → `git push origin <branch>:<branch>`.
3. Another device kept something meanwhile → join first, as the app does, then push:
   `git merge --no-ff origin/<branch>` with the subject `Joined with what another device kept`
   and the same `Device:` / `Client:` lines.
4. The merge **conflicts** (both changed the same place) → `git merge --abort`, push nothing, and
   tell Henri: the app's clock turns red and Resolve Conflicts… is where it is settled.
5. Never `--force`, never a rebase of what is already there. A push that is refused or cannot
   reach GitHub is left for the app, which sends what waits the next time it reconciles.

Say afterwards what was kept and whether it went over (the commit, and "pushed" or why not).

## Do not

- No HTML for what Markdown can do; no inline styles. (`<br>`, `<kbd>`, `<details>` are fine.)
- No `$` around plain prices or shell variables in running text (`$5` alone is safe, `$x$` is a formula).
- No blank line inside raw inline `<svg>` outside a fence — use the `svg` fence instead.
- No nested columns, no columns inside lists or quotes.
- No frontmatter keys the note does not need.

## Check before handing over

- Every fence is closed and has its language; `$$` blocks are balanced.
- Wikilinks point to notes that exist in the folder (or are meant as notes to come).
- Pictures referenced exist beside the note; PDF embeds name a PDF that exists, a page it has and a
  `rect` with `x1 < x2`, `y1 < y2` inside the page.
