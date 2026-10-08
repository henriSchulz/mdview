/* mdview — a whiteboard's ink: strokes drawn on a canvas from the same paths the file's picture
 * is made of (render.js), the stroke under the hand, and what an eraser touches. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const TOOLS = { pen: { w: 3, o: 1 }, mono: { w: 2, o: 1 } };
  const GAP = 0.75; // a new point only this far (in screen pixels) from the one before

  function trace(ctx, it, auto) {
    if (!it.path) { const o = B.render.outline(it); it.path = new Path2D(o.d); it.stroke = o.stroke; }
    ctx.globalAlpha = it.o;
    if (it.stroke) { ctx.strokeStyle = B.render.colorOf(it, auto); ctx.lineWidth = it.stroke; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(it.path); }
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
  /* A stroke being drawn: begin(tool, color, pt) → { add(pt), item }. Points are the board's. */
  function begin(tool, color, first, zoom) {
    const def = TOOLS[tool] || TOOLS.pen, t0 = first.t;
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
  B.ink = { draw, begin, touched, trace, TOOLS };
})();
