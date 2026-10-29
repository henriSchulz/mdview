---
name: mdview-notes
description: Write a note for Henri's notes app Markdown Notes (mdview / mdnotes) — a short, exact note on one subject, written as a textbook writes it, with the app's extras only where they carry content (properties, KaTeX, tables with a coloured head, callouts, definition lists, wikilinks, figures as svg fences — never Mermaid — and regions of a PDF embedded in place). Use whenever a note, summary, cheat sheet, lecture notes, study sheet or any .md file is written for Henri to read in mdview, or when he asks for "eine Notiz", "eine md-Datei", "für mdview", "für meine Notizen", "Zusammenfassung als Markdown". Triggers: mdview, mdnotes, Markdown Notes, Notiz, note, .md, Zusammenfassung, Lernzettel, cheat sheet.
---

# Notes for Markdown Notes (mdview)

Henri reads his notes in his own app (`mdview`, `~/Projects/mdview`). A note is plain Markdown that
reads well anywhere and uses the app's extras only where they carry content. Everything the app
renders, each example shown, is in `~/Projects/mdview/docs/FEATURES.md`; search it when unsure.

## What a note is

A note is one subject, written down so that it can be understood and looked up: the entry a good
textbook or a formulary has on it, not the answer in a chat. It is kept, read again, and read
beside other notes.

- **Small.** One subject, and only what belongs to it: about one screen — 200 to 500 words of
  text, with the formulas, one table and one figure where they are needed. A subject that needs
  more is several notes, each on one part, linked with `[[…]]`; never one long note.
- **Exact.** Every statement is one that holds, and the condition under which it holds stands
  beside it. A symbol is named where it first appears, a quantity carries its unit, a number its
  precision and its source. No "etwa", "meist", "in der Regel" where the exact statement is known.
- **Dense.** Every sentence adds a fact. Nothing announces, repeats, summarises or comments on what
  the note says; no sentence under a heading says what the section is about.
- **In order.** Definition, then the statement (formula, law, mechanism), then the one worked
  example or figure that makes it visible, then what follows from it. A derivation gives every
  step; a long one is a note of its own. Not: motivation, history, overview, outlook.

## How it reads

Formal, in the third person, in complete sentences, in the language Henri asked in (usually
German), with the field's terms as the field writes them (English where it does).

- **It begins with the matter.** The first sentence is the definition or the central statement.
  No "Diese Notiz …", "Im Folgenden …", "Ein Überblick über …", and no closing "Zusammenfassung",
  "Fazit", "Merke", "Nächste Schritte".
- **Headings name their subject** as a noun phrase ("Faltungssatz", "Randbedingungen"),
  unnumbered, two levels at most. Not a question or a teaser, not "Grundidee", "Überblick",
  "Was passiert hier?".
- **No section that was not asked for**: no quiz, "Kontrollfragen", "Tipps", "Häufige Fehler",
  "Vorteile und Nachteile", "Anwendungen" as padding. Henri asks when he wants one.
- **No address to the reader**, no rhetorical question, no exclamation mark, no emoji, no "ganz
  einfach", "kurz gesagt", "spannend", "wichtig zu verstehen". No aside between dashes; a sentence
  of its own instead.
- **Prose where there is an argument, a list where there is an enumeration.** No paragraph chopped
  into bullets with a bold lead ("- **Anregelzeit**: …"): terms get a definition list, steps a
  numbered list, values a table. Bold marks a term only where it is defined.
- **Nothing from outside without its source.** A note from a PDF links the page it draws on
  (`[[paper.pdf#page=3|S. 3]]`). No pictures pulled from the web: a figure is drawn (below) or
  embedded out of the PDF.

## Formulas and figures

A formula stands as a block, `$$` on its own lines, its symbols named in the sentence before or
after it; in the running text it stays in the line, `$…$`.

A figure is drawn where structure must be seen: a block diagram, a signal flow, the layers of a
membrane, a circuit, a geometric construction, a measurement setup. **Always as an `svg` fence,
never Mermaid** — its layout and look are not the note's. One figure a note is the rule; a second
needs a second structure. A figure that only decorates or repeats a table is left out, and so is
a flowchart of the note's own structure.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="110" viewBox="0 0 400 110" font-family="SF Pro, Inter, sans-serif" font-size="13" fill="none" stroke="currentColor" stroke-width="1.5">
  <defs><marker id="rk-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor" stroke="none"/></marker></defs>
  <rect x="150" y="35" width="100" height="40" rx="4"/>
  <line x1="60" y1="55" x2="148" y2="55" marker-end="url(#rk-a)"/>
  <line x1="250" y1="55" x2="340" y2="55" marker-end="url(#rk-a)"/>
  <g fill="currentColor" stroke="none">
    <text x="200" y="59" text-anchor="middle">Regler</text>
    <text x="100" y="47" text-anchor="middle" font-style="italic">e</text>
    <text x="300" y="47" text-anchor="middle" font-style="italic">u</text>
  </g>
</svg>
```
: The caption stands on the line right under the fence.

- One `<svg>` root with `xmlns`, `width`, `height` and `viewBox`, at most 700 wide: the app centres
  it and scales it down to the column.
- `currentColor` for every line and label, so it reads in the light and the dark theme; at most one
  accent colour (`#0071e3`), for the one thing the figure is about. No background rectangle, no
  gradient, pattern or shadow.
