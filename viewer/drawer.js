/* mdview, the page — the sidebar shown and hidden (a card that slides in over the note), an empty folder,
 * a new note made at once with the caret in its title, the window that asks for a new folder's or whiteboard's name. */
"use strict";
(() => {
  const P = window.MdPage;
  const { DESKTOP, content, post, T, esc, ICON } = P; // viewer/base.js
  const { reducedMotion } = P; // viewer/render.js
  const { editor, READING } = P; // viewer/editor.js
  const { sidebar, sidebarOpen, closeCtx } = P; // viewer/sidebar.js

  // --- showing / hiding: the sidebar slides in over the note (transform only)
  /* Under a finger. A browser makes mouse events of a tap, after the fact — a pointer that came to rest where the finger was: what
   * shows itself to a resting pointer asks touching() and shows itself by the tap instead.
   * What is pulled with a mouse (the edges things are sized at, a table's handles) is pulled by a finger the same way: on those
   * the touch is handed on as the mouse's press, moves and release, and the browser's own are left out. */
  // (an app, not a page: two fingers do not make the window's whole content larger — Safari asks with events of its own, and
  // does not heed what the page's head says; what is meant to be pinched, a whiteboard, a PDF, takes the fingers itself)
  if (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  let touchedAt = -1e9;
  addEventListener("touchstart", () => { touchedAt = performance.now(); }, { capture: true, passive: true });
  const touching = () => performance.now() - touchedAt < 1200;
  /* What the hand last used: a finger (or a pen), a mouse, the keys. Under a finger the screen's keyboard comes with the note's
   * focus, so the note is focused by the page only where the finger asked to type (active/view.js); with no time limit — a
   * block held and dragged for long, a dialog left after a while, is still a finger's doing. */
  let lastBy = "mouse";
  addEventListener("pointerdown", (e) => { lastBy = e.pointerType || "mouse"; }, true);
  addEventListener("touchstart", () => { lastBy = "touch"; }, { capture: true, passive: true });
  addEventListener("keydown", (e) => { if (e.isTrusted && !/^(Unidentified|Process)$/.test(e.key)) lastBy = "keys"; }, true);
  const byFinger = () => lastBy === "touch" || lastBy === "pen";
  {
    const GRIPS = "#sb-grip, .col-grip, .tbl-h-col, .tbl-h-row, .dlg-grip, .pa-sheet";
    let pulled = null;
    const mouse = (type, t, target, buttons) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons, clientX: t.clientX, clientY: t.clientY, screenX: t.screenX, screenY: t.screenY }));
    const under = (t) => document.elementFromPoint(t.clientX, t.clientY) || document.body;
    addEventListener("touchstart", (e) => {
      // (what lies under the finger, not what the browser took the touch for: it hands one that is near a thing made to be met
      // to that thing, and the note's margin beside the sidebar's edge is a place of its own)
      const t = e.touches.length === 1 ? e.touches[0] : null, hit = t && document.elementFromPoint(t.clientX, t.clientY);
      if (!hit || !hit.closest(GRIPS)) { pulled = null; return; }
      pulled = { id: t.identifier, moved: false };
      mouse("mousedown", t, hit, 1);
    }, { capture: true, passive: true });
    addEventListener("touchmove", (e) => {
      const t = pulled && [...e.changedTouches].find((x) => x.identifier === pulled.id);
      if (!t) return;
      if (e.cancelable) e.preventDefault();
      pulled.moved = true;
      mouse("mousemove", t, under(t), 1);
    }, { capture: true, passive: false });
    const done = (e) => {
      const t = pulled && [...e.changedTouches].find((x) => x.identifier === pulled.id);
      if (!t) return;
      const was = pulled;
      pulled = null;
      mouse("mouseup", t, under(t), 0);
      if (was.moved && e.cancelable) e.preventDefault(); // (pulled: no tap follows, and none of the browser's mouse events)
    };
    addEventListener("touchend", done, { capture: true, passive: false });
    addEventListener("touchcancel", done, { capture: true, passive: false });
  }
  /* A finger held on something for a moment is a right click: the menu of what it rests on. (A
   * browser on a phone sends no "contextmenu" for it — Safari never, others not everywhere — so
   * the page makes one, where the browser did not: its own counts and this one is dropped.) The
   * tap that would follow the lift is swallowed, so nothing under the menu is set off. */
  {
    const HOLD = 500, SLACK = 10;
    let held = null, own = 0, swallow = 0;
    const drop = () => { if (held) { clearTimeout(held.timer); held = null; } };
    addEventListener("pointerdown", (e) => {
      drop();
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      if (document.documentElement.hasAttribute("data-ipad")) return; // (an iPad has no menu under a held finger: its bars have what the menus had — viewer/touch.js)
      if (P.tiles && P.tiles.on() && e.target.closest?.("#active, .blk-h, #overview .ov-item")) return; // (nor the note in the active mode or a tile of All Notes, where the hand is a finger and the window wide: its bar has what the menu had)
      if (e.target.closest?.("#board")) return; // (on a whiteboard a finger held still is drawing, or about to)
      const target = e.target, x = e.clientX, y = e.clientY;
      held = { x, y, timer: setTimeout(() => {
        held = null;
        if (performance.now() - own < HOLD + 200 || !target.isConnected) return; // (the browser said it itself)
        swallow = performance.now();
        getSelection()?.removeAllRanges(); // (the word a held finger selects is not what was meant)
        target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, button: 2, clientX: x, clientY: y }));
      }, HOLD) };
    }, true);
    addEventListener("pointermove", (e) => { if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > SLACK) drop(); }, true);
    for (const type of ["pointerup", "pointercancel", "scroll"]) addEventListener(type, drop, true);
    addEventListener("contextmenu", (e) => { if (e.isTrusted) { own = performance.now(); drop(); } }, true);
    addEventListener("click", (e) => { if (swallow && performance.now() - swallow < 900) { swallow = 0; e.preventDefault(); e.stopPropagation(); } }, true);
  }
  /* A narrow window — a phone, a tablet held upright in a split: the sidebar is a drawer that lies
   * over the note (viewer/*.css, the same width), with a shade beside it that shuts it; a note chosen
   * in it shuts it too. */
  const narrow = window.matchMedia ? window.matchMedia("(max-width: 760px)") : { matches: false, addEventListener() {} };
  const compact = () => narrow.matches;
  const sbScrim = document.createElement("div");
  sbScrim.id = "sb-scrim";
  document.body.appendChild(sbScrim);
  sbScrim.addEventListener("click", () => { if (sidebarOpen()) showSidebar(false, true); });
  sidebar.addEventListener("click", (e) => { if (compact() && e.target.closest(".sb-item:not(.is-dir) > .sb-in > .sb-row") && !e.ctrlKey && !e.metaKey) showSidebar(false, true); });
  narrow.addEventListener("change", () => { if (P.folder && compact() && sidebarOpen()) showSidebar(false, false); });
  /* The sidebar lies over the note in every window, as a card that floats (Henri, 2026-10-20: "never moves the document"):
   * opened, only the card moves (transform) — the note, All Notes and the halves of a split stay where they are, and nothing of
   * the text is laid out anew. The strip of tabs makes room for the card (the sidebar's button stays beside it): its row glides
   * over (transform only). */
  function showSidebar(open, animate) {
    if (sidebarOpen() === !!open && document.body.dataset.sidebar) return;
    const tabsBefore = P.tabRow.getBoundingClientRect().left;
    sidebar.classList.toggle("no-anim", !animate);
    document.body.dataset.sidebar = open ? "open" : "closed";
    const tdx = tabsBefore - P.tabRow.getBoundingClientRect().left;
    if (!animate || reducedMotion() || !tdx) return;
    const el = P.tabRow;
    el.style.transition = "none";
    el.style.transform = `translateX(${tdx}px)`;
    void el.offsetWidth;
    el.style.transition = "";
    el.style.transform = "";
  }
  /* In a note the sidebar is shut to begin with (Henri, 2026-10-25: "standardmäßig zu, wenn man in einer Notiz ist"): the
   * window's first note, and a note come to out of All Notes. A note chosen in the sidebar leaves it as it is; the quick notes
   * keep theirs (it is their list). Told to the host as a hand that shut it would: the folder sent again shows it as it stood. */
  function noteShown(animate) {
    if (!P.folder || P.folder.quick || compact() || !sidebarOpen()) return;
    showSidebar(false, animate);
    post("sidebar", { visible: false });
  }
  new MutationObserver(() => { if (!document.body.hasAttribute("data-overview") && P.current) noteShown(true); })
    .observe(document.body, { attributes: true, attributeFilter: ["data-overview"] });
  /* Where the card lies over the note's text — a window too narrow for both — a press into the note puts it away, as a drawer
   * is put away; where the window is wide enough that it covers only the margin, it stays open while one reads and writes.
   * (Not over All Notes: there the two are used together — a tile pulled onto a folder in the sidebar. A narrow window: the
   * shade beside the drawer, above.) */
  const NOTE = "#content, #editor, #active, #split, #twin";
  function covers() {
    if (!sidebarOpen() || compact() || document.body.hasAttribute("data-overview")) return false;
    const col = P.inSource() ? editor : P.mode === "active" && window.MdActive?.view ? MdActive.view.el : content;
    if (!col || !col.getClientRects().length) return false;
    const r = col.getBoundingClientRect();
    return r.left + (parseFloat(getComputedStyle(col).paddingLeft) || 0) < sidebar.getBoundingClientRect().right;
  }
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !P.folder || !(e.target.closest?.(NOTE) || e.target === document.body || e.target === document.documentElement) || !covers()) return;
    showSidebar(false, true);
    post("sidebar", { visible: false });
  }, true);

  /* A folder with no note in it: said, and a note offered — the first thing a new folder shows.
   * (The note view and All Notes alike; the button asks for the note's name as the + does.) */
  /* Nothing open at all (the app started by itself, on the desktop): what can be opened — a folder of notes, which the
   * sidebar then shows, or one file. */
  const recentList = () => !P.recents?.length ? "" : `<div class="start-recent"><small>${esc(T("start.recent"))}</small>` +
    P.recents.map((r) => `<button class="start-row" type="button" data-recent="${esc(r.path)}" title="${esc(r.path)}"><span class="start-ico">${ICON.folder}</span><span class="start-name">${esc(r.name)}</span><span class="start-path">${esc(r.path.replace(/^\/home\/[^/]+/, "~"))}</span></button>`).join("") + `</div>`;
  const startState = () => `<div class="empty-state start-state"><div class="empty-icon">${ICON.folder}</div><b>${esc(T("start.title"))}</b><p>${esc(T("start.text"))}</p>` + recentList() +
    `<div class="start-go"><button class="btn primary" type="button" data-empty="folder">${esc(T("start.folder"))}</button><button class="btn" type="button" data-empty="file">${esc(T("start.file"))}</button></div></div>`;
  const emptyState = () => !P.folder && !READING && DESKTOP ? startState() : `<div class="empty-state"><div class="empty-icon">${ICON.folder}</div><b>${esc(T("empty.title"))}</b><p>${esc(T("empty.text"))}</p>` +
    (READING || !P.folder ? "" : `<button class="btn primary" type="button" data-empty="new">${esc(T("new.note"))}</button>`) + `</div>`;
  document.addEventListener("click", (e) => { if (e.target.closest?.('[data-empty="new"]') && P.folder) { e.preventDefault(); openNewNote(); } });
  document.addEventListener("click", (e) => { const r = e.target.closest?.("[data-recent]"); if (r) { e.preventDefault(); post("recent", { path: r.dataset.recent }); } });
  document.addEventListener("click", (e) => { const b = e.target.closest?.('[data-empty="folder"], [data-empty="file"]'); if (b) { e.preventDefault(); post(b.dataset.empty === "folder" ? "folder" : "open"); } });

  // --- new note
  /* A new folder or whiteboard is asked for in a small window of its own — from the sidebar's +, from
   * All Notes, from a menu: its name, and where it goes. Enter makes it, Esc (or a click beside the
   * window) does not. A new note is not asked for (openNewNote). */
  let newKind = "note", newDir = null, newDlg = null, newBack = null;
  const newOpen = () => !!newDlg && newDlg.hasAttribute("data-open");
  function buildNewNote() {
    newDlg = document.createElement("div");
    newDlg.id = "newdlg";
    newDlg.innerHTML = `<form class="new-box surface" role="dialog" aria-modal="true" aria-labelledby="new-title" novalidate>` +
      `<div class="new-head"><span class="new-sign" aria-hidden="true"></span><div class="new-words"><b id="new-title"></b><p class="new-where"></p></div></div>` +
      `<input id="new-name" class="sb-field" type="text" spellcheck="false" autocomplete="off">` +
      `<div class="new-foot"><button class="btn" type="button" data-new="cancel">${esc(T("dialog.cancel"))}</button><button class="btn primary" type="submit">${esc(T("new.create"))}</button></div></form>`;
    document.body.appendChild(newDlg);
    const input = newDlg.querySelector("#new-name"), go = newDlg.querySelector(".btn.primary");
    input.addEventListener("input", () => { go.disabled = !input.value.trim(); });
    newDlg.addEventListener("mousedown", (e) => { if (e.target === newDlg) { e.preventDefault(); closeNewNote(); } });
    newDlg.addEventListener("click", (e) => { if (e.target.closest('[data-new="cancel"]')) closeNewNote(); });
    newDlg.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeNewNote(); return; }
      if (e.key === "Enter" && !e.isComposing && e.target === input) { e.preventDefault(); newDlg.querySelector("form").requestSubmit(); return; }
      if (e.key !== "Tab") return; // (the keyboard stays in the window)
      const stops = [...newDlg.querySelectorAll("input, button:not(:disabled)")], i = stops.indexOf(document.activeElement);
      e.preventDefault();
      stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
    });
    // (… and no key of the window behind it works through it: Ctrl+E, Ctrl+F, Ctrl+W)
    newDlg.addEventListener("keydown", (e) => { if (e.ctrlKey || e.metaKey || e.altKey || /^F\d+$/.test(e.key)) { e.stopPropagation(); if (!/^[acvxz]$/i.test(e.key)) e.preventDefault(); } });
    newDlg.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = input.value.trim(), kind = newKind;
      if (!name) return;
      // next to the note on screen, if that one lives in this folder
      const here = newDir || (P.current && P.current.path.startsWith(P.folder.root + "/") && !document.body.hasAttribute("data-overview") ? P.current.path.replace(/\/[^/]*$/, "") : P.folder.root);
      closeNewNote(false);
      // (a whiteboard as a file of its own: the page writes what an empty one holds, the host makes the file and it opens)
      if (kind === "board") { P.loadBoard().then(() => post("newboard", { name, dir: here, text: window.MdBoard.emptyText() })).catch(() => P.toast(T("Couldn't make the whiteboard"))); return; }
      post("newfolder", { name, dir: here });
    });
  }
  function openNewNote(kind = "note", dir = null) {
    if (!P.folder || newOpen()) return;
    if (kind === "note") {
      /* A note is made at once, nothing asked: "Untitled", its title empty and the caret in it. What
       * is written there names the file once it is left alone a moment, and when it is left (the
       * host: settle_fresh). Among the quick notes: one named by the time, as ever. */
      // (next to the note on screen, if that one lives in this folder)
      const here = dir || (P.current && P.current.path.startsWith(P.folder.root + "/") && !document.body.hasAttribute("data-overview") ? P.current.path.replace(/\/[^/]*$/, "") : P.folder.root);
      closeCtx(false);
      if (window.MdOverview) MdOverview.close(false); // (the new note is opened: not under the tiles)
      if (P.folder.quick) post("quicknote"); else post("newnote", { name: "", dir: here });
      return;
    }
    if (!newDlg) buildNewNote();
    newKind = kind; newDir = dir;
    const input = newDlg.querySelector("#new-name");
    const where = dir || (P.current && P.current.path.startsWith(P.folder.root + "/") && !document.body.hasAttribute("data-overview") ? P.current.path.replace(/\/[^/]*$/, "") : P.folder.root);
    newDlg.querySelector(".new-sign").innerHTML = kind === "folder" ? ICON.folder : ICON.board;
    newDlg.querySelector("#new-title").textContent = T(kind === "folder" ? "new.folder" : "new.board");
    newDlg.querySelector(".new-where").textContent = T("new.in", where === P.folder.root ? P.folder.name : where.slice(P.folder.root.length + 1));
    input.placeholder = kind === "folder" ? "Folder name" : "Whiteboard name";
    input.setAttribute("aria-label", kind === "folder" ? "New folder name" : "New whiteboard name");
    input.value = "";
    newDlg.querySelector(".btn.primary").disabled = true;
    closeCtx(false);
    newBack = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    newDlg.dataset.open = "";
    input.focus({ preventScroll: true });
  }
  function closeNewNote(back = true) {
    if (!newOpen()) return false;
    delete newDlg.dataset.open;
    newDlg.querySelector("#new-name").blur();
    if (back && newBack && newBack.isConnected) newBack.focus({ preventScroll: true });
    newBack = null;
    return true;
  }

  /* A new note is on screen (New Note): the caret in its empty title, to name it by writing it. The
   * source editor has it there already (the host asks for its end: "# "). */
  function titleFresh() {
    let tries = 0;
    const go = () => {
      const v = window.MdActive && MdActive.view, pm = v && v.pm;
      if (P.mode === "active" && pm && v.payload && P.current && v.payload.path === P.current.path) {
        pm.dispatch(pm.state.tr.setSelection(PM.state.Selection.atStart(pm.state.doc)));
        v.focus();
      } else if (P.mode !== "read" && P.mode !== "active") {
        P.edInput?.focus({ preventScroll: true });
      } else if (tries++ < 80) setTimeout(go, 25);
    };
    go();
  }

  // what the page's other files use of this one
  Object.assign(P, { touching, byFinger, compact, showSidebar, noteShown, emptyState, openNewNote, closeNewNote, titleFresh });
})();
