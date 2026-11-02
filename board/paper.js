/* mdview — a notebook: a whiteboard of pages, one under the other, as GoodNotes has its notebooks —
 * on GoodNotes' writing paper: blank, dotted, squared, narrow and wide ruled, legal, Cornell and
 * music, each white, yellow or dark. Underneath it is a whiteboard (its file, its ink, its things,
 * its tools); its head says it is a notebook and how its paper is:
 *
 *   {"board":1,…,"paper":{"bg":"grid","color":"white","size":"a4","n":2}}
 *
 * The pages lie as a PDF's lie under a board (pdf.js: layout), so everything a PDF's pages have —
 * scrolling down them, the page in sight — works on them the same. Every page has the one paper of
 * the notebook. Their number grows as pages are added; what is drawn stays where it was drawn.
 *
 * No DOM in what the file needs (norm, pages, svg, ink): the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const KINDS = ["blank", "dots", "grid", "narrow", "wide", "legal", "cornell", "music"]; // in the order the menu lists them
  const OLD = { lines: "wide" }; // (the names of a first version, read as what they were)
  const SIZES = { a4: [595.28, 841.89] }; // a page's width and height in points
  const MAX = 500; // pages, at the most
  const MM = (72 / 25.4) * (4 / 3); // the board's pixels in a millimetre (pdf.js UNIT: a page at 100 % is as large as on paper)
  /* Each paper in millimetres, as such paper is printed: squares and dots 5 mm apart; ruled narrow
   * (college, 7.1 mm) and wide (8.7 mm) under a head; legal as a legal pad, wide lines under a
   * deeper head and a double margin at the left; Cornell with the head, the cue column at the left
   * and the summary at the foot; music in staves of five lines. */
  const LOOK = {
    dots: { step: 5 }, grid: { step: 5 },
    narrow: { step: 7.1, top: 25, foot: 12 }, wide: { step: 8.7, top: 25, foot: 12 },
    legal: { step: 8.7, top: 32, foot: 12, margin: 30 },
    cornell: { step: 7.1, top: 25, foot: 12, cue: 63, summary: 55 },
    music: { step: 2, top: 22, pitch: 22, side: 15, foot: 15 },
  };
  /* The paper's colours: the sheet, its lines, its dots, the margin, and the ink "auto" stands for on it. */
  const COLORS = {
    white: { sheet: "#ffffff", rule: "#a9bccd", dot: "#9aa3ad", margin: "#e59a9a", ink: "#1d1d1f" },
    yellow: { sheet: "#fdf6d3", rule: "#b4bfc4", dot: "#aaa48c", margin: "#e09a8f", ink: "#1d1d1f" },
    dark: { sheet: "#252527", rule: "#4d4d53", dot: "#6e6e75", margin: "#8c4f4f", ink: "#f2f2f7" },
  };
  const TONES = Object.keys(COLORS);

  /* The head's "paper" → { bg, color, size, n }, or null where the board is no notebook. */
  function norm(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const n = Math.round(Number(o.n)), bg = OLD[o.bg] || o.bg;
    return { bg: KINDS.includes(bg) ? bg : "grid", color: TONES.includes(o.color) ? o.color : "white", size: SIZES[o.size] ? o.size : "a4", n: Number.isFinite(n) ? Math.max(1, Math.min(MAX, n)) : 1 };
  }
  /* The pages' sizes in points, for pdf.js's layout — and the pages laid out. */
  const sizes = (paper) => Array.from({ length: paper.n }, () => SIZES[paper.size] || SIZES.a4);
  const pages = (paper) => B.pdf.layout(sizes(paper));
  /* A new notebook's head. */
  const fresh = (bg = "grid", color = "white") => ({ bg: KINDS.includes(bg) ? bg : "grid", color: TONES.includes(color) ? color : "white", size: "a4", n: 1 });
  /* The colour "auto" ink is on this paper: dark on white and yellow, light on dark. */
  const ink = (paper) => (COLORS[(paper && paper.color) || "white"] || COLORS.white).ink;

  const f = (v) => Math.round(v * 10) / 10;
  /* One page as SVG: the sheet and its paper — the file's picture (render.js) and the sheets on the
   * screen draw it alike. thick: how many times broader its lines are (a small picture of it, in a menu). */
  function svg(page, bg, color = "white", thick = 1) {
    const L = LOOK[bg] || {}, C = COLORS[color] || COLORS.white, { x, y, w, h } = page, m = (v) => v * MM;
    const across = (a, x0 = x, x1 = x + w) => `M${f(x0)} ${f(y + a)}H${f(x1)}`, down = (a, y0 = y, y1 = y + h) => `M${f(x + a)} ${f(y0)}V${f(y1)}`;
    const line = (d, c, wd) => (d ? `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f(wd * thick)}"/>` : "");
    let out = `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${C.sheet}"/>`;
    if (bg === "grid") {
      let d = "";
      for (let a = m(L.step); a < w; a += m(L.step)) d += down(a);
      for (let a = m(L.step); a < h; a += m(L.step)) d += across(a);
      out += line(d, C.rule, 0.6);
    } else if (bg === "dots") {
      let d = "";
      for (let b = m(L.step); b < h; b += m(L.step)) for (let a = m(L.step); a < w; a += m(L.step)) d += `M${f(x + a)} ${f(y + b)}h0`;
      out += `<path d="${d}" stroke="${C.dot}" stroke-width="${f(1.7 * thick)}" stroke-linecap="round"/>`;
    } else if (bg === "narrow" || bg === "wide" || bg === "legal" || bg === "cornell") {
      const end = h - m(bg === "cornell" ? L.summary : L.foot), from = bg === "cornell" ? m(L.cue) : 0;
      let d = "";
      for (let a = m(L.top) + m(L.step); a <= end + 0.5; a += m(L.step)) d += across(a, x + from);
      out += line(d, C.rule, 0.6);
      if (bg === "legal") out += line(down(m(L.margin)) + down(m(L.margin + 1.4)), C.margin, 0.7) + line(across(m(L.top)), C.rule, 1.2);
      if (bg === "cornell") out += line(across(m(L.top)) + across(end + m(L.step) / 2) + down(m(L.cue), y + m(L.top), y + end + m(L.step) / 2), C.rule, 1.2);
    } else if (bg === "music") {
      let d = "";
      for (let a = m(L.top); a + m(L.step * 4) <= h - m(L.foot); a += m(L.pitch)) for (let k = 0; k < 5; k++) d += across(a + m(L.step * k), x + m(L.side), x + w - m(L.side));
      out += line(d, C.rule, 0.8);
    }
    return `<g class="paper">${out}</g>\n`;
  }

  /* The pages on the screen: one sheet each in `host` (moved and sized with the view by the board, as
   * a PDF's are), its paper the same SVG the file's picture has — drawn sharp at any size, as it is
   * no picture of a size —, and under the last one the way to one more (more: what it says, or none
   * where the notebook is only read). Unlike a PDF's there is nothing to draw for the view. */
  function paper(host, list, look, more = "") {
    let now = list, was = look;
    const put = () => {
      const sheets = now.map((p) => {
        const d = document.createElement("div");
        d.className = "bd-sheet";
        d.dataset.paper = was.bg;
        d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
        d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.x} ${p.y} ${p.w} ${p.h}" preserveAspectRatio="none" aria-hidden="true">${svg(p, was.bg, was.color)}</svg>`;
        return d;
      });
      const last = now[now.length - 1];
      if (more && last) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bd-addpage";
        b.dataset.do = "page";
        b.style.cssText = `left:${last.x}px;top:${f(last.y + last.h + B.pdf.GAP * 2)}px;width:${last.w}px`;
        const sign = document.createElement("span");
        sign.setAttribute("aria-hidden", "true");
        sign.textContent = "+";
        b.append(sign, more);
        sheets.push(b);
      }
      host.replaceChildren(...sheets);
    };
    put();
    return {
      show() { /* (nothing to draw for a view: paper is the same however near) */ },
      drop() {},
      set(pages, look) { now = pages; was = look; put(); },
      state: () => now.map((p) => p.n),
      sharp: () => [],
    };
  }

  B.paper = { KINDS, TONES, COLORS, SIZES, MAX, LOOK, MM, norm, sizes, pages, fresh, ink, svg, paper };
})();
