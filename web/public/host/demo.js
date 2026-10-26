/* mdview on the web — the host of the welcome page's notes: the app's own page (viewer.js and
 * friends), with a handful of sample notes that live in this window's memory and nowhere else.
 * It stands where host.js does for a repository. Nothing is read from GitHub and nothing is
 * written anywhere: what is typed here is gone with the tab. The welcome page (welcome.js) drives
 * it from outside, through window.MdDemo: the text of a note as far as it is typed, the note on
 * screen, the share window. */
"use strict";
(() => {
  const C = window.MdWebCore, W = window.MdWeb; // { notes: { name: text }, first, link, mode, bare, readonly }
  /* With ?samples=1 in the address (only then — the welcome page itself stays as it is): files to try what a note can hold
   * besides text, on a tablet above all — a PDF of many pages (opened in the viewer, drawn on, embedded in a note: a page and
   * a part of one), a whiteboard with things on it, an empty one, and a note that shows them. They are files of the server
   * (public/welcome/samples); what is drawn on them is kept in this window, as the notes' text is. */
  const SAMPLES = new URLSearchParams(location.search).get("samples") === "1";
  const BASE = "/welcome/notes", FILES = location.origin + (SAMPLES ? "/welcome/samples" : "/welcome/file");
  const tell = (name, ...args) => { const f = window.MdView && window.MdView[name]; if (f) return f(...args); };
  const toast = (text) => tell("toast", text);
  const SAMPLE_NOTE = `# PDF and whiteboard

Samples to try drawing on a PDF and on whiteboards — on an iPad with the Pencil or a finger.

- The lecture as a PDF, opened in the viewer: [[Lecture.pdf]] — draw on it, leave, open it again.
- A whiteboard with things on it: [[Sketch.board.svg]]
- An empty whiteboard to draw on: [[Empty.board.svg]]

A page of the PDF in the note:

![[Lecture.pdf#page=2]]

A part of a page:

![[Lecture.pdf#page=3&rect=60,380,540,720]]

The whiteboard in the note (tap it to open it):

![](Sketch.board.svg)
`;
  const notes = new Map(Object.entries({ ...(W.notes || {}), ...(SAMPLES ? { "PDF and whiteboard.md": SAMPLE_NOTE } : {}) }).map(([name, text]) => [BASE + "/" + name, text]));
  // the samples that are no notes: a PDF (its bytes on the server), whiteboards (their text, read from the server once, then kept here)
  const others = new Set(SAMPLES ? ["Lecture.pdf", "Sketch.board.svg", "Empty.board.svg"].map((n) => BASE + "/" + n) : []);
  const boards = new Map(), inks = new Map(); // (a whiteboard's text as drawn here; what is drawn on a PDF, by the PDF's path)
  const isBoard = (p) => /\.board\.svg$/i.test(p);
  const paths = () => [...notes.keys(), ...others], exists = (p) => notes.has(p) || others.has(p);
  const fileUrl = (p) => FILES + p.slice(BASE.length).split("/").map(encodeURIComponent).join("/");
  // (a path the page names: one of the folder's, or the address of a file in it)
  const where = (p) => { if (typeof p !== "string") return p; if (p.startsWith(FILES + "/")) p = BASE + decodeURIComponent(p.slice(FILES.length).split(/[?#]/)[0]); return p; };
  async function boardText(p) {
    if (!boards.has(p)) { const res = await fetch(fileUrl(p)); if (!res.ok) throw new Error("Can't read the whiteboard"); boards.set(p, await res.text()); }
    return boards.get(p);
  }
  if (SAMPLES) W.first = "PDF and whiteboard.md";
  // a whiteboard drawn on here: the note shows it as it is now, not as the server has it (in the reading view)
  const drawn = new Map(); // path → an address of the board's text as drawn here
  function freshen() {
    for (const img of document.querySelectorAll("#content img")) {
      const p = where((img.getAttribute("src") || "").startsWith("/") ? location.origin + img.getAttribute("src") : img.src);
      if (drawn.has(p) && img.src !== drawn.get(p)) { img.dataset.board = p; img.src = drawn.get(p); }
    }
  }
  let prefs = { ...window.MdPrefs }, onScreen = null, shared = !!W.shared, mode = W.mode || "read";
  const tabs = C.tabs({ paths: [BASE + "/" + W.first], active: 0 });
  const sidebar = { visible: !W.bare && W.side !== false && window.innerWidth >= 720, width: 0, titles: false };

  let looks = {}; // (how the sample folders look: chosen here, kept for as long as the page is open)
  function sendFolder() {
    tell("setFolder", { root: BASE, name: "notes", tree: C.buildTree(BASE, paths().map((p) => p.slice(BASE.length + 1)), {}), titles: sidebar.titles, visible: sidebar.visible, width: sidebar.width,
      history: { state: "none" }, shared: shared ? [BASE + "/" + W.first] : [], looks });
  }
  const sendTabs = () => tell("setTabs", tabs.told());
  function links(path) { // (what the note's wikilinks lead to)
    const r = C.resolver(BASE, paths(), C.dirOf(path)), out = {};
    for (const { target } of C.wikiTargets(notes.get(path) || "")) { const p = r.resolve(target.split("#")[0]); if (p) out[target] = { path: p, url: fileUrl(p), kind: C.kindOf(p) }; }
    return out;
  }
  function render(path, more = {}) {
    onScreen = path;
    if (C.kindOf(path) === "pdf") return tell("render", { name: C.nameOf(path), path, base: FILES + "/", kind: "pdf", text: "", readonly: "a PDF", mtime: 0, backlinks: [], links: {}, vault: null, canBack: false, error: null, fragment: null, startMode: mode, ...more });
    tell("render", { name: C.nameOf(path), path, base: FILES + "/", text: notes.get(path) || "", links: links(path), vault: null, canBack: false, error: null,
      fragment: null, startMode: mode, ...(W.bare ? { readonly: W.readonly || "a shared note" } : {}), ...more });
    setTimeout(freshen, 0); setTimeout(freshen, 400);
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
    note({ path, tab }) { if (!exists(path)) return; if (isBoard(path)) return tell("openBoardFile", path); if (tab) apply(tabs.add(path)); else open(path); },
    link({ href }) {
      const to = C.linkPath(href, FILES);
      if (!to) { if (/^(https?:|mailto:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer"); return; }
      const p = BASE + to.path;
      if (exists(p) && isBoard(p)) tell("openBoardFile", p); else if (exists(p)) open(p); else if (exists(p + ".md")) open(p + ".md");
    },
    wikilink({ target }) {
      const p = C.resolver(BASE, paths(), onScreen ? C.dirOf(onScreen) : BASE).resolve(target.split("#")[0]);
      if (p && isBoard(p)) tell("openBoardFile", p); else if (p) open(p); else toast(`Note “${target.split("#")[0]}” doesn't exist`);
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
      tell("linkResolved", target, p ? { path: p, url: fileUrl(p), kind: C.kindOf(p) } : null);
    },
    reload() { if (onScreen) render(onScreen, { keepScroll: true }); },
    "paste-get"({ n }) { tell("pasteboard", { n, error: "signin" }); }, // (a pasteboard is a signed-in account's: the sample notes have none)
    previews({ paths: wanted }) {
      const out = {};
      for (const p of (wanted || []).filter((x) => notes.has(x))) out[p] = { text: notes.get(p).slice(0, 4000), mtime: notes.get(p).length + 1 };
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
        hide: ["page:ai", "page:history", "githubAccount", "githubGet", "hinting", "configDir", "showHidden"], history: { state: "none" }, github: { user: null, repos: [] } });
    },
    // what would write: kept in this window, and nowhere else
    save({ text, path, seq }) { const p = path || onScreen; if (exists(p) && typeof text === "string") notes.set(p, text); void seq; },
    toggle({ line }) { if (onScreen) { notes.set(onScreen, C.toggleTask(notes.get(onScreen), line)); render(onScreen, { keepScroll: true }); } },
    "share-info"({ path }) { if (exists(path)) tellShare(path); },
    folderlook({ path, color, icon }) { looks = C.lookSet(looks, path.slice(BASE.length + 1), color, icon); sendFolder(); },
    "share-set"({ path }) { shared = true; sendFolder(); tellShare(path); },
    "share-stop"({ path }) { shared = false; sendFolder(); tellShare(path); },
    copy({ text }) { navigator.clipboard?.writeText(text || "").catch(() => {}); },
    pastetext() { navigator.clipboard?.readText().then((t) => tell("pasteText", t)).catch(() => {}); },
    editcmd({ cmd }) { try { document.execCommand(String(cmd || "").toLowerCase()); } catch { /* (not this browser's) */ } },
    external({ url }) { if (/^(https?:|mailto:)/i.test(url || "")) window.open(url, "_blank", "noopener,noreferrer"); },
    print() { window.print(); },
    // a PDF's bytes, in pieces (as host.js hands them)
    async pdfdata({ path, id }) {
      try {
        path = where(path);
        if (!exists(path) || C.kindOf(path) !== "pdf") throw new Error("not a PDF file");
        const res = await fetch(fileUrl(path));
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
    // whiteboards and what is drawn on a PDF: kept in this window, as long as it is open
    async "board-read"({ path, id }) {
      try { path = where(path); if (!exists(path) || !isBoard(path)) throw new Error("not a whiteboard"); tell("boardText", id, await boardText(path), null); } catch (e) { tell("boardText", id, null, String(e.message || e)); }
    },
    "board-save"({ path, text, id }) {
      path = where(path);
      if (!exists(path) || !isBoard(path) || typeof text !== "string") return tell("boardSaved", id, "not a whiteboard");
      boards.set(path, text); tell("boardSaved", id, null);
      if (drawn.has(path)) URL.revokeObjectURL(drawn.get(path));
      drawn.set(path, URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })));
      setTimeout(freshen, 0); setTimeout(freshen, 400);
    },
    "pdfink-read"({ path, id }) { tell("boardText", id, inks.get(where(path)) ?? null, null); },
    "pdfink-save"({ path, text, empty, id }) { path = where(path); if (empty) inks.delete(path); else if (typeof text === "string") inks.set(path, text); tell("boardSaved", id, null); },
    "board-new"({ path, text, id }) {
      if (!SAMPLES || path !== onScreen || typeof text !== "string") return tell("boardMade", { id, error: "The sample notes stay as they are." });
      const d = new Date(), two = (n) => String(n).padStart(2, "0"), name = `board-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}.board.svg`, target = BASE + "/" + name;
      others.add(target); boards.set(target, text); sendFolder();
      tell("boardMade", { id, path, markup: `![](${encodeURIComponent(name)})`, file: target });
    },
    "board-put"({ id }) { tell("boardPut", id, [], "The samples keep no pictures: sign in to keep your own."); },
    newboard({ name, text }) {
      if (!SAMPLES || typeof text !== "string") return toast("The sample notes stay as they are.");
      let stem = C.cleanName(String(name || "")) || "Whiteboard";
      for (const ending of [".board.svg", ".svg", ".board"]) if (stem.toLowerCase().endsWith(ending)) stem = stem.slice(0, -ending.length).trimEnd();
      const path = `${BASE}/${stem || "Whiteboard"}.board.svg`;
      if (exists(path)) return toast(`“${C.nameOf(path)}” already exists`);
      others.add(path); boards.set(path, text); sendFolder();
      tell("revealRows", [path]); tell("openBoardFile", path);
    },
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
