/* mdview — a whiteboard's file: an SVG picture that carries its own data.
 *
 *   <svg …>
 *   <metadata id="mdview-board"><![CDATA[
 *   {"board":1,"bg":"auto","grid":true,"view":{"x":0,"y":0,"z":1}}      line 1: the board
 *   {"id":"k3f9a","k":"ink","t":"pen","c":"auto","o":1,"w":3,"ch":"xypt","p":"…"}   one line per item,
 *   ]]></metadata>                                                       in stacking order
 *   …the picture, drawn from the lines above (render.js)…
 *   </svg>
 *
 * The lines are the truth and the picture is derived: reading takes the lines only, every write
 * makes both. One line per item, each with an id of its own, because Git and the web app merge
 * text files line by line — two devices that changed different items merge cleanly, and a merge
 * that went wrong costs single lines: each line is read by itself, one that cannot be read is left
 * out and counted, of two with one id the later stands.
 *
 * No DOM here: the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const VERSION = 1;
  const OPEN = '<metadata id="mdview-board"><![CDATA[', CLOSE = "]]></metadata>";
  const KINDS = new Set(["ink"]); // (what this version draws; lines of other kinds are kept as they are)

  // ---------------------------------------------------------------- ids
  const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";
  // (a letter first: an id is an id in the picture too, and a name there does not begin with a digit)
  const id = () => { let s = ALPHA[Math.floor(Math.random() * 26)]; for (let i = 1; i < 8; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; };

  // ---------------------------------------------------------------- a stroke's points
  /* A point is [x, y, pressure, time]: board pixels, pressure 0…1, milliseconds since the stroke
   * began; tilt and azimuth (degrees) follow where a pen gave them. Written as whole numbers —
   * tenths of a pixel, hundredths of pressure, milliseconds, degrees — each as the difference to
   * the point before, zigzag varints, base64url. `ch` names the channels, one letter each, so a
   * later version can add some: x y p t i(tilt) a(azimuth). */
  const SCALE = { x: 10, y: 10, p: 100, t: 1, i: 1, a: 1 };
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const UN64 = Object.fromEntries([...B64].map((c, i) => [c, i]));
  function pack(points, ch = "xypt") {
    const bytes = [], last = new Array(ch.length).fill(0);
    for (const pt of points) {
      for (let c = 0; c < ch.length; c++) {
        const v = Math.round((pt[c] || 0) * SCALE[ch[c]]), d = v - last[c];
        last[c] = v;
        let z = d < 0 ? -2 * d - 1 : 2 * d; // (zigzag, by arithmetic: the numbers outgrow 32 bits' shifts)
        do { const b = z % 128; z = Math.floor(z / 128); bytes.push(z ? b + 128 : b); } while (z);
      }
    }
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
      if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | ((c || 0) >> 6)];
      if (i + 2 < bytes.length) out += B64[c & 63];
    }
    return out;
  }
  function unpack(text, ch = "xypt") {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text) || !/^[xyptia]+$/.test(ch)) throw new Error("not a stroke");
    const bytes = [];
    for (let i = 0; i < text.length; i += 4) {
      const a = UN64[text[i]], b = UN64[text[i + 1]], c = UN64[text[i + 2]], d = UN64[text[i + 3]];
      if (b === undefined) throw new Error("cut off");
      bytes.push((a << 2) | (b >> 4));
      if (c !== undefined) bytes.push(((b & 15) << 4) | (c >> 2));
      if (d !== undefined) bytes.push(((c & 3) << 6) | d);
    }
    const points = [], last = new Array(ch.length).fill(0);
    let pt = [], c = 0, z = 0, mul = 1;
    for (const byte of bytes) {
      z += (byte & 127) * mul;
      if (byte & 128) { mul *= 128; continue; }
      const d = z % 2 ? -(z + 1) / 2 : z / 2;
      z = 0; mul = 1;
      last[c] += d;
      pt.push(last[c] / SCALE[ch[c]]);
      if (++c === ch.length) { points.push(pt); pt = []; c = 0; }
    }
    if (c || mul !== 1) throw new Error("cut off");
    return points;
  }

  // ---------------------------------------------------------------- items
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  /* A line of the file → the item as the program holds it; null where it is not one. */
  function itemOf(o) {
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !o.id || typeof o.k !== "string") return null;
    if (B.items && B.items.KINDS.has(o.k)) return B.items.norm(o); // a text box, a note, a shape, a line (items.js)
    if (!KINDS.has(o.k)) return { id: o.id, k: o.k, foreign: o }; // (a later version's: carried along untouched)
    if (o.k === "ink") {
      const ch = typeof o.ch === "string" ? o.ch : "xypt";
      const pts = unpack(o.p, ch);
      if (!pts.length) return null;
      const it = { id: o.id, k: "ink", t: typeof o.t === "string" ? o.t : "pen", c: typeof o.c === "string" ? o.c : "auto", o: Math.max(0.05, Math.min(1, num(o.o, 1))), w: Math.max(0.5, Math.min(200, num(o.w, 3))), ch, pts };
      if (o.sharp === true) it.sharp = true; // (a stroke made straight: its points are corners)
      return it;
    }
    return null;
  }
  function lineOf(it) {
    if (it.foreign) return it.foreign;
    if (B.items && B.items.KINDS.has(it.k)) return B.items.data(it);
    if (it.k === "ink") return { id: it.id, k: "ink", t: it.t, c: it.c, o: it.o, w: it.w, ...(it.sharp ? { sharp: true } : {}), ch: it.ch, p: pack(it.pts, it.ch) };
    return null;
  }
  /* What an item covers: [x0, y0, x1, y1]. */
  function boundsOf(it) {
    if (B.items && B.items.KINDS.has(it.k)) return B.items.bounds(it);
    if (it.k !== "ink") return null;
    if (it.box) return it.box;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of it.pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const r = it.w / 2 + 1;
    return (it.box = [x0 - r, y0 - r, x1 + r, y1 + r]);
  }

  // ---------------------------------------------------------------- the file
  const fresh = () => ({ board: { v: VERSION, bg: "auto", grid: true, view: null }, items: [], scenes: [], lost: 0 });
  /* A scene: a part of the board under a name, to go back to — { id, name, view: [x, y, w, h] }. */
  function sceneOf(o) {
    if (typeof o.id !== "string" || !o.id || !Array.isArray(o.view) || o.view.length !== 4 || !o.view.every(Number.isFinite) || o.view[2] <= 0 || o.view[3] <= 0) return null;
    return { id: o.id, name: typeof o.name === "string" ? o.name.slice(0, 200) : "", view: o.view.map((v) => Math.round(v)) };
  }
  /* The file's text → { board, items, lost }. lost: how many lines could not be read. Throws where
   * the text is no board at all. */
  function parse(text) {
    const a = String(text).indexOf(OPEN), b = a < 0 ? -1 : text.indexOf(CLOSE, a);
    if (a < 0 || b < 0) throw new Error("not a whiteboard");
    const out = fresh(), at = new Map();
    let head = false;
    for (const raw of text.slice(a + OPEN.length, b).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let o;
      try { o = JSON.parse(line); } catch (e) { out.lost++; continue; }
      if (o && typeof o === "object" && "board" in o && !("id" in o)) {
        if (head) continue; // (two heads after a merge: the first stands)
        head = true;
        out.board = { v: num(o.board, VERSION), bg: ["auto", "light", "dark"].includes(o.bg) ? o.bg : "auto", grid: o.grid !== false, ...(o.snap === true ? { snap: true } : {}), view: o.view && Number.isFinite(o.view.x) && Number.isFinite(o.view.y) && o.view.z > 0 ? { x: o.view.x, y: o.view.y, z: o.view.z } : null };
        continue;
      }
      if (o && o.k === "scene") { // (scenes stand in their own order, beside the items)
        const sc = sceneOf(o);
        if (!sc) { out.lost++; continue; }
        out.scenes = out.scenes.filter((x) => x.id !== sc.id);
        out.scenes.push(sc);
        continue;
      }
      let it = null;
      try { it = itemOf(o); } catch (e) { it = null; }
      if (!it) { out.lost++; continue; }
      if (at.has(it.id)) out.items[at.get(it.id)] = null; // (the same id twice: the later line stands, where it stands)
      at.set(it.id, out.items.length);
      out.items.push(it);
    }
    out.items = out.items.filter(Boolean);
    return out;
  }
  // (JSON in a CDATA section: "]]>" must not occur, and "<" is kept out of the way of anything that reads the file as HTML)
  const json = (o) => JSON.stringify(o).replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  /* { board, items } → the file's text. */
  function write(model) {
    const b = model.board, head = { board: VERSION, bg: b.bg, grid: b.grid, ...(b.snap ? { snap: true } : {}) };
    if (b.view) head.view = { x: Math.round(b.view.x), y: Math.round(b.view.y), z: Math.round(b.view.z * 1000) / 1000 };
    const lines = [json(head), ...(model.scenes || []).map((sc) => json({ id: sc.id, k: "scene", name: sc.name, view: sc.view })), ...model.items.map(lineOf).filter(Boolean).map(json)];
    const pic = B.render.picture(model);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${pic.w}" height="${pic.h}" viewBox="${pic.box.join(" ")}">\n${OPEN}\n${lines.join("\n")}\n${CLOSE}\n${pic.body}</svg>\n`;
  }
  const isBoard = (name) => /\.board\.svg$/i.test(String(name || "").split(/[?#]/)[0]);

  B.format = { VERSION, id, pack, unpack, parse, write, fresh, boundsOf, isBoard, empty: () => write(fresh()) };
})();
