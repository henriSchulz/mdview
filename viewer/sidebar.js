/* mdview, the page — the sidebar of a folder window: the folder's notes as a tree reconciled by
 * path, its layouts, sorting, the search, what is shared, files beside the notes, the note on
 * screen marked, rename and trash, moving by drag, the context menu. */
"use strict";
(() => {
  const P = window.MdPage;
  const { FILEWORK, post, T, esc, motionMs, keys, svg, ICON, DECO_COLORS } = P; // viewer/base.js
  const { stripFrontmatter, pageFacts } = P; // viewer/prep.js
  const { going, clear } = P; // viewer/render.js
  const { toolbar, toast } = P; // viewer/chrome.js
  const { openHistory, openShare, openConflicts } = P; // viewer/modes.js

  // The shell sends the folder's notes as a tree (setFolder) and again whenever
  // something in the folder changes. The DOM is reconciled by path, so rows
  // keep their state and only new or removed ones animate.
  const sidebar = document.createElement("aside");
  sidebar.id = "sidebar";
  sidebar.innerHTML =
    `<header class="sb-head">` +
    `<button class="sb-folder" data-act="folder" title="${esc(T("Open another folder (Ctrl+Alt+O)"))}">${ICON.folder}<span class="sb-folder-name"></span></button>` +
    `<button class="tb" data-act="titles" aria-pressed="false">${ICON.title}</button>` +
    `<button class="tb" data-act="historymenu">${ICON.history}</button>` +
    // (only where the folder has another side to be brought in line with: a project linked to a repository, a repository in the browser)
    `<button class="tb sb-sync" data-act="syncnow" title="${esc(T("Sync Now: fetch what other devices wrote, and send what was written here"))}" aria-label="${esc(T("Sync Now"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.4L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.4L20 15.5M20 20v-4.5h-4.5"/></svg></button>` +
    `<button class="tb" data-act="newmenu" title="${esc(T("New note or folder"))}" aria-label="${esc(T("New note or folder"))}">${ICON.plus}</button>` +
    `</header>` +
    `<input class="sb-field qn-search" type="search" placeholder="${esc(T("Search"))}" aria-label="${esc(T("Search the quick notes"))}" spellcheck="false" autocomplete="off">` +
    // (what the layouts add around the list — viewer.js: "the sidebar's layouts"; each shows its own)
    `<nav class="sb-rail" aria-label="${esc(T("Folders"))}"></nav>` +
    `<div class="sb-crumb"></div>` +
    `<div class="sb-smart" role="group"></div>` +
    `<div class="sb-recent sb-extra"></div>` +
    `<div class="sb-cap sb-cap-folders">${esc(T("Folders"))}</div>` +
    `<nav class="sb-list" aria-label="${esc(T("Notes"))}"></nav>` +
    `<nav class="sb-flat sb-extra" aria-label="${esc(T("Notes"))}"></nav>` +
    `<footer class="sb-foot"><button class="sb-new-note" type="button" data-sb="new">${ICON.plus}<span>${esc(T("New Note"))}</span></button><button class="tb" type="button" data-sb="more" title="${esc(T("Order of the notes, and what is listed"))}" aria-label="${esc(T("Order of the notes, and what is listed"))}">${ICON.list}</button></footer>`;
  document.body.appendChild(sidebar);
  sidebar.querySelector(".qn-search").addEventListener("input", (e) => { quickFilter = e.target.value.trim().toLowerCase(); if (folder && folder.quick) quickPaint(); else layoutSync(); });
  sidebar.querySelector(".qn-search").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.target.value = ""; quickFilter = ""; if (folder && folder.quick) quickPaint(); else layoutSync(); e.target.blur(); } });
  const sbHead = sidebar.querySelector(".sb-head");
  const sbList = sidebar.querySelector(".sb-list");
  const sbTitlesBtn = sbHead.querySelector('[data-act="titles"]');
  const sbHistoryBtn = sbHead.querySelector('[data-act="historymenu"]');
  // where the folder stands with a history (the shell says: f.history) — as the menu's entries name it
  const historyState = () => { const h = (folder && folder.history) || {}; return h.state === "foreign" && h.own ? (h.was ? "paused" : "adopt") : h.state || "none"; };
  const syncState = () => (((folder && folder.history) || {}).sync || {}).state || "";
  const HISTORY_SAYS = {
    none: () => "History: off",
    paused: () => "History: off (its versions are kept)",
    adopt: () => "History: off (a Git repository is here)",
    foreign: (h) => `History: kept by the repository “${h.name}”`,
    project: () => "History: on",
    inside: (h) => `History: on, in the project “${h.name}”`,
  };

  let folder = null;        // { root, name, tree } while this window browses a folder
  let sbTitles = false;     // rows show the note title (first H1) instead of the file name
  const sbOpen = new Set(); // expanded directories
  const sbPicked = new Set(); // the rows selected (Shift+click): what is copied, moved, hidden, trashed together
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const sidebarOpen = () => document.body.dataset.sidebar === "open";
  const byLabel = (a, b) => collator.compare(a.label, b.label);
  // the order of a folder's notes (the settings' sidebarSort): the one opened last first, by name,
  // or the one changed last first — by name where that does not tell them apart. Folders: by name.
  const SORTS = ["opened", "name", "modified"];
  const sortKey = () => (folder && folder.quick ? "modified" : SORTS.includes(window.MdPrefs?.sidebarSort) ? MdPrefs.sidebarSort : "opened"); // (quick notes: what was written last is first)
  const noteLabel = (n) => (folder && folder.quick ? quickOf(n).title : (sbTitles && n.title) || n.name);
  function sortNotes(notes) {
    const key = sortKey(), by = key === "opened" ? "opened" : key === "modified" ? "mtime" : null;
    return [...notes].sort((a, b) => (by && (b[by] || 0) - (a[by] || 0)) || collator.compare(noteLabel(a), noteLabel(b)));
  }
  function setSort(key) {
    if (key === sortKey()) return;
    window.MdPrefs = { ...(window.MdPrefs || {}), sidebarSort: key };
    post("prefs", { prefs: { sidebarSort: key } });
    P.sortedBy = key;
    resort();
  }
  function resort() {
    if (!folder) return;
    syncList(true);
    if (window.MdOverview) MdOverview.folderChanged();
  }

  function entriesOf(dir) {
    const dirs = dir.dirs.map((d) => ({ key: d.path, dir: d, label: d.name }));
    const notes = sortNotes(dir.notes).map((n) => ({ key: n.path, note: n, label: noteLabel(n) }));
    return [...dirs.sort(byLabel), ...notes];
  }
  const rowIcon = (path) => (/\.board\.svg$/i.test(path) ? ICON.board : /\.(md|markdown|mdown|txt)$/i.test(path) ? ICON.note : /\.pdf$/i.test(path) ? ICON.pdf
    : /\.(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|heic)$/i.test(path) ? ICON.picture : ICON.file);
  function makeItem(e, depth) {
    const item = document.createElement("div");
    item.className = e.dir ? "sb-item sb-fold is-dir" : "sb-item sb-fold";
    item.dataset.key = e.key;
    item.innerHTML = `<div class="sb-in"><button class="sb-row" type="button" style="--depth:${depth}">` +
      (e.dir ? `<span class="sb-chev">${ICON.chevron}</span>` : "") + `<span class="sb-icon">${e.dir ? ICON.folder : rowIcon(e.key)}</span><span class="sb-label"></span></button>` +
      (e.dir ? `<div class="sb-kids sb-fold"><div class="sb-in"></div></div>` : "") + `</div>`;
    item.firstChild.firstChild.draggable = true; // (into another folder: moving, below)
    if (e.note) item.firstChild.firstChild.dataset.real = e.note.real;
    return item;
  }
  function syncDir(box, dir, depth, fresh) {
    const have = new Map();
    for (const el of box.children) if (!el.classList.contains("leaving")) have.set(el.dataset.key, el);
    let prev = null;
    for (const e of entriesOf(dir)) {
      let el = have.get(e.key);
      if (el && el.classList.contains("is-dir") !== !!e.dir) el = null;
      if (el) have.delete(e.key);
      else {
        el = makeItem(e, depth);
        if (fresh) { el.classList.add("enter"); fresh.push(el); }
      }
      const at = prev ? prev.nextSibling : box.firstChild;
      if (at !== el) box.insertBefore(el, at);
      prev = el;
      const row = el.firstChild.firstChild, label = row.querySelector(".sb-label"); // (not the row's last child: a shared note has its sign there)
      if (label.textContent !== e.label) label.textContent = e.label;
      row.title = e.note ? e.note.path.slice(folder.root.length + 1) : "";
      el.classList.toggle("is-hidden", !!(e.note || e.dir).hidden); // (put away, and shown all the same: dimmed)
      el.classList.toggle("is-coming", !!(e.note && e.note.coming)); // (on its way into the repository: a file added in the browser, until a commit has it)
      row.classList.toggle("picked", sbPicked.has(e.key));
      dressRow(el, e);
      if (e.dir) {
        el.classList.toggle("open", sbOpen.has(e.key));
        row.setAttribute("aria-expanded", String(sbOpen.has(e.key)));
        syncDir(el.querySelector(":scope > .sb-in > .sb-kids > .sb-in"), e.dir, depth + 1, fresh); // (not the row's next sibling: while the folder is renamed, that is the name's field)
      }
    }
    for (const el of have.values()) {
      if (!fresh) { el.remove(); continue; }
      el.classList.add("leaving");
      setTimeout(() => el.remove(), motionMs("--spring-smooth-dur", 510));
    }
  }
  function syncList(animate) {
    const fresh = animate ? [] : null;
    // rows that change their place glide there (where they stood, before the list is put in order)
    const stood = new Map();
    if (animate && sidebarOpen()) for (const el of sbList.querySelectorAll(".sb-item")) stood.set(el.dataset.key, el.getBoundingClientRect().top);
    const any = folder.tree.dirs.length || folder.tree.notes.length;
    sbList.querySelector(":scope > .menu-empty")?.remove();
    syncDir(sbList, folder.tree, 0, fresh);
    layoutSync();
    if (!any) sbList.insertAdjacentHTML("afterbegin", `<div class="menu-empty">${esc(T("No notes yet"))}</div>`);
    const moved = [];
    for (const [key, top] of stood) {
      const el = sbList.querySelector(`.sb-item[data-key="${CSS.escape(key)}"]:not(.leaving)`), dy = el ? top - el.getBoundingClientRect().top : 0;
      if (el && Math.abs(dy) > 1 && !el.parentNode.closest(".sb-item:not(.open)")) { el.style.transition = "none"; el.style.transform = `translateY(${dy}px)`; moved.push(el); }
    }
    if (moved.length) {
      void sbList.offsetWidth;
      const ms = motionMs("--spring-smooth-dur", 510);
      for (const el of moved) { el.style.transition = "transform var(--spring-smooth-dur) var(--spring-smooth)"; el.style.transform = ""; }
      setTimeout(() => { for (const el of moved) el.style.transition = ""; }, ms);
    }
    if (fresh && fresh.length) {
      void sbList.offsetWidth;
      fresh.forEach((el) => el.classList.remove("enter"));
    }
  }
  /* ------------------------------------------------------- the sidebar's layouts
   * The settings say how the sidebar is laid out (sidebarLayout); the list itself — its rows,
   * what a press, a pull, a right click does on them — is the same in all of them:
   *   source  the tree, the notes opened last above it, new and order at its foot
   *   rail    the folder's folders as signs in a narrow rail; beside it what is in the one chosen
   *   sheets  a sheet of paper for each note (drawn as the note is built), a folder for each
   *           folder: one folder at a time, a click goes in
   *   tiles   smart lists as tiles — all, today, shared, with tasks — above the folders
   * The quick notes are a list of their own ("plain"). A folder has a colour and a sign of its
   * own where one was chosen (right click › Colour and Icon…): kept in the folder, folder.looks. */
  const SB_LAYOUTS = ["source", "rail", "sheets", "tiles"];
  const sbLayout = () => (!folder || folder.quick ? "plain" : SB_LAYOUTS.includes(window.MdPrefs?.sidebarLayout) ? MdPrefs.sidebarLayout : "source");
  const FOLDER_ICONS = {
    book: svg('<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5z"/><path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19v-3"/>'),
    cap: svg('<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5"/>'),
    flask: svg('<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>'),
    pencil: svg('<path d="M4 20l1-4L16.500 4.500a2.100 2.100 0 0 1 3 3L8 19z"/>'),
    bulb: svg('<path d="M9 18h6M10 21h4M8.500 14.500a6 6 0 1 1 7 0c-.6.5-1 1.200-1 2h-5c0-.8-.4-1.500-1-2z"/>'),
    box: svg('<path d="M12 3 4 7.500v9L12 21l8-4.500v-9z"/><path d="M4 7.500 12 12l8-4.500M12 12v9"/>'),
    code: svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.500 5l-3 14"/>'),
    bolt: svg('<path d="M13 3 5 13h6l-1 8 8-10h-6z"/>'),
    briefcase: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>'),
    inbox: svg('<path d="M4 13 6.500 5h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h5a3 3 0 0 0 6 0h5"/>'),
    calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>'),
    home: svg('<path d="M4 11 12 4l8 7M6 10v9h12v-9"/>'),
    people: svg('<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.600a3.500 3.500 0 0 1 0 6.800M18 14.500a6.500 6.500 0 0 1 3.500 5.500"/>'),
    heart: svg('<path d="M12 20s-7-4.400-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.600-7 10-7 10z"/>'),
    star: svg('<path d="m12 3 2.700 5.600 6.100.8-4.500 4.300 1.100 6.100L12 17l-5.400 2.800 1.100-6.100L3.200 9.400l6.100-.8z"/>'),
    flag: svg('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.200 3 14.800 0 18M12 3c-3 3.200-3 14.800 0 18"/>'),
    cart: svg('<path d="M3 4h2.500l2.200 11h10.600l1.700-8H7"/><circle cx="9" cy="19" r="1.500"/><circle cx="17" cy="19" r="1.500"/>'),
    music: svg('<path d="M9 18V5l11-2v13"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="17.500" cy="16" r="2.500"/>'),
    camera: svg('<path d="M4 8h3l1.500-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.500"/>'),
  };
  const SMART_ICONS = { all: svg('<path d="m12 4 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>'), today: FOLDER_ICONS.calendar, shared: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>'), tasks: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>') };
  const sbRail = sidebar.querySelector(".sb-rail"), sbCrumb = sidebar.querySelector(".sb-crumb"), sbSmartBox = sidebar.querySelector(".sb-smart"), sbRecent = sidebar.querySelector(".sb-recent"), sbFlat = sidebar.querySelector(".sb-flat");
  let sbHere = null;     // rail, sheets: the folder whose notes are shown (its path; null: the folder itself)
  let sbSmart = "all";   // tiles: the smart list that is chosen
  const sbSeen = new Map();   // sheets, tiles: a note's path → { mtime, shape, open, color } — read from its beginning ("previews")
  const sbAsking = new Set();
  const relOf = (path) => path.slice(folder.root.length + 1);
  const lookOf = (path) => ((folder && folder.looks) || {})[relOf(path)] || {};
  const colorVar = (c) => (DECO_COLORS.includes(c) ? `var(--c-${c})` : "");
  const folderGlyph = (look) => FOLDER_ICONS[look.icon] || ICON.folder;
  const dirAt = (path) => { let at = null; const walk = (d) => { for (const x of d.dirs) { if (x.path === path) at = x; else if (path.startsWith(x.path + "/")) walk(x); } }; if (folder && path) walk(folder.tree); return at; };
  const everyNote = (dir = folder.tree, out = []) => { out.push(...dir.notes); for (const d of dir.dirs) everyNote(d, out); return out; };
  /* A sheet shows what the file is (the sheets' layout): a note its beginning, as All Notes' tiles show it; a PDF its first page; a
   * whiteboard and a picture themselves. Until that is known — and where it cannot be — a note is its name over the shape of its
   * lines, any other file its sign. */
  const fileUrl = (path) => (window.MdHost?.files || "file://") + path.split("/").map(encodeURIComponent).join("/");
  let shotSoon = 0;
  function sheetOf(n) {
    const s = sbSeen.get(n.path), pic = (src, kind) => `<span class="sb-sheet-in is-pic" data-kind="${kind}"><img src="${esc(src)}" alt="" draggable="false"></span>`;
    if (n.kind === "image" || n.kind === "board") return pic(fileUrl(n.path) + (n.mtime ? "?v=" + Math.round(n.mtime) : ""), n.kind);
    if (n.kind === "pdf") {
      const shot = P.pdfShot.now(n.path, n.mtime);
      if (shot) return pic(shot, "pdf");
      // (asked for once; when it is there the sheets are dressed again)
      if (!P.pdfShot.known(n.path, n.mtime)) P.pdfShot(n.path, n.mtime).then((src) => { if (!src || sbLayout() !== "sheets") return; clearTimeout(shotSoon); shotSoon = setTimeout(() => { if (folder && !folder.quick) syncList(false); }, 60); });
    }
    if (n.pdf) return `<span class="sb-sheet-in is-sign">${rowIcon(n.path)}</span>`;
    if (s && s.html) return `<span class="sb-sheet-in is-real"><span class="ov-prev sb-prev" inert>${s.html}</span></span>`;
    return `<span class="sb-sheet-in"><b>${esc(noteLabel(n))}</b>` + (s ? [...s.shape].map((l) => `<i class="${l}"></i>`).join("") : "") + "</span>";
  }
  // what a row shows beyond its name: how a folder looks; when a note was changed; its sheet
  function dressRow(el, e) {
    const row = el.firstChild.firstChild, lay = sbLayout();
    if (lay === "plain") return;
    let tail = row.querySelector(":scope > .sb-tail");
    if (!tail) { tail = document.createElement("span"); tail.className = "sb-tail"; row.insertBefore(tail, row.querySelector(".sb-label").nextSibling); }
    const says = e.dir ? "" : quickWhen(e.note.mtime); // (a folder says nothing at its end: no number)
    if (tail.dataset.says !== says) tail.dataset.says = says; // (drawn by the stylesheet: the row's text stays its name)
    const look = e.dir ? lookOf(e.key) : {}, seen = e.note ? sbSeen.get(e.note.path) : null, color = e.dir ? look.color : seen && seen.color;
    row.style.setProperty("--fc", colorVar(color) || "");
    if (!colorVar(color)) row.style.removeProperty("--fc");
    if (e.dir && (row.dataset.icon || "") !== (FOLDER_ICONS[look.icon] ? look.icon : "")) { row.dataset.icon = FOLDER_ICONS[look.icon] ? look.icon : ""; row.querySelector(".sb-icon").innerHTML = folderGlyph(look); }
    let sheet = row.querySelector(":scope > .sb-sheet");
    if (lay !== "sheets") { if (sheet) sheet.remove(); return; }
    if (!sheet) { sheet = document.createElement("span"); sheet.className = e.dir ? "sb-sheet is-folder" : "sb-sheet"; sheet.setAttribute("aria-hidden", "true"); row.insertBefore(sheet, row.firstChild); }
    const html = e.dir ? `<span class="sb-sheet-tab"></span><span class="sb-sheet-in">${folderGlyph(look)}</span>` : sheetOf(e.note);
    if (sheet.dataset.html !== html) { sheet.dataset.html = html; sheet.innerHTML = html; }
  }
  // a row that stands outside the tree (opened last, a smart list, what was searched for): the same row, its place said under its name
  function looseRow(n) {
    const el = makeItem({ key: n.path, note: n }, 0), row = el.firstChild.firstChild;
    row.draggable = false;
    row.dataset.loose = row.dataset.real; delete row.dataset.real; // (not the note's row in the tree: that one is marked, found, moved)
    row.querySelector(".sb-label").textContent = noteLabel(n);
    row.title = relOf(n.path);
    const tail = document.createElement("span"); tail.className = "sb-tail"; tail.dataset.says = quickWhen(n.mtime); row.appendChild(tail);
    return el;
  }
  function fill(box, cap, notes, none) {
    const key = cap + "\n" + notes.map((n) => n.path + "\t" + noteLabel(n) + "\t" + n.mtime).join("\n");
    if (box.dataset.key === key) return; // (as it stands: nothing is built anew)
    box.dataset.key = key;
    box.textContent = "";
    if (cap) box.insertAdjacentHTML("beforeend", `<div class="sb-cap">${esc(cap)}</div>`);
    for (const n of notes) box.appendChild(looseRow(n));
    if (!notes.length && none) box.insertAdjacentHTML("beforeend", `<div class="menu-empty">${esc(none)}</div>`);
  }
  const SMART = [
    ["all", "All", "gray", () => true],
    ["today", "Today", "blue", (n) => { const d = new Date(); return (n.mtime || 0) * 1000 >= new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }],
    ["shared", "Shared", "green", (n) => ((folder && folder.shared) || []).includes(n.real)],
    ["tasks", "With Tasks", "orange", (n) => (sbSeen.get(n.path) || {}).open > 0],
  ];
  function layoutSync() {
    const lay = sbLayout(), query = lay === "plain" ? "" : quickFilter;
    sidebar.dataset.layout = document.body.dataset.sbLayout = lay; // (the body too: the settings' gear floats over the sidebar's foot — viewer/*.css)
    if (lay === "plain") { sidebar.removeAttribute("data-here"); sidebar.removeAttribute("data-flat"); return; }
    if ((lay !== "rail" && lay !== "sheets") || (sbHere && !dirAt(sbHere))) sbHere = null;
    if (lay !== "tiles") sbSmart = "all";
    sidebar.toggleAttribute("data-here", !!sbHere);
    sidebar.style.setProperty("--depth-off", sbHere ? String(relOf(sbHere).split("/").length) : "0");
    for (const el of sbList.querySelectorAll(".sb-item.is-dir")) {
      const k = el.dataset.key, on = !!sbHere && (sbHere === k || sbHere.startsWith(k + "/"));
      el.classList.toggle("sb-path", on);
      el.classList.toggle("sb-at", sbHere === k);
    }
    const all = everyNote(), here = sbHere ? dirAt(sbHere) : null;
    // the rail: everything, and the folder's folders
    const rail = lay === "rail" ? [["", T("All Notes"), SMART_ICONS.all, "var(--c-gray, var(--fg2))"], ...[...folder.tree.dirs].sort((a, b) => collator.compare(a.name, b.name)).map((d) => [d.path, d.name, folderGlyph(lookOf(d.path)), colorVar(lookOf(d.path).color)])] : [];
    const railKey = JSON.stringify(rail.map(([p, n, , c]) => [p, n, c, (lookOf(p || folder.root + "/") || {}).icon]));
    if (sbRail.dataset.key !== railKey) { sbRail.dataset.key = railKey; sbRail.innerHTML = rail.map(([p, n, glyph, c]) => `<button class="sb-rt" type="button" data-go="${esc(p)}" title="${esc(n)}" aria-label="${esc(n)}"${c ? ` style="--fc: ${c}"` : ""}>${glyph}</button>`).join(""); }
    for (const b of sbRail.children) { const on = (b.dataset.go || null) === (sbHere ? folder.root + "/" + relOf(sbHere).split("/")[0] : null); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    // where one is: in the rail's pane its name and how much is in it; among the sheets the way back
    const up = here && sbHere.replace(/\/[^/]*$/, "");
    const crumb = lay === "rail" ? `<span class="sb-crumb-name">${esc(here ? here.name : T("All Notes"))}</span>`
      : lay === "sheets" && here ? `<button class="sb-back" type="button" data-go="${esc(up === folder.root ? "" : up)}">${ICON.chevron}<span>${esc(up === folder.root ? folder.name : up.replace(/^.*\//, ""))}</span></button><span class="sb-crumb-name">${esc(here.name)}</span>` : "";
    if (sbCrumb.dataset.html !== crumb) { sbCrumb.dataset.html = crumb; sbCrumb.innerHTML = crumb; }
    sbCrumb.hidden = !crumb;
    // what was searched for, or a smart list: its notes in one list, in place of the tree
    const smart = SMART.find((s) => s[0] === sbSmart) || SMART[0];
    const flat = query ? all.filter((n) => (noteLabel(n) + "\n" + relOf(n.path)).toLowerCase().includes(query)) : smart[0] !== "all" ? all.filter(smart[3]) : null;
    sidebar.toggleAttribute("data-flat", !!flat);
    fill(sbFlat, flat ? (query ? T("Found") : T(smart[1])) : "", flat ? sortNotes(flat) : [], flat ? T("Nothing here") : "");
    // the notes opened last (source)
    const recent = lay === "source" && !flat ? all.filter((n) => n.opened).sort((a, b) => b.opened - a.opened).slice(0, 3) : [];
    fill(sbRecent, recent.length ? T("Recent") : "", recent, "");
    sbRecent.hidden = !recent.length;
    // the smart lists (tiles): how many notes each holds
    const tiles = lay === "tiles" ? SMART.map(([id, label, color, test]) => [id, label, color, all.filter(test).length]) : [];
    const tilesKey = JSON.stringify(tiles);
    if (sbSmartBox.dataset.key !== tilesKey) { sbSmartBox.dataset.key = tilesKey; sbSmartBox.innerHTML = tiles.map(([id, label, color, n]) => `<button class="sb-tile" type="button" data-smart="${id}" style="--fc: var(--c-${color}, var(--fg2))"><span class="sb-tile-dot">${SMART_ICONS[id]}</span><span class="sb-tile-n">${n}</span><span class="sb-tile-name">${esc(T(label))}</span></button>`).join(""); }
    for (const b of sbSmartBox.children) { const on = !query && b.dataset.smart === sbSmart; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    for (const row of sidebar.querySelectorAll(".sb-extra .sb-row[data-loose]")) row.classList.toggle("active", !!P.current && row.dataset.loose === P.current.path);
    sbAsk(lay, here);
  }
  // the beginnings of the notes a layout draws from: the sheets of the folder shown; for the tiles all of them (which have tasks)
  function sbAsk(lay, here) {
    if (sbAsking.size || (lay !== "sheets" && lay !== "tiles")) return;
    const notes = lay === "tiles" ? everyNote() : (here || folder.tree).notes;
    const want = notes.filter((n) => !n.pdf && /\.(md|markdown|mdown)$/i.test(n.path) && ((sbSeen.get(n.path) || {}).mtime !== n.mtime || (lay === "sheets" && (sbSeen.get(n.path) || {}).html === undefined))).slice(0, 40); // (the sheets want its beginning too, where only its shape was read)
    if (!want.length) return;
    for (const n of want) { sbAsking.add(n.path); sbSeen.set(n.path, { ...(sbSeen.get(n.path) || { shape: "", open: 0, color: "" }), mtime: n.mtime }); } // (asked once for what it is now, whatever comes back)
    post("previews", { paths: want.map((n) => n.path) });
  }
  // … and what comes back: this list's share of it is taken out (the rest is the quick notes', All Notes')
  function sbPreviews(got) {
    const rest = {};
    let mine = false;
    for (const [path, p] of Object.entries(got || {})) {
      if (!sbAsking.has(path)) { rest[path] = p; continue; }
      mine = true;
      const fm = stripFrontmatter(String(p.text || "").replace(/\r\n?/g, "\n")), f = pageFacts({ items: fm.body.split("\n") });
      const color = fm.props && typeof fm.props.color === "string" && DECO_COLORS.includes(fm.props.color.trim().toLowerCase()) ? fm.props.color.trim().toLowerCase() : "";
      sbSeen.set(path, { mtime: (sbSeen.get(path) || {}).mtime, shape: f.shape, open: f.tasks.length - f.done, color, html: sbLayout() === "sheets" ? P.previewOf(path, String(p.text || "")).html : undefined }); // (html: its beginning, for its sheet)
    }
    if (mine || (sbAsking.size && !Object.keys(got || {}).length)) { sbAsking.clear(); if (folder && !folder.quick) syncList(false); } // (an answer with nothing in it: what was asked for is not to be had)
    return rest;
  }
  // another folder shown (rail, sheets): what is in it comes from the side one went to
  function setHere(path, back) {
    if ((path || null) === sbHere) return;
    sbHere = path || null;
    sbList.classList.remove("sb-push", "sb-push-back");
    syncList(false);
    void sbList.offsetWidth;
    sbList.classList.add(back ? "sb-push-back" : "sb-push");
    sbList.scrollTop = 0;
    markActiveNote(false);
  }
  sbList.addEventListener("animationend", () => sbList.classList.remove("sb-push", "sb-push-back"));
  sidebar.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !folder) return;
    const here = t.closest("[data-go]"), smart = t.closest("[data-smart]"), loose = t.closest(".sb-extra .sb-row"), foot = t.closest("[data-sb]");
    if (here) setHere(here.dataset.go, here.classList.contains("sb-back"));
    else if (smart) { sbSmart = smart.dataset.smart; layoutSync(); }
    else if (loose) { if (!loose.classList.contains("active") || e.ctrlKey || e.metaKey) openRow(loose.closest(".sb-item"), e.ctrlKey || e.metaKey); }
    else if (foot && foot.dataset.sb === "new") P.openNewNote("note", sbHere);
    else if (foot) { const r = foot.getBoundingClientRect(); if (ctxOpen() && ctxKind === "blank") closeCtx(false); else openCtx(sidebar, r.left, r.top - 4, "blank", sbHere || folder.root); }
  });
  /* A folder's colour and its sign: chosen in a small window beside its row, kept in the folder
   * (the application writes .mdview/folders.json — "folderlook"). */
  const sbLook = document.createElement("div");
  sbLook.id = "sblook";
  sbLook.className = "ui-menu ui-popover surface";
  sbLook.setAttribute("role", "dialog");
  sbLook.tabIndex = -1;
  document.body.appendChild(sbLook);
  let sbLookFor = null;
  function paintLook() {
    const look = lookOf(sbLookFor);
    sbLook.innerHTML = `<div class="sl-cap">${esc(T("Colour"))}</div><div class="sl-colors">` + ["", ...DECO_COLORS].map((c) => `<button type="button" class="sl-color${(look.color || "") === c ? " on" : ""}" data-color="${c}" title="${esc(c ? T("color." + c) : T("slash.colorDefault"))}" aria-label="${esc(c ? T("color." + c) : T("slash.colorDefault"))}" aria-pressed="${(look.color || "") === c}"${c ? ` style="--fc: var(--c-${c})"` : ""}></button>`).join("") + `</div>`
      + `<div class="sl-cap">${esc(T("Icon"))}</div><div class="sl-icons"${colorVar(look.color) ? ` style="--fc: ${colorVar(look.color)}"` : ""}>` + ["", ...Object.keys(FOLDER_ICONS)].map((i) => `<button type="button" class="sl-icon${(FOLDER_ICONS[look.icon] ? look.icon : "") === i ? " on" : ""}" data-icon="${i}" aria-label="${i || "folder"}" aria-pressed="${(look.icon || "") === i}">${i ? FOLDER_ICONS[i] : ICON.folder}</button>`).join("") + `</div>`;
  }
  function openLook(key, beside) { // (beside: what stands for the folder where its menu was opened — its row, its sign in the rail, its tile)
    sbLookFor = key;
    paintLook();
    const r = beside.getBoundingClientRect(), w = sbLook.offsetWidth, h = sbLook.offsetHeight;
    sbLook.style.setProperty("--origin", "top left");
    sbLook.style.left = Math.max(8, Math.min(r.left + 24, innerWidth - w - 8)) + "px";
    sbLook.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8)) + "px";
    sbLook.dataset.open = "";
    sbLook.focus({ preventScroll: true });
  }
  const closeLook = () => { if (!sbLook.hasAttribute("data-open")) return false; delete sbLook.dataset.open; sbLookFor = null; return true; };
  sbLook.addEventListener("click", (e) => {
    const b = e.target instanceof Element && e.target.closest("[data-color], [data-icon]");
    if (!b || !sbLookFor || !folder) return;
    const was = lookOf(sbLookFor), next = { color: b.dataset.color != null ? b.dataset.color : was.color || "", icon: b.dataset.icon != null ? b.dataset.icon : was.icon || "" };
    const looks = { ...(folder.looks || {}) };
    if (next.color || next.icon) looks[relOf(sbLookFor)] = next; else delete looks[relOf(sbLookFor)];
    folder.looks = looks; // (shown at once; the application says the same when it has written it)
    post("folderlook", { path: sbLookFor, color: next.color, icon: next.icon });
    syncList(false);
    paintLook();
  });
  sbLook.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); closeLook(); } });
  sbLook.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("mousedown", (e) => { if (sbLook.hasAttribute("data-open") && !(e.target instanceof Element && e.target.closest("#sblook"))) closeLook(); }, true);

  /* The sidebar's edge can be pulled, as in Finder: wider and narrower; pulled far to the left it
   * goes away, and from the window's left edge it comes out again. A double click: its own width. */
  let sbDragging = false;
  const sbGrip = document.createElement("div");
  sbGrip.id = "sb-grip";
  sbGrip.setAttribute("aria-hidden", "true");
  document.body.appendChild(sbGrip);
  const SB_MIN = 180, SB_GONE = 110, SB_OWN = 260;
  const sbMax = () => Math.max(SB_MIN, Math.min(640, innerWidth * 0.6));
  const sbWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sb-w")) || SB_OWN;
  sbGrip.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !folder) return;
    e.preventDefault();
    const was = sbWidth(), wasOpen = sidebarOpen();
    let gone = !wasOpen, moved = false;
    sbDragging = true;
    document.body.classList.add("sb-sizing");
    sidebar.classList.add("no-anim");
    const move = (ev) => {
      moved = true;
      const x = ev.clientX;
      if (x < SB_GONE) { if (!gone) { gone = true; document.body.dataset.sidebar = "closed"; } return; }
      if (gone) { gone = false; document.body.dataset.sidebar = "open"; }
      document.documentElement.style.setProperty("--sb-w", Math.round(Math.max(SB_MIN, Math.min(sbMax(), x))) + "px");
    };
    const up = (ev) => {
      if (moved || Math.abs(ev.clientX - e.clientX) > 2) move(ev); // (where it was let go)
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      sbDragging = false;
      document.body.classList.remove("sb-sizing");
      sidebar.classList.remove("no-anim");
      if (!moved) return;
      if (gone) document.documentElement.style.setProperty("--sb-w", was + "px"); // (it comes back as wide as it was)
      post("sidebar", { width: Math.round(sbWidth()), visible: !gone });
      window.dispatchEvent(new Event("resize")); // (what fits itself to the column's width does so again)
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  sbGrip.addEventListener("dblclick", () => {
    if (!sidebarOpen()) return;
    document.documentElement.style.setProperty("--sb-w", SB_OWN + "px");
    post("sidebar", { width: SB_OWN, visible: true });
    window.dispatchEvent(new Event("resize"));
  });
  function setFolder(f) {
    if (P.titlesAt) { // the list is fading out for a names/titles switch: swap once it is gone
      const wait = P.titlesAt + motionMs("--dur-fast", 160) * 0.7 - performance.now();
      P.titlesAt = 0;
      clearTimeout(P.titlesTimer);
      P.titlesTimer = setTimeout(() => { applyFolder(f, false); markShared(); sbList.classList.remove("swap"); }, Math.max(0, wait));
      return;
    }
    applyFolder(f, true);
    markShared();
  }
  /* A note, another file or a folder dragged into another folder — a row of the sidebar onto a
   * folder's row (or the list's empty room: the top), a tile of All Notes onto a folder's tile
   * (overview.js uses the same three). The application moves it ("move"). */
  /* What goes with the pointer while something is moved: a copy of it, drawn by the page and moved by the page. The
   * browser's own picture of the element is not used (an empty one is handed to it): it comes out twice as large on a
   * screen scaled by a fraction, and shows at full size what the element holds made small with zoom. */
  const noPicture = new Image();
  noPicture.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  let ghost = null; // { el, gx, gy: where in it the pointer took it; tx, ty: how far it is moved }
  const ghostTo = (x, y) => {
    if (!ghost || !ghost.el.isConnected) return;
    const r = ghost.el.getBoundingClientRect(); // (from where it is now: whatever it hangs in may have scrolled)
    ghost.tx += x - ghost.gx - r.left; ghost.ty += y - ghost.gy - r.top;
    ghost.el.style.transform = `translate(${ghost.tx}px, ${ghost.ty}px)`;
  };
  const ghostGone = () => { if (ghost) ghost.el.remove(); ghost = null; };
  document.addEventListener("dragover", (e) => ghostTo(e.clientX, e.clientY), true);
  for (const t of ["dragend", "drop"]) document.addEventListener(t, ghostGone, true);
  const moving = {
    path: null, paths: null,
    // (el: what is dragged — held where the pointer took it, not by its corner or where a hover moved it;
    // also: what goes with it — the others selected in All Notes)
    start(e, path, el, also) {
      moving.path = path; moving.paths = also && also.length > 1 ? also : null; e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("application/x-mdview-move", path);
      // (… and as files, for whatever else takes them: the note — a link to it, a whiteboard as its picture —, a file manager, another application)
      if (window.__TAURI_INTERNALS__) e.dataTransfer.setData("text/uri-list", (moving.paths || [path]).map((p) => "file://" + p.split("/").map(encodeURIComponent).join("/")).join("\r\n"));
      moving.picture(e, el);
    },
    // what goes with the pointer in a drag, drawn by the page: a copy of el held where the pointer took it
    // (the browser's own picture of an element is twice as large on a screen scaled by a fraction)
    // (opt.into: where the copy is put, when el itself stands off the page; opt.hold: where in el it is held)
    picture(e, el, opt = {}) {
      if (!el) return;
      const r = el.getBoundingClientRect(), x = e.clientX, y = e.clientY;
      e.dataTransfer.setDragImage(noPicture, 0, 0);
      ghostGone();
      const g = el.cloneNode(true);
      for (const n of [g, ...g.querySelectorAll("[id], [data-path], [data-key]")]) for (const a of ["id", "data-path", "data-key", "draggable", "tabindex"]) n.removeAttribute(a);
      g.classList.add("drag-ghost"); g.setAttribute("aria-hidden", "true");
      g.style.width = r.width + "px"; g.style.height = r.height + "px";
      ghost = { el: g, gx: Math.max(0, Math.min(r.width, opt.hold ? opt.hold[0] : x - r.left)), gy: Math.max(0, Math.min(r.height, opt.hold ? opt.hold[1] : y - r.top)), tx: 0, ty: 0 };
      if (opt.into) { g.style.left = g.style.top = "0"; g.style.zIndex = "90"; }
      const into = opt.into || el.parentNode;
      // (put in beside what it copies, where its styles hold — a moment later: a page changed while a drag begins may lose the drag)
      setTimeout(() => { if (ghost && ghost.el === g && into) { into.appendChild(g); ghostTo(x, y); } }, 0);
    },
    // (not where it is already, not into itself)
    fits: (path, dir) => dir !== path && !dir.startsWith(path + "/") && path.replace(/\/[^/]*$/, "") !== dir,
    can: (dir) => !!moving.path && !!dir && (moving.paths || [moving.path]).some((p) => moving.fits(p, dir)),
    end(dir) { const all = moving.paths || [moving.path]; moving.path = moving.paths = null; if (dir) for (const path of all) if (path && moving.fits(path, dir)) post("move", { path, dir }); },
  };
  let dropInto = null;
  const setDropInto = (el) => { if (dropInto === el) return; if (dropInto) dropInto.classList.remove("drop-into"); dropInto = el; if (el) el.classList.add("drop-into"); };
  /* Where a row that is pulled would go: a folder's row — that folder; and what stands for a folder
   * in the layouts: its sign in the rail, the way back among the sheets (the folder above), the
   * folder's own name at the sidebar's head (the folder itself). Anywhere else in the sidebar:
   * the folder that is shown — so a note comes out of a folder again without a row to aim at. */
  const sbDropDir = (e) => {
    const t = e.target instanceof Element ? e.target : null, root = folder && folder.root;
    const dir = t && t.closest(".sb-list .sb-item.is-dir"), go = t && t.closest(".sb-rt[data-go], .sb-back[data-go]"), head = t && t.closest(".sb-folder");
    return dir ? [dir, dir.dataset.key] : go ? [go, go.dataset.go || root] : head ? [head, root] : [sbList, folder && (sbHere || root)];
  };
  sbList.addEventListener("dragstart", (e) => {
    const item = e.target.closest?.(".sb-item");
    if (!item || e.target.closest(".sb-rename")) { e.preventDefault(); return; }
    // (one of several that are selected: they all go; any other: it alone, and nothing is selected any more)
    const all = targetsOf(item);
    if (all.length === 1) pickRows([]);
    moving.start(e, item.dataset.key, item.firstChild.firstChild, all);
  });
  /* Files from elsewhere — a file manager, another application — pulled over the list: they are
   * copied into the folder they are let go on (the shell: import). A browser's host is handed
   * what was dropped as it is — it has the files themselves, not their addresses. → whether it took them */
  const addFiles = (transfer, dir) => { const add = window.MdHost && window.MdHost.addFiles; if (add) add(transfer, dir); return !!add; };
  const foreign = (e) => !moving.path && !!folder && !folder.quick && FILEWORK && [...(e.dataTransfer?.types || [])].some((t) => t === "text/uri-list" || t === "Files");
  sidebar.addEventListener("dragover", (e) => {
    const [el, dir] = sbDropDir(e);
    if (foreign(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropInto(el); return; }
    if (!moving.can(dir)) { setDropInto(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropInto(el);
  });
  sidebar.addEventListener("dragleave", (e) => { if (!sidebar.contains(e.relatedTarget)) setDropInto(null); });
  sidebar.addEventListener("drop", (e) => {
    const [, dir] = sbDropDir(e), ok = moving.can(dir);
    setDropInto(null);
    if (foreign(e)) {
      e.preventDefault();
      if (addFiles(e.dataTransfer, dir)) return;
      const uris = (e.dataTransfer.getData("text/uri-list") || "").split(/\r?\n/).map((u) => u.trim()).filter((u) => /^file:/.test(u));
      if (uris.length) post("import", { uris, dir }); else toast(T("Only files can be dropped here"));
      return;
    }
    if (!ok) return;
    e.preventDefault();
    moving.end(dir);
  });
  document.addEventListener("dragend", () => { moving.path = null; setDropInto(null); });

  /* The notes that are shared under a link (the folder says which: shared) are marked: a small
   * sign at the end of their row, and the share button tinted while one of them is shown. */
  function markShared() {
    const shared = new Set((folder && folder.shared) || []);
    for (const row of sbList.querySelectorAll(".sb-row[data-real]")) {
      const is = shared.has(row.dataset.real), has = row.querySelector(".sb-shared");
      if (is && !has) { const s = document.createElement("span"); s.className = "sb-shared"; s.title = "Shared under a link"; s.innerHTML = ICON.share; row.appendChild(s); }
      else if (!is && has) has.remove();
    }
    const btn = toolbar.querySelector('[data-act="share"]'), on = !!(P.current && shared.has(P.current.path));
    btn.classList.toggle("active", on);
    btn.title = on ? "Shared under a link…" : "Share…";
  }
  /* ------------------------------------------------------------ quick notes
   * A window for writing something down at once (mdview --quick): the folder of the quick notes,
   * shown as a list of short notes — what each says first is its name, under it when it was
   * written and how it goes on; what was written last stands first. A new one is made by the +
   * and by a key of the settings' (quickNew), without a name being asked for: the application
   * names the file after its first line when it is left, and takes away one left empty.
   * The notes' beginnings are the application's to read ("previews", as the tiles of all notes). */
  const quickSeen = new Map(); // path → { mtime, title, says }
  const quickPlain = (line) => line.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[.\]\s+)?|\d+[.)]\s+)/, "").replace(/[*_`$]|\[\[|\]\]|!?\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  function quickOf(n) {
    const seen = quickSeen.get(n.path);
    if (seen) return seen;
    return { title: /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}/.test(n.name) ? T("New Note") : n.name, says: "" }; // (until its beginning is read: its file's name — the time it was made at says nothing)
  }
  function quickWhen(secs) {
    if (!secs) return "";
    const d = new Date(secs * 1000), now = new Date(), day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), days = Math.round((day(now) - day(d)) / 86400000);
    if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    if (days === 1) return T("Yesterday");
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  let quickAsked = false, quickFilter = "";
  function quickPaint() {
    if (!folder || !folder.quick) return;
    const notes = new Map(folder.tree.notes.map((n) => [n.real, n])), want = [];
    for (const row of sbList.querySelectorAll(".sb-row[data-real]")) {
      const n = notes.get(row.dataset.real);
      if (!n) continue;
      const q = quickOf(n);
      let meta = row.querySelector(".qn-meta");
      if (!meta) { meta = document.createElement("span"); meta.className = "qn-meta"; meta.innerHTML = "<span class='qn-when'></span><span class='qn-says'></span>"; row.appendChild(meta); }
      const when = quickWhen(n.mtime), says = q.says || T("No additional text");
      if (meta.firstChild.textContent !== when) meta.firstChild.textContent = when;
      if (meta.lastChild.textContent !== says) meta.lastChild.textContent = says;
      const seen = quickSeen.get(n.path);
      if (!seen || seen.mtime !== n.mtime) want.push(n.path);
      const hit = !quickFilter || (q.title + "\n" + q.says).toLowerCase().includes(quickFilter);
      row.closest(".sb-item").hidden = !hit;
    }
    if (want.length && !quickAsked) { quickAsked = true; post("previews", { paths: want.slice(0, 40) }); }
  }
  function quickPreviews(got) {
    if (!folder || !folder.quick) return;
    quickAsked = false;
    const mtimes = new Map(folder.tree.notes.map((n) => [n.path, n.mtime]));
    for (const [path, p] of Object.entries(got || {})) {
      const lines = stripFrontmatter(String(p.text || "")).body.split("\n").map(quickPlain).filter(Boolean);
      quickSeen.set(path, { mtime: mtimes.get(path), title: lines[0] || T("New Note"), says: lines.slice(1, 3).join(" ") });
    }
    syncList(false); // (their names are what they say first now)
    markActiveNote(false);
    quickPaint();
  }
  // a new quick note is on screen: the caret in it, to write at once
  function quickFresh() {
    let tries = 0;
    const go = () => { if (P.mode === "active" && window.MdActive && MdActive.view.pm) MdActive.view.focus(); else if (tries++ < 40) setTimeout(go, 25); };
    go();
  }
  // the keys that make a new quick note, as the settings name them ("Ctrl+N", "Ctrl+Shift+K" …)
  const keysMatch = (e, combo) => {
    const parts = String(combo || "").split("+").map((x) => x.trim().toLowerCase()).filter(Boolean), key = parts.pop();
    return !!key && e.key.toLowerCase() === key && (e.ctrlKey || e.metaKey) === (parts.includes("ctrl") || parts.includes("super") || parts.includes("cmd")) && e.altKey === parts.includes("alt") && e.shiftKey === parts.includes("shift");
  };
  addEventListener("keydown", (e) => {
    if (!folder || !folder.quick || e.defaultPrevented || !keysMatch(e, window.MdPrefs?.quickNew || "Ctrl+N")) return;
    if (document.querySelector("#settings[data-open], #dlg[data-open], #share[data-open], #newdlg[data-open]")) return;
    e.preventDefault(); e.stopPropagation();
    P.openNewNote();
  }, true);

  /* What stands beside the notes — PDFs, pictures, sound and film, anything else — is listed as
   * the settings say, and the sidebar and All Notes each have their own say (sidebarPdf …, ovPdf …).
   * The application hands over everything that lies there (folder.all) — but what is put away:
   * hidden by hand, named with a dot, kept for a note; that too, marked `hidden`, where the
   * settings ask for it (showHidden) —, and each shows its part of it. */
  const GROUPS = [["pdf", "Pdf", "PDFs"], ["image", "Images", "Pictures"], ["media", "Media", "Sound and Video"], ["board", "Boards", "Whiteboards"], ["other", "Other", "Other Files"]];
  const groupOf = (n) => (n.kind === "pdf" ? "pdf" : n.kind === "board" ? "board" : n.kind === "image" ? "image" : n.kind === "audio" || n.kind === "video" ? "media" : "other");
  // (everything is listed, as long as a kind is not taken out)
  const groupOn = (where, g) => (window.MdPrefs || {})[where + GROUPS.find((x) => x[0] === g)[1]] !== false;
  function listed(node, where) {
    const notes = node.notes.filter((n) => !n.pdf || groupOn(where, groupOf(n)));
    // (a folder that holds only what is not listed here is left out; one that holds nothing at all — made just now — stays)
    const dirs = node.dirs.map((d) => [d, listed(d, where)]).filter(([d, l]) => l.dirs.length || l.notes.length || !(d.dirs.length || d.notes.length)).map(([, l]) => l);
    return { ...node, dirs, notes };
  }
  function applyFolder(f, animate) {
    f.all = f.tree;
    f.tree = listed(f.all, "sidebar");
    // (is there another side to sync with: a linked project — or, in the browser, always: the repository itself)
    document.body.toggleAttribute("data-linked", !!(window.MdWeb || ((f.history || {}).linked)));
    if (f.width && !sbDragging) document.documentElement.style.setProperty("--sb-w", f.width + "px");
    if (f.quick && !sbDragging && !(f.width >= 340)) document.documentElement.style.setProperty("--sb-w", "360px"); // (a list of notes wants room)
    document.body.toggleAttribute("data-quick", !!f.quick);
    if (!f.quick) quickSeen.clear();
    const first = !folder || folder.root !== f.root;
    if (first) { sbOpen.clear(); sbList.textContent = ""; sbHere = null; sbSmart = "all"; sbSeen.clear(); sbAsking.clear(); closeLook(); }
    folder = f;
    sbTitles = f.titles;
    sbTitlesBtn.classList.toggle("active", sbTitles);
    sbTitlesBtn.setAttribute("aria-pressed", String(sbTitles));
    sbTitlesBtn.title = sbTitlesBtn.ariaLabel = sbTitles ? "Show file names" : "Show note titles";
    sidebar.querySelector(".sb-folder-name").textContent = f.quick ? "Quick Notes" : f.name;
    sidebar.querySelector('[data-act="newmenu"]').title = sidebar.querySelector('[data-act="newmenu"]').ariaLabel = f.quick ? `New note (${keys(window.MdPrefs?.quickNew || "Ctrl+N")})` : "New note or folder";
    const hs = historyState();
    sbHistoryBtn.classList.toggle("quiet", hs !== "project" && hs !== "inside"); // (dimmed: this app keeps no history here)
    const odds = syncState() === "conflict"; // (changed here and on another device, the same place: to be said — the clock's menu)
    sbHistoryBtn.classList.toggle("warn", odds);
    // (a linked project: how it stands with its repository)
    const sy = syncState(), with_ = (f.history || {}).linked ? " · GitHub: " + ({ even: "the same on both", offline: "not reached", signin: "sign in to go on", conflict: "conflicts to resolve", error: "not going" }[sy] || "linked") : "";
    sbHistoryBtn.title = sbHistoryBtn.ariaLabel = HISTORY_SAYS[hs](f.history || {}) + (with_ || (odds ? " — conflicts to resolve" : ""));
    if (window.MdActive && MdActive.conflict) MdActive.conflict.standing((f.history || {}).sync);
    document.body.dataset.folder = "";
    if (first) openAncestors();
    syncList(animate && !first);
    quickPaint();
    markActiveNote(first);
    // (on a narrow window — a phone — the sidebar is a drawer over the note: shut until it is asked for, and as it stands after that)
    P.showSidebar(P.compact() ? (first ? false : sidebarOpen()) : f.quick ? true : f.visible, !first); // (the quick notes are their list)
    if (!P.current) clear();
    for (const el of P.tabEls()) { const t = P.tabs.find((x) => String(x.id) === el.dataset.id); if (t) P.paintTab(el, t); } // (names or titles, as the list)
    if (window.MdOverview) MdOverview.folderChanged();
  }

  // --- the note on screen: highlighted, its folders open, scrolled into view
  function openAncestors() {
    if (!folder || !P.current) return;
    const walk = (dir) => {
      if (dir.notes.some((n) => n.real === P.current.path)) return true;
      for (const d of dir.dirs) if (walk(d)) { sbOpen.add(d.path); return true; }
      return false;
    };
    walk(folder.tree);
  }
  function markActiveNote(reveal) {
    markShared(); // (the share button says whether the note now shown is shared)
    if (!folder) return;
    if (reveal && P.current) {
      const before = sbOpen.size;
      openAncestors();
      if (sbOpen.size !== before) syncList(true);
      // (rail, sheets: the folder the note lies in is the one shown)
      const lay = sbLayout(), holds = (dir) => dir.notes.some((n) => n.real === P.current.path), find = (dir) => (holds(dir) ? dir : dir.dirs.map(find).find(Boolean));
      const home = lay === "rail" || lay === "sheets" ? find(folder.tree) : null;
      if (home) { const at = home === folder.tree ? null : lay === "sheets" ? home.path : folder.root + "/" + relOf(home.path).split("/")[0]; if (at !== sbHere && !(lay === "rail" && !sbHere)) { sbHere = at; syncList(false); } }
    }
    for (const row of sidebar.querySelectorAll(".sb-extra .sb-row[data-loose]")) row.classList.toggle("active", !!P.current && row.dataset.loose === P.current.path);
    let active = null;
    const here = P.goingAt && P.goingTo ? P.goingTo : P.current?.path; // (a note on its way is the marked one: the list changes while it loads, and must not mark the last one again)
    for (const row of sbList.querySelectorAll(".sb-row[data-real]")) {
      const on = !!here && (row.dataset.real === here || row.closest(".sb-item")?.dataset.key === here);
      row.classList.toggle("active", on);
      if (on) { row.setAttribute("aria-current", "page"); active = row; } else row.removeAttribute("aria-current");
    }
    if (reveal && active) active.scrollIntoView({ block: "nearest" });
  }
  function toggleDir(item) {
    const key = item.dataset.key, open = !sbOpen.has(key);
    if (open) sbOpen.add(key); else sbOpen.delete(key);
    item.classList.toggle("open", open);
    item.firstChild.firstChild.setAttribute("aria-expanded", String(open));
  }
  sbList.addEventListener("click", (e) => {
    const row = e.target.closest(".sb-row");
    if (!row) return;
    const item = row.closest(".sb-item");
    // Shift+click: one more selected, or one less — nothing opens (as among the tiles of All Notes)
    if (e.shiftKey) { const now = new Set(sbPicked); if (!now.delete(item.dataset.key)) now.add(item.dataset.key); pickRows(now); return; }
    if (sbPicked.size) pickRows([]);
    if (item.classList.contains("is-dir")) { if (sbLayout() === "sheets") setHere(item.dataset.key, false); else toggleDir(item); } // (among the sheets a folder is gone into)
    else if (!row.classList.contains("active") || e.ctrlKey || e.metaKey) openRow(item, e.ctrlKey || e.metaKey);
  });
  /* Several rows at once. What is done to one of them — by the menu, a key, a pull — is done to all. */
  function pickRows(keys) {
    sbPicked.clear();
    for (const k of keys) sbPicked.add(k);
    for (const row of sbList.querySelectorAll(".sb-row")) row.classList.toggle("picked", sbPicked.has(row.closest(".sb-item").dataset.key));
  }
  const targetsOf = (item) => (sbPicked.size > 1 && sbPicked.has(item.dataset.key) ? [...sbPicked] : [item.dataset.key]);
  const parentOf = (path) => path.replace(/\/[^/]*$/, "");
  // where Paste puts things, for a row: the folder itself, or the folder a file lies in
  const dirFor = (item) => (item.classList.contains("is-dir") ? item.dataset.key : parentOf(item.dataset.key));
  /* What a folder's list does with files, by name — the menu's entries, the keys, All Notes' tiles
   * (paths: what it is done to; dir: where to). → whether it was one of them */
  function fileCmd(cmd, paths, dir) {
    if (cmd === "copyf" || cmd === "cutf") post("copyfiles", { paths, cut: cmd === "cutf" });
    else if (cmd === "pastef") post("pastefiles", { dir });
    else if (cmd === "duplicate") post("duplicate", { paths });
    else if (cmd === "hide" || cmd === "unhide") post("hide", { paths, on: cmd === "hide" });
    else if (cmd === "addfiles") post("addfiles", { dir });
    else if (cmd === "copypath") { post("copy", { text: paths.join("\n") }); toast(T("Copied")); }
    else if (cmd === "trash") { if (paths.length > 1) post("trash", { paths }); else post("trash", { path: paths[0] }); }
    else return false;
    return true;
  }
  const hiddenIn = (node, path) => { const n = node.notes.find((x) => x.path === path) || node.dirs.find((d) => d.path === path); return n ? !!n.hidden : node.dirs.some((d) => path.startsWith(d.path + "/") && hiddenIn(d, path)); };
  const isHidden = (path) => !!folder && hiddenIn(folder.all || folder.tree, path);
  /* Rows that were just made — pasted, added, a copy — are brought into sight: their folders open, the first one scrolled to. */
  function revealRows(paths) {
    if (!folder || !paths || !paths.length) return;
    for (const p of paths) for (let d = parentOf(p); d.length > folder.root.length; d = parentOf(d)) sbOpen.add(d);
    syncList(true);
    const first = [...sbList.querySelectorAll(".sb-item")].find((el) => el.dataset.key === paths[0]);
    if (first) first.firstChild.firstChild.scrollIntoView({ block: "nearest" });
  }
  // a note asked for in the list; with Ctrl held or the middle button: in a tab of its own
  function openRow(item, tab) {
    const row = item.firstChild.firstChild;
    going(row.dataset.real || item.dataset.key);
    post("note", { path: item.dataset.key, tab });
  }
  sbList.addEventListener("mousedown", (e) => { if (e.button === 1 && e.target.closest(".sb-row")) e.preventDefault(); }); // (no scrolling by the middle button here)
  sbList.addEventListener("auxclick", (e) => {
    const item = e.button === 1 && e.target.closest(".sb-row")?.closest(".sb-item");
    if (!item || item.classList.contains("is-dir")) return;
    e.preventDefault();
    openRow(item, true);
  });
  sbList.addEventListener("keydown", (e) => {
    const row = e.target.closest(".sb-row");
    if (!row || e.altKey || e.target.closest(".sb-rename")) return;
    const item = row.closest(".sb-item"), isDir = item.classList.contains("is-dir");
    if (e.ctrlKey || e.metaKey) { // Copy, Cut, Paste, Duplicate — on the row the keyboard is on, or on all that are selected
      const cmd = e.shiftKey || !FILEWORK ? null : { c: "copyf", x: "cutf", v: "pastef", d: "duplicate" }[e.key.toLowerCase()];
      if (cmd) { e.preventDefault(); e.stopPropagation(); fileCmd(cmd, targetsOf(item), dirFor(item)); }
      return;
    }
    if (e.key === "Escape" && sbPicked.size) { e.preventDefault(); e.stopPropagation(); pickRows([]); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // rows inside a closed (or closing) folder are skipped
      const rows = [...sbList.querySelectorAll(".sb-row")].filter((r) => {
        for (let p = r.closest(".sb-item").parentElement.closest(".sb-item"); p; p = p.parentElement.closest(".sb-item")) {
          if (!p.classList.contains("open") && !p.classList.contains("sb-path")) return false;
        }
        return !r.closest(".leaving");
      });
      const next = rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)];
      e.preventDefault();
      if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: "nearest" }); }
    } else if (e.key === "F2") { e.preventDefault(); P.startRename(item); }
    else if (e.key === "Delete") { e.preventDefault(); fileCmd("trash", targetsOf(item)); pickRows([]); }
    else if (e.key === "ArrowRight" && isDir && !item.classList.contains("open")) { e.preventDefault(); toggleDir(item); }
    else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (isDir && item.classList.contains("open")) toggleDir(item);
      else item.parentElement.closest(".sb-item")?.firstChild.firstChild.focus();
    }
  });

  // --- rename (in place) and trash, from the context menu or F2 / Delete on a row
  const ctx = document.createElement("div");
  ctx.id = "ctxmenu";
  ctx.className = "ui-menu surface";
  ctx.style.setProperty("--origin", "top left");
  ctx.tabIndex = -1;
  ctx.setAttribute("role", "menu");
  // One menu, wherever a thing is met. data-for says for WHAT an entry is — a "file", a "dir", "many" of them selected, the
  // empty room beside them ("blank": the folder `dir` itself), the + button ("new") — never WHERE: a folder has the same
  // entries on its row in the sidebar, on its sign in the rail and on its tile in All Notes, and a note on its row and its
  // tile. (KINDS takes the names the places used to have. Where an entry is carried out differently — a name changed in a
  // row or on a tile — is said where it is carried out: runCtx, by ctxTile and ctxFrom. dev/rig.sh sidebar holds the three
  // places to the same entries.)
  const entry = (cmd, icon, label, on, key = "", cls = "", more = "") =>
    `<button class="menu-item${cls}" role="menuitem" data-cmd="${cmd}" data-for="${on}"${more}><span class="menu-icon">${ICON[icon]}</span><span class="menu-label">${label}</span>${key ? `<span class="menu-key">${keys(key)}</span>` : ""}</button>`;
  ctx.innerHTML =
    entry("open", "note", T("Open"), "file dir") +
    entry("opentab", "plus", T("Open in New Tab"), "file") +
    entry("openbeside", "panel", T("Open Beside"), "file") +
    entry("opentab", "plus", T("Open in New Tabs"), "many") +
    `<div class="menu-rule" data-for="file dir many"></div>` +
    entry("tab:new", "plus", T("New Tab"), "tab", "Ctrl+T") +
    entry("tab:reopen", "note", T("Reopen Closed Tab"), "tab", "Ctrl+Shift+T") +
    `<div class="menu-rule" data-for="tab"></div>` +
    entry("tab:close", "x", T("Close Tab"), "tab", "Ctrl+W") +
    entry("tab:others", "x", T("Close Other Tabs"), "tab") +
    // the history's button: what can be done where the folder stands (data-state), or what is so (disabled)
    entry("history:conflicts", "info", T("Resolve Conflicts…"), "history", "", "", ' data-sync="conflict"') +
    `<div class="menu-rule" data-for="history" data-sync="conflict"></div>` +
    entry("history:show", "history", T("Show History of This Note"), "history", "Ctrl+Alt+H", "", ' data-state="project inside foreign adopt paused"') +
    `<div class="menu-rule" data-for="history" data-state="project inside foreign adopt paused"></div>` +
    entry("history:on", "history", T("Turn On History"), "history", "", "", ' data-state="none paused"') +
    entry("history:on", "history", T("Use This Repository for History…"), "history", "", "", ' data-state="adopt"') +
    entry("history:is", "check", T("History Is On"), "history", "", "", ' data-state="project" disabled') +
    entry("history:is", "check", "", "history", "", "", ' data-state="inside" disabled') +
    entry("history:is", "info", "", "history", "", "", ' data-state="foreign" disabled') +
    entry("history:off", "x", T("Turn Off History"), "history", "", "", ' data-state="project"') +
    entry("newnote", "note", T("New Note"), "dir new blank", "Ctrl+N") +
    entry("newfolder", "folderPlus", T("New Folder"), "dir new blank") +
    entry("newboard", "board", T("New Whiteboard"), "dir new blank") +
    entry("addfiles", "down", T("Add Files…"), "dir new blank") +
    entry("pastef", "clip", T("Paste"), "dir blank", "Ctrl+V") +
    `<div class="menu-rule" data-for="blank"></div>` +
    entry("sort:opened", "check", T("Sort by Last Opened"), "blank") +
    entry("sort:name", "check", T("Sort by Name"), "blank") +
    entry("sort:modified", "check", T("Sort by Date Modified"), "blank") +
    `<div class="menu-rule" data-for="dir"></div>` +
    entry("default", "external", T("Open in Default App"), "file") +
    entry("openwith", "apps", T("Open With…"), "file") +
    entry("reveal", "reveal", T("Show in Finder"), "file dir") +
    entry("download", "down", T("Download"), "file") +
    entry("embed", "board", T("Embed in This Note"), "file") +
    entry("boardnote", "note", T("Show the Note It Is In"), "file") +
    entry("boardfree", "file", T("Keep as a File of Its Own"), "file") +
    `<div class="menu-rule" data-for="file dir many"></div>` +
    entry("copyf", "copy", T("Copy"), "file dir many", "Ctrl+C") +
    entry("cutf", "cut", T("Cut"), "file dir many", "Ctrl+X") +
    entry("duplicate", "plus", T("Duplicate"), "file dir many", "Ctrl+D") +
    entry("copypath", "clip", T("Copy Path"), "file dir") +
    `<div class="menu-rule" data-for="file dir many"></div>` +
    entry("share", "share", T("Share…"), "file") +
    entry("look", "palette", T("Colour and Icon…"), "dir") +
    entry("rename", "rename", T("Rename"), "file dir", "F2") +
    entry("hide", "eyeOff", T("Hide"), "file dir many") +
    entry("unhide", "eye", T("Show Again"), "file dir") +
    entry("trash", "trash", T("Move to Trash"), "file dir many", "Del", " danger") +
    // what is listed beside the notes: a menu of its own beside this one (the sidebar's, or All Notes' — where the click was)
    `<div class="menu-rule" data-for="blank file dir"></div>` +
    entry("sub:show", "list", T("Show"), "blank file dir", "", " has-sub", ' aria-haspopup="menu"');
  for (const el of ctx.querySelectorAll(".has-sub")) el.insertAdjacentHTML("beforeend", `<span class="menu-key menu-go">${ICON.chevron}</span>`);
  // the menu beside it: what "Show" leads to — a tick for each kind that is listed
  const ctxSub = document.createElement("div");
  ctxSub.id = "ctxsub";
  ctxSub.className = "ui-menu surface actmenu has-checks";
  ctxSub.setAttribute("role", "menu");
  ctxSub.tabIndex = -1;
  document.body.appendChild(ctxSub);
  let subItems = [], subHl = -1, subWhere = "sidebar";
  const subOpen = () => ctxSub.hasAttribute("data-open");
  const setSubHl = (i) => { subHl = i; subItems.forEach((el, k) => el.classList.toggle("hl", k === i)); };
  function openSub(from, keys) {
    if (subOpen()) { if (keys) setSubHl(0); return; }
    subWhere = ctxFor && ctxFor.closest("#overview") ? "ov" : "sidebar";
    const tick = (on, how, label) => `<button class="menu-item" role="menuitemcheckbox" aria-checked="${on}" ${how}><span class="menu-icon"${on ? "" : ' style="visibility:hidden"'}>${ICON.check}</span><span class="menu-label">${esc(T(label))}</span></button>`;
    // (each kind that is listed — and, for both lists at once, what is put away: hidden by hand, named with a dot, kept for a note)
    ctxSub.innerHTML = GROUPS.map(([g, , label]) => tick(groupOn(subWhere, g), `data-group="${g}"`, label)).join("") + (FILEWORK ? `<div class="menu-rule"></div>` + tick(!!(window.MdPrefs || {}).showHidden, `data-pref="showHidden"`, "Hidden Items") : ""); // (where the host puts things away: not among the welcome page's notes)
    subItems = [...ctxSub.querySelectorAll(".menu-item")];
    const r = from.getBoundingClientRect(), w = ctxSub.offsetWidth, right = r.right + 2 + w <= innerWidth - 8;
    ctxSub.style.setProperty("--origin", right ? "top left" : "top right");
    ctxSub.style.left = (right ? r.right + 2 : Math.max(8, r.left - 2 - w)) + "px";
    ctxSub.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - ctxSub.offsetHeight - 8)) + "px";
    ctxSub.dataset.open = "";
    from.setAttribute("aria-expanded", "true");
    setSubHl(keys ? 0 : -1);
    if (keys) ctxSub.focus({ preventScroll: true });
  }
  function closeSub(back) {
    if (!subOpen()) return false;
    delete ctxSub.dataset.open;
    for (const el of ctx.querySelectorAll(".has-sub")) el.removeAttribute("aria-expanded");
    if (back) ctx.focus({ preventScroll: true });
    return true;
  }
  function runSub(i) {
    const el = subItems[i];
    if (!el) return;
    const flash = motionMs("--flash-duration", 70), key = el.dataset.pref || subWhere + GROUPS.find((x) => x[0] === el.dataset.group)[1], on = el.dataset.pref ? !(window.MdPrefs || {})[key] : !groupOn(subWhere, el.dataset.group);
    el.classList.remove("hl");
    setTimeout(() => el.classList.add("hl"), flash);
    setTimeout(() => {
      closeCtx(false);
      window.MdPrefs = { ...(window.MdPrefs || {}), [key]: on };
      post("prefs", { prefs: { [key]: on } }); // (the application lists anew: what either wants)
    }, flash * 2);
  }
  ctxSub.addEventListener("mousemove", (e) => { const i = subItems.indexOf(e.target.closest(".menu-item")); if (i !== subHl) setSubHl(i); });
  ctxSub.addEventListener("mouseleave", () => setSubHl(-1));
  ctxSub.addEventListener("click", (e) => runSub(subItems.indexOf(e.target.closest(".menu-item"))));
  ctxSub.addEventListener("contextmenu", (e) => e.preventDefault());
  ctxSub.addEventListener("keydown", (e) => {
    const n = subItems.length, moves = { ArrowDown: subHl + 1, ArrowUp: subHl < 0 ? n - 1 : subHl - 1, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); e.stopPropagation(); setSubHl(Math.min(n - 1, Math.max(0, moves[e.key]))); }
    else if (e.key === "Enter" && subHl >= 0) { e.preventDefault(); e.stopPropagation(); runSub(subHl); }
    else if (e.key === "ArrowLeft" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSub(true); }
  });
  document.body.appendChild(ctx);
  // A host says what it cannot do (MdHost.lacks: commands of this menu) and what it calls what it
  // does otherwise (MdHost.labels: a file deleted in a repository goes to no Trash).
  const HOST_LACKS = new Set((window.MdHost && window.MdHost.lacks) || []);
  for (const [cmd, label] of Object.entries((window.MdHost && window.MdHost.labels) || {})) for (const el of ctx.querySelectorAll(`[data-cmd="${cmd}"] .menu-label`)) el.textContent = label;
  let ctxItems = [];
  const KINDS = { ovnote: "file", ovdir: "dir", ovmany: "many", sbmany: "many", ovnew: "new" };
  let ctxTile = false, ctxFrom = null, ctxFor = null, ctxHl = -1, ctxKind = "file", ctxDir = null;
  const ctxOpen = () => ctx.hasAttribute("data-open");
  const setCtxHl = (i) => { ctxHl = i; ctxItems.forEach((el, k) => el.classList.toggle("hl", k === i)); };
  /* What of the menu is not for this row or tile: Hide for what is hidden and the other way round, a
   * whiteboard's entries for anything else — and for a whiteboard a note keeps (All Notes shows those
   * too) nothing that would take it from its note. */
  const FILE_CMDS = ["newboard", "addfiles", "pastef", "copyf", "cutf", "duplicate", "copypath", "hide", "unhide", "embed", "boardnote", "boardfree"];
  function ctxLacks(cmd, item, kind) {
    if (!FILE_CMDS.includes(cmd) && !(item.dataset && item.dataset.kept != null)) return false;
    if (FILE_CMDS.includes(cmd) && (!FILEWORK || (folder && folder.quick))) return true; // (what only a host that works with files as files does: viewer/base.js)
    const path = item.dataset ? item.dataset.path || item.dataset.key || "" : "", board = /\.board\.svg$/i.test(path), kept = !!item.dataset && item.dataset.kept != null;
    if (kept) return !["open", "reveal", "embed", "boardnote", "boardfree", "copypath", "sub:show"].includes(cmd) || (cmd === "boardnote" && !item.dataset.note);
    if (cmd === "boardfree") return true;
    if (cmd === "boardnote") return !(board && item.dataset.note);
    if (cmd === "embed") return !board || !P.current || P.current.kind === "pdf" || !!P.current.readonly;
    if (cmd === "hide" || cmd === "unhide") return kind !== "many" && (cmd === "unhide") !== isHidden(path);
    return false;
  }
  function openCtx(item, x, y, kind = "file", dir = null, from = null) {
    if (ctxFor) ctxFor.classList.remove("ctx-target");
    if (ctxFrom) ctxFrom.classList.remove("ctx-target");
    ctxTile = !!(item.classList && item.classList.contains("ov-item")) || kind === "ovmany"; // (met among All Notes' tiles)
    kind = KINDS[kind] || kind;
    ctxFor = item; ctxDir = dir; ctxFrom = from;
    if (from) from.classList.add("ctx-target");
    ctxKind = ctx.dataset.kind = kind;
    for (const el of ctx.children) el.hidden = !el.dataset.for.split(" ").includes(kind) || (!!el.dataset.state && !el.dataset.state.split(" ").includes(historyState())) || (!!el.dataset.sync && el.dataset.sync !== syncState())
      || (el.dataset.cmd === "history:off" && !!((folder && folder.history) || {}).fixed) // (a host whose folders always have their history: nothing to switch off)
      || HOST_LACKS.has(el.dataset.cmd) // (what a host has no way to do — a browser shows nothing in a Finder — is not offered)
      || (el.dataset.cmd === "download" && !(window.MdHost && window.MdHost.download)) // (… and a file is handed out only where it is not one in a folder already)
      || ctxLacks(el.dataset.cmd, item, kind);
    // (a rule with nothing above it, nothing below it, or another rule above it divides nothing)
    let above = false, rule = null;
    for (const el of ctx.children) {
      if (el.hidden) continue;
      if (el.classList.contains("menu-rule")) { el.hidden = !above || !!rule; if (!el.hidden) rule = el; }
      else { above = true; rule = null; }
    }
    if (rule) rule.hidden = true;
    if (kind === "history") { // (the two that name a folder)
      const name = (folder.history || {}).name;
      ctx.querySelector('[data-cmd="history:is"][data-state="inside"] .menu-label').textContent = `Part of the Project “${name}”`;
      ctx.querySelector('[data-cmd="history:is"][data-state="foreign"] .menu-label').textContent = `Kept by the Repository “${name}”`;
    }
    ctxItems = [...ctx.querySelectorAll(".menu-item:not([hidden])")];
    for (const el of ctxItems) if (el.dataset.cmd.startsWith("sort:")) { // the order in use is ticked
      const on = el.dataset.cmd.slice(5) === sortKey();
      el.setAttribute("role", "menuitemradio"); el.setAttribute("aria-checked", String(on));
      el.querySelector(".menu-icon").style.visibility = on ? "" : "hidden";
    }
    if (kind === "tab") for (const el of ctxItems) { // what there is nothing to do for stands dimmed
      const off = (el.dataset.cmd === "tab:reopen" && !P.tabClosed) || (el.dataset.cmd === "tab:others" && P.tabs.length < 2);
      el.disabled = off; el.classList.toggle("off", off);
    }
    ctxItems = ctxItems.filter((el) => !el.disabled);
    const hangs = kind === "new" || kind === "history"; // (from a button of the sidebar's head)
    ctx.style.setProperty("--origin", hangs ? "top right" : "top left");
    if (!hangs && kind !== "blank" || item.matches(".ov-more")) item.classList.add("ctx-target");
    setCtxHl(-1);
    if (hangs) x -= ctx.offsetWidth; // (it hangs from the button's right edge)
    ctx.style.left = Math.max(8, Math.min(x, innerWidth - ctx.offsetWidth - 8)) + "px";
    ctx.style.top = Math.max(8, Math.min(y, innerHeight - ctx.offsetHeight - 8)) + "px";
    ctx.dataset.open = "";
    ctx.focus({ preventScroll: true });
  }
  function closeCtx(refocus) {
    if (!ctxOpen()) return false;
    closeSub(false);
    delete ctx.dataset.open;
    ctxFor.classList.remove("ctx-target");
    if (ctxFrom) ctxFrom.classList.remove("ctx-target");
    if (refocus && ctxKind !== "new" && ctxKind !== "history" && ctxKind !== "blank" && ctxKind !== "tab") (ctxFrom || (ctxFor.classList.contains("sb-item") ? ctxFor.firstChild.firstChild : ctxFor)).focus({ preventScroll: true });
    return true;
  }
  function runCtx(i) {
    const el = ctxItems[i], item = ctxFor;
    if (!el) return;
    if (el.dataset.cmd.startsWith("sub:")) { openSub(el, false); return; } // (a menu of its own: it stays)
    const flash = motionMs("--flash-duration", 70); // blink once, then act — like NSMenu
    el.classList.remove("hl");
    setTimeout(() => el.classList.add("hl"), flash);
    setTimeout(() => {
      const kind = ctxKind, dir = ctxDir, from = ctxFrom;
      closeCtx(false);
      if (!item.isConnected) return;
      const cmd = el.dataset.cmd, tile = ctxTile && (kind === "file" || kind === "dir"), path = tile ? item.dataset.path : item.dataset.key;
      if (kind === "many" && ctxTile) { if (!fileCmd(cmd, MdOverview.picked)) MdOverview.many(cmd); else if (cmd !== "copyf") MdOverview.pick([]); return; } // (what is selected in All Notes, all of it)
      if (kind === "many") { // (… and in the sidebar)
        if (cmd === "opentab") { for (const p of sbPicked) if (/\.(md|markdown)$/i.test(p)) post("note", { path: p, tab: true }); }
        else fileCmd(cmd, [...sbPicked]);
        if (cmd !== "copyf") pickRows([]);
        return;
      }
      const into = kind === "dir" ? path : kind === "blank" || kind === "new" ? dir : null;
      if (cmd === "newnote" || cmd === "newfolder" || cmd === "newboard") P.openNewNote(cmd === "newfolder" ? "folder" : cmd === "newboard" ? "board" : "note", into);
      else if (cmd === "embed") P.embedBoard(path);
      else if (cmd === "boardnote") { MdOverview.close(false); post("note", { path: item.dataset.note }); }
      else if (cmd === "boardfree") post("board-free", { path });
      else if (fileCmd(cmd, [path], into || (path ? parentOf(path) : folder.root))) { /* done */ }
      else if (cmd.startsWith("sort:")) setSort(cmd.slice(5));
      else if (cmd === "history:show") openHistory();
      else if (cmd === "share") { if (/\.(md|markdown)$/i.test(path)) openShare(path); else toast(T("Only notes can be shared")); }
      else if (cmd === "history:conflicts") openConflicts();
      else if (cmd === "history:off") post("history-disable"); // (its versions stay; nothing more is kept)
      else if (cmd === "history:on") post("history-enable", { root: folder.root }); // (a repository that is there: the shell asks first)
      else if (cmd === "open") { if (tile) MdOverview.go(item); else (from || item.firstChild.firstChild).click(); } // (as a click on it does, where it is)
      else if (cmd === "opentab") post("note", { path, tab: true });
      else if (cmd === "openbeside") { if (tile && window.MdOverview) MdOverview.close(false); P.splitOpen({ path }); } // (beside the note: viewer/split.js)
      else if (cmd === "download") post("download", { path });
      else if (cmd.startsWith("tab:")) post("tab", { op: cmd.slice(4), id: item.dataset.id });
      else if (cmd === "look") openLook(path, from || (tile ? item : item.firstChild.firstChild));
      else if (cmd === "rename") {
        if (tile) MdOverview.rename(item);
        else if (from) { // (met in the rail, it has no row on screen: All Notes shows every folder's row, and the name is changed there)
          sbRail.querySelector('.sb-rt[data-go=""]')?.click();
          requestAnimationFrame(() => { const row = [...sbList.querySelectorAll(".sb-item.is-dir")].find((x) => x.dataset.key === path); if (row) { row.scrollIntoView({ block: "nearest" }); P.startRename(row); } });
        } else P.startRename(item);
      }
      else if (cmd === "trash") post("trash", { path });
      else post("fileop", { op: cmd, path });
    }, flash * 2);
  }
  sidebar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // (a folder's sign in the rail: the folder's own menu — its row in the list is the one the menu is for, on screen or not)
    const sign = e.target.closest(".sb-rt[data-go]");
    if (sign) {
      const row = sign.dataset.go && [...sbList.querySelectorAll(".sb-item.is-dir")].find((el) => el.dataset.key === sign.dataset.go);
      if (row) { if (sbPicked.size) pickRows([]); openCtx(row, e.clientX, e.clientY, "dir", null, sign); }
      return;
    }
    const item = e.target.closest(".sb-row")?.closest(".sb-item");
    // (one of several that are selected: the menu is for all of them; any other: for it, and nothing is selected any more)
    const several = item && sbPicked.size > 1 && sbPicked.has(item.dataset.key);
    if (item && !several && sbPicked.size) pickRows([]);
    if (item) openCtx(item, e.clientX, e.clientY, several ? "sbmany" : item.classList.contains("is-dir") ? "dir" : "file");
    else if (folder && !e.target.closest(".sb-head, .sb-field")) openCtx(sidebar, e.clientX, e.clientY, "blank", folder.root); // the empty room: new, in the folder itself
  });
  ctx.addEventListener("contextmenu", (e) => e.preventDefault());

  // what the page's other files use of this one
  Object.assign(P, { sidebar, sbHead, sbList, sbTitlesBtn, sbHistoryBtn, sidebarOpen, sortKey, sortNotes,
    resort, rowIcon, syncList, sbLayout, lookOf, colorVar, folderGlyph, sbPreviews, setFolder, moving,
    markShared, quickWhen, quickPreviews, quickFresh, GROUPS, groupOn, listed, applyFolder, markActiveNote, revealRows, fileCmd, addFiles,
    ctx, ctxSub, subOpen, openSub, closeSub, ctxOpen, setCtxHl, openCtx, closeCtx, runCtx });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    folder: [() => folder],
    sbTitles: [() => sbTitles],
    ctxItems: [() => ctxItems],
    ctxHl: [() => ctxHl],
    ctxKind: [() => ctxKind],
  });
})();
