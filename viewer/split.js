/* mdview — two things side by side: a note and a PDF, and nothing else (Henri, 2026-10-26: "two notes side by side should no
 * longer be possible; note + PDF is the only format for now"). Beside a note in the window, at the window's right, a PDF's pages;
 * beside a PDF in the window (Swap Sides), the note, read or written in. The one in the window is the window's as ever, in any of
 * its modes; what is beside it is chosen where the thing is: Show in Split View in the menu of a tab that is not the one in the
 * window, Open Beside in a file's menu — offered only where the two would be a note and a PDF. A window that comes to hold what
 * would make two notes (or two PDFs) side by side closes the sheet (held). A link to a note in the sheet leads on there; one that
 * would make two of a kind opens in the window instead. (The note beside its own reading is the source mode's "split" —
 * viewer/twin.js —, not this.)
 *
 * Another note's text is the host's to read (note-read: the page may not read files); a PDF's pages are drawn by the viewer's
 * own means (pdfview.js: pageShot), as pictures. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, esc, svg, READING } = P; // viewer/base.js, viewer/editor.js
  const I = {
    close: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
    over: svg('<path d="M14 6 8 12l6 6"/><path d="M20 12H9"/>'),
    write: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    read: svg('<path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10a2 2 0 0 1 2 2v14a1.6 1.6 0 0 0-1.6-1.6H4.5A1.5 1.5 0 0 1 3 16.9z"/><path d="M21 5.5A1.5 1.5 0 0 0 19.5 4H14a2 2 0 0 0-2 2v14a1.6 1.6 0 0 1 1.6-1.6h5.9a1.5 1.5 0 0 0 1.5-1.5z"/>'),
  };
  const KINDS = [[/\.(md|markdown|mdown|txt)$/i, "note"], [/\.pdf$/i, "pdf"]];
  const kindOf = (path) => (KINDS.find(([re]) => re.test(path)) || [])[1] || null;
  /* what the window holds, as the sheet sees it: "pdf", "note", or null (nothing, or a note that could not be read) */
  const leftKind = () => { const c = P.current; return !c || c.error ? null : c.kind === "pdf" ? "pdf" : "note"; };
  /* the one pair there is: a note and a PDF, either of them in the window */
  const pairs = (kind) => (kind === "pdf" && leftKind() === "note") || (kind === "note" && leftKind() === "pdf");
  const nameOf = (path) => path.split("/").pop().replace(/\.(md|markdown|mdown)$/i, "");

  let S = null;        // what is beside: { kind: "note" | "pdf", path, links }
  let pane = null, seq = 0, swapping = false;
  const waiting = new Map();
  const body = () => pane.querySelector(".split-body"), doc = () => pane.querySelector(".split-doc");

  // ---------------------------------------------------------------- the sheet
  function build() {
    pane = document.createElement("section");
    pane.id = "split";
    pane.setAttribute("aria-label", T("Side by Side"));
    pane.innerHTML = `<div class="split-grip" role="separator" aria-orientation="vertical" aria-label="${esc(T("Side by Side"))}"></div>` +
      `<div class="split-body" tabindex="-1"><div class="split-doc"></div></div>` +
      `<div class="split-bar pdf-bar" role="toolbar" aria-label="PDF" hidden></div>` +
      `<div class="split-cap" role="toolbar"><span class="split-name"></span>` +
      `<button class="tb" type="button" data-do="write" aria-pressed="false" title="${esc(T("Edit Here"))}" aria-label="${esc(T("Edit Here"))}">${I.write}</button>` +
      `<button class="tb" type="button" data-do="over" title="${esc(T("Swap Sides"))}" aria-label="${esc(T("Swap Sides"))}">${I.over}</button>` +
      `<button class="tb" type="button" data-do="close" title="${esc(T("Close"))}" aria-label="${esc(T("Close"))}">${I.close}</button></div>`;
    document.body.appendChild(pane);
    sizing(pane.querySelector(".split-grip"));
    pane.addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]"), a = e.target.closest("a");
      if (b) return b.dataset.do === "close" ? close() : b.dataset.do === "write" ? writing(!S.src) : over();
      if (!a) return;
      e.preventDefault(); e.stopPropagation(); // (the window's own links lead on at the left: these are the sheet's)
      const info = a.dataset.wiki && S && S.links ? S.links[a.dataset.wiki] : null;
      if (info && info.path && kindOf(info.path)) { if (pairs(kindOf(info.path))) open({ path: info.path }); else post("note", { path: info.path }); }
    }, true);
    pane.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  }
  const named = (name) => { pane.querySelector(".split-name").textContent = name; };

  /* How the window is shared: half and half at first, and as the hairline between the halves is pulled — each keeps room to be
   * read in (a third of what there is at least). Kept in this browser; a double click on the line makes it halves again. */
  const KEEP = "mdview:split";
  const share = (r) => { r = Math.max(0.3, Math.min(0.7, r)); document.documentElement.style.setProperty("--split-r", String(r)); return r; };
  try { const r = Number(localStorage.getItem(KEEP)); if (r > 0) share(r); } catch (e) { /* (not kept) */ }
  function sizing(grip) {
    let room = null;
    const kept = (r) => { try { localStorage.setItem(KEEP, String(r)); } catch (e) { /* (not kept) */ } };
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      room = { wide: innerWidth - (P.sbRoom?.() || 0), r: null }; // (the halves share what the sidebar leaves of the window)
      grip.setPointerCapture(e.pointerId);
      pane.dataset.sizing = ""; document.body.dataset.splitSizing = "";
    });
    grip.addEventListener("pointermove", (e) => { if (room) { room.r = share((innerWidth - e.clientX) / room.wide); placed(); } });
    const done = () => { if (!room) return; if (room.r) kept(room.r); room = null; delete pane.dataset.sizing; delete document.body.dataset.splitSizing; };
    grip.addEventListener("pointerup", done);
    grip.addEventListener("pointercancel", done);
    grip.addEventListener("dblclick", () => { kept(share(0.5)); placed(); });
  }
  // ---------------------------------------------------------------- what it shows
  const html = (path, text, links) => P.previewOf(path, text, { whole: true, links: links || {} }).html || `<p class="split-empty">${esc(T("Empty"))}</p>`;
  /* A note beside the PDF in the window is written in too: its source, in the sheet, kept a moment after the last key
   * (note-save) — as the window's own source is, in the same type. */
  const SAVE_MS = 800;
  function writing(on) {
    const s = S;
    if (!s || s.kind !== "note" || !s.text && s.text !== "") return;
    const b = pane.querySelector('[data-do="write"]');
    if (!on) { keep(s); s.src = null; doc().classList.remove("is-src"); doc().innerHTML = html(s.path, s.text, s.links); }
    else {
      doc().classList.add("is-src");
      doc().innerHTML = `<textarea class="split-src" spellcheck="false" aria-label="${esc(T("Edit Here"))}"></textarea>`;
      const ta = (s.src = doc().firstChild);
      ta.value = s.text;
      const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
      ta.addEventListener("input", () => { s.text = ta.value; s.dirty = true; fit(); clearTimeout(s.saving); s.saving = setTimeout(() => keep(s), SAVE_MS); });
      ta.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); writing(false); } }); // (the keys are the text's, not the window's)
      ta.addEventListener("blur", () => keep(s));
      requestAnimationFrame(fit);
      ta.focus({ preventScroll: true });
    }
    b.setAttribute("aria-pressed", String(!!s.src));
    b.innerHTML = s.src ? I.read : I.write;
    b.title = T(s.src ? "Read Here" : "Edit Here"); b.setAttribute("aria-label", b.title);
  }
  function keep(s) {
    clearTimeout(s.saving);
    if (!s.dirty) return;
    s.dirty = false;
    const id = "w" + ++seq;
    waiting.set(id, s);
    post("note-save", { path: s.path, text: s.text, id });
  }
  function saved(id, error) {
    waiting.delete(id);
    if (error && P.toast) P.toast(T("Couldn't save: {0}", error));
  }
  function got(id, data, error) {
    const w = waiting.get(id);
    waiting.delete(id);
    if (!w || S !== w) return;
    if (!data) { doc().innerHTML = `<p class="split-empty">${esc(error || T("This file can't be shown here"))}</p>`; return; }
    S.links = data.links || {};
    S.text = String(data.text || "");
    doc().innerHTML = html(S.path, S.text, S.links);
    body().scrollTop = 0;
  }
  /* A PDF beside a note: its pages as pictures, each drawn when it comes near — and over them the viewer's plain controls, as its
   * own bar has them (pdfview.js, whose looks these are): the page one is on and the way to another, larger and smaller, the
   * page's width or the whole page fitted. (What the viewer does beyond reading — its side card, a region for a note, drawing —
   * is the window's left.) */
  const PI = {
    minus: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9"/></svg>', plus: '<svg viewBox="0 0 16 16"><path d="M3.5 8h9M8 3.5v9"/></svg>',
    width: '<svg viewBox="0 0 16 16"><path d="M2 8h12M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5"/></svg>',
    page: '<svg viewBox="0 0 16 16"><rect x="3.5" y="1.5" width="9" height="13" rx="1.5"/></svg>',
  };
  async function pages(s) {
    const d = doc(), b = body(), bar = pane.querySelector(".split-bar");
    d.innerHTML = `<div class="split-page" data-page="1"></div>`;
    try {
      await P.loadPdf();
      const first = await window.MdPdf.pageShot(s.path, 1, Math.max(400, b.clientWidth - 48));
      if (S !== s) return;
      const box = first.rect(0, 0, 1, 1), pts = Math.max(1, box[2] - box[0]), ratio = first.img.width / first.img.height;
      const v = (s.pdf = { n: first.pages, pts, ratio, fit: "width", scale: 1, wide: 0, later: 0 });
      const btn = (attr, label, icon, more = "") => `<button type="button" class="tb pdf-b" ${attr} title="${esc(T(label))}" aria-label="${esc(T(label))}"${more}>${icon}</button>`;
      bar.innerHTML = `<input class="pdf-page-in" inputmode="numeric" value="1" aria-label="${esc(T("Page"))}"><span class="pdf-of">/ ${v.n}</span><span class="pdf-sep"></span>` +
        btn('data-pdf="out"', "Zoom out", PI.minus) + `<span class="pdf-zoom"></span>` + btn('data-pdf="in"', "Zoom in", PI.plus) +
        btn('data-pdf="width"', "Fit width", PI.width, ' aria-pressed="true"') + btn('data-pdf="page"', "Fit page", PI.page, ' aria-pressed="false"');
      bar.hidden = false;
      d.innerHTML = Array.from({ length: v.n }, (_x, i) => `<div class="split-page" data-page="${i + 1}" style="aspect-ratio:${ratio}"></div>`).join("");
      const els = [...d.children], sheet = window.MdPdf.sheet;
      /* over each page as the viewer has it (pdfview.js: sheet): its text, to select — Ctrl+C copies it, Ctrl+Shift+C (or letting go,
       * where the settings copy at once) a link to it, as from the viewer —, its links, and what was drawn on it */
      const ink = (s.ink = sheet.inkOf(s.path).catch(() => null));
      async function layered(el, wide) {
        try {
          const n = Number(el.dataset.page), o = await sheet.overlays(s.path, n, wide), drawn = await ink;
          if (S !== s || Number(el.dataset.wide) !== wide) return;
          el.pg = o.page;
          el.querySelectorAll(":scope > :not(img)").forEach((x) => x.remove());
          if (drawn) el.insertAdjacentHTML("beforeend", sheet.inkPicture(drawn, n));
          el.append(o.layer, o.links);
        } catch (_e) { /* (the picture alone) */ }
      }
      const put = (el, shot, wide) => { if (S !== s || !el.isConnected) return; el.dataset.wide = wide; el.replaceChildren(shot.img); if (wide) layered(el, wide); };
      put(els[0], first, 0);
      // a page in sight that is not drawn as large as it is shown is drawn anew (the one it has stays until then)
      const near = (s.near = new IntersectionObserver((list) => {
        for (const e of list) { e.target.near = e.isIntersecting; if (e.isIntersecting) draw(e.target); }
      }, { root: b, rootMargin: "600px 0px" }));
      function draw(el) {
        const wide = v.wide;
        if (!el.near || Number(el.dataset.wide) === wide || el.dataset.busy === String(wide)) return;
        el.dataset.busy = wide;
        window.MdPdf.pageShot(s.path, Number(el.dataset.page), wide).then((shot) => { if (v.wide === wide) put(el, shot, wide); else draw(el); }, () => {});
      }
      const fitted = (how) => { const room = Math.max(120, b.clientWidth - 48); return how === "page" ? Math.min(room / pts, Math.max(120, b.clientHeight - 72) / (pts / ratio)) : room / pts; };
      /* how: "width", "page", or a number (the page's points to pixels); at: the place in the sheet that stays where it is */
      function zoom(how, at = null) {
        const high = b.scrollHeight || 1, y = at ? at.y : 0, into = (b.scrollTop + y) / high, x = at ? at.x : b.clientWidth / 2, across = (b.scrollLeft + x) / (b.scrollWidth || 1);
        if (typeof how === "number") { v.fit = null; v.scale = Math.max(0.25, Math.min(5, how)); } else { v.fit = how; v.scale = fitted(how); }
        v.wide = Math.round(pts * v.scale);
        d.style.setProperty("--pw", v.wide + "px");
        bar.querySelector(".pdf-zoom").textContent = Math.round(v.scale * 100) + "%";
        for (const k of ["width", "page"]) bar.querySelector(`[data-pdf="${k}"]`).setAttribute("aria-pressed", String(v.fit === k));
        b.scrollTop = into * b.scrollHeight - y;
        b.scrollLeft = across * b.scrollWidth - x;
        clearTimeout(v.later);
        v.later = setTimeout(() => { if (S === s) els.forEach(draw); }, 160); // (while the size is pulled the pages are stretched; drawn when it rests)
      }
      const now = () => { const mid = b.scrollTop + b.clientHeight * 0.4; let n = 1; for (const el of els) { if (el.offsetTop <= mid) n = Number(el.dataset.page); else break; } return n; };
      const go = (n) => { n = Math.max(1, Math.min(v.n, Math.floor(n) || 1)); b.scrollTop = els[n - 1].offsetTop - 12; };
      const input = bar.querySelector(".pdf-page-in");
      s.gone = [];
      const on = (el, type, f, more) => { el.addEventListener(type, f, more); s.gone.push(() => el.removeEventListener(type, f, more)); };
      on(bar, "click", (e) => { const k = (e.target.closest("[data-pdf]") || { dataset: {} }).dataset.pdf; if (k === "in") zoom(v.scale * 1.15); else if (k === "out") zoom(v.scale / 1.15); else if (k) zoom(k); });
      on(input, "keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { go(Number(input.value)); input.blur(); } else if (e.key === "Escape") { input.value = now(); input.blur(); } });
      on(input, "focus", () => input.select());
      on(b, "scroll", () => { if (document.activeElement !== input) input.value = now(); }, { passive: true });
      // a link inside the PDF: to its place here, or out; the selection's link (pdfview.js: copyLink — a callout, a quote, a link)
      const selected = () => sheet.selectionIn(d, (n) => els[n - 1] && els[n - 1].pg);
      // (taken before the page's own handling of links, which would follow the "#" — viewer/toolbar.js)
      on(window, "click", async (e) => {
        const a = e.target instanceof Element && e.target.closest(".pdf-link");
        if (!a || !d.contains(a)) return;
        e.preventDefault(); e.stopPropagation();
        if (a.pdfDest) { const pl = await sheet.placeIn(s.path, a.pdfDest); if (pl && S === s) { const el = els[pl.n - 1]; b.scrollTop = el.offsetTop - 12 + (pl.top != null && el.pg ? pl.top * el.pg.vp.scale : 0); } }
        else if (a.dataset.url) post("link", { href: a.dataset.url });
      }, true);
      on(document, "keydown", (e) => {
        if (!((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c")) return;
        const at = selected();
        if (!at) return;
        e.preventDefault(); e.stopPropagation();
        sheet.copyLink(s.path, at); document.getSelection().removeAllRanges();
      }, true);
      on(d, "mouseup", () => setTimeout(() => { if (S !== s || !sheet.auto()) return; const at = selected(); if (at && at.text) { sheet.copyLink(s.path, at); document.getSelection().removeAllRanges(); } }, 30));
      on(b, "wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = b.getBoundingClientRect(); zoom(v.scale * Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top }); }, { passive: false });
      const sized = new ResizeObserver(() => { if (S === s && v.fit) zoom(v.fit); });
      sized.observe(b);
      s.gone.push(() => sized.disconnect());
      zoom("width");
      for (const el of els) near.observe(el);
      s.pdfDo = { zoom, go, now, state: () => ({ scale: v.scale, fit: v.fit, wide: v.wide, pages: v.n }) }; // (for the tests)
    } catch (e) { if (S === s) d.innerHTML = `<p class="split-empty">${esc(T("This PDF can't be opened"))}</p>`; }
  }
  /* What a sheet set up for itself is taken away with it. */
  function leave(s) {
    if (!s) return;
    if (s.near) s.near.disconnect();
    for (const f of s.gone || []) f();
    if (s.pdf) clearTimeout(s.pdf.later);
    if (pane) { const bar = pane.querySelector(".split-bar"); bar.hidden = true; bar.innerHTML = ""; doc().style.removeProperty("--pw"); }
  }

  // ---------------------------------------------------------------- opening and closing
  /* Two things want room: 300 px each at the least. Where the window has less, there is one thing to show — said, when two are
   * asked for, and the sheet is out of sight for as long. (A sidebar pinned takes its room.) */
  const ROOM = 600;
  const fits = () => innerWidth - (P.sbRoom?.() || 0) >= ROOM;
  const narrow = () => { document.body.toggleAttribute("data-split-narrow", !!S && !fits()); placed(); };
  addEventListener("resize", narrow);
  /* Where the note is a sheet on a ground of its own, what floats at the note's right — the rail, the panel — stands on that sheet,
   * not across its edge: how far the sheet's edge is from the line between the halves is measured, and said to the stylesheet. */
  function placed() {
    const root = document.documentElement;
    const el = S && pane && root.dataset.docBg ? ["content", "active", "editor"].map((id) => document.getElementById(id)).find((x) => x && x.getClientRects().length) : null;
    if (!el) return root.style.removeProperty("--split-in");
    const r = el.getBoundingClientRect(), edge = parseFloat(getComputedStyle(el).borderRightWidth) || 0;
    root.style.setProperty("--split-in", Math.max(0, Math.round(pane.getBoundingClientRect().left - (r.right - edge))) + "px");
  }
  if (typeof MutationObserver === "function") { // (another note, another mode: the sheet may stand elsewhere)
    const again = new MutationObserver(() => { if (S) requestAnimationFrame(placed); });
    again.observe(document.documentElement, { attributes: true, attributeFilter: ["data-doc-bg"] });
    again.observe(document.body, { attributes: true, attributeFilter: ["data-view", "data-going"] });
  }
  /* what: { path } — a PDF beside a note in the window, or a note beside a PDF; nothing else. */
  function open(what) {
    const kind = what && what.path ? kindOf(what.path) : null;
    if (!kind || !pairs(kind)) return P.toast && P.toast(T("Side by side: a note and a PDF"));
    if (!fits()) return P.toast && P.toast(T("The window is too narrow for two side by side"));
    if (P.mode === "split") P.setMode("edit"); // (the source beside its reading makes way: one thing beside the note at a time — viewer/twin.js)
    if (!pane) build();
    if (S && S.src) keep(S);
    leave(S);
    const s = (S = { kind, path: what.path, links: {} });
    doc().className = "split-doc" + (kind === "pdf" ? " is-pdf" : "");
    doc().innerHTML = "";
    named(nameOf(what.path));
    const w = pane.querySelector('[data-do="write"]');
    w.hidden = kind !== "note"; w.setAttribute("aria-pressed", "false"); w.innerHTML = I.write; w.title = T("Edit Here"); w.setAttribute("aria-label", w.title);
    document.body.dataset.split = kind;
    pane.dataset.kind = kind;
    narrow();
    if (kind === "note") { const id = "s" + ++seq; waiting.set(id, s); post("note-read", { path: s.path, id }); }
    else pages(s);
    body().scrollTop = 0;
  }
  function close() {
    if (!S) return;
    if (S.src) keep(S);
    leave(S);
    S = null;
    delete document.body.dataset.split;
    narrow();
  }
  /* The two sides change places: what is beside goes into the window — the note to be edited there in any mode, the active one
   * too — and the window's PDF beside it (Henri, 2026-10-14: the right side had only its source); a PDF beside a note the same
   * way round. (While they change, the window holds two of a kind for a moment: held lets it be.) */
  async function over() {
    if (!S || !S.path) return;
    if (S.src) keep(S);
    const path = S.path, was = P.current && P.current.path;
    if (!was || was === path) return close();
    swapping = true;
    try {
      post("note", { path });
      for (let t = 0; t < 4000 && !(P.current && P.current.path === path); t += 50) await new Promise((r) => setTimeout(r, 50));
    } finally { swapping = false; }
    if (P.current && P.current.path === path && kindOf(was) && pairs(kindOf(was))) open({ path: was }); else close();
  }
  /* The window has come to hold another thing (viewer/render.js): what is beside it stays only while the two are a note and a
   * PDF — two notes, or two PDFs, are not side by side. */
  function held() { if (S && !swapping && !pairs(S.kind)) close(); }

  Object.assign(P, { splitSaved: saved, splitWrite: (on) => writing(on), splitFor: (path) => !READING && !!kindOf(path) && pairs(kindOf(path)), splitOpen: open, splitClose: close, splitHeld: held, splitGot: got, splitState: () => (S ? { kind: S.kind, path: S.path, pdf: S.pdfDo ? S.pdfDo.state() : null } : null), splitPdf: () => S && S.pdfDo });
})();
