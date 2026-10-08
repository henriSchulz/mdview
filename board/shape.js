/* mdview — a whiteboard's cleaner hand: what a stroke was meant to be, when the hand rests at its
 * end — a straight line, a circle or an ellipse, a rectangle, a triangle — and a stroke cut where
 * an eraser went through it.
 *
 * No DOM here: the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const q = (v) => Math.round(v * 10) / 10;

  /* The corners of a closed line: the points that stay when everything within eps of the line
   * between its neighbours is left out (Ramer, Douglas, Peucker). */
  function corners(pts, eps) {
    const keep = (a, b, out) => {
      let far = -1, most = eps;
      const dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1], len = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i][0] - pts[a][0]) * dy - (pts[i][1] - pts[a][1]) * dx) / len;
        if (d > most) { most = d; far = i; }
      }
      if (far < 0) return;
      keep(a, far, out); out.push(far); keep(far, b, out);
    };
    // begun at the point farthest from the first, so that the place where the hand began is no corner by itself
    let far = 0;
    for (let i = 1; i < pts.length; i++) if (dist(pts[i], pts[0]) > dist(pts[far], pts[0])) far = i;
    const out = [0];
    keep(0, far, out); out.push(far); keep(far, pts.length - 1, out);
    return out.map((i) => pts[i]);
  }

  /* points: [[x, y, …], …] as drawn → { kind, pts, sharp } with clean points, or null where the
   * stroke is nothing in particular. */
  function guess(points) {
    if (points.length < 3) return null;
    let len = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i) len += dist(p, points[i - 1]);
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (len < 24) return null;
    const a = points[0], z = points[points.length - 1], w = x1 - x0, h = y1 - y0, diag = Math.hypot(w, h), chord = dist(a, z);
    const make = (kind, pts, sharp) => ({ kind, sharp, pts: pts.map((p) => [q(p[0]), q(p[1]), 0.5, 0]) });
    // a straight line: never far from the way between its ends, and not wandering along it
    if (chord > 0.8 * diag) {
      const dx = z[0] - a[0], dy = z[1] - a[1];
      const off = Math.max(...points.map((p) => Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / chord));
      return off <= Math.max(3, 0.06 * chord) && len < 1.6 * chord ? make("line", [a, z], true) : null;
    }
    // everything else is a line that comes back to where it began
    if (chord > Math.max(14, 0.22 * diag) || len < 2 * Math.max(w, h) || w < 10 || h < 10) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    // an ellipse: every point about as far from the middle as an ellipse in its box would be
    const round = points.reduce((s, p) => s + Math.abs(Math.hypot((p[0] - cx) / (w / 2), (p[1] - cy) / (h / 2)) - 1), 0) / points.length;
    if (round < 0.09) {
      const even = Math.abs(w - h) < 0.12 * Math.max(w, h), rx = even ? (w + h) / 4 : w / 2, ry = even ? (w + h) / 4 : h / 2, N = 64;
      const ring = Array.from({ length: N + 1 }, (_v, i) => [cx + rx * Math.cos((2 * Math.PI * i) / N), cy + ry * Math.sin((2 * Math.PI * i) / N)]);
      ring[N] = ring[0];
      return make(even ? "circle" : "ellipse", ring, false);
    }
    let cs = corners([...points, points[0]], 0.07 * diag);
    cs = cs.filter((c, i) => dist(c, cs[(i + 1) % cs.length]) > 0.12 * diag); // (the end beside the beginning is one corner)
    if (cs.length === 3) return make("triangle", [...cs, cs[0]], true);
    // a rectangle: every point near one of its box's sides
    const edge = points.reduce((s, p) => s + Math.min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]), 0) / points.length;
    if (cs.length >= 4 && cs.length <= 6 && edge < 0.07 * Math.min(w, h)) return make("rectangle", [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]], true);
    return null;
  }

  /* A stroke with a round eraser of radius r put through it at (x, y): the pieces that stay —
   * [] where nothing does, null where the eraser did not touch it. A piece ends where the eraser's
   * edge crossed the stroke, with the pressure and time the stroke had there. */
  function cut(pts, x, y, r) {
    const inside = (p) => Math.hypot(p[0] - x, p[1] - y) < r;
    if (pts.length === 1) return inside(pts[0]) ? [] : null;
    const at = (a, b, t) => a.map((v, i) => (i < 2 ? q(v + (b[i] - v) * t) : i === 2 ? Math.round((v + (b[i] - v) * t) * 100) / 100 : Math.round(v + (b[i] - v) * t)));
    const out = [];
    let cur = inside(pts[0]) ? null : [pts[0]], touched = !cur;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - x, fy = a[1] - y;
      // where a + t (b − a) is on the circle
      const A = dx * dx + dy * dy, Bq = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r, disc = Bq * Bq - 4 * A * C;
      const ts = A > 0 && disc > 0 ? [(-Bq - Math.sqrt(disc)) / (2 * A), (-Bq + Math.sqrt(disc)) / (2 * A)].filter((t) => t > 0 && t < 1) : [];
      for (const t of ts) {
        touched = true;
        const p = at(a, b, t);
        if (cur) { cur.push(p); out.push(cur); cur = null; } else cur = [p];
      }
      if (cur) cur.push(b);
    }
    if (cur) out.push(cur);
    if (!touched) return null;
    return out.filter((piece) => piece.length > 1 && piece.reduce((s, p, i) => s + (i ? dist(p, piece[i - 1]) : 0), 0) > 0.5);
  }

  B.shape = { guess, cut, corners };
})();
