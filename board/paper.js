/* mdview — a notebook: a whiteboard of pages, one under the other, as GoodNotes has its notebooks —
 * paper that is blank, ruled, squared or dotted. Underneath it is a whiteboard (its file, its ink,
 * its things, its tools); its head says it is a notebook and how its paper is:
 *
 *   {"board":1,…,"paper":{"bg":"grid","size":"a4","n":2}}
 *
 * The pages lie as a PDF's lie under a board (pdf.js: layout), so everything a PDF's pages have —
 * scrolling down them, the page in sight, ink for paper — works on them the same. Every page has
 * the one paper of the notebook. Their number grows as pages are added; what is drawn stays where
 * it was drawn.
 *
 * No DOM in what the file needs (norm, pages, svg): the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const KINDS = ["blank", "lines", "grid", "dots"]; // in the order the menu lists them
  const SIZES = { a4: [595.28, 841.89] }; // a page's width and height in points
  const MAX = 500; // pages, at the most
  const MM = (72 / 25.4) * (4 / 3); // the board's pixels in a millimetre (pdf.js UNIT: a page at 100 % is as large as on paper)
  /* What each paper draws, in the board's pixels: the step between two lines or dots, and (ruled) where
   * the first line is and the margin's line at the left. As the paper of a notebook has it: squares
   * of 5 mm, dots 5 mm apart, lines 8 mm apart under a head of 25 mm, the margin 20 mm in. */
  const LOOK = { grid: { step: 5 * MM }, dots: { step: 5 * MM }, lines: { step: 8 * MM, top: 25 * MM, margin: 20 * MM } };
  const RULE = "#9fb4c8", MARGIN = "#e7a3a3", DOT = "#a6adb5"; // (on white paper, whatever the theme: the paper is paper)

  /* The head's "paper" → { bg, size, n }, or null where the board is no notebook. */
  function norm(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const n = Math.round(Number(o.n));
    return { bg: KINDS.includes(o.bg) ? o.bg : "grid", size: SIZES[o.size] ? o.size : "a4", n: Number.isFinite(n) ? Math.max(1, Math.min(MAX, n)) : 1 };
  }
  /* The pages' sizes in points, for pdf.js's layout. */
  const sizes = (paper) => Array.from({ length: paper.n }, () => SIZES[paper.size] || SIZES.a4);
  const pages = (paper) => B.pdf.layout(sizes(paper));
  /* A new notebook's head. */
  const fresh = (bg = "grid") => ({ bg: KINDS.includes(bg) ? bg : "grid", size: "a4", n: 1 });

  const f = (v) => Math.round(v * 10) / 10;
  /* One page as SVG: the sheet and its paper — for the file's picture (render.js), where the first page
   * is what a notebook shows of itself. */
  function svg(page, bg) {
    const L = LOOK[bg], { x, y, w, h } = page;
    let lines = "";
    if (bg === "grid") {
      for (let a = L.step; a < w; a += L.step) lines += `M${f(x + a)} ${f(y)}V${f(y + h)}`;
      for (let a = L.step; a < h; a += L.step) lines += `M${f(x)} ${f(y + a)}H${f(x + w)}`;
    } else if (bg === "lines") {
      for (let a = L.top; a < h - L.step / 2; a += L.step) lines += `M${f(x)} ${f(y + a)}H${f(x + w)}`;
    }
    let out = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="#fff"/>`;
    if (lines) out += `<path d="${lines}" fill="none" stroke="${RULE}" stroke-width="0.6"/>`;
    if (bg === "lines") out += `<path d="M${f(x + L.margin)} ${f(y)}V${f(y + h)}" stroke="${MARGIN}" stroke-width="0.8"/>`;
    if (bg === "dots") {
      let d = "";
      for (let b = L.step; b < h; b += L.step) for (let a = L.step; a < w; a += L.step) d += `M${f(x + a)} ${f(y + b)}h0`;
      out += `<path d="${d}" stroke="${DOT}" stroke-width="1.6" stroke-linecap="round"/>`;
    }
    return `<g class="paper">${out}</g>\n`;
  }

  /* The pages on the screen: one sheet each in `host` (moved and sized with the view by the board, as
   * a PDF's are), its paper the same SVG the file's picture has — drawn sharp at any size, as it is
   * no picture of a size. Unlike a PDF's there is nothing to draw for the view. */
  function paper(host, list, bg) {
    let now = list, kind = bg;
    const put = () => host.replaceChildren(...now.map((p) => {
      const d = document.createElement("div");
      d.className = "bd-sheet";
      d.dataset.paper = kind;
      d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
      d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.x} ${p.y} ${p.w} ${p.h}" preserveAspectRatio="none" aria-hidden="true">${svg(p, kind)}</svg>`;
      return d;
    }));
    put();
    return {
      show() { /* (nothing to draw for a view: paper is the same however near) */ },
      drop() {},
      set(pages, b) { now = pages; kind = b; put(); },
      state: () => now.map((p) => p.n),
      sharp: () => [],
    };
  }

  B.paper = { KINDS, SIZES, MAX, LOOK, norm, sizes, pages, fresh, svg, paper };
})();
