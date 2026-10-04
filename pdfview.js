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
  const lib = window.pdfjsLib;
  const COLORS = { yellow: "#ffd000", red: "#ea5252", green: "#5ec269", blue: "#4a9cf0", purple: "#bb61e5" };
  const DEFAULT_COLOR = "yellow";
  const FORMATS = {
    callout: { label: "Quote in callout", text: "> [!PDF|{{colorName}}] {{linkWithDisplay}}\n> {{text}}\n" },
    quote: { label: "Quote", text: "> {{text}}\n\n{{linkWithDisplay}}\n" },
    link: { label: "Link", text: "{{linkWithDisplay}}" },
    embed: { label: "Embed", text: "!{{link}}" },
  };
  const prefs = () => ({ pdfFormat: "callout", pdfAuto: false, ...(window.MdPrefs || {}) });
  const setPref = (o) => { window.MdPrefs = { ...(window.MdPrefs || {}), ...o }; post("prefs", { prefs: o }); };
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

  function leave() {
    if (!V) return;
    V.io.disconnect();
    window.removeEventListener("scroll", V.onScroll);
    window.removeEventListener("resize", V.onResize);
    document.removeEventListener("keydown", V.onKey, true);
    document.removeEventListener("selectionchange", V.onSelect);
    window.removeEventListener("focus", V.onFocus);
    document.body.classList.remove("pdf-open");
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
    container.innerHTML = `<div class="pdfv"><div class="pdf-bar surface" role="toolbar" aria-label="PDF"></div><div class="pdf-main"><aside class="pdf-side" hidden></aside><div class="pdf-pages"><div class="pdf-wait">Opening ${esc(p.name)}…</div></div></div></div>`;
    const root = container.firstChild;
    const v = (V = { p, root, bar: root.querySelector(".pdf-bar"), side: root.querySelector(".pdf-side"), box: root.querySelector(".pdf-pages"), pages: [], scale: 1, fit: "width", history: [], color: DEFAULT_COLOR, rectTool: false,
      backlinks: (p.backlinks || []).map((b) => ({ ...b, at: parseFrag(b.frag) })) });
    let doc;
    try { doc = await docOf(p.path, String(p.mtime || "")); }
    catch (e) { if (V === v) v.box.innerHTML = `<div class="empty-state"><p>${esc("This PDF can't be opened: " + (e.message || e))}</p></div>`; return; }
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
    toolbar();
    layout();
    v.pages.forEach((pg) => v.io.observe(pg.div));
    v.onScroll = () => { tip(null); clearTimeout(v.scrollTimer); v.scrollTimer = setTimeout(pageNow, 60); };
    v.onResize = () => { if (v.fit) { clearTimeout(v.resizeTimer); v.resizeTimer = setTimeout(() => zoomTo(v.fit), 120); } };
    v.onKey = keys;
    v.onSelect = () => { clearTimeout(v.selTimer); v.selTimer = setTimeout(selected, 250); };
    v.onFocus = () => post("reload"); // links pasted into a note meanwhile show as highlights
    window.addEventListener("scroll", v.onScroll, { passive: true });
    window.addEventListener("resize", v.onResize);
    document.addEventListener("keydown", v.onKey, true);
    v.root.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("selectionchange", v.onSelect);
    window.addEventListener("focus", v.onFocus);
    events();
    if (p.fragment) goFrag(p.fragment, true); else window.scrollTo(0, 0);
    doc.getOutline().then((o) => { if (V === v) { v.outline = o || []; } }, () => {});
  }

  // ---------------------------------------------------------------- pages
  const fitScale = (how) => {
    const room = V.box.clientWidth - 8;
    if (how === "page") return Math.min(room / V.base.width, (innerHeight - 90) / V.base.height);
    return Math.min(3, room / V.base.width);
  };
  function layout() {
    if (V.fit) V.scale = fitScale(V.fit);
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
  function zoomTo(what, live = false) {
    const v = V, n = pageNow(true), pg = v.pages[n - 1], r = pg.div.getBoundingClientRect(), into = r.height ? Math.max(0, -r.top) / r.height : 0;
    if (typeof what === "number") { v.fit = null; v.scale = Math.max(0.25, Math.min(5, what)); } else v.fit = what;
    layout();
    // (while the size is being pulled — a pinch, the wheel — the pages are only stretched; they are drawn anew when it rests)
    clearTimeout(drawLater);
    if (live) drawLater = setTimeout(() => { if (V === v) v.pages.forEach((x) => { if (x.near) draw(x); }); }, 140);
    else v.pages.forEach((x) => { if (x.near) draw(x); });
    const r2 = pg.div.getBoundingClientRect();
    window.scrollBy({ top: r2.top + into * r2.height - Math.min(0, r.top) * 0 - (r.top > 0 ? r.top : 0), behavior: "instant" });
    v.bar.querySelectorAll("[data-fit]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.fit === v.fit)));
  }
  // a place in the PDF: page, and optionally how far down it (in PDF points from the page's top)
  function go(n, top = null, remember = false) {
    const v = V;
    n = Math.max(1, Math.min(v.pages.length, n));
    if (remember) { v.history.push({ n: pageNow(true), y: window.scrollY }); v.bar.querySelector('[data-do="back"]').disabled = false; }
    const r = v.pages[n - 1].div.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - 64 + (top != null ? top * v.scale : 0), behavior: "instant" });
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
      window.scrollBy({ top: pg.div.getBoundingClientRect().top - 64 + y * v.scale, behavior: "instant" });
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
  function selectionNow() {
    const s = document.getSelection();
    if (!s || !s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0);
    const spanOf = (node) => { const e = node.nodeType === 1 ? node : node.parentElement; return e && e.closest(".textLayer [data-i]"); };
    const layer = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest(".textLayer");
    if (!layer || !V || !V.root.contains(layer)) return null;
    const pg = V.pages[layer.parentElement.dataset.page - 1];
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
  function linkText(at, color) {
    const name = basename(V.p.path);
    let frag = "page=" + at.page;
    if (at.selection) frag += "&selection=" + at.selection.join(",");
    if (at.rect) frag += "&rect=" + at.rect.map((n) => Math.round(n)).join(",");
    if (at.offset) frag += "&offset=" + at.offset.join(",");
    if (color && color !== DEFAULT_COLOR && (at.selection || at.rect)) frag += "&color=" + color;
    const link = `[[${name}#${frag}]]`, display = `${stem(V.p.path)}, page ${at.page}`;
    return { link, linkWithDisplay: `[[${name}#${frag}|${display}]]`, display };
  }
  function copyLink(at, color = V.color, format = prefs().pdfFormat) {
    const t = linkText(at, color);
    const f = at.rect ? FORMATS.embed : !at.selection ? FORMATS.link : FORMATS[format] || FORMATS.callout;
    const text = f.text.replace(/\{\{(\w+)\}\}/g, (_m, k) => ({ link: t.link, linkWithDisplay: t.linkWithDisplay, text: at.text || "", colorName: color, page: String(at.page), file: stem(V.p.path) })[k] ?? "");
    copy(text);
    toast(at.rect ? "Embed of the region copied" : at.selection ? "Link to the selection copied" : "Link to page " + at.page + " copied");
    // shown at once, as it will be once the link stands in a note
    if (at.selection || at.rect) {
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
    auto: '<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h6M3 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="m10.5 11 1.6 1.6 2.6-3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  function toolbar() {
    const v = V, p = prefs();
    v.bar.innerHTML =
      `<button class="pdf-b" data-do="side" data-tip="Outline, pages and notes (O)">${I.side}</button>` +
      `<button class="pdf-b" data-do="back" data-tip="Back to where you were (Alt+←)" disabled>${I.back}</button>` +
      `<span class="pdf-sep"></span>` +
      `<input class="pdf-page-in" inputmode="numeric" value="1" aria-label="Page" data-tip="Go to page (G)"><span class="pdf-of">/ ${v.pages.length}</span>` +
      `<span class="pdf-sep"></span>` +
      `<button class="pdf-b" data-do="out" data-tip="Zoom out (−)">−</button><span class="pdf-zoom">100%</span><button class="pdf-b" data-do="in" data-tip="Zoom in (+)">+</button>` +
      `<button class="pdf-b" data-fit="width" data-tip="Fit width (W)" aria-pressed="true">${I.width}</button><button class="pdf-b" data-fit="page" data-tip="Fit page (H)" aria-pressed="false">${I.page}</button>` +
      `<span class="pdf-sep"></span>` +
      Object.entries(COLORS).map(([name, c]) => `<button class="pdf-color" data-color="${name}" style="--hl:${c}" data-tip="Copy a link to the selection: ${name}" aria-pressed="${name === v.color}"></button>`).join("") +
      `<select class="pdf-format lp-field" aria-label="What is copied" data-tip="What is copied">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}"${k === p.pdfFormat ? " selected" : ""}>${esc(f.label)}</option>`).join("")}</select>` +
      `<button class="pdf-b" data-do="auto" data-tip="Copy as soon as text is selected" aria-pressed="${!!p.pdfAuto}">${I.auto}</button>` +
      `<button class="pdf-b" data-do="rect" data-tip="Select a region to embed (R)" aria-pressed="false">${I.rect}</button>`;
  }
  function act(what) {
    const v = V;
    if (what === "side") { v.side.hidden ? sidePanel(v.tab || "outline") : (v.side.hidden = true); layout(); v.pages.forEach((x) => { if (x.near) draw(x); }); }
    else if (what === "back") back();
    else if (what === "in") zoomTo(v.scale * 1.15);
    else if (what === "out") zoomTo(v.scale / 1.15);
    else if (what === "auto") { const on = !prefs().pdfAuto; setPref({ pdfAuto: on }); v.bar.querySelector('[data-do="auto"]').setAttribute("aria-pressed", String(on)); toast(on ? "Selecting text copies a link to it" : "Copy on select is off"); }
    else if (what === "rect") { v.rectTool = !v.rectTool; v.root.classList.toggle("rect-tool", v.rectTool); v.bar.querySelector('[data-do="rect"]').setAttribute("aria-pressed", String(v.rectTool)); }
  }
  function sidePanel(tab) {
    const v = V;
    v.tab = tab;
    v.side.hidden = false;
    v.side.innerHTML = `<div class="pdf-tabs">${[["outline", "Outline"], ["pages", "Pages"], ["notes", "Notes"]].map(([k, l]) => `<button data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join("")}</div><div class="pdf-side-body"></div>`;
    const body = v.side.lastChild;
    if (tab === "outline") {
      const list = (items, depth) => items.map((it, i) => `<div class="pdf-out" style="--depth:${depth}" draggable="true" data-path="${esc(depth + ":" + i)}">${esc(it.title || "")}</div>` + (it.items && it.items.length ? list(it.items, depth + 1) : "")).join("");
      v.flat = [];
      const walk = (items) => items.forEach((it) => { v.flat.push(it); if (it.items) walk(it.items); });
      walk(v.outline || []);
      body.innerHTML = v.flat.length ? list(v.outline, 0) : '<div class="menu-empty">This PDF has no outline</div>';
      body.querySelectorAll(".pdf-out").forEach((d, i) => { d.dataset.i = i; });
    } else if (tab === "pages") {
      body.innerHTML = v.pages.map((pg) => `<div class="pdf-thumb${pg.n === pageNow(true) ? " on" : ""}" data-page="${pg.n}" draggable="true"><div class="pdf-thumb-img" style="aspect-ratio:${pg.w}/${pg.h}"></div><span>${pg.n}</span></div>`).join("");
      const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); thumb(e.target); } }, { root: body, rootMargin: "300px 0px" });
      body.querySelectorAll(".pdf-thumb").forEach((t) => io.observe(t));
      const on = body.querySelector(".pdf-thumb.on");
      if (on) on.scrollIntoView({ block: "center" });
    } else notesTab();
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
    if (!v || v.side.hidden || v.tab !== "notes") return;
    const body = v.side.querySelector(".pdf-side-body"), now = pageNow(true);
    const rows = v.backlinks.map((b, i) => ({ b, i })).sort((x, y) => (x.b.at.page === now ? 0 : 1) - (y.b.at.page === now ? 0 : 1) || x.b.at.page - y.b.at.page);
    body.innerHTML = rows.length ? rows.map(({ b, i }) => `<div class="pdf-note${b.at.page === now ? " here" : ""}" data-bl="${i}"><span class="pdf-note-dot" style="--hl:${colorOf(b.at.color)}"></span><b>${esc(b.name.replace(/\.md$/i, ""))}</b><i>p. ${b.at.page}</i><span>${esc(b.text)}</span></div>`).join("")
      : '<div class="menu-empty">No note links to this PDF yet</div>';
  }
  const outlineLink = async (it) => { const pl = it.dest ? await placeOf(it.dest) : null; return pl ? `[[${basename(V.p.path)}#page=${pl.n}|${(it.title || "").trim() || stem(V.p.path) + ", page " + pl.n}]]` : null; };
  const pageLink = (n) => `[[${basename(V.p.path)}#page=${n}|${stem(V.p.path)}, page ${n}]]`;

  function events() {
    const v = V;
    v.bar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.do) act(b.dataset.do);
      else if (b.dataset.fit) zoomTo(b.dataset.fit);
      else if (b.dataset.color) { v.color = b.dataset.color; v.bar.querySelectorAll(".pdf-color").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); if (selectionNow()) copySelection(v.color); }
    });
    v.bar.addEventListener("mousedown", (e) => { if (e.target.closest("button")) e.preventDefault(); }); // the selection stays
    v.bar.querySelector(".pdf-format").addEventListener("change", (e) => setPref({ pdfFormat: e.target.value }));
    window.MdView.core.popup(v.bar.querySelector(".pdf-format")); // (a button with the app's own menu)
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
      if (text) { copy(text); toast(out ? "Link to the section copied" : "Link to the page copied"); }
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
      if (pl) { copy(pageLink(pl.n)); toast("Link to page " + pl.n + " copied"); }
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
    if (!V || !V.root.isConnected) return;
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
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
    else if (k === "o") { stop(); V.side.hidden || V.tab !== "outline" ? (sidePanel("outline"), layout()) : act("side"); }
    else if (k === "t") { stop(); V.side.hidden || V.tab !== "pages" ? (sidePanel("pages"), layout()) : act("side"); }
    else if (k === "n") { stop(); V.side.hidden || V.tab !== "notes" ? (sidePanel("notes"), layout()) : act("side"); }
    else if (k === "r") { stop(); act("rect"); }
    else if (k === "Escape" && V.rectTool) { stop(); act("rect"); }
    else if (k === "Escape" && !V.side.hidden) { stop(); act("side"); }
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
    if (have) { const img = have.cloneNode(); span.replaceChildren(img); span.classList.add("ready"); return; }
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
      const scale = Math.min(3, (want || room) / (crop && (want || !at.rect) ? crop[2] : base.width));
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      // Only what is shown is drawn: the canvas is as large as the region, the page shifted under it
      // (a whole page drawn at this scale and then cut cost several times the work, on the page's own thread).
      const k = scale * ratio, cut = crop || [0, 0, base.width, base.height];
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
      img.width = Math.round(shown.width / ratio); img.height = Math.round(shown.height / ratio);
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
    if (!span.hasAttribute("data-full")) span.style.width = m[1] + "px";
    span.style.height = (span.hasAttribute("data-full") && span.parentElement ? Math.round(span.parentElement.clientWidth * m[2] / m[1]) : m[2]) + "px";
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
  function pull(scale) {
    zoomWant = scale;
    if (zoomFrame) return;
    zoomFrame = requestAnimationFrame(() => { zoomFrame = 0; if (shown()) zoomTo(zoomWant, true); });
  }
  function pinch(phase, scale) {
    if (!shown()) return;
    if (phase === "begin") { pinchBase = V.scale; return; }
    if (scale > 0 && Number.isFinite(scale)) pull(pinchBase * scale);
  }
  // (On the viewer itself, never on the window: a wheel listener that may hold the wheel back makes
  // every scroll of every note wait for the page's scripts.)
  function onWheel(e) {
    if (!e.ctrlKey || !shown()) return;
    e.preventDefault(); e.stopPropagation();
    pull((zoomFrame ? zoomWant : V.scale) * Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * 0.0015));
  }

  window.MdPdf = { show, leave, hydrate, chunk, parseFrag, pinch, pageShot, get shown() { return V; },
    // for the tests
    test: { selectionNow, copySelection, copyView, go, goFrag, zoomTo, act, sidePanel, boxesOf, joined, textOf, linkText, pageNow, placeOf } };
})();
