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
  const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* (no room, or not allowed: not kept) */ } };
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
  const blobs = new Map(); // pictures put in here, until they are in a commit: path → their bytes, base64
  /* The drafts are a tab's own. Two tabs on the same repository each write what was typed in
   * them; were the drafts one heap, the second tab would take the first's half-typed text for
   * its own, commit it too, and meet itself as a conflict. A tab has a name that stays with it
   * across a reload (sessionStorage) and holds a lock under it while it lives; what a tab that
   * is gone left behind — closed before its commit — is taken over by the next one opened. */
  let TAB = null;
  const mineKey = (what) => `${KEY}:${what}:${TAB}`;
  const forget = (key) => { try { localStorage.removeItem(key); } catch { /* (not allowed: stays) */ } };
  function keepDrafts() {
    if (!TAB) return;
    if (drafts.size) keep(mineKey("drafts"), Object.fromEntries(drafts)); else forget(mineKey("drafts"));
    if (gone.size) keep(mineKey("gone"), [...gone]); else forget(mineKey("gone"));
  }
  function adopt(draftsKey, goneKey) {
    for (const [r, d] of Object.entries(load(draftsKey, {}))) if (d && typeof d.text === "string" && (!drafts.has(r) || (d.at || 0) > (drafts.get(r).at || 0))) drafts.set(r, d);
    for (const r of load(goneKey, [])) gone.add(r);
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
    adopt(mineKey("drafts"), mineKey("gone"));
    adopt(KEY + ":drafts", KEY + ":gone"); // (from before drafts were a tab's own)
    forget(KEY + ":drafts"); forget(KEY + ":gone");
    const prefix = KEY + ":drafts:", others = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith(prefix) || k.startsWith(KEY + ":gone:"))) others.push(k.slice(k.lastIndexOf(":") + 1)); } } catch { /* (not allowed) */ }
    for (const other of new Set(others)) {
      if (other === TAB) continue;
      const take = () => { adopt(`${KEY}:drafts:${other}`, `${KEY}:gone:${other}`); forget(`${KEY}:drafts:${other}`); forget(`${KEY}:gone:${other}`); };
      // (its lock is free: the tab is gone. Taken over while the lock is held, so that two tabs opened at once do not both take it)
      if (locks) await locks.request(name(other), { ifAvailable: true }, (lock) => { if (lock) take(); }).catch(() => {});
      else take();
    }
    keepDrafts();
  }
  const away = new Map(); // files given another name here, until that is in a commit: the old path → the blob it was (their bytes wait in blobs, under the new)
  const has = (r) => drafts.has(r) || blobs.has(r) || (files.has(r) && !gone.has(r) && !away.has(r));
  const every = () => [...new Set([...files.keys(), ...drafts.keys(), ...blobs.keys()])].filter((r) => (!gone.has(r) && !away.has(r)) || drafts.has(r) || blobs.has(r)); // the files as they are here
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
  const paths = () => every().map((f) => BASE + "/" + f);
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
    const f = !gone.has(rel(path)) && files.get(rel(path));
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
  function sendFolder() {
    const show = [prefs.sidebarPdf !== false && "pdf", prefs.sidebarImages && "image", prefs.sidebarMedia && "media", prefs.sidebarOther && "other"].filter(Boolean);
    let titles = null;
    if (here.sidebar.titles) {
      titles = new Map();
      for (const p of every()) { const t = drafts.has(p) ? drafts.get(p).text : texts.get((files.get(p) || {}).sha); if (t != null && C.isMd(p)) titles.set(BASE + "/" + p, C.noteTitle(t)); }
    }
    const changed = byDate() ? new Map(every().map((r) => [BASE + "/" + r, changedAt(r)])) : null;
    if (changed) askDates();
    const payload = {
      root: BASE, name: W.repo, tree: C.buildTree(BASE, every(), { show, titles, changed, opened: here.opened, keep: [...keptDirs] }),
      titles: !!here.sidebar.titles, visible: here.sidebar.visible !== false, width: here.sidebar.width || 0, history: standing(), shared: sharedNow(),
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
        }
        links[target] = info;
      }
    }
    return { links, vault: !!r.vault };
  }
  let turn = 0;
  async function render(path, { keepScroll = false, fragment = null, end = false } = {}) {
    const mine = ++turn, t = tabs.current;
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
    tell("render", payload);
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
    tell("clear");
    sendTabs();
    address(null);
  }
  /* What a change of the tabs asks for (core.js: tabs). */
  function apply(now) {
    if (!now) return;
    if (now.last) return leave(); // (the last tab closed: back to the repositories)
    if (now.same) return sendTabs();
    if (now.show && known(now.show)) { onScreen = null; openPath(now.show, now.fragment, false); } else showNothing(); // (another tab: shown anew, also where it is the same note)
  }
  /* Away from the repository, to the list of them. The page is asked first: what is typed is
   * saved, and a dialog with changes in it asks what is to become of them (closehold), as when a
   * window closes on the desktop. It says close once that is done. */
  let leaving = false;
  function leave() {
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
    if (drafts.has(r)) gone.delete(r);
    keepDrafts();
    later();
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
    for (const r of [...gone]) if (!files.has(r)) gone.delete(r); // (deleted there too)
    for (const [r, sha] of [...away]) if ((files.get(r) || {}).sha !== sha) away.delete(r); // (deleted there, or another file by now: that one stays)
    keepDrafts();
    return found;
  }
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
        const sent = new Map(drafts), pictures = new Map(blobs), deleted = [...gone, ...away.keys()].filter((r) => files.has(r));
        const additions = [...[...sent].map(([path, d]) => ({ path, text: d.text })), ...[...pictures].map(([path, base64]) => ({ path, base64 }))];
        if (!additions.length && !deleted.length) { sendFolder(); return; }
        // (what each draft is sent as is written down first: should the answer never come, the draft knows its own commit again)
        for (const [, d] of sent) { const sha = await blobId(d.text); if (!(d.sent || []).includes(sha)) d.sent = [...(d.sent || []).slice(-5), sha]; }
        keepDrafts();
        const res = await ask(API + "/commit", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: additions.reduce((n, a) => n + (a.text || a.base64).length, 0) < 40000,
          body: JSON.stringify({ branch, expect: head, headline: C.subject([...sent.keys(), ...pictures.keys(), ...deleted]), body: `Device: ${device.name} (${device.id})\nClient: web`, additions, deletions: deleted }) });
        if (res.status === 409) { await look(true); continue; } // (someone wrote meanwhile)
        if (!res.ok) { toast("Couldn't keep what was written. It stays in this browser, and is tried again"); later(); return; }
        head = (await res.json()).head;
        for (const [r, d] of sent) {
          const sha = await blobId(d.text);
          files.set(r, { sha, size: d.text.length });
          texts.set(sha, d.text);
          dates[sha] = Math.floor(Date.now() / 1000); // (the commit is of now)
          if (drafts.get(r) && drafts.get(r).text === d.text) drafts.delete(r); else if (drafts.get(r)) { drafts.get(r).base = sha; drafts.get(r).sent = undefined; } // (written on meanwhile: the next commit's)
        }
        for (const [r, base64] of pictures) { const bytes = bytesOf(base64); files.set(r, { sha: await blobId(bytes), size: bytes.length }); blobs.delete(r); }
        for (const r of deleted) { files.delete(r); gone.delete(r); away.delete(r); }
        keepDrafts();
        sendFolder();
        tell("historyKept");
        if (drafts.size || gone.size) later();
        return;
      }
      later();
    })().catch((e) => { console.error("mdview host: commit", e); later(); }).finally(() => { busy = null; });
    return busy;
  }
  const mayWrite = () => { if (project()) return true; toast("Turn the history on first: the clock in the sidebar"); return false; };

  /* A picture put in: where the settings say (beside the note, else a folder under it), under a
   * name not taken; its bytes wait for the next commit. → its path */
  const PICTURE_MOST = 10 * 1024 * 1024, MOVE_MOST = 14 * 1024 * 1024; // (a commit takes 20 MB, as base64)
  async function putPicture(note, stem, ext, blob) {
    const dir = C.dirOf(note), wanted = String(prefs.images || "beside").trim().replace(/^\/+|\/+$/g, "");
    const into = !wanted || wanted === "beside" || wanted === "." || wanted.split("/").includes("..") ? dir : `${dir}/${wanted}`;
    let target = `${into}/${stem}${ext}`;
    for (let n = 2; exists(target); n++) target = `${into}/${stem}-${n}${ext}`;
    blobs.set(rel(target), base64Of(new Uint8Array(await blob.arrayBuffer())));
    return target;
  }
  const markupOf = (note, target) => `![](${target.slice(C.dirOf(note).length + 1).split("/").map(encodeURIComponent).join("/")})`;
  /* Files dropped on the note (the page hands them over as they are: MdHost.drop): the pictures
   * among them are kept as pasted ones are, under their own names, in a commit at once, and
   * their Markdown put in where they were dropped. */
  async function drop(dropped, path) {
    if (!path || path !== onScreen || !mayWrite()) return;
    const pictures = [...dropped].filter((f) => C.kindOf(f.name) === "image");
    if (!pictures.length) return toast("Only pictures can be dropped here");
    const kept = [];
    for (const f of pictures) {
      if (f.size > PICTURE_MOST) { toast(`“${f.name}” is too large to keep here (over 10 MB)`); continue; }
      const name = C.cleanName(f.name), dot = name.lastIndexOf(".");
      kept.push(await putPicture(path, name.slice(0, dot), name.slice(dot), f));
    }
    if (!kept.length) return;
    await commit();
    const there = kept.filter((t) => !blobs.has(rel(t)));
    if (there.length < kept.length) toast("Couldn't keep the picture"); // (the commit did not go: it is tried again with the next)
    if (there.length) tell("insertDropped", { path, markups: there.map((t) => markupOf(path, t)) });
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
    tell("share", { path, can: !why, why, link: found ? `${location.origin}/s/${found[0]}` : null, password: !!(found && found[1].password), pending: drafts.has(C.SHARES) });
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

  // ------------------------------------------------------------ what the page says
  const noteDir = () => (onScreen ? C.dirOf(onScreen) : BASE);
  const on = {
    note({ path, tab }) {
      if (!exists(path)) return;
      if (!["md", "pdf"].includes(C.kindOf(path))) return openFile(path);
      const there = tabs.find(path);
      if (tab) apply(tabs.add(path)); else if (there >= 0) apply(tabs.selectAt(there)); else openPath(path, null, true);
    },
    link({ href, tab }) {
      const to = C.linkPath(href, FILES);
      if (!to) { if (/^(https?:|mailto:)/i.test(href) && !href.startsWith(location.origin + "/")) window.open(href, "_blank", "noopener"); return; }
      let p = to.path;
      if (!exists(p) && !C.isMd(p) && exists(p + ".md")) p += ".md";
      if (onScreen === p && !tab) { if (to.fragment) tell("scrollToFragment", to.fragment, true); return; }
      if (!exists(p)) return toast(`Not found: ${C.nameOf(p)}`);
      if (!["md", "pdf"].includes(C.kindOf(p))) return openFile(p);
      if (tab) apply(tabs.add(p, to.fragment)); else openPath(p, to.fragment, true);
    },
    wikilink({ target, tab }) {
      const heading = target.includes("#") ? target.slice(target.indexOf("#") + 1) : null;
      const p = C.resolver(BASE, paths(), noteDir()).resolve(target);
      if (!p) return toast(`Note “${target.split("#")[0]}” doesn't exist`);
      if (!["md", "pdf"].includes(C.kindOf(p))) return openFile(p);
      if (tab) apply(tabs.add(p, heading)); else openPath(p, heading, true);
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
    resolve({ target }) {
      const p = target ? C.resolver(BASE, paths(), noteDir()).resolve(target) : null;
      tell("linkResolved", target, p ? { path: p, url: fileUrl(p), kind: C.kindOf(p) } : null);
    },
    reload() { if (onScreen) render(onScreen, { keepScroll: true }); },
    async previews({ paths: wanted }) {
      const some = (wanted || []).filter((p) => exists(p) && C.isMd(p)).slice(0, PREVIEW_BATCH), out = {};
      const sha = (p) => (files.get(rel(p)) || {}).sha;
      try { await fetchTexts(some.map(sha).filter(Boolean)); } catch { /* (shown empty) */ }
      // (mtime: what tells the page a tile is another by now — a draft's time, else a number of the blob's id)
      for (const p of some) out[p] = { text: ((drafts.get(rel(p)) || {}).text ?? texts.get(sha(p)) ?? "").slice(0, PREVIEW_BYTES), mtime: drafts.has(rel(p)) ? drafts.get(rel(p)).at || 1 : parseInt((sha(p) || "0").slice(0, 12), 16) };
      tell("setPreviews", out);
    },
    pdfnote({ path, line }) { if (exists(path) && C.isMd(path)) openPath(path, `^line=${Math.trunc(Number(line) || 0)}`, true); },
    async pdfdata({ path, id }) {
      try {
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
      keep("mdview:prefs", prefs);
      tell("setPrefs", prefs);
      if (Object.keys(changed || {}).some((k) => k.startsWith("sidebar"))) sendFolder();
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
      const st = standing();
      // (hide: what the settings have for the desktop alone — the model, signing in, linking, what cannot be here)
      tell("settingsInfo", { version: "web", configDir: "", aiKey: { set: false, tail: "", env: false }, aiModel: "", deviceName: browserAs.name, deviceId: device.id, home: "",
        hide: ["page:ai", "githubAccount", "githubGet", "hinting", "configDir"],
        history: { ...st, branch, changed: drafts.size + gone.size, waiting: drafts.size + gone.size > 0 }, github: { user: W.user, repos: [] } });
    },
    help() { if (onScreen === GUIDE) return; const there = tabs.find(GUIDE); apply(there >= 0 ? tabs.selectAt(there) : tabs.add(GUIDE)); }, // (the guide, in a tab of its own)
    external() {
      if (onScreen === GUIDE) return void window.open("https://github.com/henriSchulz/mdview/blob/main/docs/FEATURES.md", "_blank", "noopener");
      if (onScreen) window.open(`https://github.com/${W.owner}/${W.repo}/blob/HEAD/${rel(onScreen).split("/").map(encodeURIComponent).join("/")}`, "_blank", "noopener");
    },
    open() { leave(); },
    folder() { leave(); },
    close() { leave(); },
    closehold() { leaving = false; }, // (the page has a question to ask first; it says close again once that is answered)
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

    // writing
    save({ text, path, exact, seq }) {
      const p = path || onScreen;
      if (typeof text !== "string" || !p || !p.startsWith(BASE + "/") || C.kindOf(p) === "pdf") return;
      if (!project()) return tell("saveFailed", NOT_YET);
      if (seq) lastSeq = seq;
      const r = rel(p), was = drafts.has(r) ? drafts.get(r).text : committed(r);
      // (line ends are kept as the file has them, unless the page says the text is byte for byte)
      write(r, !exact && typeof was === "string" && was.includes("\r\n") ? text.replace(/\r?\n/g, "\r\n") : text);
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
    async rename({ path, name }) {
      if (busy) await busy; // (as trash)
      if (!exists(path) || !mayWrite()) return;
      const suffix = path.slice(path.lastIndexOf("."));
      let stem = C.cleanName(name);
      if (stem.toLowerCase().endsWith(suffix.toLowerCase())) stem = stem.slice(0, -suffix.length).trimEnd();
      const now = `${C.dirOf(path)}/${stem}${suffix}`;
      if (!stem || now === path) return;
      if (exists(now)) return toast(`“${C.nameOf(now)}” already exists`);
      const r = rel(path);
      if (C.isMd(path)) {
        const text = await textOf(path);
        drafts.delete(r);
        if (files.has(r)) gone.add(r);
        write(rel(now), text);
        await sharesFollow(r, rel(now)); // (its link goes on showing it)
      } else if (blobs.has(r)) { // (put in here and in no commit yet: only its name is another)
        blobs.set(rel(now), blobs.get(r));
        blobs.delete(r);
      } else {
        // anything else is its bytes under the new name and gone under the old, in a commit at once
        const f = files.get(r);
        if (f.size > MOVE_MOST) return toast(`“${C.nameOf(path)}” is too large to rename here (over 14 MB)`);
        const res = await ask(fileUrl(path));
        if (!res.ok) return toast("Couldn't rename: the file could not be read");
        blobs.set(rel(now), base64Of(new Uint8Array(await res.arrayBuffer())));
        away.set(r, f.sha);
        commit();
      }
      tabs.rename(path, now);
      if (here.opened[path]) { here.opened[now] = here.opened[path]; delete here.opened[path]; }
      if (here.last === path) here.last = now;
      if (onScreen === path) { onScreen = now; address(now); }
      tell("noteRenamed", { old: path, path: now, oldReal: path, real: now, name: C.nameOf(now) });
      sendFolder();
      sendTabs();
    },
    async trash({ path }) {
      if (busy) await busy; // (a commit on its way knows the file as it was sent: what it has is known first)
      if (!exists(path) || !mayWrite()) return;
      const was = onScreen === path, notes = C.notesOf(C.buildTree(BASE, every(), { show: [] })), i = notes.findIndex((n) => n.path === path);
      const next = was && i >= 0 ? (notes[i + 1] || notes[i - 1] || {}).path : null;
      const r = rel(path);
      drafts.delete(r);
      if (files.has(r)) gone.add(r);
      keepDrafts();
      later();
      if (C.isMd(path)) await sharesFollow(r, null); // (a link to it shows nothing any more)
      tabs.drop(path);
      toast(`Deleted “${C.nameOf(path)}”. Its versions stay in the repository`);
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
      if (found.blob.size > PICTURE_MOST) return toast("The picture is too large to keep here (over 10 MB)");
      const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "image/svg+xml": ".svg" }[found.type];
      const d = new Date(), two = (n) => String(n).padStart(2, "0");
      const stem = `pasted-${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
      const target = await putPicture(path, stem, ext, found.blob), markup = markupOf(path, target);
      if (append) { // (in the reading view: at the note's end)
        const old = await textOf(path), nl = old.includes("\r\n") ? "\r\n" : "\n", body = old.replace(/[\r\n]+$/, "");
        write(rel(path), (body ? body + nl + nl : "") + markup + nl);
      }
      await commit();
      if (blobs.has(rel(target))) return toast("Couldn't keep the picture"); // (the commit did not go: it is tried again with the next)
      if (append) render(path, { end: true }); else tell("insertImage", { path, markup });
    },
    dropfiles() { toast("Only pictures can be dropped here"); }, // (addresses of files on a disk: nothing a browser can read)

    // turning a repository into a project: the marker, as a commit (the clock's menu, when asked)
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
    return true;
  }
  /* Looked at again every minute, and when the tab is come back to: what another device sent is shown. */
  async function refresh() {
    if (document.hidden) return;
    const was = onScreen && files.get(rel(onScreen));
    let moved = false;
    try { moved = await look(); } catch { return; } // (not reached: what is shown stays)
    if (!moved) return;
    if (drafts.size || gone.size) { conflicts = await settle(); later(); } // (what was written here, against what is there now)
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
    window.MdHost.drop = (dropped, path) => { drop(dropped, path).catch((e) => console.error("mdview host: drop", e)); };
    try { await look(); } catch (e) {
      tell("render", { name: W.repo, path: BASE, base: fileUrl(BASE) + "/", text: "", links: {}, error: String(e.message || e), readonly: "not read", canBack: false });
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
      || (kept ? null : (good(here.last) && here.last) || (C.notesOf(C.buildTree(BASE, every(), { show: [] }))[0] || {}).path || null);
    if (first) {
      const there = tabs.find(first);
      if (there >= 0 && tabs.current.path !== first) apply(tabs.selectAt(there)); else openPath(first, null, false);
    } else showNothing();
    for (const m of waiting) hear(m);
    if (drafts.size || gone.size) later(); // (written before the tab was closed, and no commit yet)
    setInterval(refresh, LOOK_EVERY);
    // the tab left: what was written is kept now; come back to: what others wrote is looked for
    document.addEventListener("visibilitychange", () => { if (document.hidden) { if (drafts.size || gone.size) commit(); } else refresh(); });
    window.addEventListener("pagehide", () => { if (drafts.size || gone.size) commit(); });
  }

  // ------------------------------------------------------------ light and dark, as the system has it
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", () => tell("setTheme", W.themes[dark.matches ? "dark" : "light"], dark.matches ? "dark" : "light"));

  start();
})();
