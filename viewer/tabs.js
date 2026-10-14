/* mdview, the page — the tabs of a folder window. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, esc, motionMs, keys, ICON } = P; // viewer/base.js
  const { going, reducedMotion } = P; // viewer/render.js
  const { toolbar, showToolbar } = P; // viewer/chrome.js
  const { rowIcon, openCtx } = P; // viewer/sidebar.js

  /* A folder window has tabs, as Craft has them: a strip above the note with the notes and PDFs
   * that are open; before them the way to all notes (the house), behind them a new tab (+). The
   * application keeps them (mdview.py, tabs) — the file each one shows, its way back, their
   * order, from one opening of the folder to the next — the page draws the strip and says what
   * was asked for. A click shows a tab; the ✕ that takes its icon's place under the pointer, or
   * the middle button, closes it; it can be pulled to another place. A note opens in a tab of its
   * own with Ctrl or the middle button (sidebar, tiles, links). An empty tab shows all notes.
   * Keys: Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab and Ctrl+Shift+Tab, Ctrl+1 … 9. */
  const tabbar = document.createElement("nav");
  tabbar.id = "tabs";
  tabbar.setAttribute("aria-label", "Tabs");
  // (the sidebar's button stands at the left, where the sidebar is: first in the strip — beside the
  // sidebar's edge while that is open, at the window's while it is closed)
  tabbar.innerHTML = `<div class="tab-row">` +
    `<button class="tab-home tab-side" data-act="sidebar" title="${esc(T("Sidebar (Ctrl+Alt+S)"))}" aria-label="${esc(T("Sidebar"))}">${ICON.sidebar}</button>` +
    `<button class="tab-home tab-nav" data-act="navback" title="${esc(T("Back (Alt+←)"))}" aria-label="${esc(T("Back"))}" disabled>${ICON.back}</button>` +
    `<button class="tab-home tab-nav" data-act="navfwd" title="${esc(T("Forward (Alt+→)"))}" aria-label="${esc(T("Forward"))}" disabled>${ICON.forward}</button>` +
    `<button class="tab-home" data-act="overview" title="${esc(T("All notes (Ctrl+Alt+G)"))}" aria-label="${esc(T("All notes"))}" aria-pressed="false">${ICON.home}</button>` +
    `<div class="tab-list" role="tablist"></div>` +
    `<button class="tab-new" data-act="newtab" title="${esc(T("New tab (Ctrl+T)"))}" aria-label="${esc(T("New tab"))}">${ICON.plus}</button></div>`;
  document.body.appendChild(tabbar);
  const tabRow = tabbar.firstChild, tabList = tabbar.querySelector(".tab-list");
  let tabs = [], tabActive = null, tabShown = null, tabClosed = false; // tabActive: the one marked (at once, on a click); tabShown: the one the application says is shown
  const tabsOn = () => document.body.hasAttribute("data-tabs");
  const topRoom = () => (tabsOn() ? tabbar.offsetHeight : 0); // what of the window's top the strip takes
  const tabEls = () => [...tabList.children].filter((el) => el.classList.contains("tab") && !el.classList.contains("leaving"));
  /* The plate under the tab one is on: it lies in the tabs' track (its last child, always) and glides to the tab chosen.
   * It follows by watching the list — which tab is marked, how many there are, how wide they got — and is out of the way
   * while a tab is pulled (that one carries its own). */
  const tabPlate = document.createElement("i");
  tabPlate.className = "tab-plate";
  tabPlate.setAttribute("aria-hidden", "true");
  tabList.appendChild(tabPlate);
  let plateFrame = 0, plateSet = false;
  function placePlate() {
    plateFrame = 0;
    const on = tabList.querySelector('.tab[aria-selected="true"]:not(.leaving)'), pulled = !!tabList.querySelector(".tab.pulled, .tab.landing");
    tabList.toggleAttribute("data-none", !tabEls().length);
    if (!on || pulled || !on.offsetWidth) { tabPlate.style.opacity = "0"; plateSet = false; return; }
    if (!plateSet) tabPlate.style.transition = "none"; // (it appears where it belongs: it does not come gliding from the corner)
    tabPlate.style.width = on.offsetWidth + "px";
    tabPlate.style.transform = `translateX(${on.offsetLeft}px)`;
    tabPlate.style.opacity = "";
    if (!plateSet) { void tabPlate.offsetWidth; tabPlate.style.transition = ""; plateSet = true; }
  }
  const plateSoon = () => { if (!plateFrame) plateFrame = requestAnimationFrame(placePlate); };
  new MutationObserver(plateSoon).observe(tabList, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected", "class"] });
  if (window.ResizeObserver) new ResizeObserver(plateSoon).observe(tabList);
  addEventListener("resize", plateSoon);
  /* The pasteboard has a tab of its own: an empty tab (one that shows All Notes) marked as the pasteboard's — made with pasteTab,
   * kept for as long as the window is open. */
  const pasteTabs = new Set();
  let pasteWanted = false;
  function pasteTab() {
    const had = tabs.find((t) => pasteTabs.has(t.id));
    if (had) return selectTab(had.id); // (one pasteboard: its tab, where there is one)
    pasteWanted = true;
    post("tab", { op: "new" });
  }
  function tabLabel(t) {
    if (!t.path) return T(pasteTabs.has(t.id) ? "Pasteboard" : "All Notes");
    let title = "";
    if (P.sbTitles && P.folder) { // as the sidebar names it
      const find = (dir) => dir.notes.find((n) => n.real === t.path) || dir.dirs.reduce((hit, d) => hit || find(d), null);
      title = find(P.folder.tree)?.title || "";
    }
    return title || t.name.replace(/\.(md|markdown|mdown|mkd|mkdn|mdx|pdf)$/i, "");
  }
  function paintTab(el, t) {
    const label = tabLabel(t), text = el.lastChild;
    if (el.dataset.path !== (t.path || "")) {
      el.dataset.path = t.path || "";
      el.firstChild.innerHTML = t.path ? rowIcon(t.path) : pasteTabs.has(t.id) ? ICON.clip || ICON.apps : ICON.apps;
      if (t.path) el.dataset.tip = P.folder && t.path.startsWith(P.folder.root + "/") ? t.path.slice(P.folder.root.length + 1) : t.path; else delete el.dataset.tip;
    }
    if (text.textContent !== label) {
      const had = text.textContent;
      text.textContent = label;
      if (had && text.animate) text.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionMs("--dur-fast", 160), easing: "ease-out" }); // (another note in the tab: its name fades in)
    }
  }
  function markTabs() {
    for (const el of tabEls()) {
      const on = Number(el.dataset.id) === tabActive;
      el.setAttribute("aria-selected", String(on));
      el.tabIndex = on ? 0 : -1;
    }
  }
  // tabs that stand elsewhere than before glide there (stood: where each one was, by element)
  function tabGlide(stood) {
    const moved = [];
    for (const [el, left] of stood) {
      if (!el.isConnected || el.classList.contains("leaving")) continue;
      el.style.transition = "none";
      el.style.transform = "";
      const dx = left - el.getBoundingClientRect().left;
      if (Math.abs(dx) > 1 && !reducedMotion()) { el.style.transform = `translateX(${dx}px)`; moved.push(el); } else el.style.transition = "";
    }
    if (!moved.length) return;
    void tabList.offsetWidth;
    for (const el of moved) { el.style.transition = ""; el.style.transform = ""; }
  }
  function setTabs(d) {
    const first = !tabsOn();
    if (first) { document.body.dataset.tabs = ""; document.documentElement.style.setProperty("--top", tabbar.offsetHeight + "px"); showToolbar(true); }
    const stood = new Map(), have = new Map(), fresh = [];
    for (const el of tabEls()) { stood.set(el, el.getBoundingClientRect().left); have.set(el.dataset.id, el); }
    const box = tabList.getBoundingClientRect();
    let prev = null;
    if (pasteWanted && d.active !== tabShown && !(d.tabs.find((t) => t.id === d.active) || {}).path) { pasteWanted = false; pasteTabs.add(d.active); } // (the new empty tab is the pasteboard's)
    for (const id of [...pasteTabs]) if (!d.tabs.some((t) => t.id === id)) pasteTabs.delete(id);
    for (const t of d.tabs) {
      let el = have.get(String(t.id));
      if (el) have.delete(String(t.id));
      else {
        el = document.createElement("div");
        el.className = "tab";
        el.setAttribute("role", "tab");
        el.dataset.id = t.id;
        el.innerHTML = `<span class="tab-icon"></span><button class="tab-x" type="button" tabindex="-1" aria-label="${esc(T("Close tab"))}" data-tip="Close tab (${keys("Ctrl+W")})">${ICON.x}</button><span class="tab-label"></span>`;
        if (!first) { el.classList.add("enter"); fresh.push(el); }
      }
      const at = prev ? prev.nextSibling : tabList.firstChild;
      if (at !== el) tabList.insertBefore(el, at);
      prev = el;
      paintTab(el, t);
    }
    for (const el of have.values()) { // a closed one fades where it stood, out of the others' way
      const r = el.getBoundingClientRect();
      el.style.left = r.left - box.left + "px";
      el.style.width = r.width + "px";
      el.style.transform = "";
      el.classList.add("leaving");
      setTimeout(() => el.remove(), motionMs("--dur-base", 240));
    }
    const was = tabShown, wasPath = tabs.find((t) => t.id === was)?.path;
    tabs = d.tabs; tabActive = tabShown = d.active; tabClosed = !!d.closed;
    markTabs();
    tabGlide(stood);
    if (fresh.length) { void tabList.offsetWidth; fresh.forEach((el) => el.classList.remove("enter")); }
    // an empty tab shows all notes; a tab come to shows its note, not the tiles
    const now = tabs.find((t) => t.id === tabShown);
    if (window.MdOverview && now) {
      if (!now.path && (was !== tabShown || wasPath)) { if (MdOverview.isOpen) MdOverview.close(false); MdOverview.open(pasteTabs.has(now.id) ? "paste" : null); } // (from one empty tab to another: All Notes, or the pasteboard)
      else if (now.path && (was !== tabShown || !wasPath)) MdOverview.close(false); // (… and an empty tab given a note — a start's, from the sidebar: the note, not the tiles over it)
    }
  }
  function selectTab(id) {
    const t = tabs.find((x) => x.id === id);
    // the tab of the note that lies under all notes: back to the note
    if (t && id === tabActive && t.path && window.MdOverview && MdOverview.isOpen) { MdOverview.close(); return; }
    if (!t || id === tabActive) return;
    tabActive = id; // marked at once; the application answers with the tabs as they then are
    markTabs();
    if (t.path) going(t.path);
    post("tab", { op: "select", id });
  }
  const closeTab = (id) => post("tab", { op: "close", id });
  // pulled sideways, a tab goes along and the others make room; let go, it lands in the gap
  function pullTab(el, e) {
    const x0 = e.clientX;
    let els = null, from = -1, to = -1, step = 0, min = 0, max = 0;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!els) {
        const all = tabEls();
        if (Math.abs(dx) < 4 || all.length < 2) return;
        els = all; from = to = els.indexOf(el);
        const r = el.getBoundingClientRect(), a = els[0].getBoundingClientRect(), z = els[els.length - 1].getBoundingClientRect();
        step = els[1].getBoundingClientRect().left - a.left;
        min = a.left - r.left; max = z.right - r.right;
        el.classList.add("pulled");
        P.hideTip();
      }
      const d = Math.max(min, Math.min(max, dx));
      el.style.transform = `translateX(${d}px)`;
      to = Math.max(0, Math.min(els.length - 1, from + Math.round(d / step)));
      els.forEach((t, i) => {
        if (t === el) return;
        const s = i > from && i <= to ? -step : i < from && i >= to ? step : 0;
        t.style.transform = s ? `translateX(${s}px)` : "";
      });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (!els) return;
      const stood = new Map(els.map((t) => [t, t.getBoundingClientRect().left + (t.getBoundingClientRect().width - t.offsetWidth) / 2]));
      el.classList.remove("pulled");
      if (to !== from) {
        tabList.insertBefore(el, to > from ? els[to].nextSibling : els[to]);
        const t = tabs.splice(from, 1)[0];
        tabs.splice(to, 0, t);
        post("tab", { op: "move", id: Number(el.dataset.id), to });
      }
      el.classList.add("landing");
      setTimeout(() => el.classList.remove("landing"), motionMs("--spring-snappy-dur", 560));
      tabGlide(stood);
    };
    try { el.setPointerCapture(e.pointerId); } catch (_e) { /* (a pointer that is gone) */ }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  tabList.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".tab");
    if (!el || el.classList.contains("leaving") || e.target.closest(".tab-x")) return;
    if (e.button === 1) { e.preventDefault(); return; } // (the middle button closes, on its click)
    if (e.button !== 0) return;
    selectTab(Number(el.dataset.id));
    pullTab(el, e);
  });
  tabList.addEventListener("click", (e) => {
    const x = e.target.closest(".tab-x");
    if (x) closeTab(Number(x.parentNode.dataset.id));
  });
  tabList.addEventListener("auxclick", (e) => {
    const el = e.target.closest(".tab");
    if (el && e.button === 1) { e.preventDefault(); closeTab(Number(el.dataset.id)); }
  });
  tabbar.addEventListener("dblclick", (e) => { if (!e.target.closest(".tab, button")) post("tab", { op: "new" }); }); // (the empty room of the strip)
  tabbar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = e.target.closest(".tab");
    if (el && !el.classList.contains("leaving")) openCtx(el, e.clientX, e.clientY, "tab");
  });
  tabList.addEventListener("keydown", (e) => {
    const el = e.target.closest(".tab");
    if (!el || e.ctrlKey || e.metaKey || e.altKey) return;
    const els = tabEls(), i = els.indexOf(el);
    const next = e.key === "ArrowRight" ? els[i + 1] : e.key === "ArrowLeft" ? els[i - 1] : e.key === "Home" ? els[0] : e.key === "End" ? els[els.length - 1] : null;
    if (next) { e.preventDefault(); selectTab(Number(next.dataset.id)); next.focus({ preventScroll: true }); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); closeTab(Number(el.dataset.id)); }
  });
  /* The keys, before any part of the page sees them (Ctrl+Tab is the text's in no editor here).
   * Not under a dialog: what it holds belongs to the note on screen. */
  addEventListener("keydown", (e) => {
    if (!tabsOn() || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (P.locks > (document.body.hasAttribute("data-overview") ? 1 : 0)) return;
    const k = e.key.toLowerCase(), i = tabs.findIndex((t) => t.id === tabActive), n = tabs.length;
    let run = null;
    if (e.key === "Tab" || (!e.shiftKey && (e.key === "PageDown" || e.key === "PageUp"))) {
      const back = e.key === "Tab" ? e.shiftKey : e.key === "PageUp";
      run = () => { if (n > 1) selectTab(tabs[(i + (back ? n - 1 : 1)) % n].id); };
    } else if (k === "t") run = () => post("tab", { op: e.shiftKey ? "reopen" : "new" });
    else if (!e.shiftKey && k === "w") run = () => post("tab", { op: "close" });
    else if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) run = () => { const t = e.code === "Digit9" ? tabs[n - 1] : tabs[e.code.slice(5) - 1]; if (t) selectTab(t.id); }; // (9: the last, as in a browser)
    if (!run) return;
    e.preventDefault(); e.stopImmediatePropagation();
    run();
  }, true);
  // the room the toolbar takes at the strip's right end
  if (window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty("--tb-w", toolbar.offsetWidth + "px")).observe(toolbar);

  // what the page's other files use of this one
  /* Back and forward (Henri, 2026-10-14), as a browser has them: one way back for each tab through what was shown in it — the
   * notes, and All Notes in the folder it stood in — so that from a note one goes back to the folder one came from, and from
   * folder to folder. The arrows beside the house, Alt+← and Alt+→, the mouse's side buttons (viewer/toolbar.js). What is
   * shown says where it is: a note drawn (render.js), All Notes built (overview.js), All Notes closed over a note. */
  const NAV_MOST = 60, navs = new Map();
  let navTo = null, navUntil = 0; // (a step back or forward on its way: what is reported meanwhile and is not it is passed by)
  const navOf = () => { const id = String(tabShown ?? "-"); if (!navs.has(id)) navs.set(id, { back: [], fwd: [], here: null }); return navs.get(id); };
  const placeKey = (pl) => (!pl ? "" : pl.note ? "n:" + pl.note : "a:" + (pl.scope || "folders") + ":" + (pl.at || []).join("/"));
  function navHere(place) {
    if (!place || !tabsOn()) return;
    const n = navOf(), key = placeKey(place);
    if (navTo) {
      if (key === navTo || performance.now() > navUntil) navTo = null;
      else return;
    }
    if (placeKey(n.here) === key) return;
    if (n.here) { n.back.push(n.here); if (n.back.length > NAV_MOST) n.back.shift(); n.fwd = []; }
    n.here = place;
    navPaint();
  }
  function navGo(dir) {
    const n = navOf(), from = dir < 0 ? n.back : n.fwd, onto = dir < 0 ? n.fwd : n.back;
    const place = from.pop();
    if (!place) return false;
    if (n.here) onto.push(n.here);
    n.here = place;
    navTo = placeKey(place); navUntil = performance.now() + 2500;
    navPaint();
    if (place.note) {
      if (window.MdOverview && MdOverview.isOpen) MdOverview.close(false);
      if (!P.current || P.current.path !== place.note) post("note", { path: place.note });
      else navTo = null;
    } else if (window.MdOverview) MdOverview.showAt(place.at || [], place.scope);
    return true;
  }
  function navPaint() {
    const n = navOf();
    tabbar.querySelector('[data-act="navback"]').disabled = !n.back.length;
    tabbar.querySelector('[data-act="navfwd"]').disabled = !n.fwd.length;
  }
  // (All Notes closed over a note — Esc, the note's tab: the note is where one is; a note chosen from the tiles says so itself)
  let navClosed = 0;
  new MutationObserver(() => {
    if (document.body.hasAttribute("data-overview")) return;
    clearTimeout(navClosed);
    navClosed = setTimeout(() => { if (!document.body.hasAttribute("data-overview") && P.current && P.current.path) navHere({ note: P.current.path }); }, 400);
  }).observe(document.body, { attributes: true, attributeFilter: ["data-overview"] });

  Object.assign(P, { tabbar, tabRow, tabsOn, topRoom, tabEls, paintTab, setTabs, pasteTab, navHere, navGo, navPaint });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    tabs: [() => tabs],
    tabClosed: [() => tabClosed],
  });
})();
