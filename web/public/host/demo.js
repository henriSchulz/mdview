/* mdview on the web — the host of the welcome page's notes: the app's own page (viewer.js and
 * friends), with a handful of sample notes that live in this window's memory and nowhere else.
 * It stands where host.js does for a repository. Nothing is read from GitHub and nothing is
 * written anywhere: what is typed here is gone with the tab. The welcome page (welcome.js) drives
 * it from outside, through window.MdDemo: the text of a note as far as it is typed, the note on
 * screen, the share window. */
"use strict";
(() => {
  const C = window.MdWebCore, W = window.MdWeb; // { notes: { name: text }, first, link, mode, bare }
  const BASE = "/welcome/notes", FILES = location.origin + "/welcome/file";
  const tell = (name, ...args) => { const f = window.MdView && window.MdView[name]; if (f) return f(...args); };
  const toast = (text) => tell("toast", text);
  const notes = new Map(Object.entries(W.notes || {}).map(([name, text]) => [BASE + "/" + name, text]));
  const paths = () => [...notes.keys()], exists = (p) => notes.has(p);
  let prefs = { ...window.MdPrefs }, onScreen = null, shared = !!W.shared, mode = W.mode || "read";
  const tabs = C.tabs({ paths: [BASE + "/" + W.first], active: 0 });
  const sidebar = { visible: !W.bare && W.side !== false && window.innerWidth >= 720, width: 0, titles: false };

  function sendFolder() {
    tell("setFolder", { root: BASE, name: "notes", tree: C.buildTree(BASE, paths().map((p) => p.slice(BASE.length + 1)), {}), titles: sidebar.titles, visible: sidebar.visible, width: sidebar.width,
      history: { state: "none" }, shared: shared ? [BASE + "/" + W.first] : [] });
  }
  const sendTabs = () => tell("setTabs", tabs.told());
  function links(path) { // (what the note's wikilinks lead to)
    const r = C.resolver(BASE, paths(), C.dirOf(path)), out = {};
    for (const { target } of C.wikiTargets(notes.get(path) || "")) { const p = r.resolve(target.split("#")[0]); if (p) out[target] = { path: p, url: FILES + p.slice(BASE.length), kind: C.kindOf(p) }; }
    return out;
  }
  function render(path, more = {}) {
    onScreen = path;
    tell("render", { name: C.nameOf(path), path, base: FILES + "/", text: notes.get(path) || "", links: links(path), vault: null, canBack: false, error: null,
      fragment: null, startMode: mode, ...(W.bare ? { readonly: "a shared note" } : {}), ...more });
  }
  function apply(now) { // (what a change of the tabs leaves on screen)
    if (!now) return;
    sendTabs();
    if (now.same) return;
    if (now.show) render(now.show); else { onScreen = null; tell("clear"); }
  }
  function open(path) {
    if (!exists(path)) return;
    const there = tabs.find(path);
    if (there >= 0) return apply(tabs.selectAt(there));
    tabs.open(path, true);
    sendTabs();
    render(path);
  }
  const tellShare = (path) => tell("share", { path, can: true, why: null, link: shared ? W.link : null, password: false, pending: false });

  const on = {
    note({ path, tab }) { if (!exists(path)) return; if (tab) apply(tabs.add(path)); else open(path); },
    link({ href }) {
      const to = C.linkPath(href, FILES);
      if (!to) { if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer"); return; }
      const p = BASE + to.path;
      if (exists(p)) open(p); else if (exists(p + ".md")) open(p + ".md");
    },
    wikilink({ target }) {
      const p = C.resolver(BASE, paths(), onScreen ? C.dirOf(onScreen) : BASE).resolve(target.split("#")[0]);
      if (p) open(p); else toast(`Note “${target.split("#")[0]}” doesn't exist`);
    },
    tab({ op, id, to }) {
      const which = id != null && id !== "" ? Number(id) : tabs.current.id;
      if (op === "select") apply(tabs.select(which));
      else if (op === "new") apply(tabs.add(null));
      else if (op === "close") { const now = tabs.close(which); if (now && !now.last) apply(now); }
      else if (op === "others") apply(tabs.others(which));
      else if (op === "move" && to != null && !Number.isNaN(Number(to))) apply(tabs.move(which, Math.trunc(Number(to))));
    },
    resolve({ target }) {
      const p = target ? C.resolver(BASE, paths(), onScreen ? C.dirOf(onScreen) : BASE).resolve(target) : null;
      tell("linkResolved", target, p ? { path: p, url: FILES + p.slice(BASE.length), kind: C.kindOf(p) } : null);
    },
    reload() { if (onScreen) render(onScreen, { keepScroll: true }); },
    previews({ paths: wanted }) {
      const out = {};
      for (const p of (wanted || []).filter(exists)) out[p] = { text: notes.get(p).slice(0, 4000), mtime: notes.get(p).length + 1 };
      tell("setPreviews", out);
    },
    mode({ name }) { if (["read", "edit", "active"].includes(name)) mode = name; },
    prefs({ prefs: changed }) { prefs = { ...prefs, ...(changed || {}) }; tell("setPrefs", prefs); },
    sidebar({ width, visible, titles }) {
      if (width != null) sidebar.width = width;
      if (visible != null) sidebar.visible = !!visible;
      if (titles != null) { sidebar.titles = !!titles; sendFolder(); }
    },
    "settings-info"() {
      tell("settingsInfo", { version: "web", configDir: "", aiKey: { set: false, tail: "", env: false }, aiModel: "", deviceName: "", deviceId: "", home: "",
        hide: ["page:ai", "page:history", "githubAccount", "githubGet", "hinting", "configDir"], history: { state: "none" }, github: { user: null, repos: [] } });
    },
    // what would write: kept in this window, and nowhere else
    save({ text, path, seq }) { const p = path || onScreen; if (exists(p) && typeof text === "string") notes.set(p, text); void seq; },
    toggle({ line }) { if (onScreen) { notes.set(onScreen, C.toggleTask(notes.get(onScreen), line)); render(onScreen, { keepScroll: true }); } },
    "share-info"({ path }) { if (exists(path)) tellShare(path); },
    "share-set"({ path }) { shared = true; sendFolder(); tellShare(path); },
    "share-stop"({ path }) { shared = false; sendFolder(); tellShare(path); },
    copy({ text }) { navigator.clipboard?.writeText(text || "").catch(() => {}); },
    pastetext() { navigator.clipboard?.readText().then((t) => tell("pasteText", t)).catch(() => {}); },
    editcmd({ cmd }) { try { document.execCommand(String(cmd || "").toLowerCase()); } catch { /* (not this browser's) */ } },
    external({ url }) { if (/^(https?:|mailto:)/i.test(url || "")) window.open(url, "_blank", "noopener,noreferrer"); },
    print() { window.print(); },
  };
  for (const name of ["newnote", "newfolder", "rename", "move", "trash", "pasteimage", "dropfiles", "history-now", "open", "folder", "help"]) on[name] = () => toast("The sample notes stay as they are. Sign in to keep your own.");

  function hear(json) {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    const f = on[m.type];
    if (f) Promise.resolve().then(() => f(m)).catch((e) => console.error("mdview demo:", m.type, e));
  }

  /* What the welcome page asks for. */
  window.MdDemo = {
    get onScreen() { return onScreen ? onScreen.slice(BASE.length + 1) : null; },
    text: (name) => notes.get(BASE + "/" + name) ?? null,
    /* a note's text is this now; shown, if the note is on screen */
    type(name, text) {
      const p = BASE + "/" + name;
      if (notes.get(p) === text) return;
      notes.set(p, text);
      if (onScreen === p) render(p, { keepScroll: true });
    },
    open: (name) => open(BASE + "/" + name),
    mode(name) { mode = name; tell("setMode", name); },
    shared(is) { if (shared === !!is) return; shared = !!is; sendFolder(); if (onScreen) tellShare(onScreen); },
    /* the note's share window, opened as the toolbar's button opens it, or closed */
    shareWindow(open) {
      const S = window.MdActive && window.MdActive.share, is = !!(S && S.isOpen);
      if (open && !is) { const b = document.querySelector("[data-act='share']"); if (b) b.click(); }
      if (!open && is) S.close();
    },
  };

  function start() {
    const waiting = window.MdHost.said || [];
    window.MdHost.post = hear;
    tell("setPrefs", prefs);
    sendFolder();
    sendTabs();
    render(BASE + "/" + W.first);
    for (const m of waiting) hear(m);
    if (window.parent !== window) window.parent.postMessage({ mdviewDemo: "ready", id: W.id || "" }, location.origin);
  }
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", () => tell("setTheme", W.themes[dark.matches ? "dark" : "light"], dark.matches ? "dark" : "light"));
  start();
})();
