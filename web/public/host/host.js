/* mdview on the web — the page's host in the browser. The page (viewer.js and friends, the
 * desktop app's own) says things with MdHost.post and is told things by MdView.…; on the desktop
 * the Rust shell is at the other end, here this is, with a repository on GitHub in the disk's
 * place. What each message means, and which are answered: host/contract.ts.
 *
 * It asks the app's own server (/api/r/<owner>/<repo>/…, /file/…), never GitHub itself: the
 * token stays on the server.
 *
 * What is written is first a draft in this browser — at once, and kept across a reload — and
 * becomes a commit after a quiet while, with Ctrl+S, and when the tab is left. A commit names
 * the commit it is made on; where the branch stands elsewhere by then, what was written there
 * is joined with the drafts first (core.js: merge3), and what both changed in the same place
 * is the user's to say, in the conflicts' window. */
"use strict";
(() => {
  const C = window.MdWebCore, W = window.MdWeb; // { owner, repo, user: { login, name } }
  const BASE = `/${W.owner}/${W.repo}`, FILES = location.origin + "/file", API = `/api/r/${encodeURIComponent(W.owner)}/${encodeURIComponent(W.repo)}`;
  const tell = (name, ...args) => { const f = window.MdView && window.MdView[name]; if (f) return f(...args); };
  const toast = (text) => tell("toast", text);
  const fileUrl = (path) => FILES + path.split("/").map(encodeURIComponent).join("/");
  const rel = (path) => path.slice(BASE.length + 1);
  const EMBED_LIMIT = 256 * 1024, PREVIEW_BYTES = 2400, PREVIEW_BATCH = 60, LOOK_EVERY = 60 * 1000;

  // ------------------------------------------------------------ what the browser keeps
  const KEY = `mdview:${W.owner}/${W.repo}`;
  const load = (key, or) => { try { return JSON.parse(localStorage.getItem(key)) ?? or; } catch { return or; } };
  const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* (no room, or not allowed: not kept) */ } };
  const here = load(KEY, {}); // { tabs, opened, last, sidebar: { visible, width, titles } }
  here.opened = here.opened || {}; here.sidebar = here.sidebar || {};
  const save = () => keep(KEY, here);
  let prefs = { ...window.MdPrefs };

  // ------------------------------------------------------------ the repository
  let head = null, branch = "main", files = new Map(); // path in the repository → { sha, size }, as the branch has it
  const texts = new Map(); // a blob's id → its text (null: not text)
  // what was written here and is no commit yet: path → { text, base } (base: the blob it was
  // written over; null: the file is new), the files deleted here, the folders made here
  const drafts = new Map(), gone = new Set(), keptDirs = new Set(); // (filled when the tab knows which are its own: claimTab)
  const goneAt = new Map(); // a file deleted here → the blob it was then (this session's deletions: what is written there since is not deleted with it)
  const blobs = new Map(); // pictures put in here, until they are in a commit: path → their bytes, base64
  /* Files the repository has, put under another path here — moved, renamed, copied — until that
   * is in a commit: the new path → { sha, size }. They are named by their blob: nothing of them
   * is fetched or sent again, whatever their size (the server: lib/github.ts, commitLinked). */
  const links = new Map();
  const away = new Map(); // files given another name here, until that is in a commit: the old path → the blob it was
  const moves = new Map(); // what was written here and then moved, until that is in a commit: its new path → the one the repository knows it by (so that it can be put back)
  const uploads = new Set(); // files from elsewhere on their way into the repository (their bytes wait in blobs): marked in the list until a commit has them
  const queued = new Map(); // … and those whose turn has not come: path → the file as the browser has it (listed at once, read when the commit before is made)
  /* The drafts are a tab's own. Two tabs on the same repository each write what was typed in
   * them; were the drafts one heap, the second tab would take the first's half-typed text for
   * its own, commit it too, and meet itself as a conflict. A tab has a name that stays with it
   * across a reload (sessionStorage) and holds a lock under it while it lives; what a tab that
   * is gone left behind — closed before its commit — is taken over by the next one opened. */
  let TAB = null, unkept = false;
  const mineKey = (what) => `${KEY}:${what}:${TAB}`;
  const forget = (key) => { try { localStorage.removeItem(key); } catch { /* (not allowed: stays) */ } };
  function keepDrafts() {
    if (!TAB) return;
    if (!drafts.size) forget(mineKey("drafts"));
    else if (!keep(mineKey("drafts"), Object.fromEntries(drafts))) {
      // No room for all of them (a whiteboard with pictures on it is large): the notes' drafts are kept
      // without the boards', and what could not be kept goes into a commit now instead of after the quiet while.
      keep(mineKey("drafts"), Object.fromEntries([...drafts].filter(([r]) => !/\.board\.svg$/i.test(r))));
      if (!unkept) { unkept = true; setTimeout(() => { unkept = false; commit(); }, 0); }
    }
    if (gone.size) keep(mineKey("gone"), [...gone]); else forget(mineKey("gone"));
    // (what was moved or copied and is no commit yet: a reload must not show it where it was)
    if (links.size || away.size || moves.size) keep(mineKey("moved"), { links: Object.fromEntries(links), away: Object.fromEntries(away), moves: Object.fromEntries(moves) }); else forget(mineKey("moved"));
    // (the pictures and files put in and not committed yet: with the drafts that show them — else a
    // reload before the commit leaves a note that names a picture nobody has. As far as there is room.)
    let size = 0;
    for (const b of blobs.values()) size += b.length;
    if (blobs.size && size < 3000000) keep(mineKey("blobs"), Object.fromEntries(blobs)); else forget(mineKey("blobs"));
  }
  function adopt(draftsKey, goneKey, blobsKey, movedKey) {
    const moved = movedKey ? load(movedKey, {}) : {};
    for (const [r, l] of Object.entries(moved.links || {})) if (l && typeof l.sha === "string" && !links.has(r)) links.set(r, l);
    for (const [r, sha] of Object.entries(moved.away || {})) if (typeof sha === "string" && !away.has(r)) away.set(r, sha);
    for (const [r, was] of Object.entries(moved.moves || {})) if (typeof was === "string" && !moves.has(r)) moves.set(r, was);
    for (const [r, d] of Object.entries(load(draftsKey, {}))) if (d && typeof d.text === "string" && (!drafts.has(r) || (d.at || 0) > (drafts.get(r).at || 0))) drafts.set(r, d);
    for (const r of load(goneKey, [])) gone.add(r);
    if (blobsKey) for (const [r, b] of Object.entries(load(blobsKey, {}))) if (typeof b === "string" && !blobs.has(r)) blobs.set(r, b);
  }
  async function claimTab() {
    const locks = navigator.locks, name = (id) => "mdview:tab:" + id;
    // (held for as long as the page lives: the promise never settles)
    const hold = (id) => new Promise((got) => { locks.request(name(id), { ifAvailable: true }, (lock) => { got(!!lock); return lock ? new Promise(() => {}) : undefined; }).catch(() => got(false)); });
    let id = null;
    try { id = sessionStorage.getItem("mdview:tab"); } catch { /* (not allowed) */ }
    if (!locks) TAB = id || crypto.randomUUID(); // (a browser without locks: one heap, as it was)
    else {
      if (!id || !(await hold(id))) { id = crypto.randomUUID(); await hold(id); } // (taken: this tab was made as a copy of another)
      TAB = id;
    }
    try { sessionStorage.setItem("mdview:tab", TAB); } catch { /* (not allowed) */ }
    adopt(mineKey("drafts"), mineKey("gone"), mineKey("blobs"), mineKey("moved"));
    adopt(KEY + ":drafts", KEY + ":gone"); // (from before drafts were a tab's own)
    forget(KEY + ":drafts"); forget(KEY + ":gone");
    const prefix = KEY + ":drafts:", others = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith(prefix) || k.startsWith(KEY + ":gone:") || k.startsWith(KEY + ":moved:"))) others.push(k.slice(k.lastIndexOf(":") + 1)); } } catch { /* (not allowed) */ }
    for (const other of new Set(others)) {
      if (other === TAB) continue;
      const take = () => { adopt(`${KEY}:drafts:${other}`, `${KEY}:gone:${other}`, `${KEY}:blobs:${other}`, `${KEY}:moved:${other}`); for (const what of ["drafts", "gone", "blobs", "moved"]) forget(`${KEY}:${what}:${other}`); };
      // (its lock is free: the tab is gone. Taken over while the lock is held, so that two tabs opened at once do not both take it)
      if (locks) await locks.request(name(other), { ifAvailable: true }, (lock) => { if (lock) take(); }).catch(() => {});
      else take();
    }
    keepDrafts();
  }
  const has = (r) => drafts.has(r) || blobs.has(r) || links.has(r) || queued.has(r) || (files.has(r) && !gone.has(r) && !away.has(r));
  const every = () => [...new Set([...files.keys(), ...drafts.keys(), ...blobs.keys(), ...links.keys(), ...queued.keys()])].filter((r) => (!gone.has(r) && !away.has(r)) || drafts.has(r) || blobs.has(r) || links.has(r) || queued.has(r)); // the files as they are here
  const blobOf = (r) => links.get(r) || (!gone.has(r) && !away.has(r) && files.get(r)) || null; // the blob a file is, as far as the repository has it: { sha, size }
  const unsaved = () => drafts.size + gone.size + links.size + away.size + blobs.size > 0; // something here is no commit yet
  let tip = { device: "", time: 0 }; // who made the commit the branch stands at
  /* When a file was last changed. Git keeps no date for a file: it is the time of the last commit
   * that changed it, asked for only where the sidebar is ordered by it, and kept by the blob's id
   * (a file is another blob once it is changed). A draft is as old as it was written. */
  const dates = load(KEY + ":dates", {}); // a blob's id → seconds (0: asked, and no commit knows it)
  let dating = false;
  const byDate = () => prefs.sidebarSort === "modified";
  const changedAt = (r) => (drafts.has(r) ? Math.floor((drafts.get(r).at || 0) / 1000) : dates[(files.get(r) || {}).sha] || 0);
  async function askDates() {
    if (dating || !head) return;
    const need = every().filter((r) => C.shown(r) && !drafts.has(r) && files.has(r) && !(files.get(r).sha in dates));
    if (!need.length) return;
    dating = true;
    try {
      const at = head, shaOf = new Map(need.map((r) => [r, files.get(r).sha]));
      for (let i = 0; i < need.length; i += 200) {
        const some = need.slice(i, i + 200);
        const res = await ask(API + "/dates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ head: at, paths: some }) });
        if (!res.ok) return;
        const got = (await res.json()).dates || {};
        for (const r of some) dates[shaOf.get(r)] = got[r] || 0;
        const live = new Set([...files.values()].map((f) => f.sha));
        for (const sha of Object.keys(dates)) if (!live.has(sha)) delete dates[sha]; // (what no file is any more)
        keep(KEY + ":dates", dates);
        sendFolder(); // (told as far as it is known)
      }
    } catch { /* (not reached: ordered by name until it is) */ } finally { dating = false; }
  }
  const exists = (path) => path.startsWith(BASE + "/") && has(rel(path));
  // (a file a note names: where the link says, else in the repository's assets — core.js, foundIn)
  const where = (path) => (typeof path !== "string" || !path.startsWith(BASE + "/") || exists(path) ? path : BASE + "/" + C.foundIn(rel(path), every()));
  const paths = () => every().map((f) => BASE + "/" + f);
  // where what was drawn on a PDF is kept: by the blob the PDF is (one not in a commit yet has none)
  const inkOf = (path) => {
    path = where(path);
    const f = typeof path === "string" && exists(path) && C.kindOf(path) === "pdf" ? blobOf(rel(path)) : null;
    if (!f || !f.sha) throw new Error("not a PDF of the repository yet");
    return `.mdview/pdf/${f.sha}.board.svg`;
  };
  // the guide: no file of the repository — the app's own, shown as a note that cannot be written
  const GUIDE = "/~guide/FEATURES.md", known = (path) => path === GUIDE || exists(path);
  let guide = null;
  const MARKER = ".mdview/project.json";
  const project = () => has(MARKER); // (as on the desktop: only a repository with the marker is written to)
  const NOT_YET = "turn the history on first: the clock in the sidebar";

  async function ask(url, init) {
    const res = await fetch(url, init);
    if (res.status === 401) { location.href = "/signin?next=" + encodeURIComponent(location.pathname + location.search); throw new Error("signed out"); }
    return res;
  }
  /* The texts of blobs, those not had yet asked for in one go. */
  async function fetchTexts(shas) {
    const need = [...new Set(shas)].filter((s) => !texts.has(s));
    for (let i = 0; i < need.length; i += 200) {
      const res = await ask(API + "/texts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shas: need.slice(i, i + 200) }) });
      if (!res.ok) throw new Error("the notes could not be read");
      for (const [sha, text] of Object.entries((await res.json()).texts || {})) texts.set(sha, text);
    }
  }
  /* A note's text. (One too large to come with the others is fetched as the file it is.) */
  async function textOf(path) {
    if (path === GUIDE) {
      if (guide == null) { const res = await fetch("/app/docs/FEATURES.md"); if (!res.ok) throw new Error("The guide could not be read"); guide = await res.text(); }
      return guide;
    }
    const draft = drafts.get(rel(path));
    if (draft) return draft.text;
    const f = blobOf(rel(path));
    if (!f) throw new Error(`File not found: ${C.nameOf(path)}`);
    await fetchTexts([f.sha]);
    let text = texts.get(f.sha);
    if (text == null) {
      const res = await ask(fileUrl(path));
      if (!res.ok) throw new Error("Can't read file");
      text = await res.text();
      texts.set(f.sha, text);
    }
    return text;
  }
  /* Every note's text, fetched once in the background: for titles. */
  let everything = null;
  const loadAll = () => (everything = everything || fetchTexts([...files].filter(([p]) => C.isMd(p) && C.shown(p)).map(([, f]) => f.sha)).catch(() => { everything = null; }));

  // ------------------------------------------------------------ the sidebar and the tabs
  let tabs = null, onScreen = null, toldFolder = "", toldTabs = "", modeGiven = false;
  /* The notes shared under a link, as far as the list of them is read (it is, with the repository). */
  function sharedNow() {
    const text = drafts.has(C.SHARES) ? drafts.get(C.SHARES).text : texts.get((files.get(C.SHARES) || {}).sha);
    return gone.has(C.SHARES) || text == null ? [] : Object.values(C.sharesOf(text).shares).map((e) => BASE + "/" + e.path).filter(exists).sort();
  }
  /* How the repository's folders look — a colour, a sign — as it says itself (.mdview/folders.json). */
  function looksNow() {
    const text = drafts.has(C.FOLDERS) ? drafts.get(C.FOLDERS).text : texts.get((files.get(C.FOLDERS) || {}).sha);
    return gone.has(C.FOLDERS) || text == null ? {} : C.looksOf(text);
  }
  // one of the files the app keeps in the repository about it (.mdview/…), as far as it is read: its text, or null
  const textNow = (r) => (gone.has(r) ? null : drafts.has(r) ? drafts.get(r).text : texts.get((files.get(r) || {}).sha) ?? null);
  /* What was put out of sight by hand, as the repository says itself (.mdview/hidden.json) … */
  const hiddenNow = () => C.hiddenOf(textNow(C.HIDDEN) ?? "");
  /* … and what the list leaves out beside the names with a dot: that, and what the app keeps for a
   * note — a picture pasted, a whiteboard made in it — as the desktop app's list does (folder.rs: rescan). */
  const putAway = () => new Set([...hiddenNow(), ...Object.keys(C.attachOf(textNow(C.ATTACH) ?? ""))]);
  const treeNow = (more) => C.buildTree(BASE, every(), { away: putAway(), ...more });
  // a folder under another path keeps its look
  function looksFollow(was, to) {
    const looks = looksNow(), a = rel(was);
    if (Object.keys(looks).some((k) => k === a || k.startsWith(a + "/"))) write(C.FOLDERS, C.looksText(C.looksMoved(looks, a, rel(to))));
  }
  function sendFolder() {
    // (what the sidebar lists or All Notes does: the page shows each its own part — viewer/sidebar.js, listed)
    const show = ["pdf", "image", "media", "other"]; // (everything that lies there: each takes out the kinds it is set not to list)
    let titles = null;
    if (here.sidebar.titles) {
      titles = new Map();
      for (const p of every()) { const t = drafts.has(p) ? drafts.get(p).text : texts.get((blobOf(p) || {}).sha); if (t != null && C.isMd(p)) titles.set(BASE + "/" + p, C.noteTitle(t)); }
    }
    const changed = byDate() ? new Map(every().map((r) => [BASE + "/" + r, changedAt(r)])) : null;
    if (changed) askDates();
    const payload = {
      root: BASE, name: W.repo, tree: treeNow({ show, titles, changed, opened: here.opened, keep: [...keptDirs], all: !!prefs.showHidden, coming: new Set([...uploads, ...queued.keys()]) }), // (all: what is put away too, dimmed — where the settings ask for it)
      titles: !!here.sidebar.titles, visible: here.sidebar.visible !== false, width: here.sidebar.width || 0, history: standing(), shared: sharedNow(), looks: looksNow(),
    };
    const blob = JSON.stringify(payload);
    if (blob !== toldFolder) { toldFolder = blob; tell("setFolder", payload); }
  }
  function sendTabs() {
    here.tabs = tabs.kept();
    save();
    const payload = tabs.told(), blob = JSON.stringify(payload);
    if (blob !== toldTabs) { toldTabs = blob; tell("setTabs", payload); }
  }
  function address(path) { // (the address names the note, so that it can be kept and sent)
    const u = new URL(location.href);
    if (path && path !== GUIDE) u.searchParams.set("n", rel(path)); else u.searchParams.delete("n");
    history.replaceState(null, "", u);
    if (!path) document.title = W.repo; // (a note's name is the page's own to set)
  }

  // ------------------------------------------------------------ showing a note
  /* What a note's [[wikilinks]] lead to, as the page wants it told; a note embedded with ![[…]]
   * comes with its text, and its own links are looked up too. */
  /* The text of a file that is one — source code, a list, a log; not too large, nothing in it that
   * is no text — or null. (shell.rs: embedded_text) */
  async function fileText(path) {
    const f = files.get(rel(path));
    if (!f || f.size > EMBED_LIMIT) return null;
    try { const text = await textOf(path); return text.length > EMBED_LIMIT || /[\0\uFFFD]/.test(text) ? null : text; } catch { return null; }
  }
  async function buildLinks(text, noteDir) {
    const links = {}, r = C.resolver(BASE, paths(), noteDir), queue = [text];
    while (queue.length) {
      for (const { target, embed } of C.wikiTargets(queue.pop())) {
        if (target in links || target.startsWith("#")) continue;
        const p = r.resolve(target);
        if (!p) { links[target] = null; continue; }
        const info = { path: p, url: fileUrl(p), kind: C.kindOf(p) };
        if (info.kind === "md" && embed && Object.keys(links).length < 400) {
          try { info.text = (await textOf(p)).slice(0, EMBED_LIMIT); queue.push(info.text); } catch { /* (shown as a link then) */ }
        } else if (info.kind === "file" && embed) { // (a file of text, shown in the note as the code it is)
          const text = await fileText(p);
          if (text != null) Object.assign(info, { kind: "text", text });
        }
        links[target] = info;
      }
    }
    return { links, vault: !!r.vault };
  }
  /* Waiting shown (lib/page.ts): the window's ring until the first thing is there, and afterwards a
   * small ring over the page while a note's text is fetched or the app is left — each only after
   * the wait that is no wait (--loading-delay). */
  const booted = () => { if (window.MdBooted) window.MdBooted(); };
  const wait = (on) => { if (on) document.body.dataset.wait = on === "leave" ? "leave" : ""; else delete document.body.dataset.wait; }; // ("leave": the page blurs behind the ring)
  window.addEventListener("pageshow", () => wait(false)); // (come back to with the browser's Back)
  let turn = 0;
  async function render(path, { keepScroll = false, fragment = null, end = false } = {}) {
    const mine = ++turn, t = tabs.current;
    wait(true);
    const payload = { name: C.nameOf(path), path, base: fileUrl(C.dirOf(path)) + "/", fragment, canBack: t.back.length > 0, error: null, links: {}, vault: false };
    if (C.kindOf(path) === "pdf") {
      Object.assign(payload, { kind: "pdf", text: "", readonly: "a PDF", mtime: 0, backlinks: [] });
      // what the notes link to in it: its highlights (every note's text is needed; where they cannot be had, it shows without)
      await loadAll();
      if (mine !== turn) return;
      payload.backlinks = C.pdfBacklinks(path, every().filter((r) => C.isMd(r) && C.shown(r)).map((r) => [BASE + "/" + r, drafts.has(r) ? drafts.get(r).text : texts.get((files.get(r) || {}).sha)]));
    } else {
      Object.assign(payload, { text: "", readonly: path === GUIDE ? "the guide" : project() ? null : NOT_YET, keepScroll, toEnd: end, seq: lastSeq });
      try {
        payload.text = await textOf(path);
        if (path !== GUIDE && payload.text.includes("[[")) Object.assign(payload, await buildLinks(payload.text, C.dirOf(path)));
      } catch (e) { payload.error = String(e.message || e); }
      if (mine !== turn) return; // (another note was asked for meanwhile)
      if (!modeGiven) {
        const start = prefs.startMode || "last", was = load("mdview:mode", "read");
        payload.startMode = start === "last" ? was : start;
      }
    }
    modeGiven = true;
    wait(false);
    tell("render", payload);
    booted();
  }
  function openPath(path, fragment, push) {
    const same = onScreen === path;
    tabs.open(path, push);
    onScreen = path;
    if (!same) {
      if (path !== GUIDE) { here.opened[path] = Math.floor(Date.now() / 1000); here.last = path; }
      sendFolder();
    }
    sendTabs();
    address(path);
    if (same) {
      if (fragment) { if (C.kindOf(path) === "pdf") render(path, { fragment }); else tell("scrollToFragment", fragment, true); }
      return;
    }
    render(path, { fragment });
  }
  function showNothing() {
    onScreen = null;
    turn++;
    wait(false);
    tell("clear");
    booted();
    sendTabs();
    address(null);
  }
  /* What a change of the tabs asks for (core.js: tabs). */
  function apply(now) {
    if (!now) return;
    if (now.last) return leave(); // (the last tab closed, and it was empty already: back to the repositories)
    if (now.same) return sendTabs();
    if (now.show && known(now.show)) { onScreen = null; openPath(now.show, now.fragment, false); } else showNothing(); // (another tab: shown anew, also where it is the same note)
  }
  // a note or PDF a link leads to, in a tab: a new one, or (tab: "own") the one it has already
  const linkTab = (p, fragment, tab) => { const there = tab === "own" ? tabs.find(p) : -1; return there >= 0 ? { ...tabs.selectAt(there), fragment: fragment || null } : tabs.add(p, fragment); };
  /* Away from the repository, to the list of them. The page is asked first: what is typed is
   * saved, and a dialog with changes in it asks what is to become of them (closehold), as when a
   * window closes on the desktop. It says close once that is done. */
  let leaving = false;
  function leave() {
    wait("leave"); // (the repositories are asked of GitHub before the page comes: what is left blurs meanwhile)
    if (leaving || !(window.MdView && window.MdView.flush)) { location.href = "/"; return; }
    leaving = true;
    tell("flush", true);
  }
  const openFile = (path) => window.open(fileUrl(path), "_blank", "noopener"); // (a picture, a film, anything else: the browser's to show)

  // ------------------------------------------------------------ writing: drafts, and commits of them
  let lastSeq = null, timer = 0, busy = null, conflicts = []; // conflicts: what is to be said before a commit can be made (the window's files)
  const browserAs = (() => { // this browser, as a commit names it
    let d = load("mdview:device", null);
    if (!d || !d.id) {
      const ua = navigator.userAgent, browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
      const system = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
      d = { id: crypto.randomUUID(), name: browser + (system ? " on " + system : "") };
      keep("mdview:device", d);
    }
    return d;
  })();
  const device = { get id() { return browserAs.id; }, get name() { return String(prefs.deviceName || "").trim() || browserAs.name; } }; // (the name: the settings', else the browser's own)
  /* Where the project stands, for the clock and the settings (as the shell's standing). */
  function standing() {
    if (!project()) return { state: "foreign", own: true, was: false, name: W.repo, root: BASE };
    return { state: "project", fixed: true, name: W.repo, root: BASE, linked: `https://github.com/${W.owner}/${W.repo}.git`, sync: conflicts.length ? { state: "conflict", files: conflicts.map((c) => c.path) } : { state: "even" } };
  }
  const committed = (r) => { const f = files.get(r); return f ? texts.get(f.sha) : undefined; };
  /* A note's text as it is to be: a draft, kept in this browser at once; a commit follows. */
  function write(r, text) {
    const f = files.get(r);
    if (f && !gone.has(r) && committed(r) === text) drafts.delete(r); // (as the branch has it: nothing to keep)
    else drafts.set(r, { text, at: Date.now(), base: drafts.has(r) ? drafts.get(r).base : f && !gone.has(r) ? f.sha : null, sent: drafts.has(r) ? drafts.get(r).sent : undefined });
    if (drafts.has(r)) { gone.delete(r); links.delete(r); } // (written over what was only named there: the text is the file now)
    keepDrafts();
    later();
  }
  /* What is hidden, as it is to be: a draft like a note's — and with nothing hidden there is no file (hidden.rs: write). */
  function keepHidden(hidden) {
    if (hidden.size) return write(C.HIDDEN, C.hiddenText(hidden));
    drafts.delete(C.HIDDEN);
    if (files.has(C.HIDDEN)) { gone.add(C.HIDDEN); goneAt.set(C.HIDDEN, files.get(C.HIDDEN).sha); }
    keepDrafts();
    later();
  }
  // a file or a folder under another path stays hidden; one that is gone (to: null) is named no more
  function hiddenFollow(was, to) {
    const hidden = hiddenNow(), a = rel(was);
    if ([...hidden].some((k) => k === a || k.startsWith(a + "/"))) keepHidden(C.hiddenMoved(hidden, a, to == null ? null : rel(to)));
  }
  /* How many commits the branch has, for the settings: asked when they are shown, once for each
   * place the branch stands at, and told when the answer is there. */
  let counted = { head: null, n: 0 }, counting = null;
  function countVersions() {
    const at = head;
    if (counting === at) return;
    counting = at;
    ask(API + "/history").then(async (res) => {
      const n = res.ok ? (await res.json()).count : null;
      counting = null;
      if (typeof n !== "number") return;
      counted = { head: at, n };
      on["settings-info"]();
    }).catch(() => { counting = null; }); // (not told: the row stays away)
  }
  const quiet = () => Math.max(1, Number(prefs.historyQuiet) || 30) * 1000;
  function later() { clearTimeout(timer); timer = setTimeout(() => commit(), quiet()); }
  const bytesOf = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  function base64Of(bytes) {
    let bin = "";
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    return btoa(bin);
  }
  async function blobId(content) { // (Git's own id of a file with this content: a text, or bytes)
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content, headBytes = new TextEncoder().encode(`blob ${bytes.length}\0`), all = new Uint8Array(headBytes.length + bytes.length);
    all.set(headBytes); all.set(bytes, headBytes.length);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-1", all))].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  /* The drafts against the branch as it stands now: one written over a file that is another by
   * now is joined with what was written there — or is a conflict. → the conflicts found. */
  async function settle() {
    const found = [];
    for (const [r, d] of [...drafts]) {
      const now = files.get(r);
      if ((now ? now.sha : null) === d.base) continue;
      if (!now) { found.push({ path: r, kind: "file", mine: true, theirs: false }); continue; } // (deleted there, written here)
      // What is there is what this draft was sent as — a commit whose answer never came (the tab
      // closed over it, the line broke), and that was written on since. The draft goes on from it:
      // nothing to join, and above all no conflict of the note with its own earlier state.
      if ((d.sent || []).includes(now.sha)) {
        if ((await blobId(d.text)) === now.sha) drafts.delete(r); else { d.base = now.sha; d.sent = undefined; }
        continue;
      }
      await fetchTexts([now.sha, d.base].filter(Boolean));
      const theirs = texts.get(now.sha), was = d.base ? texts.get(d.base) : "";
      if (theirs === d.text) { drafts.delete(r); continue; } // (the same was written there — or this draft is a commit already, made as the tab closed)
      if (theirs == null || was == null) { found.push({ path: r, kind: "file", mine: true, theirs: true }); continue; }
      const joined = C.merge3(was, d.text, theirs);
      if (joined.parts) { found.push({ path: r, kind: "text", mine: true, theirs: true, parts: joined.parts }); continue; }
      if (joined.text === theirs) drafts.delete(r); else drafts.set(r, { text: joined.text, at: d.at, base: now.sha });
      if (onScreen === BASE + "/" + r) render(onScreen, { keepScroll: true }); // (what they wrote is in it now)
    }
    for (const r of [...gone]) {
      if (!files.has(r)) gone.delete(r); // (deleted there too)
      // (… or written on there since it was deleted here: what they wrote stays — a deletion does not win over a text nobody here has seen)
      else if (goneAt.has(r) && goneAt.get(r) !== files.get(r).sha) { gone.delete(r); goneAt.delete(r); toast(`“${r.split("/").pop()}” was changed elsewhere after it was deleted here: it stays`); }
    }
    for (const [r, sha] of [...away]) if ((files.get(r) || {}).sha !== sha) away.delete(r); // (deleted there, or another file by now: that one stays)
    for (const [r, l] of [...links]) if ((files.get(r) || {}).sha === l.sha) links.delete(r); // (there already: a commit of this move whose answer never came — the tab closed over it)
    keepDrafts();
    return found;
  }
  // what keeps the drafts from becoming a commit, said when it begins (not with every try)
  let unsentAs = "";
  function unsent(kind, text) { if (kind && kind !== unsentAs) toast(text); unsentAs = kind; }
  /* What was written becomes a commit. Where the branch moved meanwhile, it is looked at and the
   * commit tried again on what is there now. */
  function commit() {
    clearTimeout(timer);
    if (busy) return busy.then(() => commit());
    busy = (async () => {
      for (let tries = 0; tries < 4; tries++) {
        if (!project() && !drafts.has(MARKER)) return;
        conflicts = await settle();
        if (conflicts.length) { sendFolder(); toast(`${conflicts.length === 1 ? "A file was" : conflicts.length + " files were"} changed here and elsewhere. Resolve from the clock in the sidebar`); return; }
        const sent = new Map(drafts), pictures = new Map(blobs), linked = new Map(links), deleted = [...new Set([...gone, ...away.keys()])].filter((r) => files.has(r));
        const additions = [...[...sent].map(([path, d]) => ({ path, text: d.text })), ...[...pictures].map(([path, base64]) => ({ path, base64 }))];
        if (!additions.length && !deleted.length && !linked.size) { sendFolder(); return; }
        flying = new Set([...sent.keys(), ...pictures.keys(), ...linked.keys(), ...deleted]);
        // (what each draft is sent as is written down first: should the answer never come, the draft knows its own commit again)
        for (const [, d] of sent) { const sha = await blobId(d.text); if (!(d.sent || []).includes(sha)) d.sent = [...(d.sent || []).slice(-5), sha]; }
        keepDrafts();
        const body = JSON.stringify({ branch, expect: head, headline: C.subject([...sent.keys(), ...pictures.keys(), ...linked.keys(), ...deleted]), body: `Device: ${device.name} (${device.id})\nClient: web`, additions, deletions: deleted, links: [...linked].map(([path, l]) => ({ path, sha: l.sha })) });
        // (keepalive — the commit goes on while the tab closes — is for bodies a browser allows it for: 64 KiB, in bytes)
        const res = await ask(API + "/commit", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: new TextEncoder().encode(body).length < 60000, body });
        if (res.status === 409) { await look(true); continue; } // (someone wrote meanwhile)
        if (!res.ok) {
          // (what trying again cannot mend — no right to write, too large, refused: said once, and tried
          // again only when something more is written; anything else — the server, the line — after a while)
          const lasting = [400, 403, 404, 413, 422].includes(res.status);
          // (… and what was moved, copied, hidden, deleted or added here is put back then: nothing stays shown as done that is not)
          const back = lasting ? putBack() : [];
          if (back.length) { unsentAs = "refused"; toast(`GitHub did not take the change to “${C.nameOf(back[0])}”${back.length > 1 ? ` and ${back.length - 1} more` : ""}: ${back.length > 1 ? "they are" : "it is"} as the repository has ${back.length > 1 ? "them" : "it"} again`); }
          else unsent(lasting ? "refused" : "later", lasting
            ? (res.status === 413 ? "What was written is too large to be kept in one piece" : res.status === 403 || res.status === 404 ? "This repository does not let you write: what was written stays in this browser only" : "GitHub did not take what was written: it stays in this browser only")
            : "Couldn't keep what was written. It stays in this browser, and is tried again");
          if (!lasting) later();
          return;
        }
        unsent("", "");
        { const kept = await res.json(); head = kept.head; if (kept.branch) branch = kept.branch; } // (branch: told with a repository's first commit)
        tip = { device: `${device.name} (${device.id})`, time: Math.floor(Date.now() / 1000) }; // (the branch stands at a commit of this browser's)
        // (what is shared changed: the server is told, so that a link finds its repository and the overview is right)
        if (sent.has(C.SHARES)) ask(API + "/shares", { method: "POST" }).catch(() => {});
        for (const [r, d] of sent) {
          const sha = await blobId(d.text);
          files.set(r, { sha, size: d.text.length });
          texts.set(sha, d.text);
          dates[sha] = Math.floor(Date.now() / 1000); // (the commit is of now)
          if (gone.has(r)) goneAt.set(r, sha); // (deleted here while the commit was on its way: it is this text that is deleted)
          if (drafts.get(r) && drafts.get(r).text === d.text) drafts.delete(r); else if (drafts.get(r)) { drafts.get(r).base = sha; drafts.get(r).sent = undefined; } // (written on meanwhile: the next commit's)
        }
        const made = new Map();
        for (const [r, base64] of pictures) { const bytes = bytesOf(base64); made.set(r, { sha: await blobId(bytes), size: bytes.length }); }
        for (const r of deleted) { files.delete(r); gone.delete(r); goneAt.delete(r); away.delete(r); }
        for (const [r, f] of made) { files.set(r, f); blobs.delete(r); uploads.delete(r); }
        for (const [r, l] of linked) { files.set(r, { sha: l.sha, size: l.size }); if ((links.get(r) || {}).sha === l.sha) links.delete(r); }
        for (const r of sent.keys()) moves.delete(r);
        keepDrafts();
        sendFolder();
        tell("historyKept");
        if (unsaved()) later();
        return;
      }
      later();
    })().catch((e) => { console.error("mdview host: commit", e); unsent("offline", "No connection: what is written stays in this browser until there is one"); later(); }).finally(() => { busy = null; flying = new Set(); });
    return busy;
  }
  /* A commit on its way knows the files it holds as they were sent. What is done meanwhile to one of
   * them (or to a folder one of them lies in) waits for its answer — anything else is done at once. */
  let flying = new Set();
  const landed = (...some) => (busy && some.some((p) => typeof p === "string" && [...flying].some((r) => BASE + "/" + r === p || (BASE + "/" + r).startsWith(p + "/"))) ? busy : null);
  /* A commit GitHub will not take: what was moved, copied, hidden, deleted or added here, and is
   * in no commit, is put back as the repository has it — the page is told, and it is said. What
   * was typed stays, in this browser. → the files it was about */
  function putBack() {
    const names = [], renamed = [];
    for (const [n, l] of links) { names.push(n); const was = [...away].find(([, sha]) => sha === l.sha); if (was) renamed.push([n, was[0]]); }
    for (const [n, was] of moves) {
      const d = drafts.get(n);
      if (!d || !files.has(was)) continue; // (never in the repository: a draft like any other, under the name it has)
      drafts.delete(n);
      if (committed(was) !== d.text) drafts.set(was, { text: d.text, at: d.at, base: files.get(was).sha });
      names.push(n); renamed.push([n, was]);
    }
    for (const r of [...uploads, ...queued.keys()]) { blobs.delete(r); names.push(r); }
    queued.clear();
    for (const r of gone) if (files.has(r) && !renamed.some(([, was]) => was === r)) names.push(r);
    if (drafts.has(C.HIDDEN)) { drafts.delete(C.HIDDEN); names.push(C.HIDDEN); }
    links.clear(); away.clear(); moves.clear(); uploads.clear(); gone.clear(); goneAt.clear();
    keepDrafts();
    for (const [n, was] of renamed) follow(BASE + "/" + n, BASE + "/" + was);
    if (names.length) { sendFolder(); sendTabs(); if (onScreen && !known(onScreen)) showNothing(); }
    return names;
  }
  const mayWrite = () => { if (project()) return true; toast("Turn the history on first: the clock in the sidebar"); return false; };

  /* A picture put in: where the settings say (the repository's assets — one place for the notes
   * of every folder —, beside the note, or a folder under it), under a name not taken; its bytes
   * wait for the next commit. → its path */
  const PICTURE_MOST = 10 * 1024 * 1024, MOVE_MOST = 14 * 1024 * 1024; // (a commit takes 20 MB, as base64)
  function placeFor(note, stem, ext) {
    const dir = C.dirOf(note), wanted = String(prefs.images || "assets").trim().replace(/^\/+|\/+$/g, "");
    const into = !wanted || wanted === "beside" || wanted === "." || wanted.split("/").includes("..") ? dir : wanted === C.KEPT ? `${BASE}/${C.KEPT}` : `${dir}/${wanted}`;
    let target = `${into}/${stem}${ext}`;
    for (let n = 2; exists(target); n++) target = `${into}/${stem}-${n}${ext}`;
    return target;
  }
  async function putPicture(note, stem, ext, blob) {
    const target = placeFor(note, stem, ext);
    blobs.set(rel(target), base64Of(new Uint8Array(await blob.arrayBuffer())));
    keepDrafts();
    return target;
  }
  /* A whiteboard (board.js) is a picture that is text: *.board.svg, with its own data in it. */
  const BOARD_MARK = '<metadata id="mdview-board">', isBoard = (path) => /\.board\.svg$/i.test(path);
  /* What the app put beside a note goes again with what shows it (core.js, ATTACH). After a save
   * from the active mode: a file of that note which the note no longer names — nor any other
   * note — is deleted, in the next commit (its versions stay in the repository). Its bytes are
   * kept here meanwhile: named again (the removal undone, the block pasted into another note),
   * the file is put back and its picture shown again. */
  const removed = new Map(); // path → its bytes, base64
  const owned = async () => C.attachOf(has(C.ATTACH) ? await textOf(BASE + "/" + C.ATTACH) : "");
  async function namedElsewhere(name, note) {
    const notes = every().filter((r) => C.isMd(r) && r !== note);
    await fetchTexts(notes.filter((r) => !drafts.has(r) && blobOf(r)).map((r) => blobOf(r).sha)).catch(() => {});
    for (const r of notes) {
      const text = drafts.has(r) ? drafts.get(r).text : blobOf(r) ? texts.get(blobOf(r).sha) : null;
      if (text === undefined) return r; // (not known: the file stays)
      if (C.mentions(text, name)) return r;
    }
    return null;
  }
  /* How long a file stays after the note stopped naming it, before it goes (attach.rs: GRACE_SECS).
   * Within that time nothing is taken away: a picture cut and pasted again, an undo, a redo find
   * the file where it was. Since when a file is not named is kept in this browser. */
  const GRACE = Number(load("mdview:attach-grace", 3600)) * 1000;
  const unnamedKey = "mdview:unnamed:" + BASE;
  async function tidyFiles(note, text) {
    if (!has(C.ATTACH) && !removed.size) return;
    const unnamed = load(unnamedKey, {}), since = JSON.stringify(unnamed);
    const all = await owned(), back = [];
    // (what a whiteboard of the note names — the pictures put on it — the note names too: the board's own lines are read along)
    for (const r of Object.keys(all)) {
      if (all[r] !== note || !isBoard(r) || !has(r) || !C.mentions(text, C.nameOf(r))) continue;
      try { const t = await textOf(BASE + "/" + r), a = t.indexOf(BOARD_MARK), z = t.indexOf("]]>", a); if (a >= 0) text += "\n" + t.slice(a, z < 0 ? t.length : z); } catch (e) { /* (not to be read: as if it named nothing) */ }
    }
    let changed = false;
    for (const [r] of [...removed]) {
      if (!C.mentions(text, C.nameOf(r))) continue;
      if (files.has(r) && gone.has(r)) gone.delete(r); // (its deletion was no commit yet: it never went)
      else if (!has(r)) blobs.set(r, removed.get(r));
      removed.delete(r);
      all[r] = note;
      changed = true;
      back.push(C.nameOf(r));
    }
    for (const [r, of] of Object.entries(all)) {
      if (of !== note) continue;
      if (C.mentions(text, C.nameOf(r))) { delete unnamed[r]; continue; } // (named, or named again in time)
      if (!has(r)) { delete all[r]; delete unnamed[r]; changed = true; continue; } // (taken away by other means)
      if (GRACE > 0) { // no longer named: noted, and left where it is for the time of grace
        if (!unnamed[r]) { unnamed[r] = Date.now(); continue; }
        if (Date.now() - unnamed[r] < GRACE) continue;
      }
      delete unnamed[r];
      const other = await namedElsewhere(C.nameOf(r), note);
      if (other) { all[r] = other; changed = true; continue; } // (it is that note's now)
      let bytes = blobs.get(r);
      if (!bytes) { // (aside first: without its bytes the file stays)
        const res = await ask(fileUrl(BASE + "/" + r)).catch(() => null);
        if (!res || !res.ok) continue;
        bytes = base64Of(new Uint8Array(await res.arrayBuffer()));
      }
      removed.set(r, bytes);
      blobs.delete(r);
      if (files.has(r)) { gone.add(r); goneAt.set(r, files.get(r).sha); }
      delete all[r];
      changed = true;
    }
    if (JSON.stringify(unnamed) !== since) keep(unnamedKey, unnamed);
    if (!changed) return;
    write(C.ATTACH, C.attachText(all));
    sendFolder();
    if (back.length) { await commit(); tell("filesBack", back); }
  }
  let tidying = Promise.resolve();
  const tidyLater = (note, text) => { tidying = tidying.then(() => tidyFiles(note, text)).catch((e) => console.error("mdview host: attachments", e)); };
  // (how a note names a file: the way from its folder — what lies in the repository's assets is `assets/…` in a note of any folder, files.rs: way)
  const wayTo = (note, target) => (C.dirOf(target) === `${BASE}/${C.KEPT}` ? target.slice(BASE.length + 1) : target.slice(C.dirOf(note).length + 1)).split("/").map(encodeURIComponent).join("/");
  const markupOf = (note, target) => `![](${wayTo(note, target)})`;
  /* Files handed over by the page as they are (MdHost.drop): dropped on the note, or on the
   * clipboard when something was pasted — in a browser a pasted picture is in the paste event,
   * and nowhere else without asking the user for the clipboard. Each is kept where pasted
   * pictures go, under its own name (a pasted picture: under the time), in a commit at once.
   * A picture is put in as a picture, any other file as a block that names it — where they
   * were dropped or pasted; in the reading view (append) at the note's end. */
  const fileLink = (note, target) => `[${C.nameOf(target).replace(/([\\\[\]])/g, "\\$1")}](${wayTo(note, target)})`;
  const TYPE_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "image/svg+xml": ".svg", "image/bmp": ".bmp" };
  async function drop(dropped, path, { pasted = false, append = false } = {}) {
    if (!path || path !== onScreen || path === GUIDE || !mayWrite()) return;
    const all = [...dropped].filter((f) => f && typeof f.size === "number");
    if (!all.length) return;
    // (said at once, and nothing more is taken until it is over: a commit takes a moment, and what is pasted again meanwhile would be kept again)
    tell("busy", all.length === 1 ? (C.kindOf(all[0].name) === "image" || /^image\//.test(all[0].type) ? "Adding the picture…" : "Adding the file…") : `Adding ${all.length} files…`);
    try { await dropNow(all, path, pasted, append); } finally { tell("busy", null); }
  }
  async function dropNow(all, path, pasted, append) {
    const kept = [];
    let room = MOVE_MOST; // (what one commit takes)
    const d = new Date(), two = (n) => String(n).padStart(2, "0"), stamp = `pasted-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
    for (const f of all) {
      if (f.size > PICTURE_MOST) { toast(`“${f.name}” is too large to keep here (over 10 MB)`); continue; }
      if (f.size > room) { toast(`“${f.name}” is kept with the next ones: too much at once`); continue; }
      room -= f.size;
      let name = C.cleanName(f.name) || "file";
      if (pasted && TYPE_EXT[f.type]) name = stamp + TYPE_EXT[f.type]; // (a pasted picture is called "image.png" by every browser)
      const dot = name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length;
      kept.push(await putPicture(path, name.slice(0, dot), name.slice(dot), f));
    }
    if (!kept.length) return;
    const markups = () => kept.filter((t) => !blobs.has(rel(t)) || append).map((t) => (C.kindOf(t) === "image" ? markupOf(path, t) : fileLink(path, t)));
    const joined = (m) => m.join(m.every((x) => x.startsWith("!")) ? " " : "\n\n");
    if (append) { // (in the reading view: at the note's end, in the same commit)
      const old = await textOf(path), nl = old.includes("\r\n") ? "\r\n" : "\n", body = old.replace(/[\r\n]+$/, "");
      write(rel(path), (body ? body + nl + nl : "") + joined(markups()).replace(/\n/g, nl) + nl);
    }
    if (!append) { // (put in while writing: the note's own from now on)
      const all = await owned();
      for (const t of kept) all[rel(t)] = rel(path);
      write(C.ATTACH, C.attachText(all));
    }
    await commit();
    const there = kept.filter((t) => !blobs.has(rel(t)));
    if (there.length < kept.length) toast(kept.length === 1 ? "Couldn't keep the file" : "Couldn't keep the files"); // (the commit did not go: it is tried again with the next)
    if (append) return render(path, { end: true });
    if (!there.length) return;
    if (pasted) tell("insertImage", { path, markup: joined(markups()) }); // (at the caret, in the active mode and in the source alike)
    else tell("insertDropped", { path, markups: markups() });
  }

  // ------------------------------------------------------------ sharing a note
  /* What is shared stands in the repository (.mdview/shares.json, see lib/share.ts on the
   * server): a link's id, the note's path, and of a password only what it hashes to. Sharing,
   * a password set or taken away, and the end of it are commits like any other. */
  const shares = async () => C.sharesOf(has(C.SHARES) ? await textOf(BASE + "/" + C.SHARES) : "");
  const b64 = (bytes) => base64Of(new Uint8Array(bytes));
  async function hashed(password) { // (PBKDF2-SHA256: what the server works out again when the password is given)
    const salt = crypto.getRandomValues(new Uint8Array(16)), iterations = 600000;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return { salt: b64(salt), hash: b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)), iterations };
  }
  /* A link's id: the server says one that is free, as short as there is room for (a letter or
   * digit, then two: lib/share.ts, freeId). Where it cannot be asked: ten of them, at random. */
  async function newShareId() {
    try {
      const res = await fetch("/share/free"), id = res.ok ? (await res.json()).id : null;
      if (typeof id === "string" && /^[A-Za-z0-9]{1,64}$/.test(id)) return id;
    } catch { /* (not reached) */ }
    const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", out = [];
    while (out.length < 10) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 248 && out.length < 10) out.push(A[b % 62]); // (248 = 4 × 62: every letter as likely as any other)
    return out.join("");
  }
  async function tellShare(path) {
    const why = !W.sharing ? "Notes are not shared from this address yet: the server has no key for it." : !project() ? "Turn the history on first: the clock in the sidebar." : null;
    const found = why ? null : C.shareOf(await shares(), rel(path));
    tell("share", { path, can: !why, why, link: found ? `${location.origin}/${found[0]}` : null, password: !!(found && found[1].password), pending: drafts.has(C.SHARES) });
  }
  /* The list changed and kept, at once; the page is told how it stands, and again once GitHub has it. */
  async function keepShares(all, path) {
    write(C.SHARES, C.sharesText(all));
    sendFolder();
    await tellShare(path);
    await commit();
    await tellShare(path);
  }
  /* A note that has another name, or is gone (now: null): what was shared of it follows, or ends. */
  async function sharesFollow(was, now) {
    if (!has(C.SHARES)) return;
    const all = await shares(), found = C.shareOf(all, was);
    if (!found) return;
    if (now) found[1].path = now; else delete all.shares[found[0]];
    write(C.SHARES, C.sharesText(all));
  }

  let sharing = Promise.resolve();
  const sharesFollowSoon = (was, now) => { sharing = sharing.then(() => sharesFollow(was, now)).catch((e) => console.error("mdview host: shares", e)); }; // (the list may have to be read first: nothing waits for that)
  /* A file under another path. One the repository has is named there by its blob — nothing of it
   * is fetched or sent, whatever its size —; what was written here and is no commit yet goes as
   * the draft it is, a file put in here as its bytes. Tabs, what was opened when, a share's link
   * and the page follow at once; the commit is the caller's to ask for. */
  function relocate(path, now) {
    const r = rel(path), n = rel(now);
    if (drafts.has(r)) {
      const d = drafts.get(r), was = moves.get(r) || (files.has(r) ? r : null);
      drafts.delete(r); moves.delete(r);
      if (files.has(r)) { gone.add(r); goneAt.set(r, files.get(r).sha); }
      write(n, d.text);
      if (was && was !== n) moves.set(n, was);
    } else if (blobs.has(r)) { // (put in here and in no commit yet: only its name is another)
      blobs.set(n, blobs.get(r));
      blobs.delete(r);
      if (uploads.delete(r)) uploads.add(n);
    } else {
      const f = blobOf(r);
      if (links.has(r)) links.delete(r); else away.set(r, f.sha); // (moved here before, and no commit yet: it never was there)
      if (away.get(n) === f.sha) away.delete(n); else links.set(n, { sha: f.sha, size: f.size }); // (back where the repository has it: nothing to do)
      later();
    }
    keepDrafts();
    hiddenFollow(path, now); // (hidden, it stays hidden)
    follow(path, now);
  }
  // … and everything that knew it by the old path: a share's link, the tabs, what was opened when, the page
  function follow(path, now) {
    if (C.isMd(path)) sharesFollowSoon(rel(path), rel(now));
    tabs.rename(path, now);
    if (here.opened[path]) { here.opened[now] = here.opened[path]; delete here.opened[path]; }
    if (here.last === path) here.last = now;
    if (onScreen === path) { onScreen = now; address(now); }
    tell("noteRenamed", { old: path, path: now, oldReal: path, real: now, name: C.nameOf(now) });
  }
  /* A folder under another path: each file in it (inside) moved, and the folders made here that
   * are still empty with it. */
  function moveFolder(path, to, inside) {
    for (const p of inside) relocate(p, to + p.slice(path.length));
    for (const k of [...keptDirs]) if (k === path || k.startsWith(path + "/")) { keptDirs.delete(k); keptDirs.add(to + k.slice(path.length)); }
  }

  // ------------------------------------------------------------ what the page says
  const noteDir = () => (onScreen ? C.dirOf(onScreen) : BASE);
  // a folder of the repository: one with a file in it, or made here and still empty
  const isDir = (path) => typeof path === "string" && path.startsWith(BASE + "/") && !exists(path) && (keptDirs.has(path) || paths().some((p) => p.startsWith(path + "/")));
  const targetDir = (dir) => (isDir(dir) ? dir : BASE);
  /* A copy of a file, or of a folder with all that is in it, in a folder — under the first name
   * that is free there (beside: "Name copy.md" next to the thing itself). What the repository has
   * is named by its blob, as a moved file is: nothing of it is fetched or sent. → its path, or null */
  function copyTo(src, dir, beside) {
    const folder = isDir(src), name = C.freeName(C.nameOf(src), folder, beside, (n) => exists(`${dir}/${n}`) || isDir(`${dir}/${n}`));
    if (!name) { toast(`Couldn't copy “${C.nameOf(src)}”: no free name`); return null; }
    const to = `${dir}/${name}`;
    for (const p of folder ? paths().filter((p) => p.startsWith(src + "/")) : [src]) {
      const r = rel(p), n = rel(to + p.slice(src.length));
      if (drafts.has(r)) write(n, drafts.get(r).text);
      else if (blobs.has(r)) blobs.set(n, blobs.get(r));
      else { const f = blobOf(r); links.set(n, { sha: f.sha, size: f.size }); }
    }
    if (folder) for (const k of [...keptDirs, src]) if (k === src || k.startsWith(src + "/")) keptDirs.add(to + k.slice(src.length)); // (a folder is there, also where nothing is in it)
    return to;
  }
  /* Files and folders copied into a folder, under names that are free there ("Name 2.pdf"): shown
   * at once, one commit behind. how: what is said of it ("Pasted"). */
  function bringIn(from, into, how) {
    const made = [];
    for (const src of from) {
      if (isDir(src) && (into === src || into.startsWith(src + "/"))) { toast(`“${C.nameOf(src)}” can't be copied into itself`); continue; }
      const to = copyTo(src, into, false);
      if (to) made.push(to);
    }
    if (!made.length) return;
    toast(made.length === 1 ? `${how} “${C.nameOf(made[0])}”` : `${how} ${made.length} items`);
    shown(made);
  }
  // what was just made: listed, brought into sight, and a commit at once
  function shown(made) {
    keepDrafts();
    sendFolder();
    tell("revealRows", made);
    commit();
  }
  let fileClip = { paths: [], cut: false }; // what Copy or Cut took in the list, for Paste
  /* What was dropped, as files with the way to each below what was dropped (a folder comes with
   * all that is in it). A drop's entries are asked for while the drop is still being handled —
   * afterwards the browser hands out nothing —, the files themselves read later. transfer: a
   * drop's DataTransfer, or the files chosen in the browser's own window. → [{ file, way }] */
  function droppedFiles(transfer) {
    if (Array.isArray(transfer)) return Promise.resolve(transfer.map((file) => ({ file, way: file.name })));
    const items = [...(transfer.items || [])].filter((i) => i.kind === "file");
    const tops = items.map((i) => [typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null, i.getAsFile()]);
    if (!items.length) return Promise.resolve([...(transfer.files || [])].map((file) => ({ file, way: file.name })));
    const fileOf = (e) => new Promise((ok, no) => e.file(ok, no));
    const inside = (dir) => new Promise((ok) => { const reader = dir.createReader(), all = []; const more = () => reader.readEntries((some) => { if (!some.length) return ok(all); all.push(...some); more(); }, () => ok(all)); more(); });
    const walk = async (e, way, out, depth) => {
      if (out.length >= ADD_FILES + 1 || depth > 32) return;
      if (e.isDirectory) { for (const c of await inside(e)) await walk(c, way + "/" + c.name, out, depth + 1); }
      else { try { out.push({ file: await fileOf(e), way }); } catch { /* (not to be read: left out) */ } }
    };
    return (async () => {
      const out = [];
      for (const [entry, file] of tops) { if (entry && entry.isDirectory) await walk(entry, entry.name, out, 0); else if (file) out.push({ file, way: file.name }); }
      return out;
    })();
  }
  /* Files from elsewhere — dropped on the list or the tiles, or chosen with Add Files… — put into
   * a folder of the repository, under names that are free there. Their rows are there at once,
   * marked as on their way; their bytes follow in a commit — or, where they are more than a
   * commit takes, in several, one after the other. What is too large for a commit is said and
   * left out; a commit GitHub will not take takes the rows away again (putBack). */
  const ADD_MOST = MOVE_MOST, ADD_FILES = 400;
  let adding = Promise.resolve();
  async function addFiles(transfer, dir) {
    if (!mayWrite()) return;
    const into = targetDir(dir), found = await droppedFiles(transfer), tops = new Map(), list = [], large = [];
    if (found.length > ADD_FILES) return toast(`Too many files to add at once (over ${ADD_FILES})`);
    for (const { file, way } of found) {
      const parts = way.split("/").map((p) => C.cleanName(p) || "file");
      if (file.size > ADD_MOST) { large.push(parts.at(-1)); continue; }
      if (!tops.has(parts[0])) tops.set(parts[0], C.freeName(parts[0], parts.length > 1, false, (n) => exists(`${into}/${n}`) || isDir(`${into}/${n}`) || [...tops.values()].includes(n)));
      if (!tops.get(parts[0])) continue;
      const target = [into, tops.get(parts[0]), ...parts.slice(1)].join("/");
      if (queued.has(rel(target))) continue; // (two of a name in one folder that was dropped: the first)
      queued.set(rel(target), file);
      list.push(target);
    }
    if (large.length) toast(large.length === 1 ? `“${large[0]}” is too large to add here (over 14 MB)` : `${large.length} files are too large to add here (over 14 MB): ${large.slice(0, 3).join(", ")}${large.length > 3 ? ", …" : ""}`);
    if (!list.length) { if (!large.length) toast("Only files can be dropped here"); return; }
    sendFolder();
    tell("revealRows", [...new Set(list.map((t) => `${into}/${t.slice(into.length + 1).split("/")[0]}`))]);
    // (one lot after the other: a second drop waits for the first's commits)
    adding = adding.then(() => sendOff(list)).catch((e) => { console.error("mdview host: add", e); for (const t of list) queued.delete(rel(t)); sendFolder(); });
    return adding;
  }
  async function sendOff(list) {
    let room = ADD_MOST, sent = 0;
    for (const target of list) {
      const r = rel(target), file = queued.get(r);
      if (!file) continue; // (taken away meanwhile: deleted, or put back with a commit that was refused)
      if (sent && file.size > room) { // (more than a commit takes: what is read so far goes first)
        await commit();
        if (blobs.size) break; // (it did not go: no more is heaped on it)
        room = ADD_MOST; sent = 0;
      }
      const bytes = base64Of(new Uint8Array(await file.arrayBuffer()));
      if (!queued.delete(r)) continue;
      blobs.set(r, bytes); uploads.add(r);
      room -= file.size; sent++;
    }
    const left = list.filter((t) => queued.delete(rel(t)));
    if (left.length) { toast(left.length === 1 ? `“${C.nameOf(left[0])}” was not added: what is before it could not be kept yet` : `${left.length} files were not added: what is before them could not be kept yet`); sendFolder(); }
    keepDrafts();
    await commit();
  }

  /* A note, another file or a folder put into another folder (or to the top): the same file under
   * another path — for a folder each file in it. → whether it was done */
  function moveInto(path, dir) {
    if (!path || !path.startsWith(BASE + "/") || !(dir === BASE || (dir || "").startsWith(BASE + "/"))) return false;
    const name = C.nameOf(path), to = `${dir}/${name}`;
    if (C.dirOf(path) === dir || dir === path || dir.startsWith(path + "/")) return false; // (where it is already, or into itself)
    const inside = paths().filter((p) => p.startsWith(path + "/")), folder = !exists(path) && (inside.length > 0 || keptDirs.has(path));
    if (!exists(path) && !folder) return false;
    if (exists(to) || paths().some((p) => p.startsWith(to + "/")) || keptDirs.has(to)) { toast(`“${name}” already exists there`); return false; }
    if (folder) { moveFolder(path, to, inside); looksFollow(path, to); hiddenFollow(path, to); } else relocate(path, to);
    return true;
  } // where something new goes: the folder asked for, else the repository itself (folder.rs: target_dir)
  const on = {
    note({ path, tab }) {
      if (!exists(path)) return;
      if (isBoard(path)) return tell("openBoardFile", path); // (a whiteboard: over the window, as one in a note opens)
      if (!["md", "pdf"].includes(C.kindOf(path))) return openFile(path);
      const there = tabs.find(path);
      if (tab) apply(tabs.add(path)); else if (there >= 0) apply(tabs.selectAt(there)); else openPath(path, null, true);
    },
    // (tab: true — a tab of its own, always; "own" — the tab the file has already, else a new one)
    link({ href, tab }) {
      const to = C.linkPath(href, FILES);
      if (!to) { if (/^(https?:|mailto:)/i.test(href) && !href.startsWith(location.origin + "/")) window.open(href, "_blank", "noopener"); return; }
      let p = to.path;
      if (!exists(p) && !C.isMd(p) && exists(p + ".md")) p += ".md";
      p = where(p);
      if (onScreen === p && (!tab || tab === "own")) { if (to.fragment) tell("scrollToFragment", to.fragment, true); return; }
      if (!exists(p)) return toast(`Not found: ${C.nameOf(p)}`);
      if (!["md", "pdf"].includes(C.kindOf(p))) return openFile(p);
      if (tab) apply(linkTab(p, to.fragment, tab)); else openPath(p, to.fragment, true);
    },
    wikilink({ target, tab }) {
      const heading = target.includes("#") ? target.slice(target.indexOf("#") + 1) : null;
      const p = C.resolver(BASE, paths(), noteDir()).resolve(target);
      if (!p) return toast(`Note “${target.split("#")[0]}” doesn't exist`);
      if (!["md", "pdf"].includes(C.kindOf(p))) return openFile(p);
      if (tab && !(tab === "own" && onScreen === p)) apply(linkTab(p, heading, tab)); else openPath(p, heading, true);
    },
    tab({ op, id, to }) {
      const which = id != null && id !== "" ? Number(id) : tabs.current.id;
      if (op === "select") apply(tabs.select(which));
      else if (op === "new") apply(tabs.add(null));
      else if (op === "close") apply(tabs.close(which));
      else if (op === "others") apply(tabs.others(which));
      else if (op === "reopen") apply(tabs.reopen(known));
      else if (op === "move" && to != null && !Number.isNaN(Number(to))) apply(tabs.move(which, Math.trunc(Number(to))));
    },
    back() { const now = tabs.go(true); if (now) { onScreen = null; openPath(now.show, null, false); } },
    forward() { const now = tabs.go(false); if (now) { onScreen = null; openPath(now.show, null, false); } },
    async resolve({ target }) {
      const p = target ? C.resolver(BASE, paths(), noteDir()).resolve(target) : null, text = p && C.kindOf(p) === "file" ? await fileText(p) : null;
      tell("linkResolved", target, p ? (text != null ? { path: p, url: fileUrl(p), kind: "text", text } : { path: p, url: fileUrl(p), kind: C.kindOf(p) }) : null);
    },
    reload() { if (onScreen) render(onScreen, { keepScroll: true }); },
    async previews({ paths: wanted }) {
      const some = (wanted || []).filter((p) => exists(p) && C.isMd(p)).slice(0, PREVIEW_BATCH), out = {};
      const sha = (p) => (blobOf(rel(p)) || {}).sha;
      try { await fetchTexts(some.map(sha).filter(Boolean)); } catch { /* (shown empty) */ }
      // (mtime: what tells the page a tile is another by now — a draft's time, else a number of the blob's id)
      for (const p of some) out[p] = { text: ((drafts.get(rel(p)) || {}).text ?? texts.get(sha(p)) ?? "").slice(0, PREVIEW_BYTES), mtime: drafts.has(rel(p)) ? drafts.get(rel(p)).at || 1 : parseInt((sha(p) || "0").slice(0, 12), 16) };
      tell("setPreviews", out);
    },
    pdfnote({ path, line }) { if (exists(path) && C.isMd(path)) openPath(path, `^line=${Math.trunc(Number(line) || 0)}`, true); },
    async pdfdata({ path, id }) {
      try {
        path = where(path);
        if (!exists(path) || C.kindOf(path) !== "pdf") throw new Error("not a PDF file");
        const res = await ask(fileUrl(path));
        if (!res.ok) throw new Error("Can't read file");
        const bytes = new Uint8Array(await res.arrayBuffer()), SIZE = 3000000, n = Math.max(1, Math.ceil(bytes.length / SIZE));
        for (let i = 0; i < n; i++) {
          let bin = "";
          const part = bytes.subarray(i * SIZE, (i + 1) * SIZE);
          for (let k = 0; k < part.length; k += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(k, k + 0x8000));
          tell("pdfChunk", id, i, n, btoa(bin), null);
        }
      } catch (e) { tell("pdfChunk", id, 0, 1, "", String(e.message || e)); }
    },
    // what the user set: kept in this browser
    mode({ name }) { if (["read", "edit", "active"].includes(name)) keep("mdview:mode", name); },
    prefs({ prefs: changed }) {
      prefs = { ...prefs, ...(changed || {}) };
      keep("mdview:set", { ...load("mdview:set", {}), ...(changed || {}) }); // (what was chosen, not the defaults beside it: lib/page.ts)
      tell("setPrefs", prefs);
      if (Object.keys(changed || {}).some((k) => k.startsWith("sidebar") || ["ovPdf", "ovImages", "ovMedia", "ovOther", "showHidden"].includes(k))) sendFolder();
    },
    sidebar({ width, visible, titles }) {
      const n = Number(width);
      if (width != null && !Number.isNaN(n)) here.sidebar.width = Math.max(180, Math.min(640, Math.trunc(n)));
      if (visible != null) here.sidebar.visible = !!visible;
      if (titles != null) here.sidebar.titles = !!titles;
      save();
      if (width != null) return;
      if (here.sidebar.titles) loadAll().then(sendFolder);
      sendFolder();
    },
    "settings-info"() {
      const st = standing(), versions = !head ? 0 : counted.head === head ? counted.n : null;
      // (hide: what the settings have for the desktop alone — the model, signing in, linking, the quick notes
      // and their folder on a disk, where the folder lies: what cannot be here)
      tell("settingsInfo", { version: "web", configDir: "", aiKey: { set: false, tail: "", env: false }, aiModel: "", deviceName: browserAs.name, deviceId: device.id, home: "",
        hide: ["page:ai", "githubAccount", "githubGet", "hinting", "configDir", "quickNew", "quickDir", "historyRoot"],
        // (how many versions: told once GitHub has said it — until then the row is not there; the last one: the commit the branch stands at)
        history: { ...st, branch, ...(versions == null ? {} : { versions }), ...(head && tip.time ? { last: { time: tip.time, device: tip.device } } : {}), changed: new Set([...drafts.keys(), ...gone, ...links.keys(), ...away.keys(), ...blobs.keys()]).size, waiting: unsaved() }, github: { user: W.user, repos: [] } });
      if (versions == null) countVersions();
    },
    help() { if (onScreen === GUIDE) return; const there = tabs.find(GUIDE); apply(there >= 0 ? tabs.selectAt(there) : tabs.add(GUIDE)); }, // (the guide, in a tab of its own)
    external() {
      if (onScreen === GUIDE) return void window.open("https://github.com/henriSchulz/mdview/blob/main/docs/FEATURES.md", "_blank", "noopener");
      if (onScreen) window.open(`https://github.com/${W.owner}/${W.repo}/blob/HEAD/${rel(onScreen).split("/").map(encodeURIComponent).join("/")}`, "_blank", "noopener");
    },
    open() { leave(); },
    folder() { leave(); },
    close() { leave(); },
    closehold() { leaving = false; wait(false); }, // (the page has a question to ask first; it says close again once that is answered)
    // the browser's own
    copy({ text }) { navigator.clipboard?.writeText(text || "").catch(() => {}); },
    /* The page cannot read the clipboard while a menu or a key of its own is the cause: the host
     * does, and hands over what is there (the browser may ask the user first). */
    async pastetext() {
      try { tell("pasteText", { text: await navigator.clipboard.readText() }); } catch { toast("The browser did not hand out the clipboard"); }
    },
    async pasteclip() {
      try {
        const got = { text: "", html: null };
        for (const item of await navigator.clipboard.read()) {
          if (!got.text && item.types.includes("text/plain")) got.text = await (await item.getType("text/plain")).text();
          if (got.html == null && item.types.includes("text/html")) got.html = await (await item.getType("text/html")).text();
        }
        tell("pasteClip", got);
      } catch { toast("The browser did not hand out the clipboard"); }
    },
    async copyimage({ src }) { // (a clipboard takes a picture as PNG: it is drawn once and put there as that)
      try {
        if (!String(src || "").startsWith(FILES + "/")) return toast("Only pictures in files can be copied");
        const res = await ask(src);
        if (!res.ok) throw new Error("not read");
        const bitmap = await createImageBitmap(await res.blob()), canvas = document.createElement("canvas");
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        await navigator.clipboard.write([new ClipboardItem({ "image/png": await new Promise((done) => canvas.toBlob(done, "image/png")) })]);
      } catch { toast("Couldn't copy the picture"); }
    },
    print() { window.print(); },
    editcmd({ cmd }) { try { document.execCommand(String(cmd || "").toLowerCase()); } catch { /* (not this browser's) */ } },
    // the history's window: a note's versions are the commits that changed it
    async "history-log"({ path }) {
      const p = path || onScreen;
      let versions = [];
      try { const res = await ask(`${API}/history?path=${encodeURIComponent(rel(p))}`); if (res.ok) versions = (await res.json()).versions || []; } catch { /* (shown without versions) */ }
      tell("history", { path: p, versions, state: project() ? "project" : "foreign", own: !project() });
    },
    async "history-text"({ path, id, at }) {
      let text = null;
      try { const res = await ask(`${API}/version?path=${encodeURIComponent(at || rel(path))}&id=${encodeURIComponent(id)}`); if (res.ok) text = (await res.json()).text; } catch { /* (told as not there) */ }
      tell("historyText", { path, id, text });
    },
    async "history-restore"({ path, id, at }) {
      if (!exists(path) || !C.isMd(path) || !mayWrite()) return;
      const res = await ask(`${API}/version?path=${encodeURIComponent(at || rel(path))}&id=${encodeURIComponent(id)}`), text = res.ok ? (await res.json()).text : null;
      if (typeof text !== "string") return toast("Couldn't restore this version");
      write(rel(path), text);
      tell("historyRestored", { path, id });
      if (onScreen === path) render(path, { keepScroll: true });
      commit();
    },

    // sharing (active/share.js)
    "share-info"({ path }) { if (exists(path) && C.isMd(path)) return tellShare(path); },
    async "share-set"({ path, password }) {
      if (!exists(path) || !C.isMd(path) || !W.sharing || !mayWrite()) return tellShare(path);
      const all = await shares(), found = C.shareOf(all, rel(path));
      const id = found ? found[0] : await newShareId();
      const entry = found ? found[1] : { path: rel(path), created: new Date().toISOString().replace(/\.\d+Z$/, "Z"), password: null };
      if (password !== undefined) entry.password = typeof password === "string" && password ? await hashed(password) : null;
      all.shares[id] = entry;
      await keepShares(all, path);
    },
    async "share-stop"({ path }) {
      if (!exists(path) || !mayWrite()) return tellShare(path);
      const all = await shares(), found = C.shareOf(all, rel(path));
      if (!found) return tellShare(path);
      delete all.shares[found[0]];
      await keepShares(all, path);
    },

    // whiteboards: a new one where the note's pictures go — in a commit at once, so that the note
    // can show it —, a board's text (as it was left here, else the branch's), and the board as it
    // is to be: a draft like a note's, in the next commit
    async "board-new"({ path, text, id }) {
      const failed = (error) => tell("boardMade", { id, error });
      if (!path || path !== onScreen || path === GUIDE || typeof text !== "string" || !text.includes(BOARD_MARK)) return failed("not a whiteboard");
      if (!mayWrite()) return failed(NOT_YET);
      const d = new Date(), two = (n) => String(n).padStart(2, "0");
      const target = placeFor(path, `board-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`, ".board.svg");
      write(rel(target), text);
      const all = await owned();
      all[rel(target)] = rel(path);
      write(C.ATTACH, C.attachText(all));
      tell("busy", "Adding the whiteboard…");
      try { await commit(); } finally { tell("busy", null); }
      tell("boardMade", { id, path, markup: markupOf(path, target), file: target });
    },
    async "board-read"({ path, id }) {
      try {
        path = where(path);
        if (typeof path !== "string" || !exists(path) || !isBoard(path)) throw new Error("not a whiteboard");
        tell("boardText", id, await textOf(path), null);
      } catch (e) { tell("boardText", id, null, String(e.message || e)); }
    },
    // a picture or another file for a whiteboard, handed over as it is: a file beside the board's own, in a commit at once — the note's
    // from now on where the board is a note's, a file of the repository like the board where it is one (files.rs: board_drop)
    async "board-put"({ path, name, base64, id }) {
      const failed = (error) => tell("boardPut", id, [], error);
      path = where(path);
      if (typeof path !== "string" || typeof base64 !== "string" || !exists(path) || !isBoard(path)) return failed("not a whiteboard");
      if (!mayWrite()) return failed(NOT_YET);
      if (base64.length > PICTURE_MOST * 1.37) return failed("too large to keep here (over 10 MB)");
      const clean = C.cleanName(String(name || "")) || "picture.png", dot = clean.lastIndexOf(".") > 0 ? clean.lastIndexOf(".") : clean.length, dir = C.dirOf(path);
      let target = `${dir}/${clean}`;
      for (let n = 2; exists(target); n++) target = `${dir}/${clean.slice(0, dot)}-${n}${clean.slice(dot)}`;
      if (C.isMd(target) || isBoard(target)) return failed("not a file for a whiteboard");
      blobs.set(rel(target), base64);
      const all = await owned(), note = all[rel(path)];
      if (note) { all[rel(target)] = note; write(C.ATTACH, C.attachText(all)); }
      tell("busy", "Adding the picture…");
      try { await commit(); } finally { tell("busy", null); }
      if (blobs.has(rel(target))) return failed("Couldn't keep the picture");
      tell("boardPut", id, [C.nameOf(target)], null);
    },
    /* What was drawn on a PDF (board/pdf.js): a whiteboard's file in the repository's .mdview/pdf, named by the blob the PDF is —
     * the name the desktop app works out for the same file (files.rs: ink_of), so what is drawn here is on the PDF there. The PDF
     * is not written to; where nothing is drawn (any more) there is no file. */
    /* A note beside the one in the window (viewer/split.js): its text, and what its links lead to from where it lies. */
    // … written in there (the one in the window is written in the window)
    "note-save"({ path, text, id }) {
      path = where(path);
      if (typeof path !== "string" || typeof text !== "string" || !exists(path) || !C.isMd(path) || path === onScreen) return tell("noteSaved", id, "not a note to write here");
      if (!project()) return tell("noteSaved", id, NOT_YET);
      const r = rel(path), was = drafts.has(r) ? drafts.get(r).text : committed(r);
      write(r, typeof was === "string" && was.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text);
      tell("noteSaved", id, null);
    },
    async "note-read"({ path, id }) {
      try {
        path = where(path);
        if (typeof path !== "string" || !exists(path) || !C.isMd(path)) throw new Error("not a note");
        const text = await textOf(path);
        tell("noteRead", id, { path, text, links: {}, ...(text.includes("[[") ? await buildLinks(text, C.dirOf(path)) : {}) }, null);
      } catch (e) { tell("noteRead", id, null, String(e.message || e)); }
    },
    async "pdfink-read"({ path, id }) {
      try {
        const r = inkOf(path);
        tell("boardText", id, has(r) ? await textOf(BASE + "/" + r) : null, null);
      } catch (e) { tell("boardText", id, null, String(e.message || e)); }
    },
    "pdfink-save"({ path, text, empty, id }) {
      let r;
      try { r = inkOf(path); } catch (e) { return tell("boardSaved", id, String(e.message || e)); }
      if (!project()) return tell("boardSaved", id, NOT_YET);
      if (empty) {
        drafts.delete(r);
        if (files.has(r)) { gone.add(r); goneAt.set(r, files.get(r).sha); }
        keepDrafts();
        later();
      } else if (typeof text !== "string" || !text.includes(BOARD_MARK)) return tell("boardSaved", id, "not a whiteboard");
      else write(r, text);
      tell("boardSaved", id, null);
    },
    "board-save"({ path, text, id }) {
      path = where(path);
      if (typeof path !== "string" || typeof text !== "string" || !exists(path) || !isBoard(path) || !text.includes(BOARD_MARK)) return tell("boardSaved", id, "not a whiteboard");
      if (!project()) return tell("boardSaved", id, NOT_YET);
      write(rel(path), text);
      tell("boardSaved", id, null);
    },
    /* A whiteboard as a file of the repository — its own, in no note (one can show it all the
     * same: it is linked there as a picture is). The page wrote what an empty one holds; it is a
     * commit at once, so that its picture is there for a tile and for a note. */
    newboard({ name, dir, text }) {
      if (typeof text !== "string" || !text.includes(BOARD_MARK) || !mayWrite()) return;
      let stem = C.cleanName(name);
      for (const ending of [".board.svg", ".svg", ".board"]) if (stem.toLowerCase().endsWith(ending)) stem = stem.slice(0, -ending.length).trimEnd();
      const path = `${targetDir(dir)}/${stem || "Whiteboard"}.board.svg`;
      if (exists(path)) toast(`“${C.nameOf(path)}” already exists`); else { write(rel(path), text); commit(); }
      sendFolder();
      tell("revealRows", [path]);
      tell("openBoardFile", path);
    },
    /* Every whiteboard of the repository, for All Notes: those that are files of their own and
     * those a note keeps (which the list leaves out), each with the notes that show it
     * (folder.rs: send_boards). */
    async boards() {
      if (project() && [...drafts.keys()].some(isBoard)) await commit(); // (drawn on and shut: a tile shows the repository's picture, so that is kept first)
      const boards = every().filter((r) => isBoard(r) && C.shown(r)).sort(C.naturalCmp).slice(0, 2000), notes = every().filter((r) => C.isMd(r) && C.shown(r)).slice(0, 4000);
      const all = await owned();
      // (mtime: what tells the page a picture is another by now, as a tile's — previews)
      const out = boards.map((r) => ({ path: BASE + "/" + r, name: C.nameOf(r), url: fileUrl(BASE + "/" + r), mtime: drafts.has(r) ? drafts.get(r).at || 1 : parseInt(((blobOf(r) || {}).sha || "0").slice(0, 12), 16), kept: Object.hasOwn(all, r), in: [] }));
      if (out.length) {
        await loadAll(); // (every note's text: which of them names a board)
        for (const n of notes) {
          const text = drafts.has(n) ? drafts.get(n).text : texts.get((blobOf(n) || {}).sha);
          if (typeof text === "string" && text.includes(".board.svg")) for (const b of out) if (C.mentions(text, b.name)) b.in.push(BASE + "/" + n);
        }
      }
      tell("setBoards", out);
    },
    /* A whiteboard a note keeps becomes a file of its own: listed in the repository, and no
     * longer taken away with what the note no longer shows. */
    async "board-free"({ path }) {
      if (!exists(path) || !isBoard(path) || !mayWrite()) return;
      const all = await owned();
      if (Object.hasOwn(all, rel(path))) { delete all[rel(path)]; write(C.ATTACH, C.attachText(all)); }
      sendFolder();
      return on.boards();
    },

    // writing
    save({ text, path, exact, seq }) {
      const p = path || onScreen;
      if (typeof text !== "string" || !p || !p.startsWith(BASE + "/") || C.kindOf(p) === "pdf") return;
      if (!project()) return tell("saveFailed", NOT_YET);
      if (seq) lastSeq = seq;
      const r = rel(p), was = drafts.has(r) ? drafts.get(r).text : committed(r);
      // (line ends are kept as the file has them, unless the page says the text is byte for byte)
      write(r, !exact && typeof was === "string" && was.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text);
      if (exact) tidyLater(r, text); // (the active mode: what it no longer shows goes)
    },
    "history-now"() { if (project()) commit(); },
    async toggle({ line, checked }) {
      if (!onScreen || onScreen === GUIDE || !mayWrite()) return render(onScreen, { keepScroll: true });
      const now = C.toggleTask(await textOf(onScreen), Math.trunc(Number(line)), !!checked);
      if (now != null) write(rel(onScreen), now);
      render(onScreen, { keepScroll: true });
    },
    newnote({ name, dir }) {
      if (!mayWrite()) return;
      const into = dir && (dir === BASE || dir.startsWith(BASE + "/")) ? dir : BASE;
      const typed = C.cleanName(name) || "Untitled", stem = (/\.md$/i.test(typed) ? typed.slice(0, -3).trimEnd() : typed) || "Untitled";
      const path = `${into}/${stem}.md`;
      if (exists(path)) { toast(`“${C.nameOf(path)}” already exists`); return openPath(path, null, true); }
      write(rel(path), `# ${stem}\n\n`);
      sendFolder();
      openPath(path, null, true);
      tell("setMode", "edit", "end");
    },
    newfolder({ name, dir }) {
      if (!mayWrite()) return;
      const into = dir && (dir === BASE || dir.startsWith(BASE + "/")) ? dir : BASE;
      keptDirs.add(`${into}/${C.cleanName(name) || "New Folder"}`); // (a folder is in the repository once a note is in it)
      sendFolder();
    },
    /* Files and folders put out of sight, or shown again: written into the repository
     * (.mdview/hidden.json), where the desktop app keeps it too — what is hidden here is hidden there. */
    hide({ paths: many, on: put }) {
      if (!mayWrite()) return;
      const some = (Array.isArray(many) ? many : []).filter((p) => typeof p === "string" && (exists(p) || isDir(p)));
      if (!some.length) return;
      const hidden = hiddenNow();
      for (const p of some) { if (put !== false) hidden.add(rel(p)); else hidden.delete(rel(p)); }
      keepHidden(hidden);
      if (put !== false && !prefs.showHidden) tell("toast", some.length === 1 ? `“${C.nameOf(some[0])}” is hidden` : `${some.length} items are hidden`, { label: "Undo", type: "hide", data: { paths: some, on: false } });
      sendFolder();
    },
    /* Copy or Cut in the list: remembered for Paste — in this tab: a browser hands out its
     * clipboard only when asked, so what was copied here is what is pasted — and put on the
     * clipboard as the files' paths, a line each. */
    copyfiles({ paths: many, cut }) {
      const some = (Array.isArray(many) ? many : []).filter((p) => typeof p === "string" && (exists(p) || isDir(p)));
      if (!some.length) return;
      navigator.clipboard?.writeText(some.map(rel).join("\n")).catch(() => {});
      fileClip = { paths: some, cut: !!cut && cut !== "false" };
      const name = C.nameOf(some[0]);
      toast(some.length === 1 ? (fileClip.cut ? `Cut “${name}”: Paste moves it` : `Copied “${name}”`) : fileClip.cut ? `Cut ${some.length} items: Paste moves them` : `Copied ${some.length} items`);
    },
    /* Paste into a folder: what was copied is copied there, what was cut is moved — one commit. */
    async pastefiles({ dir }) {
      await landed(...fileClip.paths);
      if (!mayWrite()) return;
      const into = targetDir(dir), from = fileClip.paths.filter((p) => exists(p) || isDir(p));
      if (!from.length) return toast("No files to paste");
      if (!fileClip.cut) return bringIn(from, into, "Pasted");
      fileClip = { paths: [], cut: false };
      if (!from.filter((p) => C.dirOf(p) !== into && moveInto(p, into)).length) return;
      sendFolder();
      sendTabs();
      commit();
    },
    // a copy beside the thing itself: "Name copy.md", "Name copy 2.md"
    duplicate({ paths: many }) {
      if (!mayWrite()) return;
      const made = (Array.isArray(many) ? many : []).filter((p) => typeof p === "string" && (exists(p) || isDir(p))).map((p) => copyTo(p, C.dirOf(p), true)).filter(Boolean);
      if (made.length) shown(made);
    },
    // a colour and a sign for a folder: written into the repository, as a note is
    folderlook({ path, color, icon }) {
      if (!mayWrite() || !path || !path.startsWith(BASE + "/") || exists(path)) return;
      write(C.FOLDERS, C.looksText(C.lookSet(looksNow(), rel(path), color, icon)));
      sendFolder();
    },
    async rename({ path, name }) {
      await landed(path); // (as trash)
      if (!mayWrite()) return;
      if (!exists(path)) { // a folder: each file in it under the new path, as when it is moved
        const inside = paths().filter((p) => p.startsWith(path + "/")), stem = C.cleanName(name), to = `${C.dirOf(path)}/${stem}`;
        if (!path.startsWith(BASE + "/") || !(inside.length || keptDirs.has(path)) || !stem || to === path) return;
        if (exists(to) || paths().some((p) => p.startsWith(to + "/")) || keptDirs.has(to)) return toast(`“${stem}” already exists`);
        moveFolder(path, to, inside);
        looksFollow(path, to);
        hiddenFollow(path, to);
        sendFolder();
        sendTabs();
        commit();
        return;
      }
      const suffix = path.slice(path.lastIndexOf("."));
      let stem = C.cleanName(name);
      if (stem.toLowerCase().endsWith(suffix.toLowerCase())) stem = stem.slice(0, -suffix.length).trimEnd();
      const now = `${C.dirOf(path)}/${stem}${suffix}`;
      if (!stem || now === path) return;
      if (exists(now)) return toast(`“${C.nameOf(now)}” already exists`);
      relocate(path, now);
      sendFolder();
      sendTabs();
      commit();
    },
    /* A note, another file or a folder dragged into another folder (or to the top): the same file
     * under another path — as a renaming is, for a folder each file in it. */
    async move({ path, dir }) {
      await landed(path);
      if (!mayWrite() || !moveInto(path, dir)) return;
      sendFolder();
      sendTabs();
      commit();
    },
    /* A note or another file, handed out: the browser saves it under its name. A note as it is
     * written here, what is typed and not committed yet with it. */
    async download({ path }) {
      if (!exists(path)) return;
      try {
        let blob;
        if (C.isMd(path)) blob = new Blob([await textOf(path)], { type: "text/markdown;charset=utf-8" });
        else { const res = await ask(fileUrl(path)); if (!res.ok) throw new Error("not read"); blob = await res.blob(); }
        const a = document.createElement("a"), url = URL.createObjectURL(blob);
        a.href = url; a.download = C.nameOf(path); a.hidden = true;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      } catch { toast(`Couldn't download “${C.nameOf(path)}”`); }
    },
    /* A note, another file or a folder deleted — or several at once (paths: what is selected in
     * All Notes). A folder is the files in it. */
    async trash({ path, paths: many }) {
      await landed(path, ...(Array.isArray(many) ? many : [])); // (a commit on its way knows the file as it was sent: what it has is known first)
      if (!mayWrite()) return;
      const all = new Set();
      let emptied = false;
      for (const p of (Array.isArray(many) && many.length ? many : [path]).filter((p) => typeof p === "string" && p.startsWith(BASE + "/"))) {
        hiddenFollow(p, null); // (what is gone is hidden no more)
        if (exists(p)) { all.add(p); continue; }
        for (const q of paths()) if (q.startsWith(p + "/")) all.add(q);
        for (const k of [...keptDirs]) if (k === p || k.startsWith(p + "/")) { keptDirs.delete(k); emptied = true; } // (a folder made here, still empty)
      }
      const list = [...all];
      if (!list.length) { if (emptied) sendFolder(); return; }
      const was = all.has(onScreen), notes = C.notesOf(treeNow({ show: [] })), i = notes.findIndex((n) => n.path === onScreen);
      const stays = (n) => !all.has(n.path);
      const next = was && i >= 0 ? (notes.slice(i + 1).find(stays) || notes.slice(0, i).reverse().find(stays) || {}).path : null;
      for (const p of list) {
        const r = rel(p);
        drafts.delete(r); blobs.delete(r); links.delete(r); moves.delete(r); uploads.delete(r); queued.delete(r);
        if (files.has(r) && !away.has(r)) { gone.add(r); goneAt.set(r, files.get(r).sha); }
        if (C.isMd(p)) sharesFollowSoon(r, null); // (a link to it shows nothing any more)
        tabs.drop(p);
      }
      keepDrafts();
      later();
      toast(list.length === 1 ? `Deleted “${C.nameOf(list[0])}”. Its versions stay in the repository` : `Deleted ${list.length} files. Their versions stay in the repository`);
      sendFolder();
      if (!was) return sendTabs();
      onScreen = null;
      if (next) openPath(next, null, false); else showNothing();
    },
    /* A picture on the clipboard: kept beside the note (or where the settings say), in a commit
     * at once — the page shows it from the repository — and its Markdown put into the note. */
    async pasteimage({ path, append }) {
      if (!path || path !== onScreen || path === GUIDE || !mayWrite()) return;
      let found = null;
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => /^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(t));
          if (type) { found = { type, blob: await item.getType(type) }; break; }
        }
      } catch { return toast("The browser did not hand out the clipboard"); }
      if (!found) return;
      return drop([new File([found.blob], "image", { type: found.type })], path, { pasted: true, append }); // (as one that came with the paste itself)
    },
    dropfiles() { toast("These files can't be read from here"); }, // (addresses of files on a disk: nothing a browser can read)

    // turning a repository into a project: the marker, as a commit (the clock's menu, when asked)
    /* A picture, or any files, chosen in the browser's own window for files (Insert › Picture, File):
     * what is chosen comes in as files dropped on the note do. */
    pickfiles({ kind, path }) {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true; input.hidden = true;
      if (kind === "image") input.accept = "image/*";
      input.addEventListener("change", () => { const files = [...input.files]; input.remove(); if (files.length) drop(files, path).catch((e) => console.error("mdview host: pick", e)); });
      input.addEventListener("cancel", () => input.remove());
      document.body.appendChild(input);
      input.click();
    },
    /* Add Files…: chosen in the browser's own window for files, then as files dropped on the list. */
    addfiles({ dir }) {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true; input.hidden = true;
      input.addEventListener("change", () => { const chosen = [...input.files]; input.remove(); if (chosen.length) addFiles(chosen, dir).catch((e) => console.error("mdview host: add", e)); });
      input.addEventListener("cancel", () => input.remove());
      document.body.appendChild(input);
      input.click();
    },
    // Sync Now: what was written here is committed, and what others wrote fetched — at once
    async "sync-now"() {
      if (busy) await busy;
      if (unsaved()) await commit();
      await refresh();
      toast(conflicts.length ? "Changed here and elsewhere: resolve from the clock in the sidebar" : "Up to date");
    },
    "history-enable"() {
      if (project()) return;
      if (!window.confirm(`“${W.repo}” will be written to from here: every change becomes a commit on the branch “${branch}”, a little while after it was made.`)) return;
      drafts.set(MARKER, { text: JSON.stringify({ id: crypto.randomUUID(), created: new Date().toISOString().replace(/\.\d+Z$/, "Z"), version: 1 }, null, 2) + "\n", base: null });
      keepDrafts();
      commit().then(() => { toldFolder = ""; sendFolder(); if (onScreen) render(onScreen, { keepScroll: true }); });
    },

    // what both changed in the same place: shown, and joined as picked
    "sync-conflicts"() {
      const now = Math.floor(Date.now() / 1000);
      tell("conflicts", { theirs: head, mine: { device: `${device.name} (${device.id})`, time: now }, their: { device: tip.device || "another device", time: tip.time || now }, files: conflicts });
    },
    "sync-resolve"({ theirs, picks }) {
      if (theirs !== head) { toast("It has changed again meanwhile: look once more"); return tell("conflictsFailed"); }
      for (const c of conflicts) {
        const pick = (picks || {})[c.path];
        if (!pick) { toast("Not everything is said"); return tell("conflictsFailed"); }
        const now = files.get(c.path);
        if (typeof pick.text === "string") drafts.set(c.path, { text: pick.text, base: now ? now.sha : null });
        else if (pick.take === "theirs") { drafts.delete(c.path); gone.delete(c.path); }
        else if (drafts.has(c.path)) drafts.get(c.path).base = now ? now.sha : null; // (mine, as a whole: written over what is there)
      }
      conflicts = [];
      keepDrafts();
      commit().then(() => { if (onScreen) render(onScreen, { keepScroll: true }); });
    },
  };

  function hear(json) {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    const f = on[m.type];
    if (f) Promise.resolve().then(() => f(m)).catch((e) => console.error("mdview host:", m.type, e));
  }

  // ------------------------------------------------------------ the repository as it is now
  async function look(force) {
    const res = await ask(API + "/state");
    if (res.status === 404) throw new Error("This repository is not there, or the app was not given it.");
    if (!res.ok) throw new Error("GitHub could not be reached.");
    const now = await res.json();
    const moved = now.empty ? head !== "" : now.head !== head;
    if (!moved && !force) return false;
    head = now.empty ? "" : now.head;
    if (now.branch) branch = now.branch;
    if (now.tip) tip = now.tip;
    files = new Map((now.tree || []).map((e) => [e.path, { sha: e.sha, size: e.size }]));
    everything = null;
    if (files.has(C.SHARES)) await fetchTexts([files.get(C.SHARES).sha]).catch(() => {}); // (what is shared: the sidebar marks it)
    if (files.has(C.FOLDERS)) await fetchTexts([files.get(C.FOLDERS).sha]).catch(() => {}); // (how the folders look: the sidebar draws them so)
    if (files.has(C.ATTACH)) await fetchTexts([files.get(C.ATTACH).sha]).catch(() => {}); // (what is kept for a note: the list leaves it out)
    if (files.has(C.HIDDEN)) await fetchTexts([files.get(C.HIDDEN).sha]).catch(() => {}); // (… and what was hidden by hand)
    return true;
  }
  /* Looked at again every minute, and when the tab is come back to: what another device sent is shown. */
  async function refresh() {
    if (document.hidden) return;
    const was = onScreen && files.get(rel(onScreen));
    let moved = false;
    try { moved = await look(); } catch { return; } // (not reached: what is shown stays)
    if (!moved) return;
    if (unsaved()) { conflicts = await settle(); later(); } // (what was written here, against what is there now)
    tabs.forget(known);
    if (here.sidebar.titles) await loadAll();
    sendFolder();
    if (onScreen && !known(onScreen)) return showNothing();
    sendTabs();
    const is = files.get(rel(onScreen || ""));
    if (onScreen && was && is && is.sha !== was.sha && !drafts.has(rel(onScreen))) render(onScreen, { keepScroll: true });
  }

  async function start() {
    await claimTab();
    // the page's messages come here from now on, those it said while this was loading first
    const waiting = window.MdHost.said || [];
    window.MdHost.post = hear;
    window.MdHost.drop = (dropped, path, how) => { drop(dropped, path, how).catch((e) => console.error("mdview host: drop", e)); };
    window.MdHost.addFiles = (transfer, dir) => { addFiles(transfer, dir).catch((e) => console.error("mdview host: add", e)); }; // (files dropped on the list or the tiles, as they are)
    try { await look(); } catch (e) {
      tell("render", { name: W.repo, path: BASE, base: fileUrl(BASE) + "/", text: "", links: {}, error: String(e.message || e), readonly: "not read", canBack: false });
      booted();
      return;
    }
    const wanted = new URLSearchParams(location.search).get("n");
    const good = (p) => p && known(p) && ["md", "pdf"].includes(C.kindOf(p));
    const kept = here.tabs && Array.isArray(here.tabs.paths) ? { paths: here.tabs.paths.filter((p, i) => good(p) || (!p && i === here.tabs.active)), active: 0 } : null;
    if (kept) kept.active = Math.max(0, kept.paths.indexOf(here.tabs.paths[here.tabs.active] || ""));
    tabs = C.tabs(kept && kept.paths.length ? kept : null);
    if (here.sidebar.titles) await loadAll();
    sendFolder();
    const first = (wanted && good(BASE + "/" + wanted) && BASE + "/" + wanted) || (good(tabs.current.path) && tabs.current.path)
      || (kept ? null : (good(here.last) && here.last) || (C.notesOf(treeNow({ show: [] }))[0] || {}).path || null);
    if (first) {
      const there = tabs.find(first);
      if (there >= 0 && tabs.current.path !== first) apply(tabs.selectAt(there)); else openPath(first, null, false);
    } else showNothing();
    for (const m of waiting) hear(m);
    if (unsaved()) later(); // (written before the tab was closed, and no commit yet)
    setInterval(refresh, LOOK_EVERY);
    // the tab left: what was written is kept now; come back to: what others wrote is looked for
    document.addEventListener("visibilitychange", () => { if (document.hidden) { if (unsaved()) commit(); } else refresh(); });
    window.addEventListener("pagehide", () => { if (unsaved()) commit(); });
  }

  // ------------------------------------------------------------ light and dark, as the system has it
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", () => tell("setTheme", W.themes[dark.matches ? "dark" : "light"], dark.matches ? "dark" : "light"));

  start();
})();
