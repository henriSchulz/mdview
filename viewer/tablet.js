/* mdview, the page — the iPad's own layout (Henri chose it, 2026-10-20: Craft's look, and no sidebar).
 * Only where the boot script said the page is on an iPad (`<html data-ipad>`: web/lib/page.ts) and the
 * window is not a narrow one: in Split View and Slide Over the phone's layout stays (viewer/narrow.css).
 * What it adds (its look: viewer/tablet.css):
 * - at the top left a button of four parts: to All Notes, and from there back to the note. The note
 *   shrinks into its tile there (overview.js has the tile: aria-current), and a tile opened grows into
 *   the note. Beside the button, once the note's title has scrolled away, its name and folder.
 * - at the bottom left a capsule: the note's history, and the pencil that goes from reading to
 *   writing (the active mode) and back.
 * - while blocks are selected (active/blocks.js: the editor has `has-blocksel`), a bar of the
 *   actions on them at the bottom — the same ones the block's menu has (A.blocks.menuItems).
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
    `<button class="ip-btn" type="button" data-ip="write" title="${esc(T("mode.active"))}" aria-label="${esc(T("mode.active"))}" aria-pressed="false">${ICON.pencil}</button>`;
  if (!READING) body.appendChild(tools);

  // --- the bar over selected blocks
  const bar = document.createElement("div");
  bar.id = "ipad-blockbar";
  bar.setAttribute("role", "toolbar");
  body.appendChild(bar);

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
    root.toggleAttribute("data-ip-titled", !body.hasAttribute("data-overview") && gone);
  }
  addEventListener("scroll", titled, { passive: true });

  // --- buttons
  tools.addEventListener("click", (e) => {
    const b = e.target.closest("[data-ip]");
    if (!b) return;
    if (b.dataset.ip === "history") P.openHistory();
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
  function lay(col, r) {
    const c = col.getBoundingClientRect(), top = Math.max(c.top, 0), s = r.width / c.width;
    return { s, origin: `0px ${top - c.top}px`, to: `translate(${r.left - c.left}px, ${r.top - top}px) scale(${s})`,
      from: `translate(${c.left - r.left}px, ${top - r.top}px) scale(${1 / s})`, ovOrigin: `${r.left}px ${r.top + overview().scrollTop}px` };
  }
  function toAll() {
    const col = column();
    if (hidden) { hidden.cancel(); hidden = null; }
    MdOverview.open();
    const tile = sheetOf(currentTile());
    if (!tile || !col || still()) return;
    const r = tile.getBoundingClientRect(), L = lay(col, r), dur = ms("--spring-smooth-dur");
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
      col.animate([{ transform: L.to, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: "none", opacity: 1 }], { duration: dur, easing: spring() });
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

  // --- the bar over selected blocks: the actions of the block's menu, the clipboard's first
  const BAR = [["menu.copy", "copy"], ["menu.cut", "cut"], ["slash.duplicate", "copy", "dup"], ["menu.delete", "trash"]];
  let barFor = null;
  function showBar(view) {
    const items = window.MdActive && MdActive.blocks ? MdActive.blocks.menuItems(view).filter(Boolean) : [];
    const pick = (key) => items.find((it) => it.label === T(key));
    const shown = BAR.map(([key, icon, cls]) => [pick(key), icon, cls, key]).filter(([it]) => it);
    bar.innerHTML = shown.map(([it, icon, cls, key], i) => `<button type="button" class="ip-tile${it.danger ? " danger" : ""}${cls ? " " + cls : ""}" data-i="${i}" data-key="${esc(key)}">${ICON[icon] || ""}<span>${esc(it.label)}</span></button>`).join("") +
      `<button type="button" class="ip-tile more" data-more>${ICON.list}<span>${esc(T("More"))}</span></button>`;
    bar._items = shown.map(([it]) => it);
    bar._all = items;
    barFor = view;
    body.toggleAttribute("data-ip-blocks", true);
  }
  function hideBar() { barFor = null; body.removeAttribute("data-ip-blocks"); }
  bar.addEventListener("pointerdown", (e) => e.preventDefault()); // (a tap here leaves the selection and the keyboard as they are)
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !barFor) return;
    if (b.hasAttribute("data-more")) { const r = b.getBoundingClientRect(); MdActive.menu.open({ x: r.left, y: r.top - 8, items: MdActive.blocks.menuItems(barFor), closed: () => {} }); return; }
    const it = bar._items[+b.dataset.i];
    if (it) it.run();
  });
  let watched = null;
  const blockSel = new MutationObserver(() => { const v = window.MdActive && MdActive.view && MdActive.view.pm; if (v && v.dom.classList.contains("has-blocksel") && on() && P.mode === "active") showBar(v); else hideBar(); });
  function watch() {
    const v = window.MdActive && MdActive.view && MdActive.view.pm;
    if (!v || v.dom === watched) return;
    watched = v.dom;
    blockSel.disconnect();
    blockSel.observe(v.dom, { attributes: true, attributeFilter: ["class"] });
  }
  new MutationObserver(() => { watch(); if (P.mode !== "active") hideBar(); }).observe(body, { attributes: true, attributeFilter: ["data-view"] });

  sync();
  P.tablet = { on, sync, toAll, toNote };
})();
