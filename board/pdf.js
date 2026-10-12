/* mdview — a whiteboard over a PDF: the PDF's pages lie on the board as sheets of paper, one under
 * the other, and what is drawn on them is the board's — the same ink, the same things. The PDF
 * itself is never written to: what was drawn is a whiteboard's file of its own, kept by the host
 * (in the folder's .mdview), and laid over the pages wherever the PDF is shown (pdfview.js).
 *
 * Where a page lies follows from the PDF alone — its pages' sizes, in their order — so what is
 * drawn on a page is on that page again whenever the PDF is opened. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const UNIT = 4 / 3; // the board's pixels per point of the PDF (a page at 100 % is as large as on paper)
  const GAP = 16; // between two pages, in the board's pixels
  const MOST = 16e6; // a page's picture has no more pixels than this (as the viewer's: pdfview.js)
  const q = (v) => Math.round(v * 10) / 10;

  /* sizes: [[width, height]] in points, page by page → [{ n, x, y, w, h }] on the board: each
   * page's middle at x = 0, the first page's top at y = 0. */
  function layout(sizes) {
    let y = 0;
    return sizes.map(([w, h], i) => {
      const p = { n: i + 1, x: q((-w * UNIT) / 2), y, w: q(w * UNIT), h: q(h * UNIT) };
      y = q(y + p.h + GAP);
      return p;
    });
  }
  /* The page nearest to the middle of what the view shows. size: { w, h } of the window. */
  function near(pages, view, size) {
    const mid = view.y + size.h / view.z / 2;
    let best = pages[0];
    for (const p of pages) if (Math.abs(p.y + p.h / 2 - mid) < Math.abs(best.y + best.h / 2 - mid)) best = p;
    return best;
  }
  const boxOf = (p) => [p.x, p.y, p.x + p.w, p.y + p.h];
  /* What lies on which page: page number → the items that touch it (one that lies across two pages is on both). */
  function onPages(pages, items) {
    const out = new Map();
    for (const it of items) {
      const b = B.format.boundsOf(it);
      if (!b) continue;
      for (const p of pages) {
        if (p.y > b[3]) break;
        if (p.y + p.h < b[1] || p.x > b[2] || p.x + p.w < b[0]) continue;
        if (!out.has(p.n)) out.set(p.n, []);
        out.get(p.n).push(it);
      }
    }
    return out;
  }
  /* What is drawn on a page, as a picture to lay over it — as large as the page, whatever its size on the screen. */
  function picture(page, items) {
    if (!items || !items.length) return "";
    return `<svg xmlns="http://www.w3.org/2000/svg" class="pdf-ink" viewBox="${page.x} ${page.y} ${page.w} ${page.h}" preserveAspectRatio="none" aria-hidden="true">${B.render.picture({ items }).body}</svg>`;
  }

  /* The pages on the board: one sheet each in `host` (moved and sized with the view by the board),
   * drawn by pdf.js as sharp as the view shows it — the pages in sight first, the nearest of them
   * before the others, one at a time. While the view is under the hand (fast) a page that has a
   * picture keeps it, stretched; it is drawn anew when the hand rests. drop(): no more is drawn (the sheets stay, for whoever empties the host). */
  function paper(host, doc, pages) {
    const sheets = pages.map((p) => {
      const d = document.createElement("div");
      d.className = "bd-sheet";
      d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
      host.appendChild(d);
      return { p, d, k: 0 };
    });
    let want = [], busy = null, dead = false;
    const same = (a, b) => Math.abs(a - b) / b < 0.04;
    async function next() {
      if (busy || dead) return;
      const job = (busy = want.shift() || null);
      if (!job) return;
      try {
        const page = await doc.getPage(job.s.p.n), vp = page.getViewport({ scale: job.k }), c = document.createElement("canvas");
        c.width = Math.max(1, Math.floor(vp.width)); c.height = Math.max(1, Math.floor(vp.height));
        if (!job.off && !dead) {
          job.task = page.render({ canvasContext: c.getContext("2d"), viewport: vp });
          await job.task.promise;
          if (!job.off && !dead) { job.s.d.replaceChildren(c); job.s.k = job.k; }
        }
      } catch (e) { /* (given up for another size, or a page that cannot be drawn: the sheet stays as it is) */ }
      busy = null;
      next();
    }
    function show(view, size, fast = false) {
      if (dead) return;
      const dpr = window.devicePixelRatio || 1, tall = size.h / view.z, mid = view.y + tall / 2;
      want = [];
      for (const s of sheets) {
        const p = s.p, away = Math.max(p.y - (view.y + tall), view.y - (p.y + p.h)); // (how far out of sight, 0 or less: in it)
        if (away > tall) { if (away > 6 * tall && s.k) { s.d.replaceChildren(); s.k = 0; } continue; } // far pages give their pictures back
        const k = Math.min(view.z * UNIT * dpr, Math.sqrt(MOST / (p.w * p.h)) * UNIT);
        if (s.k && (fast || same(s.k, k))) continue;
        want.push({ s, k, d: Math.abs(p.y + p.h / 2 - mid) });
      }
      want.sort((a, b) => a.d - b.d);
      if (busy) {
        if (want.some((j) => j.s === busy.s && same(j.k, busy.k))) want = want.filter((j) => j.s !== busy.s);
        else { busy.off = true; if (busy.task) busy.task.cancel(); }
      }
      next();
    }
    function drop() {
      dead = true; want = [];
      if (busy) { busy.off = true; if (busy.task) busy.task.cancel(); }
    }
    return { show, drop, state: () => sheets.filter((s) => s.k).map((s) => s.p.n) };
  }

  B.pdf = { UNIT, GAP, layout, near, boxOf, onPages, picture, paper };
})();
