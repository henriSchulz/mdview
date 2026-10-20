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
    if (body.hasAttribute("data-overview") || hidden || coming) return; // (All Notes over the note, or the zoom under way: the bar stays as it stood — tablet.css fades the name with the note)
    root.toggleAttribute("data-ip-titled", gone);
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

  // --- bars of tiles at the foot, and the panels that rise from them (Craft's: blocks chosen, tiles chosen)
  /* A tile: { label, icon (an svg), tone (a colour of the theme), run } or one that opens a panel: { panel: () => sections }.
   * A panel: sections of rows — [{ title, rows: [{ label, icon, checked, disabled, danger, swatch, run }] , swatches: true }].
   * What a row does is the app's own command (the "/" menu's entries, the file menu's): nothing is done here. */
  const panel = document.createElement("div");
  panel.id = "ipad-panel";
  panel.setAttribute("role", "menu");
  body.appendChild(panel);
  let panelFor = null;
  const SWATCH = { default: "var(--fg)", red: "var(--c-red)", orange: "var(--c-orange)", yellow: "var(--c-yellow)", green: "var(--c-green)", cyan: "var(--c-cyan)", blue: "var(--c-blue)", magenta: "var(--c-magenta)" };
  function closePanel() { panelFor = null; panel.removeAttribute("data-open"); for (const b of document.querySelectorAll(".ip-bar .ip-tile[aria-expanded]")) b.removeAttribute("aria-expanded"); }
  function openPanel(tile, sections) {
    if (panelFor === tile) return closePanel();
    closePanel();
    panelFor = tile;
    tile.setAttribute("aria-expanded", "true");
    let n = 0;
    const rows = [];
    panel.innerHTML = sections.filter((s) => s.rows.length).map((s) =>
      (s.title ? `<div class="ip-ph">${esc(s.title)}</div>` : "") +
      `<div class="ip-pg${s.swatches ? " sw" : ""}">` + s.rows.map((r) => { rows.push(r); const i = n++;
        return s.swatches
          ? `<button type="button" class="ip-sw" data-r="${i}" title="${esc(r.label)}" aria-label="${esc(r.label)}" aria-checked="${!!r.checked}" style="--s:${r.swatch}"${r.disabled ? " disabled" : ""}><i></i><span>${esc(r.label)}</span></button>`
          : `<button type="button" class="ip-row${r.danger ? " danger" : ""}" role="menuitem" data-r="${i}"${r.disabled ? " disabled" : ""}><span class="ip-ri">${r.icon || ""}</span><span class="ip-rl">${esc(r.label)}</span>${r.checked ? `<span class="ip-rc">${ICON.check}</span>` : ""}</button>`; }).join("") + `</div>`).join("");
    panel._rows = rows;
    const r = tile.getBoundingClientRect(), barR = tile.closest(".ip-bar").getBoundingClientRect();
    panel.style.setProperty("--x", Math.round(Math.max(12, Math.min(r.left + r.width / 2 - 170, innerWidth - 352))) + "px");
    panel.style.setProperty("--y", Math.round(innerHeight - barR.top + 10) + "px");
    panel.style.setProperty("--o", Math.round(r.left + r.width / 2 - Math.max(12, Math.min(r.left + r.width / 2 - 170, innerWidth - 352))) + "px");
    panel.scrollTop = 0;
    panel.setAttribute("data-open", "");
  }
  panel.addEventListener("pointerdown", (e) => e.preventDefault()); // (a tap here leaves the selection and the keyboard as they are)
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b || b.disabled) return;
    const row = panel._rows[+b.dataset.r];
    closePanel();
    if (row && row.run) row.run();
  });
  function fillBar(el, tiles) {
    el._tiles = tiles;
    el.innerHTML = tiles.map((t, i) => t === "|" ? `<span class="ip-gap"></span>` :
      `<button type="button" class="ip-tile${t.tone ? "" : ""}${t.danger ? " danger" : ""}" data-t="${i}" style="--t:${t.tone || "var(--c-blue)"}"${t.panel ? ' aria-haspopup="menu"' : ""}>${t.icon || ""}<span>${esc(t.label)}</span></button>`).join("");
  }
  function barClick(e) {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    const t = e.currentTarget._tiles[+b.dataset.t];
    if (t.panel) openPanel(b, t.panel());
    else { closePanel(); t.run(); }
  }
  // (outside the bar and its panel, a tap shuts the panel and is not swallowed)
  addEventListener("pointerdown", (e) => { if (panelFor && !(e.target instanceof Element && e.target.closest("#ipad-panel, .ip-bar"))) closePanel(); }, true);

  // --- the bar over selected blocks: what the "/" menu has for them (A.blocks.slashItems), as tiles and panels
  bar.classList.add("ip-bar");
  bar.addEventListener("pointerdown", (e) => e.preventDefault());
  bar.addEventListener("click", barClick);
  const svgIcon = (x) => (typeof x === "string" && x.trim().startsWith("<") ? x : (x && ICON[x]) || "");
  let barFor = null;
  /* the command, without the caret coming into the text: a finger chose a block, no keyboard comes up (BUGS.md 25) */
  const quiet = (v, run) => () => { const f = v.focus; v.focus = () => {}; try { run(); } finally { v.focus = f; } if (window.MdView.core.touching && window.MdView.core.touching()) v.dom.blur(); };
  const key = (v, k, shift = false) => () => v.dom.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true, cancelable: true }));
  function blockTiles(v) {
    const full = MdActive.blocks.slashItems(v, true) || [], short = MdActive.blocks.menuItems(v).filter(Boolean);
    const group = (k) => full.find((g) => g && g.items && g.label === T(k));
    const asRows = (g, opts = {}) => (g ? g.items : []).filter(Boolean).map((e) => ({ label: e.label, icon: svgIcon(e.icon), checked: !!e.checked, disabled: !!e.disabled, danger: !!e.danger, run: e.run && quiet(v, e.run), ...(opts.swatch ? { swatch: SWATCH[(e.key || "").split(".").pop()] || SWATCH[e.label.toLowerCase()] || "var(--fg)" } : {}) }));
    const sec = (k, opts) => { const g = group(k); return g ? { title: g.label, rows: asRows(g, opts), swatches: !!(opts && opts.swatch) } : { rows: [] }; };
    // what is put in below them: the entries of the "/" menu that stand alone (a divider's looks: a group of their own)
    const loose = full.filter((g) => g && !g.items && g.run), dividers = full.filter((g) => g && g.items && !["slash.style", "slash.list", "menu.format", "slash.align", "slash.deco", "slash.color", "slash.callout", "slash.columns", "slash.actions"].some((k) => g.label === T(k)) && g.label !== T("slash.actions"));
    const page = loose.find((e) => e.label === T("menu.page"));
    const inserts = loose.filter((e) => e !== page);
    const actions = group("slash.actions");
    const act = (k) => { const e = actions && actions.items.find((x) => x && x.label === T(k)); return e && { label: e.label, icon: svgIcon(e.icon), disabled: !!e.disabled, run: quiet(v, e.run) }; };
    const pick = (k) => { const e = short.find((x) => x.label === T(k)); return e && { label: e.label, run: quiet(v, e.run) }; };
    const copy = pick("menu.copy"), cut = pick("menu.cut"), del = act("slash.delete");
    return [
      { label: T("slash.style"), icon: `<b class="ip-aa">Aa</b>`, tone: "var(--c-magenta)", panel: () => [sec("slash.style"), sec("slash.list"), sec("slash.deco"), sec("slash.callout"), sec("slash.columns")] },
      { label: T("menu.format"), icon: svgIcon("title"), tone: "var(--c-orange)", panel: () => [sec("menu.format"), sec("slash.align"),
        { title: T("Indent"), rows: [{ label: T("Indent"), icon: ICON.forward, run: key(v, "Tab") }, { label: T("Outdent"), icon: ICON.back, run: key(v, "Tab", true) }, act("slash.moveUp"), act("slash.moveDown")].filter(Boolean) },
        sec("slash.color", { swatch: true })] },
      { label: T("panel.insert"), icon: ICON.plus, tone: "var(--c-blue)", panel: () => [{ rows: inserts.map((e) => ({ label: e.label, icon: svgIcon(e.icon), disabled: !!e.disabled, run: quiet(v, e.run) })) },
        ...dividers.map((g) => ({ title: g.label, rows: asRows(g) }))] },
      "|",
      copy && { ...copy, icon: ICON.copy, tone: "var(--c-cyan)" },
      cut && { ...cut, icon: ICON.cut, tone: "var(--c-orange)" },
      act("slash.duplicate") && { ...act("slash.duplicate"), tone: "var(--c-green)" },
      { label: T("slash.actions"), icon: ICON.list, tone: "var(--fg)", panel: () => [{ rows: [act("slash.moveUp"), act("slash.moveDown"), act("menu.copyMarkdown"), page && { label: page.label, icon: svgIcon(page.icon), run: quiet(v, page.run) }, pick("menu.paste") && { ...pick("menu.paste"), icon: ICON.clip }].filter(Boolean) }] },
      "|",
      del && { ...del, tone: "var(--c-red)", danger: true },
    ].filter(Boolean);
  }
  function showBar(view) {
    if (barFor === view && body.hasAttribute("data-ip-blocks")) return;
    barFor = view;
    fillBar(bar, blockTiles(view));
    body.toggleAttribute("data-ip-blocks", true);
  }
  function hideBar() { barFor = null; closePanel(); body.removeAttribute("data-ip-blocks"); }
  let watched = null;
  const blockSel = new MutationObserver(() => {
    const v = window.MdActive && MdActive.view && MdActive.view.pm;
    if (v && v.dom.classList.contains("has-blocksel") && P.mode === "active") { barFor = null; showBar(v); } else hideBar();
  });
  function watch() {
    const v = window.MdActive && MdActive.view && MdActive.view.pm;
    if (!v || v.dom === watched) return;
    watched = v.dom;
    blockSel.disconnect();
    blockSel.observe(v.dom, { attributes: true, attributeFilter: ["class"] });
  }
  new MutationObserver(() => { watch(); if (P.mode !== "active") hideBar(); }).observe(body, { attributes: true, attributeFilter: ["data-view"] });

  // --- no menu under a held finger (Henri, 2026-10-20): what the menus had is in the bars. A secondary click (a trackpad) still has its menu.
  let touched = false;
  addEventListener("pointerdown", (e) => { touched = e.pointerType === "touch"; }, true);
  addEventListener("contextmenu", (e) => { if (touched) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // --- All Notes: a tile held is chosen; then a tap chooses more, or lets one go; the bar has what the file menu has for them
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

  sync();
  P.tablet = { on, sync, toAll, toNote };
})();
