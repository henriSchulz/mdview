/* mdview — a whiteboard drawn on by Claude: what it is told of the board, and what it answers, done on the board.
 *
 * Claude answers with a block of steps, one JSON object per line, each done as soon as its line is whole (the answer
 * comes in pieces — the board fills while it is written):
 *
 *   <board>
 *   {"add":"ink","tool":"pen","c":"#e5372c","w":3,"d":"M 10 10 C 40 0, 60 0, 90 10"}   a stroke: an SVG path, or "pts"
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
   * o: { view: [x, y, w, h], pick: [ids], pages: [{ n, x, y, w, h }] } */
  function describe(model, o = {}) {
    const out = [];
    if (o.view) out.push(`The window shows x ${Math.round(o.view[0])} to ${Math.round(o.view[0] + o.view[2])}, y ${Math.round(o.view[1])} to ${Math.round(o.view[1] + o.view[3])}.`);
    if (o.pages && o.pages.length) {
      out.push(`The board lies over a PDF of ${o.pages.length} page${o.pages.length === 1 ? "" : "s"}; each page as a box on the board (x, y, width, height):`);
      for (const p of o.pages.slice(0, 400)) out.push(`page ${p.n}: ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.w)}, ${Math.round(p.h)}`);
    }
    const items = model.items || [];
    if (!items.length) out.push("The board is empty.");
    else {
      out.push(`What is on the board (${items.length}), from the back to the front:`);
      let room = 200_000;
      for (const it of items) {
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

  // ---------------------------------------------------------------- the steps, done
  /* A stroke from points [[x, y], …]: pressure as a hand that starts and ends light, time as a hand that moves on evenly. */
  function stroke(pts, o) {
    const tool = INKS.includes(o.tool) ? o.tool : INKS.includes(o.t) ? o.t : "pen", def = B.ink.TOOLS[tool];
    const n = pts.length;
    let t = 0;
    const out = pts.map((p, i) => {
      if (i) t += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) / 1.2; // (1.2 board pixels a millisecond)
      const ends = Math.min(i, n - 1 - i), p0 = Math.min(1, 0.35 + ends * 0.08);
      return [r1(p[0]), r1(p[1]), Math.round(p0 * 0.6 * 100) / 100, Math.round(t)];
    });
    const it = { id: B.format.id(), k: "ink", t: tool, c: color(o.c, def.c), o: def.o, w: Number.isFinite(o.w) ? Math.max(0.5, Math.min(60, o.w)) : def.w, ch: "xypt", pts: out };
    if (o.sharp === true) it.sharp = true;
    return it;
  }
  /* A step done on the model: → { added: [items], changed: [items], removed: [items] }, or null when it could not be done.
   * names: Claude's own names ("as") → the ids they were given, kept over one answer. */
  function apply(model, step, names = new Map()) {
    const items = model.items, id = (v) => (typeof v === "string" ? names.get(v) || v : null), find = (v) => items.find((it) => it.id === id(v));
    const ends = (o) => { for (const e of ["from", "to"]) if (o[e] && typeof o[e].id === "string") o[e] = { ...o[e], id: id(o[e].id) }; return o; };
    if (typeof step.add === "string") {
      const k = step.add === "stroke" ? "ink" : step.add, made = [];
      if (k === "ink") {
        const runs = Array.isArray(step.pts) ? [step.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))] : flatten(step.d);
        for (const run of runs) if (run.length > 1 || (run.length === 1 && Array.isArray(step.pts))) made.push(stroke(run.length > 1 ? run : [run[0], run[0]], step));
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
      if (typeof step.as === "string" && step.as) names.set(step.as, made[0].id);
      items.push(...made);
      return { added: made, changed: [], removed: [] };
    }
    if (typeof step.del === "string") {
      const it = find(step.del);
      if (!it) return null;
      model.items = items.filter((x) => x !== it);
      return { added: [], changed: [], removed: [it] };
    }
    if (typeof step.move === "string") {
      const it = find(step.move), dx = Number(step.dx) || 0, dy = Number(step.dy) || 0;
      if (!it) return null;
      if (it.k === "ink") B.ink.moved(it, (p) => [p[0] + dx, p[1] + dy]);
      else B.items.moveBy(it, dx, dy);
      return { added: [], changed: [it], removed: [] };
    }
    if (typeof step.set === "string") {
      const it = find(step.set);
      if (!it) return null;
      const more = { ...step };
      delete more.set; delete more.id; delete more.k;
      if (it.k === "ink") {
        if (more.c != null) it.c = color(more.c, it.c);
        if (Number.isFinite(more.w)) it.w = Math.max(0.5, Math.min(60, more.w));
        if (Number.isFinite(more.o)) it.o = Math.max(0.05, Math.min(1, more.o));
        if (INKS.includes(more.tool)) it.t = more.tool;
        it.path = null; it.box = null;
        return { added: [], changed: [it], removed: [] };
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

  B.claude = { describe, lineOf, reader, words, flatten, stroke, apply };
})();
