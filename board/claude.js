/* mdview — a whiteboard drawn on by Claude: what it is told of the board, and what it answers, done on the board.
 *
 * Claude answers with a block of steps, one JSON object per line, each done as soon as its line is whole (the answer
 * comes in pieces — the board fills while it is written):
 *
 *   <board>
 *   {"add":"ink","tool":"pen","c":"#e5372c","w":3,"d":"M 10 10 C 40 0, 60 0, 90 10"}   a stroke: an SVG path, or "pts"
 *   {"add":"write","x":0,"y":0,"text":"Idea","size":28}                                  words written by hand (vendor/hershey.js)
 *   {"add":"sticky","as":"a","x":0,"y":0,"w":180,"h":180,"text":"Idea"}                 anything else as the file's line has it
 *   {"add":"line","p":[0,0,200,0],"ends":["none","arrow"],"from":{"id":"a"}}             ("as": a name later steps may use)
 *   {"set":"k3f9a","text":"Better idea","fill":"#bfe8b0"}                                  fields of a thing changed
 *   {"move":"k3f9a","dx":40,"dy":0}                                                        a thing moved
 *   {"del":"k3f9a"}                                                                        a thing taken away
 *   </board>
 *
 * Everything is in the board's pixels. What it is told (describe) is the board's own lines, a stroke's points left out for
 * the box around them — so that what it reads is what it writes back. No DOM here: the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const OPEN = "<board>", CLOSE = "</board>";
  const r1 = (v) => Math.round(v * 10) / 10;
  const INKS = ["pen", "mono", "marker", "pencil"];
  const color = (v, d) => (typeof v === "string" && (/^#[0-9a-f]{6}$/i.test(v) || v === "auto") ? v.toLowerCase() : d);

  // ---------------------------------------------------------------- what Claude is told
  /* The board as lines of text: where the window looks, what is chosen, the pages of a PDF under it, every thing on it.
   * o: { view: [x, y, w, h], pick: [ids], pages: [{ n, x, y, w, h }], paper: a notebook's paper (board/paper.js), when it is one } */
  function describe(model, o = {}) {
    const out = [];
    if (o.view) out.push(`The window shows x ${Math.round(o.view[0])} to ${Math.round(o.view[0] + o.view[2])}, y ${Math.round(o.view[1])} to ${Math.round(o.view[1] + o.view[3])}.`);
    if (o.pages && o.pages.length) {
      const n = `${o.pages.length} page${o.pages.length === 1 ? "" : "s"}`;
      out.push(o.paper ? `The board is a notebook of ${n} of ${o.paper.bg === "blank" ? "blank" : o.paper.bg} paper (${o.paper.color}), A4, one under the other; write and draw on the pages, within their margins, as on paper. Each page as a box on the board (x, y, width, height):`
        : `The board lies over a PDF of ${n}; each page as a box on the board (x, y, width, height):`);
      for (const p of o.pages.slice(0, 400)) out.push(`page ${p.n}: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.w)}, ${Math.round(p.h)}`);
    }
    const items = model.items || [];
    if (!items.length) out.push("The board is empty.");
    else {
      out.push(`What is on the board (${items.length}), from the back to the front:`);
      let room = 200_000;
      const told = new Set();
      for (const it of items) {
        // (strokes that are words written by hand are told as one: the writing's id, how many, the box round them all)
        if (it.k === "ink" && it.of) {
          if (told.has(it.of)) continue;
          told.add(it.of);
          const all = items.filter((x) => x.k === "ink" && x.of === it.of), b = all.map((x) => B.format.boundsOf(x)).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
          const line = JSON.stringify({ id: it.of, k: "ink", strokes: all.length, tool: it.t, c: it.c, w: it.w, box: [r1(b[0]), r1(b[1]), r1(b[2] - b[0]), r1(b[3] - b[1])], ...(it.said ? { text: it.said } : {}) });
          if ((room -= line.length) < 0) { out.push("(… more, left out for their length)"); break; }
          out.push(line);
          continue;
        }
        const line = JSON.stringify(lineOf(it));
        if ((room -= line.length) < 0) { out.push("(… more, left out for their length)"); break; }
        out.push(line);
      }
    }
    if (o.pick && o.pick.length) out.push(`Chosen by the user right now (“this”, “these”, “here” mean them): ${o.pick.join(", ")}.`);
    return out.join("\n");
  }
  /* A thing as its line in the file; a stroke by its tool, colour, width and the box around its points. */
  function lineOf(it) {
    if (it.k !== "ink") { const d = B.items.data(it); delete d.path; delete d.box; return d; }
    const b = B.format.boundsOf(it);
    return { id: it.id, k: "ink", tool: it.t, c: it.c, w: it.w, box: [r1(b[0]), r1(b[1]), r1(b[2] - b[0]), r1(b[3] - b[1])], points: it.pts.length };
  }

  // ---------------------------------------------------------------- reading the answer as it comes
  /* feed(text) → the steps whose lines became whole with it. A line that is no JSON object is passed over (counted in bad). */
  function reader() {
    let all = "", at = 0, inside = false;
    const r = { bad: 0, feed, end: () => feed("\n") };
    function feed(text) {
      all += text;
      const steps = [];
      for (;;) {
        if (!inside) {
          const i = all.indexOf(OPEN, at);
          if (i < 0) break;
          inside = true; at = i + OPEN.length;
          continue;
        }
        const nl = all.indexOf("\n", at), close = all.indexOf(CLOSE, at);
        const stop = close >= 0 && (nl < 0 || close < nl) ? close : nl;
        if (stop < 0) break;
        const line = all.slice(at, stop).trim();
        at = stop === close ? close + CLOSE.length : nl + 1;
        if (stop === close) inside = false;
        if (!line) continue;
        let o = null;
        try { o = JSON.parse(line); } catch (e) { /* (not a step) */ }
        if (o && typeof o === "object" && !Array.isArray(o)) steps.push(o); else r.bad++;
      }
      return steps;
    }
    return r;
  }
  /* The answer without its blocks of steps: what is said to the user. */
  const words = (text) => String(text || "").replace(/<board>[\s\S]*?(<\/board>|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();

  // ---------------------------------------------------------------- a path as points
  /* An SVG path's d (M L H V C S Q T Z, upper and lower case; A is taken as a straight line to its end) → [[x, y], …],
   * a point every `step` pixels or so. Several subpaths come back as several lists. */
  function flatten(d, step = 2) {
    const tokens = String(d || "").match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const runs = [];
    let run = null, x = 0, y = 0, sx = 0, sy = 0, cmd = "", i = 0, lc = null; // lc: the last control point, for S and T
    const num = () => Number(tokens[i++]);
    const has = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
    const to = (nx, ny) => { if (!run) { run = [[x, y]]; runs.push(run); } line(nx, ny); x = nx; y = ny; };
    const line = (nx, ny) => { const n = Math.max(1, Math.ceil(Math.hypot(nx - x, ny - y) / step)); for (let k = 1; k <= n; k++) run.push([x + ((nx - x) * k) / n, y + ((ny - y) * k) / n]); };
    const curve = (pts) => { // a Bézier of any degree: from (x, y) through the control points
      if (!run) { run = [[x, y]]; runs.push(run); }
      const all = [[x, y], ...pts];
      let len = 0;
      for (let k = 1; k < all.length; k++) len += Math.hypot(all[k][0] - all[k - 1][0], all[k][1] - all[k - 1][1]);
      const n = Math.max(2, Math.min(400, Math.ceil(len / step)));
      for (let k = 1; k <= n; k++) {
        let p = all.map((q) => [...q]);
        const t = k / n;
        while (p.length > 1) p = p.slice(1).map((q, j) => [p[j][0] + (q[0] - p[j][0]) * t, p[j][1] + (q[1] - p[j][1]) * t]);
        run.push(p[0]);
      }
      [x, y] = all[all.length - 1];
    };
    while (i < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
      else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === "Z") { if (run) { to(sx, sy); run = null; } lc = null; cmd = ""; continue; }
      if (!has()) { cmd = ""; continue; }
      if (C === "M") { const nx = ox + num(), ny = oy + num(); run = null; x = sx = nx; y = sy = ny; cmd = rel ? "l" : "L"; lc = null; continue; }
      if (C === "L") { to(ox + num(), oy + num()); lc = null; }
      else if (C === "H") { to(ox + num(), y); lc = null; }
      else if (C === "V") { to(x, oy + num()); lc = null; }
      else if (C === "C") { const a = [ox + num(), oy + num()], b = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; curve([a, b, e]); lc = { k: "C", p: b }; }
      else if (C === "S") { const a = lc && lc.k === "C" ? [2 * x - lc.p[0], 2 * y - lc.p[1]] : [x, y], b = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; curve([a, b, e]); lc = { k: "C", p: b }; }
      else if (C === "Q") { const a = [ox + num(), oy + num()], e = [ox + num(), oy + num()]; curve([a, e]); lc = { k: "Q", p: a }; }
      else if (C === "T") { const a = lc && lc.k === "Q" ? [2 * x - lc.p[0], 2 * y - lc.p[1]] : [x, y], e = [ox + num(), oy + num()]; curve([a, e]); lc = { k: "Q", p: a }; }
      else if (C === "A") { for (let k = 0; k < 5; k++) num(); to(ox + num(), oy + num()); lc = null; }
      else { i++; }
      if (!Number.isFinite(x + y)) return [];
    }
    return runs.filter((r) => r.length > 1 && r.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  }

  // ---------------------------------------------------------------- handwriting
  /* Words as a hand writes them: the letters of a Hershey font (vendor/hershey.js: strokes, as a pen draws them), each a
   * little turned, raised and sized as a hand does — strokes of ink as any other, chosen one by one; each knows the writing it
   * is part of (of), for Claude to change or take away the whole. */
  const SAME = { "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "‚": ",", "–": "-", "—": "-", "…": "...", "•": "*", "·": ".", "×": "x", "°": "o" };
  const DOTS = { ä: "a", ö: "o", ü: "u", Ä: "A", Ö: "O", Ü: "U" };
  // signs a keyboard has not, drawn by hand in the font's units (the line at y 21, a capital from y 1): [path, o]
  const SIGNS = {
    "→": ["M2,14 L20,14 M14,9 L20,14 L14,19", 12], "←": ["M20,14 L2,14 M8,9 L2,14 L8,19", 12], "↑": ["M8,22 L8,4 M3,9 L8,4 L13,9", 9], "↓": ["M8,4 L8,22 M3,17 L8,22 L13,17", 9],
    "↔": ["M2,14 L22,14 M7,9 L2,14 L7,19 M17,9 L22,14 L17,19", 14], "⇒": ["M2,11 L18,11 M2,17 L18,17 M14,8 L21,14 L14,20", 13], "⇐": ["M22,11 L6,11 M22,17 L6,17 M10,8 L3,14 L10,20", 13],
    "✓": ["M3,14 L8,20 L19,5", 12], "✔": ["M3,14 L8,20 L19,5", 12], "✗": ["M4,6 L18,20 M18,6 L4,20", 12], "✘": ["M4,6 L18,20 M18,6 L4,20", 12],
    "≈": ["M3,11 C6,8 9,8 12,11 C15,14 18,14 21,11 M3,17 C6,14 9,14 12,17 C15,20 18,20 21,17", 13], "≠": ["M4,11 L20,11 M4,17 L20,17 M16,6 L8,22", 13],
    "≤": ["M19,6 L5,12 L19,18 M5,22 L19,22", 13], "≥": ["M5,6 L19,12 L5,18 M5,22 L19,22", 13], "±": ["M12,6 L12,18 M5,12 L19,12 M5,22 L19,22", 13],
    "÷": ["M4,14 L20,14 M12,8 L12.6,8.6 M12,20 L12.6,20.6", 13], "°": ["M6,2 C4,2 3,3.5 3,5 C3,6.5 4,8 6,8 C8,8 9,6.5 9,5 C9,3.5 8,2 6,2", 7],
    "√": ["M2,14 L5,13 L9,22 L14,1 L22,1", 13], "∞": ["M12,14 C9,10 4,10 4,14 C4,18 9,18 12,14 C15,10 20,10 20,14 C20,18 15,18 12,14", 14],
    "•": ["M9,13 L9.6,13.6 M8.6,14 L9.8,12.8", 7], "€": ["M15,5 C13,2 11,1 9,1 C5,1 3,6 3,11.5 C3,17 5,22 9,22 C11,22 13,21 15,18 M1,9 L11,9 M1,14 L10,14", 9],
  };
  const RAISED = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "ⁿ": "n" };
  /* the marks of accented letters (é: e and ´), about the letter's middle mid and its top: [[x, y], …] each */
  const MARKS = {
    "\u0301": (m, t) => [[[m - 1, t - 2], [m + 2, t - 5]]], "\u0300": (m, t) => [[[m - 2, t - 5], [m + 1, t - 2]]], "\u0302": (m, t) => [[[m - 3, t - 2], [m, t - 5], [m + 3, t - 2]]],
    "\u030c": (m, t) => [[[m - 3, t - 5], [m, t - 2], [m + 3, t - 5]]], "\u0303": (m, t) => [[[m - 4, t - 3], [m - 2, t - 5], [m + 1, t - 3], [m + 3, t - 5]]],
    "\u0308": (m, t) => [[[m - 3, t - 3], [m - 2.4, t - 3]], [[m + 2.4, t - 3], [m + 3, t - 3]]], "\u030a": (m, t) => [[[m, t - 6], [m + 1.5, t - 5], [m + 1, t - 3], [m - 1, t - 3], [m - 1.5, t - 5], [m, t - 6]]],
    "\u0327": (m) => [[[m, 21], [m + 1.5, 23], [m - 1, 25]]],
  };
  const ESZETT = ["M4,22 L4,7 C4,3 6,1 9,1 C12,1 13,3 13,5 C13,7 11,9 8,9 C12,9 14,12 14,15 C14,19 12,22 9,22 L7,22", 9];
  const UNIT = 1.68, SPACE = 7; // (the font's: how far o reaches; a space, in its units)
  const fontOf = (style) => (window.MdHershey || {})[style === "script" ? "script" : "hand"];
  /* One letter: its strokes in the font's units (the line it stands on at y 21), and how far the next stands. */
  function letter(font, ch) {
    if (ch === " " || ch === "\t") return { runs: [], adv: SPACE * UNIT };
    if (ch === "ß") return { runs: flatten(ESZETT[0], 0.7), adv: ESZETT[1] * UNIT };
    if (SIGNS[ch]) return { runs: flatten(SIGNS[ch][0], 0.7), adv: SIGNS[ch][1] * UNIT };
    if (RAISED[ch]) { const g = letter(font, RAISED[ch]); return { runs: g.runs.map((r) => r.map(([x, y]) => [x * 0.6, y * 0.6 - 1])), adv: g.adv * 0.65 }; }
    if (DOTS[ch]) {
      const base = letter(font, DOTS[ch]), xs = base.runs.flat().map((p) => p[0]), mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : base.adv / 2, y = DOTS[ch] === DOTS[ch].toUpperCase() ? -3 : 4;
      return { runs: [...base.runs, [[mid - 3, y], [mid - 2.4, y]], [[mid + 2.4, y], [mid + 3, y]]], adv: base.adv };
    }
    // an accented letter: the letter, and its mark above it (or under it, ç) — an i without its dot under its mark
    const parts = ch.normalize("NFD");
    if (parts.length > 1 && /^[A-Za-z]$/.test(parts[0]) && [...parts.slice(1)].every((m) => MARKS[m])) {
      const base = letter(font, parts[0]), runs = parts[0] === "i" || parts[0] === "j" ? base.runs.filter((r) => Math.max(...r.map((p) => p[1])) - Math.min(...r.map((p) => p[1])) > 3) : base.runs;
      const xs = runs.flat().map((p) => p[0]), ys = runs.flat().map((p) => p[1]), mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : base.adv / 2, top = ys.length ? Math.min(...ys) : 8;
      return { runs: [...runs, ...[...parts.slice(1)].flatMap((m) => MARKS[m](mid, top))], adv: base.adv };
    }
    const c = (SAME[ch] || ch).charCodeAt(0), g = font[c - 33];
    if (!g && !(SAME[ch] && SAME[ch].length > 1)) return { runs: [], adv: SPACE * UNIT }; // (what no hand can write here — an emoji —: left out, never a "?")
    if (SAME[ch] && SAME[ch].length > 1) { const parts = [...SAME[ch]].map((x) => letter(font, x)); let at = 0; const runs = []; for (const p of parts) { runs.push(...p.runs.map((r) => r.map(([x, y]) => [x + at, y]))); at += p.adv; } return { runs, adv: at }; }
    return { runs: flatten(g[0], 0.7), adv: g[1] * UNIT };
  }
  /* A slow wandering along s (a stroke's length, a line's width): about −1…1, a few waves of their own each time — what a
   * hand does that no font does. scale: how long one wave is, about. */
  const wander = (scale) => {
    const w = [1, 2, 3].map((i) => ({ f: ((0.6 + Math.random() * 1.2) * i) / scale, p: Math.random() * 6.283, a: 1 / i })), all = w.reduce((a, x) => a + x.a, 0);
    return (s) => w.reduce((a, x) => a + x.a * Math.sin(s * x.f + x.p), 0) / all;
  };
  const shake = (a) => (Math.random() * 2 - 1) * a;
  /* A stroke of the font made as a hand makes it (px, [[x, y]] → [[x, y, p]]): no corner quite sharp, the line wandering a
   * little and trembling less, its ends a touch long or short, its pressure rising as the pen comes down, varying on the way
   * and easing off as it leaves. mess: 0.5 careful … 1 as most write … 1.4 in a hurry. */
  function hand(run, size, mess, ends = true) {
    const len = (pts) => pts.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
    // points every so far along it
    const step = Math.max(0.8, size / 28), even = [run[0]];
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / step));
      for (let k = 1; k <= n; k++) even.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    if (even.length < 2) return even.map((p) => [...p, 0.5]);
    // corners rounded: each point drawn a little toward its neighbours (the ends stay)
    let pts = even;
    for (let pass = 0; pass < 2; pass++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : [(pts[i - 1][0] + 2 * p[0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * p[1] + pts[i + 1][1]) / 4]));
    // a touch long or short at its ends: the pen overshoots, or lifts early
    const L = len(pts), tip = (a, b, by) => { const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [a[0] + ((a[0] - b[0]) / d) * by, a[1] + ((a[1] - b[1]) / d) * by]; };
    if (ends && L > size * 0.3 && pts.length > 3) {
      const end = shake(size * 0.05 * mess);
      if (end > 0) pts.push(tip(pts[pts.length - 1], pts[pts.length - 2], end)); else pts = pts.slice(0, Math.max(2, pts.length - Math.round((-end / L) * pts.length)));
      if (Math.random() < 0.5) { const start = Math.random() * size * 0.03 * mess; pts.unshift(tip(pts[0], pts[1], start)); }
    }
    // it wanders, slowly, and trembles a little; its pressure comes and goes
    const drift = wander(size * 0.9), press = wander(size * 1.4), all = len(pts);
    let s = 0;
    return pts.map((p, i) => {
      if (i) s += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d;
      const off = drift(s) * size * 0.022 * mess + shake(0.1 * mess);
      const down = Math.min(1, s / Math.max(2, size * 0.12)), up = Math.min(1, (all - s) / Math.max(2, size * 0.18));
      const pr = (0.42 + 0.12 * press(s)) * (0.45 + 0.55 * down) * (0.35 + 0.65 * up);
      return [p[0] + nx * off, p[1] + ny * off, Math.max(0.08, Math.min(1, pr))];
    });
  }
  /* o: { x, y (the top of the first line), text, size (a capital's height, px), style "hand" | "script", mess (0.5 careful …
   * 1.4 hurried; 1), maxw (where lines break), tool, c, w } → strokes, all of one writing. Each text is written by a hand of
   * its own: its slant, how wide and how far apart its letters, a line that drifts, words a little larger or smaller. */
  function write(o) {
    const font = fontOf(o.style);
    if (!font || typeof o.text !== "string" || !o.text.trim()) return [];
    const size = Number.isFinite(o.size) ? Math.max(8, Math.min(200, o.size)) : 28, k = size / 21, lead = size * 1.75;
    const mess = Number.isFinite(o.mess) ? Math.max(0.3, Math.min(1.5, o.mess)) : 1;
    const x0 = Number.isFinite(o.x) ? o.x : 0, y0 = Number.isFinite(o.y) ? o.y : 0, maxw = Number.isFinite(o.maxw) && o.maxw > size ? o.maxw : Infinity;
    const script = o.style === "script", slant = script ? 0.02 + Math.random() * 0.06 : 0.03 + Math.random() * 0.13, wide = (script ? 0.92 : 0.8) + Math.random() * 0.12, apart = 0.9 + Math.random() * 0.1;
    const wide1 = (word) => [...word].reduce((a, ch) => a + letter(font, ch).adv, 0) * k * wide * apart;
    // the lines: as written, and broken where a word would go past maxw
    const lines = [];
    for (const para of o.text.slice(0, 4000).split("\n")) {
      let line = "";
      for (const word of para.split(/(?<= )/)) { if (line && wide1(line + word.trimEnd()) > maxw) { lines.push(line.trimEnd()); line = word; } else line += word; }
      lines.push(line.trimEnd());
    }
    const of = B.format.id(), w = Number.isFinite(o.w) ? o.w : Math.max(1.2, Math.min(5, size / 11)), made = [];
    lines.forEach((line, n) => {
      let at = x0 + shake(size * 0.15 * mess) * (n ? 1 : 0); // (a new line begins where the hand comes back to — about)
      const base = wander(size * 7), lean = wander(size * 9), warpX = wander(size * 1.3), warpY = wander(size * 1.1); // (no bow a circle: the line's letters bent, softly, here one way, there another)
      let word = { grow: 1, lift: 0 };
      for (const ch of line) {
        if (ch === " " || at === x0) word = { grow: 1 + shake(0.05 * mess), lift: shake(size * 0.03 * mess) };
        const g = letter(font, ch), grow = word.grow * (1 + shake(0.06 * mess)), across = wide * (1 + shake(0.08 * mess)), tall = 1 + shake(0.08 * mess), skew = shake(0.08 * mess), turn = shake(0.035 * mess);
        const sl = slant + lean(at - x0) * 0.04 * mess, lift = word.lift + base(at - x0) * size * 0.05 * mess + shake(size * 0.02 * mess), cos = Math.cos(turn), sin = Math.sin(turn);
        for (const run of g.runs) {
          let px = run.map(([gx, gy]) => {
            const ly = (gy - 21) * k * grow * tall, lx = gx * k * grow * across - ly * (sl + skew); // (about the letter's foot)
            const x = at + lx * cos - ly * sin, y = y0 + n * lead + size + lift + lx * sin + ly * cos;
            return [x + warpX(x * 0.8 + y * 0.4) * size * 0.04 * mess, y + warpY(x * 0.5 - y * 0.7) * size * 0.035 * mess];
          });
          // (a dot — of an i, a j, an umlaut, a full stop — is a short dash as a pen puts it, not a round)
          const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]), dot = Math.max(...xs) - Math.min(...xs) < size * 0.14 && Math.max(...ys) - Math.min(...ys) < size * 0.14;
          if (dot) { const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, d = size * (0.04 + Math.random() * 0.04), a = -0.5 + shake(0.6); px = [[cx - Math.cos(a) * d, cy - Math.sin(a) * d], [cx + Math.cos(a) * d, cy + Math.sin(a) * d]]; }
          const it = stroke(hand(px, size, dot ? mess * 0.3 : mess), { tool: o.tool || "pen", c: o.c, w });
          it.of = of;
          made.push(it);
        }
        at += g.adv * k * grow * across * apart * (1 + shake(0.07 * mess));
      }
    });
    if (made.length) made[0].said = o.text.slice(0, 400); // (what was written, told back to Claude while the board is open — not kept in the file)
    return made;
  }

  // ---------------------------------------------------------------- the steps, done
  /* A stroke from points [[x, y], …] ([x, y, p] where the pressure is given): pressure as a hand that starts and ends light,
   * time as a hand that moves on evenly. */
  function stroke(pts, o) {
    const tool = INKS.includes(o.tool) ? o.tool : INKS.includes(o.t) ? o.t : "pen", def = B.ink.TOOLS[tool];
    const n = pts.length;
    let t = 0;
    const out = pts.map((p, i) => {
      if (i) t += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) / 1.2; // (1.2 board pixels a millisecond)
      const ends = Math.min(i, n - 1 - i), p0 = Number.isFinite(p[2]) ? p[2] / 0.6 : Math.min(1, 0.35 + ends * 0.08); // (a pressure given: the hand's)
      return [r1(p[0]), r1(p[1]), Math.round(Math.min(1, p0 * 0.6) * 100) / 100, Math.round(t)];
    });
    const it = { id: B.format.id(), k: "ink", t: tool, c: color(o.c, def.c), o: def.o, w: Number.isFinite(o.w) ? Math.max(0.5, Math.min(60, o.w)) : def.w, ch: "xypt", pts: out };
    if (o.sharp === true) it.sharp = true;
    return it;
  }
  /* A step done on the model: → { added: [items], changed: [items], removed: [items] }, or null when it could not be done.
   * names: Claude's own names ("as") → the ids they were given, kept over one answer. */
  function apply(model, step, names = new Map()) {
    const items = model.items, id = (v) => (typeof v === "string" ? names.get(v) || v : null), find = (v) => items.find((it) => it.id === id(v));
    const every = (v) => { const want = id(v), one = items.find((it) => it.id === want); return one ? [one] : items.filter((it) => it.k === "ink" && it.of === want); }; // (words written by hand: all their strokes)
    const ends = (o) => { for (const e of ["from", "to"]) if (o[e] && typeof o[e].id === "string") o[e] = { ...o[e], id: id(o[e].id) }; return o; };
    if (typeof step.add === "string") {
      const k = step.add === "stroke" ? "ink" : step.add, made = [];
      if (k === "write" || k === "hand") {
        made.push(...write(step));
      } else if (k === "ink") {
        const runs = Array.isArray(step.pts) ? [step.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))] : flatten(step.d);
        // (Claude's own strokes, as a pen leaves them: the pressure rising, varying, easing off — and a hand's touch more of
        // wandering where it was asked to write in a hurry; a straight stroke stays straight)
        const pen = (run) => (step.sharp === true || run.length < 2 ? run : hand(run, 30, Number.isFinite(step.mess) ? step.mess * 0.3 : 0.3, false)); // (its ends where Claude put them: an arrow meets its point)
        for (const run of runs) if (run.length > 1 || (run.length === 1 && Array.isArray(step.pts))) made.push(stroke(run.length > 1 ? pen(run) : [run[0], run[0]], step));
      } else {
        const o = { ...step, k, id: B.format.id() };
        delete o.add; delete o.as;
        if (typeof o.size === "number" || typeof o.color === "string" || typeof o.align === "string") o.ts = { ...(o.ts || {}), ...(o.size != null ? { size: o.size } : {}), ...(o.color ? { color: o.color } : {}), ...(o.align ? { align: o.align } : {}) };
        if (k === "line" && o.arrow === true && !o.ends) o.ends = ["none", "arrow"];
        if (k === "line" && typeof o.c === "string" && !o.stroke) o.stroke = { c: o.c, w: o.w };
        if (k === "shape" && typeof o.c === "string" && !o.stroke) o.stroke = { c: o.c, w: Number.isFinite(o.sw) ? o.sw : 2 };
        if (["text", "sticky", "shape"].includes(k)) { const f = B.items.fresh(k, 0, 0, { shape: o.shape }); for (const key of ["w", "h"]) if (!Number.isFinite(o[key])) o[key] = f[key]; if (!Number.isFinite(o.x)) o.x = 0; if (!Number.isFinite(o.y)) o.y = 0; if (k === "shape" && o.fill == null) o.fill = "none"; if (k === "shape" && !o.stroke) o.stroke = { c: "auto", w: 2 }; }
        const it = B.items.norm(ends(o));
        if (it) made.push(it);
      }
      if (!made.length) return null;
      if (typeof step.as === "string" && step.as) names.set(step.as, made[0].of || made[0].id);
      items.push(...made);
      return { added: made, changed: [], removed: [] };
    }
    if (typeof step.del === "string") {
      const gone = every(step.del);
      if (!gone.length) return null;
      model.items = items.filter((x) => !gone.includes(x));
      return { added: [], changed: [], removed: gone };
    }
    if (typeof step.move === "string") {
      const all = every(step.move), dx = Number(step.dx) || 0, dy = Number(step.dy) || 0;
      if (!all.length) return null;
      for (const it of all) { if (it.k === "ink") B.ink.moved(it, (p) => [p[0] + dx, p[1] + dy]); else B.items.moveBy(it, dx, dy); }
      return { added: [], changed: all, removed: [] };
    }
    if (typeof step.set === "string") {
      const all = every(step.set), it = all[0];
      if (!it) return null;
      const more = { ...step };
      delete more.set; delete more.id; delete more.k;
      if (it.k === "ink") {
        for (const x of all) {
          if (more.c != null) x.c = color(more.c, x.c);
          if (Number.isFinite(more.w)) x.w = Math.max(0.5, Math.min(60, more.w));
          if (Number.isFinite(more.o)) x.o = Math.max(0.05, Math.min(1, more.o));
          if (INKS.includes(more.tool)) x.t = more.tool;
          x.path = null; x.box = null;
        }
        return { added: [], changed: all, removed: [] };
      }
      const was = B.items.data(it);
      // (a value of another sort than the one it replaces — a number that is none, a text that is a number — is left out)
      for (const key of Object.keys(more)) if (key in was && typeof was[key] !== "object" && (typeof more[key] !== typeof was[key] || (typeof more[key] === "number" && !Number.isFinite(more[key])))) delete more[key];
      if (typeof more.size === "number" || typeof more.color === "string" || typeof more.align === "string") more.ts = { ...(was.ts || {}), ...(more.ts || {}), ...(more.size != null ? { size: more.size } : {}), ...(more.color ? { color: more.color } : {}), ...(more.align ? { align: more.align } : {}) };
      else if (more.ts) more.ts = { ...(was.ts || {}), ...more.ts };
      if (more.stroke) more.stroke = { ...(was.stroke || {}), ...more.stroke };
      const now = B.items.norm(ends({ ...was, ...more, id: it.id, k: it.k }));
      if (!now) return null;
      for (const key of Object.keys(it)) delete it[key];
      Object.assign(it, now);
      return { added: [], changed: [it], removed: [] };
    }
    return null;
  }

  B.claude = { describe, lineOf, reader, words, flatten, stroke, write, apply, letter: (ch, style) => letter(fontOf(style), ch) };
})();
