/* mdview — what stands on a whiteboard beside the ink: text boxes, sticky notes, shapes, lines and
 * arrows. Each is one object of plain values — its line in the file is that object — with a
 * frame (x, y, w, h, turned by r degrees about its middle); a line has its two ends instead.
 * Here: what such an object may hold, where it is, whether a point hits it, and how it is drawn
 * in the board's picture. (On the screen it is drawn by layer.js, from the same shapes.)
 *
 * No DOM here: the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const KINDS = new Set(["text", "sticky", "shape", "line", "image", "table", "link", "file"]);
  const PICTURE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i; // (a file that is shown as itself; any other stands on the board as a card)
  const CELL = 6, GRIDLINE = "#b9b9be"; // a table: the room around a cell's text, the colour of its lines
  const texty = (it) => it.k === "text" || it.k === "sticky" || it.k === "shape"; // (what takes text)
  /* A picture on a board is a file beside the board's own, named by its name alone. In the board's
   * picture stands a small copy of it (a picture shown through <img> may not load other files);
   * the copies are made when a picture has loaded on the screen (layer.js) and kept here, by name. */
  const thumbs = new Map(), missing = new Set();
  const SHAPES = ["rect", "round", "ellipse", "triangle", "diamond", "star", "hexagon"];
  const PAPERS = { yellow: "#ffe27a", orange: "#ffc078", pink: "#ffb3c7", purple: "#d9c2ff", blue: "#b5dcff", green: "#bfe8b0", grey: "#e3e3e6" };
  const FILLS = ["#ffffff", "#b9b9be", "#1d1d1f", "#5fd6c3", "#e8559c", "#7a3ff0", "#e5372c", "#f08a12", "#f2c744", "#52b85a", "#55b9ee", "#1f6fe5"];
  const SIZES = [12, 14, 16, 20, 24, 32, 48, 64], WIDTHS = [1, 2, 4, 6, 10];
  const SIDES = ["auto", "t", "r", "b", "l"], ROUTES = ["straight", "corner", "curve"];
  const FONT = '"SF Pro", "Inter", system-ui, sans-serif', LEAD = 1.375, PAD = 10, INK = "#1d1d1f";
  const num = (v, d, lo = -1e7, hi = 1e7) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const color = (v, d) => (typeof v === "string" && (/^#[0-9a-f]{6}$/i.test(v) || v === "none" || v === "auto") ? v : d);
  const n = (v) => String(Math.round(v * 10) / 10);
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* A new item of a kind, with what one looks like before anyone changed it. (cx, cy): its middle. */
  function fresh(kind, cx, cy, more = {}) {
    const id = B.format.id();
    // a table: columns and rows by their widths and heights, a text per cell; its first row may be its head
    if (kind === "table") return { id, k: "table", x: Math.round(cx - 180), y: Math.round(cy - 54), w: 360, h: 108, r: 0, cols: [120, 120, 120], rows: [36, 36, 36], cells: [["", "", ""], ["", "", ""], ["", "", ""]], head: true, ts: { size: 14 } };
    // a card: an address elsewhere (link), or a file kept beside the board (file) — opened from the board
    if (kind === "link" || kind === "file") return { id, k: kind, x: Math.round(cx - 130), y: Math.round(cy - 32), w: 260, h: 64, r: 0, ...(kind === "link" ? { url: String(more.url || "") } : { src: String(more.src || "") }) };
    if (kind === "line") return { id, k: "line", p: [cx - 80, cy, cx + 80, cy], stroke: { c: "auto", w: 2 }, ends: ["none", more.arrow ? "arrow" : "none"] };
    const base = { text: { w: 220, h: 44 }, sticky: { w: 180, h: 180 }, shape: { w: 150, h: more.shape === "rect" || more.shape === "round" ? 100 : 150 } }[kind];
    const it = { id, k: kind, x: Math.round(cx - base.w / 2), y: Math.round(cy - base.h / 2), w: base.w, h: base.h, r: 0, text: "", ts: { size: 16, align: kind === "text" ? "left" : "center", color: "auto" } };
    if (kind === "sticky") it.fill = PAPERS.yellow;
    if (kind === "shape") { it.shape = SHAPES.includes(more.shape) ? more.shape : "rect"; it.fill = "#1f6fe5"; it.stroke = { c: "none", w: 2 }; }
    return it;
  }
  /* A line of the file → the item, with every value of a kind it may be; null where it is none. */
  function norm(o) {
    if (!o || typeof o.id !== "string" || !KINDS.has(o.k)) return null;
    const it = { id: o.id, k: o.k };
    const stroke = (s, d) => ({ c: color(s && s.c, d), w: num(s && s.w, 2, 0.5, 60) });
    if (o.k === "line") {
      if (!Array.isArray(o.p) || o.p.length !== 4 || !o.p.every(Number.isFinite)) return null;
      it.p = o.p.map((v) => num(v, 0));
      it.stroke = stroke(o.stroke, "auto");
      it.ends = [0, 1].map((i) => (Array.isArray(o.ends) && o.ends[i] === "arrow" ? "arrow" : "none"));
      // an end joined to an item: it goes where the item goes (relink). at: the side it leaves from, or wherever is nearest (auto)
      for (const end of ["from", "to"]) if (o[end] && typeof o[end].id === "string" && o[end].id) it[end] = { id: o[end].id, at: SIDES.includes(o[end].at) ? o[end].at : "auto" };
      if (ROUTES.includes(o.route) && o.route !== "straight") it.route = o.route;
    } else if (o.k === "table") {
      const sizes = (a) => Array.isArray(a) && a.length >= 1 && a.length <= 40 && a.every((v) => Number.isFinite(v) && v > 0) ? a.map((v) => num(v, 40, 12, 4000)) : null;
      const cols = sizes(o.cols), rows = sizes(o.rows);
      if (!cols || !rows || ![o.x, o.y].every(Number.isFinite)) return null;
      const cells = rows.map((_r, i) => cols.map((_c, j) => (Array.isArray(o.cells) && Array.isArray(o.cells[i]) && typeof o.cells[i][j] === "string" ? o.cells[i][j].slice(0, 5000) : "")));
      Object.assign(it, { x: num(o.x, 0), y: num(o.y, 0), w: cols.reduce((a, b) => a + b, 0), h: rows.reduce((a, b) => a + b, 0), r: 0, cols, rows, cells, head: o.head !== false, ts: { size: num(o.ts && o.ts.size, 14, 6, 200) } });
    } else if (o.k === "image") {
      // (a name, never a way to somewhere else)
      if (![o.x, o.y, o.w, o.h].every(Number.isFinite) || typeof o.src !== "string" || !/^[^/\\\x00-\x1f]{1,255}$/.test(o.src) || o.src.startsWith(".")) return null;
      Object.assign(it, { x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 100, 4, 20000), h: num(o.h, 100, 4, 20000), r: num(o.r, 0, -360, 360), src: o.src });
      // what is cut off its four sides (left, top, right, bottom), as shares of the whole picture
      if (Array.isArray(o.crop) && o.crop.length === 4 && o.crop.every((v) => Number.isFinite(v) && v >= 0 && v < 1) && o.crop[0] + o.crop[2] < 0.98 && o.crop[1] + o.crop[3] < 0.98 && o.crop.some((v) => v > 0.0005)) it.crop = o.crop.map((v) => Math.round(v * 10000) / 10000);
    } else if (o.k === "link" || o.k === "file") {
      if (![o.x, o.y, o.w, o.h].every(Number.isFinite)) return null;
      Object.assign(it, { x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 260, 80, 4000), h: num(o.h, 64, 40, 4000), r: num(o.r, 0, -360, 360) });
      if (o.k === "link") { if (typeof o.url !== "string" || !/^https?:\/\/[^\s<>"]{1,2000}$/i.test(o.url)) return null; it.url = o.url; }
      else { if (typeof o.src !== "string" || !/^[^/\\\x00-\x1f]{1,255}$/.test(o.src) || o.src.startsWith(".")) return null; it.src = o.src; }
    } else {
      if (![o.x, o.y, o.w, o.h].every(Number.isFinite)) return null;
      Object.assign(it, { x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 100, 4, 20000), h: num(o.h, 100, 4, 20000), r: num(o.r, 0, -360, 360) });
      it.text = typeof o.text === "string" ? o.text.slice(0, 20000) : "";
      const t = o.ts || {};
      it.ts = { size: num(t.size, 16, 6, 400), align: ["left", "center", "right"].includes(t.align) ? t.align : o.k === "text" ? "left" : "center", color: color(t.color, "auto") };
      for (const f of ["bold", "italic", "underline"]) if (t[f] === true) it.ts[f] = true;
      if (o.k === "sticky") it.fill = color(o.fill, PAPERS.yellow);
      if (o.k === "shape") { it.shape = SHAPES.includes(o.shape) ? o.shape : "rect"; it.fill = color(o.fill, "#1f6fe5"); it.stroke = stroke(o.stroke, "none"); }
    }
    if (o.lock === true) it.lock = true;
    if (typeof o.group === "string" && o.group) it.group = o.group;
    return it;
  }
  const data = (it) => { const d = JSON.parse(JSON.stringify(it)); delete d.sides; return d; }; // (sides: worked out, not kept)

  // ---------------------------------------------------------------- where it is
  const rad = (it) => ((it.r || 0) * Math.PI) / 180;
  const mid = (it) => (it.k === "line" ? [(it.p[0] + it.p[2]) / 2, (it.p[1] + it.p[3]) / 2] : [it.x + it.w / 2, it.y + it.h / 2]);
  /* Its four corners on the board (a line: its two ends). */
  function corners(it) {
    if (it.k === "line") return it.route ? way(it) : [[it.p[0], it.p[1]], [it.p[2], it.p[3]]];
    const [cx, cy] = mid(it), c = Math.cos(rad(it)), s = Math.sin(rad(it));
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + (a * it.w * c) / 2 - (b * it.h * s) / 2, cy + (a * it.w * s) / 2 + (b * it.h * c) / 2]);
  }
  function bounds(it) {
    const cs = corners(it), pad = it.k === "line" ? it.stroke.w / 2 + (it.ends.includes("arrow") ? 6 + it.stroke.w * 2 : 1) : it.stroke && it.stroke.c !== "none" ? it.stroke.w / 2 : 0;
    return [Math.min(...cs.map((c) => c[0])) - pad, Math.min(...cs.map((c) => c[1])) - pad, Math.max(...cs.map((c) => c[0])) + pad, Math.max(...cs.map((c) => c[1])) + pad];
  }
  /* A point of the board in the item's own frame: from its middle, before it was turned. */
  function local(it, x, y) {
    const [cx, cy] = mid(it), c = Math.cos(-rad(it)), s = Math.sin(-rad(it));
    return [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c];
  }
  /* Does (x, y) hit it? slack: how far beside it still counts (a line is thin). */
  function hit(it, x, y, slack = 0) {
    if (it.k === "line") {
      const pts = way(it), near = it.stroke.w / 2 + Math.max(slack, 5);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i], dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
        if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= near) return true;
      }
      return false;
    }
    const [lx, ly] = local(it, x, y);
    return Math.abs(lx) <= it.w / 2 + slack && Math.abs(ly) <= it.h / 2 + slack;
  }
  function moveBy(it, dx, dy) {
    if (it.k === "line") it.p = [it.p[0] + dx, it.p[1] + dy, it.p[2] + dx, it.p[3] + dy];
    else { it.x += dx; it.y += dy; }
  }

  // ---------------------------------------------------------------- lines that join items
  /* The middle of an item's side (t, r, b, l), turned as the item is. */
  function sidePoint(it, side) {
    const [cx, cy] = mid(it), c = Math.cos(rad(it)), s = Math.sin(rad(it)), [a, b] = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] }[side];
    return [cx + (a * it.w * c) / 2 - (b * it.h * s) / 2, cy + (a * it.w * s) / 2 + (b * it.h * c) / 2];
  }
  /* Where a joined end stands: on the side it names; auto: the side nearest to (tx, ty), where the line is headed. */
  function joint(it, at, tx, ty) {
    if (at !== "auto") return { side: at, p: sidePoint(it, at) };
    let best = null;
    for (const side of ["t", "r", "b", "l"]) { const p = sidePoint(it, side), d = Math.hypot(p[0] - tx, p[1] - ty); if (!best || d < best.d) best = { side, p, d }; }
    return best;
  }
  /* Every line's joined ends are put where their items are now. An end whose item is gone stays
   * where it was, joined to nothing. → whether anything moved. */
  function relink(items) {
    const byId = new Map(items.filter((it) => it.k !== "ink" && it.k !== "line").map((it) => [it.id, it]));
    let moved = false;
    for (const line of items) {
      if (line.k !== "line" || (!line.from && !line.to)) continue;
      for (const end of ["from", "to"]) if (line[end] && !byId.has(line[end].id)) { delete line[end]; moved = true; }
      const a = line.from && byId.get(line.from.id), z = line.to && byId.get(line.to.id);
      let p = [...line.p];
      const sides = [null, null];
      const put = (i, item, at, tx, ty) => { const j = joint(item, at, tx, ty); p[i * 2] = j.p[0]; p[i * 2 + 1] = j.p[1]; sides[i] = j.side; };
      // each end looks to where the other is: first to the other item's middle, then to the end as it came to stand
      if (a) put(0, a, line.from.at, ...(z ? mid(z) : [p[2], p[3]]));
      if (z) put(1, z, line.to.at, p[0], p[1]);
      if (a && z) put(0, a, line.from.at, p[2], p[3]);
      p = p.map((v) => Math.round(v * 10) / 10);
      if (p.some((v, i) => v !== line.p[i])) { line.p = p; moved = true; }
      line.sides = sides.map((s) => s || null); // (which way each end leaves its item: for the way a cornered or curved line takes; not kept in the file)
    }
    return moved;
  }
  /* The way a line takes, as points: its two ends; cornered: by right angles; curved: a bow, in short straight pieces. */
  function way(it) {
    const [x1, y1, x2, y2] = it.p;
    if (!it.route) return [[x1, y1], [x2, y2]];
    const s = it.sides || [null, null];
    // does an end leave sideways (from a left or right side) or up and down? unjoined: along the longer way
    const flat = (side) => (side ? side === "l" || side === "r" : Math.abs(x2 - x1) >= Math.abs(y2 - y1));
    const h1 = flat(s[0]), h2 = s[1] ? flat(s[1]) : h1;
    if (it.route === "corner") {
      if (h1 && h2) { const mx = (x1 + x2) / 2; return [[x1, y1], [mx, y1], [mx, y2], [x2, y2]]; }
      if (!h1 && !h2) { const my = (y1 + y2) / 2; return [[x1, y1], [x1, my], [x2, my], [x2, y2]]; }
      return h1 ? [[x1, y1], [x2, y1], [x2, y2]] : [[x1, y1], [x1, y2], [x2, y2]];
    }
    const k = 0.5, c1 = h1 ? [x1 + (x2 - x1) * k, y1] : [x1, y1 + (y2 - y1) * k], c2 = h2 ? [x2 - (x2 - x1) * k, y2] : [x2, y2 - (y2 - y1) * k], out = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24, u = 1 - t; out.push([u * u * u * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x2, u * u * u * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * y2]); }
    return out;
  }
  /* A line as it is drawn: { d, heads } — the way, stopping short inside an arrow's head, and the heads. */
  function lineDraw(it) {
    const pts = way(it).map((p) => [...p]), w = it.stroke.w, last = pts.length - 1;
    const heads = [it.ends[0] === "arrow" ? head(pts[0][0], pts[0][1], pts[1][0], pts[1][1], w) : "", it.ends[1] === "arrow" ? head(pts[last][0], pts[last][1], pts[last - 1][0], pts[last - 1][1], w) : ""];
    const pull = (i, j) => { const len = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]) || 1, d = Math.min(len / 2, 4 + w * 2); pts[i] = [pts[i][0] + ((pts[j][0] - pts[i][0]) * d) / len, pts[i][1] + ((pts[j][1] - pts[i][1]) * d) / len]; };
    if (heads[0]) pull(0, 1);
    if (heads[1]) pull(last, last - 1);
    return { d: "M" + pts.map((p) => `${n(p[0])} ${n(p[1])}`).join("L"), heads };
  }

  // ---------------------------------------------------------------- how it looks
  /* A shape's outline in a box of w × h, from its top left corner. */
  function shapePath(kind, w, h) {
    const poly = (pts) => "M" + pts.map((p) => `${n(p[0])} ${n(p[1])}`).join("L") + "Z";
    if (kind === "ellipse") return `M0 ${n(h / 2)}a${n(w / 2)} ${n(h / 2)} 0 1 1 ${n(w)} 0a${n(w / 2)} ${n(h / 2)} 0 1 1 ${n(-w)} 0Z`;
    if (kind === "round") { const r = Math.min(14, w / 2, h / 2); return `M${n(r)} 0H${n(w - r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}V${n(h - r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}H${n(r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}V${n(r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}Z`; }
    if (kind === "triangle") return poly([[w / 2, 0], [w, h], [0, h]]);
    if (kind === "diamond") return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    if (kind === "hexagon") return poly([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]);
    if (kind === "star") return poly(Array.from({ length: 10 }, (_v, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.4 : 1; return [w / 2 + (Math.cos(a) * k * w) / 2, h / 2 + (Math.sin(a) * k * h) / 2]; }));
    return poly([[0, 0], [w, 0], [w, h], [0, h]]);
  }
  /* An arrow's head at (x, y), for a line that arrives from (fx, fy). */
  function head(x, y, fx, fy, w) {
    const a = Math.atan2(y - fy, x - fx), len = 6 + w * 2.5, half = 3 + w * 1.2;
    const p = (d, s) => `${n(x - Math.cos(a) * d + Math.sin(a) * s)} ${n(y - Math.sin(a) * d - Math.cos(a) * s)}`;
    return `M${n(x)} ${n(y)}L${p(len, half)}L${p(len, -half)}Z`;
  }
  /* The colour of its text: what was chosen, else dark on a sticky note, on a shape whichever of
   * dark and white stands out from its fill, and the theme's text colour (auto) in a bare box. */
  function textColor(it, auto = INK) {
    if (it.ts.color !== "auto") return it.ts.color;
    if (it.k === "sticky") return INK;
    if (it.k === "shape" && it.fill !== "none") {
      const v = parseInt(it.fill.slice(1), 16), lum = (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
      return lum > 0.6 ? INK : "#ffffff";
    }
    return auto;
  }
  /* Its text in lines that fit its width. measure(text, font) → pixels; without one (no canvas:
   * the tests) a letter is taken to be about half its size wide. */
  let measure = null;
  function lines(it) {
    const font = `${it.ts.italic ? "italic " : ""}${it.ts.bold ? "600" : "400"} ${it.ts.size}px ${FONT}`, room = Math.max(8, it.w - 2 * PAD);
    const wide = (s) => (measure ? measure(s, font) : s.length * it.ts.size * 0.52);
    const out = [];
    for (const para of String(it.text).split("\n")) {
      let line = "";
      for (const word of para.split(/(?<=\s)/)) {
        if (line && wide((line + word).trimEnd()) > room) { out.push(line.trimEnd()); line = word; } else line += word;
        while (wide(line.trimEnd()) > room && line.length > 1) { // (a word longer than the box: broken where it must be)
          let k = line.length - 1;
          while (k > 1 && wide(line.slice(0, k)) > room) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  /* Which cell of a table a point of its own frame (from its middle) is in: [row, column]. */
  function cellAt(it, lx, ly) {
    const find = (sizes, v) => { let at = 0; for (let i = 0; i < sizes.length; i++) { at += sizes[i]; if (v < at) return i; } return sizes.length - 1; };
    return [find(it.rows, ly + it.h / 2), find(it.cols, lx + it.w / 2)];
  }
  /* A table to another size: its columns and rows keep their shares. */
  function tableFit(it, w, h) {
    const kw = w / it.w, kh = h / it.h;
    it.cols = it.cols.map((c) => Math.max(12, Math.round(c * kw * 10) / 10));
    it.rows = it.rows.map((r) => Math.max(12, Math.round(r * kh * 10) / 10));
    it.w = it.cols.reduce((a, b) => a + b, 0); it.h = it.rows.reduce((a, b) => a + b, 0);
  }
  function tableSvg(it) {
    let out = `<g id="${it.id}">`, y = it.y;
    if (it.head) out += `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.rows[0])}" fill="${INK}" fill-opacity="0.07"/>`;
    const lead = it.ts.size * LEAD, look = `font-family='${FONT}' font-size="${n(it.ts.size)}" fill="${INK}"`;
    it.rows.forEach((rh, i) => {
      let x = it.x;
      it.cols.forEach((cw, j) => {
        const text = it.cells[i][j];
        if (text) {
          const ls = lines({ text, w: cw + 2 * (PAD - CELL), ts: { size: it.ts.size, bold: it.head && i === 0 } });
          out += `<text ${look}${it.head && i === 0 ? ' font-weight="600"' : ""} xml:space="preserve">` + ls.map((l, k) => `<tspan x="${n(x + CELL)}" y="${n(y + CELL + lead * (k + 0.76))}">${xml(l)}</tspan>`).join("") + "</text>";
        }
        x += cw;
      });
      y += rh;
    });
    // the lines: around it, and between its columns and rows
    let d = `M${n(it.x)} ${n(it.y)}h${n(it.w)}v${n(it.h)}h${n(-it.w)}Z`, at = it.x;
    for (const cw of it.cols.slice(0, -1)) { at += cw; d += `M${n(at)} ${n(it.y)}v${n(it.h)}`; }
    at = it.y;
    for (const rh of it.rows.slice(0, -1)) { at += rh; d += `M${n(it.x)} ${n(at)}h${n(it.w)}`; }
    return out + `<path d="${d}" fill="none" stroke="${GRIDLINE}" stroke-width="1"/></g>\n`;
  }
  /* What a card says: a short sign, a title, a line under it. */
  function card(it) {
    if (it.k === "link") {
      const m = /^https?:\/\/([^/?#]+)(.*)$/i.exec(it.url) || [], host = (m[1] || it.url).replace(/^www\./, ""), rest = (m[2] || "").replace(/^\/$/, "");
      return { badge: "WWW", title: host, sub: rest ? host + rest : it.url };
    }
    const dot = it.src.lastIndexOf("."), ext = dot > 0 ? it.src.slice(dot + 1) : "";
    return { badge: (ext || "file").slice(0, 4).toUpperCase(), title: dot > 0 ? it.src.slice(0, dot) : it.src, sub: it.src };
  }
  /* The item in the board's picture. */
  function svg(it) {
    const strokeOf = (s) => (s && s.c !== "none" ? ` stroke="${s.c === "auto" ? INK : s.c}" stroke-width="${n(s.w)}" stroke-linejoin="round"` : "");
    if (it.k === "line") {
      const c = it.stroke.c === "auto" || it.stroke.c === "none" ? INK : it.stroke.c, l = lineDraw(it);
      return `<g id="${it.id}"><path d="${l.d}" fill="none" stroke="${c}" stroke-width="${n(it.stroke.w)}" stroke-linejoin="round" stroke-linecap="${it.ends.includes("arrow") ? "butt" : "round"}"/>` + l.heads.filter(Boolean).map((h) => `<path d="${h}" fill="${c}"/>`).join("") + "</g>\n";
    }
    if (it.k === "table") return tableSvg(it);
    const [cx, cy] = mid(it), turn = it.r ? ` transform="rotate(${n(it.r)} ${n(cx)} ${n(cy)})"` : "";
    let body = "";
    if (it.k === "image") {
      const small = thumbs.get(it.src), frame = `x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"`, c = it.crop;
      if (!small) missing.add(it.src);
      // (cut: the part that stays, stretched over the frame — a picture of its own inside the picture, looking at that part)
      body = !small ? `<rect ${frame} rx="4" fill="#b9b9be" fill-opacity="0.35"/>`
        : c ? `<svg ${frame} viewBox="${c[0]} ${c[1]} ${Math.round((1 - c[0] - c[2]) * 10000) / 10000} ${Math.round((1 - c[1] - c[3]) * 10000) / 10000}" preserveAspectRatio="none"><image data-src="${xml(it.src)}" width="1" height="1" preserveAspectRatio="none" href="${small}"/></svg>`
        : `<image data-src="${xml(it.src)}" ${frame} preserveAspectRatio="none" href="${small}"/>`;
    }
    if (it.k === "link" || it.k === "file") {
      const c = card(it), fit = (s, most) => (s.length > most ? s.slice(0, most - 1) + "…" : s), room = Math.max(4, Math.floor((it.w - 62) / 7));
      body = `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="12" fill="#ffffff" stroke="${GRIDLINE}" stroke-width="1"/>` +
        `<rect x="${n(it.x + 12)}" y="${n(it.y + it.h / 2 - 16)}" width="32" height="32" rx="7" fill="${INK}" fill-opacity="0.08"/><text font-family='${FONT}' font-size="9" font-weight="600" fill="${INK}" fill-opacity="0.65" text-anchor="middle" x="${n(it.x + 28)}" y="${n(it.y + it.h / 2 + 3)}">${xml(c.badge)}</text>` +
        `<text font-family='${FONT}' font-size="13" font-weight="600" fill="${INK}" x="${n(it.x + 54)}" y="${n(it.y + it.h / 2 - 3)}">${xml(fit(c.title, room))}</text><text font-family='${FONT}' font-size="11" fill="${INK}" fill-opacity="0.6" x="${n(it.x + 54)}" y="${n(it.y + it.h / 2 + 14)}">${xml(fit(c.sub, room + 4))}</text>`;
    }
    if (it.k === "shape") body = `<path transform="translate(${n(it.x)} ${n(it.y)})" d="${shapePath(it.shape, it.w, it.h)}" fill="${it.fill}"${strokeOf(it.stroke)}/>`;
    if (it.k === "sticky") body = `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="2" fill="${it.fill === "none" ? PAPERS.yellow : it.fill}"/>`;
    if (texty(it) && it.text) {
      const ls = lines(it), lead = it.ts.size * LEAD, block = ls.length * lead;
      const top = it.k === "text" ? it.y + PAD : it.y + Math.max(PAD, (it.h - block) / 2);
      const x = it.ts.align === "left" ? it.x + PAD : it.ts.align === "right" ? it.x + it.w - PAD : cx;
      const look = `font-family='${FONT}' font-size="${n(it.ts.size)}"${it.ts.bold ? ' font-weight="600"' : ""}${it.ts.italic ? ' font-style="italic"' : ""}${it.ts.underline ? ' text-decoration="underline"' : ""}`;
      body += `<text ${look} fill="${textColor(it)}" text-anchor="${{ left: "start", center: "middle", right: "end" }[it.ts.align]}" xml:space="preserve">` +
        ls.map((l, i) => `<tspan x="${n(x)}" y="${n(top + lead * (i + 0.76))}">${xml(l)}</tspan>`).join("") + "</text>";
    }
    return `<g id="${it.id}"${turn}>${body}</g>\n`;
  }

  /* The small copies a board's file holds already: taken from its picture, so that keeping the board again needs none made anew. */
  function thumbsFrom(text) {
    for (const m of String(text).matchAll(/<image data-src="([^"]+)"[^>]*? href="(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)"/g)) {
      const src = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
      if (!thumbs.has(src)) thumbs.set(src, m[2]);
    }
  }

  B.items = { PICTURE, card, CELL, cellAt, tableFit, SIDES, ROUTES, sidePoint, joint, relink, way, lineDraw, texty, thumbs, missing, thumbsFrom, KINDS, SHAPES, PAPERS, FILLS, SIZES, WIDTHS, FONT, LEAD, PAD, INK, fresh, norm, data, mid, corners, bounds, local, hit, moveBy, shapePath, head, textColor, lines, svg, set measure(f) { measure = f; } };
})();
