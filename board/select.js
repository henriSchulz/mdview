/* mdview — a whiteboard's items in hand: choosing them (a click, Shift and a click, a box pulled
 * over them), moving them along guides, pulling them to size at their dots, turning them at the
 * knob, typing their text, and the small bar beside them that gives them their look and order.
 * board.js hands the pointer here while the drawing tools are put away. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const SNAP = 6, GRAB = 10, KNOB = 26, ARROW = 24; // screen pixels: how near a guide holds, how near a dot is hit, how far the knob stands off
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    arrange: svg('<rect x="4" y="5" width="9" height="6" rx="1.5"/><rect x="11" y="13" width="9" height="6" rx="1.5"/>'),
    crop: svg('<path d="M7 3v14h14M3 7h14v14"/>'), uncrop: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 20 20 4"/>'), open: svg('<path d="M14 5h5v5M19 5l-8 8M11 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V13"/>'),
    table: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 10h17M3.5 14h17M9.5 5.5v13M14.5 5.5v13"/>'),
    ends: svg('<path d="M5 19 19 5M11 5h8v8"/>'),
    alignL: svg('<path d="M4 4v16"/><rect x="7" y="6.5" width="11" height="4" rx="1"/><rect x="7" y="13.5" width="7" height="4" rx="1"/>'),
    alignC: svg('<path d="M12 4v16"/><rect x="6" y="6.5" width="12" height="4" rx="1"/><rect x="8.5" y="13.5" width="7" height="4" rx="1"/>'),
    alignR: svg('<path d="M20 4v16"/><rect x="6" y="6.5" width="11" height="4" rx="1"/><rect x="10" y="13.5" width="7" height="4" rx="1"/>'),
    alignT: svg('<path d="M4 4h16"/><rect x="6.5" y="7" width="4" height="11" rx="1"/><rect x="13.5" y="7" width="4" height="7" rx="1"/>'),
    alignM: svg('<path d="M4 12h16"/><rect x="6.5" y="6" width="4" height="12" rx="1"/><rect x="13.5" y="8.5" width="4" height="7" rx="1"/>'),
    alignB: svg('<path d="M4 20h16"/><rect x="6.5" y="6" width="4" height="11" rx="1"/><rect x="13.5" y="10" width="4" height="7" rx="1"/>'),
    routestraight: svg('<path d="M4 12h16"/>'), routecorner: svg('<path d="M4 16h8V8h8"/>'), routecurve: svg('<path d="M4 16c4-10 12-10 16 0"/>'),
    distH: svg('<path d="M4 4v16M20 4v16"/><rect x="9" y="7" width="6" height="10" rx="1"/>'), distV: svg('<path d="M4 4h16M4 20h16"/><rect x="7" y="9" width="10" height="6" rx="1"/>'),
    textL: svg('<path d="M5 7h14M5 12h9M5 17h12"/>'), textC: svg('<path d="M5 7h14M7.5 12h9M6 17h12"/>'), textR: svg('<path d="M5 7h14M10 12h9M7 17h12"/>'),
  };

  /* ctx: what board.js lends — S() the open board, el() its window, paint(), did(act), changed(), T, esc, icons. */
  function make(ctx) {
    const I = B.items, T = ctx.T, esc = ctx.esc;
    const S = () => ctx.S(), z = () => S().view.z;
    let act = null, edit = null, clip = [], lastDown = { id: null, t: 0 }, pending = null, look = null;
    const q = (el, sel) => el.querySelector(sel);
    const root = () => ctx.el();

    // ------------------------------------------------------------ changes that can be taken back
    const plain = (s) => s.model.items.filter((it) => it.k !== "ink");
    const snap = () => ({ items: [...S().model.items], data: new Map(plain(S()).map((it) => [it, JSON.stringify(it)])) });
    function restore(s) {
      const st = S();
      st.model.items = [...s.items];
      for (const [it, json] of s.data) { for (const k of Object.keys(it)) delete it[k]; Object.assign(it, JSON.parse(json)); }
      st.pick = st.pick.filter((it) => st.model.items.includes(it));
    }
    const same = (a, b) => a.items.length === b.items.length && a.items.every((it, i) => it === b.items[i]) && [...b.data].every(([it, json]) => a.data.get(it) === json);
    /* What was done since `before` is one step. → whether anything was. */
    function commit(before) {
      const after = snap();
      if (same(before, after)) return false;
      ctx.did({ undo: () => restore(before), redo: () => restore(after) });
      return true;
    }
    function change(f) { const before = snap(); f(S().pick); commit(before); ctx.paint(); bar(true); }

    // ------------------------------------------------------------ what is chosen
    const withGroup = (items) => { const st = S(), groups = new Set(items.map((it) => it.group).filter(Boolean)); return st.model.items.filter((it) => it.k !== "ink" && (items.includes(it) || (it.group && groups.has(it.group)))); };
    function pick(items) { S().pick = withGroup(items); closePop(); ctx.paint(); }
    const pickBox = (items = S().pick) => { let b = null; for (const it of items) { const c = I.bounds(it); b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : [...c]; } return b; };
    const under = (x, y) => { const items = plain(S()); for (let i = items.length - 1; i >= 0; i--) if (I.hit(items[i], x, y, 2 / z())) return items[i]; return null; };
    const toScreen = (x, y) => [(x - S().view.x) * z(), (y - S().view.y) * z()];
    const locked = () => S().pick.some((it) => it.lock);

    // ------------------------------------------------------------ the hand
    /* The dots of one chosen item: [name, hx, hy] with hx, hy in −1, 0, 1 of its frame. */
    const DOTS = [["nw", -1, -1], ["n", 0, -1], ["ne", 1, -1], ["e", 1, 0], ["se", 1, 1], ["s", 0, 1], ["sw", -1, 1], ["w", -1, 0]];
    function handleAt(p) {
      const st = S();
      if (st.pick.length !== 1 || st.pick[0].lock) return null;
      const it = st.pick[0], r = GRAB / z();
      if (it.k === "line") { for (const i of [0, 1]) if (Math.hypot(p.x - it.p[i * 2], p.y - it.p[i * 2 + 1]) <= r) return { end: i }; return null; }
      const [lx, ly] = I.local(it, p.x, p.y);
      if (!st.connect && !st.crop && it.k !== "table" && Math.hypot(lx, ly + it.h / 2 + KNOB / z()) <= r) return { turn: true }; // (with the connectors shown their arrow stands where the knob does)
      for (const [name, hx, hy] of DOTS) if (Math.hypot(lx - (hx * it.w) / 2, ly - (hy * it.h) / 2) <= r) return { name, hx, hy };
      // the connectors' arrows, a little off each side: pulled, a line grows out of the item
      if (st.connect) for (const [side, hx, hy] of [["t", 0, -1], ["r", 1, 0], ["b", 0, 1], ["l", -1, 0]]) if (Math.hypot(lx - hx * (it.w / 2 + ARROW / z()), ly - hy * (it.h / 2 + ARROW / z())) <= r + 2 / z()) return { conn: side };
      return null;
    }
    function start(pt, e) {
      const st = S(), p = ctx.onBoard(pt);
      if (edit) finish();
      closePop();
      const h = handleAt(p);
      if (h && h.conn) {
        const from = st.pick[0], a = I.sidePoint(from, h.conn), before = snap();
        const line = I.norm({ id: B.format.id(), k: "line", p: [a[0], a[1], p.x, p.y], stroke: { c: "auto", w: 2 }, ends: ["none", "arrow"], route: "corner", from: { id: from.id, at: h.conn } });
        st.model.items.push(line);
        act = { kind: "conn", line, before, side: h.conn, source: from, over: null };
        return true;
      }
      if (h) { act = { kind: h.turn ? "turn" : h.end != null ? "end" : "size", h, before: snap(), was: I.data(st.pick[0]) }; return true; }
      const it = under(p.x, p.y), now = performance.now();
      if (it) {
        // twice on the same item, and let go without having moved it: its text is typed (end())
        const twice = lastDown.id === it.id && now - lastDown.t < 400 && (((I.texty(it) || it.k === "table") && !it.lock) || it.k === "link" || it.k === "file");
        lastDown = twice ? { id: null, t: 0 } : { id: it.id, t: now };
        if (e.shiftKey) { pick(st.pick.includes(it) ? st.pick.filter((i) => i !== it && !(it.group && i.group === it.group)) : [...st.pick, it]); return false; }
        if (!st.pick.includes(it)) pick([it]);
        act = { kind: "move", from: [p.x, p.y], before: snap(), was: S().pick.map((i) => [i, I.data(i)]), box: pickBox(), moved: false, twice: twice ? it : null };
        return true;
      }
      lastDown = { id: null, t: 0 };
      act = { kind: "box", from: [p.x, p.y], keep: e.shiftKey ? [...st.pick] : [] };
      if (!e.shiftKey) pick([]);
      return true;
    }
    function move(pts, e) {
      if (!act) return;
      const st = S(), p = ctx.onBoard(pts[pts.length - 1]);
      if (act.kind === "box") {
        const b = [Math.min(act.from[0], p.x), Math.min(act.from[1], p.y), Math.max(act.from[0], p.x), Math.max(act.from[1], p.y)];
        act.rect = b;
        // everything the box touches
        st.pick = withGroup([...act.keep, ...plain(st).filter((it) => { const c = I.bounds(it); return c[0] <= b[2] && c[2] >= b[0] && c[1] <= b[3] && c[3] >= b[1]; })]);
        return ctx.paint();
      }
      if (act.kind === "move") {
        if (locked()) return;
        let dx = p.x - act.from[0], dy = p.y - act.from[1];
        if (!act.moved && Math.hypot(dx, dy) * z() < 3) return; // (a click with an unsteady hand moves nothing)
        act.moved = true;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } // straight along or straight up
        // onto the grid, where the board says so: the top left corner of what is moved comes to rest on a dot (no guides then)
        const GRID = 20, grid = st.model.board.snap && !e.altKey ? { dx: Math.round((act.box[0] + dx) / GRID) * GRID - (act.box[0] + dx), dy: Math.round((act.box[1] + dy) / GRID) * GRID - (act.box[1] + dy), v: null, h: null } : null;
        const g = grid || (e.altKey ? { dx: 0, dy: 0, v: null, h: null } : guides([act.box[0] + dx, act.box[1] + dy, act.box[2] + dx, act.box[3] + dy]));
        dx += g.dx; dy += g.dy;
        for (const [it, was] of act.was) { Object.assign(it, I.data(was)); I.moveBy(it, Math.round(dx * 10) / 10, Math.round(dy * 10) / 10); }
        act.guide = g;
        return ctx.paint();
      }
      if (act.kind === "conn") {
        act.line.p = [act.line.p[0], act.line.p[1], Math.round(p.x), Math.round(p.y)];
        act.over = joinable(p.x, p.y, act.source);
        return ctx.paint();
      }
      const it = st.pick[0];
      if (act.kind === "end") {
        let x = p.x, y = p.y;
        const o = act.h.end ? [act.was.p[0], act.was.p[1]] : [act.was.p[2], act.was.p[3]];
        if (e.shiftKey) { // in steps of 45 degrees about the other end
          const a = Math.round(Math.atan2(y - o[1], x - o[0]) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x - o[0], y - o[1]);
          x = o[0] + Math.cos(a) * len; y = o[1] + Math.sin(a) * len;
        }
        delete it[act.h.end ? "to" : "from"]; // (pulled: it lets go of what it was joined to; let go over an item, it joins that)
        it.p = act.h.end ? [o[0], o[1], Math.round(x), Math.round(y)] : [Math.round(x), Math.round(y), o[0], o[1]];
        const other = it[act.h.end ? "from" : "to"];
        act.over = joinable(p.x, p.y, other ? st.model.items.find((i) => i.id === other.id) : null);
        act.at = [p.x, p.y];
        return ctx.paint();
      }
      if (act.kind === "turn") {
        const [cx, cy] = I.mid(act.was);
        let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        deg = ((deg + 180) % 360 + 360) % 360 - 180;
        if (e.shiftKey) deg = Math.round(deg / 45) * 45;
        else for (const a of [-180, -90, 0, 90, 180]) if (Math.abs(deg - a) < 3) deg = a; // (it rests at the upright positions)
        it.r = Math.round(deg * 10) / 10;
        act.angle = it.r;
        return ctx.paint();
      }
      if (act.kind === "size") {
        // in the item's own frame, as it stood: the dot pulled goes with the hand, the opposite side stays
        const was = act.was, [lx, ly] = I.local(was, p.x, p.y), { hx, hy } = act.h, MIN = 12;
        let l = -was.w / 2, r = was.w / 2, t = -was.h / 2, b = was.h / 2;
        if (hx < 0) l = Math.min(lx, r - MIN); if (hx > 0) r = Math.max(lx, l + MIN);
        if (hy < 0) t = Math.min(ly, b - MIN); if (hy > 0) b = Math.max(ly, t + MIN);
        if (st.crop === was.id && was.k === "image") { // being cut: the dot pulled is the picture's edge there — the picture stays where it is, the frame closes in on it (never beyond the whole picture)
          const c = was.crop || [0, 0, 0, 0], fw = was.w / (1 - c[0] - c[2]), fh = was.h / (1 - c[1] - c[3]), fl = -was.w / 2 - c[0] * fw, ft = -was.h / 2 - c[1] * fh;
          l = Math.max(fl, l); r = Math.min(fl + fw, r); t = Math.max(ft, t); b = Math.min(ft + fh, b);
          const crop = [(l - fl) / fw, (t - ft) / fh, (fl + fw - r) / fw, (ft + fh - b) / fh].map((v) => Math.max(0, Math.round(v * 10000) / 10000));
          if (crop.some((v) => v > 0.0005)) it.crop = crop; else delete it.crop;
        } else if (was.k === "image" && !(hx && hy)) return; // (a picture is sized at its corners)
        else if (hx && hy && (e.shiftKey || was.k === "sticky" || was.k === "image")) { // a corner with Shift (a sticky note and a picture always): its proportions stay
          const k = Math.max((r - l) / was.w, (b - t) / was.h), w = was.w * k, h = was.h * k;
          if (hx < 0) l = r - w; else r = l + w;
          if (hy < 0) t = b - h; else b = t + h;
        }
        const rad = (was.r * Math.PI) / 180, ox = (l + r) / 2, oy = (t + b) / 2, [cx, cy] = I.mid(was);
        const ncx = cx + ox * Math.cos(rad) - oy * Math.sin(rad), ncy = cy + ox * Math.sin(rad) + oy * Math.cos(rad), w = r - l, h = b - t;
        if (was.k === "table") { // (its columns and rows keep their shares of it)
          Object.assign(it, { cols: [...was.cols], rows: [...was.rows], w: was.w, h: was.h });
          I.tableFit(it, w, h);
          Object.assign(it, { x: Math.round((hx < 0 ? was.x + was.w - it.w : was.x) * 10) / 10, y: Math.round((hy < 0 ? was.y + was.h - it.h : was.y) * 10) / 10 });
          return ctx.paint();
        }
        Object.assign(it, { x: Math.round((ncx - w / 2) * 10) / 10, y: Math.round((ncy - h / 2) * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 });
        return ctx.paint();
      }
    }
    /* The item a line's end could join at (x, y): what lies there, lines and `not` left out. */
    function joinable(x, y, not) {
      const items = plain(S());
      for (let i = items.length - 1; i >= 0; i--) if (items[i].k !== "line" && items[i] !== not && I.hit(items[i], x, y, 6 / z())) return items[i];
      return null;
    }
    /* Which of an item's sides the point is at; auto where it is at none in particular. */
    function sideNear(it, x, y) {
      for (const side of ["t", "r", "b", "l"]) { const q = I.sidePoint(it, side); if (Math.hypot(q[0] - x, q[1] - y) <= 16 / z()) return side; }
      return "auto";
    }
    function end() {
      if (!act) return;
      const a = act;
      act = null;
      if (a.kind === "end" && a.over) S().pick[0][a.h.end ? "to" : "from"] = { id: a.over.id, at: sideNear(a.over, ...a.at) };
      if (a.kind === "conn") {
        const [x1, y1, x2, y2] = a.line.p, st = S();
        if (Math.hypot(x2 - x1, y2 - y1) * z() < 12) { restore(a.before); return ctx.paint(); } // (a click on the arrow: nothing)
        if (a.over) { a.line.to = { id: a.over.id, at: "auto" }; commit(a.before); pick([a.line]); return; }
        // let go over the bare board: what is to stand there is asked for
        pending = { line: a.line, before: a.before, side: a.side, source: a.source };
        st.pick = [];
        ctx.paint();
        return ctx.ask([(x2 - st.view.x) * z(), (y2 - st.view.y) * z()]);
      }
      if (a.before) commit(a.before);
      if (a.kind === "move" && !a.moved && a.twice && (a.twice.k === "link" || a.twice.k === "file")) { ctx.paint(); return ctx.open(a.twice); } // (a card clicked twice: what it stands for is opened)
      if (a.kind === "move" && !a.moved && a.twice) { pick([a.twice]); return begin(a.twice, a.twice.k === "table" ? I.cellAt(a.twice, ...I.local(a.twice, ...a.from)) : null); }
      ctx.paint();
    }
    function cancel() {
      if (!act) return;
      const a = act;
      act = null;
      if (a.before) restore(a.before);
      if (a.kind === "conn") S().pick = [a.source];
      if (a.kind === "box") S().pick = a.keep;
      ctx.paint();
    }
    /* Where the box being moved comes to rest against the others: by how much to shift it so that
     * an edge or the middle of it meets an edge or the middle of another, and the lines that show it. */
    function guides(b) {
      const st = S(), near = SNAP / z(), out = { dx: 0, dy: 0, v: null, h: null };
      const mine = (lo, hi) => [lo, (lo + hi) / 2, hi];
      let bestX = near, bestY = near;
      for (const it of plain(st)) {
        if (st.pick.includes(it)) continue;
        const c = I.bounds(it);
        for (const m of mine(b[0], b[2])) for (const o of mine(c[0], c[2])) if (Math.abs(o - m) < bestX) { bestX = Math.abs(o - m); out.dx = o - m; out.v = { at: o, a: Math.min(b[1], c[1]), z: Math.max(b[3], c[3]) }; }
        for (const m of mine(b[1], b[3])) for (const o of mine(c[1], c[3])) if (Math.abs(o - m) < bestY) { bestY = Math.abs(o - m); out.dy = o - m; out.h = { at: o, a: Math.min(b[0], c[0]), z: Math.max(b[2], c[2]) }; }
      }
      return out;
    }

    // ------------------------------------------------------------ text
    /* cell: [row, column] of a table. */
    function begin(it, cell = null) {
      if (it.k === "table" && !cell) cell = [0, 0];
      const el = B.layer.elOf(q(root(), ".bd-world"), it.id), t = el && q(el, cell ? `[data-cell="${cell[0]},${cell[1]}"] .bd-t` : ".bd-t");
      if (!t) return;
      edit = { it, t, el, before: snap(), cell };
      el.dataset.editing = "";
      t.contentEditable = "plaintext-only";
      if (t.contentEditable !== "plaintext-only") t.contentEditable = "true";
      t.focus({ preventScroll: true });
      const sel = getSelection(), range = document.createRange();
      range.selectNodeContents(t);
      sel.removeAllRanges(); sel.addRange(range); // (what stands there is replaced by what is typed; an arrow key puts the caret at an end)
      t.addEventListener("input", typed);
      t.addEventListener("blur", blurred);
      ctx.paint();
    }
    function typed() {
      if (!edit) return;
      const { it, t, cell } = edit;
      if (cell) { // a table's cell: its row is as tall as its tallest text
        it.cells[cell[0]][cell[1]] = t.innerText.replace(/\n$/, "");
        const need = Math.ceil(t.offsetHeight + 2 * I.CELL);
        if (need > it.rows[cell[0]]) { it.rows[cell[0]] = need; it.h = it.rows.reduce((a, b) => a + b, 0); }
        ctx.changed();
        return ctx.paint();
      }
      it.text = t.innerText.replace(/\n$/, "");
      t.dataset.empty = it.text ? "" : "1";
      // a text box is as tall as its text; a note or a shape grows when its text outgrows it
      const need = Math.ceil(t.offsetHeight + 2 * I.PAD);
      if (it.k === "text" ? need !== it.h : need > it.h) it.h = Math.max(need, it.k === "text" ? 24 : it.h);
      ctx.changed();
      ctx.paint();
    }
    const blurred = () => setTimeout(() => { if (edit && document.activeElement !== edit.t) finish(); }, 0);
    function finish() {
      if (!edit) return;
      const { it, t, el, before, cell } = edit;
      edit = null;
      t.removeEventListener("input", typed);
      t.removeEventListener("blur", blurred);
      t.contentEditable = "false";
      delete el.dataset.editing;
      getSelection().removeAllRanges();
      if (cell) it.cells[cell[0]][cell[1]] = t.innerText.replace(/\n$/, ""); else it.text = t.innerText.replace(/\n$/, "");
      const st = S();
      if (it.k === "text" && !it.text.trim()) { st.model.items = st.model.items.filter((i) => i !== it); st.pick = st.pick.filter((i) => i !== it); } // (a text box left empty is none)
      commit(before);
      root().focus({ preventScroll: true });
      ctx.paint();
    }

    /* Tab in a table's cell: on to the next (dir 1) or back to the one before (−1), row after row. */
    function tab(dir) {
      if (!edit || !edit.cell) return false;
      const it = edit.it, n = it.cols.length, at = edit.cell[0] * n + edit.cell[1] + dir, all = it.rows.length * n, next = ((at % all) + all) % all;
      finish();
      begin(it, [Math.floor(next / n), next % n]);
      return true;
    }
    /* A table's rows or columns: one more at its end (by 1), or its last one gone (−1). */
    function tableGrow(what, by) {
      change((p) => {
        for (const it of p) {
          if (it.k !== "table") continue;
          if (what === "rows") {
            if (by > 0 && it.rows.length < 40) { it.rows.push(it.rows[it.rows.length - 1]); it.cells.push(it.cols.map(() => "")); }
            else if (by < 0 && it.rows.length > 1) { it.rows.pop(); it.cells.pop(); }
          } else if (by > 0 && it.cols.length < 40) { it.cols.push(it.cols[it.cols.length - 1]); for (const row of it.cells) row.push(""); }
          else if (by < 0 && it.cols.length > 1) { it.cols.pop(); for (const row of it.cells) row.pop(); }
          it.w = it.cols.reduce((a, b) => a + b, 0); it.h = it.rows.reduce((a, b) => a + b, 0);
        }
      });
    }

    // ------------------------------------------------------------ making, copying, order
    /* Cards for files kept beside the board (their names), or for an address. */
    function cards(list, at = null) {
      if (!list.length) return;
      const st = S(), s = ctx.size(), [cx, cy] = at || st.view.toBoard(s.w / 2, s.h / 2), before = snap();
      const made = list.map((c, i) => I.fresh(c.url ? "link" : "file", cx + i * 24, cy + i * 24, c)).map(I.norm).filter(Boolean);
      if (!made.length) return false;
      st.model.items.push(...made);
      commit(before);
      pick(made);
      return true;
    }
    /* The chosen item's look is what a new one of its kind begins with from now on, on this board. */
    function insertStyle() {
      const st = S(), it = st.pick[0];
      if (!it) return;
      const look = I.data({ fill: it.fill, stroke: it.stroke, ts: it.ts, ends: it.ends, route: it.route, shape: undefined });
      st.model.board.insert = { ...(st.model.board.insert || {}), [it.k]: JSON.parse(JSON.stringify(look)) };
      ctx.changed();
      closePop();
    }
    function insert(kind, more = {}) {
      const st = S(), s = ctx.size(), [cx, cy] = st.view.toBoard(s.w / 2, s.h / 2), before = snap();
      // (not on top of the one made just before)
      const n = plain(st).filter((it) => Math.abs(I.mid(it)[0] - cx) % 24 < 1 && Math.abs(I.mid(it)[1] - cy) % 24 < 1 && Math.abs(I.mid(it)[0] - cx) < 240).length;
      let it = I.fresh(kind, Math.round(cx) + n * 24, Math.round(cy) + n * 24, more);
      const look = (st.model.board.insert || {})[kind];
      if (look) it = I.norm({ ...it, ...look, ts: it.ts ? { ...it.ts, ...(look.ts || {}) } : undefined }) || it; // (the look saved for new ones of its kind)
      st.model.items.push(it);
      commit(before);
      pick([it]);
      if (kind === "text" || kind === "sticky" || kind === "table") begin(it);
      return it;
    }
    /* The shape chosen for a connector's free end (null: none — the line ends where it was let go). */
    function connectTo(shape) {
      if (!pending) return;
      const { line, before, side, source } = pending, st = S();
      pending = null;
      if (shape) {
        const [, , x, y] = line.p, w = source.k === "line" ? 150 : source.w, h = source.k === "line" ? 100 : source.h;
        // it stands beyond the line's end, facing the item the line comes from
        const off = { r: [w / 2, 0], l: [-w / 2, 0], b: [0, h / 2], t: [0, -h / 2] }[side];
        const it = I.fresh("shape", x + off[0], y + off[1], { shape });
        Object.assign(it, { x: Math.round(x + off[0] - w / 2), y: Math.round(y + off[1] - h / 2), w, h });
        if (source.k === "shape") { it.fill = source.fill; it.stroke = { ...source.stroke }; it.ts = { ...source.ts }; }
        st.model.items.push(it);
        line.to = { id: it.id, at: { r: "l", l: "r", b: "t", t: "b" }[side] };
        commit(before);
        return pick([it]);
      }
      commit(before);
      pick([line]);
    }
    /* A line between the two items chosen. */
    function link() {
      const st = S(), two = st.pick.filter((it) => it.k !== "line");
      if (two.length !== 2) return;
      const before = snap(), line = I.norm({ id: B.format.id(), k: "line", p: [...I.mid(two[0]), ...I.mid(two[1])], stroke: { c: "auto", w: 2 }, ends: ["none", "arrow"], route: "corner", from: { id: two[0].id, at: "auto" }, to: { id: two[1].id, at: "auto" } });
      st.model.items.push(line);
      commit(before);
      closePop();
      pick([line]);
    }
    function copies(list, by) {
      const groups = new Map(), ids = new Map(list.map((d) => [d.id, B.format.id()]));
      return list.map((d) => {
        const c = I.norm({ ...d, id: ids.get(d.id) });
        if (d.group) { if (!groups.has(d.group)) groups.set(d.group, B.format.id()); c.group = groups.get(d.group); }
        // a line copied with what it joins joins the copies; copied alone it joins nothing
        for (const end of ["from", "to"]) if (c[end]) { if (ids.has(c[end].id)) c[end].id = ids.get(c[end].id); else delete c[end]; }
        I.moveBy(c, by, by);
        return c;
      });
    }
    function duplicate() { const st = S(); if (!st.pick.length) return; const before = snap(), cs = copies(st.pick.map(I.data), 16); st.model.items.push(...cs); st.pick = cs; commit(before); ctx.paint(); }
    function remove() { const st = S(); if (!st.pick.length || locked()) return; const before = snap(), gone = new Set(st.pick); st.model.items = st.model.items.filter((it) => !gone.has(it)); st.pick = []; commit(before); closePop(); ctx.paint(); }
    // (the system's clipboard is given their text: a picture copied before is no longer what a paste here means)
    function copy(cut) { const st = S(); if (!st.pick.length) return; clip = st.pick.map(I.data); clip.n = 0; ctx.copied(st.pick.map((it) => it.text || "").filter(Boolean).join("\n") || " "); if (cut) remove(); }
    /* Pictures kept beside the board (their names), put on it: list of { src, w, h } as they are; at: where on the board, else the middle of the view. */
    function pictures(list, at = null) {
      if (!list.length) return;
      const st = S(), s = ctx.size(), [cx, cy] = at || st.view.toBoard(s.w / 2, s.h / 2), before = snap();
      const made = list.map((p, i) => {
        const k = Math.min(1, 480 / p.w, 400 / p.h), w = Math.max(8, Math.round(p.w * k)), h = Math.max(8, Math.round(p.h * k));
        return { id: B.format.id(), k: "image", x: Math.round(cx - w / 2) + i * 24, y: Math.round(cy - h / 2) + i * 24, w, h, r: 0, src: p.src };
      });
      st.model.items.push(...made);
      commit(before);
      pick(made);
    }
    function paste() { if (!clip.length) return; const st = S(), before = snap(), cs = copies(clip, 16 * ++clip.n); st.model.items.push(...cs); st.pick = cs; commit(before); ctx.paint(); }
    function order(front) {
      change((p) => { const st = S(), set = new Set(p), rest = st.model.items.filter((it) => !set.has(it)), mine = st.model.items.filter((it) => set.has(it)); st.model.items = front ? [...rest, ...mine] : [...mine, ...rest]; });
    }
    const group = () => change((p) => { if (p.length < 2) return; const g = B.format.id(); for (const it of p) it.group = g; });
    const ungroup = () => change((p) => { for (const it of p) delete it.group; });
    const lock = (on) => change((p) => { for (const it of p) { if (on) it.lock = true; else delete it.lock; } });
    function align(how) {
      change((p) => {
        if (p.length < 2) return;
        const all = pickBox(p), done = new Set();
        // (the members of a group move as one)
        for (const it of p) {
          const unit = it.group ? p.filter((i) => i.group === it.group) : [it];
          if (done.has(unit[0])) continue;
          unit.forEach((i) => done.add(i));
          const b = pickBox(unit);
          const dx = how === "L" ? all[0] - b[0] : how === "R" ? all[2] - b[2] : how === "C" ? (all[0] + all[2] - b[0] - b[2]) / 2 : 0;
          const dy = how === "T" ? all[1] - b[1] : how === "B" ? all[3] - b[3] : how === "M" ? (all[1] + all[3] - b[1] - b[3]) / 2 : 0;
          for (const i of unit) I.moveBy(i, Math.round(dx * 10) / 10, Math.round(dy * 10) / 10);
        }
      });
    }

    /* An item's look taken along (its fill, its border or line, how its text is set), and given to others — each takes what it has a place for. */
    function copyLook() { const it = S().pick[0]; if (it) look = I.data({ fill: it.fill, stroke: it.stroke, ts: it.ts, ends: it.ends, route: it.route || "straight" }); }
    function pasteLook() {
      if (!look) return;
      change((p) => {
        for (const it of p) {
          if (it.lock) continue;
          if (look.fill && "fill" in it && !(it.k === "sticky" && look.fill === "none")) it.fill = look.fill;
          if (look.stroke && it.stroke) it.stroke = { ...look.stroke, ...(it.k === "line" && look.stroke.c === "none" ? { c: "auto" } : {}) };
          if (look.ts && it.ts) it.ts = it.k === "table" ? { size: look.ts.size } : { ...look.ts };
          if (look.ends && it.ends) { it.ends = [...look.ends]; if (look.route === "straight") delete it.route; else it.route = look.route; }
        }
      });
    }
    /* Three or more, at equal distances between the outermost two: side by side (H) or one under the other (V). */
    function distribute(how) {
      change((p) => {
        const units = [], done = new Set();
        for (const it of p) { const unit = it.group ? p.filter((i) => i.group === it.group) : [it]; if (!done.has(unit[0])) { unit.forEach((i) => done.add(i)); units.push({ unit, b: pickBox(unit) }); } }
        if (units.length < 3) return;
        const a = how === "H" ? 0 : 1;
        units.sort((u, v) => u.b[a] + u.b[a + 2] - v.b[a] - v.b[a + 2]);
        const span = units[units.length - 1].b[a + 2] - units[0].b[a], taken = units.reduce((s, u) => s + u.b[a + 2] - u.b[a], 0), gap = (span - taken) / (units.length - 1);
        let at = units[0].b[a];
        for (const u of units) { const d = Math.round((at - u.b[a]) * 10) / 10; for (const i of u.unit) I.moveBy(i, how === "H" ? d : 0, how === "H" ? 0 : d); at += u.b[a + 2] - u.b[a] + gap; }
      });
    }

    // ------------------------------------------------------------ the bar beside what is chosen
    const popEl = () => q(root(), ".bd-fpop"), barEl = () => q(root(), ".bd-fbar");
    const closePop = () => { const p = root() && popEl(); if (p) { delete p.dataset.open; p.dataset.kind = ""; } };
    const every = (f) => S().pick.length > 0 && S().pick.every(f);
    function bar(keepPop = false) {
      const st = S(), b = barEl(), p = st.pick;
      if (!p.length || act || edit) { b.hidden = true; if (!keepPop || !p.length) closePop(); return; }
      const btn = (name, label, inner) => `<button type="button" class="bd-btn" data-f="${name}" title="${esc(label)}" aria-label="${esc(label)}">${inner}</button>`;
      const first = p[0], well = (c, ring) => `<span class="bd-well bd-mini${ring ? " bd-ringed" : ""}" style="--ink:${c === "none" ? "transparent" : c === "auto" ? "var(--fg)" : c}"${c === "none" ? " data-none" : ""}></span>`;
      let html = "";
      if (locked()) html = btn("unlock", T("board.unlock"), ctx.icons.unlock);
      else {
        if (every((it) => it.k === "shape" || it.k === "sticky")) html += btn("fill", T("board.fill"), well(first.fill));
        if (every((it) => it.k === "shape" || it.k === "line")) html += btn("stroke", T("board.stroke"), well(first.stroke.c, true));
        if (every(I.texty)) html += btn("text", T("board.textLook"), '<b class="bd-aa">Aa</b>');
        if (every((it) => it.k === "line")) html += btn("ends", T("board.ends"), ICON.ends);
        if (every((it) => it.k === "table")) html += btn("table", T("board.table"), ICON.table);
        if (p.length === 1 && first.k === "image") html += `<button type="button" class="bd-btn" data-f="crop" title="${esc(T("board.crop"))}" aria-label="${esc(T("board.crop"))}" aria-pressed="${st.crop === first.id}">${ICON.crop}</button>` + (first.crop ? btn("uncrop", T("board.uncrop"), ICON.uncrop) : "");
        if (p.length === 1 && (first.k === "link" || first.k === "file")) html += btn("open", T("board.open"), ICON.open);
        html += `<span class="bd-sep"></span>` + btn("arrange", T("board.arrange"), ICON.arrange) + btn("duplicate", T("board.duplicate"), ctx.icons.copy) + btn("remove", T("board.delete"), ctx.icons.trash);
      }
      if (b.dataset.sig !== html) { b.innerHTML = html; b.dataset.sig = html; }
      b.hidden = false;
      const bx = pickBox(), s = ctx.size(), [x0, y0] = toScreen(bx[0], bx[1]), [x1, y1] = toScreen(bx[2], bx[3]), w = b.offsetWidth, top = y1 + (p.length === 1 && p[0].k !== "line" ? 14 : 12);
      b.style.transform = `translate(${Math.round(Math.max(8, Math.min(s.w - w - 8, (x0 + x1) / 2 - w / 2)))}px, ${Math.round(top + 36 < s.h - 80 ? top : Math.max(56, y0 - 48 - (p.length === 1 && !p[0].lock && p[0].k !== "line" ? KNOB : 0)))}px)`;
      if (popEl().dataset.open != null && keepPop) pop(popEl().dataset.kind, true);
    }
    /* A tool's choices, under its button. */
    function pop(kind, again = false) {
      const p = popEl(), st = S(), first = st.pick[0];
      if (!first || (!again && p.dataset.open != null && p.dataset.kind === kind)) return closePop();
      const sw = (c, on, attr) => `<button type="button" class="bd-well" ${attr}="${c}" aria-pressed="${on}" style="--ink:${c === "none" ? "transparent" : c === "auto" ? "var(--fg)" : c}"${c === "none" ? " data-none" : ""} aria-label="${c}"></button>`;
      const seg = (attr, opts, now) => `<div class="bd-seg">${opts.map(([v, label]) => `<button type="button" ${attr}="${v}" aria-pressed="${now(v)}" title="${esc(typeof label === "string" && !label.startsWith("<") ? label : v)}">${label}</button>`).join("")}</div>`;
      let html = "";
      if (kind === "fill") {
        const cs = every((it) => it.k === "sticky") ? Object.values(I.PAPERS) : I.FILLS;
        html = `<div class="bd-swatches">${cs.map((c) => sw(c, first.fill === c, "data-fill")).join("")}</div>` + (every((it) => it.k === "shape") ? `<button type="button" class="bd-wide-btn" data-fill="none" aria-pressed="${first.fill === "none"}">${esc(T("board.noFill"))}</button>` : "");
      } else if (kind === "stroke") {
        html = `<div class="bd-swatches">${["auto", ...I.FILLS.slice(3), "#ffffff", "#b9b9be"].map((c) => sw(c, first.stroke.c === c, "data-stroke")).join("")}</div>` +
          (every((it) => it.k === "shape") ? `<button type="button" class="bd-wide-btn" data-stroke="none" aria-pressed="${first.stroke.c === "none"}">${esc(T("board.noStroke"))}</button>` : "") +
          `<div class="bd-widths">${I.WIDTHS.map((w) => `<button type="button" class="bd-width" data-sw="${w}" aria-checked="${first.stroke.w === w}" aria-label="${w}"><i style="width:22px;height:${w}px;border-radius:${w / 2}px"></i></button>`).join("")}</div>`;
      } else if (kind === "text") {
        const ts = first.ts;
        html = `<div class="bd-row"><button type="button" class="bd-step" data-size="-1" aria-label="${esc(T("board.smaller"))}">−</button><output>${ts.size}</output><button type="button" class="bd-step" data-size="1" aria-label="${esc(T("board.larger"))}">+</button>` +
          seg("data-style", [["bold", "<b>B</b>"], ["italic", "<i>I</i>"], ["underline", "<u>U</u>"]], (v) => !!ts[v]) + `</div>` +
          seg("data-align", [["left", ICON.textL], ["center", ICON.textC], ["right", ICON.textR]], (v) => ts.align === v) +
          `<div class="bd-swatches">${["auto", "#ffffff", "#e5372c", "#f08a12", "#52b85a", "#1f6fe5"].map((c) => sw(c, ts.color === c, "data-tc")).join("")}</div>`;
      } else if (kind === "ends") {
        html = seg("data-end", [[0, esc(T("board.startArrow"))], [1, esc(T("board.endArrow"))]], (v) => first.ends[v] === "arrow") +
          `<h6>${esc(T("board.route"))}</h6>` + seg("data-route", I.ROUTES.map((r) => [r, ICON["route" + r]]), (v) => (first.route || "straight") === v);
      } else if (kind === "table") {
        const stepper = (what, label, count) => `<div class="bd-row"><span class="bd-label">${esc(label)}</span><button type="button" class="bd-step" data-t${what}="-1" aria-label="${esc(label)} −">−</button><output>${count}</output><button type="button" class="bd-step" data-t${what}="1" aria-label="${esc(label)} +">+</button></div>`;
        html = stepper("rows", T("board.rows"), first.rows.length) + stepper("cols", T("board.columns"), first.cols.length) +
          `<div class="bd-row"><span class="bd-label">${esc(T("board.textLook"))}</span><button type="button" class="bd-step" data-size="-1" aria-label="${esc(T("board.smaller"))}">−</button><output>${first.ts.size}</output><button type="button" class="bd-step" data-size="1" aria-label="${esc(T("board.larger"))}">+</button></div>` +
          `<button type="button" class="bd-wide-btn" data-thead="1" aria-pressed="${!!first.head}">${esc(T("board.header"))}</button>`;
      } else if (kind === "arrange") {
        const many = st.pick.length > 1, grouped = st.pick.some((it) => it.group);
        html = (many ? `<h6>${esc(T("board.align"))}</h6><div class="bd-row bd-aligns">${["L", "C", "R", "T", "M", "B"].map((a) => `<button type="button" class="bd-btn" data-al="${a}" title="${esc(T("board.align." + a))}" aria-label="${esc(T("board.align." + a))}">${ICON["align" + a]}</button>`).join("")}${st.pick.length > 2 ? `<button type="button" class="bd-btn" data-dist="H" title="${esc(T("board.distribute.H"))}" aria-label="${esc(T("board.distribute.H"))}">${ICON.distH}</button><button type="button" class="bd-btn" data-dist="V" title="${esc(T("board.distribute.V"))}" aria-label="${esc(T("board.distribute.V"))}">${ICON.distV}</button>` : ""}</div>` : "") +
          `<div class="bd-list">${st.pick.length === 2 && st.pick.every((it) => it.k !== "line") ? `<button type="button" data-f="link">${esc(T("board.link"))}</button>` : ""}${many || grouped ? `<button type="button" data-f="${grouped ? "ungroup" : "group"}">${esc(T(grouped ? "board.ungroup" : "board.group"))}</button>` : ""}<button type="button" data-f="front">${esc(T("board.front"))}</button><button type="button" data-f="back">${esc(T("board.toBack"))}</button><button type="button" data-f="lock">${esc(T("board.lock"))}</button><hr>${st.pick.length === 1 && ["shape", "sticky", "text", "line"].includes(first.k) ? `<button type="button" data-f="insertStyle">${esc(T("board.insertStyle"))}</button>` : ""}<button type="button" data-f="copyLook">${esc(T("board.copyStyle"))}</button>${look ? `<button type="button" data-f="pasteLook">${esc(T("board.pasteStyle"))}</button>` : ""}</div>`;
      }
      p.innerHTML = html;
      p.dataset.kind = kind;
      const anchor = q(barEl(), `[data-f="${kind}"]`), box = root().getBoundingClientRect(), r = (anchor || barEl()).getBoundingClientRect();
      const below = r.bottom + 8 + p.offsetHeight < box.bottom - 8;
      p.style.left = Math.round(Math.max(8, Math.min(box.width - p.offsetWidth - 8, r.left - box.left + r.width / 2 - p.offsetWidth / 2))) + "px";
      p.style.top = Math.round(below ? r.bottom - box.top + 8 : r.top - box.top - 8 - p.offsetHeight) + "px";
      p.style.setProperty("--origin", below ? "top center" : "bottom center");
      p.dataset.open = "";
    }
    /* A click in the bar or in its choices. → whether it was one of theirs. */
    function click(b) {
      const d = b.dataset;
      if (d.f) {
        if (["fill", "stroke", "text", "ends", "arrange", "table"].includes(d.f)) return pop(d.f), true;
        ({ duplicate, remove, group, ungroup, link, insertStyle, open: () => ctx.open(S().pick[0]),
          crop: () => { const st = S(); st.crop = st.crop === st.pick[0].id ? null : st.pick[0].id; ctx.paint(); },
          uncrop: () => change((p) => { const it = p[0], c = it.crop; if (!c) return; const fw = it.w / (1 - c[0] - c[2]), fh = it.h / (1 - c[1] - c[3]), [lx, ly] = [-(c[0] - c[2]) * fw / 2, -(c[1] - c[3]) * fh / 2], rad = (it.r * Math.PI) / 180, [cx, cy] = I.mid(it); delete it.crop; Object.assign(it, { w: Math.round(fw * 10) / 10, h: Math.round(fh * 10) / 10 }); Object.assign(it, { x: Math.round((cx + lx * Math.cos(rad) - ly * Math.sin(rad) - it.w / 2) * 10) / 10, y: Math.round((cy + lx * Math.sin(rad) + ly * Math.cos(rad) - it.h / 2) * 10) / 10 }); }),
          copyLook: () => { copyLook(); closePop(); }, pasteLook, front: () => order(true), back: () => order(false), lock: () => { lock(true); closePop(); }, unlock: () => lock(false) })[d.f]?.();
        return true;
      }
      if (d.trows) return tableGrow("rows", Number(d.trows)), true;
      if (d.tcols) return tableGrow("cols", Number(d.tcols)), true;
      if (d.thead) return change((p) => { const on = !p[0].head; for (const it of p) if (it.k === "table") it.head = on; }), true;
      if (d.fill) return change((p) => { for (const it of p) if ("fill" in it) it.fill = d.fill; }), true;
      if (d.stroke) return change((p) => { for (const it of p) if (it.stroke) it.stroke.c = d.stroke; }), true;
      if (d.sw) return change((p) => { for (const it of p) if (it.stroke) { it.stroke.w = Number(d.sw); if (it.stroke.c === "none") it.stroke.c = "auto"; } }), true;
      if (d.size) return change((p) => { for (const it of p) if (it.ts) { const i = I.SIZES.findIndex((s) => s >= it.ts.size); it.ts.size = I.SIZES[Math.max(0, Math.min(I.SIZES.length - 1, (i < 0 ? I.SIZES.length - 1 : i) + Number(d.size)))]; } }), true;
      if (d.style) return change((p) => { const on = !p[0].ts[d.style]; for (const it of p) if (it.ts) { if (on) it.ts[d.style] = true; else delete it.ts[d.style]; } }), true;
      if (d.align) return change((p) => { for (const it of p) if (it.ts) it.ts.align = d.align; }), true;
      if (d.tc) return change((p) => { for (const it of p) if (it.ts) it.ts.color = d.tc; }), true;
      if (d.end != null) return change((p) => { const on = p[0].ends[d.end] !== "arrow"; for (const it of p) if (it.ends) it.ends[d.end] = on ? "arrow" : "none"; }), true;
      if (d.route) return change((p) => { for (const it of p) if (it.k === "line") { if (d.route === "straight") delete it.route; else it.route = d.route; } }), true;
      if (d.al) return align(d.al), true;
      if (d.dist) return distribute(d.dist), true;
      return false;
    }

    // ------------------------------------------------------------ what the window shows of all this
    function paint() {
      const st = S(), el = root(), frame = q(el, ".bd-pick"), band = q(el, ".bd-band"), gv = q(el, ".bd-guide-v"), gh = q(el, ".bd-guide-h"), tip = q(el, ".bd-angle");
      const p = st.mode === "select" ? st.pick : [];
      frame.hidden = !p.length;
      if (p.length) {
        const one = p.length === 1 ? p[0] : null;
        frame.dataset.kind = one ? (one.k === "line" ? "line" : "one") : "many";
        frame.toggleAttribute("data-lock", locked());
        frame.toggleAttribute("data-busy", !!(act && act.kind === "move" && act.moved));
        if (st.crop && !(one && one.id === st.crop)) st.crop = null; // (cutting ends with the choice of something else)
        frame.toggleAttribute("data-crop", !!st.crop);
        frame.toggleAttribute("data-noturn", !!(one && one.k === "table")); // (a table stands upright)
        frame.toggleAttribute("data-conn", !!(st.connect && one && one.k !== "line" && !one.lock && !act));
        if (one && one.k === "line") {
          const [ax, ay] = toScreen(one.p[0], one.p[1]), [bx, by] = toScreen(one.p[2], one.p[3]);
          frame.style.cssText = "transform:none;width:0;height:0";
          q(frame, '[data-dot="a"]').style.transform = `translate(${ax}px, ${ay}px)`;
          q(frame, '[data-dot="b"]').style.transform = `translate(${bx}px, ${by}px)`;
        } else if (one) {
          const [cx, cy] = toScreen(...I.mid(one)), w = one.w * z(), h = one.h * z();
          frame.style.cssText = `width:${w}px;height:${h}px;transform:translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${one.r}deg)`;
        } else {
          const b = pickBox(), [x0, y0] = toScreen(b[0], b[1]), [x1, y1] = toScreen(b[2], b[3]);
          frame.style.cssText = `width:${x1 - x0}px;height:${y1 - y0}px;transform:translate(${x0}px, ${y0}px)`;
        }
      }
      band.hidden = !(act && act.kind === "box" && act.rect);
      if (!band.hidden) { const [x0, y0] = toScreen(act.rect[0], act.rect[1]), [x1, y1] = toScreen(act.rect[2], act.rect[3]); band.style.cssText = `width:${x1 - x0}px;height:${y1 - y0}px;transform:translate(${x0}px, ${y0}px)`; }
      const g = act && act.kind === "move" ? act.guide : null;
      gv.hidden = !(g && g.v); gh.hidden = !(g && g.h);
      if (g && g.v) { const [x, y0] = toScreen(g.v.at, g.v.a), y1 = toScreen(0, g.v.z)[1]; gv.style.cssText = `height:${y1 - y0 + 16}px;transform:translate(${Math.round(x)}px, ${y0 - 8}px)`; }
      if (g && g.h) { const [x0, y] = toScreen(g.h.a, g.h.at), x1 = toScreen(g.h.z, 0)[0]; gh.style.cssText = `width:${x1 - x0 + 16}px;transform:translate(${x0 - 8}px, ${Math.round(y)}px)`; }
      const over = act && (act.kind === "conn" || act.kind === "end") ? act.over : null, target = q(el, ".bd-target");
      target.hidden = !over;
      if (over) { const [cx, cy] = toScreen(...I.mid(over)), w = over.w * z() + 8, h = over.h * z() + 8; target.style.cssText = `width:${w}px;height:${h}px;transform:translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${over.r || 0}deg)`; }
      tip.hidden = !(act && act.kind === "turn" && act.angle != null);
      if (!tip.hidden) { const [cx, cy] = toScreen(...I.mid(p[0])); tip.textContent = Math.round(act.angle) + "°"; tip.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`; }
      bar(true);
    }

    // ------------------------------------------------------------ keys
    /* → whether the key was one of these. (While text is typed board.js lets everything but Esc through.) */
    function key(e) {
      const st = S(), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), p = st.pick;
      if (e.key === "Escape") { if (popEl().dataset.open != null) return closePop(), true; if (p.length) return pick([]), true; return false; }
      if (mod && e.altKey && k === "c") return copyLook(), true;
      if (mod && e.altKey && k === "v") return pasteLook(), true;
      if (mod && k === "a") return pick(plain(st)), true;
      if (mod && k === "c") return copy(false), true;
      if (mod && k === "x") return copy(true), true;
      if (mod && k === "d") return duplicate(), true;
      if (mod && k === "g") return (e.shiftKey ? ungroup() : group()), true;
      if (mod && e.shiftKey && k === "f") return order(true), true;
      if (mod && e.shiftKey && k === "b") return order(false), true;
      if (mod && k === "l") return lock(!locked()), true;
      if (mod || e.altKey || !p.length) return false;
      if (e.key === "Delete" || e.key === "Backspace") return remove(), true;
      if (e.key === "Enter" && p.length === 1 && (I.texty(p[0]) || p[0].k === "table") && !p[0].lock) return begin(p[0]), true;
      if (e.key.startsWith("Arrow") && !locked()) {
        const n = e.shiftKey ? 10 : 1, dx = k === "arrowleft" ? -n : k === "arrowright" ? n : 0, dy = k === "arrowup" ? -n : k === "arrowdown" ? n : 0;
        return change((items) => { for (const it of items) I.moveBy(it, dx, dy); }), true;
      }
      return false;
    }

    return { cards, start, move, end, cancel, key, paint, click, insert, finish, pick, closePop, paste, pictures, connectTo, get pending() { return !!pending; }, get clip() { return clip.length; }, tab, get cell() { return edit ? edit.cell : null; }, get editing() { return edit ? edit.it.id : null; }, get busy() { return !!act; } };
  }
  B.select = { make };
})();
