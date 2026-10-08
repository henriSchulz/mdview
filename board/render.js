/* mdview — a whiteboard as a picture: the outline of a stroke, and the whole board as SVG. One
 * way of drawing for everything — the canvas fills these same paths (ink.js), the file's picture
 * is made of them, so what the note shows is what the board shows.
 *
 * No DOM here: the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const AUTO = "#1d1d1f"; // "auto" ink in a picture: drawn for a light board (a dark note turns the picture, board.css)
  const MARGIN = 24, EMPTY = [0, 0, 640, 200];
  const n = (v) => String(Math.round(v * 10) / 10);

  /* How wide a stroke is at a point: a pen follows the pressure, the others keep their width. */
  const radius = (it, p) => (it.t === "pen" ? (it.w / 2) * (0.35 + 1.3 * Math.max(0, Math.min(1, p == null ? 0.5 : p))) : it.w / 2);
  /* … at one of its points, with all a pen said there: a pencil held flat (its tilt, where the stroke has one) draws broader. */
  const FLAT = 30; // degrees of tilt from which a pencil counts as held flat
  function reach(it, pt) {
    if (it.t === "pencil") { const i = it.ch ? it.ch.indexOf("i") : -1, tilt = i < 0 ? 0 : pt[i] || 0; return (it.w / 2) * (1 + (Math.max(0, tilt - FLAT) / (90 - FLAT)) * 4); }
    return radius(it, pt[2]);
  }
  const even = (it) => (it.t === "pen" ? it.pts.every((p) => p[2] === it.pts[0][2]) : it.t === "pencil" ? !(it.ch && it.ch.includes("i")) || it.pts.every((p) => (p[it.ch.indexOf("i")] || 0) <= FLAT) : true);
  /* A pencil's stroke is its line twice: once whole and faint, once darker and broken into short
   * pieces — the grain of graphite on paper. → the dashes for the second, by the stroke's width. */
  const grain = (w) => [w * 1.4, w * 0.4, w * 0.6, w * 0.35].map((v) => Math.round(v * 10) / 10);

  /* The stroke as a path: { d, stroke, cap } — stroke: a line of that width to be stroked, with
   * ends of that kind (a stroke of one width: little to write); else an outline to be filled.
   * A marker's line ends flat, as its tip is; a stroke made straight (sharp) keeps its corners. The outline is
   * a row of closed pieces, one per stretch between two points, all wound the same way: filled
   * together they are the stroke, and no turn, however sharp, cuts a hole into it. */
  function outline(it) {
    const pts = it.pts;
    if (even(it)) {
      const w = radius(it, pts[0][2]) * 2;
      const cap = it.t === "marker" && pts.length > 1 ? "butt" : "round";
      if (pts.length === 1) return { d: `M${n(pts[0][0])} ${n(pts[0][1])}h0.01`, stroke: w, cap };
      let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
      if (it.sharp) {
        const shut = pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
        for (let i = 1; i < pts.length - (shut ? 1 : 0); i++) d += `L${n(pts[i][0])} ${n(pts[i][1])}`;
        return { d: d + (shut ? "Z" : ""), stroke: w, cap };
      }
      // through the middles between the points, each point pulling the line: no corners where the hand drew none
      for (let i = 1; i < pts.length - 1; i++) d += `Q${n(pts[i][0])} ${n(pts[i][1])} ${n((pts[i][0] + pts[i + 1][0]) / 2)} ${n((pts[i][1] + pts[i + 1][1]) / 2)}`;
      const z = pts[pts.length - 1];
      return { d: d + `L${n(z[0])} ${n(z[1])}`, stroke: w, cap };
    }
    let d = "";
    const dot = (x, y, r) => `M${n(x - r)} ${n(y)}a${n(r)} ${n(r)} 0 1 1 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-2 * r)} 0Z`;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i], r = reach(it, pts[i]);
      d += dot(x, y, r);
      if (i + 1 === pts.length) break;
      const [x2, y2] = pts[i + 1], r2 = reach(it, pts[i + 1]);
      const dx = x2 - x, dy = y2 - y, len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const nx = -dy / len, ny = dx / len;
      // (the same way round as the dots: clockwise on the screen)
      d += `M${n(x + nx * r)} ${n(y + ny * r)}L${n(x - nx * r)} ${n(y - ny * r)}L${n(x2 - nx * r2)} ${n(y2 - ny * r2)}L${n(x2 + nx * r2)} ${n(y2 + ny * r2)}Z`;
    }
    return { d, stroke: 0, cap: "round" };
  }
  const colorOf = (it, auto = AUTO) => (it.c === "auto" || !/^#[0-9a-f]{3,8}$/i.test(it.c) ? auto : it.c);

  /* The board as a picture: { w, h, box: [x, y, w, h], body } — body is what stands between the
   * data and </svg>. An empty board is a faint sign of one, so that the note shows where it is. */
  function picture(model) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, body = "";
    // what stands on the board first, in its order; the ink lies over it, as it does on the screen
    for (const it of [...model.items.filter((i) => i.k !== "ink"), ...model.items.filter((i) => i.k === "ink")]) {
      const b = B.format.boundsOf(it);
      if (!b) continue;
      if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3];
      if (it.k !== "ink") { body += B.items.svg(it); continue; }
      const o = outline(it), op = it.o < 1 ? ` opacity="${n(it.o)}"` : "";
      if (it.t === "pencil" && o.stroke) {
        const look = `d="${o.d}" fill="none" stroke="${colorOf(it)}" stroke-width="${n(o.stroke)}" stroke-linecap="round" stroke-linejoin="round"`;
        body += `<g id="${it.id}"${op}><path ${look} opacity="0.5"/><path ${look} opacity="0.6" stroke-dasharray="${grain(o.stroke).join(" ")}"/></g>\n`;
        continue;
      }
      body += o.stroke
        ? `<path id="${it.id}" d="${o.d}" fill="none" stroke="${colorOf(it)}" stroke-width="${n(o.stroke)}" stroke-linecap="${o.cap}" stroke-linejoin="round"${op}/>\n`
        : `<path id="${it.id}" d="${o.d}" fill="${colorOf(it)}"${it.t === "pencil" ? ` opacity="${n(it.o * 0.6)}"` : op}/>\n`;
    }
    if (!body) {
      const [x, y, w, h] = EMPTY, cx = x + w / 2, cy = y + h / 2;
      body = `<g fill="none" stroke="${AUTO}" stroke-opacity="0.28" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="${cx - 26}" y="${cy - 20}" width="52" height="40" rx="7"/><path d="M${cx - 15} ${cy + 8}c6-15 12 3 18-9s9-6 12-3"/></g>\n`;
      return { w, h, box: EMPTY, body, empty: true };
    }
    x0 = Math.floor(x0 - MARGIN); y0 = Math.floor(y0 - MARGIN); x1 = Math.ceil(x1 + MARGIN); y1 = Math.ceil(y1 + MARGIN);
    return { w: x1 - x0, h: y1 - y0, box: [x0, y0, x1 - x0, y1 - y0], body, empty: false };
  }

  B.render = { outline, radius, reach, colorOf, picture, grain, AUTO };
})();
