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
  let el = null, S = null, hands = null, space = false;
  const stage = () => el.querySelector(".bd-stage");
  const size = () => ({ w: el.clientWidth, h: el.clientHeight });
  const auto = () => getComputedStyle(el).getPropertyValue("--fg").trim() || "#1d1d1f";
  const button = (name, key, more = "") => `<button type="button" class="bd-btn" data-do="${name}" title="${esc(T(key))}" aria-label="${esc(T(key))}"${more}>${I[name] || ""}</button>`;
  function build() {
    el = document.createElement("section");
    el.id = "board";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML =
      `<div class="bd-stage"><canvas class="bd-ink"></canvas><canvas class="bd-live"></canvas><div class="bd-ring" hidden></div></div>` +
      `<div class="bd-bar bd-title" role="toolbar">${button("back", "board.back")}<span class="bd-name"></span><span class="bd-chip" hidden></span></div>` +
      `<div class="bd-bar bd-actions" role="toolbar">${button("undo", "board.undo")}${button("redo", "board.redo")}</div>` +
      `<div class="bd-bar bd-tools" role="toolbar" aria-label="${esc(T("board.tools"))}">` +
        `<span role="radiogroup" class="bd-group">${["pen", "mono", "eraser"].map((t) => button(t, "board.tool." + t, ` role="radio" data-tool="${t}"`)).join("")}</span><span class="bd-sep"></span>` +
        `<span role="radiogroup" class="bd-group bd-wells" aria-label="${esc(T("board.color"))}">${INKS.map(([name, c]) => `<button type="button" class="bd-well" role="radio" data-ink="${c}" title="${esc(T("board.ink." + name))}" aria-label="${esc(T("board.ink." + name))}" style="--ink:${c === "auto" ? "var(--fg)" : c}"></button>`).join("")}</span></div>` +
      `<div class="bd-bar bd-zoom" role="toolbar"><button type="button" class="bd-btn bd-wide" data-do="actual" title="${esc(T("board.actual"))}"></button>${button("fit", "board.fit")}</div>` +
      `<div class="bd-bar bd-viewbar" role="toolbar">${button("grid", "board.grid")}</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !S) return;
      if (b.dataset.tool) return setTool(b.dataset.tool);
      if (b.dataset.ink) return setInk(b.dataset.ink);
      ({ back: () => B.close(), undo: () => step(-1), redo: () => step(1), fit: () => S.view.fit(bounds()), actual: () => { const s = size(); S.view.zoomAt(s.w / 2, s.h / 2, 1); },
        grid: () => { S.model.board.grid = !S.model.board.grid; changed(); paint(); } })[b.dataset.do]?.();
    });
    new ResizeObserver(() => { if (S) paint(); }).observe(el);
    hands = B.pointer.attach(stage(), { start, move, end, cancel, hover, space: () => space,
      pan: (dx, dy) => S && S.view.panBy(dx, dy),
      zoom: (f, cx, cy) => S && S.view.zoomAt(cx, cy, S.view.z * f) });
  }
  function bounds() {
    let b = null;
    for (const it of S.model.items) {
      const c = B.format.boundsOf(it);
      if (c) b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : [...c];
    }
    return b;
  }
  /* Everything the window shows, from what is so. */
  function paint() {
    if (!S) return;
    const v = S.view, st = stage(), s = size();
    B.ink.draw(el.querySelector(".bd-ink"), S.model.items, v, s, auto(), S.hidden);
    // the dots: every 20 of the board's pixels; fewer of them the smaller the board is shown, so they never crowd
    const every = v.z < 0.25 ? 4 : v.z < 0.5 ? 2 : 1, gap = 20 * every * v.z;
    st.toggleAttribute("data-grid", S.model.board.grid);
    st.style.backgroundSize = `${gap}px ${gap}px`;
    st.style.backgroundPosition = `${-v.x * v.z - gap / 2}px ${-v.y * v.z - gap / 2}px`;
    el.querySelector('[data-do="actual"]').textContent = Math.round(v.z * 100) + " %";
    el.querySelector('[data-do="grid"]').setAttribute("aria-pressed", String(S.model.board.grid));
    el.querySelector('[data-do="undo"]').disabled = !S.undo.length;
    el.querySelector('[data-do="redo"]').disabled = !S.redo.length;
    for (const b of el.querySelectorAll("[data-tool]")) b.setAttribute("aria-checked", String(b.dataset.tool === S.tool));
    for (const b of el.querySelectorAll("[data-ink]")) b.setAttribute("aria-checked", String(b.dataset.ink === S.ink));
    st.dataset.tool = S.readonly ? "look" : S.tool;
  }
  function live(item) {
    const c = el.querySelector(".bd-live"), s = size(), dpr = window.devicePixelRatio || 1, ctx = c.getContext("2d"), v = S.view;
    if (c.width !== Math.round(s.w * dpr) || c.height !== Math.round(s.h * dpr)) { c.width = Math.round(s.w * dpr); c.height = Math.round(s.h * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!item) return;
    const k = dpr * v.z;
    ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
    B.ink.trace(ctx, item, auto());
    ctx.globalAlpha = 1;
  }
  const setTool = (t) => { S.tool = t; paint(); };
  const setInk = (c) => { S.ink = c; if (S.tool === "eraser") S.tool = "pen"; paint(); };

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
  function step(dir) {
    const from = dir < 0 ? S.undo : S.redo, to = dir < 0 ? S.redo : S.undo, act = from.pop();
    if (!act) return;
    (dir < 0 ? act.undo : act.redo)();
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

  // ---------------------------------------------------------------- the hand
  const onBoard = (pt) => { const [x, y] = S.view.toBoard(pt.x, pt.y); return { ...pt, x, y }; };
  function start(pt) {
    if (!S || S.readonly) return false;
    if (S.tool === "eraser") { S.act = { erased: [], at: pt }; S.hidden = new Set(); erase(pt); return true; }
    S.act = { stroke: B.ink.begin(S.tool, S.ink, onBoard(pt), S.view.z) };
    live(S.act.stroke.item);
    bars(true);
    return true;
  }
  function move(pts) {
    if (!S || !S.act) return;
    if (S.act.erased) { // (the whole way since the last sample: a quick hand skips nothing)
      for (const p of pts) {
        const a = S.act.at, n = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / (ERASER / 2)));
        for (let i = 1; i <= n; i++) erase({ ...p, x: a.x + ((p.x - a.x) * i) / n, y: a.y + ((p.y - a.y) * i) / n });
        S.act.at = p;
      }
      return ring(pts[pts.length - 1]);
    }
    let more = false;
    for (const p of pts) more = S.act.stroke.add(onBoard(p)) || more;
    if (more) live(S.act.stroke.item);
  }
  function erase(pt) {
    const p = onBoard(pt), hit = B.ink.touched(S.model.items, p.x, p.y, ERASER / S.view.z).filter((it) => !S.hidden.has(it.id));
    if (!hit.length) return;
    for (const it of hit) { S.hidden.add(it.id); S.act.erased.push(it); }
    paint();
  }
  function end() {
    if (!S || !S.act) return;
    const act = S.act, items = S.model.items;
    S.act = null;
    bars(false);
    if (act.erased) {
      S.hidden = null;
      if (!act.erased.length) return;
      const gone = new Set(act.erased.map((it) => it.id)), before = [...items];
      const without = () => { S.model.items = S.model.items.filter((it) => !gone.has(it.id)); };
      without();
      did({ undo: () => { S.model.items = before.filter((it) => gone.has(it.id) || S.model.items.includes(it)); }, redo: without });
      return paint();
    }
    const item = act.stroke.item;
    items.push(item);
    did({ undo: () => { S.model.items = S.model.items.filter((it) => it !== item); }, redo: () => { S.model.items.push(item); } });
    paint(); // (the stroke is in the ink before the one under the hand is taken away: no frame without it)
    live(null);
  }
  function cancel() {
    if (!S || !S.act) return;
    S.act = null; S.hidden = null;
    bars(false);
    live(null);
    paint();
  }
  function ring(pt) {
    const r = el.querySelector(".bd-ring"), on = !!pt && S && !S.readonly && S.tool === "eraser" && pt.type !== "touch";
    r.hidden = !on;
    if (on) r.style.transform = `translate(${pt.x - ERASER}px, ${pt.y - ERASER}px)`;
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
    const done = () => e.preventDefault();
    if (e.key === " " && !mod) { space = true; stage().dataset.space = ""; return done(); }
    if (e.key === "Escape") { done(); return B.close(); }
    if (mod && k === "w") { done(); return B.close(); }
    if (mod && k === "s") { done(); return save(); }
    if (mod && k === "z") { done(); return step(e.shiftKey ? 1 : -1); }
    if (mod && k === "y") { done(); return step(1); }
    const s = size();
    if (mod && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")) { done(); return S.view.step(1); }
    if (mod && (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract")) { done(); return S.view.step(-1); }
    if (mod && (e.key === "0" || e.code === "Numpad0")) { done(); return S.view.fit(bounds()); }
    if (mod && e.key === "1") { done(); return S.view.zoomAt(s.w / 2, s.h / 2, 1); }
    if (mod || e.altKey || S.readonly) return;
    if (k === "p" || k === "1") { done(); return setTool("pen"); }
    if (k === "m" || k === "2") { done(); return setTool("mono"); }
    if (k === "e" || k === "3") { done(); return setTool("eraser"); }
    if (e.key.startsWith("Arrow")) { done(); const d = e.shiftKey ? 200 : 40; return S.view.panBy(k === "arrowleft" ? d : k === "arrowright" ? -d : 0, k === "arrowup" ? d : k === "arrowdown" ? -d : 0); }
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
    const s = (S = { ref, img, readonly: !!((window.MdHost || {}).reading || cur.readonly), model: B.format.fresh(), view: B.view.make(size, paint), undo: [], redo: [], dirty: false, timer: 0, tool: "pen", ink: "auto", act: null, hidden: null });
    core.lockScroll(true);
    post("board-open", { on: true });
    el.setAttribute("aria-label", T("board.name"));
    el.querySelector(".bd-name").textContent = T("board.name");
    el.toggleAttribute("data-readonly", s.readonly);
    chip("");
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
  B.state = () => (S ? { ref: S.ref, items: S.model.items.length, tool: S.tool, ink: S.ink, zoom: S.view.z, dirty: S.dirty, readonly: S.readonly, undo: S.undo.length, redo: S.redo.length, lost: S.model.lost } : null);
  /* A new board's text, and what a board's picture shows, for those who put one into a note. */
  B.emptyText = () => B.format.empty();
})();
