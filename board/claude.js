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
      out.push(o.paper ? `The board is a notebook of ${n} of ${o.paper.bg === "blank" ? "blank" : o.paper.bg} paper (${o.paper.color}), A4, one under the other; write and draw on the pages, within their margins, as on paper; what goes on below the last page gets pages of its own — write on, page after page, as long as the content needs. Each page as a box on the board (x, y, width, height):`
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
    // (the signs of mathematics, and the Greek letters — #37: left out, they were gaps in the middle of a formula)
    "·": ["M5,13 L5.6,13.6 M4.6,14 L5.8,12.8", 6], "×": ["M5,8 L17,20 M17,8 L5,20", 12], "−": ["M4,14 L20,14", 13],
    "∈": ["M17,6 L11,6 C7,6 4,9 4,13 C4,17 7,20 11,20 L17,20 M4,13 L15,13", 11], "∉": ["M17,6 L11,6 C7,6 4,9 4,13 C4,17 7,20 11,20 L17,20 M4,13 L15,13 M14,3 L8,23", 11],
    "∀": ["M3,1 L10,22 L17,1 M6,11 L14,11", 11], "∃": ["M4,1 L16,1 L16,22 L4,22 M7,11.5 L16,11.5", 11], "∫": ["M15,-1 C13,-2 11,-1 10,2 L8,25 C7,28 5,29 3,28", 9],
    "∑": ["M16,1 L4,1 L11,11.5 L4,22 L16,22", 11], "∏": ["M4,22 L4,1 L16,1 L16,22", 11], "∂": ["M6,4 C8,2 10,1 12,1 C15,1 17,4 17,9 C17,16 14,22 9,22 C6,22 4,20 4,17 C4,13 7,11 10,11 C13,11 15,12 17,14", 11],
    "∇": ["M2,1 L18,1 L10,22 L2,1", 11], "⊂": ["M17,5 L11,5 C7,5 4,8 4,12.5 C4,17 7,20 11,20 L17,20", 11], "⊆": ["M17,3 L11,3 C7,3 4,6 4,10 C4,14 7,17 11,17 L17,17 M4,22 L17,22", 11],
    "∪": ["M4,5 L4,13 C4,18 7,21 10.5,21 C14,21 17,18 17,13 L17,5", 11], "∩": ["M4,21 L4,13 C4,8 7,5 10.5,5 C14,5 17,8 17,13 L17,21", 11],
    "∧": ["M3,21 L10,5 L17,21", 11], "∨": ["M3,5 L10,21 L17,5", 11], "¬": ["M3,11 L17,11 L17,16", 11], "≡": ["M3,8 L21,8 M3,14 L21,14 M3,20 L21,20", 13],
    "∝": ["M19,9 C16,9 14,11 12,14 C10,17 8,19 6,19 C4,19 3,17 3,14 C3,11 4,9 6,9 C8,9 10,11 12,14 C14,17 16,19 19,19", 12],
    "ℝ": ["M4,22 L4,1 L11,1 C14,1 16,3 16,6 C16,9 14,11 11,11 L4,11 M11,11 L16,22 M7,1 L7,22", 11], "ℕ": ["M4,22 L4,1 L16,22 L16,1 M7,6 L7,22", 11],
    "ℤ": ["M4,1 L16,1 L4,22 L16,22 M12.5,1 L1,22", 11], "ℚ": ["M10,1 C5,1 3,6 3,11.5 C3,17 5,22 10,22 C15,22 17,17 17,11.5 C17,6 15,1 10,1 M12,18 L17,24 M6,3 L6,20", 11],
    "ℂ": ["M16,4 C14,2 12,1 10,1 C5,1 3,6 3,11.5 C3,17 5,22 10,22 C12,22 14,21 16,19 M6,3 L6,20", 10], "½": ["M3,4 L5,3 L5,10 M14,2 L5,22 M13,15 C13,13 18,13 18,15 C18,17 13,20 13,22 L18,22", 12],
    "α": ["M17,8 C15,16 14,20 18,22 M16,12 C14,8 10,8 7,9 C4,11 3,15 4,19 C5,22 9,22 11,21 C13,19 15,16 16,12", 11], "β": ["M5,28 L5,6 C5,2 8,1 10,1 C13,1 14,3 14,5 C14,8 12,10 9,10 C13,10 16,12 16,16 C16,20 13,22 10,22 C8,22 6,21 5,19", 10],
    "γ": ["M3,9 C5,8 7,9 8,12 L10,22 L10,28 M16,8 L10,22", 10], "δ": ["M13,2 C10,1 7,2 7,4 C7,6 10,8 13,10 C16,12 17,15 16,18 C15,21 12,22 10,22 C7,22 4,20 4,16 C4,12 7,10 11,9", 10],
    "ε": ["M15,9 C13,8 9,8 7,9 C5,10 5,14 9,15 L12,15 M9,15 C5,15 4,18 5,20 C6,22 10,22 15,21", 10], "ζ": ["M6,1 L15,1 C9,6 4,11 4,16 C4,20 8,21 12,22 C14,23 14,26 12,28", 10],
    "η": ["M4,9 C5,8 6,9 6,11 L6,22 M6,13 C8,9 11,8 13,8 C15,8 16,10 16,13 L16,28", 11], "θ": ["M10,1 C6,1 4,6 4,11.5 C4,17 6,22 10,22 C14,22 16,17 16,11.5 C16,6 14,1 10,1 M4,11.5 L16,11.5", 10],
    "ι": ["M7,8 L7,19 C7,21 8,22 10,21", 6], "κ": ["M5,8 L5,22 M15,8 L5,16 M8,14 L15,22", 10], "λ": ["M4,1 C7,1 8,3 9,6 L15,22 M10,10 L4,22", 10],
    "μ": ["M5,8 L5,28 M5,17 C5,21 8,22 10,22 C13,22 15,19 15,16 M15,8 L15,19 C15,21 16,22 18,21", 11], "ν": ["M4,8 L9,22 C12,18 15,13 15,8", 10],
    "ξ": ["M7,1 L14,1 M13,1 C8,1 6,3 6,5 C6,7 9,8 12,8 C7,8 4,10 4,14 C4,18 8,19 11,20 C13,21 13,25 11,28", 10], "π": ["M3,10 C5,8 8,8 10,8 L18,8 M7,8 L6,22 M14,8 L14,20 C14,21 15,22 17,21", 11],
    "ρ": ["M5,28 L5,15 C5,11 7,8 10,8 C13,8 15,11 15,15 C15,19 13,22 10,22 C7,22 5,20 5,18", 10], "σ": ["M17,8 L10,8 C6,8 4,11 4,15 C4,19 6,22 9,22 C12,22 14,19 14,15 C14,11 12,9 10,8", 10],
    "τ": ["M3,9 C4,8 6,8 8,8 L16,8 M10,8 L10,20 C10,21 11,22 13,21", 10], "υ": ["M4,9 C5,8 6,9 6,11 L6,17 C6,20 8,22 10,22 C13,22 15,18 15,13 C15,10 14,8 13,8", 10],
    "φ": ["M10,4 L10,28 M10,8 C6,8 4,11 4,15 C4,19 7,22 10,22 C13,22 16,19 16,15 C16,11 14,8 10,8", 10], "χ": ["M4,8 C6,8 7,10 8,13 L12,22 C13,25 14,28 16,28 M15,8 L5,28", 10],
    "ψ": ["M10,1 L10,28 M3,9 C4,8 5,9 5,11 L5,15 C5,19 7,22 10,22 C13,22 15,19 15,15 L15,8", 10], "ω": ["M6,8 C4,10 3,13 3,16 C3,20 5,22 7,22 C9,22 10,20 10,17 L10,14 M10,17 C10,20 11,22 13,22 C15,22 17,20 17,16 C17,13 16,10 14,8", 11],
    "Γ": ["M5,22 L5,1 L17,1", 10], "Δ": ["M10,1 L2,22 L18,22 L10,1", 11], "Θ": ["M10,1 C5,1 3,6 3,11.5 C3,17 5,22 10,22 C15,22 17,17 17,11.5 C17,6 15,1 10,1 M7,11.5 L13,11.5", 11],
    "Λ": ["M2,22 L10,1 L18,22", 11], "Ξ": ["M4,1 L16,1 M6,11 L14,11 M4,22 L16,22", 11], "Π": ["M4,22 L4,1 L16,1 L16,22", 11], "Σ": ["M16,1 L4,1 L11,11.5 L4,22 L16,22", 11],
    "Φ": ["M10,1 L10,22 M10,5 C5,5 3,8 3,11.5 C3,15 5,18 10,18 C15,18 17,15 17,11.5 C17,8 15,5 10,5", 11], "Ψ": ["M10,1 L10,22 M3,5 L3,10 C3,14 6,16 10,16 C14,16 17,14 17,10 L17,5", 11],
    "Ω": ["M3,22 L7,22 C4,19 3,16 3,12 C3,6 6,1 10,1 C14,1 17,6 17,12 C17,16 16,19 13,22 L17,22", 11],
    "•": ["M9,13 L9.6,13.6 M8.6,14 L9.8,12.8", 7], "€": ["M15,5 C13,2 11,1 9,1 C5,1 3,6 3,11.5 C3,17 5,22 9,22 C11,22 13,21 15,18 M1,9 L11,9 M1,14 L10,14", 9],
  };
  const RAISED = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁺": "+", "⁻": "-", "ⁿ": "n", "ⁱ": "i", "ˣ": "x" };
  const LOWERED = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9", "₊": "+", "₋": "-", "ₙ": "n", "ᵢ": "i", "ⱼ": "j", "ₖ": "k", "ₓ": "x" };
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
    const own = B.glyphs && (B.glyphs[font === fontOf("script") ? "script" : "hand"] || {})[ch]; // (passed in the Hand Lab: board/glyphs.js)
    if (own) return { runs: flatten(own[0], 0.7), adv: own[1] * UNIT };
    if (ch === "ß") return { runs: flatten(ESZETT[0], 0.7), adv: ESZETT[1] * UNIT };
    if (SIGNS[ch]) return { runs: flatten(SIGNS[ch][0], 0.7), adv: SIGNS[ch][1] * UNIT };
    if (RAISED[ch]) { const g = letter(font, RAISED[ch]); return { runs: g.runs.map((r) => r.map(([x, y]) => [x * 0.6, y * 0.6 - 1])), adv: g.adv * 0.65 }; }
    if (LOWERED[ch]) { const g = letter(font, LOWERED[ch]); return { runs: g.runs.map((r) => r.map(([x, y]) => [x * 0.6, y * 0.6 + 11])), adv: g.adv * 0.65 }; }
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
  // ---------------------------------------------------------------- formulas, as a hand sets them (#36)
  /* A formula in LaTeX ($…$ in what is written) laid out as a person writes it on paper: a fraction's parts one over the other
   * with a bar between, exponents raised and smaller, indices lowered, a root's sign over what it holds, brackets as tall as
   * what they hold — never as typed (Henri, 2026-11-02, of "1/(5z^4)": "das will ich NIE WIEDER SEHEN"). */
  const TEX = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "θ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ",
    pi: "π", rho: "ρ", varrho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
    cdot: "·", times: "×", pm: "±", div: "÷", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", propto: "∝", infty: "∞",
    to: "→", rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", implies: "⇒", Leftarrow: "⇐", leftrightarrow: "↔", Leftrightarrow: "↔", iff: "↔", mapsto: "→",
    in: "∈", notin: "∉", forall: "∀", exists: "∃", int: "∫", sum: "∑", prod: "∏", partial: "∂", nabla: "∇", subset: "⊂", subseteq: "⊆", cup: "∪", cap: "∩",
    land: "∧", wedge: "∧", lor: "∨", vee: "∨", neg: "¬", lnot: "¬", circ: "°", degree: "°", ldots: "…", dots: "…", cdots: "…", lbrace: "{", rbrace: "}",
    "{": "{", "}": "}", "|": "|", "%": "%", "$": "$", "&": "&", "#": "#", "_": "_", langle: "<", rangle: ">", vert: "|", mid: "|",
    quad: " ", qquad: "  ", ",": " ", ";": " ", ":": " ", " ": " ", "!": "", displaystyle: "", limits: "", nolimits: "", backslash: "\\" };
  const FN = new Set(["sin", "cos", "tan", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "arg", "mod", "Re", "Im"]);
  const BB = { R: "ℝ", N: "ℕ", Z: "ℤ", Q: "ℚ", C: "ℂ" };
  const OPS = new Set([..."=+−<>≤≥≠≈≡∝→←⇒⇐↔∈∉⊂⊆∪∩∧∨±×÷"]); // (room on either side, as a hand leaves it)
  /* LaTeX → atoms: { k: "ch", ch } | { k: "row", items } | { k: "frac", num, den } | { k: "sqrt", arg, n }, each with sup and sub. */
  function texParse(src) {
    const s = String(src);
    let i = 0;
    const skip = () => { while (s[i] === " ") i++; };
    const raw = () => { skip(); if (s[i] !== "{") return s[i++] || ""; let d = 0, j = i; for (; j < s.length; j++) { if (s[j] === "{") d++; else if (s[j] === "}" && !--d) break; } const t = s.slice(i + 1, j); i = j + 1; return t; };
    const arg = () => { skip(); if (s[i] === "{") { i++; const r = row("}"); i++; return r; } return row(null, true); };
    const word = (t) => ({ k: "row", items: [...t].map((ch) => ({ k: "ch", ch })) });
    function command() {
      let j = i + 1;
      if (/[A-Za-z]/.test(s[j] || "")) while (/[A-Za-z]/.test(s[j] || "")) j++; else j++;
      const name = s.slice(i + 1, j);
      i = j;
      if (name === "frac" || name === "dfrac" || name === "tfrac" || name === "cfrac") return { k: "frac", num: arg(), den: arg() };
      if (name === "sqrt") { let n = null; skip(); if (s[i] === "[") { const e = s.indexOf("]", i); n = e > i ? s.slice(i + 1, e) : null; i = e > i ? e + 1 : i + 1; } return { k: "sqrt", arg: arg(), n }; }
      if (/^(left|right|big|Big|bigg|Bigg)[lr]?$/.test(name)) { skip(); if (s[i] === "\\") { const d = command(); return d && d.k === "ch" ? d : null; } const d = s[i++]; return d && d !== "." ? { k: "ch", ch: d } : null; }
      if (["text", "textrm", "mathrm", "operatorname", "mathit", "mathbf", "textbf", "boldsymbol", "mathsf", "mbox"].includes(name)) return word(raw());
      if (name === "mathbb") return word([...raw()].map((ch) => BB[ch] || ch).join(""));
      if (FN.has(name)) { const f = word(name); f.items.unshift({ k: "gap", w: 4 }); f.items.push({ k: "gap", w: 5 }); return f; } // (2x cos t, not 2xcost)
      if (name in TEX) return TEX[name] ? { k: "ch", ch: TEX[name] } : null;
      return word(name); // (a command it does not know: its name, as a hand would write it)
    }
    function row(end, one = false) {
      const out = [];
      while (i < s.length) {
        const c = s[i];
        if (c === "}") { if (end) break; i++; continue; }
        if (c === " ") { i++; continue; }
        let atom = null;
        if (c === "^" || c === "_") {
          i++;
          const key = c === "^" ? "sup" : "sub", sc = arg();
          let last = out[out.length - 1];
          if (!last || last[key]) { last = { k: "row", items: [] }; out.push(last); }
          last[key] = sc;
          if (one) return out;
          continue;
        }
        if (c === "{") { i++; atom = { k: "row", items: row("}") }; i++; }
        else if (c === "\\") atom = command();
        else { i++; atom = { k: "ch", ch: c === "-" ? "−" : c === "*" ? "·" : c === "'" ? "′" : c }; }
        if (atom) out.push(atom);
        if (one && atom) return out;
      }
      return out;
    }
    return row(null);
  }
  /* Atoms laid out in the font's units about their baseline (y 0, upward negative): { runs, w, top, bot, ch }. */
  function texBox(font, atoms) {
    const put = (into, b, dx, dy) => { for (const r of b.runs) into.push(r.map(([x, y]) => [x + dx, y + dy])); };
    const scaled = (b, f) => ({ runs: b.runs.map((r) => r.map(([x, y]) => [x * f, y * f])), w: b.w * f, top: b.top * f, bot: b.bot * f, ch: b.ch });
    const glyph = (ch) => {
      const g = letter(font, ch === "′" ? "'" : ch), runs = g.runs.map((r) => r.map(([x, y]) => [x, y - 21])), ys = runs.flat().map((p) => p[1]);
      return { runs, w: g.adv, top: ys.length ? Math.min(-13, ...ys) : -13, bot: ys.length ? Math.max(0, ...ys) : 0, ch };
    };
    const stretch = (d, top, bot) => { // (a bracket as tall as what it holds)
      const ys = d.runs.flat().map((p) => p[1]), t = Math.min(...ys), b = Math.max(...ys), f = (bot - top) / (b - t || 1);
      d.runs = d.runs.map((r) => r.map(([x, y]) => [x, top + (y - t) * f]));
      d.top = top; d.bot = bot;
    };
    function row(items) {
      const parts = items.map(atom);
      const pair = { "(": ")", "[": "]", "{": "}", "|": "|" };
      for (let a = 0; a < parts.length; a++) {
        const close = pair[parts[a].ch];
        if (!close) continue;
        let depth = 0, z = a + 1;
        for (; z < parts.length; z++) { if (parts[z].ch === parts[a].ch && close !== parts[a].ch) depth++; else if (parts[z].ch === close) { if (!depth) break; depth--; } }
        if (z >= parts.length || z === a + 1) continue;
        const inner = parts.slice(a + 1, z), t = Math.min(...inner.map((p) => p.top)), b = Math.max(...inner.map((p) => p.bot));
        if (t < -22 || b > 7) { stretch(parts[a], t - 2, b + 2); stretch(parts[z], t - 2, b + 2); }
      }
      const runs = [];
      let x = 0, top = -13, bot = 0;
      parts.forEach((p, n) => {
        const op = OPS.has(p.ch) && n > 0 && n < parts.length - 1;
        if (op) x += 5;
        put(runs, p, x, 0);
        x += p.w + (op ? 5 : 0);
        top = Math.min(top, p.top); bot = Math.max(bot, p.bot);
      });
      return { runs, w: x, top, bot, ch: parts.length === 1 ? parts[0].ch : null };
    }
    function atom(a) {
      let b;
      if (a.k === "ch") b = glyph(a.ch);
      else if (a.k === "gap") b = { runs: [], w: a.w, top: -13, bot: 0, ch: null };
      else if (a.k === "frac") {
        const n = scaled(row(a.num.items || a.num), 0.88), d = scaled(row(a.den.items || a.den), 0.88), w = Math.max(n.w, d.w) + 8, axis = -8, runs = [];
        const ny = axis - 5 - n.bot, dy = axis + 5 - d.top;
        put(runs, n, 3 + (w - n.w) / 2, ny); put(runs, d, 3 + (w - d.w) / 2, dy);
        runs.push([[3, axis], [3 + w, axis]]);
        b = { runs, w: w + 6, top: ny + n.top, bot: dy + d.bot, ch: null };
      } else if (a.k === "sqrt") {
        const x = row(a.arg.items || a.arg), top = x.top - 3, runs = [[[0, -7], [3, -9], [7, x.bot + 1], [11, top], [15 + x.w, top]]];
        put(runs, x, 13, 0);
        if (a.n) { const nb = scaled(row(texParse(a.n)), 0.5); put(runs, nb, 0, -10); }
        b = { runs, w: x.w + 17, top: top - 1, bot: x.bot + 1, ch: null };
      } else b = row(a.items || []);
      if (a.sup || a.sub) {
        const runs = [...b.runs], end = b.w;
        let w = b.w, top = b.top, bot = b.bot;
        if (a.sup) { const s = scaled(row(a.sup), 0.62), y = Math.min(-10, b.top + 8); put(runs, s, end + 1, y); w = Math.max(w, end + 1 + s.w); top = Math.min(top, y + s.top); }
        if (a.sub) { const s = scaled(row(a.sub), 0.62), y = Math.max(5, b.bot + 3); put(runs, s, end + 1, y); w = Math.max(w, end + 1 + s.w); bot = Math.max(bot, y + s.bot); }
        b = { runs, w: w + 1, top, bot, ch: null };
      }
      return b;
    }
    return row(atoms);
  }
  /* A formula as one letter is: { runs, adv, top, bot } in the font's units, the line at y 21. */
  function formula(font, tex) {
    const b = texBox(font, texParse(tex));
    return { runs: b.runs.map((r) => r.map(([x, y]) => [x + 2, y + 21])), adv: b.w + 4, top: b.top + 21, bot: b.bot + 21 };
  }
  /* What is written, in units: a letter, or a formula ($…$). A ^ or _ that stands in plain words is made what it means — what
   * follows it raised or lowered —, never written as a sign (#36). */
  function units(text) {
    const out = [];
    for (const part of String(text).split(/(\$[^$]+\$)/)) {
      if (/^\$[^$]+\$$/.test(part)) { out.push({ tex: part.slice(1, -1) }); continue; }
      const plain = part.replace(/(?<=\S)([\^_])(\{[^}]*\}|[−+-]?[A-Za-z0-9]+)/g, (m, c, v) => `\u0000${c}{${v.replace(/^\{|\}$/g, "")}}\u0000`);
      for (const bit of plain.split(/(\u0000[^\u0000]*\u0000)/)) {
        if (bit.startsWith("\u0000")) out.push({ tex: bit.slice(1, -1) });
        else for (const ch of bit) out.push({ ch });
      }
    }
    return out;
  }
  /* A slow wandering along s (a stroke's length, a line's width): about −1…1, a few waves of their own each time — what a
   * hand does that no font does. scale: how long one wave is, about. */
  const wander = (scale) => {
    const w = [1, 2, 3].map((i) => ({ f: ((0.6 + Math.random() * 1.2) * i) / scale, p: Math.random() * 6.283, a: 1 / i })), all = w.reduce((a, x) => a + x.a, 0);
    return (s) => w.reduce((a, x) => a + x.a * Math.sin(s * x.f + x.p), 0) / all;
  };
  const shake = (a) => (Math.random() * 2 - 1) * a;
  /* A stroke of the font written by the hand (board/hand.js): what is kept of the font's line is where the hand means to go,
   * and it moves there as a hand moves — curves, corners, speed and pressure come of the movement (px, [[x, y]] → [[x, y, p]]).
   * mess: 0.5 careful … 1 as most write … 1.4 in a hurry; ends: false where the stroke must end where it was put (an arrow
   * meets its point); round: 1 for writing, less for a drawing's corners. */
  function hand(run, size, mess, ends = true, round = 1, style = "hand") {
    return B.hand.write(run, { size, mess, ends, round, style, wander: wander(size * 1.4) });
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
    const st = B.hand.styleOf(o.style === "script" ? "script" : "hand"), wob = st.wobble, dri = st.drift; // (the style's numbers: board/hand.js)
    const slant = st.slant + shake(st.slantVar), wide = st.wide + shake(0.06), apart = st.apart + shake(0.05);
    const glyphOf = (u) => (u.tex != null ? formula(font, u.tex) : letter(font, u.ch));
    const wide1 = (text) => units(text).reduce((a, u) => a + glyphOf(u).adv, 0) * k * wide * apart;
    // the lines: as written, and broken where a word would go past maxw (never inside a formula)
    const lines = [];
    for (const para of o.text.slice(0, 4000).split("\n")) {
      let line = "";
      const words = para.replace(/\$[^$]+\$/g, (m) => m.replace(/ /g, "\u0001")).split(/(?<= )/).map((x) => x.replace(/\u0001/g, " "));
      for (const word of words) { if (line && wide1(line + word.trimEnd()) > maxw) { lines.push(line.trimEnd()); line = word; } else line += word; }
      lines.push(line.trimEnd());
    }
    // (a line with a fraction in it stands taller: the lines after it further down)
    let extra = 0;
    const tops = lines.map((line) => { const fs = units(line).filter((u) => u.tex != null).map((u) => formula(font, u.tex)), up = Math.max(0, 1 - Math.min(1, ...fs.map((f) => f.top))) * k, down = Math.max(0, Math.max(28, ...fs.map((f) => f.bot)) - 28) * k; const at = extra + up; extra += up + down; return at; });
    const of = B.format.id(), w = Number.isFinite(o.w) ? o.w : Math.max(1.2, Math.min(6, size * B.hand.styleOf(o.style === "script" ? "script" : "hand").pen)), made = [], inLine = [];
    lines.forEach((line, n) => {
      let at = x0 + shake(size * 0.15 * mess) * (n ? 1 : 0); // (a new line begins where the hand comes back to — about)
      const base = wander(size * 7), lean = wander(size * 9), warpX = wander(size * 1.3), warpY = wander(size * 1.1); // (no bow a circle: the line's letters bent, softly, here one way, there another)
      let word = { grow: 1, lift: 0 };
      for (const u of units(line)) {
        if (u.ch === " " || at === x0) word = { grow: 1 + shake(0.05 * mess), lift: shake(size * 0.03 * mess) };
        // (a formula is one unit, as long as many letters: its size, its turn and the room after it are a hand's over a whole word,
        // not a letter's — a letter's chance on its width put what follows into its end)
        const g = glyphOf(u), f = u.tex != null ? 0.25 : 1, grow = word.grow * (1 + shake(0.06 * mess * f * wob)), across = wide * (1 + shake(0.08 * mess * f * wob)), tall = 1 + shake(0.08 * mess * f * wob), skew = shake(0.08 * mess * f * wob), turn = shake(0.035 * mess * f * wob);
        const sl = slant + lean(at - x0) * 0.04 * mess * dri, lift = word.lift + base(at - x0) * size * 0.05 * mess * dri + shake(size * 0.02 * mess * wob), cos = Math.cos(turn), sin = Math.sin(turn);
        for (const run of g.runs) {
          let px = run.map(([gx, gy]) => {
            const ly = (gy - 21) * k * grow * tall, lx = gx * k * grow * across - ly * (sl + skew); // (about the letter's foot)
            const x = at + lx * cos - ly * sin, y = y0 + n * lead + tops[n] + size + lift + lx * sin + ly * cos;
            return [x + warpX(x * 0.8 + y * 0.4) * size * 0.04 * mess * dri, y + warpY(x * 0.5 - y * 0.7) * size * 0.035 * mess * dri];
          });
          // (a dot — of an i, a j, an umlaut, a full stop — is a short dash as a pen puts it, not a round)
          const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]), dot = Math.max(...xs) - Math.min(...xs) < size * 0.14 && Math.max(...ys) - Math.min(...ys) < size * 0.14;
          if (dot) { const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2, d = size * (0.04 + Math.random() * 0.04), a = -0.5 + shake(0.6); px = [[cx - Math.cos(a) * d, cy - Math.sin(a) * d], [cx + Math.cos(a) * d, cy + Math.sin(a) * d]]; }
          const it = stroke(hand(px, size, dot ? mess * 0.3 : mess, true, 1, o.style === "script" ? "script" : "hand"), { tool: o.tool || "pen", c: o.c, w });
          it.of = of;
          made.push(it);
          if (u.tex != null) (inLine[n] = inLine[n] || []).push(it);
        }
        at += g.adv * k * grow * across * (u.tex != null ? 1 : apart * (1 + shake(0.07 * mess)));
      }
    });
    // (where a line's formulas reach above and below it: apply keeps an underline out of a fraction)
    made.rows = inLine.map((its, n) => { if (!its) return null; const bs = its.map((it) => B.format.boundsOf(it)); return { x0: Math.min(...bs.map((b) => b[0])), x1: Math.max(...bs.map((b) => b[2])), base: y0 + n * lead + tops[n] + size, bot: Math.max(...bs.map((b) => b[3])), size }; }).filter(Boolean);
    if (made.length) made[0].said = o.text.slice(0, 400); // (what was written, told back to Claude while the board is open — not kept in the file)
    return made;
  }

  // ---------------------------------------------------------------- the steps, done
  /* A stroke from points [[x, y], …] ([x, y, p] where the pressure is given): pressure as a hand that starts and ends light,
   * time as a hand that moves on evenly (or as the hand moved: [x, y, p, ms]). */
  function stroke(pts, o) {
    const tool = INKS.includes(o.tool) ? o.tool : INKS.includes(o.t) ? o.t : "pen", def = B.ink.TOOLS[tool];
    const n = pts.length;
    let t = 0;
    const out = pts.map((p, i) => {
      if (Number.isFinite(p[3])) t = p[3]; // (the hand's own time: board/hand.js)
      else if (i) t += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) / 1.2; // (1.2 board pixels a millisecond)
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
        const w = write(step);
        made.push(...w);
        if (w.rows.length) names.set("\u0000rows", [...(names.get("\u0000rows") || []), ...w.rows]);
      } else if (k === "ink") {
        const runs = Array.isArray(step.pts) ? [step.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))] : flatten(step.d);
        // (Claude's own strokes, as a pen leaves them: the pressure rising, varying, easing off — and a hand's touch more of
        // wandering where it was asked to write in a hurry; a straight stroke stays straight)
        const pen = (run) => (step.sharp === true || run.length < 2 ? run : hand(run, 30, Number.isFinite(step.mess) ? step.mess * 0.3 : 0.3, false, 0.45)); // (its ends where Claude put them: an arrow meets its point)
        for (const run of runs) if (run.length > 1 || (run.length === 1 && Array.isArray(step.pts))) made.push(stroke(run.length > 1 ? pen(run) : [run[0], run[0]], step));
        // (an underline Claude put where a line of words would end, under a line with a fraction: under the fraction, not through it —
        // Claude cannot know how far a formula reaches; #36)
        for (const it of made) {
          const b = B.format.boundsOf(it);
          if (!b || b[3] - b[1] > 10 || b[2] - b[0] < 30) continue;
          const row = (names.get("\u0000rows") || []).find((r) => Math.min(r.x1, b[2]) - Math.max(r.x0, b[0]) > 10 && (b[1] + b[3]) / 2 > r.base - r.size * 0.3 && (b[1] + b[3]) / 2 < r.bot + 2);
          if (row) { const dy = row.bot + row.size * 0.3 - (b[1] + b[3]) / 2; B.ink.moved(it, (p) => [p[0], p[1] + dy]); }
        }
        // (the strokes of one step — a word Claude wrote itself, a drawing's part — are one thing to it: told once, taken away at once, #33)
        if (made.length > 1) { const of = B.format.id(); for (const it of made) it.of = of; }
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
    if (typeof step.del === "string" || Array.isArray(step.del)) { // (several at once: one step, gone together — #33)
      const gone = [...new Set((Array.isArray(step.del) ? step.del : [step.del]).flatMap((v) => every(v)))];
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

  // ---------------------------------------------------------------- Improve: strokes chosen, made a little neater
  /* What is chosen and nothing else goes to Claude. What it reads as written it tells back letter by letter — which strokes
   * each letter is —, and the app sets the letters straight itself, keeping their shapes (line): traced over by Claude an
   * ugly hand stayed ugly, written anew in the app's hand it no longer looked human (Henri, 2026-11-02). What is drawn comes
   * back drawn anew clean (redraw), or moved, scaled, turned (fit). The hand's own tremble is smoothed here at once,
   * before Claude has said anything. */

  /* A stroke's points smoothed: twice, each point a little toward its neighbours, but never farther than most from where
   * the hand put it — the tremble goes, a letter's corners stay. The ends stay, and the pressure and time. */
  function smooth(pts, most = 1) {
    if (pts.length < 4) return pts;
    let now = pts;
    for (let pass = 0; pass < 2; pass++) now = now.map((p, i) => (i === 0 || i === now.length - 1 ? p : [(now[i - 1][0] + 2 * p[0] + now[i + 1][0]) / 4, (now[i - 1][1] + 2 * p[1] + now[i + 1][1]) / 4, ...p.slice(2)]));
    return now.map((p, i) => {
      const o = pts[i], dx = p[0] - o[0], dy = p[1] - o[1], d = Math.hypot(dx, dy), k = d > most ? most / d : 1;
      return [r1(o[0] + dx * k), r1(o[1] + dy * k), ...o.slice(2)];
    });
  }
  /* The points that carry a line's shape: those farther than eps from the line between their neighbours (Ramer, Douglas, Peucker). */
  function simplify(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length), todo = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (todo.length) {
      const [a, b] = todo.pop(), dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1], len = Math.hypot(dx, dy);
      let far = -1, most = eps;
      for (let i = a + 1; i < b; i++) {
        const d = len ? Math.abs((pts[i][0] - pts[a][0]) * dy - (pts[i][1] - pts[a][1]) * dx) / len : Math.hypot(pts[i][0] - pts[a][0], pts[i][1] - pts[a][1]);
        if (d > most) { most = d; far = i; }
      }
      if (far >= 0) { keep[far] = 1; todo.push([a, far], [far, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  /* The strokes chosen, as Claude is told them: from the top left of the box round them all (small numbers are quick to
   * read and to write), in the order they were drawn, each its id, box and path in whole pixels.
   * → { text, origin: [x, y], size: [w, h] }, or null when no stroke is chosen. */
  function tellPick(inks) {
    if (!inks.length) return null;
    const boxes = inks.map((it) => B.format.boundsOf(it)), x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
    const w = Math.max(...boxes.map((b) => b[2])) - x0, h = Math.max(...boxes.map((b) => b[3])) - y0, at = (v, o) => Math.round(v - o);
    const lines = inks.map((it, i) => {
      const b = boxes[i], pts = simplify(it.pts, Math.max(0.5, it.w * 0.2));
      const d = pts.map((p, n) => `${n ? "L" : "M"}${at(p[0], x0)} ${at(p[1], y0)}`).join(" ");
      return JSON.stringify({ id: it.id, tool: it.t, w: it.w, box: [at(b[0], x0), at(b[1], y0), Math.round(b[2] - b[0]), Math.round(b[3] - b[1])], d });
    });
    return { text: `${inks.length} stroke${inks.length === 1 ? "" : "s"} in a box of ${Math.round(w)} × ${Math.round(h)}:\n${lines.join("\n")}`, origin: [x0, y0], size: [w, h] };
  }
  /* A stroke as a calmer hand draws it: its shape in the few points that carry it (eps), and a smooth curve through them
   * (Catmull-Rom), a point every two pixels — each with the pressure and time of the point it was drawn with there. */
  function calm(pts, eps) {
    if (pts.length < 3) return pts;
    const key = simplify(pts, eps), out = [];
    for (let i = 0; i < key.length - 1; i++) {
      const a = key[i - 1] || key[i], b = key[i], c = key[i + 1], d = key[i + 2] || c, n = Math.max(1, Math.round(Math.hypot(c[0] - b[0], c[1] - b[1]) / 2));
      for (let k = 0; k < n; k++) {
        const t = k / n, f = (p, q, r, s) => 0.5 * (2 * q + (r - p) * t + (2 * p - 5 * q + 4 * r - s) * t * t + (3 * q - p - 3 * r + s) * t * t * t);
        out.push([f(a[0], b[0], c[0], d[0]), f(a[1], b[1], c[1], d[1])]);
      }
    }
    out.push(key[key.length - 1]);
    return out.map((p, i) => [r1(p[0]), r1(p[1]), ...pts[Math.round((i * (pts.length - 1)) / Math.max(1, out.length - 1))].slice(2)]);
  }
  /* A line of handwriting set straight, its letters the user's own: each letter (the strokes Claude says it is made of) brought
   * most of the way to the line's baseline and to the height of its kind — capitals and tall letters, small letters, letters
   * that reach below —, the room between letters and between words most of the way to even, and every stroke drawn calmer.
   * step: {"line":"Hallo","base":150,"cap":110,"xh":60,"letters":[["H",["id",…]],["a",["id"]],…]} */
  const BY = 0.8; // (how far of the way: the rest is the hand's own, and keeps it a hand's)
  function line(model, step, strokes, origin) {
    const seen = new Set(), groups = [];
    for (const [ch, ids] of step.letters.filter(Array.isArray)) {
      const its = strokes(ids).filter((it) => !seen.has(it));
      its.forEach((it) => seen.add(it));
      if (its.length) groups.push({ ch: String(ch || ""), its });
    }
    if (!groups.length) return null;
    const box = (its) => { const xs = its.flatMap((it) => it.pts.map((p) => p[0])), ys = its.flatMap((it) => it.pts.map((p) => p[1])); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
    const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    // (the line measured on the user's own letters — the middle of each kind, not the odd one out —; what Claude said only where a kind is missing)
    const kind = (ch) => (/^[gjpqyµ]$/.test(ch) ? "low" : /^[A-ZÄÖÜ0-9bdfhklß]$/.test(ch) ? "tall" : /^[acemnorsuvwxzäöüt]$/.test(ch) ? "small" : "");
    for (const g of groups) { g.kind = kind(g.ch); g.b = box(g.its); }
    const mid = (list) => { const v = [...list].sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : NaN; };
    const of = (k) => groups.filter((g) => g.kind === k), cap = clamp(mid(of("tall").map((g) => g.b[3] - g.b[1])), 2, 400, clamp(Number(step.cap), 2, 400, 0));
    const xh = clamp(mid(of("small").map((g) => g.b[3] - g.b[1])), 2, 400, clamp(Number(step.xh), 2, 400, cap * 0.6));
    const base = clamp(mid([...of("tall"), ...of("small")].map((g) => g.b[3])), -1e6, 1e6, origin[1] + clamp(Number(step.base), -1e5, 1e5, 0));
    // (the slant of a letter that stands upright — a tall one, one that reaches below: how far its points lean to the right going up; most of the way to the line's)
    const lean = (its) => { const ps = its.flatMap((it) => it.pts), n = ps.length, my = ps.reduce((a, p) => a + p[1], 0) / n, mx = ps.reduce((a, p) => a + p[0], 0) / n; let xy = 0, yy = 0; for (const p of ps) { xy += (p[0] - mx) * (p[1] - my); yy += (p[1] - my) ** 2; } return yy ? xy / yy : 0; };
    for (const g of groups) g.lean = g.kind === "tall" || g.kind === "low" ? lean(g.its) : null;
    const slant = clamp(mid(groups.filter((g) => g.lean != null).map((g) => g.lean)), -1, 1, 0);
    for (const g of groups) {
      if (g.lean != null) { const k = clamp((slant - g.lean) * BY, -0.6, 0.6, 0), y0 = g.b[3]; for (const it of g.its) B.ink.moved(it, (p) => [p[0] + (p[1] - y0) * k, p[1]]); g.b = box(g.its); }
      const b = g.b, h = b[3] - b[1], low = g.kind === "low", tall = g.kind === "tall", small = g.kind === "small";
      const want = tall ? cap : small ? xh : 0, s = want && h > 2 ? 1 + (clamp(want / h, 0.6, 1.6, 1) - 1) * BY : 1;
      const ax = (b[0] + b[2]) / 2, ay = low ? b[1] : b[3], to = low ? base - xh : base, dy = g.kind ? (to - ay) * BY : 0; // (a sign — a dot, a comma, a plus, an exponent, an index — keeps its height)
      for (const it of g.its) B.ink.moved(it, (p) => [ax + (p[0] - ax) * s, ay + (p[1] - ay) * s + dy]);
    }
    // the room between letters, and between words, most of the way to even
    const boxes = groups.map((g) => box(g.its)), gaps = boxes.slice(1).map((b, i) => b[0] - boxes[i][2]);
    const word = (gap) => gap > Math.max(xh * 0.6, 4);
    const mean = (list) => (list.length ? list.reduce((a, v) => a + v, 0) / list.length : 0), inner = mean(gaps.filter((v) => !word(v))), outer = mean(gaps.filter(word));
    let shift = 0;
    groups.forEach((g, i) => {
      if (i) shift += ((word(gaps[i - 1]) ? outer : inner) - gaps[i - 1]) * BY;
      for (const it of g.its) { if (shift) B.ink.moved(it, (p) => [p[0] + shift, p[1]]); it.pts = calm(it.pts, Math.max(1.2, it.w * 0.5)); it.path = null; it.box = null; }
    });
    return { added: [], changed: groups.flatMap((g) => g.its), removed: [] };
  }
  /* One step of Improve done on the model — only on the strokes that were chosen (ids, a Set), its coordinates from origin.
   * → { added, changed, removed } (the strokes as they now are), or null when it could not be done. */
  function refine(model, step, ids, origin) {
    const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
    const list = (v) => [...new Set((Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string" && ids.has(x)))];
    const strokes = (v) => list(v).map((id) => model.items.find((it) => it.id === id && it.k === "ink")).filter(Boolean);
    if (step.fit != null) {
      const all = strokes(step.fit);
      if (!all.length) return null;
      const bs = all.map((it) => B.format.boundsOf(it)), cx = (Math.min(...bs.map((b) => b[0])) + Math.max(...bs.map((b) => b[2]))) / 2, cy = (Math.min(...bs.map((b) => b[1])) + Math.max(...bs.map((b) => b[3]))) / 2;
      const k = clamp(Number(step.scale), 0.5, 2, 1), a = (clamp(Number(step.rotate), -30, 30, 0) * Math.PI) / 180, cos = Math.cos(a) * k, sin = Math.sin(a) * k;
      const dx = clamp(Number(step.dx), -400, 400, 0), dy = clamp(Number(step.dy), -400, 400, 0);
      for (const it of all) B.ink.moved(it, (p) => [cx + (p[0] - cx) * cos - (p[1] - cy) * sin + dx, cy + (p[0] - cx) * sin + (p[1] - cy) * cos + dy]);
      return { added: [], changed: all, removed: [] };
    }
    if (step.redraw != null) {
      const all = strokes(step.redraw), runs = flatten(step.d).filter((run) => run.length > 1);
      if (!all.length || !runs.length) return null;
      const added = [], changed = [], at = (run) => run.map((p) => [p[0] + origin[0], p[1] + origin[1]]);
      runs.forEach((run, i) => {
        const it = all[Math.min(i, all.length - 1)], made = stroke(at(run), { tool: it.t, c: it.c, w: it.w });
        if (i < all.length) { it.pts = made.pts; it.ch = made.ch; it.path = null; it.box = null; changed.push(it); }
        else { made.o = it.o; if (it.of) made.of = it.of; model.items.splice(model.items.indexOf(it) + 1 + added.length, 0, made); added.push(made); } // (more parts than strokes: strokes of their own, with the last one's look)
      });
      const removed = all.slice(runs.length); // (fewer parts than strokes: those left over go)
      if (removed.length) model.items = model.items.filter((it) => !removed.includes(it));
      return { added, changed, removed };
    }
    if (typeof step.line === "string" && Array.isArray(step.letters)) return line(model, step, strokes, origin);
    if (step.del != null) {
      const removed = strokes(step.del);
      if (!removed.length) return null;
      model.items = model.items.filter((it) => !removed.includes(it));
      return { added: [], changed: [], removed };
    }
    return null;
  }

  // every sign the hand can write (dev/hand-lab.html shows them one by one)
  const signs = () => [...Array.from({ length: 94 }, (_v, i) => String.fromCharCode(33 + i)), ...Object.keys(DOTS), "ß", ...Object.keys(SIGNS).filter((c) => !/^[ -~]$/.test(c))];
  // a sign's skeleton as the hand reads it, in the font's units: [path, o] (the Hand Lab shows it to Claude, to draw anew)
  const skeleton = (ch, style) => { const g = letter(fontOf(style), ch), r1 = (v) => Math.round(v * 10) / 10; return [g.runs.map((run) => "M" + B.hand.aims(run, 0.25).map(([x, y]) => `${r1(x)},${r1(y)}`).join(" L")).join(" "), r1(g.adv / UNIT)]; };
  B.claude = { describe, lineOf, reader, words, flatten, stroke, write, apply, signs, skeleton, formula: (tex, style) => formula(fontOf(style), tex), units, letter: (ch, style) => letter(fontOf(style), ch), smooth, simplify, tellPick, refine };
})();
