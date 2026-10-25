/* mdview, the page — the iPad's own layout (Henri chose it, 2026-10-20: Craft's look, and no sidebar).
 * Only where the boot script said the page is on an iPad (`<html data-ipad>`: web/lib/page.ts) and the
 * window is not a narrow one: in Split View and Slide Over the phone's layout stays (viewer/narrow.css).
 * What it adds (its look: viewer/tablet.css):
 * - at the top left a button of four parts: to All Notes, and from there back to the note. The note
 *   shrinks into its tile there (overview.js has the tile: aria-current), and a tile opened grows into
 *   the note. Beside the button, once the note's title has scrolled away, its name and folder.
 * - at the bottom left a capsule: the note's history, and the pencil that goes from reading to
 *   writing (the active mode) and back.
 * - in All Notes, tiles chosen by a held finger and a bar of what the file menu has for them (the bars and panels themselves,
 *   and the bar over chosen blocks: viewer/touch.js — the application has them too, under a finger).
 * The sidebar stays shut and the tabs out of sight: All Notes is the way to the other notes.
 * The rest is the page's own, only laid out otherwise: the toolbar (outline, find, share) floats at
 * the top right, the active mode's rail (insert, format, style, information) at the bottom right. */
"use strict";
(() => {
  const P = window.MdPage;
  const root = document.documentElement;
  if (!root.hasAttribute("data-ipad")) return;
  const { T, esc, ICON } = P; // viewer/base.js
  const body = document.body;
  const wide = matchMedia("(min-width: 761px) and (min-height: 600px)"); // (as viewer/tablet.css says it)
  const on = () => wide.matches;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- the button of four parts, and the note's name beside it
  const nav = document.createElement("div");
  nav.id = "ipad-nav";
  nav.innerHTML = `<button class="ip-btn ip-all" type="button" title="${esc(T("All notes"))}" aria-label="${esc(T("All notes"))}" aria-pressed="false">${ICON.apps}</button>` +
    `<div class="ip-title" aria-hidden="true"><b></b><small>${ICON.folder}<span></span></small></div>`;
  body.appendChild(nav);
  const allBtn = nav.querySelector(".ip-all");

  // --- the capsule at the bottom left: the history, reading or writing
  const READING = !!(window.MdHost || {}).reading;
  const tools = document.createElement("div");
  tools.id = "ipad-tools";
  tools.className = "ip-cap";
  tools.innerHTML = READING ? "" :
    `<button class="ip-btn" type="button" data-ip="history" title="${esc(T("History"))}" aria-label="${esc(T("History"))}">${ICON.history}</button>` +
    // (undo and redo: an iPad without a keyboard has no Ctrl+Z — Lucide's undo-2 and redo-2)
    `<button class="ip-btn ip-hist" type="button" data-ip="undo" title="${esc(T("Undo"))}" aria-label="${esc(T("Undo"))}" aria-disabled="true">${P.svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>')}</button>` +
    `<button class="ip-btn ip-hist" type="button" data-ip="redo" title="${esc(T("Redo"))}" aria-label="${esc(T("Redo"))}" aria-disabled="true">${P.svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13"/>')}</button>` +
    `<button class="ip-btn" type="button" data-ip="write" title="${esc(T("mode.active"))}" aria-label="${esc(T("mode.active"))}" aria-pressed="false">${ICON.pencil}</button>`;
  if (!READING) body.appendChild(tools);

  const name = () => String((P.current && P.current.name) || "").replace(/\.(md|markdown)$/i, "");
  const where = () => {
    const f = P.folder, p = P.current && P.current.path;
    if (!f || !p || !p.startsWith(f.root + "/")) return f ? f.name : "";
    const dirs = p.slice(f.root.length + 1).split("/").slice(0, -1);
    return dirs.length ? dirs[dirs.length - 1] : f.name;
  };
  const column = () => (P.inSource() ? P.editor : P.mode === "active" && window.MdActive && MdActive.view ? MdActive.view.el : P.content);

  /* What is shown follows the page: whether All Notes is open, which mode, whether there is a
   * folder at all (a note opened by its link has none: no All Notes), the sidebar kept shut. */
  function sync() {
    const all = body.hasAttribute("data-overview");
    allBtn.setAttribute("aria-pressed", String(all));
    nav.hidden = !P.folder;
    nav.querySelector(".ip-title b").textContent = name();
    nav.querySelector(".ip-title span").textContent = where();
    const w = tools.querySelector('[data-ip="write"]');
    if (w) w.setAttribute("aria-pressed", String(P.mode === "active"));
    if (on() && body.dataset.sidebar === "open" && P.showSidebar) P.showSidebar(false, false);
    titled();
  }
  /* All Notes shut some other way (Esc, a key, the back of a tab): the note comes back out of the tile it went into */
  const shut = () => setTimeout(() => { if (hidden && !coming && !body.hasAttribute("data-overview")) toNote(asTile(shrunkTo, P.current && P.current.path), false); }, 0);
  new MutationObserver(() => { sync(); if (hidden && !body.hasAttribute("data-overview")) shut(); }).observe(body, { attributes: true, attributeFilter: ["data-overview", "data-view", "data-sidebar", "data-mode"] });
  wide.addEventListener("change", sync);

  // the note's name goes into the bar when its title has scrolled away
  function titled() {
    const b = nav.querySelector(".ip-title b"), n = name();
    if (b.textContent !== n) { b.textContent = n; nav.querySelector(".ip-title span").textContent = where(); }
    const col = column(), h = col && col.querySelector(":scope h1, :scope .pm > h1");
    const gone = h ? h.getBoundingClientRect().bottom < 64 : scrollY > 120;
    if (body.hasAttribute("data-overview") || hidden || coming) return; // (All Notes over the note, or the zoom under way: the bar stays as it stood — tablet.css fades the name with the note)
    root.toggleAttribute("data-ip-titled", gone);
  }
  addEventListener("scroll", titled, { passive: true });

  // --- undo and redo: what Ctrl+Z and Ctrl+Shift+Z do in the active mode (its own history, then the note's trail across the
  // modes: viewer/trail.js) — without the caret coming into the text: no keyboard comes up for a tap on them (BUGS.md 25)
  const MAC = /Mac|iP(hone|[oa]d)/.test(navigator.platform || navigator.userAgent);
  const pmView = () => window.MdActive && MdActive.view && MdActive.view.pm;
  const depth = (dir) => { const v = pmView(); if (!v || P.mode !== "active" || !window.PM || !PM.history) return 0; return (dir < 0 ? PM.history.undoDepth(v.state) : PM.history.redoDepth(v.state)) + (P.trailCan && P.trailCan(dir) ? 1 : 0); };
  function step(dir) {
    const v = pmView();
    if (!v || P.mode !== "active") return;
    const A = MdActive.view, f1 = v.focus, f2 = A.focus, typing = v.hasFocus();
    if (!typing) { v.focus = () => {}; A.focus = () => {}; }
    try { v.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", shiftKey: dir > 0, metaKey: MAC, ctrlKey: !MAC, bubbles: true, cancelable: true })); }
    finally { v.focus = f1; A.focus = f2; }
    if (!typing && v.hasFocus()) v.dom.blur();
    histState();
  }
  function histState() {
    for (const [k, dir] of [["undo", -1], ["redo", 1]]) { const b = tools.querySelector(`[data-ip="${k}"]`); if (b) b.setAttribute("aria-disabled", String(!depth(dir))); }
  }
  let histQueued = false;
  const histSoon = () => { if (histQueued) return; histQueued = true; requestAnimationFrame(() => { histQueued = false; histState(); }); };
  let histOn = null;
  function histWatch() { // (every change of the document changes what there is to undo)
    const v = pmView();
    if (!v || v.dom === histOn) return histSoon();
    histOn = v.dom;
    new MutationObserver(histSoon).observe(v.dom, { childList: true, subtree: true, characterData: true });
    // an iPad's keyboard has keys of its own for them (and ⌘Z): as the editor's own keys, not the browser's undo of the page
    v.dom.addEventListener("beforeinput", (e) => { if (e.inputType === "historyUndo" || e.inputType === "historyRedo") { e.preventDefault(); step(e.inputType === "historyUndo" ? -1 : 1); } });
    histSoon();
  }
  new MutationObserver(histWatch).observe(body, { attributes: true, attributeFilter: ["data-view"] });

  // --- buttons
  tools.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ip]");
    if (!b) return;
    if (b.dataset.ip === "undo" || b.dataset.ip === "redo") { if (b.getAttribute("aria-disabled") !== "true") step(b.dataset.ip === "undo" ? -1 : 1); }
    else if (b.dataset.ip === "history") P.openHistory();
    else if (b.dataset.ip === "write") P.switchMode(P.mode === "active" ? "read" : "active");
  });
  allBtn.addEventListener("click", () => {
    if (!P.folder || !window.MdOverview) return;
    if (body.hasAttribute("data-overview")) { if (P.current) toNote(currentTile()); }
    else toAll();
  });

  // --- the zoom between the note and its tile
  const spring = () => getComputedStyle(root).getPropertyValue("--spring-smooth").trim() || "ease-out";
  const ms = (v) => { const s = getComputedStyle(root).getPropertyValue(v).trim(); return s.endsWith("ms") ? parseFloat(s) : parseFloat(s) * 1000 || 300; };
  const overview = () => document.getElementById("overview");
  const currentTile = () => overview() && overview().querySelector(".ov-item[aria-current]");
  const sheetOf = (tile) => (tile && (tile.querySelector(".ov-sheet, .ov-mini") || tile)) || null;
  let hidden = null, shrunkTo = null; // the note's column while it stands shrunk in its tile, under All Notes; where its sheet was
  const asTile = (r, path) => ({ dataset: { path }, querySelector: () => ({ getBoundingClientRect: () => r }) });
  /* the visible part of the note's column, and the transform that lays it onto r (and back) */
  function lay(col, r, at = null) {
    const c = at || col.getBoundingClientRect(), top = Math.max(c.top, 0), s = r.width / c.width;
    return { s, origin: `0px ${top - c.top}px`, to: `translate(${r.left - c.left}px, ${r.top - top}px) scale(${s})`,
      from: `translate(${c.left - r.left}px, ${top - r.top}px) scale(${1 / s})`, ovOrigin: `${r.left}px ${r.top}px` }; // (All Notes' own corner: it scrolls inside itself, its box stays)
  }
  function toAll() {
    const col = column(), at = col && col.getBoundingClientRect(); // (where the note stands as it is touched: opening All Notes may move what is under it)
    if (hidden) { hidden.cancel(); hidden = null; }
    MdOverview.open();
    const tile = sheetOf(currentTile());
    if (!tile || !col || still()) return;
    const r = tile.getBoundingClientRect(), L = lay(col, r, at), dur = ms("--spring-smooth-dur");
    shrunkTo = r;
    col.style.transformOrigin = L.origin;
    hidden = col.animate([{ transform: "none", opacity: 1 }, { transform: L.to, opacity: 0, offset: 0.85 }, { transform: L.to, opacity: 0 }], { duration: dur, easing: spring(), fill: "forwards" });
    const ov = overview();
    ov.style.transformOrigin = L.ovOrigin;
    ov.animate([{ transform: L.from, opacity: 0 }, { transform: "none", opacity: 1 }], { duration: dur, easing: spring() });
  }
  /* from a tile (r: where its sheet stood) into the note: All Notes goes back into the tile, the
   * note comes out of it once it is there (a note that is still on its way is waited for) */
  let coming = null;
  function toNote(tile, open = true) {
    const r = sheetOf(tile) && sheetOf(tile).getBoundingClientRect();
    const path = tile && tile.dataset.path;
    if (open) MdOverview.close();
    if (!r || still()) { if (hidden) { hidden.cancel(); hidden = null; } return; }
    const ov = overview(), dur = ms("--spring-smooth-dur");
    const col0 = column(), L0 = col0 && lay(col0, r);
    if (L0) { ov.style.transformOrigin = L0.ovOrigin; ov.animate([{ transform: "none", opacity: 1 }, { transform: L0.from, opacity: 0 }], { duration: dur * 0.8, easing: spring() }); }
    const grow = () => {
      const col = column();
      if (hidden) { hidden.cancel(); hidden = null; }
      if (!col) return;
      const L = lay(col, r);
      col.style.transformOrigin = L.origin;
      col.animate([{ transform: L.to, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1 }], { duration: dur, easing: spring() }).finished.then(titled, titled);
    };
    if (!path || (P.current && (P.current.path === path || P.current.real === path))) return grow();
    // a note of its own: the old one stays out of sight until the new one is drawn
    const since = performance.now();
    clearInterval(coming);
    coming = setInterval(() => {
      const there = P.current && (P.current.path === path || P.current.real === path);
      if (there || performance.now() - since > 2500) { clearInterval(coming); coming = null; requestAnimationFrame(grow); }
    }, 30);
  }
  // a tile opened by a finger (or a click): the note grows out of it — overview.js opens it
  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element && e.target.closest("#overview .ov-item.ov-tile:not(.ov-folder):not(.ov-file)");
    if (!t || e.ctrlKey || e.metaKey || e.shiftKey || !on()) return;
    const r = sheetOf(t).getBoundingClientRect();
    // (after overview.js has done its part: the tile's sheet as it stood when it was touched)
    setTimeout(() => { if (!body.hasAttribute("data-overview")) toNote(asTile(r, t.dataset.path), false); }, 0);
  }, true);


  // --- All Notes: a tile held is chosen; then a tap chooses more, or lets one go; the bar has what the file menu has for them
  const { fillBar, barClick, closePanel } = P.tiles; // viewer/touch.js
  const picker = document.createElement("div");
  picker.id = "ipad-pickbar";
  picker.className = "ip-bar";
  picker.setAttribute("role", "toolbar");
  body.appendChild(picker);
  picker.addEventListener("click", barClick);
  const ov = () => document.getElementById("overview");
  const picking = () => body.hasAttribute("data-ip-picking");
  const tileOf = (path) => ov() && [...ov().querySelectorAll(".ov-item")].find((t) => t.dataset.path === path);
  // (tiles are not dragged by a finger here: a held finger chooses)
  new MutationObserver(() => { const o = ov(); if (o) for (const t of o.querySelectorAll('.ov-item[draggable="true"]')) t.draggable = false; })
    .observe(document.getElementById("overview") || body, { childList: true, subtree: true });
  /* What the file menu has for what is chosen: the menu itself is asked (opened out of sight, read, shut), and a tile
   * of the bar chooses that entry of it — the menu's own work (viewer/sidebar.js runCtx), nothing of its own. */
  const ctxEl = document.getElementById("ctxmenu");
  function proxy(fn) {
    const picked = MdOverview.picked, t = tileOf(picked[0]);
    if (!t) return null;
    const kind = picked.length > 1 ? "ovmany" : t.dataset.dir ? "ovdir" : "ovnote", r = t.getBoundingClientRect();
    body.setAttribute("data-ip-proxy", "");
    window.MdView.core.fileMenu(t, r.left, r.top, kind);
    return fn([...ctxEl.querySelectorAll(".menu-item:not([hidden])")].filter((b) => !b.disabled));
  }
  const ctxShut = () => { P.closeCtx(false); body.removeAttribute("data-ip-proxy"); };
  new MutationObserver(() => { if (!ctxEl.hasAttribute("data-open") && !document.getElementById("ctxsub").hasAttribute("data-open")) body.removeAttribute("data-ip-proxy"); }).observe(ctxEl, { attributes: true, attributeFilter: ["data-open"] });
  const TONE = { trash: "var(--c-red)", copyf: "var(--c-cyan)", cutf: "var(--c-orange)", duplicate: "var(--c-green)", share: "var(--c-blue)", rename: "var(--c-magenta)", look: "var(--c-magenta)", fav: "var(--c-yellow)", opentab: "var(--c-blue)", openbeside: "var(--c-blue)" };
  function pickTiles() {
    const entries = proxy((items) => items.map((b, i) => ({ i, cmd: b.dataset.cmd, label: b.querySelector(".menu-label").textContent, icon: b.querySelector(".menu-icon").innerHTML, sub: b.classList.contains("has-sub"), danger: b.classList.contains("danger"), rule: !!b.previousElementSibling && b.previousElementSibling.classList.contains("menu-rule") && !b.previousElementSibling.hidden })));
    ctxShut();
    if (!entries) return [];
    const done = { label: T("Done"), icon: ICON.check, tone: "var(--accent)", run: () => unpick() };
    const tiles = [done, "|"];
    for (const e of entries) {
      if (e.cmd === "open") continue; // (a tap on a tile opens it — while nothing is chosen)
      if (e.rule && tiles[tiles.length - 1] !== "|") tiles.push("|");
      tiles.push({ label: e.label, icon: e.icon, tone: TONE[e.cmd] || "var(--fg)", danger: e.danger, ...(e.sub
        ? { panel: () => subRows(e.i) }
        : { run: () => { proxy((items) => items[e.i] && items[e.i].click()); if (!["copyf", "cutf"].includes(e.cmd)) unpick(false); } }) });
    }
    return tiles;
  }
  // (a menu beside the menu — "Show": what is listed — read the same way, its rows chosen the same way)
  function subRows(i) {
    const rows = proxy((items) => { items[i].click(); const sub = document.getElementById("ctxsub"); return [...sub.querySelectorAll(".menu-item")].map((b, k) => ({ label: b.querySelector(".menu-label").textContent, checked: b.getAttribute("aria-checked") === "true", k })); }) || [];
    ctxShut();
    return [{ rows: rows.map((r) => ({ label: r.label, checked: r.checked, run: () => { proxy((items) => { items[i].click(); document.getElementById("ctxsub").querySelectorAll(".menu-item")[r.k].click(); }); setTimeout(ctxShut, 200); } })) }];
  }
  function showPick() {
    const n = MdOverview.picked.length;
    if (!n) return unpick();
    body.setAttribute("data-ip-picking", "");
    fillBar(picker, pickTiles());
  }
  function unpick(clear = true) {
    closePanel();
    body.removeAttribute("data-ip-picking");
    if (clear && window.MdOverview) MdOverview.pick([]);
  }
  function toggle(t) {
    const now = new Set(MdOverview.picked);
    if (now.has(t.dataset.path)) now.delete(t.dataset.path); else now.add(t.dataset.path);
    MdOverview.pick([...now]);
    showPick();
  }
  let hold = null, swallowTap = 0;
  addEventListener("pointerdown", (e) => {
    if (hold) { clearTimeout(hold.t); hold = null; }
    const t = e.pointerType === "touch" && e.isPrimary && e.target instanceof Element && e.target.closest("#overview[data-open] .ov-item");
    if (!t || t.dataset.kept != null) return;
    hold = { x: e.clientX, y: e.clientY, t: setTimeout(() => {
      hold = null;
      swallowTap = performance.now();
      getSelection()?.removeAllRanges();
      if (!picking()) MdOverview.pick([]);
      if (!MdOverview.picked.includes(t.dataset.path)) toggle(t); else showPick();
      t.classList.add("ip-held"); setTimeout(() => t.classList.remove("ip-held"), 400);
      navigator.vibrate?.(8);
    }, 450) };
  }, true);
  addEventListener("pointermove", (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) { clearTimeout(hold.t); hold = null; } }, true);
  for (const type of ["pointerup", "pointercancel", "scroll"]) addEventListener(type, () => { if (hold) { clearTimeout(hold.t); hold = null; } }, true);
  // while tiles are chosen: a tap on a tile chooses it or lets it go, a tap beside them ends the choosing
  addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    if (swallowTap && performance.now() - swallowTap < 900 && e.target.closest("#overview")) { swallowTap = 0; e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!picking() || !e.target.closest("#overview")) return;
    const t = e.target.closest(".ov-item");
    if (t) { e.preventDefault(); e.stopImmediatePropagation(); if (t.dataset.kept == null) toggle(t); return; }
    if (!e.target.closest(".ov-head, .ov-seg, .ov-crumb, button, input")) { e.preventDefault(); e.stopImmediatePropagation(); unpick(); }
  }, true);
  new MutationObserver(() => { if (!body.hasAttribute("data-overview") && picking()) unpick(false); }).observe(body, { attributes: true, attributeFilter: ["data-overview"] });


  // --- the panel is the note's: on the iPad it goes when the note is left (All Notes, another note, another mode), and does not
  // come back of itself when the note is entered again (its "open" is not kept)
  {
    let was = { path: null, mode: null };
    const shutPanel = () => { if (window.MdActive && MdActive.panel && MdActive.panel.isOpen) MdActive.panel.show(false, false); };
    const check = () => {
      const now = { path: P.current && P.current.path, mode: P.mode };
      if (body.hasAttribute("data-overview") || (was.path && now.path !== was.path) || (was.mode && now.mode !== was.mode)) shutPanel();
      was = now;
    };
    new MutationObserver(check).observe(body, { attributes: true, attributeFilter: ["data-overview", "data-view"] });
    new MutationObserver(check).observe(P.content, { childList: true });
    setInterval(check, 800); // (a note opened by a link, in the active mode: no attribute changes for it)
  }

  // --- with the keyboard up, what stands at the foot stands above it (Safari's visual viewport)
  if (window.visualViewport) {
    const kb = () => root.style.setProperty("--ip-kb", Math.max(0, Math.round(innerHeight - visualViewport.height - visualViewport.offsetTop)) + "px");
    visualViewport.addEventListener("resize", kb);
    visualViewport.addEventListener("scroll", kb);
    kb();
  }

  sync();
  P.tablet = { on, sync, toAll, toNote };
})();
