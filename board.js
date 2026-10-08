/* mdview — the whiteboard: a board that stands in a note as a picture (a file *.board.svg, see
 * board/format.js) is opened over the whole window, drawn on, and kept. Loaded on first use
 * (viewer.js: loadBoard), with board.css and board/*.js before it.
 *
 * The host is asked for the file's text (board-read) and handed it back (board-save); the page
 * may not read files itself. One board is open at a time. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const core = window.MdView.core, post = core.post, T = window.MdStrings.t, esc = core.esc;
  const SAVE_MS = 800; // after the last change (as a note's: viewer.js AUTOSAVE_MS)
  const ERASER = 10; // the eraser's radius on the screen
  // the palette's inks, in its order: what is written into the file ("auto": the text's colour, whatever the theme)
  const INKS = [["auto", "auto"], ["blue", "#1f6fe5"], ["green", "#2fa84f"], ["yellow", "#f2b90f"], ["red", "#e5372c"], ["purple", "#8e4fd6"]];
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const I = {
    back: svg('<path d="M14.5 6 8.5 12l6 6"/>'),
    undo: svg('<path d="M8 5 4 9l4 4"/><path d="M4 9h10a5.5 5.5 0 0 1 0 11h-3"/>'),
    redo: svg('<path d="m16 5 4 4-4 4"/><path d="M20 9H10a5.5 5.5 0 0 0 0 11h3"/>'),
    pen: svg('<path d="m5 19 1.2-4.6L16.5 4.1a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L9.6 17.8z"/><path d="m14.5 6.1 3.4 3.4"/>'),
    mono: svg('<path d="M4 17c3-9 5-9 7-3s4 6 9-7"/>'),
    eraser: svg('<path d="m8.5 19-4-4a1.6 1.6 0 0 1 0-2.3l8.2-8.2a1.6 1.6 0 0 1 2.3 0l4.5 4.5a1.6 1.6 0 0 1 0 2.3L12 19z"/><path d="m8.8 8.6 6.6 6.6M7 19h13"/>'),
    grid: svg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><g fill="currentColor" stroke="none"><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/></g>'),
    more: svg('<circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/>'),
    scenes: svg('<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><circle cx="4.8" cy="7" r="0.9" fill="currentColor"/><circle cx="4.8" cy="12" r="0.9" fill="currentColor"/><circle cx="4.8" cy="17" r="0.9" fill="currentColor"/>'),
    prev: svg('<path d="M14.5 7 9.5 12l5 5"/>'), next: svg('<path d="m9.5 7 5 5-5 5"/>'),
    rename: svg('<path d="m5 19 1.2-4.6L16.5 4.1a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L9.6 17.8z"/>'),
    frame: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2"/>'),
    connect: svg('<circle cx="12" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M10.9 8 7.1 16M13.1 8l3.8 8"/>'),
    draw: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 6.5 9 14.5h6z"/><path d="M10 17h4"/>'),
    textbox: svg('<rect x="3.5" y="6" width="17" height="12" rx="2" stroke-dasharray="2.5 2.5"/><path d="M9.5 15 12 9l2.5 6M10.4 13h3.2"/>'),
    shapes: svg('<circle cx="9.5" cy="9.5" r="5.5"/><rect x="10.5" y="10.5" width="10" height="10" rx="2"/>'),
    table: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 10h17M3.5 14h17M9.5 5.5v13M14.5 5.5v13"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    sticky: svg('<path d="M4.5 5.5h15v9l-5 5h-10z"/><path d="M19.5 14.5h-5v5M8 9.5h8M8 13h4"/>'),
    unlock: svg('<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.7-1.4"/>'),
    copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 5.5v-0.5A1.5 1.5 0 0 0 14 3.5H6A2.5 2.5 0 0 0 3.5 6v8A1.5 1.5 0 0 0 5 15.5h0.5"/>'),
    trash: svg('<path d="M4.5 7h15M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 7l0.8 11.5a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7M10 11v5M14 11v5"/>'),
    fit: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'),
  };

  // ---------------------------------------------------------------- the host
  let seq = 0;
  const waiting = new Map();
  const ask = (type, data) => new Promise((resolve) => { const id = "b" + ++seq; waiting.set(id, resolve); post(type, { ...data, id }); });
  B.answer = (id, ...a) => { const r = waiting.get(id); if (r) { waiting.delete(id); r(a); } };
  /* Which file a picture shows: its address without the host's part — the path the host knows it by. */
  function refOf(img) {
    if (img.dataset.board) return img.dataset.board;
    const base = String((window.MdHost || {}).files || ""), src = String(img.currentSrc || img.src || "").split(/[?#]/)[0];
    if (!base || !src.startsWith(base + "/")) return null;
    try { return decodeURIComponent(src.slice(base.length)); } catch (e) { return null; }
  }
  B.refOf = refOf;
  B.isBoard = (img) => !!img && img.tagName === "IMG" && (img.dataset.board ? true : B.format.isBoard(refOf(img)));
  async function read(ref, url) {
    if (kept.has(ref)) return kept.get(ref); // (as it was left here: the host's copy may be a moment behind)
    if ((window.MdHost || {}).reading) { // a shared note: the visitor's browser may fetch what the note shows, and nothing is asked of a host
      const res = await fetch(url);
      if (!res.ok) throw new Error("not found");
      return res.text();
    }
    const [text, error] = await ask("board-read", { path: ref });
    if (typeof text !== "string") throw new Error(error || "not found");
    return text;
  }

  // ---------------------------------------------------------------- pictures on a board
  const BROWSER = typeof (window.MdHost || {}).drop === "function"; // (a browser has the files themselves; the desktop's shell is told where they are)
  const fileUrl = (path) => String((window.MdHost || {}).files || "") + path.split("/").map(encodeURIComponent).join("/");
  const base64Of = (bytes) => { let bin = ""; for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000)); return btoa(bin); };
  const TYPE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "image/svg+xml": ".svg", "image/bmp": ".bmp" };
  /* Files the browser handed over: the pictures among them are kept beside the board, then put on it. */
  async function put(files, at = null) {
    const s = S, names = [];
    let failed = null;
    for (const f of files.filter((f) => f && typeof f.size === "number" && (f.name || TYPE_EXT[f.type]))) {
      const d = new Date(), two = (n) => String(n).padStart(2, "0");
      const name = f.name && !/^image\.[a-z]+$/i.test(f.name) ? f.name : `pasted-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}${TYPE_EXT[f.type]}`; // (a pasted picture is called "image.png" by every browser)
      const [got, error] = await ask("board-put", { path: s.ref, name, base64: base64Of(new Uint8Array(await f.arrayBuffer())) });
      if (error) failed = error; else names.push(...(got || []));
    }
    if (S === s) placed(names, failed, at);
  }
  /* Files kept beside the board, by their names: a picture on the board in its own size (no larger than fits well), any other file as a card. */
  async function placed(names, error, at = null) {
    const s = S;
    if (error) core.toast(T("board.noPicture"));
    const others = (names || []).filter((n) => !B.items.PICTURE.test(n));
    names = (names || []).filter((n) => B.items.PICTURE.test(n));
    if (others.length && S === s) { if (S.mode !== "select") setMode("select"); sel.cards(others.map((src) => ({ src })), at); save(); }
    const list = (await Promise.all((names || []).map((src) => new Promise((res) => { const i = new Image(); i.onload = () => res({ src, w: i.naturalWidth || 200, h: i.naturalHeight || 150 }); i.onerror = () => res({ src, w: 200, h: 150 }); i.src = fileUrl(s.ref.slice(0, s.ref.lastIndexOf("/") + 1) + src); })))).filter(Boolean);
    if (S !== s || !list.length) return;
    if (S.mode !== "select") setMode("select");
    sel.pictures(list, at);
    save(); // (at once: until the board's file names them, the pictures' files are nobody's)
  }
  /* Ctrl+V on the desktop: a picture on the clipboard is put on the board; else what was copied on the board is. */
  function pasteHere() {
    const s = S;
    ask("board-paste", { path: s.ref }).then(([names, error]) => { if (S !== s) return; if ((names || []).length || error) placed(names, error); else if (S.mode === "select") sel.paste(); });
  }
  function pasted(e) {
    if (!S || S.readonly || sel.editing || e.target.closest?.("input, textarea")) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    e.preventDefault(); e.stopPropagation();
    if (files.length) put(files); else if (S.mode === "select") sel.paste();
  }

  // ---------------------------------------------------------------- the picture in the note
  /* A board changed here is shown by its picture at once — from what was written, not from the
   * file (whose address is the same as before: the browser would show what it has). */
  const kept = new Map(), urls = new Map();
  let watch = null;
  function show(img) {
    const ref = refOf(img);
    if (!ref || !urls.has(ref) || img.src === urls.get(ref)) return;
    img.dataset.board = ref;
    img.src = urls.get(ref);
  }
  function remember(ref, text) {
    kept.set(ref, text);
    const old = urls.get(ref);
    urls.set(ref, URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })));
    for (const img of document.querySelectorAll("#content img, #active img")) { if (refOf(img) === ref) { img.dataset.board = ref; img.src = urls.get(ref); } }
    if (old) setTimeout(() => URL.revokeObjectURL(old), 5000);
    if (!watch) { // … and by every picture of it drawn later (the note read anew, a block rebuilt)
      watch = new MutationObserver((list) => {
        for (const m of list) for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === "IMG") show(node);
          else for (const img of node.querySelectorAll?.("img") || []) show(img);
        }
      });
      for (const root of document.querySelectorAll("#content, #active")) watch.observe(root, { childList: true, subtree: true });
    }
  }

  // ---------------------------------------------------------------- the window
  let el = null, S = null, hands = null, space = false, sel = null;
  const stage = () => el.querySelector(".bd-stage");
  const size = () => ({ w: el.clientWidth, h: el.clientHeight });
  const auto = () => getComputedStyle(el).getPropertyValue("--fg").trim() || "#1d1d1f";
  const button = (name, key, more = "") => `<button type="button" class="bd-btn" data-do="${name}" title="${esc(T(key))}" aria-label="${esc(T(key))}"${more}>${I[name] || ""}</button>`;
  const DRAWS = ["pen", "mono", "marker", "pencil"], ALL = [...DRAWS, "eraser", "lasso"];
  const RULER = { h: 64, grip: 80, near: 22 }; // the ruler on the screen: how broad, how much of each end turns it, how near its edge a stroke is taken along it
  /* A tool as it stands in the palette: a flat sign of the thing — a body, a band in its colour
   * (var(--band)), a tip. Drawn here; no picture of anyone's is used. */
  function toolSign(kind) {
    const body = 'fill="var(--bd-tool-body)" stroke="var(--bd-tool-line)"', shade = 'fill="var(--bd-tool-shade)"';
    const barrel = `<rect x="6" y="22" width="18" height="52" rx="3" ${body}/><rect x="6.5" y="22.5" width="5" height="51" ${shade} opacity="0.5"/>`, band = '<rect x="6" y="35" width="18" height="5" fill="var(--band)"/>';
    const tip = {
      pen: `<path d="M9 22 15 5l6 17z" ${shade} stroke="var(--bd-tool-line)"/><path d="M13 10.7 15 5l2 5.7z" fill="var(--band)"/>`,
      mono: `<path d="M11 22l2-9h4l2 9z" ${shade} stroke="var(--bd-tool-line)"/><rect x="14.2" y="4" width="1.6" height="9.5" rx="0.8" fill="var(--bd-tool-dark)"/>`,
      marker: `<path d="M9 22l1-9h10l1 9z" ${shade} stroke="var(--bd-tool-line)"/><path d="M11 13V7.5l8-3V13z" fill="var(--band)"/>`,
      pencil: `<path d="M8 22 15 4l7 18z" fill="#e8c9a0" stroke="var(--bd-tool-line)"/><path d="M13.2 8.7 15 4l1.8 4.7z" fill="var(--band)"/>`,
      eraser: `<rect x="7" y="7" width="16" height="16" rx="5" fill="var(--bd-tool-rubber)" stroke="var(--bd-tool-line)"/>`,
      lasso: `<ellipse cx="15" cy="12" rx="8.5" ry="6" fill="none" stroke="var(--bd-tool-dark)" stroke-width="1.7" stroke-dasharray="3 2.6"/>`,
    }[kind];
    return `<svg viewBox="0 0 30 72" aria-hidden="true">${barrel}${kind === "eraser" || kind === "lasso" ? "" : band}${tip}</svg>`;
  }
  function build() {
    el = document.createElement("section");
    el.id = "board";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML =
      `<div class="bd-stage"><div class="bd-world"></div><canvas class="bd-ink"></canvas><canvas class="bd-live"></canvas><div class="bd-ring" hidden></div><div class="bd-tip" hidden></div><div class="bd-ruler" hidden><span></span></div>` +
        `<div class="bd-band" hidden></div><div class="bd-guide bd-guide-v" hidden></div><div class="bd-guide bd-guide-h" hidden></div>` +
        `<div class="bd-pick" hidden>${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((c) => `<i class="bd-dot" data-dot="${c}"></i>`).join("")}<i class="bd-knob"></i><i class="bd-dot" data-dot="a"></i><i class="bd-dot" data-dot="b"></i>${["t", "r", "b", "l"].map((d) => `<i class="bd-conn" data-side="${d}"></i>`).join("")}</div><div class="bd-target" hidden></div><div class="bd-angle" hidden></div>` +
        `<div class="bd-sel" hidden>${["nw", "ne", "se", "sw"].map((c) => `<i class="bd-dot" data-corner="${c}"></i>`).join("")}</div></div>` +
      `<div class="bd-bar bd-selbar" role="toolbar" hidden>${button("copy", "board.duplicate")}${button("trash", "board.delete")}</div>` +
      `<div class="bd-bar bd-fbar" role="toolbar" hidden></div><div class="bd-fpop ui-menu ui-popover"></div>` +
      `<div class="bd-bar bd-insert" role="toolbar" aria-label="${esc(T("board.insert"))}">${button("textbox", "board.insert.text")}${button("shapes", "board.insert.shape")}${button("sticky", "board.insert.sticky")}${button("table", "board.insert.table")}${button("link", "board.insert.link")}</div>` +
      `<div class="bd-spop ui-menu ui-popover" role="menu" aria-label="${esc(T("board.insert.shape"))}">${B.items.SHAPES.map((k) => `<button type="button" class="bd-tile" data-shape="${k}" title="${esc(T("board.shape." + k))}" aria-label="${esc(T("board.shape." + k))}"><svg viewBox="-2 -2 32 32"><path d="${B.items.shapePath(k, 28, k === "rect" || k === "round" ? 20 : 28)}" transform="translate(0 ${k === "rect" || k === "round" ? 4 : 0})"/></svg></button>`).join("")}` +
        `<button type="button" class="bd-tile bd-tile-line" data-line="line" title="${esc(T("board.shape.line"))}" aria-label="${esc(T("board.shape.line"))}"><svg viewBox="0 0 28 28"><path d="M4 24 24 4"/></svg></button><button type="button" class="bd-tile bd-tile-line" data-line="arrow" title="${esc(T("board.shape.arrow"))}" aria-label="${esc(T("board.shape.arrow"))}"><svg viewBox="0 0 28 28"><path d="M4 24 24 4M14 4h10v10"/></svg></button></div>` +
      `<div class="bd-bar bd-title" role="toolbar">${button("back", "board.back")}<span class="bd-name"></span><span class="bd-chip" hidden></span></div>` +
      `<div class="bd-bar bd-actions" role="toolbar">${button("undo", "board.undo")}${button("redo", "board.redo")}<span class="bd-sep"></span>${button("more", "board.more")}</div>` +
      `<div class="bd-vpop ui-menu ui-popover" role="menu"></div>` +
      `<div class="bd-bar bd-palette" role="toolbar" aria-label="${esc(T("board.tools"))}">` +
        `<span role="radiogroup" class="bd-tools"><button type="button" class="bd-tool bd-pointer" role="radio" data-pointer="1" title="${esc(T("board.tool.select"))}" aria-label="${esc(T("board.tool.select"))}"><svg viewBox="0 0 30 72" aria-hidden="true"><path d="M9 8v24l6.2-5.6 4.3 9.6 3.6-1.6-4.3-9.5 8.2-0.5z" fill="var(--bd-tool-body)" stroke="var(--bd-tool-dark)" stroke-width="1.5" stroke-linejoin="round"/></svg></button>${ALL.map((t) => `<button type="button" class="bd-tool" role="radio" data-tool="${t}" title="${esc(T("board.tool." + t))}" aria-label="${esc(T("board.tool." + t))}">${toolSign(t)}</button>`).join("")}</span>` +
        `<button type="button" class="bd-tool bd-rule" data-ruler="1" aria-pressed="false" title="${esc(T("board.tool.ruler"))}" aria-label="${esc(T("board.tool.ruler"))}"><svg viewBox="0 0 30 72" aria-hidden="true"><rect x="6" y="6" width="18" height="68" rx="2" fill="var(--bd-tool-body)" stroke="var(--bd-tool-line)"/><path d="M6 14h7M6 22h4M6 30h7M6 38h4M6 46h7M6 54h4M6 62h7" stroke="var(--bd-tool-dark)"/></svg></button><span class="bd-sep"></span>` +
        `<span role="radiogroup" class="bd-wells" aria-label="${esc(T("board.color"))}">${INKS.map(([name, c]) => `<button type="button" class="bd-well" role="radio" data-ink="${c}" title="${esc(T("board.ink." + name))}" aria-label="${esc(T("board.ink." + name))}" style="--ink:${c === "auto" ? "var(--fg)" : c}"></button>`).join("")}` +
          `<label class="bd-well bd-any" title="${esc(T("board.ink.any"))}"><input type="color" aria-label="${esc(T("board.ink.any"))}"></label></span></div>` +
      `<div class="bd-pop ui-menu ui-popover" role="dialog" aria-label="${esc(T("board.options"))}"></div>` +
      `<div class="bd-bar bd-zoom" role="toolbar"><button type="button" class="bd-btn bd-wide" data-do="zoom" title="${esc(T("board.zoom"))}"></button>${button("fit", "board.fit")}<span class="bd-sep"></span>${button("prev", "board.scene.prev")}${button("scenes", "board.scenes")}${button("next", "board.scene.next")}</div>` +
      `<div class="bd-bar bd-viewbar" role="toolbar">${button("connect", "board.connect")}${button("grid", "board.grid")}</div>` +
      `<div class="bd-cpop ui-menu ui-popover" role="menu" aria-label="${esc(T("board.insert.shape"))}">${B.items.SHAPES.map((k) => `<button type="button" class="bd-tile" data-next="${k}" title="${esc(T("board.shape." + k))}" aria-label="${esc(T("board.shape." + k))}"><svg viewBox="-2 -2 32 32"><path d="${B.items.shapePath(k, 28, k === "rect" || k === "round" ? 20 : 28)}" transform="translate(0 ${k === "rect" || k === "round" ? 4 : 0})"/></svg></button>`).join("")}</div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !S) return;
      if (b.closest(".bd-fbar, .bd-fpop")) return void sel.click(b);
      if (b.closest(".bd-vpop")) return void picked(b);
      if (["zoom", "more", "scenes", "link"].includes(b.dataset.do)) return menu(b.dataset.do, b);
      if (b.dataset.do === "prev" || b.dataset.do === "next") return sceneStep(b.dataset.do === "next" ? 1 : -1);
      if (b.dataset.next) { delete el.querySelector(".bd-cpop").dataset.open; return void sel.connectTo(b.dataset.next); }
      if (b.dataset.do === "connect") { if (S.mode !== "select") setMode("select"); S.connect = !S.connect; return paint(); }
      if (b.dataset.shape || b.dataset.line) { shapes(false); setMode("select"); return void (b.dataset.shape ? sel.insert("shape", { shape: b.dataset.shape }) : sel.insert("line", { arrow: b.dataset.line === "arrow" })); }
      if (b.dataset.do === "draw") return setMode(S.mode === "draw" ? "select" : "draw");
      if (["textbox", "sticky", "table"].includes(b.dataset.do)) { setMode("select"); return void sel.insert(b.dataset.do === "textbox" ? "text" : b.dataset.do); }
      if (b.dataset.do === "shapes") return shapes();
      if (b.dataset.pointer) return setMode("select");
      if (b.dataset.ruler) return ruler();
      if (b.dataset.tool) return b.dataset.tool === S.tool && S.tool !== "lasso" ? options(b) : setTool(b.dataset.tool);
      if (b.dataset.ink) return setInk(b.dataset.ink);
      if (b.dataset.w) return setWidth(Number(b.dataset.w));
      if (b.dataset.mode) return setErase(b.dataset.mode);
      ({ back: () => B.close(), undo: () => step(-1), redo: () => step(1), fit: () => S.view.fit(bounds()), actual: () => { const s = size(); S.view.zoomAt(s.w / 2, s.h / 2, 1); },
        grid: () => { S.model.board.grid = !S.model.board.grid; changed(); paint(); }, copy: duplicate, trash: remove })[b.dataset.do]?.();
    });
    el.querySelector(".bd-any input").addEventListener("input", (e) => setInk(e.target.value));
    el.querySelector(".bd-pop").addEventListener("input", (e) => { if (S && e.target.matches("input[type=range]")) setOpacity(Number(e.target.value) / 100); });
    // the options shut when anything beside them is touched
    el.addEventListener("pointerdown", (e) => {
      if (popOpen() && !e.target.closest(".bd-pop, .bd-tool")) options(null);
      if (!e.target.closest('.bd-spop, [data-do="shapes"]')) shapes(false);
      if (!e.target.closest('.bd-vpop, [data-do="zoom"], [data-do="more"], [data-do="scenes"], [data-do="link"]')) menu(null);
      if (S && sel.pending && !e.target.closest(".bd-cpop")) { delete el.querySelector(".bd-cpop").dataset.open; sel.connectTo(null); } // (no shape chosen for a connector's end: it ends where it was let go)
      if (S && e.target.closest(".bd-bar") && !e.target.closest(".bd-fbar")) sel.finish(); // (a bar touched while text is typed: the text is done)
    }, true);
    // the palette, pulled by its bare parts: let go in the other half of the window, it lies at that edge from then on
    const pal = el.querySelector(".bd-palette");
    try { if (localStorage.getItem(KEEP + ":place") === "top") el.dataset.palette = "top"; } catch (e) { /* (not kept: at the foot) */ }
    pal.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button, label, input")) return;
      const y0 = e.clientY;
      try { pal.setPointerCapture(e.pointerId); } catch (x) { /* (a pointer made up by a test) */ }
      const moved = (m) => { pal.style.translate = `-50% ${m.clientY - y0}px`; pal.style.transition = "none"; };
      const up = (u) => {
        pal.removeEventListener("pointermove", moved); pal.removeEventListener("pointerup", up); pal.removeEventListener("pointercancel", up);
        pal.style.translate = pal.style.transition = "";
        const top = u.clientY - el.getBoundingClientRect().top < el.clientHeight / 2;
        if (u.type === "pointerup" && Math.abs(u.clientY - y0) > 24) { if (top) el.dataset.palette = "top"; else delete el.dataset.palette; try { localStorage.setItem(KEEP + ":place", top ? "top" : "bottom"); } catch (x) { /* (as above) */ } options(null); }
      };
      pal.addEventListener("pointermove", moved); pal.addEventListener("pointerup", up); pal.addEventListener("pointercancel", up);
    });
    // text in the board's picture breaks where it breaks on the screen: measured with the same letters
    const meter = document.createElement("canvas").getContext("2d");
    B.items.measure = (text, font) => { meter.font = font; return meter.measureText(text).width; };
    sel = B.select.make({ S: () => S, el: () => el, paint, did, changed, size, onBoard: (pt) => onBoard(pt), T, esc, icons: I, copied: (text) => core.copy(text),
      // a card's file or address, opened: by the host, as a link in a note is (a file in the program for its kind, an address in the browser)
      // (said to the host itself, the board kept first: said the page's own way, a link followed counts as leaving the note, which shuts the board)
      open: (it) => { if (!it || (it.k !== "link" && it.k !== "file")) return; save(); window.MdHost.post(JSON.stringify({ type: "link", href: it.k === "link" ? it.url : fileUrl(S.ref.slice(0, S.ref.lastIndexOf("/") + 1) + it.src), tab: "own" })); },
      // a connector let go over the bare board: which shape is to stand at its end? (at: on the screen)
      ask: (at) => { const p = el.querySelector(".bd-cpop"), s = size(); p.style.left = Math.round(Math.max(8, Math.min(s.w - p.offsetWidth - 8, at[0] + 10))) + "px"; p.style.top = Math.round(Math.max(56, Math.min(s.h - p.offsetHeight - 8, at[1] - p.offsetHeight / 2))) + "px"; p.dataset.open = ""; } });
    // a picture's small copy for the board's own picture was made after the board was last kept without it: kept again, with it
    B.layer.onsmall = (src) => { if (S && !S.readonly && S.lacked && S.lacked.has(src)) changed(); };
    B.layer.url = (src) => (S ? fileUrl(S.ref.slice(0, S.ref.lastIndexOf("/") + 1) + src) : "");
    // pictures dropped on the board, or pasted (in a browser the paste itself holds them)
    el.addEventListener("dragover", (e) => { if (S && !S.readonly && [...(e.dataTransfer?.types || [])].some((t) => t === "Files" || t === "text/uri-list")) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; } }, true);
    el.addEventListener("drop", (e) => {
      if (!S || S.readonly) return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect(), at = S.view.toBoard(e.clientX - r.left, e.clientY - r.top);
      if (BROWSER) return void put([...(e.dataTransfer?.files || [])], at);
      const uris = (e.dataTransfer?.getData("text/uri-list") || "").split(/\r?\n/).filter((u) => u && !u.startsWith("#"));
      if (uris.length) ask("board-drop", { path: S.ref, uris }).then(([names, error]) => placed(names, error, at));
    }, true);
    new ResizeObserver(() => { if (S) paint(); }).observe(el);
    const mine = () => S && S.mode === "select" && !S.readonly;
    const begun = (pt, e) => {
      if (!S || S.readonly) return mine() ? sel.start(pt, e) : start(pt);
      if (pt.type === "pen" && !pens.seen) { pens.seen = true; keepPens(); }
      // The pen draws wherever it comes down, whatever tool was in hand — unless it is set to choose and scroll as a finger does.
      if (pt.type === "pen" && S.mode === "select" && !pens.selects) setTool(DRAWS.includes(S.tool) || S.tool === "eraser" ? S.tool : "pen");
      // Where a pen is in use a finger does not draw (it is the other hand, or the palm): it moves the board — unless Draw with Finger is on.
      if (pt.type === "touch" && S.mode === "draw" && pens.seen && !pens.finger) return "pan";
      return mine() ? sel.start(pt, e) : start(pt);
    };
    hands = B.pointer.attach(stage(), { start: begun, move: (pts, e, ahead) => (sel.busy ? sel.move(pts, e) : move(pts, e, ahead)), end: () => (sel.busy ? sel.end() : end()), cancel: () => (sel.busy ? sel.cancel() : cancel()), hover, space: () => space,
      hold: (pt, e) => (mine() ? sel.hold(pt, e) : false), twist: (points) => mine() && sel.twist(points), twisting: (deg) => sel.twisting(deg), twisted: () => sel.twisted(),
      pan: (dx, dy) => S && S.view.panBy(dx, dy),
      zoom: (f, cx, cy) => S && S.view.zoomAt(cx, cy, S.view.z * f) });
  }
  function boundsOf(items) {
    let b = null;
    for (const it of items) {
      const c = B.format.boundsOf(it);
      if (c) b = b ? [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[2]), Math.max(b[3], c[3])] : [...c];
    }
    return b;
  }
  const bounds = () => boundsOf(S.model.items);
  /* Where the chosen strokes are on the screen: [left, top, width, height], a little around them. */
  function selRect() {
    const b = S.sel.length ? boundsOf(S.sel) : null, v = S.view, pad = 6;
    return b ? [(b[0] - v.x) * v.z - pad, (b[1] - v.y) * v.z - pad, (b[2] - b[0]) * v.z + 2 * pad, (b[3] - b[1]) * v.z + 2 * pad] : null;
  }
  /* Everything the window shows, from what is so. */
  function paint() {
    if (!S) return;
    const v = S.view, st = stage(), s = size();
    B.ink.draw(el.querySelector(".bd-ink"), S.model.items, v, s, auto(), null);
    B.items.relink(S.model.items); // (lines joined to items: their ends where the items are now)
    el.querySelector('[data-do="connect"]').setAttribute("aria-pressed", String(!!S.connect && S.mode === "select"));
    const world = el.querySelector(".bd-world");
    world.style.transform = `translate(${-v.x * v.z}px, ${-v.y * v.z}px) scale(${v.z})`;
    B.layer.sync(world, S.model.items, sel.editing, sel.cell);
    el.dataset.mode = S.readonly ? "look" : S.mode;
    sel.paint();
    // the dots: every 20 of the board's pixels; fewer of them the smaller the board is shown, so they never crowd
    const every = v.z < 0.25 ? 4 : v.z < 0.5 ? 2 : 1, gap = 20 * every * v.z;
    st.toggleAttribute("data-grid", S.model.board.grid);
    st.style.backgroundSize = `${gap}px ${gap}px`;
    st.style.backgroundPosition = `${-v.x * v.z - gap / 2}px ${-v.y * v.z - gap / 2}px`;
    el.querySelector('[data-do="zoom"]').textContent = Math.round(v.z * 100) + " %";
    const scenes = S.model.scenes.length;
    for (const d of ["prev", "next"]) el.querySelector(`[data-do="${d}"]`).hidden = !scenes;
    el.querySelector('[data-do="grid"]').setAttribute("aria-pressed", String(S.model.board.grid));
    el.querySelector('[data-do="undo"]').disabled = !S.undo.length;
    el.querySelector('[data-do="redo"]').disabled = !S.redo.length;
    const strokes = S.sel.length ? S.sel : S.mode === "select" ? S.pick.filter((it) => it.k === "ink") : []; // the strokes chosen: by the lasso, or with the pointer
    const set = S.mode === "draw" ? S.tools[S.tool] || {} : {}, shown = strokes.length ? (strokes.every((it) => it.c === strokes[0].c) ? strokes[0].c : null) : set.c;
    el.querySelector("[data-pointer]").setAttribute("aria-checked", String(S.mode === "select"));
    for (const b of el.querySelectorAll("[data-tool]")) {
      b.setAttribute("aria-checked", String(S.mode === "draw" && b.dataset.tool === S.tool));
      const c = (S.tools[b.dataset.tool] || {}).c;
      b.style.setProperty("--band", !c || c === "auto" ? "var(--fg)" : c);
    }
    let known = false;
    for (const b of el.querySelectorAll("[data-ink]")) { const on = b.dataset.ink === shown; known = known || on; b.setAttribute("aria-checked", String(on)); }
    el.querySelector(".bd-any").toggleAttribute("data-on", !!shown && !known);
    el.querySelector(".bd-wells").toggleAttribute("data-off", !strokes.length && !(S.mode === "draw" && DRAWS.includes(S.tool))); // (an eraser has no colour, nor has the pointer with no stroke chosen)
    st.dataset.tool = S.readonly ? "look" : S.mode === "select" ? "select" : S.tool;
    const rule = el.querySelector(".bd-ruler"), ruled = !!S.ruler && S.mode === "draw" && !S.readonly;
    rule.hidden = !ruled;
    el.querySelector("[data-ruler]").setAttribute("aria-pressed", String(!!S.ruler));
    if (ruled) {
      const L = rulerLen(), cx = (S.ruler.x - v.x) * v.z, cy = (S.ruler.y - v.y) * v.z;
      rule.style.cssText = `width:${L}px;height:${RULER.h}px;transform:translate(${cx - L / 2}px, ${cy - RULER.h / 2}px) rotate(${S.ruler.a}deg)`;
      rule.firstChild.textContent = Math.round(((S.ruler.a % 180) + 180) % 180) + "°";
    }
    const ring = el.querySelector(".bd-ring"), d = S.tools.eraser.w;
    ring.style.width = ring.style.height = d + "px";
    if (S.tool !== "eraser") ring.hidden = true;
    // the chosen strokes: their frame, and what can be done with them beside it
    const r = selRect(), frame = el.querySelector(".bd-sel"), bar = el.querySelector(".bd-selbar");
    frame.hidden = bar.hidden = !r;
    if (r) {
      frame.style.transform = `translate(${r[0]}px, ${r[1]}px)`;
      frame.style.width = r[2] + "px"; frame.style.height = r[3] + "px";
      const below = r[1] + r[3] + 12 + 40 < s.h - 90, bw = bar.offsetWidth || 72;
      bar.style.transform = `translate(${Math.max(8, Math.min(s.w - bw - 8, r[0] + r[2] / 2 - bw / 2))}px, ${below ? r[1] + r[3] + 12 : Math.max(60, r[1] - 12 - 36)}px)`;
      bar.toggleAttribute("data-moving", !!(S.act && S.act.grab));
    }
  }
  /* ahead: points the stroke is expected to reach next — drawn with it, not part of it. */
  function live(item, loop = null, ahead = null) {
    if (item && ahead && ahead.length) item = { ...item, pts: [...item.pts, ...ahead], path: null, box: null };
    const c = el.querySelector(".bd-live"), s = size(), dpr = window.devicePixelRatio || 1, ctx = c.getContext("2d"), v = S.view;
    if (c.width !== Math.round(s.w * dpr) || c.height !== Math.round(s.h * dpr)) { c.width = Math.round(s.w * dpr); c.height = Math.round(s.h * dpr); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    if (!item && !loop) return;
    const k = dpr * v.z;
    ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
    if (item) B.ink.trace(ctx, item, auto());
    ctx.globalAlpha = 1;
    if (loop && loop.length > 1) { // the lasso's line: dashes of one size on the screen, whatever the zoom
      ctx.beginPath();
      ctx.moveTo(loop[0][0], loop[0][1]);
      for (const p of loop) ctx.lineTo(p[0], p[1]);
      ctx.setLineDash([5 / v.z, 4 / v.z]);
      ctx.lineWidth = 1.5 / v.z;
      ctx.strokeStyle = getComputedStyle(el).getPropertyValue("--accent").trim() || auto();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ---------------------------------------------------------------- the ruler
  /* A ruler lies on the board while it is wanted: a stroke begun at one of its long edges runs
   * straight along it. It is moved by its middle and turned by its ends (Shift: in steps of 15°). */
  const rulerLen = () => Math.min(900, Math.max(320, size().w * 0.7));
  function ruler(on = !S.ruler) {
    if (S.readonly) return;
    if (on && S.mode !== "draw") setTool(DRAWS.includes(S.tool) ? S.tool : "pen");
    const s = size(), [x, y] = S.view.toBoard(s.w / 2, s.h / 2);
    S.ruler = on ? { x, y, a: 0 } : null;
    paint();
  }
  /* A point of the screen in the ruler's own frame: along it and across it, from its middle. */
  function onRuler(pt) {
    const v = S.view, r = S.ruler, dx = pt.x - (r.x - v.x) * v.z, dy = pt.y - (r.y - v.y) * v.z, a = (-r.a * Math.PI) / 180;
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  }
  /* The edge of the ruler a stroke begun at pt runs along: { x, y, ux, uy } on the board (a point of it and its direction); null: none near. */
  function rulerEdge(pt) {
    if (!S.ruler) return null;
    const [lx, ly] = onRuler(pt), half = RULER.h / 2, off = Math.abs(ly) - half;
    if (Math.abs(lx) > rulerLen() / 2 || off < 0 || off > RULER.near) return null;
    const a = (S.ruler.a * Math.PI) / 180, side = Math.sign(ly) * half / S.view.z;
    return { x: S.ruler.x - Math.sin(a) * side, y: S.ruler.y + Math.cos(a) * side, ux: Math.cos(a), uy: Math.sin(a) };
  }
  const along = (edge, p) => { const t = (p.x - edge.x) * edge.ux + (p.y - edge.y) * edge.uy; return { ...p, x: edge.x + t * edge.ux, y: edge.y + t * edge.uy }; };

  // ---------------------------------------------------------------- tools and what they are set to
  /* How this device's pen is used (kept in this browser): whether one was ever seen here, whether a finger draws beside it,
   * whether it chooses and scrolls with the pointer in hand instead of drawing everywhere. */
  const pens = { seen: false, finger: false, selects: false };
  try { Object.assign(pens, JSON.parse(localStorage.getItem("mdview:board-pen") || "{}")); } catch (e) { /* (as new) */ }
  const keepPens = () => { try { localStorage.setItem("mdview:board-pen", JSON.stringify(pens)); } catch (e) { /* (not kept) */ } };
  const KEEP = "mdview:board-tools"; // (in this browser, for this person: the next board begins with the same pen)
  function toolsNow() {
    const t = JSON.parse(JSON.stringify(B.ink.TOOLS));
    try {
      const was = JSON.parse(localStorage.getItem(KEEP) || "{}");
      for (const k of Object.keys(t)) for (const f of ["c", "w", "o", "mode"]) if (was[k] && typeof was[k][f] === typeof t[k][f] && f in t[k]) t[k][f] = was[k][f];
    } catch (e) { /* (nothing kept, or not allowed to keep: as new) */ }
    return t;
  }
  function keepTools() {
    try { localStorage.setItem(KEEP, JSON.stringify(Object.fromEntries(Object.entries(S.tools).map(([k, v]) => [k, { c: v.c, w: v.w, o: v.o, mode: v.mode }])))); } catch (e) { /* (as above) */ }
  }
  const popOpen = () => el.querySelector(".bd-pop").hasAttribute("data-open");
  /* The drawing tools in hand (draw), or put away: the pointer chooses and moves what stands on the board (select). */
  function setMode(m) {
    if (S.readonly || S.mode === m) return;
    options(null);
    sel.finish(); sel.closePop();
    S.sel = []; S.pick = [];
    S.mode = m;
    paint();
  }
  function shapes(on = !el.querySelector(".bd-spop").hasAttribute("data-open")) {
    const p = el.querySelector(".bd-spop");
    if (!on) { delete p.dataset.open; return; }
    const r = el.querySelector('[data-do="shapes"]').getBoundingClientRect(), box = el.getBoundingClientRect();
    p.style.left = Math.round(Math.max(8, Math.min(box.width - p.offsetWidth - 8, r.left - box.left + r.width / 2 - p.offsetWidth / 2))) + "px";
    p.style.top = Math.round(r.bottom - box.top + 8) + "px";
    p.dataset.open = "";
  }
  function setTool(t) {
    if (!ALL.includes(t) || S.readonly) return;
    options(null);
    if (S.mode !== "draw") { sel.finish(); sel.closePop(); S.pick = []; S.mode = "draw"; }
    if (t !== "lasso") S.sel = [];
    S.tool = t;
    paint();
  }
  /* A colour chosen: the chosen strokes take it; else the tool does (an eraser or a lasso in hand: the pen is taken up). */
  function setInk(c) {
    const strokes = S.sel.length ? S.sel : S.mode === "select" ? S.pick.filter((it) => it.k === "ink") : [];
    if (S.mode === "select" && !strokes.length) return; // (the pointer in hand and no stroke chosen: a colour has nothing to colour)
    if (strokes.length) {
      const was = strokes.map((it) => [it, it.c]);
      const to = (list) => { for (const [it, col] of list) { it.c = col; it.path = null; } };
      to(was.map(([it]) => [it, c]));
      did({ undo: () => to(was), redo: () => to(was.map(([it]) => [it, c])) });
      return paint();
    }
    if (!DRAWS.includes(S.tool)) S.tool = "pen";
    S.tools[S.tool].c = c;
    keepTools();
    paint();
  }
  function setWidth(w) { S.tools[S.tool].w = w; keepTools(); options(el.querySelector(`[data-tool="${S.tool}"]`), true); paint(); }
  function setOpacity(o) { S.tools[S.tool].o = Math.max(0.1, Math.min(1, o)); keepTools(); const out = el.querySelector(".bd-pop output"); if (out) out.textContent = Math.round(S.tools[S.tool].o * 100) + " %"; }
  function setErase(m) { S.tools.eraser.mode = m === "pixel" ? "pixel" : "object"; keepTools(); options(el.querySelector('[data-tool="eraser"]'), true); }
  /* The chosen tool's options, over it: how wide, how see-through; for the eraser what it takes. anchor null: shut. */
  function options(anchor, again = false) {
    const pop = el.querySelector(".bd-pop");
    if (!anchor || (popOpen() && !again)) { delete pop.dataset.open; return; }
    const t = S.tool, set = S.tools[t], most = Math.max(...B.ink.TOOLS[t].widths);
    const widths = `<div class="bd-widths" role="radiogroup" aria-label="${esc(T("board.width"))}">${B.ink.TOOLS[t].widths.map((w) => `<button type="button" class="bd-width" role="radio" data-w="${w}" aria-checked="${w === set.w}" aria-label="${w}"><i style="width:${Math.max(3, Math.round((w / most) * 22))}px;height:${Math.max(3, Math.round((w / most) * 22))}px"></i></button>`).join("")}</div>`;
    pop.innerHTML = t === "eraser"
      ? `<div class="bd-seg" role="radiogroup">${["object", "pixel"].map((m) => `<button type="button" role="radio" data-mode="${m}" aria-checked="${set.mode === m}">${esc(T("board.eraser." + m))}</button>`).join("")}</div>${widths}`
      : `${widths}<label class="bd-opacity"><span>${esc(T("board.opacity"))}</span><input type="range" min="10" max="100" step="1" value="${Math.round(set.o * 100)}"><output>${Math.round(set.o * 100)} %</output></label>`;
    const r = anchor.getBoundingClientRect(), box = el.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(box.width - pop.offsetWidth - 8, r.left - box.left + r.width / 2 - pop.offsetWidth / 2)) + "px";
    const pr = el.querySelector(".bd-palette").getBoundingClientRect(), under = el.dataset.palette === "top"; // (the palette at the top: its options open under it)
    pop.style.bottom = under ? "auto" : box.bottom - pr.top + 10 + "px";
    pop.style.top = under ? pr.bottom - box.top + 10 + "px" : "auto";
    pop.style.setProperty("--origin", under ? "top center" : "bottom center");
    pop.dataset.open = "";
  }

  // ---------------------------------------------------------------- the small menus: how large, the scenes, what else
  const vpop = () => el.querySelector(".bd-vpop");
  /* kind null: shut. A menu open for the same button shuts. */
  function menu(kind, anchor = null, again = false) {
    const p = vpop();
    if (!kind || (!again && p.dataset.open != null && p.dataset.kind === kind)) { delete p.dataset.open; p.dataset.kind = ""; return; }
    const row = (attr, label, on = false, more = "") => `<button type="button" ${attr} role="menuitem"${on ? ' aria-checked="true"' : ""}${more}>${esc(label)}</button>`;
    let html = "";
    if (kind === "zoom") html = `<div class="bd-list">${B.view.STEPS.map((z) => row(`data-zoom="${z}"`, Math.round(z * 100) + " %", Math.abs(S.view.z - z) < 0.005)).join("")}<hr>${row('data-m="fit"', T("board.fit"))}${row('data-m="actual"', T("board.actual"))}</div>`;
    else if (kind === "more") html = `<div class="bd-list">${row('data-m="copy"', T("board.copyPicture"))}${row('data-m="print"', T("board.print"))}${S.readonly ? "" : "<hr>" + row('data-m="snap"', T("board.snap"), !!S.model.board.snap) + (pens.seen ? "<hr>" + row('data-m="finger"', T("board.pen.finger"), pens.finger) + row('data-m="selects"', T("board.pen.selects"), pens.selects) : "")}</div>`;
    else if (kind === "scenes") {
      html = (S.model.scenes.length ? `<div class="bd-scenes">${S.model.scenes.map((sc, i) => `<div class="bd-scene"${i === S.scene ? " data-now" : ""}><button type="button" class="bd-scene-go" data-scene="${sc.id}">${esc(sc.name || T("board.scene"))}</button>` +
          (S.readonly ? "" : `<button type="button" class="bd-btn" data-scene-name="${sc.id}" title="${esc(T("board.scene.rename"))}" aria-label="${esc(T("board.scene.rename"))}">${I.rename}</button><button type="button" class="bd-btn" data-scene-set="${sc.id}" title="${esc(T("board.scene.replace"))}" aria-label="${esc(T("board.scene.replace"))}">${I.frame}</button><button type="button" class="bd-btn" data-scene-del="${sc.id}" title="${esc(T("board.delete"))}" aria-label="${esc(T("board.delete"))}">${I.trash}</button>`) + `</div>`).join("")}</div>`
        : `<p class="bd-hint">${esc(T("board.scene.none"))}</p>`) + (S.readonly ? "" : `<button type="button" class="bd-wide-btn" data-m="scene-add">${esc(T("board.scene.add"))}</button>`);
    }
    else if (kind === "link") html = `<input type="text" class="bd-scene-input bd-link-input" placeholder="https://" aria-label="${esc(T("board.insert.link"))}" spellcheck="false"><button type="button" class="bd-wide-btn" data-m="link-add">${esc(T("board.link.add"))}</button>`;
    p.innerHTML = html;
    p.dataset.kind = kind;
    if (kind === "link") { const input = p.querySelector("input"); setTimeout(() => input.focus(), 0); input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") linkAdd(); else if (e.key === "Escape") menu(null); }); }
    const a = anchor || el.querySelector(`[data-do="${kind}"]`), r = a.getBoundingClientRect(), box = el.getBoundingClientRect(), up = r.top > box.height / 2;
    p.style.left = Math.round(Math.max(8, Math.min(box.width - p.offsetWidth - 8, r.left - box.left + r.width / 2 - p.offsetWidth / 2))) + "px";
    p.style.top = up ? "auto" : Math.round(r.bottom - box.top + 10) + "px";
    p.style.bottom = up ? Math.round(box.bottom - r.top + 10) + "px" : "auto";
    p.style.setProperty("--origin", up ? "bottom center" : "top center");
    p.dataset.open = "";
  }
  /* A click in one of those menus. */
  function picked(b) {
    const d = b.dataset, s = size();
    if (d.zoom) { S.view.zoomAt(s.w / 2, s.h / 2, Number(d.zoom)); return menu(null); }
    if (d.scene) { sceneGo(S.model.scenes.findIndex((x) => x.id === d.scene)); return menu(null); }
    if (d.sceneName) return sceneName(d.sceneName, b);
    if (d.sceneSet) return scenesDo(() => { const sc = S.model.scenes.find((x) => x.id === d.sceneSet); if (sc) sc.view = sceneNow(); });
    if (d.sceneDel) return scenesDo(() => { S.model.scenes = S.model.scenes.filter((x) => x.id !== d.sceneDel); S.scene = -1; });
    if (d.m === "scene-add") return scenesDo(() => { S.model.scenes.push({ id: B.format.id(), name: T("board.scene.n", S.model.scenes.length + 1), view: sceneNow() }); S.scene = S.model.scenes.length - 1; });
    if (d.m === "link-add") return linkAdd();
    if (d.m === "fit") { S.view.fit(bounds()); return menu(null); }
    if (d.m === "actual") { S.view.zoomAt(s.w / 2, s.h / 2, 1); return menu(null); }
    if (d.m === "snap") { S.model.board.snap = !S.model.board.snap; changed(); return menu("more", null, true); }
    if (d.m === "finger" || d.m === "selects") { pens[d.m] = !pens[d.m]; keepPens(); return menu("more", null, true); }
    if (d.m === "copy") { menu(null); return copyPicture(); }
    if (d.m === "print") { menu(null); return printBoard(); }
  }

  /* The address typed into the link's small window, as a card on the board. ("example.org" is taken for https://example.org.) */
  function linkAdd() {
    const input = vpop().querySelector(".bd-link-input"), typed = (input ? input.value : "").trim(), url = /^https?:\/\//i.test(typed) ? typed : typed && /^[^\s/]+\.[^\s]+$/.test(typed) ? "https://" + typed : "";
    if (!url) { if (input) { input.focus(); input.classList.remove("bd-shake"); void input.offsetWidth; input.classList.add("bd-shake"); } return; }
    if (S.mode !== "select") setMode("select");
    if (sel.cards([{ url }]) === false) { input.classList.remove("bd-shake"); void input.offsetWidth; input.classList.add("bd-shake"); return; }
    menu(null);
  }

  // ---------------------------------------------------------------- scenes: parts of the board under a name
  const sceneNow = () => { const s = size(), v = S.view; return [Math.round(v.x), Math.round(v.y), Math.round(s.w / v.z), Math.round(s.h / v.z)]; };
  const sceneCopy = (list) => list.map((sc) => ({ ...sc, view: [...sc.view] }));
  function scenesDo(f) {
    const before = sceneCopy(S.model.scenes);
    f();
    const after = sceneCopy(S.model.scenes);
    did({ undo: () => { S.model.scenes = sceneCopy(before); }, redo: () => { S.model.scenes = sceneCopy(after); } });
    paint();
    menu("scenes", null, true);
  }
  /* The view goes to a scene: as large as it was framed, in the middle of the window whatever its shape. */
  function sceneGo(i) {
    const sc = S.model.scenes[i];
    if (!sc) return;
    S.scene = i;
    S.view.fit([sc.view[0], sc.view[1], sc.view[0] + sc.view[2], sc.view[1] + sc.view[3]], 0, B.view.MAX);
  }
  function sceneStep(dir) { const n = S.model.scenes.length; if (n) sceneGo(((S.scene < 0 ? (dir > 0 ? -1 : 0) : S.scene) + dir + n) % n); }
  /* A scene's name, typed where it stands in the list. */
  function sceneName(id, b) {
    const sc = S.model.scenes.find((x) => x.id === id), go = b.parentNode.querySelector(".bd-scene-go");
    if (!sc || !go) return;
    const input = document.createElement("input");
    input.type = "text"; input.className = "bd-scene-input"; input.value = sc.name; input.maxLength = 200;
    go.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const end = (keep) => { if (done) return; done = true; const name = input.value.trim(); if (keep && name && name !== sc.name) scenesDo(() => { sc.name = name; }); else menu("scenes", null, true); };
    input.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") end(true); else if (e.key === "Escape") end(false); });
    input.addEventListener("blur", () => end(true));
  }

  // ---------------------------------------------------------------- the board as a picture for elsewhere
  const pictureNow = () => { B.items.missing.clear(); return B.format.write(S.model); };
  /* On the clipboard as a picture. The desktop's shell copies the board's file (it is a picture); a browser draws it and hands over a PNG. */
  async function copyPicture() {
    save();
    if (!BROWSER) return post("copyimage", { src: fileUrl(S.ref) });
    try {
      const url = URL.createObjectURL(new Blob([pictureNow()], { type: "image/svg+xml" })), img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const c = document.createElement("canvas"), k = Math.min(2, 8000 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await new Promise((res) => c.toBlob(res, "image/png")) })]);
      core.toast(T("board.copied"));
    } catch (e) { core.toast(T("board.notCopied")); }
  }
  /* Printed (or kept as a PDF, from the system's print window): the board's picture alone on the page (board.css). */
  function printBoard() {
    save();
    document.getElementById("board-print")?.remove();
    const img = document.createElement("img"), url = URL.createObjectURL(new Blob([pictureNow()], { type: "image/svg+xml" }));
    img.id = "board-print"; img.alt = "";
    const clear = () => { delete document.body.dataset.boardPrint; img.remove(); URL.revokeObjectURL(url); removeEventListener("afterprint", clear); };
    img.onload = () => { document.body.dataset.boardPrint = ""; addEventListener("afterprint", clear); setTimeout(clear, 300000); window.MdHost.post(JSON.stringify({ type: "print" })); }; // (said to the host itself: the page's own way of saying it would take the note for left, and shut the board)
    img.onerror = clear;
    img.src = url;
    document.body.appendChild(img);
  }

  // ---------------------------------------------------------------- changes, and taking them back
  function changed() {
    S.dirty = true;
    clearTimeout(S.timer);
    S.timer = setTimeout(save, SAVE_MS);
  }
  function did(act) { // act: { undo(), redo() } — already done once
    S.undo.push(act);
    S.redo.length = 0;
    changed();
  }
  /* What the board holds was put together anew (an eraser went through it, strokes were taken or added): before → now. */
  function replaced(before, sel = null) {
    const now = [...S.model.items], selNow = [...S.sel], selWas = sel || [];
    did({ undo: () => { S.model.items = [...before]; S.sel = selWas.filter((it) => before.includes(it)); }, redo: () => { S.model.items = [...now]; S.sel = selNow.filter((it) => now.includes(it)); } });
  }
  function step(dir) {
    const from = dir < 0 ? S.undo : S.redo, to = dir < 0 ? S.redo : S.undo, act = from.pop();
    if (!act) return;
    (dir < 0 ? act.undo : act.redo)();
    S.sel = S.sel.filter((it) => S.model.items.includes(it));
    S.pick = S.pick.filter((it) => S.model.items.includes(it));
    to.push(act);
    changed();
    paint();
  }
  function save() {
    if (!S || !S.dirty || S.readonly) return;
    clearTimeout(S.timer);
    S.dirty = false;
    const s = S, v = s.view;
    s.model.board.view = { x: v.x, y: v.y, z: v.z };
    B.items.missing.clear();
    const text = B.format.write(s.model);
    s.lacked = new Set(B.items.missing); // (pictures whose small copies were not made yet: the board is kept again when they are)
    remember(s.ref, text);
    ask("board-save", { path: s.ref, text }).then(([error]) => {
      if (S !== s) { if (error) core.toast(T("board.notSaved")); return; }
      chip(error ? T("board.notSaved") : s.model.lost ? T("board.lost", s.model.lost) : "", !!error);
      if (error) s.failed = text;
    });
  }
  function chip(text, bad = false) {
    const c = el.querySelector(".bd-chip");
    c.textContent = text;
    c.hidden = !text;
    c.toggleAttribute("data-bad", bad);
  }
  function duplicate() {
    if (!S.sel.length) return;
    const before = [...S.model.items], was = [...S.sel];
    const copies = S.sel.map((it) => { const c = { ...it, id: B.format.id(), pts: it.pts.map((p) => [...p]), path: null, box: null }; B.ink.moved(c, (p) => [p[0] + 16, p[1] + 16]); return c; });
    S.model.items.push(...copies);
    S.sel = copies;
    replaced(before, was);
    paint();
  }
  function remove() {
    if (!S.sel.length) return;
    const before = [...S.model.items], was = [...S.sel], gone = new Set(S.sel);
    S.model.items = S.model.items.filter((it) => !gone.has(it));
    S.sel = [];
    replaced(before, was);
    paint();
  }

  // ---------------------------------------------------------------- the hand
  const HOLD_MS = 500, STILL = 4; // a hand resting this long, within this many pixels: the stroke is made clean
  const onBoard = (pt) => { const [x, y] = S.view.toBoard(pt.x, pt.y); return { ...pt, x, y }; };
  function start(pt) {
    if (!S || S.readonly) return false;
    options(null);
    if (S.ruler) { // on the ruler itself: it is moved, or turned by an end
      const [lx, ly] = onRuler(pt), L = rulerLen();
      if (Math.abs(lx) <= L / 2 && Math.abs(ly) <= RULER.h / 2) { S.act = { rule: Math.abs(lx) > L / 2 - RULER.grip ? "turn" : "move", at: onBoard(pt), flip: lx < 0 }; return true; }
    }
    if (S.tool === "eraser") { S.act = { erase: true, before: [...S.model.items], at: pt }; erase(pt); return true; }
    if (S.tool === "lasso") return grab(pt);
    const edge = rulerEdge(pt), first = edge ? along(edge, onBoard(pt)) : onBoard(pt);
    S.act = { stroke: B.ink.begin(S.tool, S.tools[S.tool], first, S.view.z), still: pt, edge, touch: pt.type === "touch" };
    live(S.act.stroke.item);
    el.querySelector(".bd-tip").hidden = true;
    bars(true);
    return true;
  }
  /* The lasso put down: on a corner of the chosen strokes' frame (they are pulled larger or
   * smaller), inside it (they are moved), on a stroke (it is chosen, and moved if the hand goes
   * on), else on the bare board: a loop begins. */
  function grab(pt) {
    const p = onBoard(pt), r = selRect();
    if (r) {
      const corner = [["nw", r[0], r[1]], ["ne", r[0] + r[2], r[1]], ["se", r[0] + r[2], r[1] + r[3]], ["sw", r[0], r[1] + r[3]]].find(([, x, y]) => Math.hypot(pt.x - x, pt.y - y) <= 14);
      const b = boundsOf(S.sel);
      if (corner) {
        const anchor = { nw: [b[2], b[3]], ne: [b[0], b[3]], se: [b[0], b[1]], sw: [b[2], b[1]] }[corner[0]];
        S.act = { grab: "size", anchor, from: Math.hypot(p.x - anchor[0], p.y - anchor[1]) || 1, was: S.sel.map((it) => ({ it, pts: it.pts, w: it.w })) };
        return true;
      }
      if (pt.x >= r[0] && pt.x <= r[0] + r[2] && pt.y >= r[1] && pt.y <= r[1] + r[3]) return held(p);
    }
    const hit = B.ink.touched(S.model.items, p.x, p.y, 6 / S.view.z);
    if (hit.length) { S.sel = [hit[hit.length - 1]]; paint(); return held(p); }
    S.act = { loop: [[p.x, p.y]], was: [...S.sel] };
    return true;
  }
  function held(p) {
    S.act = { grab: "move", at: [p.x, p.y], first: [p.x, p.y], was: S.sel.map((it) => ({ it, pts: it.pts, w: it.w })) };
    return true;
  }
  function move(pts, e, ahead = []) {
    if (!S || !S.act) return;
    const act = S.act, lastPt = pts[pts.length - 1];
    if (act.rule) {
      const p = onBoard(lastPt);
      if (act.rule === "move") { S.ruler.x += p.x - act.at.x; S.ruler.y += p.y - act.at.y; act.at = p; }
      else {
        let a = (Math.atan2(p.y - S.ruler.y, p.x - S.ruler.x) * 180) / Math.PI + (act.flip ? 180 : 0);
        if (e && e.shiftKey) a = Math.round(a / 15) * 15;
        S.ruler.a = Math.round((((a + 180) % 360) + 360) % 360 - 180);
      }
      return paint();
    }
    if (act.erase) { // (the whole way since the last sample: a quick hand skips nothing)
      for (const p of pts) {
        const a = act.at, n = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / Math.max(2, S.tools.eraser.w / 4)));
        for (let i = 1; i <= n; i++) erase({ ...p, x: a.x + ((p.x - a.x) * i) / n, y: a.y + ((p.y - a.y) * i) / n });
        act.at = p;
      }
      return ring(lastPt);
    }
    if (act.loop) { for (const pt of pts) { const p = onBoard(pt); act.loop.push([p.x, p.y]); } return live(null, act.loop); }
    if (act.grab === "move") {
      const p = onBoard(lastPt), dx = p.x - act.at[0], dy = p.y - act.at[1];
      if (!dx && !dy) return;
      for (const it of S.sel) B.ink.moved(it, (q) => [q[0] + dx, q[1] + dy]);
      act.at = [p.x, p.y];
      return paint();
    }
    if (act.grab === "size") {
      const p = onBoard(lastPt), [ax, ay] = act.anchor, k = Math.max(0.05, Math.hypot(p.x - ax, p.y - ay) / act.from);
      for (const w of act.was) { w.it.pts = w.pts; w.it.w = w.w; B.ink.moved(w.it, (q) => [ax + (q[0] - ax) * k, ay + (q[1] - ay) * k], k); }
      return paint();
    }
    const item = act.stroke.item;
    if (act.shape) { // made clean already: a line's end still follows the hand, the others stand
      if (act.shape !== "line") return;
      const p = onBoard(lastPt);
      item.pts[1] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, 0.5, 0];
      item.path = null; item.box = null;
      return live(item);
    }
    let more = false;
    for (const p of pts) more = act.stroke.add(act.edge ? along(act.edge, onBoard(p)) : onBoard(p)) || more;
    if (more) live(item, null, act.edge ? null : foreseen(item, ahead));
    if (act.edge) return; // (along the ruler it is straight already)
    if (Math.hypot(lastPt.x - act.still.x, lastPt.y - act.still.y) > STILL || !act.hold) {
      act.still = lastPt;
      clearTimeout(act.hold);
      act.hold = setTimeout(() => {
        if (!S || S.act !== act || act.shape) return;
        const g = B.shape.guess(item.pts);
        if (!g) return;
        item.pts = g.pts; item.path = null; item.box = null;
        if (g.sharp) item.sharp = true; else delete item.sharp;
        act.shape = g.kind;
        live(item);
      }, HOLD_MS);
    }
  }
  /* Where the stroke is headed in the next frame or so, so that the ink does not trail the pen: what the browser foresees, where
   * it says; else the last movement carried on a little (a pen or a finger only — a mouse is where its arrow is). Never far. */
  function foreseen(item, ahead) {
    const pts = item.pts, n = pts.length, last = pts[n - 1], far = 24 / S.view.z, same = (p) => [...p, ...last.slice(p.length)];
    if (ahead.length) {
      const out = ahead.map(onBoard).map((p) => same([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, last[2], last[3]])).filter((p) => Math.hypot(p[0] - last[0], p[1] - last[1]) <= far);
      if (out.length) return out;
    }
    if (n < 3 || item.ch !== "xyptia" && !S.act.touch) return null;
    const a = pts[n - 3], dt = last[3] - a[3];
    if (dt <= 0 || dt > 60) return null;
    const k = Math.min(1, 16 / dt), dx = (last[0] - a[0]) * k, dy = (last[1] - a[1]) * k, d = Math.hypot(dx, dy);
    if (d < 0.5 / S.view.z) return null;
    const cap = Math.min(1, far / d);
    return [same([last[0] + dx * cap, last[1] + dy * cap, last[2], last[3]])];
  }
  function erase(pt) {
    const p = onBoard(pt), r = S.tools.eraser.w / 2 / S.view.z, items = S.model.items;
    if (S.tools.eraser.mode === "object") {
      const hit = new Set(B.ink.touched(items, p.x, p.y, r));
      if (!hit.size) return;
      S.model.items = items.filter((it) => !hit.has(it));
      return paint();
    }
    // a part of each stroke under it: the stroke is cut, its first piece keeps its name
    let any = false;
    const next = [];
    for (const it of items) {
      const b = it.k === "ink" ? B.format.boundsOf(it) : null;
      const pieces = b && p.x >= b[0] - r && p.x <= b[2] + r && p.y >= b[1] - r && p.y <= b[3] + r ? B.shape.cut(it.pts, p.x, p.y, r) : null;
      if (!pieces) { next.push(it); continue; }
      any = true;
      pieces.forEach((piece, i) => next.push({ ...it, id: i ? B.format.id() : it.id, pts: piece, path: null, box: null }));
    }
    if (!any) return;
    S.model.items = next;
    paint();
  }
  function end() {
    if (!S || !S.act) return;
    const act = S.act;
    S.act = null;
    clearTimeout(act.hold);
    bars(false);
    if (act.rule) return paint();
    if (act.erase) {
      if (S.model.items.length !== act.before.length || S.model.items.some((it, i) => it !== act.before[i])) replaced(act.before);
      return paint();
    }
    if (act.loop) {
      live(null);
      const far = act.loop.some((p) => Math.hypot(p[0] - act.loop[0][0], p[1] - act.loop[0][1]) * S.view.z > 6);
      S.sel = far ? B.ink.circled(S.model.items, act.loop) : []; // (a tap on the bare board: nothing is chosen)
      return paint();
    }
    if (act.grab) {
      const now = act.was.map((w) => ({ it: w.it, pts: w.it.pts, w: w.it.w }));
      if (now.some((n, i) => n.pts !== act.was[i].pts)) {
        const put = (list) => { for (const w of list) { w.it.pts = w.pts; w.it.w = w.w; w.it.path = null; w.it.box = null; } };
        did({ undo: () => put(act.was), redo: () => put(now) });
      }
      return paint();
    }
    const item = act.stroke.item;
    S.model.items.push(item);
    did({ undo: () => { S.model.items = S.model.items.filter((it) => it !== item); }, redo: () => { S.model.items.push(item); } });
    paint(); // (the stroke is in the ink before the one under the hand is taken away: no frame without it)
    live(null);
  }
  function cancel() {
    if (!S || !S.act) return;
    const act = S.act;
    S.act = null;
    clearTimeout(act.hold);
    if (act.erase) S.model.items = act.before;
    if (act.grab) for (const w of act.was) { w.it.pts = w.pts; w.it.w = w.w; w.it.path = null; w.it.box = null; }
    if (act.loop) S.sel = act.was;
    bars(false);
    live(null);
    paint();
  }
  function ring(pt) {
    const r = el.querySelector(".bd-ring"), on = !!pt && S && !S.readonly && S.tool === "eraser" && pt.type !== "touch";
    r.hidden = !on;
    if (on) r.style.transform = `translate(${pt.x - S.tools.eraser.w / 2}px, ${pt.y - S.tools.eraser.w / 2}px)`;
  }
  /* A pen held over the board before it touches it: where its tip will come down, as large as its line will be. */
  function hover(pt) {
    if (!S) return;
    ring(pt);
    const tip = el.querySelector(".bd-tip"), set = S.tools[S.tool], on = !!pt && pt.type === "pen" && !S.readonly && S.mode === "draw" && DRAWS.includes(S.tool);
    tip.hidden = !on;
    if (on) { const d = Math.max(3, set.w * S.view.z); tip.style.cssText = `width:${d}px;height:${d}px;transform:translate(${pt.x - d / 2}px, ${pt.y - d / 2}px);background:${set.c === "auto" ? "var(--fg)" : set.c};opacity:${Math.min(0.7, set.o)}`; }
  }
  // the bars step back while a stroke runs under them
  const bars = (drawing) => el.toggleAttribute("data-drawing", drawing);

  // ---------------------------------------------------------------- keys
  function keydown(e) {
    if (!S) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "q") return; // (the application's: it asks the page for what is unsaved, which leave() hands over)
    if (e.target.matches?.("input[type=text]")) return; // (a scene's name being typed: its own keys, and its field keeps them from the note)
    e.stopPropagation(); // nothing of this is the note's under the board
    if (sel.editing || e.target.isContentEditable) { // (text being typed: the keys are its own — but Esc ends it, and Tab goes on to a table's next cell)
      if (e.key === "Escape") { e.preventDefault(); sel.finish(); } else if (e.key === "Tab" && sel.tab(e.shiftKey ? -1 : 1)) e.preventDefault();
      return;
    }
    if (e.target.matches?.("input[type=range]") && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) return; // (the slider's own)
    const done = () => e.preventDefault();
    if (e.key === " " && !mod) { space = true; stage().dataset.space = ""; return done(); }
    if (mod && k === "v" && !e.altKey && !S.readonly) { if (BROWSER) return; done(); return pasteHere(); } // (a browser: its paste follows, with what is pasted in it)
    if (e.key === "Escape" && vpop().dataset.open != null) { done(); return menu(null); }
    if (e.key === "Escape" && sel.pending) { done(); delete el.querySelector(".bd-cpop").dataset.open; return sel.connectTo(null); }
    if (S.mode === "select" && !S.readonly && sel.key(e)) return done();
    if (e.key === "Escape") { // one thing at a time: the options, what is chosen, then the board itself
      done();
      if (el.querySelector(".bd-spop").hasAttribute("data-open")) return shapes(false);
      if (vpop().dataset.open != null) return menu(null);
      if (sel.pending) { delete el.querySelector(".bd-cpop").dataset.open; return sel.connectTo(null); }
      if (popOpen()) return options(null);
      if (S.sel.length) { S.sel = []; return paint(); }
      return B.close();
    }
    if (mod && k === "w") { done(); return B.close(); }
    if (mod && k === "s") { done(); return save(); }
    if (mod && k === "z") { done(); return step(e.shiftKey ? 1 : -1); }
    if (mod && k === "y") { done(); return step(1); }
    const s = size();
    if (mod && (e.key === "+" || e.key === "=" || e.code === "NumpadAdd")) { done(); return S.view.step(1); }
    if (mod && (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract")) { done(); return S.view.step(-1); }
    if (mod && (e.key === "0" || e.code === "Numpad0")) { done(); return S.view.fit(bounds()); }
    if (mod && e.key === "1") { done(); return S.view.zoomAt(s.w / 2, s.h / 2, 1); }
    if (S.readonly) return;
    if (mod && k === "a") { done(); S.mode = "draw"; S.tool = "lasso"; S.sel = S.model.items.filter((it) => it.k === "ink"); return paint(); }
    if (mod && k === "d") { done(); return duplicate(); }
    if (mod || e.altKey) return;
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel.length) { done(); return remove(); }
    const tool = { p: "pen", 1: "pen", f: "mono", 2: "mono", m: "marker", 3: "marker", b: "pencil", 4: "pencil", e: "eraser", 5: "eraser", l: "lasso", 6: "lasso" }[k];
    if (k === "r") { done(); return ruler(); }
    if (tool) { done(); return setTool(tool); }
    if (k === "v") { done(); return setMode("select"); }
    if (k === "t" || k === "n") { done(); setMode("select"); return void sel.insert(k === "t" ? "text" : "sticky"); }
    if (e.key.startsWith("Arrow")) {
      done();
      const dx = k === "arrowleft" ? -1 : k === "arrowright" ? 1 : 0, dy = k === "arrowup" ? -1 : k === "arrowdown" ? 1 : 0;
      if (!S.sel.length) return S.view.panBy(-dx * (e.shiftKey ? 200 : 40), -dy * (e.shiftKey ? 200 : 40));
      // what is chosen is nudged: a pixel, with Shift ten
      const n = e.shiftKey ? 10 : 1, was = S.sel.map((it) => ({ it, pts: it.pts })), put = (list) => { for (const w of list) { w.it.pts = w.pts; w.it.path = null; w.it.box = null; } };
      for (const it of S.sel) B.ink.moved(it, (q) => [q[0] + dx * n, q[1] + dy * n]);
      const now = S.sel.map((it) => ({ it, pts: it.pts }));
      did({ undo: () => put(was), redo: () => put(now) });
      return paint();
    }
  }
  function keyup(e) {
    if (!S) return;
    e.stopPropagation();
    if (e.key === " ") { space = false; delete stage().dataset.space; }
  }
  const hidden = () => { if (document.visibilityState === "hidden") save(); };

  // ---------------------------------------------------------------- opening and closing
  /* The place the board grows out of and goes back into: its picture in the note. */
  function fromRect(img) {
    if (!img || !img.isConnected) return null;
    const r = (img.closest(".board-block") || img).getBoundingClientRect();
    return r.width && r.height ? r : null;
  }
  const place = (r) => (r ? `translate(${r.left}px, ${r.top}px) scale(${r.width / (el.clientWidth || innerWidth)}, ${r.height / (el.clientHeight || innerHeight)})` : "scale(0.97)");

  /* img: the board's picture in the note. */
  B.open = async (img) => {
    if (S || !B.isBoard(img)) return false;
    const ref = refOf(img), cur = core.current || {};
    if (!el) build();
    const s = (S = { ref, img, readonly: !!((window.MdHost || {}).reading || cur.readonly), model: B.format.fresh(), view: B.view.make(size, paint), undo: [], redo: [], dirty: false, timer: 0, tool: "pen", tools: toolsNow(), sel: [], act: null, mode: "draw", pick: [], connect: false, scene: -1, ruler: null, crop: null });
    core.lockScroll(true);
    post("board-open", { on: true });
    el.setAttribute("aria-label", T("board.name"));
    el.querySelector(".bd-name").textContent = T("board.name");
    el.toggleAttribute("data-readonly", s.readonly);
    chip("");
    options(null);
    // from the picture's place to the whole window
    el.hidden = false;
    el.style.transition = "none";
    el.style.transform = place(fromRect(img));
    el.style.opacity = "0";
    void el.offsetWidth;
    el.style.transition = el.style.transform = el.style.opacity = "";
    el.dataset.open = "";
    addEventListener("keydown", keydown, true);
    addEventListener("keyup", keyup, true);
    document.addEventListener("visibilitychange", hidden);
    addEventListener("pagehide", save);
    addEventListener("blur", save);
    document.addEventListener("paste", pasted, true);
    el.focus({ preventScroll: true });
    paint();
    try {
      const text = await read(ref, img.src);
      B.items.thumbsFrom(text);
      const model = B.format.parse(text);
      if (S !== s) return false;
      s.model = model;
      if (model.board.view) s.view.set(model.board.view.x, model.board.view.y, model.board.view.z); else s.view.fit(bounds());
      if (model.lost) chip(T("board.lost", model.lost));
      el.dataset.ready = "";
    } catch (e) {
      if (S === s) { s.readonly = true; B.close(); }
      core.toast(T("board.cantOpen"));
      return false;
    }
    return true;
  };
  /* quick: no way back to watch (the note under the board is being left). */
  B.close = (quick = false) => {
    if (!S) return;
    if (S.act) cancel();
    sel.cancel(); sel.finish(); sel.closePop(); shapes(false); menu(null);
    save();
    const s = S;
    S = null; space = false;
    removeEventListener("keydown", keydown, true);
    removeEventListener("keyup", keyup, true);
    document.removeEventListener("visibilitychange", hidden);
    removeEventListener("pagehide", save);
    removeEventListener("blur", save);
    document.removeEventListener("paste", pasted, true);
    core.lockScroll(false);
    post("board-open", { on: false });
    delete el.dataset.open; delete el.dataset.ready;
    const done = () => { if (!S) { el.hidden = true; el.style.transform = ""; } };
    if (quick) return done();
    const img = [...document.querySelectorAll("#content img, #active img")].find((i) => i.offsetParent && refOf(i) === s.ref) || s.img;
    el.style.transform = place(fromRect(img));
    setTimeout(done, 400);
    if (img && img.isConnected) img.closest("[tabindex], .pm, body")?.focus?.({ preventScroll: true });
  };
  /* The note under the board is being left, or the window closed: what is unsaved goes to the host now. */
  B.leave = () => B.close(true);
  B.pinch = (phase, scale) => {
    if (!S) return;
    if (phase === "begin") S.pinch = S.view.z;
    else if (S.pinch) { const s = size(); S.view.zoomAt(s.w / 2, s.h / 2, S.pinch * scale); }
  };
  Object.defineProperty(B, "shown", { get: () => !!S });
  /* For the tests: what is open, as it is. */
  B.state = () => (S ? { pens: { ...pens }, tip: !el.querySelector(".bd-tip").hidden, channels: S.model.items.filter((it) => it.k === "ink").map((it) => it.ch), ruler: S.ruler && { ...S.ruler }, palette: el.dataset.palette || "bottom", crop: S.crop, insert: S.model.board.insert || null, scenes: S.model.scenes.map((sc) => ({ ...sc })), scene: S.scene, snap: !!S.model.board.snap, menu: vpop().dataset.open != null ? vpop().dataset.kind : null, connect: !!S.connect, asking: el.querySelector(".bd-cpop").hasAttribute("data-open"), view: { x: S.view.x, y: S.view.y, z: S.view.z }, mode: S.mode, picked: S.pick.map((it) => it.id), things: S.model.items.filter((it) => it.k !== "ink").map((it) => JSON.parse(JSON.stringify(it))), editing: sel.editing, ref: S.ref, items: S.model.items.filter((it) => it.k === "ink").length, tool: S.tool, ink: (S.tools[S.tool] || {}).c, tools: S.tools, chosen: S.sel.length, chosenBox: S.sel.length ? boundsOf(S.sel).map(Math.round) : null, inks: S.model.items.filter((it) => it.k === "ink").map((it) => it.c), options: popOpen(), kinds: S.model.items.filter((it) => it.k === "ink").map((it) => it.t + (it.sharp ? "!" : "") + ":" + it.pts.length), zoom: S.view.z, dirty: S.dirty, readonly: S.readonly, undo: S.undo.length, redo: S.redo.length, lost: S.model.lost } : null);
  B.pick = (ids) => { if (S) { if (S.mode !== "select") setMode("select"); sel.pick(S.model.items.filter((it) => ids.includes(it.id))); } }; // (for the tests: chosen by name, whatever lies over it)
  /* A new board's text, and what a board's picture shows, for those who put one into a note. */
  B.emptyText = () => B.format.empty();
})();
