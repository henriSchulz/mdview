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
   * drawn by pdf.js. A sheet has the whole page as a picture of a moderate size (BASE) — and, where
   * the view shows the page larger than that picture is, the part in sight drawn over it as sharp as
   * the screen (a detail): so a page is sharp however large it is shown, and no picture is larger
   * than the window. The pages in sight come first, the nearest of them before the others, one
   * picture at a time. While the view is under the hand (fast) what is there is kept, stretched;
   * it is drawn anew when the hand rests. drop(): no more is drawn (the sheets stay, for whoever
   * empties the host). */
  const BASE = 4e6;
  function paper(host, doc, pages) {
    const sheets = pages.map((p) => {
      const d = document.createElement("div");
      d.className = "bd-sheet";
      d.style.cssText = `left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px`;
      host.appendChild(d);
      return { p, d, k: 0, base: null, detail: null }; // k: the base's pixels per point; detail: { k, box, el }
    });
    let want = [], busy = null, dead = false;
    const same = (a, b) => Math.abs(a - b) / b < 0.04;
    const covers = (box, see) => box[0] <= see[0] + 1 && box[1] <= see[1] + 1 && box[2] >= see[2] - 1 && box[3] >= see[3] - 1;
    function put(job, c) {
      const s = job.s;
      if (!job.box) {
        if (s.base) s.base.replaceWith(c); else s.d.prepend(c);
        s.base = c; s.k = job.k;
        return;
      }
      const u = UNIT / job.k, [x0, y0, x1, y1] = job.box;
      c.className = "bd-detail";
      c.style.cssText = `left:${x0 * u}px;top:${y0 * u}px;width:${(x1 - x0) * u}px;height:${(y1 - y0) * u}px`;
      if (s.detail) s.detail.el.replaceWith(c); else s.d.append(c);
      s.detail = { k: job.k, box: job.box, el: c };
    }
    async function next() {
      if (busy || dead) return;
      const job = (busy = want.shift() || null);
      if (!job) return;
      try {
        const page = await doc.getPage(job.s.p.n), vp = page.getViewport({ scale: job.k }), c = document.createElement("canvas");
        const [x0, y0, x1, y1] = job.box || [0, 0, Math.max(1, Math.floor(vp.width)), Math.max(1, Math.floor(vp.height))];
        c.width = x1 - x0; c.height = y1 - y0;
        if (!job.off && !dead) {
          job.task = page.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: job.box ? [1, 0, 0, 1, -x0, -y0] : null });
          await job.task.promise;
          if (!job.off && !dead) put(job, c);
        }
      } catch (e) { /* (given up for another size, or a page that cannot be drawn: the sheet stays as it is) */ }
      busy = null;
      next();
    }
    function show(view, size, fast = false) {
      if (dead) return;
      const dpr = window.devicePixelRatio || 1, tall = size.h / view.z, wide = size.w / view.z, mid = view.y + tall / 2, need = view.z * UNIT * dpr;
      want = [];
      for (const s of sheets) {
        const p = s.p, away = Math.max(p.y - (view.y + tall), view.y - (p.y + p.h)); // (how far out of sight, 0 or less: in it)
        if (away > tall) { if (away > 6 * tall && (s.k || s.detail)) { s.d.replaceChildren(); s.base = s.detail = null; s.k = 0; } continue; } // far pages give their pictures back
        const d = Math.abs(p.y + p.h / 2 - mid) + (away > 0 ? 1e7 : 0), kb = Math.min(need, Math.sqrt(BASE / (p.w * p.h)) * UNIT);
        if (!s.k || (!fast && s.k < kb * 0.96)) want.push({ s, k: kb, box: null, d });
        if (fast) continue;
        // the part of the page in sight, in the page's pixels at this size — and a quarter of the window around it
        const u = need / UNIT, most = [p.w * u, p.h * u], clip = (b) => [Math.max(0, Math.floor(b[0])), Math.max(0, Math.floor(b[1])), Math.min(Math.ceil(most[0]), Math.ceil(b[2])), Math.min(Math.ceil(most[1]), Math.ceil(b[3]))];
        const see = clip([(view.x - p.x) * u, (view.y - p.y) * u, (view.x + wide - p.x) * u, (view.y + tall - p.y) * u]);
        if (need <= kb * 1.04 || see[2] <= see[0] || see[3] <= see[1]) { if (s.detail) { s.detail.el.remove(); s.detail = null; } continue; }
        if (s.detail && same(s.detail.k, need) && covers(s.detail.box, see)) continue;
        const mx = wide * 0.25 * u, my = tall * 0.25 * u;
        want.push({ s, k: need, box: clip([see[0] - mx, see[1] - my, see[2] + mx, see[3] + my]), see, d: d + 0.5 });
      }
      want.sort((a, b) => a.d - b.d);
      if (busy) {
        const i = want.findIndex((j) => j.s === busy.s && !j.box === !busy.box && same(j.k, busy.k) && (!j.box || covers(busy.box, j.see)));
        if (i >= 0) want.splice(i, 1); // (what is being drawn is still what is wanted)
        else { busy.off = true; if (busy.task) busy.task.cancel(); }
      }
      next();
    }
    function drop() {
      dead = true; want = [];
      if (busy) { busy.off = true; if (busy.task) busy.task.cancel(); }
    }
    // (for the tests) which pages have a picture, and which a detail — with how many pixels to one of the board's
    return { show, drop, state: () => sheets.filter((s) => s.k).map((s) => s.p.n), sharp: () => sheets.filter((s) => s.detail).map((s) => [s.p.n, Math.round((s.detail.k / UNIT) * 100) / 100]) };
  }

  B.pdf = { UNIT, GAP, layout, near, boxOf, onPages, picture, paper };
})();
