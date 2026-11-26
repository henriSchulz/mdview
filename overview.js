/* mdview — all notes of the folder as tiles (folder windows; the toolbar's
 * grid button, Ctrl+Alt+G). A tile is the note as a small sheet of paper: the
 * beginning of what it says, rendered as the reading view renders it, and under
 * the sheet its name and when it was changed. A folder is a stack of sheets, in
 * its colour and with its sign. A note whose properties name a colour
 * (`color: red` — one of the theme's) has a dot in that colour before its name.
 *
 * It shows one folder at a time, its folders to click into; notes that say `top: true` stand
 * apart at its head, large. One choice at the head, remembered: as tiles or as a list (a row per
 * note: its sheet in small, its name, under it its first words, at the end when it was changed).
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
 * Copy, Cut, Paste and Duplicate (Ctrl+C, X, V, D) work on the tile the keyboard is on, or on
 * all that are selected; files pulled in from elsewhere are copied into the folder shown.
 *
 * Keys: arrows move among the tiles, Enter or Space opens one, Backspace goes
 * up a folder, F2 renames, Delete moves to the trash, Ctrl+A selects all, Esc lets the
 * selection go and then closes. */
"use strict";
(() => {
  const core = window.MdView.core;
  const T = window.MdStrings.t;
  const { md, stripFrontmatter, stripComments, esc, post, DECO_COLORS, UI: ICON } = core;
  const BATCH = 40;
  const FILEWORK = core.filework; // (the host works with files as files: the application on a folder of this computer, the web app on a repository — viewer/base.js)

  const el = document.createElement("section");
  el.id = "overview";
  el.setAttribute("aria-label", "All notes");
  const seg = (name, label, opts) => `<div class="ov-seg" role="radiogroup" data-seg="${name}" aria-label="${label}" style="--n:${opts.length}"><span class="ov-thumb"></span>` +
    opts.map(([v, text, icon]) => `<button class="ov-opt" role="radio" data-v="${v}" aria-checked="false"${icon ? ` title="${text}" aria-label="${text}"` : ""}>${icon ? ICON[icon] : text}</button>`).join("") + `</div>`;
  // the head, as Craft's "All Docs" has it: the plus before the name, at the right the choices in a
  // raised field of their own, and "…" for the rest (the order, what is listed beside the notes)
  const DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>';
  el.innerHTML = `<header class="ov-head"><button class="ov-add" type="button" title="${esc(T("New note or folder"))}" aria-label="${esc(T("New note or folder"))}" data-label="${esc(T("New Note"))}">${ICON.plus}</button>` +
    `<h1 class="ov-title"></h1><span class="ov-count"></span><span class="ov-space"></span><span class="ov-tools">` + // (the choices and buttons go to a new line together, never one by one)
    `<span class="ov-acts">` + seg("layout", "View", [["tiles", "Tiles", "apps"], ["list", "List", "list"]]) + // (the view and the two buttons are one: they go to a new line together, never "…" alone — #56)
    `<button class="ov-more" type="button" title="${esc(T("Sort and show"))}" aria-label="${esc(T("Sort and show"))}" aria-haspopup="menu">${DOTS}</button></span></span>` +
    `</header><div class="ov-body"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector(".ov-body");
  const pressed = (on) => document.querySelectorAll('[data-act="overview"]').forEach((b) => b.setAttribute("aria-pressed", String(on))); // (the toolbar's button, the tabs' house)

  const cache = new Map();   // path -> { mtime, html, color }
  const tiles = new Map();   // path -> the note's element (a tile or a row)
  let items = [];            // notes and folders as they stand, for the arrow keys
  let queue = [], waiting = false, focusBack = null;
  let layout = "tiles"; // (the settings' ovLayout)
  let at = [];               // the names of the folders gone into, from the root
  const isOpen = () => el.hasAttribute("data-open");
  const picked = new Set();  // the paths of what is selected
  // the folder as All Notes lists it: the notes, and the other files its own settings ask for
  const tree = () => core.listed(core.folder.all || core.folder.tree, "ov");
  const here = () => place(tree()).path; // the folder shown: where something new goes
  // notes first, in the sidebar's order; then the other files, by name
  const ordered = (notes) => [...core.sortNotes(notes.filter((n) => !n.pdf)), ...notes.filter((n) => n.pdf)];

  // [notes, other files] in a folder and below it
  const count = (node) => node.dirs.reduce((n, d) => { const c = count(d); return [n[0] + c[0], n[1] + c[1]]; }, [node.notes.filter((n) => !n.pdf).length, node.notes.filter((n) => n.pdf).length]);
  const plural = (n, one) => T(n === 1 ? "1 " + one : "{0} " + one + "s", n); // ("1 note", "{0} notes": the strings' own keys)
  const says = ([notes, files]) => [notes || !files ? T(notes === 1 ? "1 note" : "{0} notes", notes) : "", files ? T(files === 1 ? "1 file" : "{0} files", files) : ""].filter(Boolean).join(", ");
  const KIND = { pdf: "PDF", slides: "Presentation", image: "Picture", audio: "Sound", video: "Video", board: "Whiteboard" };
  const paged = (kind) => kind === "pdf" || kind === "slides"; // (shown in the PDF viewer: a PDF, a presentation as the PDF made of it)
  const kindOf = (n) => (n.book ? "Notebook" : KIND[n.kind]) || ((/\.([A-Za-z0-9]{1,8})$/.exec(n.name) || [, ""])[1].toUpperCase() + " file").trim();
  // when a note was changed, as the sidebar says it — today's with the word before the time
  const when = (secs) => { const w = core.when(secs), d = new Date(); return w && secs * 1000 >= new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() ? T("Today") + ", " + w : w; };
  /* A PDF shows its first page, as a note shows its beginning: drawn when its tile comes near the window (viewer/modes.js: pdfShot
   * — one PDF after the other, kept for as long as the window is). Until then, and where a PDF cannot be read, the tile has the
   * PDF's sign. */
  const pdfShot = window.MdPage.pdfShot, shotOf = (n) => pdfShot.now(n.real || n.path, n.mtime || n.v);
  async function shoot(t) {
    const src = await pdfShot(t.dataset.file, t.dataset.shot), box = t.querySelector(".ov-pic, .ov-mini");
    delete t.dataset.shot;
    if (!src || !box || !t.isConnected) return;
    const img = new Image();
    img.alt = ""; img.draggable = false; img.className = "ov-shot"; img.src = src;
    await img.decode().catch(() => {});
    box.replaceChildren(img);
    requestAnimationFrame(() => img.classList.add("on")); // (it fades in over the sheet: overview.css)
  }
  // a file's picture: shown when it has come (overview.css), also one that was there before the tile was
  el.addEventListener("load", (e) => { if (e.target.tagName === "IMG" && e.target.closest(".ov-pic, .ov-mini")) e.target.classList.add("on"); }, true);
  /* … and one that cannot be shown has the file's sign in its place: not the web view's broken picture,
   * a "?" (Henri, 2026-11-04, a notebook's tile). */
  el.addEventListener("error", (e) => {
    const img = e.target, box = img.tagName === "IMG" && img.closest(".ov-pic, .ov-mini"), t = box && img.closest(".ov-item");
    if (t) box.innerHTML = `<span class="ov-icon">${signOf(t.dataset.book != null ? { book: true } : { path: t.dataset.path })}</span>`;
  }, true);
  const shotNear = typeof IntersectionObserver === "function" ? new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) { shotNear.unobserve(e.target); shoot(e.target); }
  }, { rootMargin: "300px 0px" }) : null;
  const signOf = (n) => (n.book ? ICON.notebook : core.rowIcon(n.path)); // (a file's sign: a notebook's its own, though its file is a whiteboard's)
  const urlOf = (path) => (window.MdHost?.files || "file://") + path.split("/").map(encodeURIComponent).join("/");
  // the folder shown: as far down `at` as the tree still goes
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
    const box = el.querySelector('[data-seg="layout"]'), opts = [...box.querySelectorAll(".ov-opt")];
    opts.forEach((o) => o.setAttribute("aria-checked", String(o.dataset.v === layout)));
    box.style.setProperty("--n", opts.length);
    box.style.setProperty("--i", Math.max(0, opts.findIndex((o) => o.dataset.v === layout)));
  }
  // (Velum Refined and Focus: All Notes as the lab draws it — a flat grid, each tile's folder beside when)
  const labLook = () => !!document.documentElement.dataset.velumLook && !!document.documentElement.dataset.velum;
  const folderOf = (n) => { const rel = n.path.slice(core.folder.root.length + 1).split("/"); return rel.length > 1 ? rel[rel.length - 2] : core.folder.name; };
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
    if (n.book) t.dataset.book = ""; // (a whiteboard of pages: named and signed so)
    if (picked.has(n.path)) t.classList.add("picked");
    if (n.hidden) t.classList.add("is-hidden"); // (put away, and shown all the same: dimmed)
    if (!dir && n.top) t.classList.add("is-top"); // (first in its folder, by its own property "top: true": marked)
    if (n.coming) t.classList.add("is-coming"); // (on its way into the repository)
    if (n.kept) t.dataset.kept = ""; // (a whiteboard a note keeps: the note's, not a file to move or trash)
    if (n.note) t.dataset.note = n.note;
    const name = esc(dir ? n.name : n.title || n.name), sub = dir ? says(count(n)) : n.says != null ? esc(n.says) : file ? esc(kindOf(n)) : "";
    const look = dir ? core.folderLook(n.path) : null; // (a folder's own colour and sign, as the sidebar has them)
    if (look && look.color) t.style.setProperty("--c", look.color);
    const sign = `<span class="ov-icon">${dir ? look.sign : file ? signOf(n) : ICON.note}</span>`;
    const shot = file && paged(n.kind) ? shotOf(n) : null; // (a PDF's first page, where it was drawn before; a presentation's first slide)
    const pic = shot ? `<img src="${esc(shot)}" alt="" draggable="false">` : file && (n.kind === "image" || n.kind === "board") ? `<img src="${esc(urlOf(n.path) + (n.v ? "?v=" + n.v : ""))}" alt="" loading="lazy" draggable="false">` : "";
    if (file && paged(n.kind) && !shot) { t.dataset.shot = String(n.mtime || n.v || 0); t.dataset.file = n.real || n.path; }
    // a row: the note's sheet in small, its name, under it its first words, at the end when it was changed
    if (list) t.innerHTML = `<span class="ov-mini">${dir || file ? pic || sign : `<span class="ov-prev" inert></span>`}</span><span class="ov-text"><span class="ov-name">${name}</span><span class="ov-snip">${sub}</span></span>` +
      (dir ? `<span class="ov-go">${ICON.chevron}</span>` : `<span class="ov-when">${esc(when(n.mtime))}</span>`);
    // a tile: a folder is a stack of sheets, a note its sheet, any other file a sheet with its picture or its sign — the name under it
    else t.innerHTML = (dir ? `<div class="ov-stack"><i></i><i></i><i>${sign}</i></div>` : file ? `<div class="ov-sheet"><div class="ov-pic">${pic || sign}</div></div>` : `<div class="ov-sheet"><div class="ov-prev" inert></div></div>`) +
      `<div class="ov-name">${name}</div><div class="ov-sub">${!dir && n.says == null && labLook() ? esc(folderOf(n) + " · " + when(n.mtime || n.v)) : dir || file ? sub : esc(when(n.mtime))}</div>`; // (what a tile says of itself — a whiteboard's note — stays)
    return t;
  }
  /* A top note ("top: true"), apart at the head of its folder: a broad card — its sheet at the left, beside it its name
   * large, its first words and when it was changed. An .ov-item as any other: a click, a right click, the keys. */
  function topCard(n, i) {
    const t = item(n, i, false);
    t.className = t.className.replace(/ov-(tile|row)\b/, "ov-top");
    t.innerHTML = `<span class="ov-sheet"><span class="ov-prev" inert></span></span><span class="ov-text"><span class="ov-name">${esc(n.title || n.name)}</span>` +
      `<span class="ov-snip"></span><span class="ov-when">${esc(when(n.mtime))}</span></span>`;
    return t;
  }
  /* done: called once every tile is there (they are made a part at a time — all at once where they are made anew in place,
   * whole: the list must not grow shorter under a window scrolled down it). */
  function build(done, whole = false) {
    const folder = core.folder;
    if (!folder) return;
    setSegs();
    el.dataset.layout = layout;
    const here = core.current && core.current.path;
    const title = el.querySelector(".ov-title");
    el.dataset.scope = "folders";
    const node = place(tree());
    // the way here, to click back along
    title.innerHTML = [folder.name, ...at].map((name, i, all) => (i < all.length - 1
      ? `<button class="ov-crumb" data-up="${all.length - 1 - i}">${esc(name)}</button><span class="ov-sep">${ICON.chevron}</span>` : `<span>${esc(name)}</span>`)).join("");
    const notes = ordered(node.notes), total = notes.length + node.dirs.length;
    el.querySelector(".ov-count").textContent = [node.dirs.length ? plural(node.dirs.length, "folder") : "", says([notes.filter((n) => !n.pdf).length, notes.filter((n) => n.pdf).length])].filter(Boolean).join(", ");
    body.textContent = "";
    tiles.clear();
    items = [];
    const run = ++buildRun;
    if (!total) { body.innerHTML = core.emptyState(); saidWhere(); built(done); return; }
    // the folders and the notes in their order — made a part at a time: the first ones at once, the
    // rest in the frames after (a folder's 417 notes made and laid out in one go held the first frame back 300 ms and more)
    // (a note that says "top: true" stands apart at the head, large: topCard)
    const apart = notes.filter((n) => n.top), steps = [];
    if (apart.length) { steps.push(["tops"]); for (const n of apart) steps.push(["note", n]); }
    steps.push(["group"]);
    for (const d of node.dirs) steps.push(["dir", d]);
    for (const n of notes) if (!n.top) steps.push(["note", n]);
    let i = 0, grid = null, at0 = 0;
    const later = [];
    const make = (count) => {
      let made = 0;
      for (; at0 < steps.length && made < count; at0++) {
        const [kind, x] = steps[at0];
        if (kind === "tops") {
          grid = document.createElement("div");
          grid.className = "ov-tops";
          body.appendChild(grid);
          continue;
        }
        if (kind === "group") {
          grid = document.createElement("div");
          grid.className = layout === "list" ? "ov-list" : "ov-grid";
          body.appendChild(grid);
          continue;
        }
        made++;
        if (kind === "dir") { const t = item(x, i++, true); grid.appendChild(t); items.push(t); continue; }
        const t = grid.className === "ov-tops" ? topCard(x, i++) : item(x, i++, false);
        if (x.real === here || x.path === here) t.setAttribute("aria-current", "page");
        const known = !x.pdf && cache.get(x.path);
        if (known) { if (i <= FIRST) paint(t, known); else later.push([t, known]); } // (the first at once, the rest a few at a time: paintLater)
        grid.appendChild(t);
        if (t.dataset.shot && shotNear) shotNear.observe(t);
        if (!x.pdf) tiles.set(x.path, t); // (a note: its beginning is asked for)
        items.push(t);
      }
      for (const img of body.querySelectorAll(":is(.ov-pic, .ov-mini) > img:not(.on)")) if (img.complete) img.classList.add("on");
    };
    const finish = () => {
      // (what is selected and no longer there is selected no more)
      const there = new Set(items.map((t) => t.dataset.path));
      for (const p of [...picked]) if (!there.has(p)) picked.delete(p);
      queue = [...queue, ...[...tiles.keys()].filter((p) => !first.has(p))];
      paintLater(later);
      ask();
      built(done);
    };
    make(whole ? steps.length : BUILD_FIRST);
    const first = new Set(tiles.keys());
    queue = [...first]; // (the beginnings of the first asked for at once)
    saidWhere();
    ask();
    if (at0 >= steps.length) return finish();
    const more = () => {
      if (run !== buildRun) return;
      make(BUILD_EACH);
      if (at0 < steps.length) requestAnimationFrame(more); else finish();
    };
    requestAnimationFrame(more);
  }
  const BUILD_FIRST = 48, BUILD_EACH = 96;
  let buildRun = 0;
  const built = (done) => { if (done) done(); };
  /* The beginnings already known, put into their sheets a few at a time after the first ones — so that the tiles come at once
   * (Henri, 2026-10-14: switching to All Notes "always lags"); the ones under the window are not wanted yet anyway. A build anew
   * stops what the last one had left. */
  const FIRST = 36, EACH = 24;
  let paintRun = 0;
  function paintLater(list) {
    const run = ++paintRun;
    const step = () => {
      if (run !== paintRun) return;
      for (const [t, known] of list.splice(0, EACH)) if (t.isConnected && !t.querySelector(".ov-prev")?.innerHTML) paint(t, known);
      if (list.length) requestAnimationFrame(step);
    };
    if (list.length) requestAnimationFrame(step);
  }
  // a choice at the head, or a folder gone into or left: built anew, the keyboard's place kept in it
  function rebuild(focus) {
    const had = el.contains(document.activeElement);
    let stand = null; // (the tile the keyboard was put on while the one it is to be on was not made yet)
    build(() => { const to = stand && focus && items.find(focus); if (to && document.activeElement === stand) to.focus({ preventScroll: true }); });
    el.scrollTop = 0;
    const to = (focus && items.find(focus)) || body.querySelector(".ov-item[aria-current]") || items[0];
    if (had && to) { to.focus({ preventScroll: true }); if (focus && !focus(to)) stand = to; }
  }
  /* The folder changed under the tiles (a paste, a file from elsewhere): built anew where they stand, the keyboard on the tile
   * it was on (Henri, 2026-10-28: "Strg + C, Strg + V, Strg + X klappt nicht im All notes view", #11 — the tiles were new and
   * the focus on none of them: the next keys went to the page, not to All Notes). */
  function refresh() {
    const on = el.contains(document.activeElement) && document.activeElement.closest(".ov-item"), path = on && on.dataset.path;
    build(null, true); // (in place: whole, the window stays where it is scrolled to)
    if (!on) return;
    const to = items.find((t) => t.dataset.path === path) || body.querySelector(".ov-item[aria-current]") || items[0];
    if (to) to.focus({ preventScroll: true });
  }
  let chosenAt = 0;
  function choose(v) {
    if (layout === v) return;
    layout = v;
    window.MdPrefs = { ...(window.MdPrefs || {}), ovLayout: v };
    post("prefs", { prefs: { ovLayout: v } });
    // the choice answers at once — its thumb goes there, what was shown dims — and the tiles come a frame later
    setSegs();
    body.classList.add("ov-going");
    const mine = ++chosenAt;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (mine !== chosenAt || !isOpen()) return; body.classList.remove("ov-going"); rebuild(); }));
  }
  function up(levels = 1) {
    if (!at.length) return false;
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
  function paint(tile, p, fade = false) {
    const prev = tile.querySelector(".ov-prev"), snip = tile.querySelector(".ov-snip");
    if (prev) {
      const was = prev.innerHTML;
      prev.innerHTML = p.html;
      // (a beginning that comes while the tile is there fades in over its skeleton: overview.css)
      if (fade && !was && p.html) { prev.classList.remove("ov-in"); void prev.offsetWidth; prev.classList.add("ov-in"); }
    }
    if (snip) snip.textContent = p.text;
    for (const c of DECO_COLORS) tile.classList.toggle("ov-" + c, p.color === c);
    tile.classList.toggle("ov-empty", !p.html);
  }
  function previews(got) {
    waiting = false;
    for (const [path, p] of Object.entries(got || {})) {
      const known = cache.get(path);
      if (known && known.mtime === p.mtime) continue; // unchanged: as it is
      const made = { mtime: p.mtime, ...window.MdPage.previewOf(path, p.text || "") };
      cache.set(path, made);
      const tile = tiles.get(path);
      if (tile) paint(tile, made, true);
    }
    ask();
  }

  /* All Notes opens on the folders: where the note on screen lies, or where it is asked for (to). */
  function open(to = null) {
    if (isOpen() || !core.folder) return;
    focusBack = document.activeElement;
    const prefs = window.MdPrefs || {};
    layout = prefs.ovLayout === "list" ? "list" : "tiles";
    // it opens where the note on screen lies (place() drops what the tree does not have)
    const root = core.folder.root, shown = core.current && core.current.path;
    at = to ? to.at : shown && shown.startsWith(root + "/") ? shown.slice(root.length + 1).split("/").slice(0, -1) : [];
    picked.clear();
    clearTimeout(restTimer);
    delete el.dataset.rest;
    let stand = null; // (the note on screen among the tiles made later: the keyboard and the eye go to it once it is there)
    build(() => { const cur = stand && body.querySelector(".ov-item[aria-current]"); if (cur && document.activeElement === stand) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: "nearest" }); } });
    // (the tiles are there, unseen: from here they come in — their styles taken as they are before, not their layout: the
    // layout of 417 rows asked for here, and again by a scroll put back to the top, took 130 ms before the first frame)
    void getComputedStyle(el).opacity;
    el.dataset.open = "";
    delete el.dataset.keys;
    core.lockScroll(true); // (the note under the tiles holds still)
    document.body.dataset.overview = "";
    pressed(true);
    if (scrolled) { el.scrollTop = 0; scrolled = false; }
    const cur = body.querySelector('.ov-item[aria-current]') || items[0];
    if (cur) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: "nearest" }); if (!cur.hasAttribute("aria-current") && core.current) stand = cur; }
    ask();
    // (the sidebar marks where All Notes stands — it asked as the rows were made, before All Notes was open: opened at a
    // folder's row, the note's folder stayed marked, once the row's All Notes was built only once — web/test/library.test.mjs)
    document.dispatchEvent(new Event("mdoverview"));
  }
  /* Shut, All Notes rests once it has faded: what is in it is neither styled nor laid out again (data-rest: content-visibility)
   * — every row of a folder's 400 notes was laid out anew at each change of the window's size, unseen. */
  let restTimer = 0, scrolled = false;
  el.addEventListener("scroll", () => { scrolled = el.scrollTop > 0; }, { passive: true });
  function close(refocus = true) {
    if (!isOpen()) return false;
    delete el.dataset.open;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => { if (!isOpen()) el.dataset.rest = ""; }, 700); // (once its fading — --dur-overview-exit — is long over)
    core.lockScroll(false);
    delete document.body.dataset.overview;
    document.dispatchEvent(new Event("mdoverview"));
    pressed(false);
    if (refocus && focusBack && focusBack.isConnected && focusBack !== document.body) focusBack.focus({ preventScroll: true });
    focusBack = null;
    return true;
  }
  // (an empty tab has nothing under the tiles: they stay until a note is chosen)
  const toggle = () => (!isOpen() ? open() : core.current ? close() : false);
  // tab: in a tab of its own (Ctrl held, the middle button)
  function go(tile, tab = false) {
    if (tile.dataset.dir && tab && core.folderTab) { core.folderTab(tile.dataset.path); return; } // (a folder in a tab of its own: viewer/tabs.js)
    if (tile.dataset.dir) { at.push(tile.dataset.dir); picked.clear(); rebuild(); return; }
    const path = tile.dataset.path;
    // (a picture, a film, any other file opens in its own application: the tiles stay)
    if (tile.dataset.kind && !paged(tile.dataset.kind)) { post("note", { path }); return; }
    close(false);
    core.going(path);
    post("note", { path, tab });
  }


  // ------------------------------------------------------------ several at once
  const mark = () => { for (const t of items) t.classList.toggle("picked", picked.has(t.dataset.path)); el.toggleAttribute("data-picked", picked.size > 0); };
  // (a whiteboard a note keeps is the note's: never among what is moved, copied or trashed together)
  const pick = (paths) => { const kept = new Set(items.filter((t) => t.dataset.kept != null).map((t) => t.dataset.path)); picked.clear(); for (const p of paths) if (!kept.has(p)) picked.add(p); mark(); };
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
    const notes = all.filter((t) => !t.dataset.dir && (!t.dataset.kind || paged(t.dataset.kind)));
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
    // the + : a new note or folder, in the folder shown; "…": the order, and what is listed (the menu the empty room has)
    if (add && core.folder) { const r = add.getBoundingClientRect(); core.fileMenu(add, r.left, r.bottom + 6, "ovnew", here()); }
    else if (more && core.folder) { const r = more.getBoundingClientRect(); core.fileMenu(more, r.right - 200, r.bottom + 6, "blank", here()); }
    else if (opt) choose(opt.dataset.v);
    else if (crumb) up(Number(crumb.dataset.up));
  });
  /* Files from elsewhere — a file manager, another application — pulled over the tiles: copied into
   * the folder shown, or the folder whose tile they are let go on (the shell: import). */
  const foreign = (e) => FILEWORK && !core.moving.path && [...(e.dataTransfer?.types || [])].some((t) => t === "text/uri-list" || t === "Files");
  el.addEventListener("dragover", (e) => { if (isOpen() && foreign(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setInto(e.target.closest?.(".ov-item[data-dir]") || null); } });
  el.addEventListener("drop", (e) => {
    if (!isOpen() || !foreign(e)) return;
    e.preventDefault();
    const t = e.target.closest?.(".ov-item[data-dir]"), uris = (e.dataTransfer.getData("text/uri-list") || "").split(/\r?\n/).map((u) => u.trim()).filter((u) => /^file:/.test(u));
    setInto(null);
    if (core.addFiles(e.dataTransfer, t ? t.dataset.path : here())) return; // (a browser has the files themselves)
    if (uris.length) post("import", { uris, dir: t ? t.dataset.path : here() });
  });
  // a tile dragged onto a folder's tile: moved into that folder (the sidebar's rows do the same: core.moving)
  let into = null;
  const setInto = (t) => { if (into === t) return; if (into) into.classList.remove("drop-into"); into = t; if (t) t.classList.add("drop-into"); };
  const folderAt = (e) => { const t = e.target.closest?.(".ov-item[data-dir]"); return t && core.moving.can(t.dataset.path) ? t : null; };
  body.addEventListener("dragstart", (e) => {
    const t = e.target.closest?.(".ov-item");
    if (!t || e.target.closest(".ov-rename") || t.dataset.kept != null) { e.preventDefault(); return; }
    // (one of several that are selected: they all go; any other: it alone, and nothing is selected any more)
    const all = picked.has(t.dataset.path) && picked.size > 1 ? items.filter((x) => picked.has(x.dataset.path)) : [t];
    if (all.length === 1 && picked.size) pick([]);
    for (const x of all) x.classList.add("dragged");
    // (its picture over the whole window, not inside All Notes: the sidebar stands above All Notes, and the picture is pulled over it)
    core.moving.start(e, t.dataset.path, t, all.map((x) => x.dataset.path), { into: document.body });
  });
  body.addEventListener("dragover", (e) => { if (foreign(e)) return; const t = folderAt(e); setInto(t); if (t) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } });
  body.addEventListener("dragleave", (e) => { if (!body.contains(e.relatedTarget)) setInto(null); });
  body.addEventListener("drop", (e) => { if (foreign(e)) return; const t = folderAt(e); setInto(null); if (t) { e.preventDefault(); core.moving.end(t.dataset.path); } });
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
    else if (!t && core.folder && !e.target.closest(".ov-seg, .ov-crumb")) core.fileMenu(el, e.clientX, e.clientY, "blank", place(tree()).path);
  });
  // a note's name, changed where it stands (the menu's Rename, F2)
  function rename(t) {
    const label = t.querySelector(".ov-name");
    if (t.querySelector(".ov-rename")) return;
    const stem = t.dataset.dir ? t.dataset.dir : t.dataset.path.replace(/^.*\//, "").replace(/(\.board)?\.[^.]+$/i, ""); // (a folder has no ending to keep; a whiteboard has two)
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
    // Copy, Cut, Paste, Duplicate — on the tile the keyboard is on, or on all that are selected; Paste: into the folder shown, or the folder the keyboard is on
    const fileKey = FILEWORK && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.target.closest("input") && { c: "copyf", x: "cutf", v: "pastef", d: "duplicate" }[e.key.toLowerCase()];
    if (fileKey) {
      const on = e.target.closest?.(".ov-item"), paths = on && picked.has(on.dataset.path) && picked.size > 1 ? [...picked] : on && on.dataset.kept == null ? [on.dataset.path] : [];
      if (fileKey !== "pastef" && !paths.length) return;
      e.preventDefault(); e.stopPropagation();
      core.fileCmd(fileKey, paths, on && on.dataset.dir ? on.dataset.path : here());
      if (fileKey === "cutf") pick([]);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tile = e.target.closest?.(".ov-item");
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (picked.size) pick([]); else if (core.current) close(); return; }
    if (e.key === "Backspace" && up()) { e.preventDefault(); return; }
    if (e.key === "Delete" && picked.size > 1) { e.preventDefault(); many("trash"); return; }
    if (!tile) return;
    if ((e.key === "F2" || e.key === "Delete") && tile.dataset.kept != null) return; // (a whiteboard a note keeps is the note's)
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

  // where one is, for back and forward (viewer/tabs.js): this choice, in this folder
  const saidWhere = () => { core.navHere({ all: true, at: [...at], scope: "folders" }); document.dispatchEvent(new Event("mdoverview")); }; // (built: open, or opening — and the sidebar's library marks its row: viewer/sidebar.js)
  /* Back or forward to All Notes as it stood: in that folder (viewer/tabs.js) */
  function showAt(where) {
    if (!core.folder) return;
    // (shut, it opens right there — built once: built where the note lies and then again here, a folder's row in the sidebar
    // took twice the time of its tiles)
    if (!isOpen()) return open({ at: [...where] });
    at = [...where];
    picked.clear();
    rebuild();
  }
  window.MdOverview = { open, close, showAt, toggle, where: () => (isOpen() ? { scope: "folders", at: [...at] } : null), previews, go, rename, many, get picked() { return [...picked]; }, pick, folderChanged: () => { if (isOpen()) refresh(); }, get isOpen() { return isOpen(); } };
})();
