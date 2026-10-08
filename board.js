/* mdview — the whiteboard: a board that stands in a note as a picture (a file *.board.svg, see
 * board/format.js) is opened over the whole window, drawn on, and kept. Loaded on first use
 * (viewer.js: loadBoard), with board.css and board/*.js before it.
 *
 * The host is asked for the file's text (board-read) and handed it back (board-save); the page
 * may not read files itself. One board is open at a time. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const core = window.MdView.core, post = core.post, T = window.MdStrings.t, esc = core.esc;
  const SAVE_MS = 800; // after the last change (as a note's: viewer.js AUTOSAVE_MS)
  const ERASER = 10; // the eraser's radius on the screen
  // the palette's inks, in its order: what is written into the file ("auto": the text's colour, whatever the theme)
  const INKS = [["auto", "auto"], ["blue", "#1f6fe5"], ["green", "#2fa84f"], ["yellow", "#f2b90f"], ["red", "#e5372c"], ["purple", "#8e4fd6"]];
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    back: svg('<path d="M14.5 6 8.5 12l6 6"/>'),
    undo: svg('<path d="M8 5 4 9l4 4"/><path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3"/>'),
    redo: svg('<path d="m16 5 4 4-4 4"/><path d="M20 9H10a5.5 5.5 0 0 0 0 11h3"/>'),
    pen: svg('<path d="m5 19 1.2-4.6L16.5 4.1a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L9.6 17.8z"/><path d="m14.5 6.1 3.4 3.4"/>'),
    mono: svg('<path d="M4 17c3-9 5-9 7-3s4 6 9-7"/>'),
    eraser: svg('<path d="m8.5 19-4-4a1.6 1.6 0 0 1 0-2.3l8.2-8.2a1.6 1.6 0 0 1 2.3 0l4.5 4.5a1.6 1.6 0 0 1 0 2.3L12 19z"/><path d="m8.8 8.6 6.6 6.6M7 19h13"/>'),
    grid: svg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><g fill="currentColor" stroke="none"><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></g>'),
    draw: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5 9 14.5h6z"/><path d="M10 17h4"/>'),
    textbox: svg('<rect x="3.5" y="6" width="17" height="12" rx="2" stroke-dasharray="2.5 2.5"/><path d="M9.5 15 12 9l2.5 6M10.4 13h3.2"/>'),
    shapes: svg('<circle cx="9.5" cy="9.5" r="5.5"/><rect x="10.5" y="10.5" width="10" height="10" rx="2"/>'),
    sticky: svg('<path d="M4.5 5.5h15v9l-5 5h-10z"/><path d="M19.5 14.5h-5v5M8 9.5h8M8 13h4"/>'),
    unlock: svg('<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.7-1.4"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5v-0.5A1.5 1.5 0 0 0 14 3.5H6A2.5 2.5 0 0 0 3.5 6v8A1.5 1.5 0 0 0 5 15.5h0.5"/>'),
    trash: svg('<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l0.8 11.5a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7M10 11v5M14 11v5"/>'),
    fit: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'),
  };

  // ---------------------------------------------------------------- the host
  let seq = 0;
  const waiting = new Map();
  const ask = (type, data) => new Promise((resolve) => { const id = "b" + ++seq; waiting.set(id, resolve); post(type, { ...data, id }); });
  B.answer = (id, ...a) => { const r = waiting.get(id); if (r) { waiting.delete(id); r(a); } };
  /* Which file a picture shows: its address without the host's part — the path the host knows it by. */
  function refOf(img) {
    if (img.dataset.board) return img.dataset.board;
    const base = String((window.MdHost || {}).files || ""), src = String(img.currentSrc || img.src || "").split(/[?#]/)[0];
    if (!base || !src.startsWith(base + "/")) return null;
    try { return decodeURIComponent(src.slice(base.length)); } catch (e) { return null; }
  }
  B.refOf = refOf;
  B.isBoard = (img) => !!img && img.tagName === "IMG" && (img.dataset.board ? true : B.format.isBoard(refOf(img)));
  async function read(ref, url) {
    if (kept.has(ref)) return kept.get(ref); // (as it was left here: the host's copy may be a moment behind)
    if ((window.MdHost || {}).reading) { // a shared note: the visitor's browser may fetch what the note shows, and nothing is asked of a host
      const res = await fetch(url);
      if (!res.ok) throw new Error("not found");
      return res.text();
    }
    const [text, error] = await ask("board-read", { path: ref });
    if (typeof text !== "string") throw new Error(error || "not found");
    return text;
  }

  // ---------------------------------------------------------------- the picture in the note
  /* A board changed here is shown by its picture at once — from what was written, not from the
   * file (whose address is the same as before: the browser would show what it has). */
  const kept = new Map(), urls = new Map();
  let watch = null;
  function show(img) {
    const ref = refOf(img);
    if (!ref || !urls.has(ref) || img.src === urls.get(ref)) return;
    img.dataset.board = ref;
    img.src = urls.get(ref);
  }
  function remember(ref, text) {
    kept.set(ref, text);
    const old = urls.get(ref);
    urls.set(ref, URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })));
    for (const img of document.querySelectorAll("#content img, #active img")) { if (refOf(img) === ref) { img.dataset.board = ref; img.src = urls.get(ref); } }
    if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
    if (!watch) { // … and by every picture of it drawn later (the note read anew, a block rebuilt)
      watch = new MutationObserver((list) => {
        for (const m of list) for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IMG") show(node);
          else for (const img of node.querySelectorAll?.("img") || []) show(img);
        }
      });
      for (const root of document.querySelectorAll("#content, #active")) watch.observe(root, { childList: true, subtree: true });
    }
  }

  // ---------------------------------------------------------------- the window
  let el = null, S = null, hands = null, space = false, sel = null;
  const stage = () => el.querySelector(".bd-stage");
  const size = () => ({ w: el.clientWidth, h: el.clientHeight });
  const auto = () => getComputedStyle(el).getPropertyValue("--fg").trim() || "#1d1d1f";
  const button = (name, key, more = "") => `<button type="button" class="bd-btn" data-do="${name}" title="${esc(T(key))}" aria-label="${esc(T(key))}"${more}>${I[name] || ""}</button>`;
  const DRAWS = ["pen", "mono", "marker"], ALL = [...DRAWS, "eraser", "lasso"];
  /* A tool as it stands in the palette: a flat sign of the thing — a body, a band in its colour
   * (var(--band)), a tip. Drawn here; no picture of anyone's is used. */
  function toolSign(kind) {
    const body = 'fill="var(--bd-tool-body)" stroke="var(--bd-tool-line)"', shade = 'fill="var(--bd-tool-shade)"';
    const barrel = `<rect x="6" y="22" width="18" height="52" rx="3" ${body}/><rect x="6.5" y="22.5" width="5" height="51" ${shade} opacity="0.5"/>`, band = '<rect x="6" y="35" width="18" height="5" fill="var(--band)"/>';
    const tip = {
      pen: `<path d="M9 22 15 5l6 17z" ${shade} stroke="var(--bd-tool-line)"/><path d="M13 10.7 15 5l2 5.7z" fill="var(--band)"/>`,
      mono: `<path d="M11 22l2-9h4l2 9z" ${shade} stroke="var(--bd-tool-line)"/><rect x="14.2" y="4" width="1.6" height="9.5" rx="0.8" fill="var(--bd-tool-dark)"/>`,
      marker: `<path d="M9 22l1-9h10l1 9z" ${shade} stroke="var(--bd-tool-line)"/><path d="M11 13V7.5l8-3V13z" fill="var(--band)"/>`,
      eraser: `<rect x="7" y="7" width="16" height="16" rx="5" fill="var(--bd-tool-rubber)" stroke="var(--bd-tool-line)"/>`,
      lasso: `<ellipse cx="15" cy="12" rx="8.5" ry="6" fill="none" stroke="var(--bd-tool-dark)" stroke-width="1.7" stroke-dasharray="3 2.6"/>`,
    }[kind];
    return `<svg viewBox="0 0 30 72" aria-hidden="true">${barrel}${kind === "eraser" || kind === "lasso" ? "" : band}${tip}</svg>`;
  }
  function build() {
    el = document.createElement("section");
    el.id = "board";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML =
      `<div class="bd-stage"><div class="bd-world"></div><canvas class="bd-ink"></canvas><canvas class="bd-live"></canvas><div class="bd-ring" hidden></div>` +
        `<div class="bd-band" hidden></div><div class="bd-guide bd-guide-v" hidden></div><div class="bd-guide bd-guide-h" hidden></div>` +
        `<div class="bd-pick" hidden>${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((c) => `<i class="bd-dot" data-dot="${c}"></i>`).join("")}<i class="bd-knob"></i><i class="bd-dot" data-dot="a"></i><i class="bd-dot" data-dot="b"></i></div><div class="bd-angle" hidden></div>` +
        `<div class="bd-sel" hidden>${["nw", "ne", "se", "sw"].map((c) => `<i class="bd-dot" data-corner="${c}"></i>`).join("")}</div></div>` +
      `<div class="bd-bar bd-selbar" role="toolbar" hidden>${button("copy", "board.duplicate")}${button("trash", "board.delete")}</div>` +
      `<div class="bd-bar bd-fbar" role="toolbar" hidden></div><div class="bd-fpop ui-menu ui-popover"></div>` +
      `<div class="bd-bar bd-insert" role="toolbar" aria-label="${esc(T("board.insert"))}">${button("draw", "board.mode.draw")}<span class="bd-sep"></span>${button("textbox", "board.insert.text")}${button("shapes", "board.insert.shape")}${button("sticky", "board.insert.sticky")}</div>` +
      `<div class="bd-spop ui-menu ui-popover" role="menu" aria-label="${esc(T("board.insert.shape"))}">${B.items.SHAPES.map((k) => `<button type="button" class="bd-tile" data-shape="${k}" title="${esc(T("board.shape." + k))}" aria-label="${esc(T("board.shape." + k))}"><svg viewBox="-2 -2 32 32"><path d="${B.items.shapePath(k, 28, k === "rect" || k === "round" ? 20 : 28)}" transform="translate(0 ${k === "rect" || k === "round" ? 4 : 0})"/></svg></button>`).join("")}` +
        `<button type="button" class="bd-tile bd-tile-line" data-line="line" title="${esc(T("board.shape.line"))}" aria-label="${esc(T("board.shape.line"))}"><svg viewBox="0 0 28 28"><path d="M4 24 24 4"/></svg></button><button type="button" class="bd-tile bd-tile-line" data-line="arrow" title="${esc(T("board.shape.arrow"))}" aria-label="${esc(T("board.shape.arrow"))}"><svg viewBox="0 0 28 28"><path d="M4 24 24 4M14 4h10v10"/></svg></button></div>` +
      `<div class="bd-bar bd-title" role="toolbar">${button("back", "board.back")}<span class="bd-name"></span><span class="bd-chip" hidden></span></div>` +
      `<div class="bd-bar bd-actions" role="toolbar">${button("undo", "board.undo")}${button("redo", "board.redo")}</div>` +
      `<div class="bd-bar bd-palette" role="toolbar" aria-label="${esc(T("board.tools"))}">` +
        `<span role="radiogroup" class="bd-tools">${ALL.map((t) => `<button type="button" class="bd-tool" role="radio" data-tool="${t}" title="${esc(T("board.tool." + t))}" aria-label="${esc(T("board.tool." + t))}">${toolSign(t)}</button>`).join("")}</span><span class="bd-sep"></span>` +
        `<span role="radiogroup" class="bd-wells" aria-label="${esc(T("board.color"))}">${INKS.map(([name, c]) => `<button type="button" class="bd-well" role="radio" data-ink="${c}" title="${esc(T("board.ink." + name))}" aria-label="${esc(T("board.ink." + name))}" style="--ink:${c === "auto" ? "var(--fg)" : c}"></button>`).join("")}` +
          `<label class="bd-well bd-any" title="${esc(T("board.ink.any"))}"><input type="color" aria-label="${esc(T("board.ink.any"))}"></label></span></div>` +
      `<div class="bd-pop ui-menu ui-popover" role="dialog" aria-label="${esc(T("board.options"))}"></div>` +
      `<div class="bd-bar bd-zoom" role="toolbar"><button type="button" class="bd-btn bd-wide" data-do="actual" title="${esc(T("board.actual"))}"></button>${button("fit", "board.fit")}</div>` +
      `<div class="bd-bar bd-viewbar" role="toolbar">${button("grid", "board.grid")}</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !S) return;
      if (b.closest(".bd-fbar, .bd-fpop")) return void sel.click(b);
      if (b.dataset.shape || b.dataset.line) { shapes(false); setMode("select"); return void (b.dataset.shape ? sel.insert("shape", { shape: b.dataset.shape }) : sel.insert("line", { arrow: b.dataset.line === "arrow" })); }
      if (b.dataset.do === "draw") return setMode(S.mode === "draw" ? "select" : "draw");
      if (b.dataset.do === "textbox" || b.dataset.do === "sticky") { setMode("select"); return void sel.insert(b.dataset.do === "sticky" ? "sticky" : "text"); }
      if (b.dataset.do === "shapes") return shapes();
      if (b.dataset.tool) return b.dataset.tool === S.tool && S.tool !== "lasso" ? options(b) : setTool(b.dataset.tool);
      if (b.dataset.ink) return setInk(b.dataset.ink);
      if (b.dataset.w) return setWidth(Number(b.dataset.w));
      if (b.dataset.mode) return setErase(b.dataset.mode);
      ({ back: () => B.close(), undo: () => step(-1), redo: () => step(1), fit: () => S.view.fit(bounds()), actual: () => { const s = size(); S.view.zoomAt(s.w / 2, s.h / 2, 1); },
        grid: () => { S.model.board.grid = !S.model.board.grid; changed(); paint(); }, copy: duplicate, trash: remove })[b.dataset.do]?.();
    });
    el.querySelector(".bd-any input").addEventListener("input", (e) => setInk(e.target.value));
    el.querySelector(".bd-pop").addEventListener("input", (e) => { if (S && e.target.matches("input[type=range]")) setOpacity(Number(e.target.value) / 100); });
    // the options shut when anything beside them is touched
    el.addEventListener("pointerdown", (e) => {
      if (popOpen() && !e.target.closest(".bd-pop, .bd-tool")) options(null);
      if (!e.target.closest('.bd-spop, [data-do="shapes"]')) shapes(false);
      if (S && e.target.closest(".bd-bar") && !e.target.closest(".bd-fbar")) sel.finish(); // (a bar touched while text is typed: the text is done)
    }, true);
    // text in the board's picture breaks where it breaks on the screen: measured with the same letters
    const meter = document.createElement("canvas").getContext("2d");
    B.items.measure = (text, font) => { meter.font = font; return meter.measureText(text).width; };
    sel = B.select.make({ S: () => S, el: () => el, paint, did, changed, size, onBoard: (pt) => onBoard(pt), T, esc, icons: I });
    new ResizeObserver(() => { if (S) paint(); }).observe(el);
    const mine = () => S && S.mode === "select" && !S.readonly;
    hands = B.pointer.attach(stage(), { start: (pt, e) => (mine() ? sel.start(pt, e) : start(pt)), move: (pts, e) => (sel.busy ? sel.move(pts, e) : move(pts)), end: () => (sel.busy ? sel.end() : end()), cancel: () => (sel.busy ? sel.cancel() : cancel()), hover, space: () => space,
      pan: (dx, dy) => S && S.view.panBy(dx, dy),
      zoom: (f, cx, cy) => S && S.view.zoomAt(cx, cy, S.view.z * f) });
  }
  function boundsOf(items) {
    let b = null;
    for (const it of items) {
      const c = B.format.boundsOf(it);
      if (c) b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : [...c];
    }
    return b;
  }
  const bounds = () => boundsOf(S.model.items);
  /* Where the chosen strokes are on the screen: [left, top, width, height], a little around them. */
  function selRect() {
    const b = S.sel.length ? boundsOf(S.sel) : null, v = S.view, pad = 6;
    return b ? [(b[0] - v.x) * v.z - pad, (b[1] - v.y) * v.z - pad, (b[2] - b[0]) * v.z + 2 * pad, (b[3] - b[1]) * v.z + 2 * pad] : null;
  }
  /* Everything the window shows, from what is so. */
  function paint() {
    if (!S) return;
    const v = S.view, st = stage(), s = size();
    B.ink.draw(el.querySelector(".bd-ink"), S.model.items, v, s, auto(), null);
    const world = el.querySelector(".bd-world");
    world.style.transform = `translate(${-v.x * v.z}px, ${-v.y * v.z}px) scale(${v.z})`;
    B.layer.sync(world, S.model.items, sel.editing);
    el.dataset.mode = S.readonly ? "look" : S.mode;
    el.querySelector('[data-do="draw"]').setAttribute("aria-pressed", String(S.mode === "draw"));
    sel.paint();
    // the dots: every 20 of the board's pixels; fewer of them the smaller the board is shown, so they never crowd
    const every = v.z < 0.25 ? 4 : v.z < 0.5 ? 2 : 1, gap = 20 * every * v.z;
    st.toggleAttribute("data-grid", S.model.board.grid);
    st.style.backgroundSize = `${gap}px ${gap}px`;
    st.style.backgroundPosition = `${-v.x * v.z - gap / 2}px ${-v.y * v.z - gap / 2}px`;
    el.querySelector('[data-do="actual"]').textContent = Math.round(v.z * 100) + " %";
    el.querySelector('[data-do="grid"]').setAttribute("aria-pressed", String(S.model.board.grid));
    el.querySelector('[data-do="undo"]').disabled = !S.undo.length;
    el.querySelector('[data-do="redo"]').disabled = !S.redo.length;
    const set = S.tools[S.tool] || {}, shown = S.sel.length ? (S.sel.every((it) => it.c === S.sel[0].c) ? S.sel[0].c : null) : set.c;
    for (const b of el.querySelectorAll("[data-tool]")) {
      b.setAttribute("aria-checked", String(b.dataset.tool === S.tool));
      const c = (S.tools[b.dataset.tool] || {}).c;
      b.style.setProperty("--band", !c || c === "auto" ? "var(--fg)" : c);
    }
    let known = false;
    for (const b of el.querySelectorAll("[data-ink]")) { const on = b.dataset.ink === shown; known = known || on; b.setAttribute("aria-checked", String(on)); }
    el.querySelector(".bd-any").toggleAttribute("data-on", !!shown && !known);
    el.querySelector(".bd-wells").toggleAttribute("data-off", !S.sel.length && !DRAWS.includes(S.tool)); // (an eraser has no colour)
    st.dataset.tool = S.readonly ? "look" : S.mode === "select" ? "select" : S.tool;
    const ring = el.querySelector(".bd-ring"), d = S.tools.eraser.w;
    ring.style.width = ring.style.height = d + "px";
    if (S.tool !== "eraser") ring.hidden = true;
    // the chosen strokes: their frame, and what can be done with them beside it
    const r = selRect(), frame = el.querySelector(".bd-sel"), bar = el.querySelector(".bd-selbar");
    frame.hidden = bar.hidden = !r;
    if (r) {
      frame.style.transform = `translate(${r[0]}px, ${r[1]}px)`;
      frame.style.width = r[2] + "px"; frame.style.height = r[3] + "px";
      const below = r[1] + r[3] + 12 + 40 < s.h - 90, bw = bar.offsetWidth || 72;
      bar.style.transform = `translate(${Math.max(8, Math.min(s.w - bw - 8, r[0] + r[2] / 2 - bw / 2))}px, ${below ? r[1] + r[3] + 12 : Math.max(60, r[1] - 12 - 36)}px)`;
      bar.toggleAttribute("data-moving", !!(S.act && S.act.grab));
    }
  }
  function live(item, loop = null) {
    const c = el.querySelector(".bd-live"), s = size(), dpr = window.devicePixelRatio || 1, ctx = c.getContext("2d"), v = S.view;
    if (c.width !== Math.round(s.w * dpr) || c.height !== Math.round(s.h * dpr)) { c.width = Math.round(s.w * dpr); c.height = Math.round(s.h * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!item && !loop) return;
    const k = dpr * v.z;
    ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
    if (item) B.ink.trace(ctx, item, auto());
    ctx.globalAlpha = 1;
    if (loop && loop.length > 1) { // the lasso's line: dashes of one size on the screen, whatever the zoom
      ctx.beginPath();
      ctx.moveTo(loop[0][0], loop[0][1]);
      for (const p of loop) ctx.lineTo(p[0], p[1]);
      ctx.setLineDash([5 / v.z, 4 / v.z]);
      ctx.lineWidth = 1.5 / v.z;
      ctx.strokeStyle = getComputedStyle(el).getPropertyValue("--accent").trim() || auto();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---------------------------------------------------------------- tools and what they are set to
  const KEEP = "mdview:board-tools"; // (in this browser, for this person: the next board begins with the same pen)
  function toolsNow() {
    const t = JSON.parse(JSON.stringify(B.ink.TOOLS));
    try {
      const was = JSON.parse(localStorage.getItem(KEEP) || "{}");
      for (const k of Object.keys(t)) for (const f of ["c", "w", "o", "mode"]) if (was[k] && typeof was[k][f] === typeof t[k][f] && f in t[k]) t[k][f] = was[k][f];
    } catch (e) { /* (nothing kept, or not allowed to keep: as new) */ }
    return t;
  }
  function keepTools() {
    try { localStorage.setItem(KEEP, JSON.stringify(Object.fromEntries(Object.entries(S.tools).map(([k, v]) => [k, { c: v.c, w: v.w, o: v.o, mode: v.mode }])))); } catch (e) { /* (as above) */ }
  }
  const popOpen = () => el.querySelector(".bd-pop").hasAttribute("data-open");
  /* The drawing tools in hand (draw), or put away: the pointer chooses and moves what stands on the board (select). */
  function setMode(m) {
    if (S.readonly || S.mode === m) return;
    options(null);
    sel.finish(); sel.closePop();
    S.sel = []; S.pick = [];
    S.mode = m;
    paint();
  }
  function shapes(on = !el.querySelector(".bd-spop").hasAttribute("data-open")) {
    const p = el.querySelector(".bd-spop");
    if (!on) { delete p.dataset.open; return; }
    const r = el.querySelector('[data-do="shapes"]').getBoundingClientRect(), box = el.getBoundingClientRect();
    p.style.left = Math.round(Math.max(8, Math.min(box.width - p.offsetWidth - 8, r.left - box.left + r.width / 2 - p.offsetWidth / 2))) + "px";
    p.style.top = Math.round(r.bottom - box.top + 8) + "px";
    p.dataset.open = "";
  }
  function setTool(t) {
    if (!ALL.includes(t) || S.readonly) return;
    options(null);
    if (S.mode !== "draw") { sel.finish(); sel.closePop(); S.pick = []; S.mode = "draw"; }
    if (t !== "lasso") S.sel = [];
    S.tool = t;
    paint();
  }
  /* A colour chosen: the chosen strokes take it; else the tool does (an eraser or a lasso in hand: the pen is taken up). */
  function setInk(c) {
    if (S.sel.length) {
      const was = S.sel.map((it) => [it, it.c]);
      const to = (list) => { for (const [it, col] of list) { it.c = col; it.path = null; } };
      to(was.map(([it]) => [it, c]));
      did({ undo: () => to(was), redo: () => to(was.map(([it]) => [it, c])) });
      return paint();
    }
    if (!DRAWS.includes(S.tool)) S.tool = "pen";
    S.tools[S.tool].c = c;
    keepTools();
    paint();
  }
  function setWidth(w) { S.tools[S.tool].w = w; keepTools(); options(el.querySelector(`[data-tool="${S.tool}"]`), true); paint(); }
  function setOpacity(o) { S.tools[S.tool].o = Math.max(0.1, Math.min(1, o)); keepTools(); const out = el.querySelector(".bd-pop output"); if (out) out.textContent = Math.round(S.tools[S.tool].o * 100) + " %"; }
  function setErase(m) { S.tools.eraser.mode = m === "pixel" ? "pixel" : "object"; keepTools(); options(el.querySelector('[data-tool="eraser"]'), true); }
  /* The chosen tool's options, over it: how wide, how see-through; for the eraser what it takes. anchor null: shut. */
  function options(anchor, again = false) {
    const pop = el.querySelector(".bd-pop");
    if (!anchor || (popOpen() && !again)) { delete pop.dataset.open; return; }
    const t = S.tool, set = S.tools[t], most = Math.max(...B.ink.TOOLS[t].widths);
    const widths = `<div class="bd-widths" role="radiogroup" aria-label="${esc(T("board.width"))}">${B.ink.TOOLS[t].widths.map((w) => `<button type="button" class="bd-width" role="radio" data-w="${w}" aria-checked="${w === set.w}" aria-label="${w}"><i style="width:${Math.max(3, Math.round((w / most) * 22))}px;height:${Math.max(3, Math.round((w / most) * 22))}px"></i></button>`).join("")}</div>`;
    pop.innerHTML = t === "eraser"
      ? `<div class="bd-seg" role="radiogroup">${["object", "pixel"].map((m) => `<button type="button" role="radio" data-mode="${m}" aria-checked="${set.mode === m}">${esc(T("board.eraser." + m))}</button>`).join("")}</div>${widths}`
      : `${widths}<label class="bd-opacity"><span>${esc(T("board.opacity"))}</span><input type="range" min="10" max="100" step="1" value="${Math.round(set.o * 100)}"><output>${Math.round(set.o * 100)} %</output></label>`;
    const r = anchor.getBoundingClientRect(), box = el.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(box.width - pop.offsetWidth - 8, r.left - box.left + r.width / 2 - pop.offsetWidth / 2)) + "px";
    pop.style.bottom = box.bottom - el.querySelector(".bd-palette").getBoundingClientRect().top + 10 + "px";
    pop.dataset.open = "";
  }

  // ---------------------------------------------------------------- changes, and taking them back
  function changed() {
    S.dirty = true;
    clearTimeout(S.timer);
    S.timer = setTimeout(save, SAVE_MS);
  }
  function did(act) { // act: { undo(), redo() } — already done once
    S.undo.push(act);
    S.redo.length = 0;
    changed();
  }
  /* What the board holds was put together anew (an eraser went through it, strokes were taken or added): before → now. */
  function replaced(before, sel = null) {
    const now = [...S.model.items], selNow = [...S.sel], selWas = sel || [];
    did({ undo: () => { S.model.items = [...before]; S.sel = selWas.filter((it) => before.includes(it)); }, redo: () => { S.model.items = [...now]; S.sel = selNow.filter((it) => now.includes(it)); } });
  }
  function step(dir) {
    const from = dir < 0 ? S.undo : S.redo, to = dir < 0 ? S.redo : S.undo, act = from.pop();
    if (!act) return;
    (dir < 0 ? act.undo : act.redo)();
    S.sel = S.sel.filter((it) => S.model.items.includes(it));
    S.pick = S.pick.filter((it) => S.model.items.includes(it));
    to.push(act);
    changed();
    paint();
  }
  function save() {
    if (!S || !S.dirty || S.readonly) return;
    clearTimeout(S.timer);
    S.dirty = false;
    const s = S, v = s.view;
    s.model.board.view = { x: v.x, y: v.y, z: v.z };
    const text = B.format.write(s.model);
    remember(s.ref, text);
    ask("board-save", { path: s.ref, text }).then(([error]) => {
      if (S !== s) { if (error) core.toast(T("board.notSaved")); return; }
      chip(error ? T("board.notSaved") : s.model.lost ? T("board.lost", s.model.lost) : "", !!error);
      if (error) s.failed = text;
    });
  }
  function chip(text, bad = false) {
    const c = el.querySelector(".bd-chip");
    c.textContent = text;
    c.hidden = !text;
    c.toggleAttribute("data-bad", bad);
  }
  function duplicate() {
    if (!S.sel.length) return;
    const before = [...S.model.items], was = [...S.sel];
    const copies = S.sel.map((it) => { const c = { ...it, id: B.format.id(), pts: it.pts.map((p) => [...p]), path: null, box: null }; B.ink.moved(c, (p) => [p[0] + 16, p[1] + 16]); return c; });
    S.model.items.push(...copies);
    S.sel = copies;
    replaced(before, was);
    paint();
  }
  function remove() {
    if (!S.sel.length) return;
    const before = [...S.model.items], was = [...S.sel], gone = new Set(S.sel);
    S.model.items = S.model.items.filter((it) => !gone.has(it));
    S.sel = [];
    replaced(before, was);
    paint();
  }

  // ---------------------------------------------------------------- the hand
  const HOLD_MS = 500, STILL = 4; // a hand resting this long, within this many pixels: the stroke is made clean
  const onBoard = (pt) => { const [x, y] = S.view.toBoard(pt.x, pt.y); return { ...pt, x, y }; };
  function start(pt) {
    if (!S || S.readonly) return false;
    options(null);
    if (S.tool === "eraser") { S.act = { erase: true, before: [...S.model.items], at: pt }; erase(pt); return true; }
    if (S.tool === "lasso") return grab(pt);
    S.act = { stroke: B.ink.begin(S.tool, S.tools[S.tool], onBoard(pt), S.view.z), still: pt };
    live(S.act.stroke.item);
    bars(true);
    return true;
  }
  /* The lasso put down: on a corner of the chosen strokes' frame (they are pulled larger or
   * smaller), inside it (they are moved), on a stroke (it is chosen, and moved if the hand goes
   * on), else on the bare board: a loop begins. */
  function grab(pt) {
    const p = onBoard(pt), r = selRect();
    if (r) {
      const corner = [["nw", r[0], r[1]], ["ne", r[0] + r[2], r[1]], ["se", r[0] + r[2], r[1] + r[3]], ["sw", r[0], r[1] + r[3]]].find(([, x, y]) => Math.hypot(pt.x - x, pt.y - y) <= 14);
      const b = boundsOf(S.sel);
      if (corner) {
        const anchor = { nw: [b[2], b[3]], ne: [b[0], b[3]], se: [b[0], b[1]], sw: [b[2], b[1]] }[corner[0]];
        S.act = { grab: "size", anchor, from: Math.hypot(p.x - anchor[0], p.y - anchor[1]) || 1, was: S.sel.map((it) => ({ it, pts: it.pts, w: it.w })) };
        return true;
      }
      if (pt.x >= r[0] && pt.x <= r[0] + r[2] && pt.y >= r[1] && pt.y <= r[1] + r[3]) return held(p);
    }
    const hit = B.ink.touched(S.model.items, p.x, p.y, 6 / S.view.z);
    if (hit.length) { S.sel = [hit[hit.length - 1]]; paint(); return held(p); }
    S.act = { loop: [[p.x, p.y]], was: [...S.sel] };
    return true;
  }
  function held(p) {
    S.act = { grab: "move", at: [p.x, p.y], first: [p.x, p.y], was: S.sel.map((it) => ({ it, pts: it.pts, w: it.w })) };
    return true;
  }
  function move(pts) {
    if (!S || !S.act) return;
    const act = S.act, lastPt = pts[pts.length - 1];
    if (act.erase) { // (the whole way since the last sample: a quick hand skips nothing)
      for (const p of pts) {
        const a = act.at, n = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / Math.max(2, S.tools.eraser.w / 4)));
        for (let i = 1; i <= n; i++) erase({ ...p, x: a.x + ((p.x - a.x) * i) / n, y: a.y + ((p.y - a.y) * i) / n });
        act.at = p;
      }
      return ring(lastPt);
    }
    if (act.loop) { for (const pt of pts) { const p = onBoard(pt); act.loop.push([p.x, p.y]); } return live(null, act.loop); }
    if (act.grab === "move") {
      const p = onBoard(lastPt), dx = p.x - act.at[0], dy = p.y - act.at[1];
      if (!dx && !dy) return;
      for (const it of S.sel) B.ink.moved(it, (q) => [q[0] + dx, q[1] + dy]);
      act.at = [p.x, p.y];
      return paint();
    }
    if (act.grab === "size") {
      const p = onBoard(lastPt), [ax, ay] = act.anchor, k = Math.max(0.05, Math.hypot(p.x - ax, p.y - ay) / act.from);
      for (const w of act.was) { w.it.pts = w.pts; w.it.w = w.w; B.ink.moved(w.it, (q) => [ax + (q[0] - ax) * k, ay + (q[1] - ay) * k], k); }
      return paint();
    }
    const item = act.stroke.item;
    if (act.shape) { // made clean already: a line's end still follows the hand, the others stand
      if (act.shape !== "line") return;
      const p = onBoard(lastPt);
      item.pts[1] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 0.5, 0];
      item.path = null; item.box = null;
      return live(item);
    }
    let more = false;
    for (const p of pts) more = act.stroke.add(onBoard(p)) || more;
    if (more) live(item);
    if (Math.hypot(lastPt.x - act.still.x, lastPt.y - act.still.y) > STILL || !act.hold) {
      act.still = lastPt;
      clearTimeout(act.hold);
      act.hold = setTimeout(() => {
        if (!S || S.act !== act || act.shape) return;
        const g = B.shape.guess(item.pts);
        if (!g) return;
        item.pts = g.pts; item.path = null; item.box = null;
        if (g.sharp) item.sharp = true; else delete item.sharp;
        act.shape = g.kind;
        live(item);
      }, HOLD_MS);
    }
  }
  function erase(pt) {
    const p = onBoard(pt), r = S.tools.eraser.w / 2 / S.view.z, items = S.model.items;
    if (S.tools.eraser.mode === "object") {
      const hit = new Set(B.ink.touched(items, p.x, p.y, r));
      if (!hit.size) return;
      S.model.items = items.filter((it) => !hit.has(it));
      return paint();
    }
    // a part of each stroke under it: the stroke is cut, its first piece keeps its name
    let any = false;
    const next = [];
    for (const it of items) {
      const b = it.k === "ink" ? B.format.boundsOf(it) : null;
      const pieces = b && p.x >= b[0] - r && p.x <= b[2] + r && p.y >= b[1] - r && p.y <= b[3] + r ? B.shape.cut(it.pts, p.x, p.y, r) : null;
      if (!pieces) { next.push(it); continue; }
      any = true;
      pieces.forEach((piece, i) => next.push({ ...it, id: i ? B.format.id() : it.id, pts: piece, path: null, box: null }));
    }
    if (!any) return;
    S.model.items = next;
    paint();
  }
  function end() {
    if (!S || !S.act) return;
    const act = S.act;
    S.act = null;
    clearTimeout(act.hold);
    bars(false);
    if (act.erase) {
      if (S.model.items.length !== act.before.length || S.model.items.some((it, i) => it !== act.before[i])) replaced(act.before);
      return paint();
    }
    if (act.loop) {
      live(null);
      const far = act.loop.some((p) => Math.hypot(p[0] - act.loop[0][0], p[1] - act.loop[0][1]) * S.view.z > 6);
      S.sel = far ? B.ink.circled(S.model.items, act.loop) : []; // (a tap on the bare board: nothing is chosen)
      return paint();
    }
    if (act.grab) {
      const now = act.was.map((w) => ({ it: w.it, pts: w.it.pts, w: w.it.w }));
      if (now.some((n, i) => n.pts !== act.was[i].pts)) {
        const put = (list) => { for (const w of list) { w.it.pts = w.pts; w.it.w = w.w; w.it.path = null; w.it.box = null; } };
        did({ undo: () => put(act.was), redo: () => put(now) });
      }
      return paint();
    }
    const item = act.stroke.item;
    S.model.items.push(item);
    did({ undo: () => { S.model.items = S.model.items.filter((it) => it !== item); }, redo: () => { S.model.items.push(item); } });
    paint(); // (the stroke is in the ink before the one under the hand is taken away: no frame without it)
    live(null);
  }
  function cancel() {
    if (!S || !S.act) return;
    const act = S.act;
    S.act = null;
    clearTimeout(act.hold);
    if (act.erase) S.model.items = act.before;
    if (act.grab) for (const w of act.was) { w.it.pts = w.pts; w.it.w = w.w; w.it.path = null; w.it.box = null; }
    if (act.loop) S.sel = act.was;
    bars(false);
    live(null);
    paint();
  }
  function ring(pt) {
    const r = el.querySelector(".bd-ring"), on = !!pt && S && !S.readonly && S.tool === "eraser" && pt.type !== "touch";
    r.hidden = !on;
    if (on) r.style.transform = `translate(${pt.x - S.tools.eraser.w / 2}px, ${pt.y - S.tools.eraser.w / 2}px)`;
  }
  function hover(pt) { if (S) ring(pt); }
  // the bars step back while a stroke runs under them
  const bars = (drawing) => el.toggleAttribute("data-drawing", drawing);

  // ---------------------------------------------------------------- keys
  function keydown(e) {
    if (!S) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "q") return; // (the application's: it asks the page for what is unsaved, which leave() hands over)
    e.stopPropagation(); // nothing of this is the note's under the board
    if (sel.editing || e.target.isContentEditable) { if (e.key === "Escape") { e.preventDefault(); sel.finish(); } return; } // (text being typed: the keys are its own)
    if (e.target.matches?.("input[type=range]") && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) return; // (the slider's own)
    const done = () => e.preventDefault();
    if (e.key === " " && !mod) { space = true; stage().dataset.space = ""; return done(); }
    if (S.mode === "select" && !S.readonly && sel.key(e)) return done();
    if (e.key === "Escape") { // one thing at a time: the options, what is chosen, then the board itself
      done();
      if (el.querySelector(".bd-spop").hasAttribute("data-open")) return shapes(false);
      if (popOpen()) return options(null);
      if (S.sel.length) { S.sel = []; return paint(); }
      return B.close();
    }
    if (mod && k === "w") { done(); return B.close(); }
    if (mod && k === "s") { done(); return save(); }
    if (mod && k === "z") { done(); return step(e.shiftKey ? 1 : -1); }
    if (mod && k === "y") { done(); return step(1); }
    const s = size();
    if (mod && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")) { done(); return S.view.step(1); }
    if (mod && (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract")) { done(); return S.view.step(-1); }
    if (mod && (e.key === "0" || e.code === "Numpad0")) { done(); return S.view.fit(bounds()); }
    if (mod && e.key === "1") { done(); return S.view.zoomAt(s.w / 2, s.h / 2, 1); }
    if (S.readonly) return;
    if (mod && k === "a") { done(); S.mode = "draw"; S.tool = "lasso"; S.sel = S.model.items.filter((it) => it.k === "ink"); return paint(); }
    if (mod && k === "d") { done(); return duplicate(); }
    if (mod || e.altKey) return;
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel.length) { done(); return remove(); }
    const tool = { p: "pen", 1: "pen", f: "mono", 2: "mono", m: "marker", 3: "marker", e: "eraser", 4: "eraser", l: "lasso", 5: "lasso" }[k];
    if (tool) { done(); return setTool(tool); }
    if (k === "v") { done(); return setMode("select"); }
    if (k === "t" || k === "n") { done(); setMode("select"); return void sel.insert(k === "t" ? "text" : "sticky"); }
    if (e.key.startsWith("Arrow")) {
      done();
      const dx = k === "arrowleft" ? -1 : k === "arrowright" ? 1 : 0, dy = k === "arrowup" ? -1 : k === "arrowdown" ? 1 : 0;
      if (!S.sel.length) return S.view.panBy(-dx * (e.shiftKey ? 200 : 40), -dy * (e.shiftKey ? 200 : 40));
      // what is chosen is nudged: a pixel, with Shift ten
      const n = e.shiftKey ? 10 : 1, was = S.sel.map((it) => ({ it, pts: it.pts })), put = (list) => { for (const w of list) { w.it.pts = w.pts; w.it.path = null; w.it.box = null; } };
      for (const it of S.sel) B.ink.moved(it, (q) => [q[0] + dx * n, q[1] + dy * n]);
      const now = S.sel.map((it) => ({ it, pts: it.pts }));
      did({ undo: () => put(was), redo: () => put(now) });
      return paint();
    }
  }
  function keyup(e) {
    if (!S) return;
    e.stopPropagation();
    if (e.key === " ") { space = false; delete stage().dataset.space; }
  }
  const hidden = () => { if (document.visibilityState === "hidden") save(); };

  // ---------------------------------------------------------------- opening and closing
  /* The place the board grows out of and goes back into: its picture in the note. */
  function fromRect(img) {
    if (!img || !img.isConnected) return null;
    const r = (img.closest(".board-block") || img).getBoundingClientRect();
    return r.width && r.height ? r : null;
  }
  const place = (r) => (r ? `translate(${r.left}px, ${r.top}px) scale(${r.width / (el.clientWidth || innerWidth)}, ${r.height / (el.clientHeight || innerHeight)})` : "scale(0.97)");

  /* img: the board's picture in the note. */
  B.open = async (img) => {
    if (S || !B.isBoard(img)) return false;
    const ref = refOf(img), cur = core.current || {};
    if (!el) build();
    const s = (S = { ref, img, readonly: !!((window.MdHost || {}).reading || cur.readonly), model: B.format.fresh(), view: B.view.make(size, paint), undo: [], redo: [], dirty: false, timer: 0, tool: "pen", tools: toolsNow(), sel: [], act: null, mode: "draw", pick: [] });
    core.lockScroll(true);
    post("board-open", { on: true });
    el.setAttribute("aria-label", T("board.name"));
    el.querySelector(".bd-name").textContent = T("board.name");
    el.toggleAttribute("data-readonly", s.readonly);
    chip("");
    options(null);
    // from the picture's place to the whole window
    el.hidden = false;
    el.style.transition = "none";
    el.style.transform = place(fromRect(img));
    el.style.opacity = "0";
    void el.offsetWidth;
    el.style.transition = el.style.transform = el.style.opacity = "";
    el.dataset.open = "";
    addEventListener("keydown", keydown, true);
    addEventListener("keyup", keyup, true);
    document.addEventListener("visibilitychange", hidden);
    addEventListener("pagehide", save);
    addEventListener("blur", save);
    el.focus({ preventScroll: true });
    paint();
    try {
      const model = B.format.parse(await read(ref, img.src));
      if (S !== s) return false;
      s.model = model;
      if (model.board.view) s.view.set(model.board.view.x, model.board.view.y, model.board.view.z); else s.view.fit(bounds());
      if (model.lost) chip(T("board.lost", model.lost));
      el.dataset.ready = "";
    } catch (e) {
      if (S === s) { s.readonly = true; B.close(); }
      core.toast(T("board.cantOpen"));
      return false;
    }
    return true;
  };
  /* quick: no way back to watch (the note under the board is being left). */
  B.close = (quick = false) => {
    if (!S) return;
    if (S.act) cancel();
    sel.cancel(); sel.finish(); sel.closePop(); shapes(false);
    save();
    const s = S;
    S = null; space = false;
    removeEventListener("keydown", keydown, true);
    removeEventListener("keyup", keyup, true);
    document.removeEventListener("visibilitychange", hidden);
    removeEventListener("pagehide", save);
    removeEventListener("blur", save);
    core.lockScroll(false);
    post("board-open", { on: false });
    delete el.dataset.open; delete el.dataset.ready;
    const done = () => { if (!S) { el.hidden = true; el.style.transform = ""; } };
    if (quick) return done();
    const img = [...document.querySelectorAll("#content img, #active img")].find((i) => i.offsetParent && refOf(i) === s.ref) || s.img;
    el.style.transform = place(fromRect(img));
    setTimeout(done, 400);
    if (img && img.isConnected) img.closest("[tabindex], .pm, body")?.focus?.({ preventScroll: true });
  };
  /* The note under the board is being left, or the window closed: what is unsaved goes to the host now. */
  B.leave = () => B.close(true);
  B.pinch = (phase, scale) => {
    if (!S) return;
    if (phase === "begin") S.pinch = S.view.z;
    else if (S.pinch) { const s = size(); S.view.zoomAt(s.w / 2, s.h / 2, S.pinch * scale); }
  };
  Object.defineProperty(B, "shown", { get: () => !!S });
  /* For the tests: what is open, as it is. */
  B.state = () => (S ? { view: { x: S.view.x, y: S.view.y, z: S.view.z }, mode: S.mode, picked: S.pick.map((it) => it.id), things: S.model.items.filter((it) => it.k !== "ink").map((it) => JSON.parse(JSON.stringify(it))), editing: sel.editing, ref: S.ref, items: S.model.items.filter((it) => it.k === "ink").length, tool: S.tool, ink: (S.tools[S.tool] || {}).c, tools: S.tools, chosen: S.sel.length, chosenBox: S.sel.length ? boundsOf(S.sel).map(Math.round) : null, inks: S.model.items.filter((it) => it.k === "ink").map((it) => it.c), options: popOpen(), kinds: S.model.items.filter((it) => it.k === "ink").map((it) => it.t + (it.sharp ? "!" : "") + ":" + it.pts.length), zoom: S.view.z, dirty: S.dirty, readonly: S.readonly, undo: S.undo.length, redo: S.redo.length, lost: S.model.lost } : null);
  B.pick = (ids) => { if (S) { if (S.mode !== "select") setMode("select"); sel.pick(S.model.items.filter((it) => ids.includes(it.id))); } }; // (for the tests: chosen by name, whatever lies over it)
  /* A new board's text, and what a board's picture shows, for those who put one into a note. */
  B.emptyText = () => B.format.empty();
})();
