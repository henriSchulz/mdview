/* mdview, the page — what is loaded when first used and shown over or instead of the note: the
 * active mode (active/*.js), whiteboards, PDFs, a picture or code enlarged, the windows for
 * history, sharing, conflicts and settings; leaving a mode, printing; the source editor's
 * typing helpers. */
"use strict";
(() => {
  const P = window.MdPage;
  const { NONCE, ASSETS, content, post, T, esc, motionMs, ICON } = P; // viewer/base.js
  const { md } = P; // viewer/markdown.js
  const { viewOf, pageBar, stripFrontmatter, stripComments } = P; // viewer/prep.js
  const { DECO_COLORS } = P; // viewer/base.js
  const { placeOf, draw, shownRoot, restoreAnchor, scrollToFragment, reducedMotion, scrollToEnd,
    renderMermaid } = P; // viewer/render.js
  const { findInput, toast, outlineOpen, findOpen, buildOutline, runFind } = P; // viewer/chrome.js
  const { AUTOSAVE_MS, editor, edWrap, edInput, edBack, READING, showMode, paint, revealCaret, flushSave } = P; // viewer/editor.js
  const { trailPush, trailStep } = P; // viewer/trail.js

  // --- active mode: the rendered document, editable in place (active/*.js).
  // Loaded on first use, so reading and editing start as fast as without it.
  // --- whiteboards: a board stands in the note as a picture (*.board.svg) and is opened over the
  // window (board.js, board/*.js), loaded on first use
  let boardLoad = null;
  const BOARD_SRC = /\.board\.svg(?:[?#]|$)/i;
  const isBoardImg = (img) => !!img && img.tagName === "IMG" && (img.dataset.board != null || BOARD_SRC.test(img.getAttribute("src") || ""));
  function loadBoard() {
    const script = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE; s.async = false; s.src = `${ASSETS}/${src}`; s.onload = resolve; s.onerror = () => reject(new Error(src + " missing"));
      document.head.appendChild(s);
    });
    return boardLoad || (boardLoad = (async () => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = `${ASSETS}/board.css`;
      const styled = new Promise((resolve) => { l.onload = l.onerror = resolve; });
      document.head.appendChild(l);
      await Promise.all([styled, ...["board/format.js", "board/render.js", "board/shape.js", "board/items.js", "board/layer.js", "board/view.js", "board/pointer.js", "board/ink.js", "board/select.js", "board/pdf.js", "board.js"].map(script)]);
    })().catch((e) => { boardLoad = null; throw e; }));
  }
  function openBoard(img) {
    if (!isBoardImg(img)) return false;
    loadBoard().then(() => window.MdBoard.open(img)).catch(() => toast("Couldn't open the whiteboard"));
    return true;
  }
  /* A whiteboard that is a file of the folder (its row in the sidebar, its tile in All Notes): opened
   * over the window as one in a note is — a picture that stands nowhere says which file it is. */
  function openBoardFile(path) {
    const img = new Image();
    img.dataset.board = path;
    loadBoard().then(() => { if (window.MdBoard.shown) window.MdBoard.close(true); return window.MdBoard.open(img); }).then((ok) => { if (ok && window.MdOverview) MdOverview.boardsStale(); }).catch(() => toast("Couldn't open the whiteboard"));
  }
  /* … and shown in the note on screen, as a picture is: put in at the caret in the active mode; in
   * the other two its link goes to the clipboard, to be put where it belongs. */
  function embedBoard(path) {
    if (!P.current || !P.current.path) return;
    const from = P.current.path.split("/").slice(0, -1), to = path.split("/");
    let same = 0;
    while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
    const rel = [...from.slice(same).map(() => ".."), ...to.slice(same)].map(encodeURIComponent).join("/");
    if (P.mode === "active" && window.MdActive && MdActive.view.pm) { MdActive.clip.insertDropped(MdActive.view.pm, [`![](${rel})`]); return; }
    post("copy", { text: `![](${rel})` });
    toast(T("Link copied: paste it where the whiteboard is to stand"));
  }
  /* A new board in the note (the / menu, the panel; context.js): the host makes its file where
   * the note's pictures go and says how it is written; then it stands at the caret and is opened. */
  let boardWanted = null;
  function newBoard(put) {
    if (!P.current || boardWanted) return;
    const path = P.current.path;
    loadBoard().then(() => {
      boardWanted = { id: "n" + Date.now(), path, put };
      post("board-new", { path, text: window.MdBoard.emptyText(), id: boardWanted.id });
      setTimeout(() => { boardWanted = null; }, 8000); // (no answer: asked again the next time)
    }).catch(() => toast("Couldn't make the whiteboard"));
  }
  function boardMade(r) {
    const w = boardWanted;
    boardWanted = null;
    if (!w || !r || r.id !== w.id || !P.current || P.current.path !== w.path) return;
    if (r.error || !r.markup) { toast("Couldn't make the whiteboard"); return; }
    w.put(r.markup);
    // its picture, once it is drawn (in a vault the host is asked first where the name leads): the board opens
    const name = String(r.file || "").split("/").pop();
    let tries = 0;
    const look = () => {
      const img = name && [...shownRoot().querySelectorAll("img")].find((i) => isBoardImg(i) && decodeURIComponent((i.getAttribute("src") || "").split(/[?#]/)[0]).endsWith(name));
      if (img) openBoard(img); else if (++tries < 40) setTimeout(look, 50);
    };
    setTimeout(look, 0);
  }

  // --- PDFs: the viewer and embeds (pdfview.js, pdf.js), loaded on first use
  let pdfLoad = null;
  function loadPdf() {
    const script = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE; s.async = false; s.src = `${ASSETS}/${src}`; s.onload = resolve; s.onerror = () => reject(new Error(src + " missing"));
      document.head.appendChild(s);
    });
    return pdfLoad || (pdfLoad = (async () => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = `${ASSETS}/pdfview.css`;
      document.head.appendChild(l);
      // All of them are asked for at once and run in this order (a script put in by a script runs
      // in the order it was put in when it is not `async`). One after the other, each waiting for
      // the one before, the first change into this mode took half a second longer.
      await Promise.all(["vendor/pdfjs/pdf.worker.min.js", "vendor/pdfjs/pdf.min.js", "pdfview.js"].map(script));
    })().catch((e) => { pdfLoad = null; throw e; }));
  }
  /* An embed typed or pasted after the note was read has no place yet (the application resolves
   * links when it reads the note). It is asked for, and what shows the embed is drawn anew. */
  const asked = new Set();
  function resolveSoon(target) {
    if (asked.has(target) || !P.current) return;
    asked.add(target);
    setTimeout(() => post("resolve", { target }), 0);
  }
  function linkResolved(target, info) {
    asked.delete(target); // (answered: what misses it later — after an undo, a paste — asks again)
    if (!P.current || !P.current.links) return;
    P.current.links[target] = info;
    if (!info) return;
    const html = md.renderInline(`![[${target}]]`, { links: P.current.links, depth: 0 });
    for (const span of document.querySelectorAll(".embed-missing[data-wiki]")) {
      if (span.dataset.wiki === target) span.outerHTML = html;
    }
    // the active mode keeps the HTML of what it shows: there too
    const pm = window.MdActive && MdActive.view && MdActive.view.pm;
    if (pm) {
      let tr = null;
      pm.state.doc.descendants((node, pos) => {
        if (typeof node.attrs.html !== "string" || !node.attrs.html.includes("embed-missing")) return;
        if (node.type.name === "iatom" && node.attrs.raw === `![[${target}]]`) {
          tr = (tr || pm.state.tr).setNodeMarkup(pos, null, { ...node.attrs, html });
        } else if (node.type.name === "island" && String(node.attrs.raw || "").includes(`![[${target}`)) {
          // a block that is the embed (a picture alone in its paragraph, a PDF's page, a file as code): drawn anew, whole —
          // it stayed "⤷ name" for good: a picture shown as a file and undone, or cut and pasted, was not there
          const again = MdActive.islands.blocksOf(node.attrs.raw, MdActive.view.store).find((n) => n.type.name === "island");
          if (again && again.attrs.html !== node.attrs.html) tr = (tr || pm.state.tr).setNodeMarkup(pos, null, { ...node.attrs, html: again.attrs.html });
        }
      });
      if (tr) pm.dispatch(tr.setMeta("addToHistory", false).setMeta("allowLoss", true));
    }
    pdfEmbedsSoon();
  }
  let pdfEmbedTimer = 0, pdfWatch = null;
  function pdfEmbedsSoon() { // an embedded PDF was written into the page: draw it once it stands there
    clearTimeout(pdfEmbedTimer);
    pdfEmbedTimer = setTimeout(() => loadPdf().then(() => MdPdf.hydrate(document), () => {}), 30);
    // (the active mode builds its elements anew from kept HTML, without coming through the
    // renderer: from the first embed on, new ones are looked for whenever the page changes)
    if (!pdfWatch) {
      pdfWatch = new MutationObserver(() => {
        if (!document.querySelector(".pdf-embed:not([data-done])")) return;
        clearTimeout(pdfEmbedTimer);
        pdfEmbedTimer = setTimeout(() => loadPdf().then(() => MdPdf.hydrate(document), () => {}), 30);
      });
      pdfWatch.observe(document.body, { childList: true, subtree: true });
    }
  }
  /* A picture, large: a double click on it lets it grow from its place to the size of the window
   * (a drawing as large as fits, a photo no larger than it is). A click, Esc or scrolling puts it back.
   * A drawing that stands in the page itself — a Mermaid diagram, a fence of SVG — does the same: a
   * copy of it flies (zoomFigure). */
  const zoomBox = document.createElement("div");
  zoomBox.id = "zoom";
  zoomBox.setAttribute("role", "dialog");
  zoomBox.setAttribute("aria-label", "Picture");
  zoomBox.innerHTML = '<img alt="">';
  document.body.appendChild(zoomBox);
  let zoomFrom = null, zoomBig = zoomBox.firstChild; // (what flies: the box's own picture, or the copy of a drawing)
  const zoomOpen = () => zoomBox.hasAttribute("data-open");
  function zoomPlace(img) { // where the large picture lies, and the transform that puts it over the small one
    const big = zoomBig, r = img.getBoundingClientRect(), drawn = img.localName !== "img";
    const nw = img.naturalWidth || r.width, nh = img.naturalHeight || r.height;
    const vector = drawn || /\.svg([?#]|$)/i.test(img.currentSrc || img.src) || /^data:image\/svg|^blob:/.test(img.src);
    const scale = Math.min((innerWidth * 0.94) / nw, (innerHeight * 0.92) / nh, vector ? Infinity : Math.max(1, r.width / nw));
    const w = nw * scale, h = nh * scale, left = (innerWidth - w) / 2, top = (innerHeight - h) / 2;
    big.style.width = w + "px"; big.style.height = h + "px"; big.style.left = left + "px"; big.style.top = top + "px";
    return `translate(${r.left - left}px, ${r.top - top}px) scale(${r.width / w}, ${r.height / h})`;
  }
  /* Code that is put away (a fence with "hide"), shown: a window over the page with the code, its
   * language, Copy and a way out — Esc, a click beside it, the cross. */
  const codeBox = document.createElement("div");
  codeBox.id = "codeview";
  codeBox.innerHTML = `<div class="codeview-box surface" role="dialog" aria-modal="true" aria-labelledby="codeview-title" tabindex="-1">` +
    `<header class="codeview-head"><b id="codeview-title"></b><span class="code-lang"></span><span class="codeview-space"></span>` +
    `<button class="btn code-copy" type="button">${esc(T("Copy"))}</button><button class="tb" type="button" data-codeview-close aria-label="${esc(T("Close"))}" title="${esc(T("Close (Esc)"))}">${ICON.x}</button></header>` +
    `<div class="code-block"><pre><code></code></pre></div></div>`;
  document.body.appendChild(codeBox);
  let codeFrom = null;
  const codeOpen = () => codeBox.hasAttribute("data-open");
  function openCode(block) {
    const code = block && block.querySelector("pre code");
    if (!code || codeOpen()) return false;
    codeFrom = document.activeElement;
    const title = block.querySelector(".code-card-title"), lang = block.querySelector(".code-lang");
    codeBox.querySelector("#codeview-title").textContent = title && !title.classList.contains("code-card-peek") ? title.textContent : "Code";
    codeBox.querySelector(".code-lang").textContent = lang ? lang.textContent : "";
    const shown = codeBox.querySelector("pre code");
    shown.className = code.className;
    shown.innerHTML = code.innerHTML;
    codeBox.dataset.open = "";
    codeBox.querySelector("pre").scrollTop = 0;
    codeBox.firstChild.focus({ preventScroll: true });
    return true;
  }
  function closeCode() {
    if (!codeOpen()) return false;
    delete codeBox.dataset.open;
    if (codeFrom && codeFrom.isConnected) codeFrom.focus({ preventScroll: true });
    codeFrom = null;
    return true;
  }
  document.addEventListener("keydown", (e) => {
    if (!codeOpen()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeCode(); }
    else if (e.key === "Tab") { // the focus stays in the window
      const all = [...codeBox.querySelectorAll("button")], i = all.indexOf(document.activeElement);
      e.preventDefault(); e.stopPropagation();
      all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus();
    } else if (!codeBox.contains(e.target) && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); } // (nothing is typed into the note behind it)
  }, true);
  /* Something that takes a moment and must not be done twice — a pasted or dropped file on its
   * way into a repository: the window says so at once, and takes nothing typed, pasted or
   * clicked until it is over. The application says when (MdView.busy: a text, then null). */
  const busyBox = document.createElement("div");
  busyBox.id = "busy";
  busyBox.setAttribute("role", "status");
  busyBox.innerHTML = `<div class="busy-card surface"><span class="busy-ring" aria-hidden="true"></span><span class="busy-text"></span></div>`;
  document.body.appendChild(busyBox);
  let busyTimer = 0;
  const isBusy = () => busyBox.hasAttribute("data-open");
  function busy(text) {
    clearTimeout(busyTimer);
    if (!text) { delete busyBox.dataset.open; return; }
    busyBox.querySelector(".busy-text").textContent = text;
    busyBox.dataset.open = "";
    busyTimer = setTimeout(() => { delete busyBox.dataset.open; }, 90000); // (whatever became of it: the window is not held for good)
  }
  for (const type of ["keydown", "keypress", "paste", "drop", "beforeinput"]) document.addEventListener(type, (e) => { if (isBusy()) { e.preventDefault(); e.stopPropagation(); } }, true);
  function zoomImage(img) {
    if (!img || !img.complete || !img.naturalWidth || zoomOpen()) return false;
    zoomBig = zoomBox.firstChild;
    zoomBig.src = img.currentSrc || img.src;
    return zoomFly(img);
  }
  // a drawing in the page (an <svg>): its copy, on a ground of the page's colour (a diagram is drawn for it)
  function zoomFigure(svg) {
    const r = svg && svg.getBoundingClientRect();
    if (!svg || !r.width || !r.height || zoomOpen()) return false;
    zoomBox.querySelector(".zoom-fig")?.remove();
    zoomBig = svg.cloneNode(true);
    zoomBig.removeAttribute("style"); zoomBig.removeAttribute("width"); zoomBig.removeAttribute("height");
    if (!zoomBig.hasAttribute("viewBox")) zoomBig.setAttribute("viewBox", `0 0 ${r.width} ${r.height}`);
    zoomBig.setAttribute("class", ((svg.getAttribute("class") || "") + " zoom-fig").trim());
    zoomBox.appendChild(zoomBig);
    return zoomFly(svg);
  }
  const zoomFigureAt = (target) => { // the drawing a click fell on: a diagram's or a fence's own <svg>
    const block = target && target.closest && target.closest(".mermaid-block, .svg-block");
    return block ? block.querySelector(":scope > svg") : null;
  };
  function zoomFly(img) {
    const big = zoomBig;
    zoomFrom = img;
    big.style.transition = "none";
    big.style.transform = zoomPlace(img);
    zoomBox.dataset.open = "";
    void big.offsetWidth;
    big.style.transition = "";
    big.style.transform = "none";
    img.style.visibility = "hidden"; // (it is the one that flies)
    return true;
  }
  function zoomClose() {
    if (!zoomOpen()) return false;
    const big = zoomBig, img = zoomFrom;
    delete zoomBox.dataset.open;
    if (img && img.isConnected) big.style.transform = zoomPlace(img);
    setTimeout(() => { if (img) img.style.visibility = ""; if (zoomOpen() && zoomBig === big) return; if (big.localName === "img") big.removeAttribute("src"); else big.remove(); }, motionMs("--dur-slow", 270) * 0.7);
    zoomFrom = null;
    return true;
  }
  zoomBox.addEventListener("click", zoomClose);
  window.addEventListener("wheel", () => zoomClose(), { passive: true });
  window.addEventListener("resize", () => zoomClose());
  document.addEventListener("keydown", (e) => { if (zoomOpen() && (e.key === "Escape" || e.key === " " || e.key === "Enter")) { e.preventDefault(); e.stopPropagation(); zoomClose(); } }, true);
  // (reading view; in the active mode the editor says when a picture was double clicked)
  content.addEventListener("dblclick", (e) => {
    const img = e.target.closest?.("img"), fig = img ? null : zoomFigureAt(e.target);
    if (fig) { e.preventDefault(); getSelection()?.removeAllRanges(); zoomFigure(fig); return; }
    if (!img || img.closest(".pdfv, a") || isBoardImg(img)) return; // (an embedded PDF page is a picture like any other here; a whiteboard is opened, by the click before)
    e.preventDefault();
    getSelection()?.removeAllRanges();
    zoomImage(img);
  });
  // the settings, from any mode (their dialog is the active mode's: loaded when first asked for)
  // — by Ctrl+, and by the gear at the window's lower left corner (the foot of the sidebar)
  const gear = document.createElement("button");
  gear.id = "settings-btn";
  gear.className = "tb";
  gear.type = "button";
  gear.dataset.tip = "Settings (Ctrl+,)";
  gear.setAttribute("aria-label", "Settings");
  gear.innerHTML = ICON.gear;
  gear.addEventListener("mousedown", (e) => e.preventDefault());
  gear.addEventListener("click", () => openSettings());
  if (READING) gear.style.display = "none"; // (a note that is only read: there is nothing of the reader's to set)
  document.body.appendChild(gear);
  // the history of the note shown (active/history.js): its versions, what each changed, one put back
  function openHistory() {
    loadActive().then(() => { MdActive.history.open(); }, () => toast(T("active.loadFailed")));
  }
  // a note shared under a link (active/share.js): for anyone, or with a password
  function openShare(path) {
    loadActive().then(() => { MdActive.share.open(path); }, () => toast(T("active.loadFailed")));
  }
  // a linked project whose two sides changed the same place: the window to say how it is to be (active/conflict.js)
  function openConflicts() {
    loadActive().then(() => { MdActive.conflict.open(); }, () => toast(T("active.loadFailed")));
  }
  function openSettings() {
    if (window.MdHost && window.MdHost.reading) return; // (a note that is only read: no settings, by the gear or by Ctrl+,)
    loadActive().then(() => { if (!MdActive.dialog.open) MdActive.prefs.open(); }, () => toast(T("active.loadFailed")));
  }
  let activeLoad = null, preloadTimer = 0;
  function loadActive() {
    const script = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE;
      s.async = false;
      s.src = `${ASSETS}/${src}`;
      s.onload = resolve;
      s.onerror = () => reject(new Error(src + " missing"));
      document.head.appendChild(s);
    });
    const style = (href) => new Promise((resolve, reject) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = `${ASSETS}/${href}`;
      l.onload = resolve;
      l.onerror = () => reject(new Error(href + " missing"));
      document.head.appendChild(l);
    });
    return activeLoad || (activeLoad = (async () => {
      const css = Promise.all(["text", "tables", "bar", "prefs", "blocks", "panel", "narrow"].map((s) => style(`active/${s}.css`))); // (linked in this order: later ones win)
      await Promise.all(["vendor/prosemirror.min.js", "active/store.js", "active/schema.js",
        "active/tables.js", "active/markdown.js", "active/document.js", "active/link.js", "active/dialog.js",
        "active/latex-snippets.js", "active/latexsuite.js", "active/islands.js", "active/menu.js",
        "active/edit.js", "active/tableui.js", "active/notes.js", "active/clip.js", "active/context.js",
        "active/bar.js", "active/prefs.js", "vendor/diff.min.js", "active/history.js", "active/conflict.js",
        "active/share.js", "active/slash.js", "active/wikilink.js", "active/syntax.js", "active/graphic.js",
        "active/mathtext.js", "active/ghost.js", "active/columns.js", "active/blocks.js", "active/panel.js",
        "active/view.js"].map(script)); // (asked for at once, run in this order — see the PDF viewer's scripts)
      await css;
      MdActive.view.onChange = activeChanged; MdActive.view.onHistory = trailStep;
      MdActive.panel.sync(); // (the panel at the right, where the settings have it open beside the reading view)
    })().catch((e) => { activeLoad = null; throw e; }));
  }
  function showActive(p, anchor) {
    const gen = ++P.generation;
    const v = viewOf(p); // (a note with pages: the page it is at)
    P.pagesShown = v.root || null;
    const fresh = MdActive.view.payload !== v && !(MdActive.view.payload && MdActive.view.payload.path === p.path && MdActive.view.edited);
    const store = MdActive.view.show(v);
    P.docSync();
    pageBar(v, MdActive.view.dom.parentNode);
    // a document built anew starts its own undo history here; older steps are the trail's
    if (MdActive.view.built !== P.activeBuilt) { P.activeBuilt = MdActive.view.built; trailPush(p.path, p.text); P.trailFloor = P.trail.at; }
    P.outline = store.env.outline;
    if (outlineOpen()) buildOutline();
    if (anchor) restoreAnchor(anchor, MdActive.view.dom);
    else if (p.fragment) scrollToFragment(p.fragment, false);
    else if (p.toEnd) scrollToEnd();
    else { window.scrollTo(0, p.arriving ? placeOf(p) : 0); p.arriving = false; } // (a note come to: where it was left; the top the first time)
    p.toEnd = false;
    if (findOpen()) runFind(findInput.value, true);
    renderMermaid(gen, anchor, MdActive.view.dom);
    if (fresh && window.scrollY > 4) MdActive.view.caretToView(); // type where you are, not at the top
  }
  // after every edit in the active mode: save soon, keep the find marks right
  function activeChanged() {
    if (!P.trailStepping) P.trailRedo = [];
    clearTimeout(P.saveTimer);
    P.saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
    if (findOpen()) {
      clearTimeout(P.findTimer);
      P.findTimer = setTimeout(() => runFind(findInput.value, true), 120);
    }
  }
  // The active mode can't show this (an error page): back to reading, at once.
  function leaveActiveNow() {
    MdActive.view.leave();
    post("mode", { edit: false });
    clearTimeout(P.swapTimer);
    P.swapTimer = 0;
    P.mode = "read";
    document.body.dataset.view = "read";
    document.body.classList.remove("swapping");
    showMode();
    MdActive.panel.sync();
  }
  // Another file took over the window: back to reading, without the fade.
  function leaveEditNow() {
    clearTimeout(P.swapTimer);
    clearTimeout(P.saveTimer);
    P.swapTimer = P.saveTimer = 0;
    P.mode = "read";
    P.edPath = null;
    document.body.dataset.view = "read";
    document.body.classList.remove("swapping");
    showMode();
    if (window.MdActive && MdActive.panel) MdActive.panel.sync();
    post("mode", { edit: false });
  }
  function printDoc() {
    if (P.mode === "edit") { // print the rendered page, not the source
      flushSave();
      draw({ ...P.current, text: edInput.value }, null, true);
    } else if (P.mode === "active" && (!P.drawn || P.drawn.p !== P.current || P.drawn.text !== P.current.text)) {
      draw(P.current, null, true); // what prints is the reading view
    }
    post("print");
  }

  // --- typing helpers. Edits go through execCommand so native undo keeps working.
  function edReplace(start, end, text, selA, selB) {
    edInput.focus({ preventScroll: true });
    edInput.setSelectionRange(start, end);
    const ok = text ? document.execCommand("insertText", false, text) : start === end || document.execCommand("delete");
    if (!ok) {
      edInput.setRangeText(text, start, end, "end");
      edInput.dispatchEvent(new Event("input"));
    }
    if (selA != null) edInput.setSelectionRange(selA, selB ?? selA);
    revealCaret();
  }
  const LIST_LINE = /^\s*(?:[-*+]|\d{1,9}[.)])\s/;
  function edIndent(outdent) {
    const v = edInput.value, s = edInput.selectionStart, e = edInput.selectionEnd;
    const unit = /^\t/m.test(v) ? "\t" : "    ";
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
    if (le < 0) le = v.length;
    const block = v.slice(ls, le);
    if (s === e && !outdent && !LIST_LINE.test(block)) { edReplace(s, e, unit); return; }
    const lines = block.split("\n");
    const out = lines.map((l) => (outdent ? l.replace(/^(?:\t| {1,4})/, "") : l && unit + l));
    const text = out.join("\n");
    if (text === block) return;
    if (s === e) edReplace(ls, le, text, Math.max(ls, s + out[0].length - lines[0].length));
    else edReplace(ls, le, text, ls, ls + text.length);
  }
  // Enter continues lists, tasks and quotes; on an empty item it ends them.
  function edNewline() {
    const v = edInput.value, s = edInput.selectionStart;
    if (s !== edInput.selectionEnd) return false;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", s);
    if (le < 0) le = v.length;
    const line = v.slice(ls, le);
    const m = /^([ \t]*(?:>[ \t]?)*[ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[.\][ \t]+)?)?/.exec(line);
    if (!m[0] || s - ls < m[0].length) return false;
    if (line.length === m[0].length) {
      if (!m[2] && !m[1].includes(">")) return false;
      edReplace(ls, le, "");
      return true;
    }
    let next = m[1];
    if (m[2]) {
      const n = /^(\d+)([.)])/.exec(m[2]);
      next += (n ? Number(n[1]) + 1 + n[2] + m[2].slice(n[0].length) : m[2]).replace(/\[.\]/, "[ ]");
    }
    edReplace(s, s, "\n" + next);
    return true;
  }
  function edSurround(mark) {
    const v = edInput.value, s = edInput.selectionStart, e = edInput.selectionEnd, n = mark.length;
    if (s >= n && v.slice(s - n, s) === mark && v.slice(e, e + n) === mark) {
      edReplace(s - n, e + n, v.slice(s, e), s - n, e - n);
    } else {
      edReplace(s, e, mark + v.slice(s, e) + mark, s + n, e + n);
    }
  }
  function edLink() {
    const v = edInput.value, s = edInput.selectionStart, e = edInput.selectionEnd, sel = v.slice(s, e);
    if (/^https?:\/\/\S+$/.test(sel)) edReplace(s, e, `[](${sel})`, s + 1);
    else edReplace(s, e, `[${sel}](url)`, e + 3, e + 6);
  }
  const EDIT_KEYS = { b: () => edSurround("**"), i: () => edSurround("*"), k: edLink };

  edInput.addEventListener("input", () => {
    paint(edInput.value);
    revealCaret();
    clearTimeout(P.saveTimer);
    P.saveTimer = setTimeout(flushSave, AUTOSAVE_MS);
    if (findOpen()) {
      clearTimeout(P.findTimer);
      P.findTimer = setTimeout(() => runFind(findInput.value, true), 120);
    }
  });
  edInput.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey, plain = !mod && !e.altKey;
    if (e.key === "Tab" && plain) { e.preventDefault(); edIndent(e.shiftKey); }
    else if (e.key === "Enter" && plain && !e.shiftKey) { if (edNewline()) e.preventDefault(); }
    else if ((e.key === "PageDown" || e.key === "PageUp") && plain) {
      // like macOS: paging scrolls, the caret stays (the textarea is as tall as the text)
      e.preventDefault();
      window.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * (innerHeight - 80), behavior: reducedMotion() ? "instant" : "smooth" });
    }
    else if (mod && !e.shiftKey && !e.altKey && EDIT_KEYS[e.key.toLowerCase()]) { e.preventDefault(); EDIT_KEYS[e.key.toLowerCase()](); }
    else if (/^(Arrow|Home|End)/.test(e.key)) requestAnimationFrame(revealCaret);
  });
  // Pasting an image: the page can't get at the image data, so the shell saves it
  // as a file and answers with the Markdown to insert (insertImage).
  edInput.addEventListener("paste", (e) => {
    if (!e.clipboardData || e.clipboardData.getData("text/plain")) return;
    e.preventDefault();
    // (a host that takes files gets what the event carries; another is asked to look at the clipboard)
    const files = window.MdHost && window.MdHost.drop ? [...(e.clipboardData.files || [])] : [];
    if (files.length) window.MdHost.drop(files, P.edPath, { pasted: true }); else post("pasteimage", { path: P.edPath });
  });
  // reading: a picture pasted goes to the end of the note (where the host takes files: from the event itself)
  document.addEventListener("paste", (e) => {
    if (!(window.MdHost && window.MdHost.drop) || P.mode !== "read" || !P.current || P.current.error || P.current.readonly || P.current.kind === "pdf") return;
    if (e.target.closest?.("input, textarea, [contenteditable]") || !e.clipboardData || e.clipboardData.getData("text/plain").trim()) return;
    const files = [...(e.clipboardData.files || [])];
    if (!files.length) return;
    e.preventDefault();
    window.MdHost.drop(files, P.current.path, { pasted: true, append: true });
  });
  function insertImage(r) {
    if (P.mode === "active" && P.current && P.current.path === r.path) { window.MdActive?.clip.insertMarkdown(MdActive.view.pm, r.markup); return; }
    if (P.mode !== "edit" || P.edPath !== r.path) return;
    edReplace(edInput.selectionStart, edInput.selectionEnd, r.markup);
  }
  // the textarea never scrolls on its own; the page does
  edInput.addEventListener("scroll", () => { edInput.scrollTop = 0; edInput.scrollLeft = 0; });
  editor.addEventListener("mousedown", (e) => {
    if (e.target !== editor && e.target !== edWrap) return;
    e.preventDefault(); // margin around the text: focus, below it: caret to the end
    edInput.focus({ preventScroll: true });
    if (e.clientY > edBack.getBoundingClientRect().bottom) edInput.setSelectionRange(edInput.value.length, edInput.value.length);
  });

  // what the page's other files use of this one
  Object.assign(P, { previewOf, pdfShot, isBoardImg, loadBoard, openBoard, openBoardFile, embedBoard, newBoard, boardMade, loadPdf, resolveSoon,
    linkResolved, pdfEmbedsSoon, codeBox, openCode, closeCode, busy, zoomImage, zoomFigure, zoomFigureAt,
    openHistory, openShare, openConflicts, openSettings, loadActive, showActive, activeChanged,
    leaveActiveNow, leaveEditNow, printDoc, edReplace, insertImage });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  // ---------------------------------------------------------------- what a file shows of itself, small
  /* All Notes' tiles and the sidebar's sheets show a note by its beginning and a PDF by its first page. */
  // the beginning of a note as the reading view would show it — without what only works in a note on screen
  function previewOf(path, text, more = {}) { // more: { whole: the note as it reads, its name too; links: what its links lead to }
    const fm = stripFrontmatter(text.replace(/\r\n?/g, "\n"));
    let html = "";
    try { html = md.render(stripComments(fm.body), { lineOffset: 0, links: more.links || {}, outline: [], depth: 1 }); } catch (e) { html = ""; }
    const box = document.createElement("template");
    box.innerHTML = html;
    const dir = (window.MdHost?.files || "file://") + path.replace(/\/[^/]*$/, "").split("/").map(encodeURIComponent).join("/") + "/";
    for (const x of box.content.querySelectorAll("[id], [data-line]")) { x.removeAttribute("id"); x.removeAttribute("data-line"); }
    for (const x of box.content.querySelectorAll("script, iframe, video, audio, .code-tools")) x.remove();
    for (const img of box.content.querySelectorAll("img")) {
      const src = img.getAttribute("src") || "";
      if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("/")) img.setAttribute("src", dir + src); // beside the note, not beside the one on screen
      img.setAttribute("loading", "lazy");
      img.removeAttribute("title");
    }
    for (const a of box.content.querySelectorAll("a")) a.removeAttribute("href");
    const color = fm.props && typeof fm.props.color === "string" && DECO_COLORS.includes(fm.props.color.trim().toLowerCase()) ? fm.props.color.trim().toLowerCase() : null;
    for (const x of box.content.querySelectorAll(more.whole ? ".katex-mathml" : "h1:first-child, .katex-mathml")) x.remove(); // (a row's words: without the name again)
    return { html: box.innerHTML.trim(), color, text: box.content.textContent.replace(/\s+/g, " ").trim().slice(0, 240) };
  }
  /* A PDF's first page as a picture: pdfShot(path, v) → its address ("": the PDF cannot be read). One PDF after the other — each
   * has to be read whole for it — and kept for as long as the window is, by the file and v (when it was changed).
   * pdfShot.now: what is known already; pdfShot.known: whether it was asked for at all. */
  const shots = new Map();
  let shotLine = Promise.resolve();
  const shotKey = (path, v) => path + "@" + (v || 0);
  function pdfShot(path, v) {
    const key = shotKey(path, v);
    if (shots.has(key)) return Promise.resolve(shots.get(key));
    return (shotLine = shotLine.then(async () => {
      if (shots.has(key)) return shots.get(key);
      let src = "";
      try { await loadPdf(); src = (await window.MdPdf.pageShot(path, 1, 280)).img.src; } catch (e) { src = ""; }
      shots.set(key, src);
      return src;
    }));
  }
  pdfShot.now = (path, v) => shots.get(shotKey(path, v)) || "";
  pdfShot.known = (path, v) => shots.has(shotKey(path, v));

  // ---------------------------------------------------------------- pictures turned
  /* A picture written with a turn (|r90, |r180, |r270: viewer/markdown.js) is drawn turned once and shown as that drawing — a
   * picture like any other from then on: as large as it then is, with the text around it where a picture of that shape belongs
   * (a turn by CSS would leave the room of the upright one). The address it was written with is kept beside it (data-src). One
   * that cannot be drawn so — from another site, which a canvas may not hand back — is turned where it stands. */
  const turnedUrl = new Map(); // address + "@" + turn → the turned picture's address ("": cannot be drawn)
  function turnPic(img) {
    const turn = img.dataset.turn;
    if (!/^(90|180|270)$/.test(turn || "") || img.dataset.turned === turn) return;
    const src = img.dataset.src || img.getAttribute("src") || "", key = src + "@" + turn;
    if (!src) return;
    img.dataset.src = src;
    const put = (url) => { if (img.dataset.turn !== turn) return; img.dataset.turned = turn; if (url) { img.src = url; img.style.rotate = ""; } else img.style.rotate = turn + "deg"; };
    if (turnedUrl.has(key)) return put(turnedUrl.get(key));
    const raw = new Image();
    raw.onload = () => {
      if (turnedUrl.has(key)) return put(turnedUrl.get(key));
      try {
        const w = raw.naturalWidth || 300, h = raw.naturalHeight || 150, k = Math.min(1, 4096 / Math.max(w, h)), side = turn !== "180";
        const c = document.createElement("canvas"), ctx = c.getContext("2d");
        c.width = Math.round((side ? h : w) * k); c.height = Math.round((side ? w : h) * k);
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((Number(turn) * Math.PI) / 180);
        ctx.drawImage(raw, (-w * k) / 2, (-h * k) / 2, w * k, h * k);
        c.toBlob((blob) => { turnedUrl.set(key, blob ? URL.createObjectURL(blob) : ""); put(turnedUrl.get(key)); }, "image/png");
      } catch (e) { turnedUrl.set(key, ""); put(""); }
    };
    raw.onerror = () => {}; // (no picture there: nothing to turn)
    raw.src = src;
  }
  if (typeof MutationObserver === "function") new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") { if (m.target.tagName === "IMG") turnPic(m.target); continue; }
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "IMG") turnPic(node);
        else if (node.firstElementChild) for (const img of node.querySelectorAll("img[data-turn]")) turnPic(img);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-turn"] });

  P.live({
    activeLoad: [() => activeLoad],
    preloadTimer: [() => preloadTimer, (v) => { preloadTimer = v; }],
  });
})();
