/* mdview, the page — what a finger has in the note, as the iPad has it (Craft's): no menu under a held finger, bars of tiles
 * at the foot instead, with panels rising from them; a tile of the Insert panel held and put into the note by the finger.
 * On an iPad always (`<html data-ipad>`: its own layout, viewer/tablet.js); in the application (and WebKitGTK, its web view)
 * while the hand is a finger (`<html data-finger>`: viewer/hand.js) — Henri, 2026-10-25: the application on Linux under the
 * tablet's fingers; not in a narrow window, which has the phone's layout. A mouse or a touchpad there, and the menus are
 * back. Its look: viewer/tablet.css. */
"use strict";
(() => {
  const P = window.MdPage;
  const root = document.documentElement;
  const { T, esc, ICON } = P; // viewer/base.js
  const body = document.body;
  const IPAD = root.hasAttribute("data-ipad");
  const wide = window.matchMedia ? matchMedia("(min-width: 761px) and (min-height: 600px)") : { matches: false, addEventListener() {} }; // (a phone, a narrow window: its own layout stays — viewer/narrow.css)
  const APP = P.DESKTOP || !!(window.MdHand && MdHand.GTK); // (the application; a browser on a touch screen keeps the menus a finger holds)
  const on = () => IPAD || (APP && root.hasAttribute("data-finger") && wide.matches);
  // <html data-tiles> while it holds: the rail at the bottom right, the bars' look (viewer/tablet.css)
  const mark = () => { if (on() !== root.hasAttribute("data-tiles")) root.toggleAttribute("data-tiles", on()); };
  new MutationObserver(mark).observe(root, { attributes: true, attributeFilter: ["data-finger"] });
  wide.addEventListener("change", mark);
  mark();

  // --- the bar over selected blocks
  const bar = document.createElement("div");
  bar.id = "ipad-blockbar";
  bar.setAttribute("role", "toolbar");
  body.appendChild(bar);

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
  const quiet = (v, run) => () => { const f = v.focus; v.focus = () => {}; try { run(); } finally { v.focus = f; } if (window.MdView.core.byFinger && window.MdView.core.byFinger()) v.dom.blur(); }; // (the hand last a finger, however long ago: no keyboard — active/view.js)
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
  function follow() {
    const v = window.MdActive && MdActive.view && MdActive.view.pm;
    if (v && v.dom.classList.contains("has-blocksel") && P.mode === "active" && on()) { barFor = null; showBar(v); } else hideBar();
  }
  const blockSel = new MutationObserver(follow);
  function watch() {
    const v = window.MdActive && MdActive.view && MdActive.view.pm;
    if (!v || v.dom === watched) return;
    watched = v.dom;
    blockSel.disconnect();
    blockSel.observe(v.dom, { attributes: true, attributeFilter: ["class"] });
  }
  new MutationObserver(() => { watch(); if (P.mode !== "active") hideBar(); }).observe(body, { attributes: true, attributeFilter: ["data-view"] });
  // (the hand changes — a finger, then a mouse: blocks still chosen have the bar while it is a finger, the menus after it)
  new MutationObserver(follow).observe(root, { attributes: true, attributeFilter: ["data-tiles"] });

  // --- no menu under a held finger (Henri, 2026-10-20): what the menus had is in the bars. A secondary click (a trackpad) still has its menu.
  // (in the application, the note in the active mode only: the sidebar, the tabs and All Notes keep theirs — they have no bars there)
  let touched = false;
  addEventListener("pointerdown", (e) => { touched = e.pointerType === "touch"; }, true);
  addEventListener("contextmenu", (e) => { if (touched && on() && (IPAD || (e.target instanceof Element && e.target.closest("#active, .blk-h")))) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // --- the Insert panel under a finger: a tile held a moment is lifted and goes with the finger; the note's line shows where it
  // goes (the panel's own: gapAt, showLine), the note scrolls along near its edges, and letting go puts it there — as a drag
  // with the mouse does (active/panel.js). A tap still puts it at the caret. (A browser on an iPad sends no drag for a finger, nor does WebKitGTK.)
  {
    const HOLD = 200, SLACK = 8;
    let pend = null, drag = null, ghost = null, scrolling = 0;
    const view = () => window.MdActive && MdActive.view && MdActive.view.pm;
    // (on an iPad never dragged the browser's way; in the application a mouse still drags them: only while a finger is on one)
    if (IPAD) new MutationObserver(() => { for (const t of document.querySelectorAll('#rpanel .rp-tile[draggable="true"]')) t.draggable = false; })
      .observe(body, { childList: true, subtree: true });
    let undrag = null;
    const end = () => {
      if (undrag) { const t = undrag; undrag = null; setTimeout(() => { t.draggable = true; }, 0); }
      if (pend) { clearTimeout(pend.t); pend = null; }
      if (ghost) { ghost.remove(); ghost = null; }
      cancelAnimationFrame(scrolling); scrolling = 0;
      if (drag && window.MdActive && MdActive.panel) MdActive.panel.showLine(null);
      body.removeAttribute("data-ip-dragging");
    };
    const place = (x, y) => {
      ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px) scale(1.04)`;
      const v = view(), over = document.elementFromPoint(x, y);
      const inNote = v && over && MdActive.view.el.contains(over) && !over.closest("#rpanel");
      const g = inNote ? MdActive.panel.gapAt(v, x, y, drag.flat) : null;
      drag.at = g ? g.at : null;
      MdActive.panel.showLine(g);
      drag.x = x; drag.y = y;
    };
    const roll = () => { // near the window's upper or lower edge the note goes along
      if (!drag) return;
      const edge = 90, y = drag.y, d = y < edge ? -(edge - y) / 4 : y > innerHeight - edge ? (y - (innerHeight - edge)) / 4 : 0;
      if (d) { scrollBy(0, d); place(drag.x, drag.y); }
      scrolling = requestAnimationFrame(roll);
    };
    addEventListener("pointerdown", (e) => {
      const tile = e.pointerType === "touch" && e.isPrimary && e.target instanceof Element && e.target.closest("#rpanel .rp-tile[data-i]");
      if (!tile || !view() || !view().editable) return;
      const i = +tile.dataset.i;
      if (A_ITEM(i) === false) return;
      if (tile.draggable) { tile.draggable = false; undrag = tile; }
      pend = { x: e.clientX, y: e.clientY, t: setTimeout(() => {
        const r = tile.getBoundingClientRect();
        drag = { i, at: null, flat: (MdActive.panel.items[i] || [])[0] === "slash.columns", dx: pend.x - r.left, dy: pend.y - r.top, x: pend.x, y: pend.y, tile };
        pend = null;
        ghost = tile.cloneNode(true);
        ghost.id = "ip-ghost";
        ghost.style.width = r.width + "px";
        body.appendChild(ghost);
        body.setAttribute("data-ip-dragging", "");
        place(drag.x, drag.y);
        scrolling = requestAnimationFrame(roll);
        navigator.vibrate?.(8);
      }, HOLD) };
    }, true);
    // (which tiles can be dragged at all: the panel says it by their grip)
    const A_ITEM = (i) => !!document.querySelector(`#rpanel .rp-tile[data-i="${i}"] .rp-grip`);
    addEventListener("pointermove", (e) => {
      if (pend && Math.hypot(e.clientX - pend.x, e.clientY - pend.y) > SLACK) { clearTimeout(pend.t); pend = null; }
      if (drag) place(e.clientX, e.clientY);
    }, true);
    // (while a tile is held, the finger moves it, not the panel or the page)
    addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { capture: true, passive: false });
    addEventListener("pointerup", (e) => {
      if (!drag) return end();
      const d = drag;
      place(e.clientX, e.clientY);
      const at = d.at;
      end(); drag = null;
      swallowNext = performance.now(); // (the tap the finger's lift would make is not a second insert)
      if (at == null) return;
      const v = view(), A = MdActive.view, f1 = v.focus, f2 = A.focus;
      v.focus = () => {}; A.focus = () => {};
      try { MdActive.panel.run(d.i, at); } finally { v.focus = f1; A.focus = f2; }
      MdActive.panel.show(false); // (put in: the panel goes, the note shows what came)
      // (a block of text is put in to be written in: the keyboard comes; anything else is only there)
      const [sec, [key]] = MdActive.panel.items[d.i] || [null, [null]];
      if (key === "menu.text" || ["panel.lists", "slash.deco", "slash.callout"].includes(sec)) v.focus({ keyboard: true });
    }, true);
    addEventListener("pointercancel", () => { end(); drag = null; }, true);
    let swallowNext = 0;
    addEventListener("click", (e) => { if (swallowNext && performance.now() - swallowNext < 700) { swallowNext = 0; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  }

  P.tiles = { on, panel, fillBar, barClick, closePanel };
})();
