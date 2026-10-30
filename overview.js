/* mdview — all notes of the folder as tiles (folder windows; the toolbar's
 * grid button, Ctrl+Alt+G). A tile is the note as a small sheet of paper: the
 * beginning of what it says, rendered as the reading view renders it, and under
 * the sheet its name and when it was changed. A folder is a stack of sheets, in
 * its colour and with its sign. A note whose properties name a colour
 * (`color: red` — one of the theme's) has a dot in that colour before its name.
 *
 * Two choices at the head, both remembered: what is shown — all notes, grouped
 * by the folder they lie in, or one folder at a time, its folders to click
 * into — and how: as tiles or as a list (a row per note: its sheet in small, its name, under it its
 * first words, at the end when it was changed).
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
 * A third choice at the head shows the folder's whiteboards and nothing else — those that are files
 * of their own and those a note keeps (which no list of the folder shows): all of them, those a
 * note shows, or those none does. The application is asked for them (boards) when they are shown.
 *
 * A fourth choice is no list of notes at all: the project's pasteboard — a small chat of blocks of
 * text, the same on every device that shows the project, to carry something from one to another.
 * What is pasted or typed is a block of its own, with where it came from and a Copy; it is there on
 * the others within a moment, and what two wrote at once is both there. The
 * host keeps it (the web app's server: web/lib/paste.ts) and is asked for it while it shows.
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
  el.innerHTML = `<header class="ov-head"><button class="ov-add" type="button" title="${esc(T("New note or folder"))}" aria-label="${esc(T("New note or folder"))}">${ICON.plus}</button>` +
    `<h1 class="ov-title"></h1><span class="ov-count"></span><span class="ov-space"></span><span class="ov-tools">` + // (the choices and buttons go to a new line together, never one by one)
    seg("scope", "Show", [["home", T("Home")], ["all", T("All Notes")], ["folders", T("Folders")], ...(FILEWORK ? [["boards", T("Whiteboards")]] : [])]) + seg("layout", "View", [["tiles", "Tiles", "apps"], ["list", "List", "list"]]) +
    // the pasteboard is no way of showing the notes: a tab of its own (viewer/tabs.js: pasteTab), opened from its button
    `<button class="ov-pastebtn" type="button" title="${esc(T("Pasteboard"))}" aria-label="${esc(T("Pasteboard"))}">${ICON.clip || ICON.copy || ""}</button>` +
    `<button class="ov-more" type="button" title="${esc(T("Sort and show"))}" aria-label="${esc(T("Sort and show"))}" aria-haspopup="menu">${DOTS}</button></span>` +
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
  let boardList = null;      // scope "boards": the folder's whiteboards as the application last told them (null: not yet)
  let boardShow = "all";     // … and which of them: "all" | "embedded" (a note shows them) | "loose" (settings: ovBoardsShow)
  // the folder as All Notes lists it: the notes, and the other files its own settings ask for
  const tree = () => core.listed(core.folder.all || core.folder.tree, "ov");
  const here = () => (scope === "folders" ? place(tree()).path : core.folder.root); // the folder shown: where something new goes
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
  const plural = (n, one) => T(n === 1 ? "1 " + one : "{0} " + one + "s", n); // ("1 note", "{0} notes": the strings' own keys)
  const says = ([notes, files]) => [notes || !files ? T(notes === 1 ? "1 note" : "{0} notes", notes) : "", files ? T(files === 1 ? "1 file" : "{0} files", files) : ""].filter(Boolean).join(", ");
  const KIND = { pdf: "PDF", slides: "Presentation", image: "Picture", audio: "Sound", video: "Video", board: "Whiteboard" };
  const paged = (kind) => kind === "pdf" || kind === "slides"; // (shown in the PDF viewer: a PDF, a presentation as the PDF made of it)
  const kindOf = (n) => KIND[n.kind] || ((/\.([A-Za-z0-9]{1,8})$/.exec(n.name) || [, ""])[1].toUpperCase() + " file").trim();
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
  el.addEventListener("error", (e) => { if (e.target.tagName === "IMG" && e.target.closest(".ov-pic, .ov-mini")) e.target.classList.add("on"); }, true);
  const shotNear = typeof IntersectionObserver === "function" ? new IntersectionObserver((list) => {
    for (const e of list) if (e.isIntersecting) { shotNear.unobserve(e.target); shoot(e.target); }
  }, { rootMargin: "300px 0px" }) : null;
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
    const home = homeOn();
    el.querySelector('[data-seg="scope"] [data-v="home"]').hidden = !home; // (Home: only with the setting — and the thumb counts what shows)
    for (const [name, v] of [["scope", scope], ["layout", layout], ["boards", boardShow]]) {
      const box = el.querySelector(`[data-seg="${name}"]`);
      if (!box) continue;
      const opts = [...box.querySelectorAll(".ov-opt")].filter((o) => !o.hidden);
      opts.forEach((o) => o.setAttribute("aria-checked", String(o.dataset.v === v)));
      box.style.setProperty("--n", opts.length);
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
    if (n.hidden) t.classList.add("is-hidden"); // (put away, and shown all the same: dimmed)
    if (n.coming) t.classList.add("is-coming"); // (on its way into the repository)
    if (n.kept) t.dataset.kept = ""; // (a whiteboard a note keeps: the note's, not a file to move or trash)
    if (n.note) t.dataset.note = n.note;
    const name = esc(dir ? n.name : n.title || n.name), sub = dir ? says(count(n)) : n.says != null ? esc(n.says) : file ? esc(kindOf(n)) : "";
    const look = dir ? core.folderLook(n.path) : null; // (a folder's own colour and sign, as the sidebar has them)
    if (look && look.color) t.style.setProperty("--c", look.color);
    const sign = `<span class="ov-icon">${dir ? look.sign : file ? core.rowIcon(n.path) : ICON.note}</span>`;
    const shot = file && paged(n.kind) ? shotOf(n) : null; // (a PDF's first page, where it was drawn before; a presentation's first slide)
    const pic = shot ? `<img src="${esc(shot)}" alt="" draggable="false">` : file && (n.kind === "image" || n.kind === "board") ? `<img src="${esc(urlOf(n.path) + (n.v ? "?v=" + n.v : ""))}" alt="" loading="lazy" draggable="false">` : "";
    if (file && paged(n.kind) && !shot) { t.dataset.shot = String(n.mtime || n.v || 0); t.dataset.file = n.real || n.path; }
    // a row: the note's sheet in small, its name, under it its first words, at the end when it was changed
    if (list) t.innerHTML = `<span class="ov-mini">${dir || file ? pic || sign : `<span class="ov-prev" inert></span>`}</span><span class="ov-text"><span class="ov-name">${name}</span><span class="ov-snip">${sub}</span></span>` +
      (dir ? `<span class="ov-go">${ICON.chevron}</span>` : `<span class="ov-when">${esc(when(n.mtime))}</span>`);
    // a tile: a folder is a stack of sheets, a note its sheet, any other file a sheet with its picture or its sign — the name under it
    else t.innerHTML = (dir ? `<div class="ov-stack"><i></i><i></i><i>${sign}</i></div>` : file ? `<div class="ov-sheet"><div class="ov-pic">${pic || sign}</div></div>` : `<div class="ov-sheet"><div class="ov-prev" inert></div></div>`) +
      `<div class="ov-name">${name}</div><div class="ov-sub">${dir || file ? sub : esc(when(n.mtime))}</div>`;
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
    el.dataset.scope = scope;
    pasteWatch(); // (asked for while it shows, and no longer than that)
    if (scope === "paste") {
      // the pasteboard: the same element for as long as it shows (what is typed, and the place in the list, stays) — in a tab of its own, named so
      title.textContent = T("Pasteboard");
      pressed(false); // (the house is All Notes', and this is not)
      el.querySelector(".ov-count").textContent = "";
      tiles.clear();
      items = [];
      if (pasteEl.parentNode !== body) { body.textContent = ""; body.appendChild(pasteEl); }
      saidWhere();
      return;
    }
    if (scope === "home" && !homeOn()) scope = "folders"; // (the setting turned off while Home showed)
    if (scope === "home") { buildHome(); return; }
    if (scope === "boards") {
      // the folder's whiteboards: asked for when they are shown, drawn when they come
      const all = boardList || [], name = (p) => p.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
      const shown = all.filter((b) => boardShow === "all" || (boardShow === "embedded") === b.in.length > 0);
      const notes = shown.map((b) => ({ path: b.path, real: b.path, name: b.name.replace(/\.board\.svg$/i, ""), pdf: true, kind: "board", v: Math.round(b.mtime), kept: b.kept, note: b.in[0] || "",
        says: b.in.length ? T("In “{0}”", name(b.in[0])) + (b.in.length > 1 ? " +" + (b.in.length - 1) : "") : T("In no note") }));
      title.textContent = folder.name;
      el.querySelector(".ov-count").textContent = boardList ? T(shown.length === 1 ? "1 whiteboard" : "{0} whiteboards", shown.length) : "";
      body.textContent = "";
      tiles.clear();
      items = [];
      setSegs();
      if (!shown.length) { body.insertAdjacentHTML("beforeend", `<div class="empty-state"><div class="empty-icon">${ICON.board}</div><b>${esc(T(boardList ? "No Whiteboards" : "Looking for Whiteboards…"))}</b>` + (boardList ? `<p>${esc(T("A whiteboard is made with the + above, or in a note with /whiteboard."))}</p>` : "") + `</div>`); saidWhere(); return; }
      const grid = document.createElement("div");
      grid.className = layout === "list" ? "ov-list" : "ov-grid";
      notes.forEach((n, i) => { const t = item(n, i, false); grid.appendChild(t); items.push(t); });
      body.appendChild(grid);
      const there = new Set(items.map((t) => t.dataset.path));
      for (const p of [...picked]) if (!there.has(p)) picked.delete(p);
      saidWhere();
      return;
    }
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
    if (!total) { body.innerHTML = core.emptyState(); saidWhere(); return; }
    let i = 0;
    const later = [];
    for (const g of gs) {
      if (g.label) { const h = document.createElement("h2"); h.className = "ov-dir"; h.textContent = g.label; body.appendChild(h); }
      const grid = document.createElement("div");
      grid.className = layout === "list" ? "ov-list" : "ov-grid";
      for (const d of g.dirs || []) { const t = item(d, i++, true); grid.appendChild(t); items.push(t); }
      for (const n of g.notes) {
        const t = item(n, i++, false);
        if (n.real === here || n.path === here) t.setAttribute("aria-current", "page");
        const known = !n.pdf && cache.get(n.path);
        if (known) { if (i <= FIRST) paint(t, known); else later.push([t, known]); } // (the first at once, the rest a few at a time: paintLater)
        grid.appendChild(t);
        if (t.dataset.shot && shotNear) shotNear.observe(t);
        if (!n.pdf) tiles.set(n.path, t); // (a note: its beginning is asked for)
        items.push(t);
      }
      body.appendChild(grid);
    }
    // (what is selected and no longer there is selected no more)
    const there = new Set(items.map((t) => t.dataset.path));
    for (const p of [...picked]) if (!there.has(p)) picked.delete(p);
    for (const img of body.querySelectorAll(":is(.ov-pic, .ov-mini) > img")) if (img.complete) img.classList.add("on");
    queue = [...tiles.keys()];
    paintLater(later);
    saidWhere();
    ask();
  }
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
    build();
    el.scrollTop = 0;
    const to = (focus && items.find(focus)) || body.querySelector(".ov-item[aria-current]") || items[0];
    if (had && to) to.focus({ preventScroll: true });
  }
  /* The folder changed under the tiles (a paste, a file from elsewhere): built anew where they stand, the keyboard on the tile
   * it was on (Henri, 2026-10-28: "Strg + C, Strg + V, Strg + X klappt nicht im All notes view", #11 — the tiles were new and
   * the focus on none of them: the next keys went to the page, not to All Notes). */
  function refresh() {
    const on = el.contains(document.activeElement) && document.activeElement.closest(".ov-item"), path = on && on.dataset.path;
    build();
    if (!on) return;
    const to = items.find((t) => t.dataset.path === path) || body.querySelector(".ov-item[aria-current]") || items[0];
    if (to) to.focus({ preventScroll: true });
  }
  let chosenAt = 0;
  function choose(name, v) {
    if (name === "scope") { if (scope === v) return; scope = v; at = []; picked.clear(); if (v === "boards") askBoards(); }
    else if (name === "boards") { if (boardShow === v) return; boardShow = v; picked.clear(); }
    else { if (layout === v) return; layout = v; }
    const key = name === "scope" ? "ovScope" : name === "boards" ? "ovBoardsShow" : "ovLayout";
    window.MdPrefs = { ...(window.MdPrefs || {}), [key]: v };
    post("prefs", { prefs: { [key]: v } });
    if (name === "scope" && v !== "paste") pasteSend();
    // the choice answers at once — its thumb goes there, what was shown dims — and the tiles come a frame later
    setSegs();
    body.classList.add("ov-going");
    const mine = ++chosenAt;
    requestAnimationFrame(() => requestAnimationFrame(() => { if (mine !== chosenAt || !isOpen()) return; body.classList.remove("ov-going"); rebuild(); if (name === "scope" && v === "paste") pasteText.focus({ preventScroll: true }); }));
  }
  function up(levels = 1) {
    if (scope !== "folders" || !at.length) return false;
    const from = at[at.length - levels];
    picked.clear();
    at = at.slice(0, at.length - levels);
    rebuild((t) => t.dataset.dir === from);
    return true;
  }

  /* The folder's whiteboards, asked of the application — and asked again a moment after something
   * may have changed them (one drawn on and shut, a file of the folder changed). */
  let boardsTimer = 0;
  function askBoards(soon) {
    clearTimeout(boardsTimer);
    if (!isOpen() || scope !== "boards") return;
    if (soon) boardsTimer = setTimeout(() => askBoards(), 700); else post("boards");
  }
  function boards(list) {
    boardList = Array.isArray(list) ? list : [];
    if (isOpen() && scope === "boards") { const had = el.contains(document.activeElement), y = el.scrollTop; build(); el.scrollTop = y; if (had) (items[0] || el).focus?.({ preventScroll: true }); }
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
      const made = { mtime: p.mtime, ...window.MdPage.previewOf(path, p.text || ""), tasks: openTasks(p.text) };
      cache.set(path, made);
      const tile = tiles.get(path);
      if (tile) paint(tile, made, true);
    }
    if (scope === "home" && isOpen()) homeTasks();
    ask();
  }

  /* Home (Settings › All Notes › Home, ovHome — the lab's ~/Projects/velum/lab/web/mdview.html, proposal B): what to go
   * on with, in cards. Continue: the notes opened last, as tiles. Open Tasks: the open tasks of the notes changed last, read
   * from their beginnings as they come (a task far down a long note is not seen). Today: the notes changed today. The
   * folders of the folder, each in its colour with its sign. The whiteboards and PDFs changed last. Every note, folder and
   * file on it is an .ov-item: a click, a right click, Ctrl+click and the keys do what they do on the tiles. */
  const homeOn = () => !!(window.MdPrefs || {}).ovHome;
  const HOME_CONTINUE = 3, HOME_TODAY = 6, HOME_TASKS = 6, HOME_SCAN = 30, HOME_FILES = 6;
  const openTasks = (text) => [...String(text || "").matchAll(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \][ \t]+(\S.*)$/gm)].map((m) => m[1].replace(/\s+$/, ""));
  const everyIn = (node) => [...node.notes, ...node.dirs.flatMap(everyIn)];
  const isNote = (n) => !n.pdf && /\.(md|markdown|mdown)$/i.test(n.path);
  let homeScan = [];         // the notes Home reads tasks from: the ones changed last
  function homeRow(n, right, sign) {
    const t = document.createElement("div");
    t.className = "ov-item ovh-row";
    t.tabIndex = 0; t.setAttribute("role", "link"); t.dataset.path = n.path; t.draggable = true;
    t.innerHTML = `<span class="ovh-sign">${sign || ICON.note}</span><span class="ovh-name">${esc(n.title || n.name)}</span><span class="ovh-right">${esc(right)}</span>`;
    return t;
  }
  function homeCard(cls, title, sub) {
    const c = document.createElement("section");
    c.className = "ovh-card " + cls;
    c.innerHTML = `<h2>${esc(title)}</h2>` + (sub ? `<p class="ovh-sub">${esc(sub)}</p>` : "");
    return c;
  }
  function buildHome() {
    const all = everyIn(tree()), notes = all.filter(isNote), here = core.current && core.current.path;
    const lang = (window.MdPrefs || {}).lang === "de" ? "de-DE" : "en-US", now = new Date(), midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    el.querySelector(".ov-title").textContent = T("Home");
    el.querySelector(".ov-count").textContent = now.toLocaleDateString(lang, { weekday: "long", month: "long", day: "numeric" }) + " · " + says(count(tree()));
    body.textContent = "";
    tiles.clear();
    items = [];
    if (!all.length) { body.innerHTML = core.emptyState(); saidWhere(); return; }
    const byChange = [...notes].sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
    const cont = [...notes].sort((a, b) => (b.opened || 0) - (a.opened || 0) || (b.mtime || 0) - (a.mtime || 0)).slice(0, HOME_CONTINUE);
    const today = byChange.filter((n) => (n.mtime || 0) * 1000 >= midnight).slice(0, HOME_TODAY);
    const cols = document.createElement("div"), left = document.createElement("div"), right = document.createElement("div");
    cols.className = "ovh-cols"; left.className = right.className = "ovh-col";
    let i = 0;
    const tile = (n) => {
      const t = item(n, i++, false);
      if (n.real === here || n.path === here) t.setAttribute("aria-current", "page");
      const known = !n.pdf && cache.get(n.path);
      if (known) paint(t, known);
      if (!n.pdf) tiles.set(n.path, t);
      if (t.dataset.shot && shotNear) shotNear.observe(t);
      return t;
    };
    // Continue
    const c1 = homeCard("ovh-continue", T("Continue"), T("Where you left off")), g1 = document.createElement("div");
    g1.className = "ov-grid";
    for (const n of cont) g1.appendChild(tile(n));
    c1.appendChild(g1); left.appendChild(c1);
    // Open Tasks (filled as the beginnings come: homeTasks)
    const c2 = homeCard("ovh-tasks", T("Open Tasks"), T("To-dos across the notes changed last"));
    c2.appendChild(Object.assign(document.createElement("div"), { className: "ovh-list ovh-tasklist" }));
    left.appendChild(c2);
    // Today
    const c3 = homeCard("ovh-today", T("Today"), today.length ? T(today.length === 1 ? "1 note changed today" : "{0} notes changed today", today.length) : T("Nothing changed today")), l3 = document.createElement("div");
    l3.className = "ovh-list";
    for (const n of today) l3.appendChild(homeRow(n, core.when(n.mtime)));
    c3.appendChild(l3); right.appendChild(c3);
    cols.append(left, right);
    body.appendChild(cols);
    // the folders
    const dirs = tree().dirs.filter((d) => !d.name.startsWith("."));
    if (dirs.length) {
      const h = Object.assign(document.createElement("h2"), { className: "ov-dir ovh-head", textContent: T("Folders") }), g = document.createElement("div");
      g.className = "ovh-folders";
      for (const d of dirs) {
        const look = core.folderLook(d.path), t = document.createElement("div");
        t.className = "ov-item ov-folder ovh-folder";
        t.tabIndex = 0; t.setAttribute("role", "link"); t.dataset.path = d.path; t.dataset.dir = d.name; t.draggable = true;
        if (look && look.color) t.style.setProperty("--c", look.color);
        t.innerHTML = `<span class="ovh-disc">${look.sign}</span><span class="ovh-text"><span class="ovh-name">${esc(d.name)}</span><span class="ovh-right">${esc(says(count(d)))}</span></span>`;
        g.appendChild(t);
      }
      body.append(h, g);
    }
    // the whiteboards and PDFs changed last
    const files = all.filter((n) => n.pdf && (paged(n.kind) || n.kind === "board")).sort((a, b) => (b.mtime || b.v || 0) - (a.mtime || a.v || 0)).slice(0, HOME_FILES);
    if (files.length) {
      const h = Object.assign(document.createElement("h2"), { className: "ov-dir ovh-head", textContent: T("Whiteboards and PDFs") }), g = document.createElement("div");
      g.className = "ov-grid";
      for (const n of files) g.appendChild(tile(n));
      body.append(h, g);
    }
    // the keys go through them as they stand
    items = [...body.querySelectorAll(".ov-item")];
    homeScan = byChange.slice(0, HOME_SCAN).map((n) => n.path);
    homeTasks();
    queue = [...new Set([...tiles.keys(), ...homeScan])].filter((p) => !cache.has(p));
    saidWhere();
    ask();
  }
  // Open Tasks: from what is known of the notes changed last
  function homeTasks() {
    const box = body.querySelector(".ovh-tasklist");
    if (!box) return;
    const byPath = new Map(everyIn(tree()).map((n) => [n.path, n])), rows = [];
    let waitingFor = 0;
    for (const p of homeScan) {
      const known = cache.get(p), n = byPath.get(p);
      if (!known) { waitingFor++; continue; }
      for (const task of known.tasks || []) if (rows.length < HOME_TASKS && n) rows.push([n, task]);
    }
    const had = box.contains(document.activeElement) && document.activeElement.dataset.task;
    box.textContent = "";
    for (const [n, task] of rows) {
      const t = homeRow(n, n.title || n.name.replace(/\.[^.]+$/, ""), `<span class="ovh-box"></span>`);
      t.dataset.task = task;
      t.querySelector(".ovh-name").textContent = task.replace(/[*_`~=]+/g, "");
      box.appendChild(t);
    }
    if (!rows.length) box.innerHTML = `<p class="ovh-none">${esc(T(waitingFor ? "Looking for tasks…" : "No open tasks"))}</p>`;
    items = [...body.querySelectorAll(".ov-item")];
    if (had) [...box.querySelectorAll(".ov-item")].find((t) => t.dataset.task === had)?.focus({ preventScroll: true });
  }

  /* want: "paste" — the tab is the pasteboard's (viewer/tabs.js); else All Notes opens on the folders, whatever was shown last. */
  function open(want = null) {
    if (isOpen() || !core.folder) return;
    focusBack = document.activeElement;
    const prefs = window.MdPrefs || {};
    scope = want === "paste" ? "paste" : homeOn() ? "home" : "folders";
    boardShow = "all"; // (every whiteboard of the folder: in a note or not, they are listed alike)
    boardList = null;
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
    pressed(scope !== "paste"); // (the house is All Notes', not the pasteboard's)
    el.scrollTop = 0;
    const cur = body.querySelector('.ov-item[aria-current]') || items[0];
    if (cur) { cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: "nearest" }); }
    ask();
    askBoards();
    pasteWatch();
    if (scope === "paste") pasteText.focus({ preventScroll: true });
  }
  function close(refocus = true) {
    if (!isOpen()) return false;
    delete el.dataset.open;
    pasteSend(); // (what was typed last goes before the field is out of sight)
    core.lockScroll(false);
    delete document.body.dataset.overview;
    pressed(false);
    if (refocus && focusBack && focusBack.isConnected && focusBack !== document.body) focusBack.focus({ preventScroll: true });
    focusBack = null;
    pasteWatch();
    return true;
  }
  // (an empty tab has nothing under the tiles: they stay until a note is chosen)
  const toggle = () => (!isOpen() ? open() : core.current ? close() : false);
  // tab: in a tab of its own (Ctrl held, the middle button)
  function go(tile, tab = false) {
    if (tile.dataset.dir) { if (scope === "home") { scope = "folders"; at = []; } at.push(tile.dataset.dir); picked.clear(); rebuild(); return; }
    const path = tile.dataset.path;
    // (a picture, a film, any other file opens in its own application: the tiles stay)
    if (tile.dataset.kind && !paged(tile.dataset.kind)) { post("note", { path }); return; }
    close(false);
    core.going(path);
    post("note", { path, tab });
  }

  // ------------------------------------------------------------ the pasteboard
  /* A small chat the project keeps for itself: what is pasted or typed is a block of its own, with
   * the device it came from and the time, and a Copy of its own; Clear takes all of them away. The
   * host keeps one text for the project and the same wherever the project shows (the web app's
   * server: web/lib/paste.ts); here that text is the list of blocks (pasteEncode — a text that is
   * no such list, as an older pasteboard has, is one block). The page knows three things of it:
   * `base`, the blocks as the host last had them, `rev`, the host's count for them, and `mine`,
   * what shows here. What differs from `base` is sent a moment after it was made, naming `rev`;
   * if the host has another rev by then it says so, with its blocks, and the two lists are joined
   * (pasteMerge: by the blocks' ids — a block added anywhere is there, one cleared stays away)
   * and sent again. While the pasteboard shows, the host is asked for the next rev and answers
   * when there is one (paste-get with wait) — so another device's block is here as it is made. */
  const PASTE_MAX = 200000, PASTE_QUIET = 250, PASTE_AGAIN = 3000;
  const pasteEl = document.createElement("div");
  pasteEl.className = "ov-paste";
  pasteEl.innerHTML = `<div class="ov-paste-bar"><span class="ov-paste-said" role="status"></span><span class="ov-space"></span>` +
    `<button class="btn" type="button" data-do="clear">${esc(T("Clear"))}</button></div>` +
    `<div class="ov-paste-list" role="log" aria-label="${esc(T("Pasteboard"))}"><p class="ov-paste-empty">${esc(T("Nothing here yet. What is pasted or typed below shows on every device that has this project open."))}</p></div>` +
    `<div class="ov-paste-compose"><textarea class="ov-paste-text" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="${esc(T("Pasteboard"))}" placeholder="${esc(T("Paste or type here"))}"></textarea>` +
    [["paste", "Paste"], ["send", "Send"]].map(([d, l]) => `<button class="btn" type="button" data-do="${d}">${esc(T(l))}</button>`).join("") + `</div>` +
    `<div class="empty-state ov-paste-none"><div class="empty-icon">${ICON.copy || ""}</div><b></b><p></p></div>`;
  const pasteText = pasteEl.querySelector("textarea"), pasteSaid = pasteEl.querySelector(".ov-paste-said"), pasteList = pasteEl.querySelector(".ov-paste-list");
  const paste = { root: null, base: [], mine: [], rev: -1, sent: null, gets: 0, puts: 0, timer: 0, again: 0, state: null, wants: false, device: "" };
  // the blocks as the host's text says them; an older pasteboard (one text, no list) is one block
  function pasteDecode(text) {
    try {
      const o = JSON.parse(text);
      if (o && o.v === 1 && Array.isArray(o.entries)) return o.entries.filter((e) => e && typeof e.id === "string" && typeof e.text === "string").map((e) => ({ id: e.id, text: e.text, at: typeof e.at === "string" ? e.at : "", from: typeof e.from === "string" ? e.from : "" }));
    } catch { /* (a plain text) */ }
    // (its id is of its text: the same on every device, and another text is another block)
    let h = 0;
    for (const c of String(text)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
    return String(text).trim() ? [{ id: "old-" + (h >>> 0).toString(36), text: String(text), at: "", from: "" }] : [];
  }
  const pasteEncode = (list) => JSON.stringify({ v: 1, entries: list });
  const pasteSame = (a, b) => a.length === b.length && a.every((e, i) => e.id === b[i].id);
  /* What was made here (mine) and elsewhere (theirs) since the blocks both began from: all of
   * them — a block that is in `theirs` or was made here, none that was cleared here — in the order of
   * their times (blocks made at the same moment stay as they stood). */
  function pasteMerge(base, mine, theirs) {
    const had = new Set(base.map((e) => e.id)), has = new Set(mine.map((e) => e.id)), there = new Set(theirs.map((e) => e.id));
    const out = theirs.filter((e) => !had.has(e.id) || has.has(e.id));
    for (const e of mine) if (!had.has(e.id) && !there.has(e.id)) out.push(e);
    return out.map((e, i) => [e, i]).sort(([a, i], [b, j]) => (a.at < b.at ? -1 : a.at > b.at ? 1 : i - j)).map(([e]) => e);
  }
  const pasteWhen = (at) => {
    const d = new Date(at);
    if (!at || isNaN(d)) return "";
    const day = d.toDateString() === new Date().toDateString();
    return day ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  // the list on the screen says what `mine` says: a block keeps its element, one new fades in, one cleared fades out
  function pasteDraw() {
    const near = pasteList.scrollHeight - pasteList.scrollTop - pasteList.clientHeight < 48, first = !pasteList.querySelector(".ov-pm");
    const there = new Map([...pasteList.querySelectorAll(".ov-pm:not(.leaving)")].map((n) => [n.dataset.id, n]));
    let grew = false, prev = null;
    for (const e of paste.mine) {
      let n = there.get(e.id);
      if (!n) {
        n = document.createElement("div");
        n.className = "ov-pm";
        n.dataset.id = e.id;
        n.innerHTML = `<div class="ov-pm-meta"><span class="ov-pm-from"></span><span class="ov-pm-at"></span><button class="ov-pm-copy" type="button"></button></div><div class="ov-pm-text"></div>`;
        n.querySelector(".ov-pm-from").textContent = e.from;
        n.querySelector(".ov-pm-at").textContent = pasteWhen(e.at);
        n.querySelector(".ov-pm-copy").textContent = T("Copy");
        n.querySelector(".ov-pm-text").textContent = e.text;
        n.classList.toggle("is-mine", !!e.from && e.from === paste.device);
        if (!first) n.classList.add("entering");
        grew = true;
      }
      there.delete(e.id);
      const at = prev ? prev.nextElementSibling : pasteList.querySelector(".ov-pm");
      if (at !== n) pasteList.insertBefore(n, at);
      prev = n;
    }
    for (const n of there.values()) { n.classList.add("leaving"); setTimeout(() => n.remove(), 200); }
    pasteList.toggleAttribute("data-empty", !paste.mine.length);
    if (grew && (near || first)) requestAnimationFrame(() => { pasteList.scrollTop = pasteList.scrollHeight; });
  }
  const PASTE_WHY = {
    off: ["No Pasteboard Yet", "A pasteboard belongs to a project that is linked to a repository on GitHub: Settings › History."],
    signin: ["Sign In for the Pasteboard", window.__TAURI_INTERNALS__ ? "Sign in with GitHub: Settings › History." : "A pasteboard belongs to a notebook of the account that is signed in."],
    missing: ["No Pasteboard Here", "The pasteboard is for those who may write to this project's repository."],
    unreachable: ["Pasteboard Not Reached", "It is tried again by itself."],
  };
  function pasteState(state) {
    if (paste.state !== state) {
      paste.state = state;
      pasteEl.dataset.state = state;
      const why = PASTE_WHY[state];
      if (why) { pasteEl.querySelector(".ov-paste-none b").textContent = T(why[0]); pasteEl.querySelector(".ov-paste-none p").textContent = T(why[1]); }
      pasteText.readOnly = state !== "ok";
      // (there now: ready to be typed into, unless the keyboard is somewhere else in the window)
      if (state === "ok" && pasteShown() && (document.activeElement === document.body || el.contains(document.activeElement))) pasteText.focus({ preventScroll: true });
    }
    pasteTell();
  }
  const pasteDirty = () => !pasteSame(paste.mine, paste.base);
  function pasteTell() {
    const large = pasteEncode(paste.mine).length > PASTE_MAX;
    pasteSaid.textContent = paste.state !== "ok" ? "" : large ? T("Too long to send: a pasteboard takes {0} characters", PASTE_MAX.toLocaleString()) : paste.sent != null || pasteDirty() ? T("Sending…") : T("On every device");
    pasteSaid.toggleAttribute("data-warn", large);
    pasteEl.querySelector('[data-do="clear"]').disabled = !paste.mine.length;
  }
  const pasteShown = () => isOpen() && scope === "paste" && !document.hidden && !!core.folder;
  function pasteAsk() {
    clearTimeout(paste.again);
    if (!paste.wants) return;
    post("paste-get", { n: ++paste.gets, rev: paste.rev, wait: paste.rev >= 0 });
  }
  /* Whether the pasteboard shows is looked at whenever that may have changed: it is asked for
   * while it does, and for another folder everything known is forgotten first. */
  function pasteWatch() {
    const root = core.folder ? core.folder.root : null;
    if (paste.root !== root) {
      clearTimeout(paste.timer);
      Object.assign(paste, { root, base: [], mine: [], rev: -1, sent: null, wants: false });
      paste.gets++; paste.puts++; // (answers still on their way are another folder's)
      pasteText.value = "";
      pasteDraw();
      pasteState("");
    }
    const wants = pasteShown();
    if (wants === paste.wants) return;
    paste.wants = wants;
    if (wants) pasteAsk(); else { clearTimeout(paste.again); paste.gets++; }
  }
  function pasteSend() {
    clearTimeout(paste.timer);
    if (paste.sent != null || paste.rev < 0 || paste.state !== "ok" || !pasteDirty()) return pasteTell();
    const text = pasteEncode(paste.mine);
    if (text.length > PASTE_MAX) return pasteTell();
    paste.sent = paste.mine;
    post("paste-put", { n: ++paste.puts, text, base: paste.rev });
    pasteTell();
  }
  const pasteSoon = (ms = PASTE_QUIET) => { clearTimeout(paste.timer); paste.timer = setTimeout(pasteSend, ms); pasteTell(); };
  // the host's blocks are others: joined with what shows here, and what shows beyond them is sent
  function pasteTake(m) {
    const theirs = pasteDecode(String(m.text ?? "")), joined = pasteMerge(paste.base, paste.mine, theirs);
    paste.base = theirs;
    paste.rev = m.rev;
    paste.mine = joined;
    pasteDraw();
    if (!pasteSame(joined, theirs)) pasteSoon(0); else pasteTell();
  }
  /* The host's answer — to a writing (put: taken as rev, or not, with what stands there instead),
   * or to the asking: the text, or why there is none (error). */
  function pasteboard(m) {
    if (!m) return;
    if (m.device) paste.device = m.device;
    if (m.put) {
      if (m.n !== paste.puts || paste.sent == null) return;
      const sent = paste.sent;
      paste.sent = null;
      if (m.error === "large") { core.toast(T("Too long for the pasteboard")); return pasteTell(); }
      if (m.error) { pasteSoon(PASTE_AGAIN); return; } // (not reached: again in a while — the asking says so if it stays that way)
      if (typeof m.text === "string") pasteTake(m);
      else { paste.base = sent; paste.rev = m.rev; if (!pasteSame(paste.mine, sent)) pasteSoon(); else pasteTell(); }
      pasteAsk(); // (from the rev that stands now)
      return;
    }
    if (m.n !== paste.gets || !paste.wants) return;
    if (m.error) {
      // (what was read once stays to be read and written on: only the first asking shows why not)
      if (paste.rev < 0 || m.error !== "unreachable") pasteState(m.error);
      if (m.error === "unreachable") paste.again = setTimeout(pasteAsk, PASTE_AGAIN);
      return;
    }
    pasteState("ok");
    if (paste.sent != null) return; // (a writing is on its way: its answer says how things stand, and asks again)
    if (m.rev !== paste.rev) pasteTake(m);
    pasteAsk();
  }
  const pasteId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  // a block of its own, at the end, sent at once — what was made here has this device for its origin
  function pasteAdd(text) {
    if (paste.state !== "ok" || !String(text).trim()) return false;
    const list = [...paste.mine, { id: pasteId(), text: String(text), at: new Date().toISOString(), from: paste.device }];
    if (pasteEncode(list).length > PASTE_MAX) { core.toast(T("Too long for the pasteboard")); return false; }
    paste.mine = list;
    pasteDraw();
    pasteSoon(0);
    return true;
  }
  const pasteGrow = () => {
    pasteText.style.height = "auto";
    pasteText.style.height = Math.max(40, Math.min(pasteText.scrollHeight, 160)) + "px";
    pasteText.style.overflowY = pasteText.scrollHeight > 160 ? "auto" : "hidden";
  };
  function pasteCompose() {
    if (pasteAdd(pasteText.value)) { pasteText.value = ""; pasteGrow(); }
  }
  let pasteAsked = false;
  /* The clipboard's text, asked of the host for the Paste button (viewer.js: pasteText). → whether it was the pasteboard's. */
  function pasted(r) {
    if (!pasteAsked) return false;
    pasteAsked = false;
    if (pasteShown() && typeof r.text === "string") pasteAdd(r.text);
    return true;
  }
  pasteText.addEventListener("input", pasteGrow);
  // what is pasted into the field is a block of its own at once; what is typed is one when it is sent (Enter; Shift+Enter is a new line)
  pasteText.addEventListener("paste", (e) => {
    const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    if (!text || paste.state !== "ok") return;
    e.preventDefault();
    pasteAdd(text);
  });
  pasteText.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    pasteCompose();
  });
  pasteText.addEventListener("blur", pasteSend);
  pasteEl.addEventListener("click", (e) => {
    const copy = e.target.closest(".ov-pm-copy");
    if (copy) {
      const text = (paste.mine.find((x) => x.id === copy.closest(".ov-pm").dataset.id) || {}).text;
      if (text != null) { core.copy(text); core.toast(T("Copied")); }
      return;
    }
    const b = e.target.closest(".ov-paste-bar [data-do], .ov-paste-compose [data-do]");
    if (!b || paste.state !== "ok") return;
    if (b.dataset.do === "paste") { pasteAsked = true; post("pastetext"); }
    else if (b.dataset.do === "send") { pasteCompose(); pasteText.focus({ preventScroll: true }); }
    else if (paste.mine.length) { paste.mine = []; pasteDraw(); pasteSoon(0); }
  });
  document.addEventListener("visibilitychange", pasteWatch);

  // ------------------------------------------------------------ several at once
  const mark = () => { for (const t of items) t.classList.toggle("picked", picked.has(t.dataset.path)); el.toggleAttribute("data-picked", picked.size > 0); };
  // (a whiteboard a note keeps is the note's: never among what is moved, copied or trashed together)
  const pick = (paths) => { const kept = new Set(items.filter((t) => t.dataset.kept != null).map((t) => t.dataset.path)); picked.clear(); for (const p of paths) if (!kept.has(p)) picked.add(p); mark(); };
  /* A rectangle pulled from the empty room: what it touches is selected (with Shift or Ctrl held:
   * as well as what was). It is drawn in the tiles' own room, so it stays with them when the
   * pulling scrolls them. */
  let band = null, banded = false;
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !isOpen() || e.target.closest(".ov-item, .ov-head button, .ov-rename, .ov-paste, input")) return;
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
  body.addEventListener("click", (e) => { const opt = e.target.closest(".ov-filter .ov-opt"); if (opt) choose("boards", opt.dataset.v); });
  el.querySelector(".ov-head").addEventListener("click", (e) => {
    const opt = e.target.closest(".ov-opt"), crumb = e.target.closest(".ov-crumb"), add = e.target.closest(".ov-add"), more = e.target.closest(".ov-more");
    if (e.target.closest(".ov-pastebtn")) return void core.pasteTab();
    // the + : a new note or folder, in the folder shown; "…": the order, and what is listed (the menu the empty room has)
    if (add && core.folder) { const r = add.getBoundingClientRect(); core.fileMenu(add, r.left, r.bottom + 6, "ovnew", here()); }
    else if (more && core.folder) { const r = more.getBoundingClientRect(); core.fileMenu(more, r.right - 200, r.bottom + 6, "blank", here()); }
    else if (opt) choose(opt.parentNode.dataset.seg, opt.dataset.v);
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
    if (e.target.closest(".ov-paste")) return; // (the pasteboard's field has the menu a field has)
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
    if (e.target.closest(".ov-paste") && e.key !== "Escape") return; // (the pasteboard's field: its keys are its own)
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
  const saidWhere = () => { core.navHere({ all: true, at: scope === "folders" ? [...at] : [], scope }); }; // (built: open, or opening)
  /* Back or forward to All Notes as it stood: that choice, in that folder (viewer/tabs.js) */
  function showAt(where, sc = "folders") {
    if (!core.folder) return;
    if (!isOpen()) open(sc === "paste" ? "paste" : null);
    scope = ["folders", "all", "boards", "paste"].includes(sc) ? sc : "folders";
    at = [...where];
    picked.clear();
    rebuild();
  }
  window.MdOverview = { open, close, showAt, toggle, previews, go, rename, many, boards, pasteboard, pasted, pasteMerge, pasteDecode, pasteEncode, boardsStale: () => askBoards(true), get picked() { return [...picked]; }, pick, folderChanged: () => { if (isOpen()) { refresh(); askBoards(true); } pasteWatch(); }, get isOpen() { return isOpen(); } };
})();
