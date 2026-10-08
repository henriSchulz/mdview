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
  const KINDS = new Set(["text", "sticky", "shape", "line", "image"]);
  const texty = (it) => it.k === "text" || it.k === "sticky" || it.k === "shape"; // (what takes text)
  /* A picture on a board is a file beside the board's own, named by its name alone. In the board's
   * picture stands a small copy of it (a picture shown through <img> may not load other files);
   * the copies are made when a picture has loaded on the screen (layer.js) and kept here, by name. */
  const thumbs = new Map(), missing = new Set();
  const SHAPES = ["rect", "round", "ellipse", "triangle", "diamond", "star", "hexagon"];
  const PAPERS = { yellow: "#ffe27a", orange: "#ffc078", pink: "#ffb3c7", purple: "#d9c2ff", blue: "#b5dcff", green: "#bfe8b0", grey: "#e3e3e6" };
  const FILLS = ["#ffffff", "#b9b9be", "#1d1d1f", "#5fd6c3", "#e8559c", "#7a3ff0", "#e5372c", "#f08a12", "#f2c744", "#52b85a", "#55b9ee", "#1f6fe5"];
  const SIZES = [12, 14, 16, 20, 24, 32, 48, 64], WIDTHS = [1, 2, 4, 6, 10];
  const FONT = '"SF Pro", "Inter", system-ui, sans-serif', LEAD = 1.375, PAD = 10, INK = "#1d1d1f";
  const num = (v, d, lo = -1e7, hi = 1e7) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const color = (v, d) => (typeof v === "string" && (/^#[0-9a-f]{6}$/i.test(v) || v === "none" || v === "auto") ? v : d);
  const n = (v) => String(Math.round(v * 10) / 10);
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  /* A new item of a kind, with what one looks like before anyone changed it. (cx, cy): its middle. */
  function fresh(kind, cx, cy, more = {}) {
    const id = B.format.id();
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
    } else if (o.k === "image") {
      // (a name, never a way to somewhere else)
      if (![o.x, o.y, o.w, o.h].every(Number.isFinite) || typeof o.src !== "string" || !/^[^/\\\x00-\x1f]{1,255}$/.test(o.src) || o.src.startsWith(".")) return null;
      Object.assign(it, { x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 100, 4, 20000), h: num(o.h, 100, 4, 20000), r: num(o.r, 0, -360, 360), src: o.src });
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
  const data = (it) => JSON.parse(JSON.stringify(it));

  // ---------------------------------------------------------------- where it is
  const rad = (it) => ((it.r || 0) * Math.PI) / 180;
  const mid = (it) => (it.k === "line" ? [(it.p[0] + it.p[2]) / 2, (it.p[1] + it.p[3]) / 2] : [it.x + it.w / 2, it.y + it.h / 2]);
  /* Its four corners on the board (a line: its two ends). */
  function corners(it) {
    if (it.k === "line") return [[it.p[0], it.p[1]], [it.p[2], it.p[3]]];
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
      const [x1, y1, x2, y2] = it.p, dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len)) : 0;
      return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= it.stroke.w / 2 + Math.max(slack, 5);
    }
    const [lx, ly] = local(it, x, y);
    return Math.abs(lx) <= it.w / 2 + slack && Math.abs(ly) <= it.h / 2 + slack;
  }
  function moveBy(it, dx, dy) {
    if (it.k === "line") it.p = [it.p[0] + dx, it.p[1] + dy, it.p[2] + dx, it.p[3] + dy];
    else { it.x += dx; it.y += dy; }
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
  /* The item in the board's picture. */
  function svg(it) {
    const strokeOf = (s) => (s && s.c !== "none" ? ` stroke="${s.c === "auto" ? INK : s.c}" stroke-width="${n(s.w)}" stroke-linejoin="round"` : "");
    if (it.k === "line") {
      const [x1, y1, x2, y2] = it.p, c = it.stroke.c === "auto" || it.stroke.c === "none" ? INK : it.stroke.c;
      // (the line stops inside an arrow's head, so that its blunt end does not show at the tip)
      const back = (ax, ay, bx, by, on) => { const len = Math.hypot(bx - ax, by - ay) || 1, d = on ? Math.min(len / 2, 4 + it.stroke.w * 2) : 0; return [ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]; };
      const a = back(x1, y1, x2, y2, it.ends[0] === "arrow"), z = back(x2, y2, x1, y1, it.ends[1] === "arrow");
      return `<g id="${it.id}"><path d="M${n(a[0])} ${n(a[1])}L${n(z[0])} ${n(z[1])}" fill="none" stroke="${c}" stroke-width="${n(it.stroke.w)}" stroke-linecap="${it.ends.includes("arrow") ? "butt" : "round"}"/>` +
        (it.ends[0] === "arrow" ? `<path d="${head(x1, y1, x2, y2, it.stroke.w)}" fill="${c}"/>` : "") + (it.ends[1] === "arrow" ? `<path d="${head(x2, y2, x1, y1, it.stroke.w)}" fill="${c}"/>` : "") + "</g>\n";
    }
    const [cx, cy] = mid(it), turn = it.r ? ` transform="rotate(${n(it.r)} ${n(cx)} ${n(cy)})"` : "";
    let body = "";
    if (it.k === "image") {
      const small = thumbs.get(it.src), frame = `x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}"`;
      if (!small) missing.add(it.src);
      body = small ? `<image data-src="${xml(it.src)}" ${frame} preserveAspectRatio="none" href="${small}"/>` : `<rect ${frame} rx="4" fill="#b9b9be" fill-opacity="0.35"/>`;
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

  B.items = { texty, thumbs, missing, thumbsFrom, KINDS, SHAPES, PAPERS, FILLS, SIZES, WIDTHS, FONT, LEAD, PAD, INK, fresh, norm, data, mid, corners, bounds, local, hit, moveBy, shapePath, head, textColor, lines, svg, set measure(f) { measure = f; } };
})();
