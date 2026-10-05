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
  const drafts = new Map(Object.entries(load(KEY + ":drafts", {}))), gone = new Set(load(KEY + ":gone", [])), keptDirs = new Set();
  const keepDrafts = () => { keep(KEY + ":drafts", Object.fromEntries(drafts)); keep(KEY + ":gone", [...gone]); };
  const has = (r) => drafts.has(r) || (files.has(r) && !gone.has(r));
  const every = () => [...new Set([...files.keys(), ...drafts.keys()])].filter((r) => !gone.has(r) || drafts.has(r)); // the files as they are here
  const exists = (path) => path.startsWith(BASE + "/") && has(rel(path));
  const paths = () => every().map((f) => BASE + "/" + f);
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
  function sendFolder() {
    const show = [prefs.sidebarPdf !== false && "pdf", prefs.sidebarImages && "image", prefs.sidebarMedia && "media", prefs.sidebarOther && "other"].filter(Boolean);
    let titles = null;
    if (here.sidebar.titles) {
      titles = new Map();
      for (const p of every()) { const t = drafts.has(p) ? drafts.get(p).text : texts.get((files.get(p) || {}).sha); if (t != null && C.isMd(p)) titles.set(BASE + "/" + p, C.noteTitle(t)); }
    }
    const payload = {
      root: BASE, name: W.repo, tree: C.buildTree(BASE, every(), { show, titles, opened: here.opened, keep: [...keptDirs] }),
      titles: !!here.sidebar.titles, visible: here.sidebar.visible !== false, width: here.sidebar.width || 0, history: standing(),
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
    if (path) u.searchParams.set("n", rel(path)); else u.searchParams.delete("n");
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
    } else {
      Object.assign(payload, { text: "", readonly: project() ? null : NOT_YET, keepScroll, toEnd: end, seq: lastSeq });
      try {
        payload.text = await textOf(path);
        if (payload.text.includes("[[")) Object.assign(payload, await buildLinks(payload.text, C.dirOf(path)));
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
      here.opened[path] = Math.floor(Date.now() / 1000);
      here.last = path;
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
    if (now.last) { location.href = "/"; return; } // (the last tab closed: back to the repositories)
    if (now.same) return sendTabs();
    if (now.show && exists(now.show)) { onScreen = null; openPath(now.show, now.fragment, false); } else showNothing(); // (another tab: shown anew, also where it is the same note)
  }
  const openFile = (path) => window.open(fileUrl(path), "_blank", "noopener"); // (a picture, a film, anything else: the browser's to show)

  // ------------------------------------------------------------ writing: drafts, and commits of them
  let lastSeq = null, timer = 0, busy = null, conflicts = []; // conflicts: what is to be said before a commit can be made (the window's files)
  const device = (() => { // this browser, as a commit names it
    let d = load("mdview:device", null);
    if (!d || !d.id) {
      const ua = navigator.userAgent, browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
      const system = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
      d = { id: crypto.randomUUID(), name: browser + (system ? " on " + system : "") };
      keep("mdview:device", d);
    }
    return d;
  })();
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
    else drafts.set(r, { text, base: drafts.has(r) ? drafts.get(r).base : f && !gone.has(r) ? f.sha : null });
    if (drafts.has(r)) gone.delete(r);
    keepDrafts();
    later();
  }
  const quiet = () => Math.max(1, Number(prefs.historyQuiet) || 30) * 1000;
  function later() { clearTimeout(timer); timer = setTimeout(() => commit(), quiet()); }
  async function blobId(text) { // (Git's own id of a file with this content)
    const bytes = new TextEncoder().encode(text), headBytes = new TextEncoder().encode(`blob ${bytes.length}\0`), all = new Uint8Array(headBytes.length + bytes.length);
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
      await fetchTexts([now.sha, d.base].filter(Boolean));
      const theirs = texts.get(now.sha), was = d.base ? texts.get(d.base) : "";
      if (theirs === d.text) { drafts.delete(r); continue; } // (the same was written there — or this draft is a commit already, made as the tab closed)
      if (theirs == null || was == null) { found.push({ path: r, kind: "file", mine: true, theirs: true }); continue; }
      const joined = C.merge3(was, d.text, theirs);
      if (joined.parts) { found.push({ path: r, kind: "text", mine: true, theirs: true, parts: joined.parts }); continue; }
      if (joined.text === theirs) drafts.delete(r); else drafts.set(r, { text: joined.text, base: now.sha });
      if (onScreen === BASE + "/" + r) render(onScreen, { keepScroll: true }); // (what they wrote is in it now)
    }
    for (const r of [...gone]) if (!files.has(r)) gone.delete(r); // (deleted there too)
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
        const sent = new Map(drafts), deleted = [...gone].filter((r) => files.has(r));
        const additions = [...sent].map(([path, d]) => ({ path, text: d.text }));
        if (!additions.length && !deleted.length) { sendFolder(); return; }
        const res = await ask(API + "/commit", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: additions.reduce((n, a) => n + a.text.length, 0) < 40000,
          body: JSON.stringify({ branch, expect: head, headline: C.subject([...sent.keys(), ...deleted]), body: `Device: ${device.name} (${device.id})\nClient: web`, additions, deletions: deleted }) });
        if (res.status === 409) { await look(true); continue; } // (someone wrote meanwhile)
        if (!res.ok) { toast("Couldn't keep what was written. It stays in this browser, and is tried again"); later(); return; }
        head = (await res.json()).head;
        for (const [r, d] of sent) {
          const sha = await blobId(d.text);
          files.set(r, { sha, size: d.text.length });
          texts.set(sha, d.text);
          if (drafts.get(r) && drafts.get(r).text === d.text) drafts.delete(r); else if (drafts.get(r)) drafts.get(r).base = sha; // (written on meanwhile: the next commit's)
        }
        for (const r of deleted) { files.delete(r); gone.delete(r); }
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
      else if (op === "reopen") apply(tabs.reopen(exists));
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
      for (const p of some) out[p] = { text: ((drafts.get(rel(p)) || {}).text ?? texts.get(sha(p)) ?? "").slice(0, PREVIEW_BYTES), mtime: 0 };
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
      tell("settingsInfo", { version: "web", configDir: "", aiKey: { set: false, tail: "", env: false }, aiModel: "", deviceName: device.name, deviceId: device.id, home: "",
        history: { ...st, branch, changed: drafts.size + gone.size, waiting: drafts.size + gone.size > 0 }, github: { user: W.user, repos: [] } });
    },
    help() { window.open("https://github.com/henriSchulz/mdview/blob/main/docs/FEATURES.md", "_blank", "noopener"); },
    external() { if (onScreen) window.open(`https://github.com/${W.owner}/${W.repo}/blob/HEAD/${rel(onScreen).split("/").map(encodeURIComponent).join("/")}`, "_blank", "noopener"); },
    open() { location.href = "/"; },
    folder() { location.href = "/"; },
    close() { location.href = "/"; },
    // the browser's own
    copy({ text }) { navigator.clipboard?.writeText(text || "").catch(() => {}); },
    print() { window.print(); },
    editcmd({ cmd }) { try { document.execCommand(String(cmd || "").toLowerCase()); } catch { /* (not this browser's) */ } },
    // the history's window comes later: nothing to show yet
    "history-log"({ path }) { tell("history", { path: path || onScreen, versions: [], state: project() ? "project" : "foreign" }); },

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
      if (!onScreen || !mayWrite()) return render(onScreen, { keepScroll: true });
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
      if (!exists(path) || !mayWrite()) return;
      if (!C.isMd(path)) return toast("Only notes can be renamed here yet");
      const suffix = path.slice(path.lastIndexOf("."));
      let stem = C.cleanName(name);
      if (stem.toLowerCase().endsWith(suffix.toLowerCase())) stem = stem.slice(0, -suffix.length).trimEnd();
      const now = `${C.dirOf(path)}/${stem}${suffix}`;
      if (!stem || now === path) return;
      if (exists(now)) return toast(`“${C.nameOf(now)}” already exists`);
      const text = await textOf(path), r = rel(path);
      drafts.delete(r);
      if (files.has(r)) gone.add(r);
      write(rel(now), text);
      tabs.rename(path, now);
      if (here.opened[path]) { here.opened[now] = here.opened[path]; delete here.opened[path]; }
      if (here.last === path) here.last = now;
      if (onScreen === path) { onScreen = now; address(now); }
      tell("noteRenamed", { old: path, path: now, oldReal: path, real: now, name: C.nameOf(now) });
      sendFolder();
      sendTabs();
    },
    trash({ path }) {
      if (!exists(path) || !mayWrite()) return;
      const was = onScreen === path, notes = C.notesOf(C.buildTree(BASE, every(), { show: [] })), i = notes.findIndex((n) => n.path === path);
      const next = was && i >= 0 ? (notes[i + 1] || notes[i - 1] || {}).path : null;
      const r = rel(path);
      drafts.delete(r);
      if (files.has(r)) gone.add(r);
      keepDrafts();
      later();
      tabs.drop(path);
      toast(`Deleted “${C.nameOf(path)}”. Its versions stay in the repository`);
      sendFolder();
      if (!was) return sendTabs();
      onScreen = null;
      if (next) openPath(next, null, false); else showNothing();
    },
    pasteimage() { toast("Pictures can't be added here yet"); },
    dropfiles() { toast("Files can't be added here yet"); },

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
      tell("conflicts", { theirs: head, mine: { device: `${device.name} (${device.id})`, time: now }, their: { device: "another device", time: now }, files: conflicts });
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
    files = new Map((now.tree || []).map((e) => [e.path, { sha: e.sha, size: e.size }]));
    everything = null;
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
    tabs.forget(exists);
    if (here.sidebar.titles) await loadAll();
    sendFolder();
    if (onScreen && !exists(onScreen)) return showNothing();
    sendTabs();
    const is = files.get(rel(onScreen || ""));
    if (onScreen && was && is && is.sha !== was.sha && !drafts.has(rel(onScreen))) render(onScreen, { keepScroll: true });
  }

  async function start() {
    // the page's messages come here from now on, those it said while this was loading first
    const waiting = window.MdHost.said || [];
    window.MdHost.post = hear;
    try { await look(); } catch (e) {
      tell("render", { name: W.repo, path: BASE, base: fileUrl(BASE) + "/", text: "", links: {}, error: String(e.message || e), readonly: "not read", canBack: false });
      return;
    }
    const wanted = new URLSearchParams(location.search).get("n");
    const good = (p) => p && exists(p) && ["md", "pdf"].includes(C.kindOf(p));
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
