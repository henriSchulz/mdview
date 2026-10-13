/* mdview — two things side by side: beside the note, at the window's right, a second sheet that is only read — the note itself as it
 * reads (while its source is written at the left: it follows what is typed), another note, a PDF's pages, a picture. The note at
 * the left is the window's as ever, in any of its modes; what is beside it is chosen with the toolbar's button (this note, as it
 * reads) or with Open Beside in a file's menu. A link to a note or a PDF in the sheet at the right leads on there.
 *
 * Another note's text is the host's to read (note-read: the page may not read files); a PDF's pages are drawn by the viewer's
 * own means (pdfview.js: pageShot), as pictures. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, esc, svg, READING } = P; // viewer/base.js, viewer/editor.js
  const I = {
    split: svg('<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M12 5v14"/>'),
    close: svg('<path d="M7 7l10 10M17 7 7 17"/>'),
    over: svg('<path d="M14 6 8 12l6 6"/><path d="M20 12H9"/>'),
  };
  const KINDS = [[/\.(md|markdown|mdown|txt)$/i, "note"], [/\.pdf$/i, "pdf"], [/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i, "image"]];
  const kindOf = (path) => (KINDS.find(([re]) => re.test(path)) || [])[1] || null;
  const nameOf = (path) => path.split("/").pop().replace(/\.(md|markdown|mdown)$/i, "");
  const fileUrl = (path) => (window.MdHost?.files || "file://") + path.split("/").map(encodeURIComponent).join("/");

  let S = null;        // what is beside the note: { kind: "self" | "note" | "pdf" | "image", path, links, shown, of }
  let pane = null, watch = 0, seq = 0;
  const waiting = new Map();
  const body = () => pane.querySelector(".split-body"), doc = () => pane.querySelector(".split-doc");

  // ---------------------------------------------------------------- the button, the sheet
  const button = document.createElement("button");
  button.className = "tb tb-split"; button.type = "button"; // (not one of the toolbar's own acts: it is carried out here)
  button.title = T("Side by Side"); button.setAttribute("aria-label", T("Side by Side")); button.setAttribute("aria-pressed", "false");
  button.innerHTML = I.split;
  button.hidden = !!READING; // (where a note is only shown there is one thing to read)
  if (P.toolbar) P.toolbar.appendChild(button);
  button.addEventListener("click", () => (S ? close() : open(null)));

  function build() {
    pane = document.createElement("section");
    pane.id = "split";
    pane.setAttribute("aria-label", T("Side by Side"));
    pane.innerHTML = `<div class="split-grip" role="separator" aria-orientation="vertical" aria-label="${esc(T("Side by Side"))}"></div>` +
      `<div class="split-body" tabindex="-1"><div class="split-doc"></div></div>` +
      `<div class="split-cap" role="toolbar"><span class="split-name"></span>` +
      `<button class="tb" type="button" data-do="over" title="${esc(T("Open at the Left"))}" aria-label="${esc(T("Open at the Left"))}">${I.over}</button>` +
      `<button class="tb" type="button" data-do="close" title="${esc(T("Close"))}" aria-label="${esc(T("Close"))}">${I.close}</button></div>`;
    document.body.appendChild(pane);
    sizing(pane.querySelector(".split-grip"));
    pane.addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]"), a = e.target.closest("a");
      if (b) return b.dataset.do === "close" ? close() : over();
      if (!a) return;
      e.preventDefault(); e.stopPropagation(); // (the window's own links lead on at the left: these are the sheet's)
      const info = a.dataset.wiki && S && S.links ? S.links[a.dataset.wiki] : null;
      if (info && info.path && kindOf(info.path)) open({ path: info.path });
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
      const left = document.body.dataset.sidebar === "open" ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sb-w")) || 0 : 0;
      room = { left, wide: innerWidth - left, r: null };
      grip.setPointerCapture(e.pointerId);
      pane.dataset.sizing = ""; document.body.dataset.splitSizing = "";
    });
    grip.addEventListener("pointermove", (e) => { if (room) room.r = share((innerWidth - e.clientX) / room.wide); });
    const done = () => { if (!room) return; if (room.r) kept(room.r); room = null; delete pane.dataset.sizing; delete document.body.dataset.splitSizing; };
    grip.addEventListener("pointerup", done);
    grip.addEventListener("pointercancel", done);
    grip.addEventListener("dblclick", () => kept(share(0.5)));
  }
  /* The note beside its own reading runs with it: as far down the note at the left is, so far is the sheet at the right (the
   * two are one text, of two lengths). */
  let runFrame = 0;
  function run() {
    runFrame = 0;
    if (!S || S.kind !== "self") return;
    const el = document.scrollingElement, far = el.scrollHeight - innerHeight, b = body();
    if (far > 0) b.scrollTop = (el.scrollTop / far) * (b.scrollHeight - b.clientHeight);
  }
  addEventListener("scroll", () => { if (S && S.kind === "self" && !runFrame) runFrame = requestAnimationFrame(run); }, { passive: true });

  // ---------------------------------------------------------------- what it shows
  /* The note at the left as it stands now, in whatever mode it is written. */
  function textNow() {
    if (P.mode === "edit" && P.edInput) return P.edInput.value;
    if (P.mode === "active" && window.MdActive && MdActive.view && MdActive.view.pm) { try { return MdActive.view.serialize(false); } catch (e) { /* (not ready) */ } }
    return (P.current && P.current.raw) || "";
  }
  const html = (path, text, links) => P.previewOf(path, text, { whole: true, links: links || {} }).html || `<p class="split-empty">${esc(T("Empty"))}</p>`;
  /* … drawn again when it is another: what is typed at the left is read at the right a moment later, at the place one was. */
  function follow() {
    if (!S || S.kind !== "self") return;
    const cur = P.current;
    if (!cur || cur.kind === "pdf" || cur.error) { if (S.shown !== null) { S.shown = null; S.of = null; doc().innerHTML = ""; named(""); } return; }
    const text = textNow();
    if (text === S.shown && S.of === cur.path) return;
    const same = S.of === cur.path, at = body().scrollTop;
    S.shown = text; S.of = cur.path; S.path = cur.path; S.links = cur.links || {};
    doc().className = "split-doc";
    doc().innerHTML = html(cur.path, text, S.links);
    named(cur.title || nameOf(cur.path));
    body().scrollTop = same ? at : 0;
    if (same) run();
  }
  function got(id, data, error) {
    const w = waiting.get(id);
    waiting.delete(id);
    if (!w || S !== w) return;
    if (!data) { doc().innerHTML = `<p class="split-empty">${esc(error || T("This file can't be shown here"))}</p>`; return; }
    S.links = data.links || {};
    doc().innerHTML = html(S.path, String(data.text || ""), S.links);
    body().scrollTop = 0;
  }
  /* A PDF beside a note: its pages as pictures, each drawn when it comes near. */
  async function pages(s) {
    const d = doc(), wide = Math.min(1400, Math.max(400, Math.round(body().clientWidth - 64)));
    d.innerHTML = `<div class="split-page" data-page="1"></div>`;
    try {
      await P.loadPdf();
      const first = await window.MdPdf.pageShot(s.path, 1, wide);
      if (S !== s) return;
      const ratio = first.img.width / first.img.height;
      d.innerHTML = Array.from({ length: first.pages }, (_v, i) => `<div class="split-page" data-page="${i + 1}" style="aspect-ratio:${ratio}"></div>`).join("");
      d.firstChild.replaceChildren(first.img);
      const near = new IntersectionObserver((list) => {
        for (const e of list) {
          if (!e.isIntersecting) continue;
          near.unobserve(e.target);
          window.MdPdf.pageShot(s.path, Number(e.target.dataset.page), wide).then((shot) => { if (S === s && e.target.isConnected) { e.target.style.aspectRatio = ""; e.target.replaceChildren(shot.img); } }, () => {});
        }
      }, { root: body(), rootMargin: "600px 0px" });
      for (const el of [...d.children].slice(1)) near.observe(el);
      s.near = near;
    } catch (e) { if (S === s) d.innerHTML = `<p class="split-empty">${esc(T("This PDF can't be opened"))}</p>`; }
  }

  // ---------------------------------------------------------------- opening and closing
  /* Two things want room: 300 px each at the least. Where the window has less beside the sidebar, the sidebar makes way; where it
   * has less even so, there is one thing to show — said, when two are asked for, and the sheet is out of sight for as long. */
  const ROOM = 600;
  const sideW = () => (document.body.dataset.sidebar === "open" ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sb-w")) || 0 : 0);
  const fits = () => innerWidth - sideW() >= ROOM;
  const narrow = () => document.body.toggleAttribute("data-split-narrow", !!S && !fits());
  addEventListener("resize", narrow);
  /* what: null — the note at the left, as it reads; { path } — that file. */
  function open(what) {
    const kind = what ? kindOf(what.path) : "self";
    if (!kind) return P.toast && P.toast(T("This file can't be shown here"));
    if (!fits() && innerWidth >= ROOM && sideW() && P.showSidebar) P.showSidebar(false, true);
    if (!fits()) return P.toast && P.toast(T("The window is too narrow for two side by side"));
    if (!pane) build();
    if (S && S.near) S.near.disconnect();
    const s = (S = { kind, path: what ? what.path : null, links: {}, shown: undefined, of: null });
    doc().className = "split-doc" + (kind === "pdf" ? " is-pdf" : kind === "image" ? " is-image" : "");
    doc().innerHTML = "";
    named(what ? nameOf(what.path) : "");
    pane.querySelector('[data-do="over"]').hidden = kind === "self";
    document.body.dataset.split = kind;
    narrow();
    button.setAttribute("aria-pressed", "true");
    clearInterval(watch);
    if (kind === "self") { follow(); watch = setInterval(follow, 400); }
    else if (kind === "note") { const id = "s" + ++seq; waiting.set(id, s); post("note-read", { path: s.path, id }); }
    else if (kind === "pdf") pages(s);
    else doc().innerHTML = `<img src="${esc(fileUrl(s.path))}" alt="${esc(nameOf(s.path))}" draggable="false">`;
    body().scrollTop = 0;
  }
  function close() {
    if (!S) return;
    if (S.near) S.near.disconnect();
    S = null;
    clearInterval(watch);
    delete document.body.dataset.split;
    narrow();
    button.setAttribute("aria-pressed", "false");
  }
  /* What is beside the note becomes the window's own: opened at the left, where it can be written. */
  function over() {
    if (!S || !S.path || S.kind === "self") return;
    const path = S.path;
    close();
    post("note", { path });
  }

  Object.assign(P, { splitOpen: open, splitClose: close, splitGot: got, splitState: () => (S ? { kind: S.kind, path: S.path, of: S.of } : null) });
})();
