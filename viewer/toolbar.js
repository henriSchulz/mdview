/* mdview, the page — what the toolbar's buttons and the keys do, the outline closed by a click
 * outside, a note larger and smaller, a link followed, the clipboard's text pasted, the settings
 * taken over. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T } = P; // viewer/base.js
  const { pageFileLine, viewOf, pageStep, pageOpen, toggleProp } = P; // viewer/prep.js
  const { shownRoot, scrollToFragment } = P; // viewer/render.js
  const { toolbar, outlinePop, findBar, toast, outlineOpen, findOpen, openOutline, closeOutline, focusHit,
    openFind, closeFind } = P; // viewer/chrome.js
  const { MODES, switchMode, flushSave, flush } = P; // viewer/editor.js
  const { isBoardImg, openBoard, codeBox, openCode, closeCode, openHistory, openShare, openSettings,
    printDoc } = P; // viewer/modes.js
  const { sidebar, sbHead, sbHistoryBtn, sidebarOpen, ctx, ctxSub, ctxOpen, openCtx, closeCtx } = P; // viewer/sidebar.js
  const { setTitles } = P; // viewer/menus.js
  const { compact, showSidebar, openNewNote, closeNewNote } = P; // viewer/drawer.js
  const { tabbar, tabsOn } = P; // viewer/tabs.js

  // --- toolbar + find buttons
  const actions = {
    outline: () => (outlineOpen() ? closeOutline() : openOutline()),
    find: () => (findOpen() ? closeFind() : openFind()),
    share: () => { if (P.current && P.current.kind !== "pdf" && !P.current.error) openShare(); else toast(T("Only notes can be shared")); },
    edit: () => switchMode(P.mode === "edit" ? "read" : "edit"),
    mode: (b) => switchMode(b.dataset.mode),
    sidebar: () => { if (P.folder) { showSidebar(!sidebarOpen(), true); if (!compact()) post("sidebar", { visible: sidebarOpen() }); } }, // (a drawer opened or shut on a phone is not how the sidebar is kept)
    overview: () => { if (P.folder && window.MdOverview) MdOverview.open(); }, // (the house: always to all notes — back to the note by its tab, or Esc)
    // the panel at the right — what can be put in, and the formats (active/panel.js). It belongs to the
    // active mode: in the others its button is dimmed and does nothing
    panel: () => { if (P.mode === "active" && window.MdActive && MdActive.panel) MdActive.panel.toggle(); }, // all notes of the folder as tiles (overview.js)
    titles: () => setTitles(!P.sbTitles),
    newnote: () => openNewNote(),
    newmenu: () => { // the + button: a note or a folder — among the quick notes a new one
      if (P.folder && P.folder.quick) return openNewNote();
      const b = sidebar.querySelector('[data-act="newmenu"]'), r = b.getBoundingClientRect();
      if (ctxOpen() && P.ctxKind === "new") { closeCtx(false); return; }
      openCtx(b, r.right, r.bottom + 4, "new");
    },
    // Sync Now: what is typed is saved first; the application keeps what waits and brings the two sides in line
    syncnow: () => {
      const b = sbHead.querySelector(".sb-sync");
      flush(false);
      post("sync-now");
      b.classList.remove("turning"); void b.offsetWidth; b.classList.add("turning"); // (it turns once: asked for)
      toast(T("Syncing…"));
    },
    historymenu: () => { // the clock: the folder's history, switched on or said to be
      const r = sbHistoryBtn.getBoundingClientRect();
      if (ctxOpen() && P.ctxKind === "history") { closeCtx(false); return; }
      openCtx(sbHistoryBtn, r.right, r.bottom + 4, "history");
    },
    folder: () => post("folder"),
    notefolder: () => post("folder", { here: true }),
    newtab: () => post("tab", { op: "new" }),
    prev: () => focusHit(P.hitIdx - 1),
    next: () => focusHit(P.hitIdx + 1),
    closefind: () => closeFind(),
  };
  // the panel's button leaves the focus where it is (in the text one goes on typing in)
  toolbar.addEventListener("mousedown", (e) => { if (e.target.closest('[data-act="panel"]')) e.preventDefault(); });
  for (const root of [toolbar, findBar, sbHead, tabbar]) {
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (b) actions[b.dataset.act](b);
    });
  }

  // click outside the outline closes it and is swallowed (macOS popover behaviour)
  let swallowClick = false;
  addEventListener("pointerdown", (e) => {
    if (ctxOpen() && ctxSub.contains(e.target)) return;
    if (ctxOpen() && !ctx.contains(e.target)) {
      closeCtx(false);
      if (e.button !== 0) return; // a right click goes on to open the next menu
    } else if (!outlineOpen() || outlinePop.contains(e.target) || e.target.closest('[data-act="outline"]')) return;
    else closeOutline();
    swallowClick = e.button === 0;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  addEventListener("click", (e) => {
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".page-row") && !e.target.closest('.pm[contenteditable="true"]')) { e.preventDefault(); e.target.click(); } });
  // a link to a note followed: in a tab of its own (the note it stands in stays open); a heading of this note: there
  const followWiki = (target) => { if (String(target).startsWith("#")) scrollToFragment(String(target).slice(1), true); else post("wikilink", { target, tab: "own" }); };
  // --- content clicks: links, tasks, copy
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const row = e.target.closest(".page-row");
    if (row && row.dataset.wiki != null) { // a link to a note, a block of its own (in text that is being edited: its block's own click, islands.js)
      if (!row.closest('.pm[contenteditable="true"]')) followWiki(row.dataset.wiki);
      return;
    }
    if (row && !row.closest(".pm") && !row.closest(".transclusion")) { pageOpen(row.dataset.page); return; } // (in the active mode: its block's own click, islands.js)
    const box = e.target.closest("input.task");
    if (box && box.dataset.prop != null) { // a property, true or false: written into the note at once
      if (box.closest(".pm")) { if (!(window.MdActive && MdActive.islands.propClicked(box))) e.preventDefault(); return; } // (in the active mode: written into its properties)
      const text = P.current && !P.current.readonly && !P.current.error && P.current.kind !== "pdf" && P.mode === "read" ? toggleProp(P.current.raw != null ? P.current.raw : P.current.text, box.dataset.prop, box.checked) : null;
      if (text == null) { e.preventDefault(); return; }
      P.current.raw = text;
      P.current.text = text.replace(/\r\n?/g, "\n");
      post("save", { text, path: P.current.path, exact: true, seq: ++P.saveSeq });
      return;
    }
    if (box) {
      // (in the text that is being edited a box is the editor's own — edit.js; one that stands in a
      // block of HTML there has a line number from when the note was read: nothing is ticked by it)
      if (box.closest('.pm[contenteditable="true"] .isl')) { e.preventDefault(); return; }
      if (box.disabled || box.dataset.line == null) { e.preventDefault(); return; }
      box.closest("li")?.classList.toggle("is-checked", box.checked);
      const shown = viewOf(P.current), line = Number(box.dataset.line);
      post("toggle", { line: shown && shown.pageOf ? pageFileLine(shown.root, shown.page, line) : line, checked: box.checked }); // (a page's line: the file's)
      return;
    }
    // code put away behind its card: shown in a window of its own (while it is edited, its dialog is that window)
    const card = e.target.closest(".code-card");
    if (card && !card.closest(".pm")) { openCode(card.closest(".code-block")); return; }
    if (e.target.closest("[data-codeview-close]") || e.target === codeBox) { closeCode(); return; }
    const copy = e.target.closest(".code-copy");
    if (copy) {
      post("copy", { text: copy.closest(".code-block").querySelector("code").textContent });
      copy.textContent = T("Copied");
      copy.classList.add("done");
      setTimeout(() => { copy.textContent = T("Copy"); copy.classList.remove("done"); }, 1400);
      return;
    }
    // A PDF embedded in the note is a picture: a double click shows it large, like any picture. To
    // the PDF itself it is Ctrl+click, or Go to PDF in its menu.
    // a whiteboard: opened (in the active mode: its block's own click, edit.js)
    const bi = e.target.closest(".board-block")?.querySelector("img") || (e.target.tagName === "IMG" ? e.target : null);
    if (bi && isBoardImg(bi) && !bi.closest(".pm") && shownRoot().contains(bi)) { e.preventDefault(); openBoard(bi); return; }
    const pe = e.target.closest(".pdf-embed[data-wiki]");
    if (pe && shownRoot().contains(pe)) { if (e.ctrlKey || e.metaKey) post("wikilink", { target: pe.dataset.wiki, tab: "own" }); return; }
    const a = e.target.closest("a");
    if (!a || !shownRoot().contains(a)) return;
    e.preventDefault();
    // In text that is being edited a click follows the link too (it is changed from the menu of a
    // right click: Edit Link…). Not with Alt held, which only places the caret in it, and not at
    // the end of a selection pulled over it.
    if (P.mode === "active" && MdActive.view.editable && !a.closest(".isl") && (e.altKey || !getSelection().isCollapsed)) return;
    if (P.mode === "active" && window.MdActive && MdActive.link) MdActive.link.close(); // (the small window under the link the caret came to rest in: not over the way out)
    // (another note or a PDF: in a tab of its own — the one it has already, else a new one — so the note the link stands in stays open; tab: "own")
    if (a.dataset.wiki != null) { post("wikilink", { target: a.dataset.wiki, tab: "own" }); return; }
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) { scrollToFragment(href.slice(1), true); return; }
    post("link", { href: a.href, tab: "own" });
  });
  document.addEventListener("auxclick", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    // the middle button on a link to a note or a PDF: in a tab of its own (not in text that is being edited: there it pastes)
    if (e.button !== 1 || !tabsOn() || !shownRoot().contains(a) || (P.mode === "active" && MdActive.view.editable && !a.closest(".isl"))) return;
    const href = a.getAttribute("href");
    if (a.dataset.wiki != null) post("wikilink", { target: a.dataset.wiki, tab: true });
    else if (href && !href.startsWith("#")) post("link", { href: a.href, tab: true });
  });
  addEventListener("mouseup", (e) => {
    if (e.button === 3) post("back");
    else if (e.button === 4) post("forward");
  });

  /* --- A note larger and smaller: Ctrl or Super with + and −, Ctrl+0 for its own size. Only the
   * note's text is scaled (the settings' docZoom, in percent) — the toolbar, the sidebar, menus and
   * dialogs keep their size. A PDF on screen has these keys for its pages (pdfview.js). Taken
   * before any part of the page sees them, so they work with the caret in the text too. */
  const DOC_ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250];
  const docZoom = () => (DOC_ZOOMS.includes(window.MdPrefs?.docZoom) ? MdPrefs.docZoom : 100);
  function setDocZoom(z) {
    if (z === docZoom()) { toast(z + " %"); return; }
    window.MdPrefs = { ...(window.MdPrefs || {}), docZoom: z };
    post("prefs", { prefs: { docZoom: z } });
    P.prefsChanged();
    toast(z + " %");
  }
  addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const up = e.key === "+" || e.key === "=" || e.code === "NumpadAdd", down = e.key === "-" || e.key === "_" || e.code === "NumpadSubtract";
    const reset = !e.shiftKey && (e.key === "0" || e.code === "Numpad0");
    if (!up && !down && !reset) return;
    if (window.MdPdf && MdPdf.shown && MdPdf.shown.root.isConnected) return; // (the PDF's own)
    if (window.MdBoard && MdBoard.shown) return; // (the whiteboard's own)
    e.preventDefault(); e.stopPropagation();
    const i = DOC_ZOOMS.indexOf(docZoom());
    setDocZoom(reset ? 100 : DOC_ZOOMS[Math.max(0, Math.min(DOC_ZOOMS.length - 1, i + (up ? 1 : -1)))]);
  }, true);

  // --- keyboard
  addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const typing = e.target.matches?.("input[type=search], input[type=text], textarea") || e.target.isContentEditable;
    if (e.key === "Escape") {
      if (closeCtx(true) || closeNewNote() || closeOutline() || closeFind()) e.preventDefault();
      return;
    }
    if (mod && e.shiftKey && k === "o") { e.preventDefault(); actions.outline(); return; }
    if (mod && e.shiftKey && k === "e") { e.preventDefault(); post("external"); return; }
    if (mod && e.altKey && !e.shiftKey && k === "s") { e.preventDefault(); actions.sidebar(); return; }
    if (mod && e.altKey && !e.shiftKey && k === "g") { e.preventDefault(); if (P.folder && window.MdOverview) MdOverview.toggle(); return; } // (the key goes there and back)
    if (mod && e.altKey && !e.shiftKey && k === "h") { e.preventDefault(); openHistory(); return; }
    if (mod && e.altKey && !e.shiftKey && k === "p") { e.preventDefault(); actions.panel(); return; }
    if (mod && e.altKey && !e.shiftKey && k === "o") { e.preventDefault(); post("folder"); return; }
    if (mod && e.altKey && !e.shiftKey && /^Digit[123]$/.test(e.code)) { e.preventDefault(); switchMode(MODES[e.code.slice(5) - 1]); return; }
    if (mod && !e.shiftKey && !e.altKey && k === "v") {
      // reading: an image on the clipboard goes to the end of the note
      if (!typing && P.mode === "read" && P.current && !P.current.error && !(window.MdHost && window.MdHost.drop)) post("pasteimage", { path: P.current.path, append: true }); // (a host that takes files: the paste event, above)
      return;
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const map = {
        f: openFind, e: actions.edit, o: () => post("open"), r: () => post("reload"),
        // (saved — and, in a folder with a history, kept as a version at once and sent to its
        // repository, without waiting for the quiet while)
        s: () => { if (P.mode !== "read") { flushSave(); toast(T("Saved")); } post("history-now"); },
        n: () => { if (P.folder) openNewNote(); },
        ",": openSettings,
        p: printDoc, w: () => post("close"), q: () => post("close"), // (Ctrl+W in a window with tabs: the tab, see there)
        g: () => focusHit(P.hitIdx + 1),
      };
      if (map[k]) { e.preventDefault(); map[k](); }
      return;
    }
    if (mod && e.shiftKey && k === "g") { e.preventDefault(); focusHit(P.hitIdx - 1); return; }
    // (among the pages of the note first; then among the notes)
    if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); if (!pageStep(-1)) post("back"); return; }
    if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); if (!pageStep(1)) post("forward"); return; }
    if (!typing && !mod && !e.altKey && e.key === "/") { e.preventDefault(); openFind(); }
  });

  // open a link as a click on it would: another note here, anything else outside
  function follow(href) {
    if (href.startsWith("#")) { scrollToFragment(href.slice(1), true); return; }
    post("link", { href: new URL(href, document.baseURI).href, tab: "own" });
  }
  // Ctrl held: links in the active mode show that a click follows them
  for (const type of ["keydown", "keyup", "blur"]) {
    addEventListener(type, (e) => document.body.classList.toggle("mod-down", type !== "blur" && (e.ctrlKey || e.metaKey)));
  }

  // Ctrl+Shift+V in the active mode: the clipboard's text, handed over by the application
  // Paste from the context menu: the application hands over what the page may not read itself
  function pasteClip(r) {
    if (P.mode === "active" && window.MdActive?.view?.editable) MdActive.clip.pasteFrom(MdActive.view.pm, r.text, r.html);
  }
  // the settings changed (here or in another window)
  function setPrefs(p) {
    window.MdPrefs = p;
    P.prefsChanged();
    if (window.MdActive?.onPrefs) MdActive.onPrefs();
  }
  // a dialog over the note: the note holds still (counted: one may open over another)
  // Not by a style on the page (taking its scrollbar away lays a long note out anew, 150 ms each
  // way): the place is kept, and whatever moves the page — a wheel beside the dialog, a key, a
  // touchpad still gliding — is put back at once.
  let locks = 0, lockX = 0, lockY = 0;
  const holdPlace = () => { if (scrollY !== lockY || scrollX !== lockX) scrollTo({ left: lockX, top: lockY, behavior: "instant" }); };
  function lockScroll(on) {
    const was = locks;
    locks = Math.max(0, locks + (on ? 1 : -1));
    if (!was && locks) { lockX = scrollX; lockY = scrollY; addEventListener("scroll", holdPlace, { passive: true }); }
    else if (was && !locks) removeEventListener("scroll", holdPlace);
  }
  // what of the page follows the settings: the order of the notes, the width of the text column

  // what the page's other files use of this one
  Object.assign(P, { followWiki, docZoom, follow, pasteClip, setPrefs, lockScroll });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    locks: [() => locks],
  });
})();
