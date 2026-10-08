/* mdview — all notes of the folder as tiles (folder windows; the toolbar's
 * grid button, Ctrl+Alt+G). A tile is the note in small: its name, a line,
 * and the beginning of what it says, rendered as the reading view renders it.
 * A note whose properties name a colour (`color: red` — one of the theme's)
 * has a dot in that colour before its name.
 *
 * Two choices at the head, both remembered: what is shown — all notes, grouped
 * by the folder they lie in, or one folder at a time, its folders to click
 * into — and how: as tiles or as a list (a row per note: its name, under it its first words).
 * A right click on a note or folder opens the file menu the sidebar has; one
 * on the empty room beside them offers a new note or folder there.
 *
 * The beginnings come from the application (the page may not read files): it
 * is asked for a batch, renders what comes, asks for the next. What was read
 * is kept and only rendered again when the file changed.
 *
 * Beside the notes stand the other files the settings ask for here (PDFs, pictures, sound and
 * film, anything else: All Notes' own choice, apart from the sidebar's — also under Show in the
 * menu of a right click): a picture as itself, any other by its sign and its kind.
 *
 * Several at once: a rectangle pulled from the empty room takes what it touches, Shift+click
 * takes one more or lets it go, Ctrl+A takes all. What is selected is moved together (dragged
 * onto a folder), trashed together (Delete), or opened in tabs (the menu of a right click).
 *
 * Keys: arrows move among the tiles, Enter or Space opens one, Backspace goes
 * up a folder, F2 renames, Delete moves to the trash, Ctrl+A selects all, Esc lets the
 * selection go and then closes. */