- One stroke width throughout (1.5 or 2), coordinates on a grid of 10, arrows through one
  `<marker>`. Labels stand clear of lines, `text-anchor="middle"` in boxes, 12 to 14 px, variables
  in `font-style="italic"` as in the formulas.
- Ids (`marker`, `clipPath`) carry a prefix of the figure's own: all figures of a note share one
  page.
- The caption says what is shown; no title inside the picture. No scripts, event attributes or
  `foreignObject` (they are removed).

## The file

- `# Title` as the first line after the properties; the file is named like the title
  (`Fourier Transform.md`, spaces are fine).
- Properties only when they say something: `tags`, `date`, `color` (red, orange, yellow, green,
  cyan, blue, magenta: a dot in All Notes). `width: wide` only for a note of wide tables or
  figures; `background` is Henri's to set in the app.
- A blank line before and after every block (list, fence, callout, table, column marker).

## What the app renders

The daily tools:

| Want | Write |
|---|---|
| formula | `$a^2$` in the line; `$$` on its own line, the LaTeX, `$$` on its own line |
| definition | `Term` then a line `: meaning` |
| table with a coloured head | a line `<!-- table head=cyan -->` right before it (the seven colours or `#rrggbb`); `<!-- table narrow -->` as wide as its content |
| callout | `> [!note] Title` then `> text` lines; kinds: note, info, abstract, tip, example, question, warning, danger, quote, important; `[!tip]-` folded. One a section at most, with a plain title ("Definition", "Satz", "Hinweis") |
| figure | an `svg` fence, as above; caption `: text` on the line under it (a picture, a PDF region and a `$$` block take one too) |
| link to a note | `[[Note]]`, `[[Note\|text]]`, `[[Note#Heading]]`; `![[Note]]` shows it in place |
| footnote | `text[^1]` and `[^1]: the note` |
| highlight | `==text==` |
| picture | `![alt](file.png)`, `![[file.png\|400]]` at a width, `\|full` for the column's width. What the app itself inserted lies in `assets/` of the notes' base folder — keep such lines as they are |
| figure out of a PDF | `![[paper.pdf#page=3&rect=72,400,300,520]]` — see below |
| page of a PDF | `[[paper.pdf#page=3]]` a link, `![[paper.pdf#page=3]]` the page in place |

Seldom, when the content asks for it:

| Want | Write |
|---|---|
| sub / superscript | `H~2~O`, `x^2^` |
| key | `<kbd>Ctrl</kbd>` |
| tag, task | `#tag`, `- [ ] open`, `- [x] done` |
| tinted block, coloured bar | `> [!block\|green]`, `> [!focus\|red]`, `[!block-focus\|blue]` (colour optional) |
| columns | `<!-- columns 2:1 -->` … `<!-- column -->` … `<!-- /columns -->`; top level only, two to four, never in a list, quote or callout |
| text centred / at the right | `A line <!-- center -->`, `## Title <!-- right -->` |
| a note as a row or card | alone in its paragraph: `[[Note]] <!-- link row -->`, `[[Note]] <!-- link card blue -->` |
| a file shown as code | `![[src/main.c]]`, `![[src/main.c#L10-L42]]`; put away behind a card: `![[src/main.c\|hide Title]]`; a fence put away: head `python hide Title` (`hide:small`, `hide:large`) |
| rules | `---` thin, `***` three dots, `___` heavy, `- - -` dotted |
| picture turned | `![[file.png\|r90\|400]]` (r90, r180, r270; before the width) |
| hidden comment | `%% not shown %%` |
| whiteboard | never written by hand; an `![](assets/….board.svg)` line stays as it is |

### Figures out of a PDF

Never extract a figure to a PNG. Embed the region as PDF++ does; the app shows it in the note and a
click opens the PDF there:

```markdown
![[paper.pdf#page=3&rect=72,400,300,520]]
: Figure 3 of the paper: what it shows.
```

- `rect` is `x1,y1,x2,y2` in PDF points (1/72 in), origin at the lower left; the path is relative
  to the note.
- With PyMuPDF, `page.get_image_info()` and `page.get_drawings()` give the boxes of a figure's
  parts, `page.search_for("Figure 3")` the caption. PyMuPDF counts y from the top:
  `y_pdf = page.rect.height - y_fitz`, then order so that `y1 < y2`. Whole points, a few points of
  air around the figure.
- No clear box (many pieces, a scan): the whole page, `![[paper.pdf#page=3]]`.
- The PDF stays where it is; nothing is written into it.

## Before handing over

- Read it once as Henri will. Is the first sentence the matter? Does a sentence only announce,
  repeat or comment? Would it be two notes?
- Every fence is closed and named, `$$` balanced; wikilinks name notes that exist or are meant to
  come; pictures exist beside the note; a PDF embed names a PDF and a page that exist, with
  `x1 < x2` and `y1 < y2` inside the page.
- No HTML for what Markdown does (`<br>`, `<kbd>`, `<details>` are fine); no `$` around a price or
  a shell variable in running text; no frontmatter the note does not need.

## Where it goes

Save where Henri says; without a place, ask, or use the folder he has open. Open it only when he
asks: `mdview "FILE.md"`. In a folder that is a project with its history on, commit what you wrote
the way the app would: `history.md` beside this file has the rules (when a commit is allowed, its
form, when to push, the pasteboard). Elsewhere write the file and leave Git alone.
