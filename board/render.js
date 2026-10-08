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
  const FLAT = 50; // degrees of tilt from which a pencil counts as held flat (a hand that writes holds it at 30 to 45)
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
    // A band along the stroke: its one edge forwards, round the end, its other edge back, round the beginning. The breadth at
    // each point is the mean of what the pen said there and just before and after — taken point by point, a line is a row of
    // beads (so it looked on the first iPad). Where the stroke turns sharply the band ends and a new one begins: their round
    // ends lie on each other at the turn. All bands are wound the same way; filled together they are the stroke.
    const f = (v) => String(Math.round(v * 100) / 100), last = pts.length - 1;
    const raw = pts.map((p) => reach(it, p)), rs = raw.map((_r, i) => { let sum = 0, k = 0; for (let j = Math.max(0, i - 2); j <= Math.min(last, i + 2); j++) { sum += raw[j]; k++; } return sum / k; });
    const dir = (a, z) => { const dx = pts[z][0] - pts[a][0], dy = pts[z][1] - pts[a][1], len = Math.hypot(dx, dy); return len < 0.01 ? null : [dx / len, dy / len]; };
    // an edge: through the middles between its points, each point pulling the line (as the stroke of one width is drawn)
    const edge = (e) => { let out = ""; for (let i = 1; i < e.length - 1; i++) out += `Q${f(e[i][0])} ${f(e[i][1])} ${f((e[i][0] + e[i + 1][0]) / 2)} ${f((e[i][1] + e[i + 1][1]) / 2)}`; return out + `L${f(e[e.length - 1][0])} ${f(e[e.length - 1][1])}`; };
    function band(from, to) {
      const left = [], right = [];
      let was = null;
      for (let i = from; i <= to; i++) {
        const t = dir(Math.max(from, i - 1), Math.min(to, i + 1)) || was || [1, 0];
        was = t;
        left.push([pts[i][0] - t[1] * rs[i], pts[i][1] + t[0] * rs[i]]);
        right.push([pts[i][0] + t[1] * rs[i], pts[i][1] - t[0] * rs[i]]);
      }
      const back = [...right].reverse();
      return `M${f(left[0][0])} ${f(left[0][1])}` + edge(left) + `A${f(rs[to])} ${f(rs[to])} 0 0 0 ${f(back[0][0])} ${f(back[0][1])}` + edge(back) + `A${f(rs[from])} ${f(rs[from])} 0 0 0 ${f(left[0][0])} ${f(left[0][1])}Z`;
    }
    let d = "", from = 0, before = null;
    for (let i = 1; i <= last; i++) {
      const now = dir(i - 1, i);
      if (now && before && now[0] * before[0] + now[1] * before[1] < 0.5) { d += band(from, i - 1); from = i - 1; } // (turned by more than 60 degrees at the point before)
      if (now) before = now;
    }
    d += band(from, last);
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
