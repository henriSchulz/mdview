/* mdview — all notes of the folder as tiles (folder windows; the toolbar's
 * grid button, Ctrl+Alt+G). A tile is the note in small: its name, a line,
 * and the beginning of what it says, rendered as the reading view renders it.
 * Notes are grouped by the folder they lie in. A note whose properties name a
 * colour (`color: red` — one of the theme's) has a frame in that colour.
 *
 * The beginnings come from the application (the page may not read files): it
 * is asked for a batch, renders what comes, asks for the next. What was read
 * is kept and only rendered again when the file changed.
 *
 * Keys: arrows move among the tiles, Enter or Space opens one, Esc closes. */
"use strict";
(() => {
  const core = window.MdView.core;
  const { md, stripFrontmatter, stripComments, esc, post, DECO_COLORS } = core;
  const BATCH = 40;

  const el = document.createElement("section");
  el.id = "overview";
  el.setAttribute("aria-label", "All notes");
  el.innerHTML = `<header class="ov-head"><h1 class="ov-title"></h1><span class="ov-count"></span></header><div class="ov-body"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector(".ov-body");
  const button = () => document.querySelector('#toolbar [data-act="overview"]');

  const cache = new Map();   // path -> { mtime, html, color }
  const tiles = new Map();   // path -> the tile's element
  let queue = [], waiting = false, focusBack = null;
  const isOpen = () => el.hasAttribute("data-open");

  // the notes of the tree, folder by folder: [{ label, notes }] (other files the sidebar lists are left out)
  function groups(tree) {
    const out = [];
    const walk = (node, label) => {
      const notes = node.notes.filter((n) => !n.pdf);
      if (notes.length) out.push({ label, notes });
      for (const d of node.dirs) walk(d, label ? label + " / " + d.name : d.name);
    };
    walk(tree, "");
    return out;
  }

  function build() {
    const folder = core.folder;
    if (!folder) return;
    const gs = groups(folder.tree), total = gs.reduce((n, g) => n + g.notes.length, 0);
    el.querySelector(".ov-title").textContent = folder.name;
    el.querySelector(".ov-count").textContent = total === 1 ? "1 note" : total + " notes";
    const here = core.current && core.current.path;
    body.textContent = "";
    tiles.clear();
    if (!total) { body.innerHTML = `<p class="ov-none">No notes in this folder yet.</p>`; return; }
    let i = 0;
    for (const g of gs) {
      if (g.label) { const h = document.createElement("h2"); h.className = "ov-dir"; h.textContent = g.label; body.appendChild(h); }
      const grid = document.createElement("div");
      grid.className = "ov-grid";
      for (const n of g.notes) {
        const t = document.createElement("div");
        t.className = "ov-tile";
        t.tabIndex = 0;
        t.setAttribute("role", "link");
        t.dataset.path = n.path;
        t.style.setProperty("--i", Math.min(i++, 10)); // (the first ones come one after the other, the rest together)
        if (n.real === here || n.path === here) t.setAttribute("aria-current", "page");
        t.innerHTML = `<div class="ov-sheet"><div class="ov-name">${esc(n.title || n.name)}</div><div class="ov-prev" inert></div></div>`;
        const known = cache.get(n.path);
        if (known) paint(t, known);
        grid.appendChild(t);
        tiles.set(n.path, t);
      }
      body.appendChild(grid);
    }
    queue = [...tiles.keys()];
    ask();
  }

  function ask() {
    if (waiting || !queue.length || !isOpen()) return;
    waiting = true;
    post("previews", { paths: queue.splice(0, BATCH) });
  }
  function paint(tile, p) {
    const prev = tile.querySelector(".ov-prev");
    prev.innerHTML = p.html;
    for (const c of DECO_COLORS) tile.classList.toggle("ov-" + c, p.color === c);
    tile.classList.toggle("ov-empty", !p.html);
  }
  // the beginning of a note as the reading view would show it — without what only works in a note on screen
  function htmlOf(path, text) {
    const fm = stripFrontmatter(text.replace(/\r\n?/g, "\n"));
    let html = "";
    try { html = md.render(stripComments(fm.body), { lineOffset: 0, links: {}, outline: [], depth: 1 }); } catch (e) { html = ""; }
    const box = document.createElement("template");
    box.innerHTML = html;
    const dir = "file://" + path.replace(/\/[^/]*$/, "").split("/").map(encodeURIComponent).join("/") + "/";
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
    return { html: box.innerHTML.trim(), color };
  }
  function previews(got) {
    waiting = false;
    for (const [path, p] of Object.entries(got || {})) {
      const known = cache.get(path);
      if (known && known.mtime === p.mtime) continue; // unchanged: as it is
      const made = { mtime: p.mtime, ...htmlOf(path, p.text || "") };
      cache.set(path, made);
      const tile = tiles.get(path);
      if (tile) paint(tile, made);
    }
    ask();
  }

  function open() {
    if (isOpen() || !core.folder) return;
    focusBack = document.activeElement;
    build();
    void el.offsetHeight; // (the tiles are there, unseen: from here they come in)
    el.dataset.open = "";
    document.body.dataset.overview = "";
    button()?.setAttribute("aria-pressed", "true");
    el.scrollTop = 0;
    const cur = body.querySelector('.ov-tile[aria-current]') || body.querySelector(".ov-tile");
    if (cur) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: "nearest" }); }
    ask();
  }
  function close(refocus = true) {
    if (!isOpen()) return false;
    delete el.dataset.open;
    delete document.body.dataset.overview;
    button()?.setAttribute("aria-pressed", "false");
    if (refocus && focusBack && focusBack.isConnected && focusBack !== document.body) focusBack.focus({ preventScroll: true });
    focusBack = null;
    return true;
  }
  const toggle = () => (isOpen() ? close() : open());
  function go(tile) {
    const path = tile.dataset.path;
    close(false);
    post("note", { path });
  }

  body.addEventListener("click", (e) => { const t = e.target.closest(".ov-tile"); if (t) go(t); });
  // the tile in that direction: the nearest one whose middle lies there (the grids differ in their columns)
  function toward(from, dx, dy) {
    const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, score = Infinity;
    for (const t of tiles.values()) {
      if (t === from) continue;
      const r = t.getBoundingClientRect(), x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
      const along = dx ? x * dx : y * dy, across = Math.abs(dx ? y : x);
      if (along <= 1 || (dx && across > a.height / 2)) continue;
      const s = along + across * 3;
      if (s < score) { score = s; best = t; }
    }
    return best;
  }
  el.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tile = e.target.closest?.(".ov-tile");
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (!tile) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) {
      e.preventDefault();
      const next = toward(tile, d[0], d[1]);
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(tile); }
  });
  // a note chosen in the sidebar while the tiles show: the note
  document.getElementById("sidebar")?.addEventListener("click", (e) => { if (e.target.closest(".sb-item:not(.is-dir) > .sb-in > .sb-row")) close(false); });

  window.MdOverview = { open, close, toggle, previews, folderChanged: () => { if (isOpen()) build(); }, get isOpen() { return isOpen(); } };
})();
