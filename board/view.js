/* mdview — a whiteboard's view: which part of the endless board the window shows, and how large.
 * x, y: the board's point in the window's top left corner; z: screen pixels per board pixel.
 *
 * A board of pages — a notebook, a PDF — has edges, as GoodNotes' notebooks have (Henri, 2026-11-19: "nicht intuitiv … das
 * verschieben des notizbuches, das ist man ganz noch außerhalb des bildes"): `limit` says where its pages are and what of the
 * window the bars take, and the view keeps to it — the pages are never pushed out of the window, nor made smaller than one
 * page whole in it. A hand that pulls beyond an edge is followed less and less the further it goes, as an iPad's lists are
 * (rubber); let go, the view goes back within the edges (settle) — and a size let go near one of the sizes that matter (the
 * page's width across the window, the page whole in it) becomes that size. Anything set by the board itself (fit, a page
 * shown) is put within the edges at once. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const MIN = 0.1, MAX = 4, STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4];
  const clamp = (z, v) => Math.max(v.min, Math.min(v.max, z));
  const SNAP = Math.log(1.1); // a size let go within 10 % of one that matters becomes it
  /* How far the view goes when pulled `d` screen pixels beyond an edge, the window being `n` pixels that way: ever less, never
   * as far as the window (UIScrollView's rubber band). And back: how far the hand has pulled for the view to be `s` beyond. */
  const RUB = 0.55;
  const rubber = (d, n) => Math.sign(d) * (1 - 1 / ((Math.abs(d) * RUB) / n + 1)) * n;
  const unrubber = (s, n) => { const a = Math.min(Math.abs(s), n * 0.999); return Math.sign(s) * ((1 / (1 - a / n) - 1) * n) / RUB; };
  /* The next step of the view's glide back: with the next frame — or, where the window draws none (out of sight), a moment later
   * all the same (as board/pointer.js glides): the pages are where they belong whether or not anyone watches. */
  function nextFrame(f) {
    let ran = false;
    const run = () => { if (!ran) { ran = true; f(performance.now()); } };
    const a = requestAnimationFrame(run), b = setTimeout(run, 80);
    return () => { ran = true; cancelAnimationFrame(a); clearTimeout(b); };
  }

  function make(size, changed) {
    // While a hand pulls beyond the edges: where the view would be without them (x, y on the board, z) — the rubber follows that.
    let raw = null, settling = null;
    const stop = () => { if (settling) settling(); settling = null; };
    const v = {
      x: 0, y: 0, z: 1,
      min: MIN, max: MAX, // how small and how large (a board over a PDF goes further in: board.js)
      /* A board of pages: () => { box: [x0, y0, x1, y1] of the board that must stay in sight, top, bottom, left, right: the room
       * the bars take at the window's edges (screen pixels), least: the smallest size (a page whole in the window), sizes: [z…] a
       * size let go near one of them becomes it }. None: an endless board, no edges. */
      limit: null,
      anchor: null, // where the last size change was made around (the window's pixels): a size put right on letting go stays round it
      toBoard: (cx, cy) => [v.x + cx / v.z, v.y + cy / v.z],
      set(x, y, z) { stop(); raw = null; v.z = clamp(z, v); [v.x, v.y] = v.limit ? v.inside(x, y, v.z) : [x, y]; changed(); },
      panBy(dx, dy) {
        stop();
        if (!v.limit) { v.x -= dx / v.z; v.y -= dy / v.z; return changed(); }
        const from = raw || v.unbent();
        place(from.x - dx / v.z, from.y - dy / v.z, v.z);
        changed();
      },
      // the point under (cx, cy) stays under it
      zoomAt(cx, cy, z) {
        stop();
        v.anchor = { x: cx, y: cy };
        if (!v.limit) {
          z = clamp(z, v);
          const [bx, by] = v.toBoard(cx, cy);
          v.z = z; v.x = bx - cx / z; v.y = by - cy / z;
          return changed();
        }
        // below the least size the pages give way as the edges do: the size the hand asks is followed less and less
        const from = raw || v.unbent(), L = v.limit();
        const want = Math.min(v.max, from.z * (z / v.z)); // (the size the hand has, the rubber taken off)
        const shown = want >= L.least ? want : L.least * Math.pow(want / L.least, 0.35);
        const bx = from.x + cx / v.z, by = from.y + cy / v.z; // (the point under the hand)
        place(bx - cx / shown, by - cy / shown, shown, want);
        changed();
      },
      step(dir) { // the next of the fixed sizes, around the window's middle
        const { w, h } = size(), i = dir > 0 ? STEPS.findIndex((s) => s > v.z + 0.001) : STEPS.length - 1 - [...STEPS].reverse().findIndex((s) => s < v.z - 0.001);
        v.zoomAt(w / 2, h / 2, STEPS[i < 0 || i >= STEPS.length ? (dir > 0 ? STEPS.length - 1 : 0) : i]);
        v.settle(true);
      },
      // box: [x0, y0, x1, y1] of the board, shown whole with room around — never larger than life
      // (most: how large at most — a scene is shown as large as it was framed)
      fit(box, pad = 64, most = 1) {
        const { w, h } = size();
        if (!box) return v.set(-w / 2, -h / 2, 1);
        const bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
        const z = clamp(Math.min(most, (w - 2 * pad) / bw, (h - 2 * pad) / bh), v);
        v.set((box[0] + box[2]) / 2 - w / 2 / z, (box[1] + box[3]) / 2 - h / 2 / z, z);
      },
      /* Where the view may stand at size z: (x, y) moved the least way that keeps the pages over the window — where they are
       * narrower (lower) than the room between the bars, in its middle. */
      inside(x, y, z) {
        const { w, h } = size(), L = v.limit(), [x0, y0, x1, y1] = L.box;
        const across = w - L.left - L.right, down = h - L.top - L.bottom;
        const nx = (x1 - x0) * z <= across ? (x0 + x1) / 2 - (L.left + across / 2) / z : Math.min(Math.max(x, x0 - L.left / z), x1 - (w - L.right) / z);
        const ny = (y1 - y0) * z <= down ? (y0 + y1) / 2 - (L.top + down / 2) / z : Math.min(Math.max(y, y0 - L.top / z), y1 - (h - L.bottom) / z);
        return [nx, ny];
      },
      /* Where the hand has the view, the rubber taken off what is shown (the view stopped beyond an edge, then taken again). */
      unbent() {
        if (!v.limit) return { x: v.x, y: v.y, z: v.z };
        const { w, h } = size(), [ix, iy] = v.inside(v.x, v.y, v.z);
        return { x: ix + unrubber((v.x - ix) * v.z, w) / v.z, y: iy + unrubber((v.y - iy) * v.z, h) / v.z, z: v.z };
      },
      /* Is the view beyond its edges, or at a size it does not keep? */
      bent() {
        if (!v.limit) return false;
        const L = v.limit(), [ix, iy] = v.inside(v.x, v.y, v.z);
        return v.z < L.least - 1e-6 || Math.abs((ix - v.x) * v.z) > 0.5 || Math.abs((iy - v.y) * v.z) > 0.5;
      },
      /* The hand let go: the view goes back within the edges — and a size near one that matters becomes it — round where the
       * size was last changed. now: at once (no glide: reduced motion, a size set by a key). */
      settle(now = false) {
        stop();
        raw = null;
        if (!v.limit) return;
        const L = v.limit(), { w, h } = size(), a = v.anchor || { x: w / 2, y: h / 2 };
        let z = Math.max(L.least, Math.min(v.max, v.z));
        for (const s of L.sizes || []) if (Math.abs(Math.log(z / s)) < SNAP) { z = s; break; }
        const bx = v.x + a.x / v.z, by = v.y + a.y / v.z, [tx, ty] = v.inside(bx - a.x / z, by - a.y / z, z);
        if (Math.abs(z - v.z) < 1e-6 && Math.abs((tx - v.x) * z) < 0.5 && Math.abs((ty - v.y) * z) < 0.5) return;
        if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) { v.x = tx; v.y = ty; v.z = z; return changed(); }
        // (a glide there, the size and the place together: the anchor's point goes straight to where it ends)
        const from = { x: v.x, y: v.y, z: v.z };
        let last = performance.now(), k = 0;
        const frame = (t) => {
          k = 1 - (1 - k) * Math.exp(-Math.max(0, t - last) / 70);
          last = t;
          const done = k > 0.995, zz = done ? z : from.z * Math.pow(z / from.z, k);
          // the anchor's board point moves from where it was to where it ends, in screen terms, as the size goes
          const ax = bx + (tx + a.x / z - bx) * k, ay = by + (ty + a.y / z - by) * k;
          v.z = zz; v.x = done ? tx : ax - a.x / zz; v.y = done ? ty : ay - a.y / zz;
          settling = done ? null : nextFrame(frame);
          changed(!done);
        };
        settling = nextFrame(frame);
      },
      stop,
      get settling() { return !!settling; },
    };
    /* The view put where the hand has it — x, y at the size shown (z); hz: the size the hand asks, where the rubber shows less —
     * within the edges as far as that goes, and beyond them by the rubber. What the hand has is kept while it is beyond them:
     * the next step goes on from there, not from what is shown. */
    function place(x, y, z, hz = z) {
      const { w, h } = size(), [ix, iy] = v.inside(x, y, z);
      const ox = (x - ix) * z, oy = (y - iy) * z; // (how far beyond, in screen pixels)
      v.z = z;
      v.x = ix + (Math.abs(ox) > 1e-3 ? rubber(ox, w) / z : 0);
      v.y = iy + (Math.abs(oy) > 1e-3 ? rubber(oy, h) / z : 0);
      raw = Math.abs(ox) > 1e-3 || Math.abs(oy) > 1e-3 || hz !== z ? { x, y, z: hz } : null;
    }
    return v;
  }
  B.view = { make, MIN, MAX, STEPS, rubber, unrubber };
})();
