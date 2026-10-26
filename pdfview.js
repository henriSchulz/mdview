/* mdview — PDFs in the window, the way Obsidian PDF++ works with them
 * (https://github.com/RyotaUshio/obsidian-pdf-plus, MIT): a link to a text
 * selection is the annotation. Select text, copy a link to it (a colour of
 * the palette, Ctrl+Shift+C), paste it into a note — and every link to the
 * PDF in the notes around it shows in the PDF as a highlight.
 *
 * Links are Obsidian's:  file.pdf#page=3&selection=4,0,5,20&color=red
 *                        file.pdf#page=3&rect=72,400,300,520      (a region)
 *                        file.pdf#page=3&offset=0,640,1.5         (a place and zoom)
 * selection = first item, offset in it, last item, offset in it — the items
 * are the page's pieces of text, in the PDF's own order.
 *
 * Rendering is pdf.js (vendor/pdfjs, Apache-2.0), on the main thread; the
 * file's bytes come from the application (the page itself may not read files).
 * Loaded on first use. */
"use strict";
(() => {
  const { esc, toast, copy, post } = window.MdView.core;
  const T = window.MdStrings.t;
  const lib = window.pdfjsLib;
  let pressed = false; // (a button held: a selection being pulled, the page's scrollbar — the text stays: v.moving)
  for (const [type, down] of [["pointerdown", true], ["pointerup", false], ["pointercancel", false]]) addEventListener(type, (e) => { pressed = down && e.pointerType !== "touch"; }, { capture: true, passive: true }); // (a finger moves the pages: viewer/hand.js)
  const COLORS = { yellow: "#ffd000", red: "#ea5252", green: "#5ec269", blue: "#4a9cf0", purple: "#bb61e5" };
  const DEFAULT_COLOR = "yellow";
  const FORMATS = {
    callout: { label: "Quote in callout", text: "> [!PDF|{{colorName}}] {{linkWithDisplay}}\n> {{text}}\n" },
    quote: { label: "Quote", text: "> {{text}}\n\n{{linkWithDisplay}}\n" },
    link: { label: "Link", text: "{{linkWithDisplay}}" },
    embed: { label: "Embed", text: "!{{link}}" },
  };
  const prefs = () => ({ pdfFormat: "callout", pdfAuto: false, ...(window.MdPrefs || {}) });
  const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const basename = (path) => path.split("/").pop();
  const stem = (path) => basename(path).replace(/\.pdf$/i, "");

  /* "page=3&selection=4,0,5,20&color=red" -> { page, selection: [..], rect: [..], offset: [..], color } */
  function parseFrag(frag) {
    const out = { page: 1 };
    for (const part of String(frag || "").split("&")) {
      const [k, v = ""] = part.split("=");
      const nums = v.split(",").map(Number);
      if (k === "page" && nums[0] >= 1) out.page = Math.floor(nums[0]);
      else if (k === "selection" && nums.length === 4 && nums.every((n) => n >= 0)) out.selection = nums;
      else if (k === "rect" && nums.length === 4 && nums.every(Number.isFinite)) out.rect = nums;
      else if (k === "offset") out.offset = nums;
      else if (k === "color") out.color = v.toLowerCase();
    }
    return out;
  }
  const colorOf = (name) => COLORS[name] || COLORS[DEFAULT_COLOR];

  // ---------------------------------------------------------------- the file's bytes, from the application
  const waiting = new Map(); // id -> { chunks, resolve, reject }
  let nextId = 1;
  function bytesOf(path) {
    return new Promise((resolve, reject) => {
      const id = String(nextId++);
      waiting.set(id, { chunks: [], resolve, reject });
      post("pdfdata", { path, id });
    });
  }
  function chunk(id, i, n, b64, error) {
    const w = waiting.get(id);
    if (!w) return;
    if (error) { waiting.delete(id); w.reject(new Error(error)); return; }
    const bin = atob(b64), a = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
    w.chunks[i] = a;
    if (w.chunks.filter(Boolean).length < n) return;
    waiting.delete(id);
    const all = new Uint8Array(w.chunks.reduce((s, c) => s + c.length, 0));
    let at = 0;
    for (const c of w.chunks) { all.set(c, at); at += c.length; }
    w.resolve(all);
  }
  const docs = new Map(); // path -> { key, promise } (the last few)
  function docOf(path, key = "") {
    const have = docs.get(path);
    if (have && have.key === key) return have.promise;
    const promise = bytesOf(path).then((data) => lib.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise);
    docs.delete(path);
    docs.set(path, { key, promise });
    promise.catch(() => docs.delete(path));
    for (const k of [...docs.keys()].slice(0, -4)) docs.delete(k);
    return promise;
  }

  // ---------------------------------------------------------------- text geometry
  /* The boxes a selection covers, from the page's text items alone (no text layer needed):
   * [[x, y, w, h]] in viewport pixels. */
  function boxesOf(items, sel, viewport) {
    const [bi, bo, ei, eo] = sel, out = [];
    for (let i = bi; i <= ei && i < items.length; i++) {
      const it = items[i];
      if (!it || !it.str || !it.width) continue;
      const n = it.str.length || 1;
      const a = i === bi ? Math.min(bo, n) / n : 0, b = i === ei ? Math.min(eo, n) / n : 1;
      if (b <= a) continue;
      const tx = lib.Util.transform(viewport.transform, it.transform);
      const h = Math.hypot(tx[2], tx[3]) || it.height * viewport.scale, w = it.width * viewport.scale;
      out.push([tx[4] + a * w, tx[5] - h * 0.85, (b - a) * w, h * 1.1]);
    }
    return out;
  }
  // boxes on the same line joined into one
  function joined(boxes) {
    const rows = [];
    for (const b of boxes.slice().sort((p, q) => p[1] - q[1] || p[0] - q[0])) {
      const r = rows.find((x) => Math.abs(x[1] - b[1]) < b[3] * 0.5 && b[0] <= x[0] + x[2] + b[3] * 2);
      if (r) { const right = Math.max(r[0] + r[2], b[0] + b[2]); r[0] = Math.min(r[0], b[0]); r[2] = right - r[0]; r[3] = Math.max(r[3], b[3]); }
      else rows.push(b.slice());
    }
    return rows;
  }
  const textOf = (items, sel) => {
    const [bi, bo, ei, eo] = sel;
    let s = "";
    for (let i = bi; i <= ei && i < items.length; i++) {
      const it = items[i], str = it.str || "";
      s += str.slice(i === bi ? bo : 0, i === ei ? eo : str.length) + (it.hasEOL ? " " : "");
    }
    return s.replace(/\s+/g, " ").replace(/(\p{L})- (\p{Ll})/gu, "$1$2").trim();
  };

  // ================================================================ the viewer
  let V = null; // the PDF shown: { p, doc, root, pages, scale, … }

  /* Where each PDF was left — the page at the window's top, how far into it, its size — for when
   * it is come back to (another tab, back from a note): it stands there again. */
  const left = new Map();
  const topRoom = () => (window.MdView && MdView.core.top) || 0; // (what the tabs take of the window's top)
  function leave() {
    if (!V) return;
    if (V.io && V.root.isConnected) {
      const pg = V.pages.find((x) => x.div.getBoundingClientRect().bottom > 0), r = pg && pg.div.getBoundingClientRect();
      if (r && r.height) left.set(V.p.path, { n: pg.n, into: -r.top / r.height, fit: V.fit, scale: V.scale });
    }
    if (V.io) V.io.disconnect(); // (none yet: left while it was being opened)
    window.removeEventListener("scroll", V.onScroll);
    window.removeEventListener("resize", V.onResize);
    document.removeEventListener("keydown", V.onKey, true);
    document.removeEventListener("selectionchange", V.onSelect);
    window.removeEventListener("focus", V.onFocus);
    document.body.classList.remove("pdf-open");
    document.body.removeAttribute("data-pdf-drawing");
    if (V.bar && V.bar.parentElement && V.bar.parentElement.id === "toolbar") V.bar.remove(); // (the window's toolbar has its own buttons again)
    tip(null); // (the note under the pointer is gone with the PDF)
    V = null;
  }

  async function show(container, p) {
    if (V && V.p.path === p.path && V.root.isConnected && V.p.mtime === p.mtime) { // the same file again: its links may be new
      V.p = p;
      V.backlinks = (p.backlinks || []).map((b) => ({ ...b, at: parseFrag(b.frag) }));
      V.pages.forEach((pg) => { if (pg.state === "done") marks(pg); });
      notesTab();
      if (p.fragment) goFrag(p.fragment, true);
      return;
    }
    leave();
    document.body.classList.add("pdf-open");
    container.innerHTML = `<div class="pdfv"><div class="pdf-main"><aside class="pdf-side" aria-hidden="true"><div class="pdf-card"><div class="pdf-tabs" role="tablist">${[["outline", T("Outline")], ["pages", T("Pages")], ["notes", T("Notes")]].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="false">${esc(l)}</button>`).join("")}</div><div class="pdf-side-body"></div></div></aside><div class="pdf-pages"><div class="pdf-wait">Opening ${esc(p.name)}…</div></div></div></div>`;
    const root = container.firstChild;
    /* The PDF's buttons stand in the window's toolbar, where a note has its modes (viewer/chrome.js; pdfview.css hides what a PDF
     * has no use for): beside the tabs, at the same place in reading and drawing — nothing floats over the pages. */
    const tb = document.getElementById("toolbar"), bar = el("span", { class: "pdf-bar", role: "group", "aria-label": T("PDF") });
    (tb || root).appendChild(bar);
    if (window.MdPage && MdPage.showToolbar) MdPage.showToolbar(true); // (hidden by a note scrolled down: here it is the PDF's)
    const v = (V = { p, root, bar, side: root.querySelector(".pdf-side"), box: root.querySelector(".pdf-pages"), pages: [], scale: 1, fit: "width", history: [], color: DEFAULT_COLOR, rectTool: false,
      backlinks: (p.backlinks || []).map((b) => ({ ...b, at: parseFrag(b.frag) })) });
    // (a presentation is made into a PDF first — a few seconds, the first time: the waiting line says so)
    const slides = /\.(pptx?|ppsx?|odp)$/i.test(p.path);
    if (slides) v.box.querySelector(".pdf-wait").textContent = T("Preparing the slides of") + " " + p.name + "…";
    let doc;
    try { doc = await docOf(p.path, String(p.mtime || "")); }
    catch (e) { if (V === v) v.box.innerHTML = `<div class="empty-state"><p>${esc((slides ? "This presentation can't be shown: " : "This PDF can't be opened: ") + (e.message || e))}</p></div>`; return; }
    if (V !== v) return;
    v.doc = doc;
    const first = await doc.getPage(1);
    if (V !== v) return;
    v.base = first.getViewport({ scale: 1 });
    v.box.textContent = "";
    for (let n = 1; n <= doc.numPages; n++) {
      const div = el("div", { class: "pdf-page", "data-page": n, "aria-label": "Page " + n });
      v.box.appendChild(div);
      v.pages.push({ n, div, state: "none", w: v.base.width, h: v.base.height });
    }
    v.io = new IntersectionObserver((entries) => { for (const e of entries) { const pg = v.pages[e.target.dataset.page - 1]; pg.near = e.isIntersecting; if (pg.near) draw(pg); } tidy(); }, { rootMargin: "900px 0px" });
    const was = p.fragment ? null : left.get(p.path);
    if (was) { v.fit = was.fit; v.scale = was.scale; }
    toolbar();
    if (was) v.bar.querySelectorAll("[data-fit]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fit === v.fit)));
    layout();
    v.pages.forEach((pg) => v.io.observe(pg.div));
    /* Scrolled or zoomed: the text to select over the pages (thousands of words a page, transparent) is not drawn meanwhile.
     * Where WebKit draws without its GPU way (main.rs) the window is drawn anew at each step, those words with it, and they
     * halved the rate (Henri, 2026-10-15: "the PDF lags when scrolling and zooming"; dev/rig.sh pdfscroll). Back as soon as
     * the hand rests — and never while it holds a button or text in the PDF is chosen. */
    v.moving = () => {
      const sel = getSelection();
      if (pressed || (sel && !sel.isCollapsed && sel.anchorNode && v.root.contains(sel.anchorNode))) return;
      if (!v.root.hasAttribute("data-moving")) v.root.setAttribute("data-moving", "");
      clearTimeout(v.movingTimer);
      v.movingTimer = setTimeout(() => v.root.removeAttribute("data-moving"), 150);
    };
    v.onScroll = () => { v.moving(); tip(null); clearTimeout(v.scrollTimer); v.scrollTimer = setTimeout(pageNow, 60); if (v.sideOpen && !v.placing) v.placing = requestAnimationFrame(() => { v.placing = 0; if (V === v) sidePlaced(); }); };
    v.onResize = () => { if (v.sideOpen) sidePlaced(); if (v.fit) { clearTimeout(v.resizeTimer); v.resizeTimer = setTimeout(() => zoomTo(v.fit), 120); } };
    v.onKey = keys;
    v.onSelect = () => { clearTimeout(v.selTimer); v.selTimer = setTimeout(selected, 250); };
    // links pasted into a note meanwhile show as highlights — but not while the pages are drawn on: a reload leaves the board, and
    // the window only lost its focus (another window clicked, a tap outside). The PDF is asked for anew when the board is closed.
    v.onFocus = () => { if (window.MdBoard && MdBoard.shown) v.stale = true; else post("reload"); };
    window.addEventListener("scroll", v.onScroll, { passive: true });
    window.addEventListener("resize", v.onResize);
    document.addEventListener("keydown", v.onKey, true);
    v.root.addEventListener("wheel", onWheel, { passive: false });
    v.root.addEventListener("pointermove", (e) => { v.aim = { x: e.clientX, y: e.clientY }; }, { passive: true });
    document.addEventListener("selectionchange", v.onSelect);
    window.addEventListener("focus", v.onFocus);
    events();
    inked(v);
    if (p.fragment) goFrag(p.fragment, true);
    else if (was && v.pages[was.n - 1]) {
      const place = () => { const r = v.pages[was.n - 1].div.getBoundingClientRect(); window.scrollTo({ top: window.scrollY + r.top + was.into * r.height, behavior: "instant" }); pageNow(); };
      place();
      // (the pages were fitted to a window that had no scrollbar yet: once it has one, they are fitted again, and the place is the same)
      requestAnimationFrame(() => {
        if (V !== v) return;
        if (v.fit && Math.abs(fitScale(v.fit) - v.scale) > 1e-4) { layout(); v.pages.forEach((x) => { if (x.near) draw(x); }); }
        place();
      });
    } else window.scrollTo(0, 0);
    doc.getOutline().then((o) => { if (V === v) { v.outline = o || []; } }, () => {});
  }

  // ---------------------------------------------------------------- what was drawn on the pages
  /* A PDF is drawn on as a whiteboard is, with the whiteboard's own tools: it opens over the window
   * with the PDF's pages under it (board.js, board/pdf.js). What was drawn is no part of the PDF —
   * the host keeps it as a file of its own, in the folder's .mdview — and lies over the pages here
   * as a picture, whenever the PDF is shown. */
  const reading = () => !!(window.MdHost || {}).reading; // (a shared note: nothing is asked of a host)
  const board = () => window.MdPage.loadBoard().then(() => window.MdBoard);
  const sizesOf = (v) => v.sizes || (v.sizes = Promise.all(v.pages.map(async (pg) => { const b = (pg.page || (pg.page = await v.doc.getPage(pg.n))).getViewport({ scale: 1 }); return [b.width, b.height]; })));
  /* model: what is on the pages now (a board's, just closed); none given: as the host has it. */
  async function inked(v, model) {
    if (reading()) return;
    try {
      const B = await board();
      if (model === undefined) model = await B.pdfInk(v.p.path);
      const pages = model && model.items.length ? B.pdf.layout(await sizesOf(v)) : null;
      if (V !== v) return;
      v.ink = pages && { pages, by: B.pdf.onPages(pages, model.items) };
      v.pages.forEach((pg) => { if (pg.state === "done") inkOn(pg); });
    } catch (e) { console.warn("pdf ink", e); }
  }
  function inkOn(pg) {
    const old = pg.div.querySelector(".pdf-ink"), html = V.ink ? window.MdBoard.pdf.picture(V.ink.pages[pg.n - 1], V.ink.by.get(pg.n)) : "";
    if (old) old.remove();
    if (html) pg.div.querySelector(".pdf-marks").insertAdjacentHTML("afterend", html);
  }
  async function drawOn() {
    const v = V;
    if (v.opening || reading()) return;
    v.opening = true;
    try {
      const B = await board(), sizes = await sizesOf(v);
      if (V !== v || B.shown) return;
      const pg = v.pages[pageNow(true) - 1], r = pg.div.getBoundingClientRect();
      // (the pages as they are drawn here go under the board at once — none comes up bare and is filled in after)
      const seed = (n) => { const x = v.pages[n - 1], q = x.state === "done" ? x.div.getBoundingClientRect() : null; return q && q.bottom > -innerHeight && q.top < 2 * innerHeight ? x.div.querySelector(".pdf-canvas") : null; };
      v.root.setAttribute("data-drawing", ""); // (the card goes as the board comes, the toolbar keeps only the panel and the pen: pdfview.css)
      drawingNow(v, true);
      if (!(await B.openPdf({ path: v.p.path, name: v.p.name, doc: v.doc, sizes, seed, at: { n: pg.n, left: r.left, top: r.top - topRoom(), width: r.width }, done: (now) => drawn(v, now) }))) { v.root.removeAttribute("data-drawing"); drawingNow(v, false); }
    } catch (e) { v.root.removeAttribute("data-drawing"); drawingNow(v, false); toast(T("Couldn't open the PDF to draw on")); }
    v.opening = false;
  }
  /* The board over the PDF was closed: its ink lies on the pages, and the PDF stands where the board was left — as large, the same
   * place of the same page in the window's middle. Left quickly too (a tab, a note chosen, the window closed): never where the
   * PDF stood before the pen was taken. As large as the viewer goes (25 to 500 %; the board goes further): the middle stays. */
  /* The board lies under the tabs (board.css: --bd-pdf-top), so they stay to be chosen; the toolbar's pen says it is drawn on. */
  function drawingNow(v, on) {
    document.body.toggleAttribute("data-pdf-drawing", on);
    document.documentElement.style.setProperty("--bd-pdf-top", topRoom() + "px");
    const tb = document.getElementById("toolbar");
    const r = tb && on && !topRoom() ? tb.getBoundingClientRect() : null; // (the pen alone, over the board where no tabs are: the board's undo stands left of it)
    document.documentElement.style.setProperty("--bd-pdf-tb", r && r.width ? innerWidth - r.left + "px" : "0px");
    const pen = v.bar.querySelector('[data-do="draw"]');
    if (pen) { pen.setAttribute("aria-pressed", String(on)); const name = T(on ? "Done drawing (Esc)" : "Draw on the PDF (D)"); pen.dataset.tip = name; pen.setAttribute("aria-label", T(on ? "Done drawing" : "Draw on the PDF")); }
  }
  function drawn(v, now) {
    v.root.removeAttribute("data-drawing");
    drawingNow(v, false);
    if (V !== v || !v.root.isConnected) return;
    inked(v, now.model);
    const top = topRoom(), P = window.MdBoard.pdf, view = now.view, mx = innerWidth / 2, my = (innerHeight - top) / 2; // (the board's middle: it begins under the tabs)
    const p = P.near(now.pages, view, { w: innerWidth, h: innerHeight - top });
    const fx = (view.x + mx / view.z - p.x) / p.w, fy = (view.y + my / view.z - p.y) / p.h; // (where in that page the window's middle was)
    const scale = view.z * P.UNIT;
    if (Math.abs(scale - v.scale) / v.scale > 0.01) zoomTo(scale);
    const div = v.pages[p.n - 1].div, r = div.getBoundingClientRect();
    window.scrollBy({ top: r.top + fy * r.height - (top + my), behavior: "instant" });
    const r2 = div.getBoundingClientRect();
    v.box.scrollLeft += r2.left + fx * r2.width - mx; // (and across, as far as the pages go)
    pageNow();
    if (v.stale && !now.quick) { v.stale = false; post("reload"); } // (the window's focus came back meanwhile)
  }

  // ---------------------------------------------------------------- pages
  const fitScale = (how) => {
    const room = V.box.clientWidth - 8;
    if (how === "page") return Math.min(room / V.base.width, (innerHeight - 90) / V.base.height);
    return Math.min(3, room / V.base.width);
  };
  function layout() {
    if (V.fit) V.scale = fitScale(V.fit);
    V.box.toggleAttribute("data-wide", V.base.width * V.scale > V.box.clientWidth); // (only then is the box one that is moved sideways: pdfview.css)
    V.box.style.gap = 12 * V.scale + "px"; // (twelve points between two pages, at any size — as they lie under a whiteboard: board/pdf.js, GAP)
    for (const pg of V.pages) {
      pg.div.style.width = Math.round(pg.w * V.scale) + "px";
      pg.div.style.height = Math.round(pg.h * V.scale) + "px";
    }
    const z = V.bar.querySelector(".pdf-zoom");
    if (z) z.textContent = Math.round(V.scale * 100) + "%";
  }
  async function draw(pg) {
    const v = V;
    if (pg.state === "busy" || (pg.state === "done" && pg.scale === v.scale)) return;
    pg.state = "busy";
    const scale = v.scale;
    try {
      const page = pg.page || (pg.page = await v.doc.getPage(pg.n));
      if (V !== v) return;
      const vp = page.getViewport({ scale });
      const base = page.getViewport({ scale: 1 });
      if (Math.abs(base.width - pg.w) > 0.5 || Math.abs(base.height - pg.h) > 0.5) { pg.w = base.width; pg.h = base.height; pg.div.style.width = Math.round(pg.w * scale) + "px"; pg.div.style.height = Math.round(pg.h * scale) + "px"; }
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(16e6 / (vp.width * vp.height)));
      const canvas = el("canvas", { class: "pdf-canvas" });
      canvas.width = Math.floor(vp.width * ratio); canvas.height = Math.floor(vp.height * ratio);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null }).promise;
      // (its text to select is laid out when the hand rests: while the pages move it is not drawn anyway — v.moving)
      if (v.root.hasAttribute("data-moving")) { pg.div.replaceChildren(canvas); await new Promise((ok) => { const wait = () => (V !== v || !v.root.hasAttribute("data-moving") ? ok() : setTimeout(wait, 60)); wait(); }); }
      const text = pg.text || (pg.text = await page.getTextContent());
      if (V !== v || v.scale !== scale) { pg.state = "none"; if (V === v && pg.near) draw(pg); return; }
      const layer = el("div", { class: "textLayer" });
      layer.style.setProperty("--scale-factor", scale);
      pg.divs = [];
      await lib.renderTextLayer({ textContentSource: text, container: layer, viewport: vp, textDivs: pg.divs }).promise;
      pg.divs.forEach((d, i) => { d.dataset.i = i; });
      const hl = el("div", { class: "pdf-marks" }), links = el("div", { class: "pdf-links" });
      pg.div.replaceChildren(canvas, hl, layer, links);
      pg.vp = vp; pg.scale = scale; pg.state = "done";
      marks(pg);
      inkOn(pg);
      annotations(pg, page, vp, links);
      if (v.flash && v.flash.page === pg.n) flash(pg);
    } catch (e) { pg.state = "none"; console.warn("pdf page", pg.n, e); }
  }
  // far pages give their canvases back
  function tidy() {
    const now = pageNow(true);
    for (const pg of V.pages) {
      if (pg.state === "done" && !pg.near && Math.abs(pg.n - now) > 8) { pg.div.replaceChildren(); pg.state = "none"; pg.divs = null; }
    }
  }
  function pageNow(quiet) {
    if (!V) return 1;
    const mid = innerHeight * 0.4;
    let n = 1;
    for (const pg of V.pages) { if (pg.div.getBoundingClientRect().top <= mid) n = pg.n; else break; }
    if (quiet !== true && V.now !== n) {
      V.now = n;
      const inp = V.bar.querySelector(".pdf-page-in");
      if (inp && document.activeElement !== inp) inp.value = n;
      V.side.querySelectorAll(".pdf-thumb.on").forEach((t) => t.classList.remove("on"));
      const t = V.side.querySelector(`.pdf-thumb[data-page="${n}"]`);
      if (t) t.classList.add("on");
      if (V.tab === "notes") notesTab();
    }
    return n;
  }
  let drawLater = 0;
  /* at: { x, y } in the window — the place that stays where it is while the pages grow or shrink around it: the pointer's, where a
   * hand pulls the size (the wheel, a pinch); none: the middle of the window's top edge, as the keys and the bar's buttons mean it. */
  function zoomTo(what, live = false, at = null) {
    const v = V, box = v.box.getBoundingClientRect(), ax = at ? at.x : box.left + box.width / 2, ay = at ? at.y : topRoom();
    // (one pull of the hand holds one place: asked anew at every step it would drift wherever the pages cannot follow — a page
    // narrower than the window stands in its middle — and never come back under the pointer once they can)
    const now = performance.now(), held = at && v.hold && v.hold.x === ax && v.hold.y === ay && now - v.hold.t < 400 ? v.hold : null;
    const pg = held ? held.pg : v.pages.find((x) => x.div.getBoundingClientRect().bottom > ay) || v.pages[v.pages.length - 1], r = pg.div.getBoundingClientRect();
    const fx = held ? held.fx : (ax - r.left) / r.width, fy = held ? held.fy : (ay - r.top) / r.height; // where in the page the place is
    v.hold = at ? { x: ax, y: ay, pg, fx, fy, t: now } : null;
    if (typeof what === "number") { v.fit = null; v.scale = Math.max(0.25, Math.min(5, what)); } else v.fit = what;
    if (live) v.moving();
    layout();
    // (while the size is being pulled — a pinch, the wheel — the pages are only stretched; they are drawn anew when it rests)
    clearTimeout(drawLater);
    if (live) drawLater = setTimeout(() => { if (V === v) v.pages.forEach((x) => { if (x.near) draw(x); }); }, 140);
    else v.pages.forEach((x) => { if (x.near) draw(x); });
    const r2 = pg.div.getBoundingClientRect();
    window.scrollBy({ top: r2.top - (fy >= 0 ? ay - fy * r2.height : r.top), behavior: "instant" }); // (above the first page: its top stays)
    v.box.scrollLeft += r2.left - (ax - fx * r2.width); // (pages broader than the window are moved sideways in their own box: pdfview.css)
    v.bar.querySelectorAll("[data-fit]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fit === v.fit)));
  }
  // a place in the PDF: page, and optionally how far down it (in PDF points from the page's top)
  function go(n, top = null, remember = false) {
    const v = V;
    n = Math.max(1, Math.min(v.pages.length, n));
    if (remember) { v.history.push({ n: pageNow(true), y: window.scrollY }); v.bar.querySelector('[data-do="back"]').disabled = false; }
    const r = v.pages[n - 1].div.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - 64 - topRoom() + (top != null ? top * v.scale : 0), behavior: "instant" });
    pageNow();
  }
  function back() {
    const h = V.history.pop();
    if (!h) return false;
    window.scrollTo({ top: h.y, behavior: "instant" });
    V.bar.querySelector('[data-do="back"]').disabled = !V.history.length;
    pageNow();
    return true;
  }
  async function goFrag(frag, first) {
    const v = V, at = parseFrag(frag);
    const pg = v.pages[Math.min(v.pages.length, at.page) - 1];
    if (!pg) return;
    if (at.offset && at.offset[2] > 0 && Number.isFinite(at.offset[2])) { v.fit = null; v.scale = Math.max(0.25, Math.min(5, at.offset[2])); layout(); }
    go(pg.n, null, !first);
    v.flash = at.selection || at.rect ? { page: pg.n, at } : null;
    await draw(pg);
    if (V !== v) return;
    if (at.offset && Number.isFinite(at.offset[1])) { // (left, top) in PDF points, from the page's bottom left
      const y = pg.h - at.offset[1];
      window.scrollBy({ top: pg.div.getBoundingClientRect().top - 64 - topRoom() + y * v.scale, behavior: "instant" });
    }
    if (v.flash && pg.state === "done") flash(pg);
  }
  // the selection or region a link points to: shown, and brought into view
  function flash(pg) {
    const v = V, f = v.flash;
    v.flash = null;
    const boxes = f.at.selection ? joined(boxesOf(pg.text.items, f.at.selection, pg.vp)) : [rectBox(pg, f.at.rect)];
    if (!boxes.length) return;
    const layer = pg.div.querySelector(".pdf-marks");
    layer.querySelectorAll(".pdf-focus").forEach((x) => x.remove());
    for (const b of boxes) layer.appendChild(mark(b, pg, "pdf-focus" + (f.at.rect ? " rect" : "")));
    const top = Math.min(...boxes.map((b) => b[1]));
    window.scrollBy({ top: pg.div.getBoundingClientRect().top + top - innerHeight * 0.3, behavior: "instant" });
    pageNow();
  }
  const rectBox = (pg, r) => { const [x1, y1, x2, y2] = pg.vp.convertToViewportRectangle(r); return [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]; };
  function mark(b, pg, cls) {
    const m = el("div", { class: cls });
    m.style.left = (b[0] / pg.vp.width) * 100 + "%"; m.style.top = (b[1] / pg.vp.height) * 100 + "%";
    m.style.width = (b[2] / pg.vp.width) * 100 + "%"; m.style.height = (b[3] / pg.vp.height) * 100 + "%";
    return m;
  }
  // the links to this page in the notes, as highlights
  function marks(pg) {
    const layer = pg.div.querySelector(".pdf-marks");
    if (!layer) return;
    layer.querySelectorAll(".pdf-backlink").forEach((x) => x.remove());
    const drawn = new Set(); // (the same place linked twice — a quote and its embed — is one highlight)
    V.backlinks.forEach((b, i) => {
      if (b.at.page !== pg.n || !(b.at.selection || b.at.rect)) return;
      const key = String(b.at.selection || b.at.rect) + (b.at.color || "");
      if (drawn.has(key)) return;
      drawn.add(key);
      const boxes = b.at.selection ? joined(boxesOf(pg.text.items, b.at.selection, pg.vp)) : [rectBox(pg, b.at.rect)];
      for (const box of boxes) {
        const m = mark(box, pg, "pdf-backlink" + (b.at.rect ? " rect" : ""));
        m.style.setProperty("--hl", colorOf(b.at.color));
        m.dataset.bl = i;
        layer.appendChild(m);
      }
    });
  }
  // links inside the PDF
  async function annotations(pg, page, vp, layer) {
    let list = [];
    try { list = await page.getAnnotations({ intent: "display" }); } catch (_e) { return; }
    for (const a of list) {
      if (a.subtype !== "Link" || !(a.dest || a.url)) continue;
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
      const link = el("a", { class: "pdf-link", href: a.url || "#" });
      link.style.left = Math.min(x1, x2) + "px"; link.style.top = Math.min(y1, y2) + "px";
      link.style.width = Math.abs(x2 - x1) + "px"; link.style.height = Math.abs(y2 - y1) + "px";
      if (a.dest) link.pdfDest = a.dest; else link.dataset.url = a.url;
      layer.appendChild(link);
    }
  }
  async function placeOf(dest) { // -> { n, top (PDF points from the page's top) }
    const d = typeof dest === "string" ? await V.doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || d[0] == null) return null;
    const idx = typeof d[0] === "object" ? await V.doc.getPageIndex(d[0]) : d[0];
    const pg = V.pages[idx];
    if (!pg) return null;
    const kind = d[1] && d[1].name, y = kind === "XYZ" ? d[3] : kind === "FitH" || kind === "FitBH" ? d[2] : null;
    return { n: idx + 1, top: y == null ? null : Math.max(0, pg.h - y) };
  }

  // ---------------------------------------------------------------- copying links
  // the selection as a place in the PDF: { page, selection, text } or null
  const selectionNow = () => (V ? selectionIn(V.root, (n) => V.pages[n - 1]) : null);
  // (… within `root`, whose pages say their number — data-page — and have their text: pageOf(n) -> { n, text: { items } })
  function selectionIn(root, pageOf) {
    const s = document.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0);
    const spanOf = (node) => { const e = node.nodeType === 1 ? node : node.parentElement; return e && e.closest(".textLayer [data-i]"); };
    const layer = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest(".textLayer");
    if (!layer || !root.contains(layer)) return null;
    const pg = pageOf(Number(layer.parentElement.dataset.page));
    if (!pg || !pg.text) return null;
    const spans = [...layer.querySelectorAll("[data-i]")].filter((sp) => r.intersectsNode(sp));
    if (!spans.length) return null;
    const a = spanOf(r.startContainer) || spans[0], b = layer.contains(r.endContainer) ? spanOf(r.endContainer) || spans[spans.length - 1] : spans[spans.length - 1];
    const bo = a === spanOf(r.startContainer) && r.startContainer.nodeType === 3 ? r.startOffset : 0;
    const eo = b === spanOf(r.endContainer) && r.endContainer.nodeType === 3 ? r.endOffset : b.textContent.length;
    let bi = +a.dataset.i, ei = +b.dataset.i;
    if (ei < bi) return null;
    const selection = [bi, bo, ei, eo];
    return { page: pg.n, selection, text: textOf(pg.text.items, selection) };
  }
  function linkText(at, color, path = V.p.path) {
    const name = basename(path);
    let frag = "page=" + at.page;
    if (at.selection) frag += "&selection=" + at.selection.join(",");
    if (at.rect) frag += "&rect=" + at.rect.map((n) => Math.round(n)).join(",");
    if (at.offset) frag += "&offset=" + at.offset.join(",");
    if (color && color !== DEFAULT_COLOR && (at.selection || at.rect)) frag += "&color=" + color;
    const link = `[[${name}#${frag}]]`, display = `${stem(path)}, page ${at.page}`;
    return { link, linkWithDisplay: `[[${name}#${frag}|${display}]]`, display };
  }
  function copyLink(at, color = V.color, format = prefs().pdfFormat, path = V.p.path) {
    const t = linkText(at, color, path);
    const f = at.rect ? FORMATS.embed : !at.selection ? FORMATS.link : FORMATS[format] || FORMATS.callout;
    const text = f.text.replace(/\{\{(\w+)\}\}/g, (_m, k) => ({ link: t.link, linkWithDisplay: t.linkWithDisplay, text: at.text || "", colorName: color, page: String(at.page), file: stem(path) })[k] ?? "");
    copy(text);
    toast(at.rect ? T("Embed of the region copied") : at.selection ? T("Link to the selection copied") : T("Link to page {0} copied", at.page));
    // shown at once, as it will be once the link stands in a note
    if ((at.selection || at.rect) && V && V.p.path === path) {
      const pg = V.pages[at.page - 1], layer = pg.div.querySelector(".pdf-marks");
      if (layer) for (const b of at.selection ? joined(boxesOf(pg.text.items, at.selection, pg.vp)) : [rectBox(pg, at.rect)]) { const m = mark(b, pg, "pdf-backlink fresh" + (at.rect ? " rect" : "")); m.style.setProperty("--hl", colorOf(color)); layer.appendChild(m); }
    }
    return text;
  }
  function copySelection(color) {
    const at = selectionNow();
    if (at) { copyLink(at, color || V.color); document.getSelection().removeAllRanges(); return true; }
    copyLink({ page: pageNow(true) }, null, "link");
    return false;
  }
  // text selected while "copy on select" is on
  function selected() {
    if (!V || !prefs().pdfAuto || V.pointerDown) return;
    const at = selectionNow();
    if (at && at.text) { copyLink(at); document.getSelection().removeAllRanges(); }
  }
  function copyView() { // the place and zoom on screen
    const n = pageNow(true), pg = V.pages[n - 1], r = pg.div.getBoundingClientRect();
    const top = Math.round(pg.h - Math.max(0, 64 - r.top) / V.scale);
    copyLink({ page: n, offset: [0, top, Math.round(V.scale * 100) / 100] }, null, "link");
  }

  // ---------------------------------------------------------------- toolbar, side panel
  const I = {
    side: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 2.5v11" stroke="currentColor" stroke-width="1.3"/></svg>',
    back: '<svg viewBox="0 0 16 16"><path d="M9.5 3.5 5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    width: '<svg viewBox="0 0 16 16"><path d="M2 8h12M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    page: '<svg viewBox="0 0 16 16"><rect x="3.5" y="1.5" width="9" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
    rect: '<svg viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2.2 1.6"/></svg>',
    draw: '<svg viewBox="0 0 24 24"><path d="m5 19 1.2-4.6L16.5 4.1a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L9.6 17.8z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="m14.5 6.1 3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.9"/></svg>',
    minus: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg>', plus: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9M8 3.5v9"/></svg>',
  };
  /* The PDF's part of the window's toolbar: the side panel, where one is, how large, and the two things done to a page: a region of
   * it taken for a note, and drawing on it. While it is drawn on only the panel and the pen stay — the pen pressed, and pressed
   * again it ends the drawing (pdfview.css). (How a link to a selection is copied — as a callout, a quote, a link — and whether
   * at once is the settings'; Ctrl+Shift+C copies it.) */
  function toolbar() {
    const v = V, IC = (window.MdPage && window.MdPage.ICON) || {};
    const b = (attr, label, tip, icon, more = "") => `<button type="button" class="tb pdf-b" ${attr} data-tip="${esc(T(tip))}" aria-label="${esc(T(label))}"${more}>${icon}</button>`;
    v.bar.innerHTML =
      b('data-do="side"', "Outline, pages and notes", "Outline, pages and notes (O)", IC.list || I.side, ' aria-pressed="false"') +
      b('data-do="back"', "Back to where you were", "Back to where you were (Alt+←)", I.back, " disabled") +
      `<span class="pdf-sep"></span>` +
      `<input class="pdf-page-in" inputmode="numeric" value="1" aria-label="${esc(T("Page"))}" data-tip="${esc(T("Go to page (G)"))}"><span class="pdf-of">/ ${v.pages.length}</span>` +
      `<span class="pdf-sep"></span>` +
      b('data-do="out"', "Zoom out", "Zoom out (−)", I.minus) + `<span class="pdf-zoom">100%</span>` + b('data-do="in"', "Zoom in", "Zoom in (+)", I.plus) +
      b('data-fit="width"', "Fit width", "Fit width (W)", I.width, ' aria-pressed="true"') + b('data-fit="page"', "Fit page", "Fit page (H)", I.page, ' aria-pressed="false"') +
      `<span class="pdf-sep"></span>` +
      b('data-do="rect"', "Select a region to embed", "Select a region to embed (R)", I.rect, ' aria-pressed="false"') +
      (reading() ? "" : `<span class="pdf-sep"></span>` + b('data-do="draw"', "Draw on the PDF", "Draw on the PDF (D)", IC.pencil || I.draw, ' aria-pressed="false"'));
  }
  function act(what) {
    const v = V;
    if (what === "side") v.sideOpen ? sideShut() : sidePanel(v.tab || "outline");
    else if (what === "back") back();
    else if (what === "in") zoomTo(v.scale * 1.15);
    else if (what === "out") zoomTo(v.scale / 1.15);
    else if (what === "draw") { if (window.MdBoard && MdBoard.shown) MdBoard.close(); else drawOn(); }
    else if (what === "rect") { v.rectTool = !v.rectTool; v.root.classList.toggle("rect-tool", v.rectTool); v.bar.querySelector('[data-do="rect"]').setAttribute("aria-pressed", String(v.rectTool)); }
  }
  /* Outline, pages, notes: a card that comes out from under the bar's first button and lies over the window's left — nothing
   * makes room for it and no page moves or is drawn anew (as the panel at the right lies over a note: active/panel.css). */
  function sidePanel(tab) {
    const v = V, fresh = !v.sideOpen || v.tab !== tab;
    v.tab = tab;
    v.sideOpen = true;
    sidePlaced();
    v.side.setAttribute("data-open", "");
    v.side.setAttribute("aria-hidden", "false");
    v.bar.querySelector('[data-do="side"]').setAttribute("aria-pressed", "true");
    const tabs = v.side.querySelector(".pdf-tabs"), body = v.side.querySelector(".pdf-side-body");
    [...tabs.children].forEach((t, i) => { t.setAttribute("aria-selected", String(t.dataset.tab === tab)); if (t.dataset.tab === tab) tabs.style.setProperty("--i", i); }); // (the mark glides to the chosen one: pdfview.css)
    if (fresh) { body.style.transition = "none"; body.style.opacity = "0"; void body.offsetWidth; body.style.transition = body.style.opacity = ""; body.scrollTop = 0; } // (what the tab holds fades in)
    if (tab === "outline") {
      const list = (items, depth) => items.map((it, i) => `<div class="pdf-out" style="--depth:${depth}" draggable="true" data-path="${esc(depth + ":" + i)}">${esc(it.title || "")}</div>` + (it.items && it.items.length ? list(it.items, depth + 1) : "")).join("");
      v.flat = [];
      const walk = (items) => items.forEach((it) => { v.flat.push(it); if (it.items) walk(it.items); });
      walk(v.outline || []);
      body.innerHTML = v.flat.length ? list(v.outline, 0) : '<div class="menu-empty">${esc(T("This PDF has no outline"))}</div>';
      body.querySelectorAll(".pdf-out").forEach((d, i) => { d.dataset.i = i; });
    } else if (tab === "pages") {
      body.innerHTML = v.pages.map((pg) => `<div class="pdf-thumb${pg.n === pageNow(true) ? " on" : ""}" data-page="${pg.n}" draggable="true"><div class="pdf-thumb-img" style="aspect-ratio:${pg.w}/${pg.h}"></div><span>${pg.n}</span></div>`).join("");
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); thumb(e.target); } }, { root: body, rootMargin: "300px 0px" });
      body.querySelectorAll(".pdf-thumb").forEach((t) => io.observe(t));
      const on = body.querySelector(".pdf-thumb.on");
      if (on) body.scrollTop = on.offsetTop - body.offsetTop - (body.clientHeight - on.offsetHeight) / 2; // (the list alone: the window under the card stays where it is)
    } else notesTab();
  }
  /* The card ends a little above the window's lower edge, wherever it begins: under the bar — which stands lower before the
   * window is scrolled than once it sticks. */
  function sidePlaced() { V.side.style.setProperty("--at", Math.round(V.side.getBoundingClientRect().top) + "px"); }
  function sideShut() {
    const v = V;
    v.sideOpen = false;
    v.side.removeAttribute("data-open");
    v.side.setAttribute("aria-hidden", "true");
    v.bar.querySelector('[data-do="side"]').setAttribute("aria-pressed", "false");
  }
  async function thumb(t) {
    const v = V, page = await v.doc.getPage(+t.dataset.page);
    if (V !== v || !t.isConnected) return;
    const vp = page.getViewport({ scale: 150 / page.getViewport({ scale: 1 }).width });
    const c = el("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (t.isConnected) t.firstChild.replaceChildren(c);
  }
  // the notes that link here: those of the page on screen first
  function notesTab() {
    const v = V;
    if (!v || !v.sideOpen || v.tab !== "notes") return;
    const body = v.side.querySelector(".pdf-side-body"), now = pageNow(true);
    const rows = v.backlinks.map((b, i) => ({ b, i })).sort((x, y) => (x.b.at.page === now ? 0 : 1) - (y.b.at.page === now ? 0 : 1) || x.b.at.page - y.b.at.page);
    body.innerHTML = rows.length ? rows.map(({ b, i }) => `<div class="pdf-note${b.at.page === now ? " here" : ""}" data-bl="${i}"><span class="pdf-note-dot" style="--hl:${colorOf(b.at.color)}"></span><b>${esc(b.name.replace(/\.md$/i, ""))}</b><i>p. ${b.at.page}</i><span>${esc(b.text)}</span></div>`).join("")
      : '<div class="menu-empty">${esc(T("No note links to this PDF yet"))}</div>';
  }
  const outlineLink = async (it) => { const pl = it.dest ? await placeOf(it.dest) : null; return pl ? `[[${basename(V.p.path)}#page=${pl.n}|${(it.title || "").trim() || stem(V.p.path) + ", page " + pl.n}]]` : null; };
  const pageLink = (n) => `[[${basename(V.p.path)}#page=${n}|${stem(V.p.path)}, page ${n}]]`;

  /* Fingers on the pages where the web view does not move them as Safari does (WebKitGTK, the application on Linux:
   * viewer/hand.js — it scrolled them by wheels of its own, and made the whole window larger under two fingers): one finger
   * moves the pages and, let go while moving, throws them on; two size them, what lay under the middle between them staying
   * under it, and move them with it. A tap stays the browser's (a link, a highlight); the region tool is left alone. */
  function fingers(v) {
    if (!(window.MdHand && window.MdHand.GTK)) return;
    const SLACK = 8, at = new Map(); // fingers on the pages: id → { x, y }
    let one = null, two = null, pulled = false, glide = 0;
    const halt = () => { cancelAnimationFrame(glide); glide = 0; };
    const span = () => { const [a, b] = [...at.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) }; };
    const move = (dx, dy) => { window.scrollBy({ top: -dy, behavior: "instant" }); if (v.box.hasAttribute("data-wide")) v.box.scrollLeft -= dx; };
    v.box.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || v.rectTool || V !== v) return;
      halt();
      at.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (at.size === 1) { pulled = false; one = { id: e.pointerId, x0: e.clientX, y0: e.clientY, track: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] }; }
      else if (at.size === 2) {
        const m = span(), pg = v.pages.find((x) => x.div.getBoundingClientRect().bottom > m.y) || v.pages[v.pages.length - 1], r = pg.div.getBoundingClientRect();
        two = { d: m.d, scale: v.scale, pg, fx: (m.x - r.left) / r.width, fy: (m.y - r.top) / r.height };
        pulled = true; // (a finger that became two is no tap)
      }
    });
    v.box.addEventListener("pointermove", (e) => {
      const p = at.get(e.pointerId);
      if (!p || V !== v) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (two) {
        const m = span();
        if (two.d > 0 && m.d > 0) {
          // what lay under the middle stays under it, wherever the middle goes (zoomTo keeps the place it is handed)
          v.hold = { x: m.x, y: m.y, pg: two.pg, fx: two.fx, fy: two.fy, t: performance.now() };
          pull(two.scale * (m.d / two.d), { x: m.x, y: m.y });
        }
        return;
      }
      if (!one || one.id !== e.pointerId) return;
      if (!pulled && Math.hypot(e.clientX - one.x0, e.clientY - one.y0) < SLACK) return;
      if (!pulled) { pulled = true; try { v.box.setPointerCapture(e.pointerId); } catch (x) { /* (a pointer made up by a test) */ } }
      move(dx, dy);
      one.track.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      while (one.track.length > 2 && e.timeStamp - one.track[1].t > 120) one.track.shift();
    });
    const up = (e) => {
      if (!at.delete(e.pointerId)) return;
      if (at.size < 2) two = null;
      const was = one && one.id === e.pointerId && !at.size ? one : null;
      if (!at.size) one = null;
      if (!was || !pulled || e.type !== "pointerup") return;
      // let go while moving: the pages go on, slower and slower (as a page thrown on a phone)
      // (how fast it moved at the end: over its last eighth of a second — none, if it rested before it let go)
      const t = was.track, b = t[t.length - 1], a = t.find((x) => b.t - x.t <= 120) || b, dt = b.t - a.t;
      if (dt <= 0 || e.timeStamp - b.t > 100) return;
      let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt, then = performance.now();
      if (Math.hypot(vx, vy) < 0.3 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const step = (now) => {
        const ms = Math.min(32, now - then);
        then = now;
        move(vx * ms, vy * ms);
        const k = Math.exp(-ms / 325);
        vx *= k; vy *= k;
        glide = Math.hypot(vx, vy) > 0.02 && V === v ? requestAnimationFrame(step) : 0;
      };
      glide = requestAnimationFrame(step);
    };
    v.box.addEventListener("pointerup", up);
    v.box.addEventListener("pointercancel", up);
    // (the web view's own scroll under the finger, and a click where a pull ended, are not to come as well)
    v.box.addEventListener("touchmove", (e) => { if ((one || two) && e.cancelable) e.preventDefault(); }, { passive: false });
    v.box.addEventListener("touchend", (e) => { if (pulled && e.cancelable) e.preventDefault(); }, { passive: false });
  }

  function events() {
    const v = V;
    // a pen set on a page: it is there to draw (a finger and a mouse read and select, as before)
    v.box.addEventListener("pointerdown", (e) => { if (e.pointerType === "pen" && !v.rectTool && e.target.closest(".pdf-page")) { e.preventDefault(); drawOn(); } });
    fingers(v);
    v.bar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.do) act(b.dataset.do);
      else if (b.dataset.fit) zoomTo(b.dataset.fit);
    });
    v.bar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // the selection stays
    const inp = v.bar.querySelector(".pdf-page-in");
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { const n = parseInt(inp.value, 10); if (n >= 1) go(n, null, true); inp.blur(); } else if (e.key === "Escape") { inp.value = pageNow(true); inp.blur(); } });
    inp.addEventListener("focus", () => inp.select());
    v.side.addEventListener("click", async (e) => {
      const tab = e.target.closest("[data-tab]"), out = e.target.closest(".pdf-out"), th = e.target.closest(".pdf-thumb"), note = e.target.closest(".pdf-note");
      if (tab) sidePanel(tab.dataset.tab);
      else if (out) { const pl = await placeOf(v.flat[out.dataset.i].dest); if (pl) go(pl.n, pl.top, true); }
      else if (th) go(+th.dataset.page, null, true);
      else if (note) { const b = v.backlinks[note.dataset.bl]; e.detail > 1 ? post("pdfnote", { path: b.path, line: b.line }) : goFrag(b.frag); }
    });
    v.side.addEventListener("contextmenu", async (e) => {
      const out = e.target.closest(".pdf-out"), th = e.target.closest(".pdf-thumb"), note = e.target.closest(".pdf-note");
      if (!out && !th && !note) return;
      e.preventDefault();
      if (note) { const b = v.backlinks[note.dataset.bl]; post("pdfnote", { path: b.path, line: b.line }); return; }
      const text = out ? await outlineLink(v.flat[out.dataset.i]) : pageLink(+th.dataset.page);
      if (text) { copy(text); toast(out ? T("Link to the section copied") : T("Link to the page copied")); }
    });
    v.side.addEventListener("dragstart", (e) => {
      const out = e.target.closest(".pdf-out"), th = e.target.closest(".pdf-thumb");
      if (th) e.dataTransfer.setData("text/plain", pageLink(+th.dataset.page));
      else if (out && out.dataset.link) e.dataTransfer.setData("text/plain", out.dataset.link);
      else e.preventDefault();
    });
    // (a drag starts at once: the link of an outline item is worked out when the pointer comes over it)
    v.side.addEventListener("mouseover", async (e) => { const out = e.target.closest(".pdf-out"); if (out && !out.dataset.link) { const l = await outlineLink(v.flat[out.dataset.i]); if (l) out.dataset.link = l; } const note = e.target.closest(".pdf-note"); hover(note ? note.dataset.bl : null); });
    v.side.addEventListener("mouseleave", () => hover(null));
    // highlights: the note behind them; internal links; the region tool
    v.box.addEventListener("mousemove", (e) => {
      const m = v.rectTool ? null : markAt(e);
      hover(m ? m.dataset.bl : null);
      v.box.classList.toggle("on-mark", !!m);
      if (m) { const b = v.backlinks[m.dataset.bl]; tip(e, b.name.replace(/\.md$/i, "") + (b.text ? " — " + b.text : "") + "  (double click opens the note)"); } else tip(null);
    });
    v.box.addEventListener("mouseleave", () => { hover(null); tip(null); });
    v.box.addEventListener("dblclick", (e) => { const m = markAt(e); if (!m) return; e.preventDefault(); tip(null); document.getSelection().removeAllRanges(); const b = v.backlinks[m.dataset.bl]; post("pdfnote", { path: b.path, line: b.line }); });
    v.box.addEventListener("click", async (e) => {
      const a = e.target.closest(".pdf-link");
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      if (a.pdfDest) { const pl = await placeOf(a.pdfDest); if (pl) go(pl.n, pl.top, true); }
      else if (a.dataset.url) post("link", { href: a.dataset.url });
    }, true);
    v.box.addEventListener("contextmenu", async (e) => { // a link inside the PDF, as a link for a note
      const a = e.target.closest(".pdf-link");
      if (!a || !a.pdfDest) return;
      e.preventDefault();
      const pl = await placeOf(a.pdfDest);
      if (pl) { copy(pageLink(pl.n)); toast(T("Link to page {0} copied", pl.n)); }
    });
    v.box.addEventListener("mousedown", (e) => {
      v.pointerDown = true;
      const up = () => { v.pointerDown = false; document.removeEventListener("mouseup", up); if (prefs().pdfAuto) setTimeout(selected, 30); };
      document.addEventListener("mouseup", up);
      if (!v.rectTool || e.button !== 0) return;
      const page = e.target.closest(".pdf-page");
      if (!page) return;
      e.preventDefault();
      const pg = v.pages[page.dataset.page - 1], r = page.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
      const box = el("div", { class: "pdf-drag" });
      page.appendChild(box);
      const move = (ev) => {
        const x = Math.max(0, Math.min(r.width, ev.clientX - r.left)), y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
        box.style.left = Math.min(x0, x) + "px"; box.style.top = Math.min(y0, y) + "px"; box.style.width = Math.abs(x - x0) + "px"; box.style.height = Math.abs(y - y0) + "px";
        box.rect = [Math.min(x0, x), Math.min(y0, y), Math.max(x0, x), Math.max(y0, y)];
      };
      const done = () => {
        document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", done);
        box.remove();
        const q = box.rect;
        if (q && q[2] - q[0] > 6 && q[3] - q[1] > 6 && pg.vp) {
          const [ax, ay] = pg.vp.convertToPdfPoint(q[0], q[3]), [bx, by] = pg.vp.convertToPdfPoint(q[2], q[1]);
          copyLink({ page: pg.n, rect: [ax, ay, bx, by] });
        }
        act("rect");
      };
      document.addEventListener("mousemove", move); document.addEventListener("mouseup", done);
    });
  }
  // the highlight under the pointer (they lie under the text, which takes the pointer)
  function markAt(e) {
    const page = e.target.closest && e.target.closest(".pdf-page");
    if (!page) return null;
    for (const m of page.querySelectorAll(".pdf-backlink[data-bl]")) { const r = m.getBoundingClientRect(); if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return m; }
    return null;
  }
  function hover(i) {
    const v = V;
    if (v.hovered === i) return;
    v.hovered = i;
    v.root.querySelectorAll(".hovered").forEach((x) => x.classList.remove("hovered"));
    if (i != null) v.root.querySelectorAll(`[data-bl="${i}"]`).forEach((x) => x.classList.add("hovered"));
  }
  let tipEl = null;
  // (it belongs to the highlight under the pointer: gone when the pointer is anywhere else, or the window is left)
  document.addEventListener("mousemove", (e) => { if (tipEl && !tipEl.hidden && !(e.target.closest && e.target.closest(".pdf-pages"))) tip(null); }, true);
  window.addEventListener("blur", () => tip(null));
  document.addEventListener("mouseleave", () => tip(null));
  function tip(e, text) {
    if (!e) { if (tipEl) tipEl.hidden = true; return; }
    if (!tipEl) { tipEl = el("div", { class: "pdf-tip" }); document.body.appendChild(tipEl); }
    tipEl.textContent = text; tipEl.hidden = false;
    tipEl.style.left = Math.min(e.clientX + 12, innerWidth - tipEl.offsetWidth - 8) + "px";
    tipEl.style.top = Math.min(e.clientY + 16, innerHeight - tipEl.offsetHeight - 8) + "px";
  }
  function keys(e) {
    if (!V || !V.root.isConnected || (window.MdBoard && window.MdBoard.shown)) return; // (a board over the PDF has the keys)
    // (single keys are the PDF's only while the PDF has them: not while a name is typed, the keyboard
    // is in the sidebar or the tabs, or a menu or a window stands open — there Esc closes that)
    const typing = (e.target.closest && e.target.closest("input, textarea, select, [contenteditable], #sidebar, #tabs, .ui-menu")) || document.querySelector("#ctxmenu[data-open], .actmenu[data-open], #newdlg[data-open], #settings[data-open], #share[data-open]");
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") { stop(); copySelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "v") { stop(); copyView(); return; }
    if (e.altKey && e.key === "ArrowLeft" && V.history.length) { stop(); back(); return; }
    // Ctrl or Super with + and −: larger and smaller (0: the page's width again) — also from a field
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") { stop(); act("in"); return; }
      if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") { stop(); act("out"); return; }
      if (!e.shiftKey && (e.key === "0" || e.code === "Numpad0")) { stop(); zoomTo("width"); return; }
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "+" || k === "=") { stop(); act("in"); }
    else if (k === "-") { stop(); act("out"); }
    else if (k === "w") { stop(); zoomTo("width"); }
    else if (k === "h") { stop(); zoomTo("page"); }
    else if (k === "g") { stop(); V.bar.querySelector(".pdf-page-in").focus(); }
    else if (k === "o") { stop(); !V.sideOpen || V.tab !== "outline" ? sidePanel("outline") : act("side"); }
    else if (k === "t") { stop(); !V.sideOpen || V.tab !== "pages" ? sidePanel("pages") : act("side"); }
    else if (k === "n") { stop(); !V.sideOpen || V.tab !== "notes" ? sidePanel("notes") : act("side"); }
    else if (k === "r") { stop(); act("rect"); }
    else if (k === "d") { stop(); act("draw"); }
    else if (k === "Escape" && V.rectTool) { stop(); act("rect"); }
    else if (k === "Escape" && V.sideOpen) { stop(); act("side"); }
    else if (k === "PageDown" || k === "PageUp") { stop(); go(pageNow(true) + (k === "PageDown" ? 1 : -1)); }
  }

  // ================================================================ PDFs embedded in notes
  /* <span class="pdf-embed" data-pdf="/path/file.pdf" data-frag="page=3&selection=…">: the page,
   * or only what the link points to (the selection with a margin, the region). */
  const EMBED_MARGIN = 8;
  const drawnEmbeds = new Map(); // what was drawn once is put in again at once (the active mode rebuilds its elements)
  async function embed(span) {
    span.dataset.done = "1";
    const at = parseFrag(span.dataset.frag);
    const key = span.dataset.pdf + "#" + span.dataset.frag + "@" + (span.hasAttribute("data-full") ? "full" : span.dataset.width || "") + "/" + Math.round((span.parentElement && span.parentElement.clientWidth) || 0);
    let have = drawnEmbeds.get(key);
    // (in a dialog the picture drawn for the note serves: the same page and region, at whatever width it was drawn for)
    if (!have && span.closest("#dlg")) { const stem = key.slice(0, key.lastIndexOf("/") + 1); for (const [k, img] of drawnEmbeds) if (k.startsWith(stem)) have = img; }
    if (have) { // (the room kept for it while it waited is given up: the picture has its own size)
      const img = have.cloneNode(); span.replaceChildren(img); span.classList.add("ready");
      span.style.removeProperty("width"); span.style.removeProperty("height");
      return;
    }
    try {
      const doc = await docOf(span.dataset.pdf);
      const page = await doc.getPage(Math.min(doc.numPages, at.page));
      const base = page.getViewport({ scale: 1 });
      let crop = null; // in PDF-scale-1 viewport pixels: [x, y, w, h]
      let boxes = [];
      if (at.rect) { const [x1, y1, x2, y2] = base.convertToViewportRectangle(at.rect); crop = [Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)]; }
      else if (at.selection) {
        boxes = joined(boxesOf((await page.getTextContent()).items, at.selection, base));
        if (boxes.length) {
          const top = Math.min(...boxes.map((b) => b[1])) - EMBED_MARGIN, bottom = Math.max(...boxes.map((b) => b[1] + b[3])) + EMBED_MARGIN;
          crop = [0, Math.max(0, top), base.width, Math.min(base.height, bottom) - Math.max(0, top)];
        }
      }
      if (!span.isConnected) return;
      const room = Math.max(200, Math.min(span.parentElement.clientWidth || 700, 1100));
      const want = span.hasAttribute("data-full") ? room : Number(span.dataset.width) || 0;
      // (a region is shown as large as it is on its page, when the page fills the column)
      // (as wide as was asked for, whatever is shown: a small region — a formula, a narrow figure —
      // grows as far as a page does. What is drawn of it has its limit, not what is shown.)
      const scale = (want || room) / (crop && (want || !at.rect) ? crop[2] : base.width);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      // Only what is shown is drawn: the canvas is as large as the region, the page shifted under it
      // (a whole page drawn at this scale and then cut cost several times the work, on the page's own thread).
      const cut = crop || [0, 0, base.width, base.height];
      const k = Math.min(scale * ratio, 8, Math.sqrt(16e6 / Math.max(1, cut[2] * cut[3])));
      const ox = Math.floor(cut[0] * k), oy = Math.floor(cut[1] * k);
      const vp = page.getViewport({ scale: k, offsetX: -ox, offsetY: -oy });
      const shown = document.createElement("canvas");
      shown.width = Math.max(1, Math.floor(cut[2] * k)); shown.height = Math.max(1, Math.floor(cut[3] * k));
      const ctx = shown.getContext("2d");
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (boxes.length) { // the selection, highlighted as in the viewer
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = colorOf(at.color);
        ctx.globalAlpha = 0.45;
        for (const b of boxes) ctx.fillRect(b[0] * k - ox, b[1] * k - oy, b[2] * k, b[3] * k);
      }
      // as a picture, not a canvas: a canvas put into the page straight after drawing showed
      // magenta here (WebKitGTK on this GPU) until something made it paint again
      const blob = await new Promise((res) => shown.toBlob(res, "image/png"));
      const img = new Image();
      img.className = "pdf-embed-img";
      img.width = Math.max(1, Math.round(cut[2] * scale)); img.height = Math.max(1, Math.round(cut[3] * scale));
      img.alt = basename(span.dataset.pdf) + ", page " + at.page;
      img.src = URL.createObjectURL(blob);
      await img.decode().catch(() => {});
      drawnEmbeds.set(key, img);
      if (drawnEmbeds.size > 60) drawnEmbeds.delete(drawnEmbeds.keys().next().value);
      rememberSize(span, img.width, img.height);
      if (span.isConnected) { span.replaceChildren(img.cloneNode()); span.classList.add("ready"); span.style.removeProperty("width"); span.style.removeProperty("height"); }
    } catch (e) {
      span.classList.add("failed");
      span.textContent = basename(span.dataset.pdf) + ": " + (e.message || e);
    }
  }
  /* A whole page as a picture, with the way between a frame on it and a region of the PDF — for
   * adjusting the region an embed shows (the dialog of the active mode). Shares of the page's
   * width and height on the one side, the PDF's own points (as `rect=` writes them) on the other. */
  async function pageShot(path, pageNo, width) {
    const doc = await docOf(path);
    const n = Math.max(1, Math.min(doc.numPages, Math.floor(pageNo) || 1));
    const page = await doc.getPage(n), base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(200, width) / base.width), ratio = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const img = new Image();
    img.width = Math.round(canvas.width / ratio); img.height = Math.round(canvas.height / ratio);
    img.alt = basename(path) + ", page " + n;
    img.draggable = false;
    img.src = URL.createObjectURL(blob);
    await img.decode().catch(() => {});
    return {
      img, page: n, pages: doc.numPages,
      // a region of the PDF -> [left, top, width, height] as shares of the page
      box(rect) {
        const [x1, y1, x2, y2] = base.convertToViewportRectangle(rect);
        return [Math.min(x1, x2) / base.width, Math.min(y1, y2) / base.height, Math.abs(x2 - x1) / base.width, Math.abs(y2 - y1) / base.height];
      },
      // … and back, in whole points, as the viewer's region tool writes it
      rect(l, t, w, h) {
        const [ax, ay] = base.convertToPdfPoint(l * base.width, (t + h) * base.height), [bx, by] = base.convertToPdfPoint((l + w) * base.width, t * base.height);
        return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)].map((v) => Math.round(v));
      },
    };
  }
  /* Embeds are drawn when they come near the window, one after the other with a breath between
   * them — a note with many would otherwise hold the page for seconds when it opens. Until then an
   * embed keeps the room it took last time (remembered by what it shows), so the note does not jump
   * when it is drawn. In a dialog, and for printing, they are drawn at once. */
  const sizeKey = (span) => "mdview-embed:" + span.dataset.pdf + "#" + span.dataset.frag + "@" + (span.hasAttribute("data-full") ? "full" : span.dataset.width || "");
  function rememberSize(span, w, h) { try { localStorage.setItem(sizeKey(span), w + "x" + h); } catch (e) { /* no storage: it jumps once */ } }
  function reserve(span) {
    let m = null;
    try { m = /^(\d+)x(\d+)$/.exec(localStorage.getItem(sizeKey(span)) || ""); } catch (e) { m = null; }
    if (!m || span.classList.contains("ready")) return;
    // (as it will stand: no wider than its column, as wide as the column when it is to fill it —
    // and nothing kept when the column cannot be measured yet: a height of nothing made a strip of it)
    const room = span.parentElement ? span.parentElement.clientWidth : 0, w = Number(m[1]), h = Number(m[2]);
    if (!room || !w || !h) return;
    const shown = span.hasAttribute("data-full") ? room : Math.min(w, room);
    if (!span.hasAttribute("data-full")) span.style.width = shown + "px";
    span.style.height = Math.round(shown * h / w) + "px";
  }
  const queue = [];
  let drawing = false;
  async function drain() {
    if (drawing) return;
    drawing = true;
    while (queue.length) {
      const span = queue.shift();
      if (span.isConnected && !span.dataset.done) { await embed(span); await new Promise((r) => setTimeout(r, 30)); }
    }
    drawing = false;
  }
  const near = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { near.unobserve(en.target); if (!en.target.dataset.done) queue.push(en.target); }
    drain();
  }, { rootMargin: "800px 0px" }) : null;
  function hydrate(root = document, now = false) {
    for (const span of root.querySelectorAll(".pdf-embed:not([data-done])")) {
      const have = drawnEmbeds.get(span.dataset.pdf + "#" + span.dataset.frag + "@" + (span.hasAttribute("data-full") ? "full" : span.dataset.width || "") + "/" + Math.round((span.parentElement && span.parentElement.clientWidth) || 0));
      if (now || !near || have || span.closest("#dlg, #atompop, #notepop")) { embed(span); continue; } // (drawn before, or wanted at once)
      reserve(span);
      near.observe(span);
    }
  }
  addEventListener("beforeprint", () => hydrate(document, true));

  /* The size pulled: two fingers on a touchpad (the application tells: "begin", then the size the
   * fingers have made of it so far), or Ctrl with the wheel. It follows at once, a frame at a time. */
  let pinchBase = 1, zoomWant = 0, zoomFrame = 0;
  const shown = () => V && V.root.isConnected && V.pages && V.pages.length;
  let zoomAt = null;
  function pull(scale, at) {
    zoomWant = scale; zoomAt = at || null;
    if (zoomFrame) return;
    zoomFrame = requestAnimationFrame(() => { zoomFrame = 0; if (shown()) zoomTo(zoomWant, true, zoomAt); });
  }
  function pinch(phase, scale) {
    if (!shown() || (window.MdBoard && window.MdBoard.shown)) return;
    if (phase === "begin") { pinchBase = V.scale; return; }
    if (scale > 0 && Number.isFinite(scale)) pull(pinchBase * scale, V.aim); // (the host says how much, not where: around the pointer, where it was last seen over the PDF)
  }
  // (On the viewer itself, never on the window: a wheel listener that may hold the wheel back makes
  // every scroll of every note wait for the page's scripts.)
  function onWheel(e) {
    if (!e.ctrlKey || !shown()) return;
    e.preventDefault(); e.stopPropagation();
    pull((zoomFrame ? zoomWant : V.scale) * Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * 0.0015), { x: e.clientX, y: e.clientY });
  }

  /* A PDF's page shown elsewhere — beside a note (viewer/split.js), as a picture `width` wide: what lies over it here too — its
   * text to select and copy, its links — and what was drawn on its pages. */
  async function overlays(path, n, width) {
    const doc = await docOf(path), page = await doc.getPage(n), base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / base.width });
    const text = await page.getTextContent();
    const layer = el("div", { class: "textLayer" });
    layer.style.setProperty("--scale-factor", vp.scale);
    const divs = [];
    await lib.renderTextLayer({ textContentSource: text, container: layer, viewport: vp, textDivs: divs }).promise;
    divs.forEach((d, i) => { d.dataset.i = i; });
    const links = el("div", { class: "pdf-links" });
    await annotations(null, page, vp, links);
    return { layer, links, page: { n, text, vp, h: base.height } };
  }
  async function inkOf(path) { // -> { pages, by } or null
    if (reading()) return null;
    const B = await board(), model = await B.pdfInk(path);
    if (!model || !model.items.length) return null;
    const doc = await docOf(path), sizes = await Promise.all(Array.from({ length: doc.numPages }, async (_x, i) => { const b = (await doc.getPage(i + 1)).getViewport({ scale: 1 }); return [b.width, b.height]; }));
    const pages = B.pdf.layout(sizes);
    return { pages, by: B.pdf.onPages(pages, model.items) };
  }
  const inkPicture = (ink, n) => (ink ? window.MdBoard.pdf.picture(ink.pages[n - 1], ink.by.get(n)) : "");
  async function placeIn(path, dest) { // a link's place in that PDF -> { n, top }
    const doc = await docOf(path), d = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(d) || d[0] == null) return null;
    const idx = typeof d[0] === "object" ? await doc.getPageIndex(d[0]) : d[0];
    const h = (await doc.getPage(idx + 1)).getViewport({ scale: 1 }).height;
    const kind = d[1] && d[1].name, y = kind === "XYZ" ? d[3] : kind === "FitH" || kind === "FitBH" ? d[2] : null;
    return { n: idx + 1, top: y == null ? null : Math.max(0, h - y) };
  }
  const sheet = { overlays, inkOf, inkPicture, placeIn, selectionIn, copyLink: (path, at) => copyLink(at, (V && V.color) || DEFAULT_COLOR, prefs().pdfFormat, path), auto: () => !!prefs().pdfAuto };

  window.MdPdf = { show, leave, sheet, hydrate, chunk, parseFrag, pinch, pageShot, get shown() { return V; },
    // for the tests
    test: { drawOn, selectionNow, copySelection, copyView, go, goFrag, zoomTo, act, sidePanel, boxesOf, joined, textOf, linkText, pageNow, placeOf } };
})();