"use strict";
(() => {
  const core = window.MdView.core;
  const { md, stripFrontmatter, stripComments, esc, post, DECO_COLORS, UI: ICON } = core;
  const BATCH = 40;

  const el = document.createElement("section");
  el.id = "overview";
  el.setAttribute("aria-label", "All notes");
  const seg = (name, label, opts) => `<div class="ov-seg" role="radiogroup" data-seg="${name}" aria-label="${label}" style="--n:${opts.length}"><span class="ov-thumb"></span>` +
    opts.map(([v, text, icon]) => `<button class="ov-opt" role="radio" data-v="${v}" aria-checked="false"${icon ? ` title="${text}" aria-label="${text}"` : ""}>${icon ? ICON[icon] : text}</button>`).join("") + `</div>`;
  // the head, as Craft's "All Docs" has it: the plus before the name, at the right the choices in a
  // raised field of their own, and "…" for the rest (the order, what is listed beside the notes)
  const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>';
  el.innerHTML = `<header class="ov-head"><button class="ov-add" type="button" title="New note or folder" aria-label="New note or folder">${ICON.plus}</button>` +
    `<h1 class="ov-title"></h1><span class="ov-count"></span><span class="ov-space"></span>` +
    seg("scope", "Show", [["all", "All Notes"], ["folders", "Folders"]]) + seg("layout", "View", [["tiles", "Tiles", "apps"], ["list", "List", "list"]]) +
    `<button class="ov-more" type="button" title="Sort and show" aria-label="Sort and show" aria-haspopup="menu">${DOTS}</button>` +
    `</header><div class="ov-body"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector(".ov-body");
  const pressed = (on) => document.querySelectorAll('[data-act="overview"]').forEach((b) => b.setAttribute("aria-pressed", String(on))); // (the toolbar's button, the tabs' house)

  const cache = new Map();   // path -> { mtime, html, color }
  const tiles = new Map();   // path -> the note's element (a tile or a row)
  let items = [];            // notes and folders as they stand, for the arrow keys
  let queue = [], waiting = false, focusBack = null;
  let scope = "all", layout = "tiles"; // (the settings' ovScope, ovLayout)
  let at = [];               // scope "folders": the names of the folders gone into, from the root
  const isOpen = () => el.hasAttribute("data-open");
  const picked = new Set();  // the paths of what is selected
  // the folder as All Notes lists it: the notes, and the other files its own settings ask for
  const tree = () => core.listed(core.folder.all || core.folder.tree, "ov");
  // notes first, in the sidebar's order; then the other files, by name
  const ordered = (notes) => [...core.sortNotes(notes.filter((n) => !n.pdf)), ...notes.filter((n) => n.pdf)];

  // what the tree holds, folder by folder: [{ label, notes }]
  function groups(tree) {
    const out = [];
    const walk = (node, label) => {
      const notes = ordered(node.notes);
      if (notes.length) out.push({ label, notes });
      for (const d of node.dirs) walk(d, label ? label + " / " + d.name : d.name);
    };
    walk(tree, "");
    return out;
  }

  // [notes, other files] in a folder and below it
  const count = (node) => node.dirs.reduce((n, d) => { const c = count(d); return [n[0] + c[0], n[1] + c[1]]; }, [node.notes.filter((n) => !n.pdf).length, node.notes.filter((n) => n.pdf).length]);
  const plural = (n, one) => (n === 1 ? "1 " + one : n + " " + one + "s");
  const says = ([notes, files]) => [notes || !files ? plural(notes, "note") : "", files ? plural(files, "file") : ""].filter(Boolean).join(", ");
  const KIND = { pdf: "PDF", image: "Picture", audio: "Sound", video: "Video" };
  const kindOf = (n) => KIND[n.kind] || ((/\.([A-Za-z0-9]{1,8})$/.exec(n.name) || [, ""])[1].toUpperCase() + " file").trim();
  const urlOf = (path) => (window.MdHost?.files || "file://") + path.split("/").map(encodeURIComponent).join("/");
  // the folder shown (scope "folders"): as far down `at` as the tree still goes
  function place(tree) {
    let node = tree;
    const path = [];
    for (const name of at) {
      const next = node.dirs.find((d) => d.name === name);
      if (!next) break;
      node = next; path.push(name);
    }
    at = path;
    return node;
  }
  function setSegs() {
    for (const [name, v] of [["scope", scope], ["layout", layout]]) {
      const box = el.querySelector(`[data-seg="${name}"]`), opts = [...box.querySelectorAll(".ov-opt")];
      opts.forEach((o) => o.setAttribute("aria-checked", String(o.dataset.v === v)));
      box.style.setProperty("--i", Math.max(0, opts.findIndex((o) => o.dataset.v === v)));
    }
  }
  // a note or a folder, as a tile or as a row
  function item(n, i, dir) {
    const t = document.createElement("div"), list = layout === "list";
    t.className = "ov-item " + (list ? "ov-row" : "ov-tile") + (dir ? " ov-folder" : "");
    t.tabIndex = 0;
    t.setAttribute("role", "link");
    t.dataset.path = n.path;
    t.draggable = true; // (onto a folder's tile: moved into it)
    if (dir) t.dataset.dir = n.name;
    t.style.setProperty("--i", Math.min(i, 10)); // (the first ones come one after the other, the rest together)
    const file = !dir && n.pdf; // (not a note: a PDF, a picture, any other file)
    if (file) { t.classList.add("ov-file"); t.dataset.kind = n.kind || "file"; }
    if (picked.has(n.path)) t.classList.add("picked");
    const name = esc(dir ? n.name : n.title || n.name), sub = dir ? says(count(n)) : file ? esc(kindOf(n)) : "";
    const sign = dir ? ICON.folder : file ? core.rowIcon(n.path) : ICON.note;
    if (list) t.innerHTML = `<span class="ov-icon">${sign}</span><span class="ov-text"><span class="ov-name">${name}</span><span class="ov-snip">${sub}</span></span>${dir ? `<span class="ov-go">${ICON.chevron}</span>` : ""}`;
    else if (dir) t.innerHTML = `<div class="ov-sheet"><span class="ov-icon">${ICON.folder}</span><div class="ov-name">${name}</div><div class="ov-sub">${sub}</div></div>`;
    else if (file) t.innerHTML = `<div class="ov-sheet"><div class="ov-name">${name}</div><div class="ov-pic">${n.kind === "image" ? `<img src="${esc(urlOf(n.path))}" alt="" loading="lazy" draggable="false">` : `<span class="ov-icon">${sign}</span>`}</div><div class="ov-sub">${sub}</div></div>`;
    else t.innerHTML = `<div class="ov-sheet"><div class="ov-name">${name}</div><div class="ov-prev" inert></div></div>`;
    return t;
  }
  function build() {
    const folder = core.folder;
    if (!folder) return;
    setSegs();
    el.dataset.layout = layout;
    const here = core.current && core.current.path;
    const title = el.querySelector(".ov-title");
    let gs, total;
    if (scope === "folders") {
      const node = place(tree());
      // the way here, to click back along
      title.innerHTML = [folder.name, ...at].map((name, i, all) => (i < all.length - 1
        ? `<button class="ov-crumb" data-up="${all.length - 1 - i}">${esc(name)}</button><span class="ov-sep">${ICON.chevron}</span>` : `<span>${esc(name)}</span>`)).join("");
      gs = [{ label: "", dirs: node.dirs, notes: ordered(node.notes) }];
      total = gs[0].notes.length;
      el.querySelector(".ov-count").textContent = [node.dirs.length ? plural(node.dirs.length, "folder") : "", says([gs[0].notes.filter((n) => !n.pdf).length, gs[0].notes.filter((n) => n.pdf).length])].filter(Boolean).join(", ");
      total += node.dirs.length;
    } else {
      const all = tree();
      gs = groups(all); total = gs.reduce((n, g) => n + g.notes.length, 0);
      title.textContent = folder.name;
      el.querySelector(".ov-count").textContent = says(count(all));
    }
    body.textContent = "";
    tiles.clear();
    items = [];
    if (!total) { body.innerHTML = core.emptyState(); return; }
    let i = 0;
    for (const g of gs) {
      if (g.label) { const h = document.createElement("h2"); h.className = "ov-dir"; h.textContent = g.label; body.appendChild(h); }
      const grid = document.createElement("div");
      grid.className = layout === "list" ? "ov-list" : "ov-grid";
      for (const d of g.dirs || []) { const t = item(d, i++, true); grid.appendChild(t); items.push(t); }
      for (const n of g.notes) {
        const t = item(n, i++, false);
        if (n.real === here || n.path === here) t.setAttribute("aria-current", "page");
        const known = !n.pdf && cache.get(n.path);
        if (known) paint(t, known);
        grid.appendChild(t);
        if (!n.pdf) tiles.set(n.path, t); // (a note: its beginning is asked for)
        items.push(t);
      }
      body.appendChild(grid);
    }
    // (what is selected and no longer there is selected no more)
    const there = new Set(items.map((t) => t.dataset.path));
    for (const p of [...picked]) if (!there.has(p)) picked.delete(p);
    queue = [...tiles.keys()];
    ask();
  }
  // a choice at the head, or a folder gone into or left: built anew, the keyboard's place kept in it
  function rebuild(focus) {
    const had = el.contains(document.activeElement);
    build();
    el.scrollTop = 0;
    const to = (focus && items.find(focus)) || body.querySelector(".ov-item[aria-current]") || items[0];
    if (had && to) to.focus({ preventScroll: true });
  }
  function choose(name, v) {
    if (name === "scope") { if (scope === v) return; scope = v; at = []; picked.clear(); } else { if (layout === v) return; layout = v; }
    const key = name === "scope" ? "ovScope" : "ovLayout";
    window.MdPrefs = { ...(window.MdPrefs || {}), [key]: v };
    post("prefs", { prefs: { [key]: v } });
    rebuild();
  }
  function up(levels = 1) {
    if (scope !== "folders" || !at.length) return false;
    const from = at[at.length - levels];
    picked.clear();
    at = at.slice(0, at.length - levels);
    rebuild((t) => t.dataset.dir === from);
    return true;
  }

  function ask() {
    if (waiting || !queue.length || !isOpen()) return;
    waiting = true;
    post("previews", { paths: queue.splice(0, BATCH) });
  }
  function paint(tile, p) {
    const prev = tile.querySelector(".ov-prev"), snip = tile.querySelector(".ov-snip");
    if (prev) prev.innerHTML = p.html;
    if (snip) snip.textContent = p.text;
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
    for (const x of box.content.querySelectorAll("h1:first-child, .katex-mathml")) x.remove(); // (a row's words: without the name again)
    return { html: box.innerHTML.trim(), color, text: box.content.textContent.replace(/\s+/g, " ").trim().slice(0, 240) };
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
    const prefs = window.MdPrefs || {};
    scope = prefs.ovScope === "folders" ? "folders" : "all";
    layout = prefs.ovLayout === "list" ? "list" : "tiles";
    // it opens where the note on screen lies (place() drops what the tree does not have)
    const root = core.folder.root, shown = core.current && core.current.path;
    at = shown && shown.startsWith(root + "/") ? shown.slice(root.length + 1).split("/").slice(0, -1) : [];
    picked.clear();
    build();
    void el.offsetHeight; // (the tiles are there, unseen: from here they come in)
    el.dataset.open = "";
    delete el.dataset.keys;
    core.lockScroll(true); // (the note under the tiles holds still)
    document.body.dataset.overview = "";
    pressed(true);
    el.scrollTop = 0;
    const cur = body.querySelector('.ov-item[aria-current]') || items[0];
    if (cur) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: "nearest" }); }
    ask();
  }
  function close(refocus = true) {
    if (!isOpen()) return false;
    delete el.dataset.open;
    core.lockScroll(false);
    delete document.body.dataset.overview;
    pressed(false);
    if (refocus && focusBack && focusBack.isConnected && focusBack !== document.body) focusBack.focus({ preventScroll: true });
    focusBack = null;
    return true;
  }
  // (an empty tab has nothing under the tiles: they stay until a note is chosen)
  const toggle = () => (!isOpen() ? open() : core.current ? close() : false);
  // tab: in a tab of its own (Ctrl held, the middle button)
  function go(tile, tab = false) {
    if (tile.dataset.dir) { at.push(tile.dataset.dir); picked.clear(); rebuild(); return; }
    const path = tile.dataset.path;
    // (a picture, a film, any other file opens in its own application: the tiles stay)
    if (tile.dataset.kind && tile.dataset.kind !== "pdf") { post("note", { path }); return; }
    close(false);
    core.going(path);
    post("note", { path, tab });
  }

  // ------------------------------------------------------------ several at once
  const mark = () => { for (const t of items) t.classList.toggle("picked", picked.has(t.dataset.path)); el.toggleAttribute("data-picked", picked.size > 0); };
  const pick = (paths) => { picked.clear(); for (const p of paths) picked.add(p); mark(); };
  /* A rectangle pulled from the empty room: what it touches is selected (with Shift or Ctrl held:
   * as well as what was). It is drawn in the tiles' own room, so it stays with them when the
   * pulling scrolls them. */
  let band = null, banded = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !isOpen() || e.target.closest(".ov-item, .ov-head button, .ov-rename, input")) return;
    if (e.target === el && e.offsetX >= el.clientWidth) return; // (the scroll bar)
    band = { x: e.clientX, y: e.clientY + el.scrollTop, id: e.pointerId, box: null, was: e.shiftKey || e.ctrlKey || e.metaKey ? new Set(picked) : new Set() };
  });
  el.addEventListener("pointermove", (e) => {
    if (!band || e.pointerId !== band.id) return;
    const y = e.clientY + el.scrollTop;
    if (!band.box) {
      if (Math.hypot(e.clientX - band.x, y - band.y) < 5) return;
      band.box = document.createElement("div");
      band.box.className = "ov-band";
      el.appendChild(band.box);
      el.setPointerCapture(band.id);
      getSelection()?.removeAllRanges();
    }
    // (near the window's upper or lower edge the tiles come along)
    if (e.clientY > innerHeight - 36) el.scrollTop += 14; else if (e.clientY < 36 + el.getBoundingClientRect().top) el.scrollTop -= 14;
    const r = el.getBoundingClientRect(), x1 = Math.min(band.x, e.clientX), x2 = Math.max(band.x, e.clientX), y1 = Math.min(band.y, y), y2 = Math.max(band.y, y);
    Object.assign(band.box.style, { left: x1 - r.left + "px", top: y1 - r.top + "px", width: x2 - x1 + "px", height: y2 - y1 + "px" });
    const hit = new Set(band.was), top = el.scrollTop;
    for (const t of items) { const b = t.getBoundingClientRect(); if (b.left < x2 && b.right > x1 && b.top + top < y2 && b.bottom + top > y1) hit.add(t.dataset.path); }
    pick(hit);
  });
  const bandEnd = (e) => {
    if (!band || (e.pointerId != null && e.pointerId !== band.id)) return;
    const box = band.box;
    band = null;
    if (!box) return;
    banded = true; setTimeout(() => { banded = false; }, 0); // (the click that ends the pulling selects nothing away)
    box.classList.add("leaving");
    setTimeout(() => box.remove(), 200);
    (items.find((t) => picked.has(t.dataset.path)) || el).focus?.({ preventScroll: true });
  };
  el.addEventListener("pointerup", bandEnd);
  el.addEventListener("pointercancel", bandEnd);
  // a click beside the tiles: nothing is selected any more
  el.addEventListener("click", (e) => { if (!banded && picked.size && !e.target.closest(".ov-item, .ov-head")) pick([]); });
  /* What is selected, all of it (the menu of a right click on one of them): opened in tabs of
   * their own, or to the trash. */
  function many(cmd) {
    const all = items.filter((t) => picked.has(t.dataset.path));
    if (cmd === "trash") { post("trash", { paths: all.map((t) => t.dataset.path) }); pick([]); return; }
    if (cmd !== "opentab") return;
    const notes = all.filter((t) => !t.dataset.dir && (!t.dataset.kind || t.dataset.kind === "pdf"));
    if (!notes.length) return;
    close(false);
    for (const t of notes) post("note", { path: t.dataset.path, tab: true });
  }

  body.addEventListener("click", (e) => {
    const t = e.target.closest(".ov-item");
    if (!t || e.target.closest(".ov-rename")) return;
    // Shift+click: one more selected, or one less — nothing opens
    if (e.shiftKey) { const now = new Set(picked); if (now.has(t.dataset.path)) now.delete(t.dataset.path); else now.add(t.dataset.path); pick(now); return; }
    if (picked.size) pick([]);
    go(t, e.ctrlKey || e.metaKey);
  });
  body.addEventListener("mousedown", (e) => { if (e.button === 1 && e.target.closest(".ov-item")) e.preventDefault(); });
  body.addEventListener("auxclick", (e) => { const t = e.target.closest(".ov-item"); if (t && e.button === 1 && !e.target.closest(".ov-rename")) { e.preventDefault(); go(t, true); } });
  el.querySelector(".ov-head").addEventListener("click", (e) => {
    const opt = e.target.closest(".ov-opt"), crumb = e.target.closest(".ov-crumb"), add = e.target.closest(".ov-add"), more = e.target.closest(".ov-more");
    const here = () => (scope === "folders" ? place(tree()).path : core.folder.root);
    // the + : a new note or folder, in the folder shown; "…": the order, and what is listed (the menu the empty room has)
    if (add && core.folder) { const r = add.getBoundingClientRect(); core.fileMenu(add, r.left, r.bottom + 6, "ovnew", here()); }
    else if (more && core.folder) { const r = more.getBoundingClientRect(); core.fileMenu(more, r.right - 200, r.bottom + 6, "blank", here()); }
    else if (opt) choose(opt.parentNode.dataset.seg, opt.dataset.v);
    else if (crumb) up(Number(crumb.dataset.up));
  });
  // a tile dragged onto a folder's tile: moved into that folder (the sidebar's rows do the same: core.moving)
  let into = null;
  const setInto = (t) => { if (into === t) return; if (into) into.classList.remove("drop-into"); into = t; if (t) t.classList.add("drop-into"); };
  const folderAt = (e) => { const t = e.target.closest?.(".ov-item[data-dir]"); return t && core.moving.can(t.dataset.path) ? t : null; };
  body.addEventListener("dragstart", (e) => {
    const t = e.target.closest?.(".ov-item");
    if (!t || e.target.closest(".ov-rename")) { e.preventDefault(); return; }
    // (one of several that are selected: they all go; any other: it alone, and nothing is selected any more)
    const all = picked.has(t.dataset.path) && picked.size > 1 ? items.filter((x) => picked.has(x.dataset.path)) : [t];
    if (all.length === 1 && picked.size) pick([]);
    for (const x of all) x.classList.add("dragged");
    core.moving.start(e, t.dataset.path, t, all.map((x) => x.dataset.path));
  });
  body.addEventListener("dragover", (e) => { const t = folderAt(e); setInto(t); if (t) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } });
  body.addEventListener("dragleave", (e) => { if (!body.contains(e.relatedTarget)) setInto(null); });
  body.addEventListener("drop", (e) => { const t = folderAt(e); setInto(null); if (t) { e.preventDefault(); core.moving.end(t.dataset.path); } });
  document.addEventListener("dragend", () => { setInto(null); for (const t of body.querySelectorAll(".ov-item.dragged")) t.classList.remove("dragged"); });
  // the file menu the sidebar has, for a note or a folder here
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const t = e.target.closest(".ov-item");
    if (t && !e.target.closest(".ov-rename")) {
      // one of several that are selected: the menu is for all of them; any other: for it, and nothing is selected any more
      const several = picked.has(t.dataset.path) && picked.size > 1;
      if (!several && picked.size) pick([]);
      core.fileMenu(t, e.clientX, e.clientY, several ? "ovmany" : t.dataset.dir ? "ovdir" : "ovnote");
    }
    // the empty room: a new note or folder, in the folder shown
    else if (!t && core.folder && !e.target.closest(".ov-seg, .ov-crumb")) core.fileMenu(el, e.clientX, e.clientY, "blank", scope === "folders" ? place(tree()).path : core.folder.root);
  });
  // a note's name, changed where it stands (the menu's Rename, F2)
  function rename(t) {
    const label = t.querySelector(".ov-name");
    if (t.querySelector(".ov-rename")) return;
    const stem = t.dataset.dir ? t.dataset.dir : t.dataset.path.replace(/^.*\//, "").replace(/\.[^.]+$/, ""); // (a folder has no ending to keep)
    const input = document.createElement("input");
    input.className = "sb-field ov-rename";
    input.type = "text"; input.value = stem; input.spellcheck = false; input.autocomplete = "off";
    input.setAttribute("aria-label", "File name");
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim(), focused = document.activeElement === input;
      input.remove();
      label.hidden = false;
      if (focused) t.focus({ preventScroll: true });
      if (commit && name && name !== stem) post("rename", { path: t.dataset.path, name });
    };
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      e.stopPropagation(); // (not the tiles' keys)
      if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(true)); // clicking away keeps the name, like Finder
    label.hidden = true;
    label.after(input);
    input.focus({ preventScroll: true });
    input.select();
  }
  // the tile in that direction: the nearest one whose middle lies there (the grids differ in their columns)
  function toward(from, dx, dy) {
    const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, score = Infinity;
    for (const t of items) {
      if (t === from) continue;
      const r = t.getBoundingClientRect(), x = r.left + r.width / 2 - ax, y = r.top + r.height / 2 - ay;
      const along = dx ? x * dx : y * dy, across = Math.abs(dx ? y : x);
      if (along <= 1 || (dx && across > a.height / 2) || (dx && layout === "list")) continue;
      const s = along + across * 3;
      if (s < score) { score = s; best = t; }
    }
    return best;
  }
  el.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "a" && !e.target.closest("input")) { e.preventDefault(); e.stopPropagation(); pick(items.map((t) => t.dataset.path)); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tile = e.target.closest?.(".ov-item");
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (picked.size) pick([]); else if (core.current) close(); return; }
    if (e.key === "Backspace" && up()) { e.preventDefault(); return; }
    if (e.key === "Delete" && picked.size > 1) { e.preventDefault(); many("trash"); return; }
    if (!tile) return;
    if (e.key === "F2") { e.preventDefault(); rename(tile); return; }
    if (e.key === "Delete") { e.preventDefault(); post("trash", { path: tile.dataset.path }); pick([]); return; }
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      const r = tile.getBoundingClientRect(), several = picked.has(tile.dataset.path) && picked.size > 1;
      core.fileMenu(tile, r.left + 24, r.top + 24, several ? "ovmany" : tile.dataset.dir ? "ovdir" : "ovnote");
      return;
    }
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d || e.key === "Tab") el.dataset.keys = ""; // (from here the keyboard's place shows: a ring around its tile)
    if (d) {
      e.preventDefault();
      const next = toward(tile, d[0], d[1]);
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(tile); }
  });
  el.addEventListener("pointermove", () => { delete el.dataset.keys; }); // (the pointer takes over: no ring)
  // a note chosen in the sidebar while the tiles show: the note
  document.getElementById("sidebar")?.addEventListener("click", (e) => { if (e.target.closest(".sb-item:not(.is-dir) > .sb-in > .sb-row")) close(false); });

  window.MdOverview = { open, close, toggle, previews, go, rename, many, get picked() { return [...picked]; }, pick, folderChanged: () => { if (isOpen()) build(); }, get isOpen() { return isOpen(); } };
})();
