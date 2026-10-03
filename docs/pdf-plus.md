# PDFs in mdview (after Obsidian PDF++)

The working way of [Obsidian PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus)
(MIT): **a link to a text selection is the annotation.** Nothing is written
into the PDF and nothing is stored beside it — the notes hold everything, as
plain Markdown with Obsidian's link syntax.

    [[paper.pdf#page=3&selection=4,0,5,20&color=red|paper, page 3]]
    ![[paper.pdf#page=3&rect=72,400,300,520]]
    [[paper.pdf#page=3&offset=0,640,1.5]]

`pdfview.js` + `pdfview.css`, loaded on first use; rendering is pdf.js 3.11
(`vendor/pdfjs`, Apache-2.0), on the main thread. The page may not read
files, so the application hands it the PDF's bytes (`pdfdata` →
`MdView.pdfChunk`), and the links to the PDF found in the notes around it
(`pdf_backlinks`: the vault, else the folder of the window, else the PDF's
folder).

## What is there

- **The viewer.** A link to a PDF (wikilink or Markdown link) opens it in
  the window, like a note; Back returns. `mdview file.pdf` works too.
  Pages are drawn as they come near; text can be selected.
- **Links to a selection.** Select text, then a colour of the palette or
  Ctrl+Shift+C: the link is on the clipboard — as a quote in a callout, a
  plain quote, a link or an embed (the menu in the toolbar). "Copy on
  select" copies as soon as text is selected. Without a selection:
  a link to the page. Ctrl+Shift+V: a link to the place and zoom on screen.
- **Highlights from links.** Every link to a selection or a region of the
  PDF in the notes shows in the PDF, in the link's colour. Hover: the note
  and its text; double click: the note opens at the link. The side panel's
  Notes tab lists them, those of the page on screen first; hovering an
  entry marks its highlight and the other way round.
- **Embeds.** `![[file.pdf#page=N]]` shows the page in the note; with
  `selection` only the lines of the selection (highlighted), with `rect`
  the region. A click opens the PDF there (Ctrl+click while editing).
  The region tool (R) in the viewer copies such an embed.
- **Quotes** copied as `> [!PDF|colour] link` are callouts in the highlight's
  colour (`[!type|meta]` is read as a callout now).
- **Finding one's way.** Outline and page pictures in the side panel (click
  goes there; right click copies a link, dragging carries one); links inside
  the PDF with a way back (Alt+←, right click copies the target as a
  link); zoom, fit width, fit page, go to page.

Keys in the viewer: `+` `−` zoom · `W` fit width · `H` fit page · `G` page ·
`O` outline · `T` pages · `N` notes · `R` region · Ctrl+Shift+C copy link ·
Ctrl+Shift+V link to the view · Alt+← back · PgUp/PgDn.

## Not built

- Everything of PDF++ that changes the PDF file: annotations written into
  it, the page composer, editing the outline and page labels.
- Copy templates of one's own (four fixed ones), popover previews on
  hover, Vim, opening in an external program alongside.
- Ctrl+F finds only in the pages already drawn.
- PDFs that rely on CMaps or the standard 14 fonts not being embedded may
  show wrong glyphs (those files are not shipped; the page could not load
  them).
- Large PDFs are parsed on the main thread: the window can stall while one
  opens.

## Tests

`dev/rig.sh pdf` (27 checks): a note with three embeds, the link into the
PDF, highlights and their place, a selection as a link, Ctrl+Shift+C with
the real clipboard, zoom, outline, pages, a link inside the PDF and back,
the notes list, a double click back to the note. `dev/gen-pdf.py` makes the
test PDF.
