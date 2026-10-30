/* mdview — renderer, source editor, folder sidebar + UI inside the web view.
 * The shell (src-tauri) calls MdView.render(payload) and friends; the page talks back via
 * window.MdHost.post (JSON strings).
 * This file is the last of the page's: AI, what the settings change, files dropped and pasted,
 * and window.MdView — what the shell calls and what active/*.js builds on (core). The rest is in
 * viewer/*.js, loaded before it (docs/MAP.md says where what is). */
"use strict";
(() => {
  const P = window.MdPage;
  const { NONCE, DESKTOP, ASSETS, post, T, esc, keys, SVG_ICON, ICON, fileHref, fileSize, fileExt,
    DECO_COLORS, CALLOUT_ICON, CALLOUT_BADGE, slugify, inlineText } = P; // viewer/base.js
  const { md, tex, imageSize, picText, alignMark, calloutKind, calloutTitle, LINK_ROW, linkMark, svgPicture, plainCode, codeHidden,
    codeLang, headColor, tableLook, tableMark, tableStyle, ruleLook, isExternal } = P; // viewer/markdown.js
  const { stripFrontmatter, stripComments, CALLOUT_STYLES, PAGE_STYLES, LINK_STYLES, PAGE_ROW, pageLook,
    pageMark, parsePages, pageLines, pagesText, pageView, pagePut, pageFileLine, viewOf, pageAppend,
    pageOpen, pagebar, pageName, toggleProp, setProp, BACKGROUNDS, docLook, docFacts, pageFacts,
    renderProps } = P; // viewer/prep.js
  const { going, render, clear, scrollToFragment, renderMermaid, mermaidSvg, setTheme, draw, captureAnchor } = P; // viewer/render.js
  const { toast } = P; // viewer/chrome.js
  const { edInput, READING, flushSave, flush } = P; // viewer/editor.js
  const { trailPush, trailShow, trailStep, saveFailed, setMode } = P; // viewer/trail.js
  const { isBoardImg, loadBoard, openBoard, newBoard, boardMade, linkResolved, busy, zoomImage, zoomFigure,
    zoomFigureAt, insertImage } = P; // viewer/modes.js
  const { sidebar, sortKey, sortNotes, resort, rowIcon, syncList, sbLayout, lookOf, colorVar, folderGlyph,
    sbPreviews, setFolder, moving, markShared, quickWhen, quickPreviews, quickFresh, GROUPS, groupOn,
    listed, applyFolder, openCtx } = P; // viewer/sidebar.js
  const { closePick, popup, combo, noteRenamed } = P; // viewer/menus.js
  const { touching, byFinger, emptyState } = P; // viewer/drawer.js
  const { topRoom, setTabs } = P; // viewer/tabs.js
  const { followWiki, docZoom, follow, pasteClip, setPrefs, lockScroll } = P; // viewer/toolbar.js

  /* The text column's width, as a share of the room the note has (the window beside the sidebar, a half of a split): the note
   * says which (its property "width" — the panel's Document part); in a narrow window it is the whole room at least 30rem. */
  const share = (p) => `max(${p}%, min(100%, 30rem))`;
  const MEASURES = { narrow: share(40), normal: share(50), wide: share(66), full: "none" }; // (Henri, 2026-10-14: what was narrow is normal now)
  let sortedBy = "opened", measured = "normal", zoomed = 100, listedAs = "";
  function measureSync() {
    const measure = MEASURES[docShown.width] ? docShown.width : "normal";
    if (measure === measured) return;
    measured = measure;
    if (measure === "normal") document.documentElement.style.removeProperty("--measure"); else document.documentElement.style.setProperty("--measure", MEASURES[measure]);
    window.dispatchEvent(new Event("resize")); // (what fits itself to the column's width does so again)
  }
  /* How the note on screen says it wants to be shown (prep.js: docLook) — its ground and its
   * width — taken from its properties as the file has them now: after it is drawn, in any mode,
   * and after every save. A page of a note is shown as its note is. The panel's Document tab
   * (active/panel.js) hears of it, and counts anew. */
  let docShown = { background: "", width: "normal" };
  /* Another ground (or none) for the next note: the one that was is laid over it as it stood and fades away, so that one goes
   * into the other instead of jumping (Henri, 2026-10-14). Not over All Notes, which has the window's own colour. */
  function groundGoes() {
    const root = document.documentElement;
    if (document.body.hasAttribute("data-overview") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const plain = !root.dataset.docBg, cs = getComputedStyle(root, plain ? null : "::before"), from = plain ? getComputedStyle(document.body) : cs; // (the ground's layer: viewer/page.css)
    for (const x of document.querySelectorAll(".ground-was")) x.remove();
    // (one over the window, and one in the strip of tabs, which has the ground of its own: viewer/tabs.css)
    const tabs = document.getElementById("tabs"), strip = tabs && getComputedStyle(tabs).display !== "none" ? getComputedStyle(tabs) : null;
    // (its picture as it was drawn there — never held at the window with `fixed`, which paints the window anew at each step)
    const lay = (parent, of) => {
      const was = document.createElement("div");
      was.className = "ground-was";
      was.setAttribute("aria-hidden", "true");
      was.style.backgroundColor = of.backgroundColor !== "rgba(0, 0, 0, 0)" ? of.backgroundColor : cs.backgroundColor;
      if (!plain) Object.assign(was.style, { backgroundImage: of.backgroundImage, backgroundSize: of.backgroundSize, backgroundPosition: of.backgroundPosition, backgroundRepeat: of.backgroundRepeat });
      parent.appendChild(was);
      return was;
    };
    const all = [lay(document.body, from), ...(strip ? [lay(tabs, strip)] : [])];
    void all[0].offsetWidth;
    requestAnimationFrame(() => {
      for (const was of all) was.classList.add("gone");
      setTimeout(() => all.forEach((was) => was.remove()), 900);
    });
  }
  function docSync() {
    const p = P.current, note = p && !p.error && p.kind !== "pdf" && typeof p.text === "string";
    const head = note ? (/^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(p.text) || [""])[0] : "";
    if (note && (!p._look || p._look.head !== head)) p._look = { head, look: docLook(head ? stripFrontmatter(head).props : null) }; // (read once for properties as they stand)
    docShown = note ? p._look.look : { background: "", width: "normal" };
    const root = document.documentElement;
    if ((root.dataset.docBg || "") !== (docShown.background || "")) groundGoes();
    if (docShown.background) root.dataset.docBg = docShown.background; else delete root.dataset.docBg; // (viewer/page.css)
    measureSync();
    if (window.MdActive && MdActive.panel) MdActive.panel.doc();
  }
  /* A property of the note set from the panel (null: taken away). In the active mode it is an edit
   * like any other — one step of its history, saved at once, the caret where it was; a page of a
   * note is not where the properties stand: there the file's text is put anew. In the reading view
   * the file is written and the note drawn again where it stands; the step is in the note's
   * history for the active mode to take back. Beside the source (alone or beside its reading) it
   * is an edit of the source like one typed: only the head of the text changes, one step of the
   * editor's own undo, the caret and the place in the text kept, saved at once. → whether it was done */
  function docSet(key, value) {
    const p = P.current;
    if (!p || p.readonly || p.error || p.kind === "pdf" || READING || !["active", "read", "edit", "split"].includes(P.mode)) return false;
    if (P.inSource()) {
      if (P.edPath !== p.path) return false;
      const before = edInput.value, text = setProp(before, key, value);
      if (text == null || text === before) return false;
      // what changed: the part between what stays at the front and what stays at the end (the head, as setProp writes it)
      let a = 0, b = 0;
      const max = Math.min(before.length, text.length);
      while (a < max && before.charCodeAt(a) === text.charCodeAt(a)) a++;
      while (b < max - a && before.charCodeAt(before.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
      const end = before.length - b, put = text.slice(a, text.length - b), by = put.length - (end - a);
      const map = (x) => (x >= end ? x + by : x < a ? x : a + put.length);
      const s = map(edInput.selectionStart), e = map(edInput.selectionEnd), focused = document.activeElement === edInput;
      const lines = (t) => t.split("\n").length - 1, at = P.captureEditAnchor(), headLine = lines(before.slice(0, end));
      P.edReplace(a, end, put, s, e); // (through the editor's undo, as a key would)
      if (!focused) edInput.blur();
      // the line at the window's top stays there (scrolled to the top, the head that came shows)
      if (at.line == null) scrollTo({ top: 0, behavior: "instant" });
      else {
        const el = P.edBack.children[at.line > headLine ? at.line + lines(put) - lines(before.slice(a, end)) : at.line];
        if (el) window.scrollBy({ top: el.getBoundingClientRect().top - at.top, behavior: "instant" });
      }
      flushSave(); // (written at once, the note's history a step on, the ground and width shown: docSync)
      return true;
    }
    if (P.mode === "active") {
      const view = window.MdActive && MdActive.view, shown = view && view.pm && viewOf(p);
      if (!shown) return false;
      if (!shown.pageOf) { if (!MdActive.islands.setProp(view.pm, key, value)) return false; flushSave(); return true; }
      const text = setProp(aiFileText(), key, value), caret = view.pm.hasFocus() ? view.caretOffset() : null, y = scrollY;
      if (text == null || !aiSetFileText(text)) return false;
      if (caret != null) view.caretAt(caret);
      if (scrollY !== y) scrollTo({ top: y, behavior: "instant" });
      post("save", { text: p.raw, path: p.path, exact: true, seq: ++P.saveSeq });
      docSync();
      return true;
    }
    const before = p.raw != null ? p.raw : p.text, text = setProp(before, key, value);
    if (text == null || text === before) return false;
    trailPush(p.path, p.text);
    p.raw = text;
    p.text = text.replace(/\r\n?/g, "\n");
    trailPush(p.path, p.text);
    post("save", { text, path: p.path, exact: true, seq: ++P.saveSeq });
    draw(p, captureAnchor());
    return true;
  }
  // ---------------------------------------------------------------- AI (ai.js, loaded when it is first asked for)
  /* Claude, asked through the claude command on this computer: to work on blocks of the note (Transform with AI, the menus of a
   * right click), and to talk about the whole note (the bubble at the lower right). The desktop only — and nowhere at all,
   * in no menu, once it is turned off in the settings. */
  const aiOn = () => DESKTOP && !READING && (window.MdPrefs || {}).aiOn !== false;
  let aiLoad = null;
  const loadAi = () => aiLoad || (aiLoad = new Promise((resolve, reject) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = `${ASSETS}/ai.css`;
    document.head.appendChild(l);
    const s = document.createElement("script");
    s.nonce = NONCE; s.src = `${ASSETS}/ai.js`; s.onload = () => resolve(window.MdAi); s.onerror = () => { aiLoad = null; reject(new Error("ai.js missing")); };
    document.head.appendChild(s);
  }));
  const aiBubble = document.createElement("button");
  aiBubble.id = "ai-bubble"; aiBubble.type = "button";
  aiBubble.title = T("ai.chat"); aiBubble.setAttribute("aria-label", T("ai.chat"));
  aiBubble.innerHTML = SVG_ICON.spark;
  aiBubble.addEventListener("click", () => loadAi().then((ai) => ai.chat.toggle()).catch(() => {}));
  document.body.appendChild(aiBubble);
  const aiShown = () => { document.body.toggleAttribute("data-ai", aiOn()); if (!aiOn() && window.MdAi) window.MdAi.off(); };
  aiShown();
  // (the note as it is written now, whatever the mode; and Markdown as the page shows it, for what Claude answers)
  const noteText = () => (P.mode === "active" && window.MdActive?.view?.pm ? MdActive.view.serialize(false) : P.inSource() ? edInput.value : P.current ? P.current.text || "" : "");
  /* The note's whole text as its file has it (what is typed is in it first). */
  function aiFileText() {
    if (P.mode === "active" && window.MdActive && MdActive.view.pm && MdActive.view.dirty) { P.leaving = true; flushSave(); P.leaving = false; }
    return P.inSource() ? edInput.value : P.current ? P.current.text || "" : "";
  }
  /* … and that text put anew (the active mode): shown, kept, and one step of the note's history — back with Ctrl+Z, or
   * undoFileText. The page on screen stays the page on screen. → whether it was done */
  function aiSetFileText(text) {
    if (P.mode !== "active" || !P.current || P.current.readonly || P.current.kind === "pdf" || !window.MdActive) return false;
    const before = aiFileText();
    text = String(text).replace(/\r\n?/g, "\n");
    if (text === before) return false;
    P.trailRedo = [];
    trailPush(P.current.path, before);
    trailPush(P.current.path, text);
    // (whoever had the keys keeps them: a field of the chat, the page's name being typed)
    const had = document.activeElement, named = !!(had && had.matches && had.matches(".pb-title")), sel = named ? [had.selectionStart, had.selectionEnd] : null;
    trailShow(text);
    P.trailFloor = P.trail.at;
    const back = named ? pagebar.querySelector(".pb-title") : had && had !== document.body && had.isConnected && !MdActive.view.dom.contains(had) ? had : null;
    if (back && back !== document.activeElement) { back.focus({ preventScroll: true }); if (sel) { try { back.setSelectionRange(sel[0], sel[1]); } catch (e) { /* (as it stands) */ } } }
    return true;
  }
  /* The folder's notes, for what the chat may be given to read: { path, name, dir }. */
  function folderNotes() {
    const out = [];
    const walk = (d, dir) => {
      for (const n of d.notes) out.push({ path: n.real || n.path, name: String(n.title || n.name || "").replace(/\.(md|markdown)$/i, ""), dir });
      for (const x of d.dirs) walk(x, dir ? dir + "/" + x.name : x.name);
    };
    if (P.folder) walk(P.folder.tree, "");
    return out;
  }
  // (an <svg> written bare, not in a fence, is put in one: as plain HTML among Markdown its empty lines would tear it apart)
  const fenceSvg = (text) => String(text).split(/(^```[\s\S]*?^```[^\n]*$)/m).map((part, i) => (i % 2 ? part : part.replace(/^[ \t]*(<svg[\s>][\s\S]*?<\/svg>)[ \t]*$/gim, (_m, svg) => "\n```svg\n" + svg.trim() + "\n```\n"))).join("");
  /* Markdown as the reading view shows it, into el (what Claude wrote): formulas, pictures of svg fences, and diagrams, which are drawn a moment later. */
  const drawDiagrams = (root) => { if (root.querySelector("pre.mermaid")) renderMermaid(P.generation, null, root).catch(() => {}); };
  function mdInto(el, text, diagrams = true) {
    el.innerHTML = mdHtml(fenceSvg(text));
    if (diagrams) drawDiagrams(el);
  }
  const mdHtml = (text) => md.render(stripComments(String(text)), { links: {}, outline: [], depth: 1, lineOffset: 0 });
  function prefsChanged() {
    aiShown();
    if (docZoom() !== zoomed) {
      // (what was at the top of the window stays there: the place is kept as a share of the page's height)
      const share = document.documentElement.scrollHeight > innerHeight ? scrollY / document.documentElement.scrollHeight : 0;
      zoomed = docZoom();
      if (zoomed === 100) document.documentElement.style.removeProperty("--doc-zoom"); else document.documentElement.style.setProperty("--doc-zoom", String(zoomed / 100));
      scrollTo({ top: share * document.documentElement.scrollHeight, behavior: "instant" });
      window.dispatchEvent(new Event("resize"));
    }
    const look = ["velum", "refined", "focus"].includes(window.MdPrefs?.look) ? MdPrefs.look : "app";
    document.documentElement.dataset.look = look === "app" ? "app" : "velum"; // (the Velum look: viewer/look.css)
    if (look === "refined" || look === "focus") document.documentElement.dataset.velumLook = look; else delete document.documentElement.dataset.velumLook; // (… and Refined or Focus on top of it: viewer/look.css)
    P.railOutline(); // (the outline at the right comes and goes with them: viewer/chrome.js)
    // (as the Velum lab draws the app: All Notes' sign is the tiles', reading comes first among the modes, callouts are cards)
    const lab = look === "refined" || look === "focus";
    const house = document.querySelector('#tabs [data-act="overview"]');
    if (house) house.innerHTML = lab ? ICON.apps : ICON.home;
    P.arrangeModes(lab ? ["read", "active", "edit", "split"] : ["active", "split", "edit", "read"]);
    document.documentElement.toggleAttribute("data-props-off", window.MdPrefs?.props === false); // (properties put away: viewer/*.css)
    const callout = lab && (window.MdPrefs?.calloutStyle || "box") === "box" ? "card" : window.MdPrefs?.calloutStyle; // (the default box is the lab's card in its looks)
    if (CALLOUT_STYLES.includes(callout)) document.documentElement.dataset.callout = callout; else delete document.documentElement.dataset.callout; // (how callouts and Focus look: viewer/*.css)
    const sort = sortKey();
    // what the sidebar or All Notes lists beside the notes: each shows its part anew (the application
    // sends the folder again only where what both want together changed)
    const lists = ["sidebar", "ov"].map((w) => GROUPS.map(([g]) => (groupOn(w, g) ? 1 : 0)).join("")).join("/");
    if (lists !== listedAs) { listedAs = lists; if (P.folder && P.folder.all) { P.folder.tree = P.folder.all; P.folder.visible = document.body.dataset.sidebar === "open"; applyFolder(P.folder, true); markShared(); } }
    if (sort !== sortedBy) { sortedBy = sort; resort(); }
    if (P.folder && sidebar.dataset.layout !== sbLayout()) syncList(false); // (the sidebar laid out another way)
    measureSync();
    if (window.MdActive && MdActive.panel) MdActive.panel.sync(); // (the panel at the right, if the settings have it open now)
  }
  // pictures dropped on the document, saved or found by the application
  function insertDropped(r) {
    if (P.mode === "active" && P.current && P.current.path === r.path) MdActive.clip.insertDropped(MdActive.view.pm, r.markups);
  }
  // files the application put back beside the note (a removal undone): their pictures are loaded anew
  function filesBack(names) {
    for (const img of document.querySelectorAll("#active img, #content img")) {
      let src = img.getAttribute("src") || "";
      try { src = decodeURIComponent(src); } catch (e) { /* (as it is) */ }
      if (!names.some((n) => src.split(/[?#]/)[0].endsWith(n))) continue;
      const u = img.src.split("#")[0].split("?")[0];
      img.src = u + "?" + Date.now();
    }
  }
  function pasteText(r) {
    if (window.MdOverview && MdOverview.pasted(r)) return; // (the pasteboard's Paste button asked)
    if (P.mode === "active" && window.MdActive?.view?.editable && typeof r.text === "string") MdActive.clip.insertPlain(MdActive.view.pm, r.text);
  }
  /* Tooltips of the app's own (after 700 ms, in the app's look) for everything that has a
   * title: the title moves to data-tip, so the browser's tooltip never shows. */
  const tipEl = document.createElement("div");
  tipEl.id = "apptip";
  tipEl.setAttribute("role", "tooltip");
  document.body.appendChild(tipEl);
  let tipTimer = 0, tipFor = null, tipWarm = 0;
  const hideTip = () => { clearTimeout(tipTimer); tipFor = null; delete tipEl.dataset.open; };
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest?.("[title], [data-tip]");
    if (t && t.hasAttribute("title")) { const v = t.getAttribute("title"); t.removeAttribute("title"); if (v) t.dataset.tip = v; } // (a title set anew is what is so now: it takes the place of the one before)
    const el = t && t.dataset.tip && !t.closest("#fmtbar, #linkpop") ? t : null; // (the active mode's own have their own)
    if (el === tipFor) return;
    hideTip();
    if (!el) return;
    tipFor = el;
    tipTimer = setTimeout(() => {
      if (!el.isConnected || tipFor !== el) return;
      tipEl.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      const below = r.bottom + 6 + h <= innerHeight - 8;
      tipEl.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + "px";
      tipEl.style.top = (below ? r.bottom + 6 : r.top - 6 - h) + "px";
      tipEl.dataset.open = "";
      tipWarm = Date.now();
    }, Date.now() - tipWarm < 1000 ? 0 : 700); // moving on from one tooltip to the next: at once
  });
  document.addEventListener("mousedown", hideTip, true);
  document.addEventListener("keydown", hideTip, true);
  window.addEventListener("blur", hideTip);
  prefsChanged(); // (a new window: the settings it was given — the note's size, the column's width)
  // a whiteboard's file changed on the disk (the shell says so): where the note shows it, its picture is made anew
  const boardChanged = (path) => { const name = String(path).split("/").pop(); if ([...document.querySelectorAll("#content img, #active img")].some((i) => (i.dataset.board || decodeURIComponent(i.src)).endsWith(name))) loadBoard().then(() => window.MdBoard.fileChanged(String(path))).catch(() => {}); };
  // (the application is told which whiteboards the note shows, so that it looks at their folders: the desktop only — a browser has no files)
  if (DESKTOP) {
    let told = "", telling = 0;
    const tell = () => {
      const base = String((window.MdHost || {}).files || "");
      const paths = [...new Set([...document.querySelectorAll("#content .board-block img, #active .board-block img")].map((i) => { const src = String(i.dataset.board || "") || (i.src.startsWith(base + "/") ? decodeURIComponent(i.src.slice(base.length).split(/[?#]/)[0]).replace(/^\/(?=[A-Za-z]:[\\/])/, "") : ""); return src; }).filter(Boolean))].sort();
      if (paths.join("\n") !== told) { told = paths.join("\n"); post("board-watch", { paths }); }
    };
    new MutationObserver(() => { clearTimeout(telling); telling = setTimeout(tell, 300); }).observe(document.body, { childList: true, subtree: true });
  }
  window.MdView = { filesBack, boardChanged, aiDelta: (id, text) => window.MdAi && MdAi.delta(id, text),
    aiDone: (id, text, error) => window.MdAi && MdAi.done(id, text, error),
    aiPicked: (list) => window.MdAi && MdAi.picked(list),
    pinch: (phase, scale) => (window.MdBoard && MdBoard.shown ? MdBoard.pinch(phase, scale) : window.MdPdf && MdPdf.pinch && MdPdf.pinch(phase, scale)),
    boardMade, boardText: (id, text, error) => window.MdBoard && MdBoard.answer(id, text, error),
    boardSaved: (id, error) => window.MdBoard && MdBoard.answer(id, error),
    boardPut: (id, names, error) => window.MdBoard && MdBoard.answer(id, names, error), prefsChanged,
    settingsInfo: (d) => window.MdActive && MdActive.prefs && MdActive.prefs.info(d),
    tour: () => P.tour.start(), // (the tour of the controls: viewer/tour.js)
    historyKept: () => window.MdActive && MdActive.prefs && MdActive.prefs.stale(),
    history: (d) => window.MdActive && MdActive.history && MdActive.history.got(d),
    historyText: (d) => window.MdActive && MdActive.history && MdActive.history.gotText(d),
    historyRestored: (d) => window.MdActive && MdActive.history && MdActive.history.restored(d), busy,
    share: (d) => window.MdActive && MdActive.share && MdActive.share.got(d),
    conflicts: (d) => window.MdActive && MdActive.conflict && MdActive.conflict.got(d),
    conflictsFailed: () => window.MdActive && MdActive.conflict && MdActive.conflict.failed(),
    graphic: (...a) => window.MdActive && MdActive.graphic && MdActive.graphic.result(...a),
    graphicImage: (...a) => window.MdActive && MdActive.graphic && MdActive.graphic.image(...a),
    completion: (...a) => window.MdActive && MdActive.ghost && MdActive.ghost.result(...a), linkResolved,
    noteRead: (...a) => P.splitGot(...a), noteSaved: (...a) => P.splitSaved(...a), pdfChunk: (...a) => window.MdPdf && MdPdf.chunk(...a), render, setTheme, scrollToFragment, toast, updateNotice: (n) => P.updateNotice(n),
    setMode, flush, saveFailed, setFolder, setTabs, clear, noteRenamed, insertImage, pasteText, pasteClip,
    setPrefs, insertDropped, openBoardFile: (path) => P.openBoardFile(path), revealRows: (paths) => P.revealRows(paths),
    setBoards: (list) => window.MdOverview && MdOverview.boards(list), pasteboard: (m) => window.MdOverview && MdOverview.pasteboard(m), // (a whiteboard that is a file of the folder opened; rows just made brought into sight; the folder's whiteboards, for All Notes)
    // what the active mode (active/*.js, loaded on demand) builds on
    core: { md, stripFrontmatter, stripComments, renderProps, toggleProp, setProp, doc: { BACKGROUNDS, look: () => docShown, facts: docFacts, set: docSet }, pages: { parse: parsePages, text: pagesText, view: pageView, put: pagePut, fileLine: pageFileLine, isRow: (raw) => PAGE_ROW.test(String(raw || "").trim()), idOf: (raw) => (PAGE_ROW.exec(String(raw || "").trim()) || [])[3] || null, STYLES: PAGE_STYLES, facts: pageFacts, append: (id, markdown) => pageAppend(id, markdown),
      // a page's line: how it looks — and the line that says it looks another way
      // a link to a note as a block of its own: [[inner]] and how it looks
      link: { STYLES: LINK_STYLES, isRow: (raw) => LINK_ROW.test(String(raw || "").trim()), innerOf: (raw) => (LINK_ROW.exec(String(raw || "").trim()) || [])[1] || "", lookOf: (raw) => pageLook((LINK_ROW.exec(String(raw || "").trim()) || [])[2]), mark: linkMark, follow: (target) => followWiki(target) },
      lookOf: (raw) => pageLook((PAGE_ROW.exec(String(raw || "").trim()) || [])[1]),
      rename: (raw, name) => { const m = PAGE_ROW.exec(String(raw || "").trim()); return m ? pageMark(pageLook(m[1]), pageName(name) || m[2], m[3]) : raw; }, titleOf: (raw) => (PAGE_ROW.exec(String(raw || "").trim()) || [])[2] || "",
      withLook: (raw, look) => { const m = PAGE_ROW.exec(String(raw || "").trim()); return m ? pageMark({ ...pageLook(m[1]), ...look }, m[2], m[3]) : raw; },
      // … and the page as it stands in the file, for the clipboard
      markdownOf: (raw) => { const m = PAGE_ROW.exec(String(raw || "").trim()), page = m && P.pagesShown && P.pagesShown.byId.get(m[3]); return page ? pageLines(page).join("\n").replace(/\r/g, "") : m ? pageMark(pageLook(m[1]), m[2]) + "\n\n<!-- /page -->" : String(raw || ""); }, fresh: () => "x" + ++P.pageFresh, open: (id) => pageOpen(id) }, isExternal, slugify, inlineText, esc, ICON: SVG_ICON, UI: ICON, DECO_COLORS, callout: { kind: calloutKind,
        title: calloutTitle, icon: CALLOUT_ICON, badge: CALLOUT_BADGE }, keys, follow, tex, mermaidSvg, toast,
      copy: (text) => post("copy", { text }), menuAt: (x, y, rows) => P.menuAt(x, y, rows), post, touching, byFinger, mdHtml, mdInto, drawDiagrams, fenceSvg, noteText,
      // (the folder's notes, for what the chat may be given to read: { path, name, dir })
      folderName: () => (P.folder ? (P.folder.quick ? "Quick Notes" : P.folder.name) : ""),
      folderNotes,
      ai: {
        // (the note as its file has it — its pages are sections of that text — and that text put anew, as one step back)
        fileText: aiFileText, setFileText: aiSetFileText, undoFileText: () => trailStep(-1),
        where: () => { const v = P.current && viewOf(P.current), out = []; for (let pg = v && v.page; pg && pg.id != null; pg = pg.parent) out.unshift(pg.title || "Untitled"); return out; }, on: aiOn, load: loadAi, transform: (view, range) => loadAi().then((ai) => ai.transform(view, range)).catch(() => {}) }, emptyState, zoomImage, zoomFigure, zoomFigureAt, going, sortNotes, svgPicture, plainCode, lockScroll, imageSize, picText, alignMark, popup, combo, closePick: () => closePick(false), moving, fileHref, fileSize, fileExt, codeHidden, codeLang, listed, rowIcon, when: quickWhen, markNote: (el) => P.markNote(el), navHere: (pl) => P.navHere(pl), folderLook: (path) => ({ color: colorVar(lookOf(path).color),
          sign: folderGlyph(lookOf(path)) }), tableLook, tableMark, tableStyle, headColor, ruleLook, fileMenu: (...a) => openCtx(...a), pasteTab: () => P.pasteTab(), fileCmd: (...a) => P.fileCmd(...a), addFiles: (...a) => P.addFiles(...a),
      hydrate: (root) => renderMermaid(P.generation, null, root), // diagrams in freshly inserted HTML
      board: { open: openBoard, is: isBoardImg, make: newBoard },
      filework: P.FILEWORK, get current() { return P.current; }, get folder() { return P.folder; }, get top() { return topRoom(); }, get left() { return P.sbRoom(); } },
    quickFresh, titleFresh: (path) => P.titleFresh(path),
    setPreviews: (p) => { const rest = sbPreviews(p); if (!Object.keys(rest).length && Object.keys(p || {}).length) return; quickPreviews(rest); if (window.MdOverview) MdOverview.previews(rest); } };

  // what the page's other files use of this one
  Object.assign(P, { prefsChanged, hideTip, docSync });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    sortedBy: [() => sortedBy, (v) => { sortedBy = v; }],
  });
})();
