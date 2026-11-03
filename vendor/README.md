# Libraries bundled with the app

Minified and committed, so the app needs no build and no network. Each keeps its own license:
this file names them, and `LICENSES.md` beside it holds their texts (gathered from the packages
by `dev/build-licenses.mjs`; it goes into the installers with this folder).

| File | Library | License |
|---|---|---|
| `markdown-it.min.js` | markdown-it 14.1.0 | MIT |
| `abbr`, `deflist`, `emoji`, `footnote`, `mark`, `sub`, `sup` (`.min.js`) | markdown-it plugins | MIT |
| `js-yaml.min.js` | js-yaml | MIT |
| `highlight.min.js`, `highlight-extra.min.js` | highlight.js 11.11.1 | BSD-3-Clause |
| `katex/` | KaTeX 0.16.25, with its fonts | MIT (the fonts: SIL OFL 1.1) |
| `mermaid.min.js` | Mermaid 11.12.0 | MIT |
| `pdfjs/` | PDF.js 3.11.174 — `pdf.worker.min.js` changed in one place (below) | Apache-2.0 (`pdfjs/LICENSE`) |
| `prosemirror.min.js` | the ProseMirror packages named at its head | MIT |
| `diff.min.js` | diff 9.0.0 | BSD-3-Clause |
| `hershey.js` | two Hershey fonts (handwriting on a whiteboard), from hersheytext 2.0.0 — made by `dev/build-hershey.mjs` | MIT (the fonts: public domain) |

Not in this folder, and another's work too: the landing page's scroll runtime,
`web/public/welcome/scrollcraft.js` and `.css` (MIT, `scrollcraft.LICENSE` beside them).

KaTeX — Copyright (c) 2013–2020 Khan Academy and other contributors. MIT License:
<https://github.com/KaTeX/KaTeX/blob/main/LICENSE>

Mermaid — Copyright (c) 2014–2022 Knut Sveidqvist. MIT License:
<https://github.com/mermaid-js/mermaid/blob/develop/LICENSE>

`pdfjs/pdf.worker.min.js` is PDF.js's own but for `ImageResizer` (#44, docs/BUGS.md rule 105): `_createImage`
decodes a picture at the size it is made smaller to (`createImageBitmap` with `resizeWidth`/`resizeHeight`), not at its
own first, and a picture of one bit a pixel is made smaller by `_mdviewShrink` (a box of pixels a grey one) before the
browser decodes it. A newer PDF.js put in here takes these two changes along, or measures that it needs them no more.

`prosemirror.min.js` and `diff.min.js` are built by `dev/build-vendor.mjs` from the versions
pinned in `dev/package.json`.
