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
| `pdfjs/` | PDF.js | Apache-2.0 (`pdfjs/LICENSE`) |
| `prosemirror.min.js` | the ProseMirror packages named at its head | MIT |
| `diff.min.js` | diff 9.0.0 | BSD-3-Clause |

Not in this folder, and another's work too: the landing page's scroll runtime,
`web/public/welcome/scrollcraft.js` and `.css` (MIT, `scrollcraft.LICENSE` beside them).

KaTeX — Copyright (c) 2013–2020 Khan Academy and other contributors. MIT License:
<https://github.com/KaTeX/KaTeX/blob/main/LICENSE>

Mermaid — Copyright (c) 2014–2022 Knut Sveidqvist. MIT License:
<https://github.com/mermaid-js/mermaid/blob/develop/LICENSE>

`prosemirror.min.js` and `diff.min.js` are built by `dev/build-vendor.mjs` from the versions
pinned in `dev/package.json`.
