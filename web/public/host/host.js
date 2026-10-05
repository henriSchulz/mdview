/* mdview on the web — the page's host in the browser. The page (viewer.js and friends, the
 * desktop app's own) says things with MdHost.post and is told things by MdView.…; on the desktop
 * the Rust shell is at the other end, here this is, with a repository on GitHub in the disk's
 * place. What each message means, and which are answered: host/contract.ts.
 *
 * It asks the app's own server (/api/r/<owner>/<repo>/…, /file/…), never GitHub itself: the
 * token stays on the server. For now it only reads. */
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
  let head = null, files = new Map(); // path in the repository → { sha, size }
  const texts = new Map(); // a blob's id → its text (null: not text)
  const exists = (path) => path.startsWith(BASE + "/") && files.has(rel(path));
  const paths = () => [...files.keys()].map((f) => BASE + "/" + f);

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
    const f = files.get(rel(path));
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
      for (const [p, f] of files) { const t = texts.get(f.sha); if (t != null && C.isMd(p)) titles.set(BASE + "/" + p, C.noteTitle(t)); }
    }
    const payload = {
      root: BASE, name: W.repo, tree: C.buildTree(BASE, files.keys(), { show, titles, opened: here.opened }),
      titles: !!here.sidebar.titles, visible: here.sidebar.visible !== false, width: here.sidebar.width || 0, history: { state: "none" },
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
      Object.assign(payload, { text: "", readonly: "the notes are read only here for now", keepScroll, toEnd: end, seq: null });
      try {
        payload.text = await textOf(path);
        if (payload.text.includes("[[")) Object.assign(payload, await buildLinks(payload.text, C.dirOf(path)));
      } catch (e) { payload.error = String(e.message || e); }
      if (mine !== turn) return; // (another note was asked for meanwhile)
      if (!modeGiven) {
        const start = prefs.startMode || "last", was = load("mdview:mode", "read");
        payload.startMode = start === "last" ? (was === "edit" ? "read" : was) : start === "edit" ? "read" : start; // (the source cannot be edited here yet)
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

  // ------------------------------------------------------------ what the page says
  let saidReadOnly = false;
  const readOnly = () => { if (!saidReadOnly) { saidReadOnly = true; toast("The notes are read only here for now"); } };
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
      try { await fetchTexts(some.map((p) => files.get(rel(p)).sha)); } catch { /* (shown empty) */ }
      for (const p of some) out[p] = { text: (texts.get(files.get(rel(p)).sha) || "").slice(0, PREVIEW_BYTES), mtime: 0 };
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
      tell("settingsInfo", { version: "web", configDir: "", aiKey: { set: false, tail: "", env: false }, aiModel: "", deviceName: "", deviceId: "", home: "", history: { state: "none" }, github: { user: W.user, repos: [] } });
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
    // the history comes with writing: nothing kept to show yet
    "history-log"({ path }) { tell("history", { path: path || onScreen, versions: [], state: "none" }); },
    // writing: not yet
    save() { readOnly(); tell("saveFailed", "the notes are read only here for now"); },
  };
  for (const type of ["toggle", "newnote", "newfolder", "rename", "trash", "pasteimage", "dropfiles", "history-restore", "history-now", "sync-resolve"]) on[type] = readOnly;

  function hear(json) {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    const f = on[m.type];
    if (f) Promise.resolve().then(() => f(m)).catch((e) => console.error("mdview host:", m.type, e));
  }

  // ------------------------------------------------------------ the repository as it is now
  async function look() {
    const res = await ask(API + "/state");
    if (res.status === 404) throw new Error("This repository is not there, or the app was not given it.");
    if (!res.ok) throw new Error("GitHub could not be reached.");
    const now = await res.json();
    const moved = now.empty ? head !== "" : now.head !== head;
    if (!moved) return false;
    head = now.empty ? "" : now.head;
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
    tabs.forget(exists);
    if (here.sidebar.titles) await loadAll();
    sendFolder();
    if (onScreen && !exists(onScreen)) return showNothing();
    sendTabs();
    if (onScreen && was && files.get(rel(onScreen)).sha !== was.sha) render(onScreen, { keepScroll: true });
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
      || (kept ? null : (good(here.last) && here.last) || (C.notesOf(C.buildTree(BASE, files.keys(), { show: [] }))[0] || {}).path || null);
    if (first) {
      const there = tabs.find(first);
      if (there >= 0 && tabs.current.path !== first) apply(tabs.selectAt(there)); else openPath(first, null, false);
    } else showNothing();
    for (const m of waiting) hear(m);
    setInterval(refresh, LOOK_EVERY);
    document.addEventListener("visibilitychange", refresh);
  }

  // ------------------------------------------------------------ light and dark, as the system has it
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", () => tell("setTheme", W.themes[dark.matches ? "dark" : "light"], dark.matches ? "dark" : "light"));

  start();
})();
