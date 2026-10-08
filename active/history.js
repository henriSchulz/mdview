/* mdview — the history's window: the versions of the note shown, at the left, and what one of
 * them changed (or how it differs from the note as it is now) at the right; a version can be
 * put back as the note. Built like the settings window, of the same parts.
 *
 * The application knows the versions ("history-log" → A.history.got) and gives each one's text
 * when asked ("history-text" → A.history.gotText); the differences are worked out here
 * (vendor/diff.min.js), so the same window can stand on another host. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const UI = window.MdView.core.UI, esc = window.MdView.core.esc;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  const el = (tag, attrs = {}, text) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
  const CONTEXT = 3; // unchanged lines shown around a change
  const NOW = "now"; // the note as it is, in the place of a version's id

  let win = null, root = null, list = null, body = null, title = null, restore = null, mode = null;
  let path = null, versions = [], chosen = -1, texts = new Map(), wanted = new Set(), standing = "none";
  const isOpen = () => !!root && root.hasAttribute("data-open");
  const lang = () => ((window.MdPrefs || {}).lang === "de" ? "de-DE" : "en-GB");
  const when = (t) => new Date(t * 1000).toLocaleString(lang(), { dateStyle: "medium", timeStyle: "short" });
  const device = (v) => v.device.replace(/ \([0-9a-f-]{36}\)$/, "");
  const current = () => window.MdView.core.current;
  const unix = (text) => text.replace(/\r\n?/g, "\n"); // (a version and the note are compared as text, whatever their line ends)
  const noteNow = () => { const c = current(); return unix(c.text ?? c.raw ?? ""); };

  // ------------------------------------------------------------ the differences
  const lines = (text) => { const l = text.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; };
  /* Two texts → rows [{ sign: " " | "+" | "-", html }]; where lines were replaced by others, the
   * words that differ are marked in both. */
  function rows(before, after) {
    const out = [], parts = Diff.diffLines(before, after);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i], next = parts[i + 1];
      if (p.removed && next && next.added) {
        let was = "", is = "";
        for (const w of Diff.diffWordsWithSpace(p.value, next.value)) {
          if (!w.added) was += w.removed ? `<del>${esc(w.value)}</del>` : esc(w.value);
          if (!w.removed) is += w.added ? `<ins>${esc(w.value)}</ins>` : esc(w.value);
        }
        // (a mark that runs over a line's end goes on in the next line)
        const split = (html, tag) => { let on = false; return lines(html).map((l) => { const s = (on ? `<${tag}>` : "") + l; on = (s.lastIndexOf(`<${tag}>`) > s.lastIndexOf(`</${tag}>`)); return on ? s + `</${tag}>` : s; }); };
        for (const l of split(was, "del")) out.push({ sign: "-", html: l });
        for (const l of split(is, "ins")) out.push({ sign: "+", html: l });
        i++;
      } else for (const l of lines(p.value)) out.push({ sign: p.added ? "+" : p.removed ? "-" : " ", html: esc(l) });
    }
    return out;
  }
  function draw(before, after) {
    const all = rows(before, after);
    body.textContent = "";
    if (!all.some((r) => r.sign !== " ")) { body.appendChild(el("p", { class: "hi-empty" }, T("history.same"))); return; }
    const near = all.map(() => false);
    all.forEach((r, i) => { if (r.sign !== " ") for (let j = Math.max(0, i - CONTEXT); j <= Math.min(all.length - 1, i + CONTEXT); j++) near[j] = true; });
    const box = el("div", { class: "hi-diff" });
    let skipped = 0;
    const gap = () => { if (skipped) box.appendChild(el("div", { class: "hi-gap" }, T(skipped === 1 ? "history.unchanged.one" : "history.unchanged", skipped))); skipped = 0; };
    all.forEach((r, i) => {
      if (!near[i]) { skipped++; return; }
      gap();
      const line = el("div", { class: "hi-line" + (r.sign === "+" ? " add" : r.sign === "-" ? " del" : "") });
      const sign = el("span", { class: "hi-sign", "aria-hidden": "true" }, r.sign === " " ? "" : r.sign === "+" ? "+" : "−");
      const text = el("span", { class: "hi-text" });
      text.innerHTML = r.html || " ";
      line.append(sign, text);
      box.appendChild(line);
    });
    gap();
    body.appendChild(box);
  }

  // ------------------------------------------------------------ versions
  const textOf = (id) => (id === NOW ? noteNow() : id === null ? "" : texts.get(id));
  function ask(v) {
    if (!v || texts.has(v.id) || wanted.has(v.id)) return;
    wanted.add(v.id);
    post("history-text", { path, id: v.id, at: v.path });
  }
  /* What is compared: the version with the one before it (what it changed), or with the note now. */
  function show() {
    const v = versions[chosen];
    if (!v) return;
    const older = versions[chosen + 1];
    const [a, b] = mode.value === "now" ? [v.id, NOW] : [older ? older.id : null, v.id];
    ask(v); if (mode.value !== "now") ask(older);
    const before = textOf(a), after = textOf(b);
    if (before === undefined || after === undefined) { waiting(true); return; } // (on its way: what is shown stays until it is here, and a ring says so)
    waiting(false);
    draw(before, after);
    body.scrollTop = 0;
  }
  function choose(i) {
    if (i < 0 || i >= versions.length) return;
    chosen = i;
    [...list.children].forEach((row, n) => { if (n === i) row.setAttribute("aria-current", "true"); else row.removeAttribute("aria-current"); });
    const v = versions[i];
    title.textContent = when(v.time);
    restore.hidden = false;
    restore.disabled = texts.has(v.id) && texts.get(v.id) === noteNow(); // (the note is this version already)
    show();
  }
  /* Waiting shown: the versions are asked of the application (in the browser: of GitHub), and each
   * version's text when it is chosen. A ring in the window's middle — after the wait that is no
   * wait (--loading-delay), over whatever is shown, which stays. */
  const waiting = (on) => { if (root) root.toggleAttribute("data-wait", !!on); };
  function got(data) {
    if (!isOpen() || data.path !== path) return;
    waiting(false);
    versions = data.versions || [];
    standing = data.state || "none";
    list.textContent = "";
    for (const v of versions) {
      const row = el("button", { class: "st-nav hi-row", type: "button" });
      const text = el("span", { class: "hi-row-text" });
      const by = device(v), about = v.subject && !v.path.endsWith(v.subject) ? " · " + v.subject : "";
      text.append(el("span", { class: "hi-when" }, when(v.time)), el("span", { class: "hi-by" }, by + about));
      row.appendChild(text);
      list.appendChild(row);
    }
    mode.closest(".pop-wrap").hidden = restore.hidden = !versions.length;
    if (versions.length) return choose(0);
    title.textContent = T("history.title");
    body.textContent = "";
    body.appendChild(el("p", { class: "hi-empty" }, T(standing === "none" || (standing === "foreign" && data.own) ? "history.off" : "history.none")));
  }
  function gotText(data) {
    if (data.path !== path) return;
    wanted.delete(data.id);
    if (data.text == null) return;
    texts.set(data.id, unix(data.text));
    if (isOpen() && versions[chosen]) { restore.disabled = texts.get(versions[chosen].id) === noteNow(); show(); }
  }
  function restored(data) {
    if (data.path !== path) return;
    close();
    const v = versions.find((x) => x.id === data.id);
    window.MdView.toast(T("history.restored", v ? when(v.time) : ""));
  }

  // ------------------------------------------------------------ the window
  /* The window's frame, the settings window's kind: a list at the left under a name, at the right
   * a head (close, a title, tools) over what the chosen row is about. Shared with the conflicts'
   * window (conflict.js). choose(i): a row was clicked or reached with the arrows.
   * -> { root, note, list, title, tools, body, isOpen(), show(), hide() } */
  function frame(id, { name, listLabel, choose, chosen }) {
    const scrim = el("div", { id: id + "-scrim" });
    const root = el("div", { id, role: "dialog", "aria-modal": "true", "aria-labelledby": id + "-title", tabindex: "-1" });
    const side = el("nav", { class: "st-side", "aria-label": listLabel });
    const note = el("div", { class: "hi-note" });
    const list = el("div", { class: "st-group hi-list" });
    side.append(el("div", { class: "st-name" }, name), note, list);
    const main = el("div", { class: "st-main" });
    const head = el("header", { class: "st-head" });
    const x = el("button", { class: "st-close", type: "button", "aria-label": T("history.close") });
    x.innerHTML = UI.x;
    const title = el("h2", { id: id + "-title" });
    const tools = el("div", { class: "hi-tools" });
    head.append(x, title, tools);
    const body = el("div", { class: "st-content hi-body" });
    main.append(head, body);
    root.append(side, main);
    document.body.append(scrim, root);
    let focusBack = null;
    const isOpen = () => root.hasAttribute("data-open");
    function show() {
      focusBack = document.activeElement;
      void root.offsetWidth;
      window.MdView.core.lockScroll(true);
      scrim.dataset.open = root.dataset.open = "";
      root.focus({ preventScroll: true });
    }
    function hide() {
      if (!isOpen()) return false;
      window.MdView.core.closePick();
      delete scrim.dataset.open; delete root.dataset.open;
      window.MdView.core.lockScroll(false);
      const view = A.view && A.view.pm;
      if (focusBack && focusBack.isConnected && focusBack !== document.body) focusBack.focus({ preventScroll: true }); else if (view) view.focus();
      focusBack = null;
      return true;
    }
    list.addEventListener("click", (e) => { const row = e.target.closest(".hi-row"); if (row) choose([...list.children].indexOf(row)); });
    x.addEventListener("click", () => hide());
    scrim.addEventListener("mousedown", (e) => { e.preventDefault(); hide(); });
    // the wheel belongs to the window while it is open: the note under it does not scroll
    const holdWheel = (e) => {
      if (e.ctrlKey) return;
      for (let n = e.target; n && n !== document.body; n = n.parentElement) {
        if (n.nodeType === 1 && /auto|scroll/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 1 && (e.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return;
        if (n === root || n === scrim) break;
      }
      e.preventDefault();
    };
    scrim.addEventListener("wheel", holdWheel, { passive: false });
    root.addEventListener("wheel", holdWheel, { passive: false });
    root.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      e.stopPropagation(); // the page's shortcuts are not for here
      const inList = e.target === root || !!e.target.closest?.(".hi-row");
      if (e.key === "Escape") { e.preventDefault(); hide(); }
      else if (inList && (e.key === "ArrowDown" || e.key === "ArrowUp")) { // the rows: up and down, what is shown follows
        e.preventDefault();
        const to = Math.max(0, Math.min(list.children.length - 1, chosen() + (e.key === "ArrowDown" ? 1 : -1)));
        if (list.children[to]) { list.children[to].focus(); list.children[to].scrollIntoView({ block: "nearest" }); choose(to); }
      } else if (e.key === "Tab") { // the focus stays in the window
        const all = [...root.querySelectorAll("button")].filter((n) => !n.disabled && n.offsetParent && (!n.matches(".hi-row") || n.getAttribute("aria-current")));
        const i = all.indexOf(document.activeElement);
        e.preventDefault();
        all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
      }
    });
    return { root, note, list, title, tools, body, isOpen, show, hide };
  }
  function build() {
    win = frame("history", { name: T("history.title"), listLabel: T("history.versions"), choose, chosen: () => chosen });
    ({ root, list, body, title } = win);
    mode = el("select", { class: "lp-field pf-select", "aria-label": T("history.compare") });
    for (const [v, l] of [["change", "history.mode.change"], ["now", "history.mode.now"]]) mode.appendChild(el("option", { value: v }, T(l)));
    mode.onchange = () => show();
    const pick = window.MdView.core.popup(mode);
    pick.sync();
    mode.addEventListener("change", pick.sync);
    restore = el("button", { class: "pf-link", type: "button" }, T("history.restore"));
    restore.onclick = () => { const v = versions[chosen]; if (v) post("history-restore", { path, id: v.id, at: v.path }); };
    win.tools.append(pick, restore);
    const ring = el("div", { class: "hi-wait", role: "status", "aria-label": T("history.loading") });
    ring.appendChild(el("span", { class: "busy-ring", "aria-hidden": "true" }));
    body.parentNode.appendChild(ring);
  }
  function open() {
    const cur = current();
    if (A.dialog.open || isOpen() || (A.prefs && A.prefs.isOpen) || (A.conflict && A.conflict.isOpen) || !cur || !cur.path || /\.pdf$/i.test(cur.path)) return false;
    if (!root) build();
    // What is typed and not saved yet is saved first: the note the versions are compared with is
    // the one on disk — and a version put back is not written over by a save still to come.
    window.MdView.flush(false);
    path = cur.path; versions = []; chosen = -1; texts = new Map(); wanted = new Set();
    win.note.textContent = cur.name || "";
    list.textContent = ""; body.textContent = ""; title.textContent = T("history.title");
    mode.closest(".pop-wrap").hidden = restore.hidden = true;
    post("history-log", { path });
    waiting(true);
    win.show();
    return true;
  }
  const close = () => !!win && win.hide();

  A.history = { open, close, got, gotText, restored, frame, rows, lines, when, el, get isOpen() { return isOpen(); } };
})();
