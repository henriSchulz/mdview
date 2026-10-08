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

### Wide table

```markdown
<!-- wide -->
| A | B |
|---|---|
| 1 | 2 |
```

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
