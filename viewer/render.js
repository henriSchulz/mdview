/* mdview, the page — rendering: a note drawn into #content, the place in it kept across a
 * redraw, the way to a heading or a line, Mermaid diagrams, the theme's colours. */
"use strict";
(() => {
  const P = window.MdPage;
  const { NONCE, ASSETS, content, baseEl, post, T, esc, ICON, slugify } = P; // viewer/base.js
  const { md } = P; // viewer/markdown.js
  const { stripFrontmatter, stripComments, pagePut, viewOf, pageBar, renderProps } = P; // viewer/prep.js

  let current = null, outline = [], generation = 0;
  let mode = "read"; // "read" | "edit" | "active" | "split" (the source beside its reading: viewer/twin.js)
  let drawn = null;  // what #content shows: { p, text }

  /* Another note asked for by hand (the sidebar, a tile): the window answers at once — the row is
   * marked, the note on screen makes way, a wheel turns in its place after a moment — and the note
   * is drawn two frames later, when that has been shown. Drawing a long note holds the page for
   * some tenths of a second; without this the click seemed not to have been taken. */
  const loader = document.createElement("div");
  loader.id = "loading";
  loader.setAttribute("aria-hidden", "true");
  document.body.appendChild(loader);
  let goingAt = 0, goingTo = null, goingTimer = 0, pendingRender = null, renderFrame = 0;
  let modeBeforePdf = null; // the mode a note was in when a PDF took its place, or nothing did (an empty tab, All Notes)
  /* Where each note was left: opened again — after a PDF, another note, in a new window — it stands
   * at that place. Kept as the note is scrolled (the page's own storage, by the file's path). */
  const places = new Map();
  let placeTimer = 0;
  const placeKey = (path) => "mdview-place:" + path;
  function placeOf(p) {
    if (!p || !p.path || p.kind === "pdf") return 0;
    if (places.has(p.path)) return places.get(p.path);
    try { return Math.max(0, Number(localStorage.getItem(placeKey(p.path))) || 0); } catch (e) { return 0; }
  }
  function keepPlace() {
    if (!current || !current.path || current.kind === "pdf" || current.error || goingAt || document.body.hasAttribute("data-overview")) return;
    const y = Math.round(scrollY);
    places.set(current.path, y);
    try { if (y > 0) localStorage.setItem(placeKey(current.path), String(y)); else localStorage.removeItem(placeKey(current.path)); } catch (e) { /* no storage: this window remembers */ }
  }
  addEventListener("scroll", () => { clearTimeout(placeTimer); placeTimer = setTimeout(keepPlace, 250); }, { passive: true });
  function going(path) {
    if (!current || path === current.path) return;
    goingAt = performance.now();
    goingTo = path;
    document.body.dataset.going = "";
    for (const row of document.querySelectorAll("#sidebar .sb-row[data-real]")) row.classList.toggle("active", row.dataset.real === path || row.closest(".sb-item")?.dataset.key === path);
    clearTimeout(goingTimer);
    goingTimer = setTimeout(arrived, 5000); // (whatever happens, the page does not stay empty)
  }
  function arrived() {
    clearTimeout(goingTimer);
    goingAt = 0;
    goingTo = null;
    delete document.body.dataset.going;
  }
  function render(p) {
    if (!goingAt) { renderNow(p); return; }
    pendingRender = p; // (the newest, if another comes before it is drawn)
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      const q = pendingRender;
      pendingRender = null;
      try { renderNow(q); } finally { requestAnimationFrame(arrived); }
    }); });
  }
  function renderNow(p) {
    const prev = current;
    p.arriving = !prev || prev.path !== p.path; // (only a note come to is put where it was left — not one drawn again)
    clearTimeout(placeTimer); // (a place still to be kept is the note's that is leaving — it was kept as it was scrolled)
    if (p.kind === "pdf") { // shown in the reading view's place; nothing of it is edited here
      if (mode !== "read") modeBeforePdf = mode; // (the note after the PDF is in this mode again)
      if (P.inSource(mode)) { P.flushSave(); P.leaveEditNow(); }
      if (mode === "active") P.leaveActiveNow();
      p.text = p.raw = "";
      current = p;
      document.title = p.name;
      if (P.navHere && p.path && (!prev || prev.path !== p.path)) P.navHere({ note: p.path });
      if (!prev || prev.path !== p.path) P.markActiveNote(true);
      draw(p, null);
      return;
    }
    // (another note than the one before: the count of saves is the application's again — a save that
    // came too late for the note it was for is not counted there, and would keep every later state
    // of this note from being shown)
    if (p.seq != null && (!prev || prev.path !== p.path)) P.saveSeq = Math.min(P.saveSeq, p.seq);
    // read from disk before the last save from here was written: older than what is on screen
    if (prev && prev.path === p.path && p.seq != null && p.seq < P.saveSeq && !p.error) return;
    p.raw = p.text; // as on disk; the active mode keeps line endings as they are
    p.text = p.text.replace(/\r\n?/g, "\n");
    current = p;
    if (!p.error) P.trailPush(p.path, p.text);
    if (P.navHere && p.path && (!prev || prev.path !== p.path)) P.navHere({ note: p.path }); // (back and forward: viewer/tabs.js)
    // the mode the app was last used in (once, for the window's first note)
    // back from a PDF, or from a tab with no note in it: the mode the note before it was in (neither
    // has modes; it only looked like a change to reading)
    if (!prev || prev.kind === "pdf") {
      const back = modeBeforePdf;
      modeBeforePdf = null;
      if (back && !p.error && !(P.inSource(back) && p.readonly)) setTimeout(() => { if (current === p && mode === "read") P.setMode(back); }, 0);
    }
    if (p.startMode && p.startMode !== "read" && !p.error && !(P.inSource(p.startMode) && p.readonly)) setTimeout(() => { if (current === p && mode === "read") P.setMode(p.startMode); }, 0);
    document.title = p.name || "Markdown Notes";
    if (p.base && baseEl.href !== p.base) baseEl.href = p.base; // relative links and images
    if (!prev || prev.path !== p.path) P.markActiveNote(true);
    if (P.inSource(mode)) {
      if (prev && prev.path === p.path) { P.adoptDisk(p); return; }
      P.leaveEditNow();
    }
    if (mode === "active") {
      if (!p.error) {
        if (prev && prev.path === p.path && !MdActive.view.shows(viewOf(p))) { MdActive.dialog.closeFields(); if (MdActive.menu.isOpen) MdActive.menu.close(true); } // a popover's place is gone, and a menu's entries name places of the text that was; a dialog finds its block again (islands.js)
        if (prev && prev.path === p.path && MdActive.view.dirty) { // edits here that are not saved yet win, as in the source editor
          if (p.text !== prev.text) P.toast(T("active.keptEdits"));
          const shown = MdActive.view.payload, text = MdActive.view.serialize();
          if (shown && shown.pageOf) { p.raw = pagePut(shown.root, shown.page, text); P.pageTree = { raw: p.raw, path: p.path, root: shown.root }; } else p.raw = text;
          p.text = p.raw.replace(/\r\n?/g, "\n");
        }
        P.showActive(p, p.keepScroll ? captureAnchor() : null);
        return;
      }
      P.leaveActiveNow();
    }
    draw(p, p.keepScroll ? captureAnchor() : null);
  }

  // A folder window with nothing to show (no notes yet).
  function clear() {
    if (mode !== "read") modeBeforePdf = mode; // (the note that comes next is in this mode again)
    if (P.inSource(mode)) { P.flushSave(); P.leaveEditNow(); }
    if (mode === "active") P.leaveActiveNow();
    if (window.MdPdf) MdPdf.leave();
    content.classList.remove("pdf");
    current = null;
    drawn = null;
    if (P.docSync) P.docSync();
    outline = [];
    document.title = P.folder ? P.folder.name : "Markdown Notes";
    content.innerHTML = P.emptyState();
    window.scrollTo(0, 0);
    reveal();
    P.markActiveNote(false);
  }

  // quiet: fill the (hidden) reading view without touching scroll or find
  function draw(p, anchor, quiet = false) {
    const gen = ++generation;
    drawn = { p, text: p.text };
    if (P.docSync) P.docSync(); // (the note's own ground and width: there with its first frame)
    // (a PDF that makes way is let go as it stands — it keeps its place — before the column is the note's again)
    if (window.MdPdf && !(p.kind === "pdf" && !p.error)) MdPdf.leave();
    content.classList.toggle("pdf", p.kind === "pdf" && !p.error);
    if (p.kind === "pdf" && !p.error) {
      outline = [];
      reveal();
      P.loadPdf().then(() => { if (current === p) MdPdf.show(content, p); }, () => P.toast(T("The PDF viewer could not be loaded")));
      return;
    }
    if (p.error) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${ICON.alert}</div><p>${esc(p.error)}</p></div>`;
      outline = [];
      reveal();
      return;
    }
    const v = viewOf(p); // (a note with pages: the page it is at)
    P.pagesShown = v.root || null;
    const r = noteHtml(p, v.text);
    content.innerHTML = r.html || `<div class="empty-state"><p>This file is empty.</p></div>`;
    pageBar(v, content);
    outline = r.outline;
    reveal();
    if (quiet) { renderMermaid(gen, null); return; }
    if (P.outlineOpen()) P.buildOutline();
    if (anchor) restoreAnchor(anchor);
    else if (p.fragment) scrollToFragment(p.fragment, false);
    else if (p.toEnd) scrollToEnd();
    else { window.scrollTo(0, p.arriving ? placeOf(p) : 0); p.arriving = false; } // (a note come to: where it was left; the top the first time)
    p.toEnd = false;
    if (P.findOpen()) P.runFind(P.findInput.value, true);
    renderMermaid(gen, anchor);
  }

  /* A note's text as the reading view has it: its properties, then the Markdown — every block with the source line it
   * begins at (data-line). The reading view's, and the source's reading beside it (viewer/twin.js). */
  function noteHtml(p, text) {
    const fm = stripFrontmatter(text);
    md.set({ breaks: !!p.vault });
    const env = { lineOffset: fm.offset, links: p.links || {}, outline: [], depth: 0 };
    let html = md.render(stripComments(fm.body), env);
    if (fm.props) html = renderProps(fm.props, { links: env.links, depth: 1 }) + html;
    return { html: html.trim() ? html : "", outline: env.outline };
  }

  let painted = false;
  function reveal() {
    // (the window shows the web view from here on — once a frame with this content has gone out,
    // not before: until then the view holds nothing of the page's)
    if (!painted) { painted = true; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => post("painted"), 30))); }
    if (!content.classList.contains("ready")) requestAnimationFrame(() => content.classList.add("ready"));
    // (the active mode's scripts are fetched in a quiet moment after the first note is on screen:
    // the first change into that mode then only has to build the note)
    // (… and at once where the panel at the right is open beside the reading view, which is theirs)
    const panel = !P.activeLoad && mode === "read" && !!current && current.kind !== "pdf" && !(window.MdHost && window.MdHost.reading) && !!window.MdPrefs && !!MdPrefs.panel && ["style", "info", "document"].includes(MdPrefs.panelTab);
    if (!P.preloadTimer && !P.activeLoad) P.preloadTimer = setTimeout(() => { if (!P.activeLoad && current && current.kind !== "pdf") P.loadActive().catch(() => {}); }, panel ? 0 : 1500);
  }

  // the rendered document on screen: the reading view, or the active mode's
  const shownRoot = () => (document.body.dataset.view === "active" ? MdActive.view.dom : content);
  // deep: between the active mode and the source editor (reading <-> source stays as it always was)
  function captureAnchor(root = shownRoot(), deep = false) {
    const edited = root !== content && MdActive.view.anchor(); // after edits the active mode counts lines itself
    if (edited) return edited;
    // the innermost block that reaches over the window's top edge (an item, not the list it is in),
    // and how far into it the edge is: `into` of its `lines` source lines
    let hit = null;
    for (const el of root.querySelectorAll("[data-line]")) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0) continue;
      if (!deep) return { line: Number(el.dataset.line), top: r.top, y: window.scrollY };
      if (r.top > 0) {
        if (!hit) return { line: Number(el.dataset.line), top: r.top, y: window.scrollY };
        hit.lines = Math.max(1, Number(el.dataset.line) - hit.line);
        break;
      }
      hit = { line: Number(el.dataset.line), top: r.top, y: window.scrollY, into: r.height ? -r.top / r.height : 0, lines: 1 };
    }
    return hit || { line: null, y: window.scrollY };
  }
  function restoreAnchor(a, root = shownRoot()) {
    if (a.line == null) { window.scrollTo(0, a.y); return; }
    if (root !== content && MdActive.view.restore(a)) return;
    let best = null, next = null;
    for (const el of root.querySelectorAll("[data-line]")) {
      if (Number(el.dataset.line) <= a.line) best = el;
      else { next = el; break; }
    }
    if (!best) { window.scrollTo(0, a.y); return; }
    const r = best.getBoundingClientRect(), line = Number(best.dataset.line);
    // from the source editor: a line inside a block — as far into the block as that line is into its lines
    if (a.source && (a.line > line || a.top < 0)) {
      const lines = Math.max(1, (next ? Number(next.dataset.line) : line + 1) - line);
      const into = Math.min(1, (a.line - line + Math.max(0, -a.top) / (a.height || 1)) / lines);
      window.scrollBy({ top: r.top + into * r.height - Math.max(0, a.top), behavior: "instant" });
      return;
    }
    window.scrollBy({ top: r.top - a.top, behavior: "instant" });
  }

  function findTarget(frag) {
    if (!frag) return null;
    let f = frag;
    try { f = decodeURIComponent(frag); } catch (e) { /* keep raw */ }
    const root = shownRoot();
    if (f.startsWith("^")) {
      const id = f.slice(1);
      return [...root.querySelectorAll("[data-line]")].find((el) => el.textContent.trim().endsWith("^" + id)) || null;
    }
    const byId = elementById(f) || elementById(slugify(f));
    if (byId) return byId;
    const want = slugify(f.split("#").pop());
    return [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((h) => slugify(h.textContent) === want) || null;
  }
  // The reading view stays in the page while the active mode shows the same ids.
  function elementById(id) {
    const root = shownRoot();
    return root === content ? document.getElementById(id) : root.querySelector(`[id="${id.replace(/["\\]/g, "\\$&")}"]`);
  }
  function scrollToFragment(frag, smooth = true) {
    const ln = /^\^line=(\d+)$/.exec(frag || ""); // a source line (from a highlight in a PDF to the note's link)
    let el = null;
    if (ln) { for (const x of shownRoot().querySelectorAll("[data-line]")) { if (Number(x.dataset.line) <= Number(ln[1])) el = x; else break; } }
    else el = findTarget(frag);
    if (!el) { if (smooth) P.toast(T("Section not found")); return; }
    const note = el.matches("li.footnote-item") ? el : null; // (a footnote: in the middle of the window, and it stays marked)
    if (note) { note.scrollIntoView({ behavior: smooth && !reducedMotion() ? "smooth" : "instant", block: "center" }); markNote(note); return; }
    el.scrollIntoView({ behavior: smooth && !reducedMotion() ? "smooth" : "instant", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* The footnote a reference led to stays lightly laid under (Henri, 2026-10-14: which one was meant could not be told once
   * the page had moved) — until the next click or key, which it fades out on; only one at a time. Both modes (active/notes.js). */
  let noteHere = null, noteSince = 0;
  function markNote(el) {
    if (noteHere && noteHere !== el) noteHere.classList.remove("fn-here");
    noteHere = el; noteSince = performance.now();
    el.classList.add("fn-here");
  }
  const unmarkNote = (e) => {
    if (!noteHere || performance.now() - noteSince < 500) return; // (the click that led there, and its smooth run, are not the next one)
    if (e && e.target && e.target.closest && e.target.closest("li.footnote-item") === noteHere && e.type === "pointerdown") return;
    noteHere.classList.remove("fn-here"); noteHere = null;
  };
  addEventListener("pointerdown", unmarkNote, true);
  addEventListener("keydown", unmarkNote, true);
  // An image was just added at the end: go there, again once it has its height.
  function scrollToEnd() {
    const go = () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion() ? "instant" : "smooth" });
    go();
    const img = [...shownRoot().querySelectorAll("img")].pop();
    if (img && !img.complete) img.addEventListener("load", go, { once: true });
  }

  // --- mermaid (loaded on demand, ~2.7 MB)
  let mermaidLoad = null, mermaidKey = "", mermaidSeq = 0;
  const mermaidCache = new Map();
  function loadMermaid() {
    return mermaidLoad || (mermaidLoad = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.nonce = NONCE;
      s.src = ASSETS + "/vendor/mermaid.min.js";
      s.onload = resolve;
      s.onerror = () => { mermaidLoad = null; reject(new Error("mermaid.min.js missing")); };
      document.head.appendChild(s);
    }));
  }
  const hexToRgb = (h) => {
    const m = /^#?([0-9a-f]{6})/i.exec(h.trim());
    const n = m ? parseInt(m[1], 16) : 0;
    return [n >> 16, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => {
    const x = hexToRgb(a), y = hexToRgb(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
  };
  function configureMermaid() {
    const cs = getComputedStyle(document.documentElement);
    const c = (n) => cs.getPropertyValue("--c-" + n).trim();
    const bg = c("background"), fg = c("foreground"), acc = c("accent");
    const dark = document.body.dataset.mode === "dark";
    const key = [bg, fg, acc, dark].join();
    if (key === mermaidKey) return;
    mermaidKey = key;
    mermaidCache.clear();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      fontFamily: "Inter, sans-serif",
      themeVariables: {
        darkMode: dark, background: bg, fontFamily: "Inter, sans-serif", fontSize: "14px",
        primaryColor: mix(bg, acc, 0.13), primaryTextColor: fg, primaryBorderColor: mix(bg, acc, 0.55),
        secondaryColor: mix(bg, fg, 0.07), secondaryTextColor: fg, secondaryBorderColor: mix(bg, fg, 0.3),
        tertiaryColor: mix(bg, fg, 0.035), tertiaryTextColor: fg, tertiaryBorderColor: mix(bg, fg, 0.2),
        lineColor: mix(bg, fg, 0.5), textColor: fg, titleColor: fg,
        mainBkg: mix(bg, acc, 0.12), nodeBorder: mix(bg, acc, 0.55), nodeTextColor: fg,
        clusterBkg: mix(bg, fg, 0.035), clusterBorder: mix(bg, fg, 0.18),
        edgeLabelBackground: bg, noteBkgColor: mix(bg, c("yellow") || acc, 0.16), noteTextColor: fg,
        noteBorderColor: mix(bg, c("yellow") || acc, 0.45),
        actorBkg: mix(bg, acc, 0.12), actorBorder: mix(bg, acc, 0.55), actorTextColor: fg,
        signalColor: fg, signalTextColor: fg, labelBoxBkgColor: mix(bg, fg, 0.05),
      },
    });
  }
  async function renderMermaid(gen, anchor, root = content) {
    const blocks = [...root.querySelectorAll("pre.mermaid")];
    if (!blocks.length) return;
    try {
      await loadMermaid();
    } catch (e) {
      blocks.forEach((b) => b.parentElement.classList.add("failed"));
      return;
    }
    if (gen !== generation) return;
    configureMermaid();
    for (const pre of blocks) {
      const host = pre.parentElement, src = pre.textContent;
      let out = mermaidCache.get(src);
      const fresh = !out;
      if (!out) {
        const id = "mmd" + ++mermaidSeq;
        try {
          out = (await mermaid.render(id, src)).svg;
          mermaidCache.set(src, out);
        } catch (e) {
          document.getElementById("d" + id)?.remove();
          document.getElementById(id)?.remove();
          out = `<div class="mermaid-error"><strong>Mermaid error</strong><pre>${esc(e.message || e)}</pre></div>`;
        }
        if (gen !== generation) return;
      }
      host.innerHTML = out;
      host.classList.add(fresh ? "rendered" : "cached");
    }
    if (anchor) restoreAnchor(anchor, root);
  }

  // one diagram as SVG (dialogs preview with it); rejects with the parser's message
  async function mermaidSvg(src) {
    await loadMermaid();
    configureMermaid();
    let out = mermaidCache.get(src);
    if (!out) {
      const id = "mmd" + ++mermaidSeq;
      try {
        out = (await mermaid.render(id, src)).svg;
        mermaidCache.set(src, out);
      } catch (e) {
        document.getElementById("d" + id)?.remove();
        document.getElementById(id)?.remove();
        throw e;
      }
    }
    return out;
  }
  // text on the accent (a menu's chosen entry, a primary button): white or black, whichever reads better on it
  function setOnAccent() {
    const m = /^#?([0-9a-f]{6})/i.exec(getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim());
    if (!m) return;
    const [r, g, b] = [0, 2, 4].map((i) => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.style.setProperty("--on-accent", 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#fff" : "#000");
  }
  setOnAccent();
  function setTheme(css, mode) {
    document.getElementById("theme").textContent = css;
    document.body.dataset.mode = mode;
    setOnAccent();
    if (current && mode === "read" && content.querySelector(".mermaid-block")) draw(current, captureAnchor());
    if (P.twinRedraw) P.twinRedraw(); // (the source's reading beside it: its diagrams in the new colours)
  }

  // what the page's other files use of this one
  Object.assign(P, { markNote, placeOf, going, render, clear, draw, noteHtml, shownRoot, captureAnchor, restoreAnchor,
    elementById, scrollToFragment, reducedMotion, scrollToEnd, renderMermaid, mermaidSvg, setTheme });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    current: [() => current],
    outline: [() => outline, (v) => { outline = v; }],
    generation: [() => generation, (v) => { generation = v; }],
    mode: [() => mode, (v) => { mode = v; }],
    drawn: [() => drawn, (v) => { drawn = v; }],
    goingAt: [() => goingAt],
    goingTo: [() => goingTo],
  });
})();
