/* mdview — a whiteboard's ink: strokes drawn on a canvas from the same paths the file's picture
 * is made of (render.js), the stroke under the hand, and what an eraser touches. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  // what each tool is set to before anyone chose otherwise, and the widths its options offer
  const TOOLS = {
    pen: { c: "auto", w: 3, o: 1, widths: [1, 2, 3, 5, 8] },
    mono: { c: "auto", w: 2, o: 1, widths: [1, 1.5, 2, 3, 5] },
    marker: { c: "#f2b90f", w: 14, o: 0.4, widths: [8, 14, 20, 28, 36] },
    eraser: { mode: "object", w: 20, widths: [10, 20, 32, 48, 64] }, // (its width: on the screen)
  };
  const GAP = 0.75; // a new point only this far (in screen pixels) from the one before

  function trace(ctx, it, auto) {
    ctx.globalAlpha = it.o;
    if (!it.path) { const o = B.render.outline(it); it.path = new Path2D(o.d); it.stroke = o.stroke; it.cap = o.cap; }
    if (it.stroke) { ctx.strokeStyle = B.render.colorOf(it, auto); ctx.lineWidth = it.stroke; ctx.lineCap = it.cap || "round"; ctx.lineJoin = "round"; ctx.stroke(it.path); }
    else { ctx.fillStyle = B.render.colorOf(it, auto); ctx.fill(it.path); }
  }
  /* All the ink that the view shows. size: { w, h } in CSS pixels. */
  function draw(canvas, items, view, size, auto, skip = null) {
    const dpr = window.devicePixelRatio || 1, ctx = canvas.getContext("2d");
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) { canvas.width = Math.round(size.w * dpr); canvas.height = Math.round(size.h * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const k = dpr * view.z;
    ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
    const x1 = view.x + size.w / view.z, y1 = view.y + size.h / view.z;
    for (const it of items) {
      if (it.k !== "ink" || (skip && skip.has(it.id))) continue;
      const b = B.format.boundsOf(it);
      if (b[2] < view.x || b[0] > x1 || b[3] < view.y || b[1] > y1) continue;
      trace(ctx, it, auto);
    }
    ctx.globalAlpha = 1;
  }
  /* A stroke being drawn: begin(tool, set, pt) → { add(pt), item }. set: the tool's colour, width
   * and opacity. Points are the board's. */
  function begin(tool, set, first, zoom) {
    const def = { ...(TOOLS[tool] || TOOLS.pen), ...set }, color = def.c, t0 = first.t;
    // (as the file will hold them — tenths of a pixel, hundredths of pressure — so that the stroke looks the same once it is read again)
    const q = (v, k) => Math.round(v * k) / k;
    const item = { id: B.format.id(), k: "ink", t: tool, c: color, o: def.o, w: def.w, ch: "xypt", pts: [[q(first.x, 10), q(first.y, 10), q(first.p, 100), 0]] };
    return {
      item,
      add(pt) {
        const last = item.pts[item.pts.length - 1];
        if (Math.hypot(pt.x - last[0], pt.y - last[1]) * zoom < GAP) return false;
        item.pts.push([q(pt.x, 10), q(pt.y, 10), q(pt.p, 100), Math.round(pt.t - t0)]);
        item.path = null; item.box = null;
        return true;
      },
    };
  }
  /* The strokes a round eraser of radius r at (x, y) touches. */
  /* Is (x, y) inside the closed line poly ([[x, y], …])? */
  function within(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  /* The strokes a loop drawn around them takes: those with most of their points inside it. */
  function circled(items, poly) {
    return items.filter((it) => it.k === "ink" && it.pts.filter((p) => within(poly, p[0], p[1])).length >= Math.max(1, it.pts.length * 0.6));
  }
  /* The same stroke somewhere else, or larger: every point through f([x, y]) → [x, y]; its width times k. */
  function moved(it, f, k = 1) {
    const q = (v) => Math.round(v * 10) / 10;
    it.pts = it.pts.map((p) => { const [x, y] = f(p); return [q(x), q(y), ...p.slice(2)]; });
    it.w = Math.max(0.5, Math.min(200, Math.round(it.w * k * 100) / 100));
    it.path = null; it.box = null;
  }
  function touched(items, x, y, r) {
    const out = [];
    for (const it of items) {
      if (it.k !== "ink") continue;
      const b = B.format.boundsOf(it);
      if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) continue;
      const pts = it.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[Math.min(i + 1, pts.length - 1)];
        const dx = c[0] - a[0], dy = c[1] - a[1], len = dx * dx + dy * dy;
        const s = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len)) : 0;
        if (Math.hypot(x - (a[0] + s * dx), y - (a[1] + s * dy)) <= r + B.render.radius(it, a[2])) { out.push(it); break; }
      }
    }
    return out;
  }
  B.ink = { draw, begin, touched, circled, moved, within, trace, TOOLS };
})();
