/* mdview, the page — what stands around the note: the toolbar, find, the outline, the toast, the
 * notice of a newer version of the app. */
"use strict";
(() => {
  const P = window.MdPage;
  const { DESKTOP, post, T, esc, motionMs, ICON } = P; // viewer/base.js
  const { shownRoot, elementById, scrollToFragment, reducedMotion } = P; // viewer/render.js

  const toolbar = document.createElement("nav");
  toolbar.id = "toolbar";
  toolbar.innerHTML =
    `<button class="tb" data-act="sidebar" title="${esc(T("Sidebar (Ctrl+Alt+S)"))}" aria-label="${esc(T("Sidebar"))}">${ICON.sidebar}</button>` +
    // (a note opened by itself has no sidebar: this opens its folder beside it — the desktop only; viewer/*.css shows it while no folder is open)
    ((window.MdHost || {}).reading || !DESKTOP ? "" : `<button class="tb" data-act="notefolder" title="${esc(T("start.here"))}" aria-label="${esc(T("start.here"))}">${ICON.folder}</button>`) +
    `<button class="tb" data-act="overview" title="${esc(T("All notes (Ctrl+Alt+G)"))}" aria-label="${esc(T("All notes"))}" aria-pressed="false">${ICON.apps}</button>` +
    `<button class="tb" data-act="outline" title="${esc(T("Outline (Ctrl+Shift+O)"))}" aria-label="${esc(T("Outline"))}">${ICON.list}</button>` +
    `<button class="tb" data-act="find" title="${esc(T("Find (Ctrl+F)"))}" aria-label="${esc(T("Find"))}">${ICON.search}</button>` +
    `<button class="tb" data-act="share" title="${esc(T("Share…"))}" aria-label="${esc(T("Share"))}">${ICON.share}</button>` +
    // (the assistant from the bar, as the Velum lab has it — Velum Refined and Focus: viewer/look.css shows it, the bubble goes)
    `<button class="tb tb-ai" data-act="ai" title="${esc(T("ai.chat"))}" aria-label="${esc(T("ai.chat"))}">${P.SVG_ICON.spark}</button>` +
    `<div class="seg" role="radiogroup" aria-label="${esc(T("mode.label"))}" style="--i:3"><span class="seg-thumb"></span>` +
    [["active", ICON.pencil], ["split", ICON.split], ["edit", ICON.source], ["read", ICON.book]].map(([m, icon]) =>
      `<button class="seg-btn" role="radio" data-act="mode" data-mode="${m}" aria-checked="${m === "read"}"` +
      ` title="${esc(T("mode.tip." + m, T("mode." + m)))}" aria-label="${esc(T("mode." + m))}">${icon}</button>`).join("") +
    `</div>`; // (the panel at the right: from its rail at the window's edge, or Ctrl+Alt+P — no button of its own here)
  document.body.appendChild(toolbar);

  const outlinePop = document.createElement("div");
  outlinePop.id = "outline";
  outlinePop.className = "ui-menu ui-popover surface";
  outlinePop.style.setProperty("--origin", "top right");
  outlinePop.tabIndex = -1;
  outlinePop.setAttribute("role", "menu");
  document.body.appendChild(outlinePop);

  const findBar = document.createElement("div");
  findBar.id = "findbar";
  findBar.className = "ui-menu surface";
  findBar.style.setProperty("--origin", "top right");
  findBar.innerHTML =
    `<span class="find-icon">${ICON.search}</span>` +
    `<input id="find-input" type="search" placeholder="${esc(T("Find"))}" spellcheck="false" autocomplete="off">` +
    `<span id="find-count" aria-live="polite"></span>` +
    `<button class="tb" data-act="prev" title="${esc(T("Previous match (Shift+Enter)"))}" aria-label="${esc(T("Previous match"))}">${ICON.up}</button>` +
    `<button class="tb" data-act="next" title="${esc(T("Next match (Enter)"))}" aria-label="${esc(T("Next match"))}">${ICON.down}</button>` +
    `<button class="tb" data-act="closefind" title="${esc(T("Close (Esc)"))}" aria-label="${esc(T("Close find"))}">${ICON.x}</button>`;
  document.body.appendChild(findBar);
  const findInput = findBar.querySelector("#find-input");
  const findCount = findBar.querySelector("#find-count");

  const toastEl = document.createElement("div");
  toastEl.id = "toast";
  toastEl.setAttribute("role", "status");
  document.body.appendChild(toastEl);
  let toastTimer = 0;
  /* A short message. With something to take back ({ label, type }: a button that sends that to
   * the application — Undo after a move to the trash), it stands longer, and Ctrl+Z does the
   * same while it stands (outside a text that is being typed in). */
  let toastAct = null;
  function toast(msg, action = null) {
    toastEl.textContent = msg;
    toastAct = action && action.type ? action : null;
    toastEl.toggleAttribute("data-action", !!toastAct);
    if (toastAct) {
      const b = toastEl.appendChild(document.createElement("button"));
      b.type = "button";
      b.textContent = toastAct.label === "Undo" ? T("toast.undo") : toastAct.label;
    }
    toastEl.dataset.open = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { delete toastEl.dataset.open; toastAct = null; }, toastAct ? 6000 : 1600);
  }
  const toastDo = () => { const a = toastAct; if (!a) return false; toastAct = null; clearTimeout(toastTimer); delete toastEl.dataset.open; post(a.type, a.data || {}); return true; };
  toastEl.addEventListener("click", (e) => { if (e.target.closest("button")) toastDo(); });
  addEventListener("keydown", (e) => {
    if (!toastAct || e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return; // (there it is the text's own undo)
    e.preventDefault(); e.stopPropagation();
    toastDo();
  }, true);

  /* A newer version of the app (the desktop's shell says so: src-tauri/src/update.rs): a notice
   * of the toast's kind that stays until it is answered — quiet, nothing over the note is held up.
   * kind "restart": downloaded and checked, Restart to Update puts it in place (the windows close
   * the way they do and the new version starts); kind "download": a .deb or an .rpm, the download
   * page. Later takes it away in every window; null too. */
  const updateEl = document.createElement("div");
  updateEl.id = "update";
  updateEl.setAttribute("role", "status");
  updateEl.addEventListener("wheel", (e) => e.preventDefault(), { passive: false }); // (nothing to scroll here: the note behind does not either)
  document.body.appendChild(updateEl);
  function updateNotice(n) {
    if (!n || !n.version) { delete updateEl.dataset.open; document.body.removeAttribute("data-update"); return; }
    updateEl.textContent = "";
    const text = updateEl.appendChild(document.createElement("span"));
    text.className = "upd-text";
    text.textContent = T("update.available", n.version);
    const button = (label, act, cls = "") => {
      const b = updateEl.appendChild(document.createElement("button"));
      b.type = "button"; b.textContent = label; b.dataset.act = act;
      if (cls) b.className = cls;
      return b;
    };
    const notes = n.kind === "download" ? n.notes : n.url;
    if (notes) button(T("update.notes"), "notes").onclick = () => post("link", { href: notes });
    button(T("update.later"), "later").onclick = () => post("update-later");
    if (n.kind === "download") button(T("update.download"), "download", "upd-go").onclick = () => post("link", { href: n.url });
    else button(T("update.restart"), "restart", "upd-go").onclick = (e) => { e.currentTarget.disabled = true; post("update-restart"); };
    document.body.setAttribute("data-update", "");
    updateEl.dataset.open = "";
  }

  const outlineOpen = () => outlinePop.hasAttribute("data-open");
  const findOpen = () => findBar.hasAttribute("data-open");

  // toolbar hides while reading downwards, returns on scroll up or near the top
  let lastY = 0;
  const showToolbar = (show) => toolbar.classList.toggle("hidden", !show && !document.body.hasAttribute("data-tabs") && !document.body.classList.contains("pdf-open")); // (beside the tabs it stays, and over a PDF: it holds the PDF's controls)
  addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y < 48 || y < lastY - 6) showToolbar(true);
    else if (y > lastY + 6 && !outlineOpen() && !findOpen()) showToolbar(false);
    lastY = y;
  }, { passive: true });
  addEventListener("mousemove", (e) => { if (e.clientY < 72) showToolbar(true); }, { passive: true });

  // --- outline popover
  let hl = -1;
  function buildOutline() {
    if (!P.outline.length) {
      outlinePop.innerHTML = '<div class="menu-empty">No headings</div>';
      return;
    }
    const minLevel = Math.min(...P.outline.map((o) => o.level));
    outlinePop.innerHTML = P.outline.map((o, i) =>
      `<button class="menu-item" role="menuitem" data-i="${i}" style="--indent:${o.level - minLevel}">${esc(o.text)}</button>`).join("");
  }
  const headingEl = (o) => (P.inSource() ? P.edBack.children[o.line] : elementById(o.slug));
  function currentSection() {
    let idx = -1;
    P.outline.forEach((o, i) => {
      const el = headingEl(o);
      if (el && el.getBoundingClientRect().top < 120) idx = i;
    });
    return idx;
  }
  function setHl(i) {
    const items = outlinePop.querySelectorAll(".menu-item");
    items.forEach((el, k) => el.classList.toggle("hl", k === i));
    hl = i;
    if (items[i]) items[i].scrollIntoView({ block: "nearest" });
  }
  function openOutline() {
    closeFind(false);
    if (P.inSource()) P.outline = P.outlineOf(P.edInput.value);
    else if (P.mode === "active" && MdActive.view.edited) P.outline = P.outlineOf(MdActive.view.serialize(false));
    buildOutline();
    const cur = currentSection();
    outlinePop.querySelectorAll(".menu-item").forEach((el, k) => el.classList.toggle("current", k === cur));
    showToolbar(true);
    outlinePop.dataset.open = "";
    toolbar.querySelector('[data-act="outline"]').classList.add("active");
    setHl(Math.max(cur, 0));
    outlinePop.focus({ preventScroll: true });
  }
  function closeOutline() {
    if (!outlineOpen()) return false;
    delete outlinePop.dataset.open;
    toolbar.querySelector('[data-act="outline"]').classList.remove("active");
    hl = -1;
    outlinePop.querySelectorAll(".hl").forEach((el) => el.classList.remove("hl"));
    return true;
  }
  function activateOutline(i) {
    const item = outlinePop.querySelectorAll(".menu-item")[i];
    if (!item) return;
    const flash = motionMs("--flash-duration", 70);
    item.classList.remove("hl");
    setTimeout(() => item.classList.add("hl"), flash);
    setTimeout(() => {
      closeOutline();
      if (P.inSource()) P.goToLine(P.outline[i].line);
      else scrollToFragment(P.outline[i].slug, true);
    }, flash * 2);
  }
  /* --- Go to… (Velum Refined and Focus: the island's search, Ctrl+K outside a field — the lab's palette): a field, and under it
   * the notes of the folder whose names have what is typed, the headings of the note on screen, and what can be done with it
   * (a new note, the assistant, find in this note). ↑ ↓ choose, Enter opens (Ctrl+Enter in a new tab), Esc closes. */
  const pal = document.createElement("div");
  pal.id = "palette";
  pal.className = "ui-popover surface";
  pal.setAttribute("role", "dialog");
  pal.setAttribute("aria-label", T("Go to"));
  pal.innerHTML = `<div class="pal-field">${ICON.search}<input type="text" spellcheck="false" autocomplete="off" placeholder="${esc(T("Go to a note, a heading or a command"))}"></div>` +
    `<div class="pal-list" role="listbox"></div><div class="pal-foot"><span>↑↓ ${esc(T("choose"))}</span><span>↵ ${esc(T("open"))}</span><span>⌃↵ ${esc(T("open in new tab"))}</span><span>esc ${esc(T("close"))}</span></div>`;
  document.body.appendChild(pal);
  const palInput = pal.querySelector("input"), palList = pal.querySelector(".pal-list");
  // (the wheel over it is its own: BUGS.md rule 2)
  pal.addEventListener("wheel", (e) => { if (!palList.contains(e.target) || palList.scrollHeight <= palList.clientHeight) e.preventDefault(); }, { passive: false });
  // Focus' round button at the window's top right: Go to… (viewer/look.css shows it there, nowhere else)
  const palBtn = document.createElement("button");
  palBtn.id = "pal-btn"; palBtn.type = "button"; palBtn.className = "tb";
  palBtn.title = T("Go to") + " (Ctrl+K)"; palBtn.setAttribute("aria-label", T("Go to"));
  palBtn.innerHTML = ICON.search;
  palBtn.addEventListener("click", () => (palOpen() ? closePalette() : openPalette()));
  document.body.appendChild(palBtn);
  let palItems = [], palHl = 0;
  const palOpen = () => pal.hasAttribute("data-open");
  const allNotes = () => { const out = [], walk = (n) => { if (!n) return; for (const x of n.notes || []) if (!x.pdf || x.kind === "pdf") out.push(x); for (const d of n.dirs || []) walk(d); }; walk(P.folder && (P.folder.all || P.folder.tree)); return out; };
  const mark = (text, q) => { const i = q ? text.toLowerCase().indexOf(q) : -1; return i < 0 ? esc(text) : esc(text.slice(0, i)) + "<em>" + esc(text.slice(i, i + q.length)) + "</em>" + esc(text.slice(i + q.length)); };
  function palBuild() {
    const raw = palInput.value.trim(), q = raw.toLowerCase(), rows = [];
    const notes = allNotes().filter((n) => !q || (n.title || n.name).toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
      .sort((a, b) => (b.opened || 0) - (a.opened || 0) || (b.mtime || 0) - (a.mtime || 0)).slice(0, 7);
    const root = P.folder ? P.folder.root + "/" : "";
    for (const n of notes) rows.push({ kind: "note", icon: n.pdf ? "page" : "note", html: mark((n.title || n.name).replace(/\.(md|markdown|mdown)$/i, ""), q), sub: esc(n.path.startsWith(root) ? n.path.slice(root.length).replace(/[^/]*$/, "").replace(/\/$/, "") : ""), run: (tab) => { closePalette(); post("note", { path: n.path, tab }); } });
    for (const [i, o] of (P.outline || []).entries()) if (q && o.text.toLowerCase().includes(q) && rows.length < 10) rows.push({ kind: "heading", icon: "list", html: mark(o.text, q), sub: esc(T("in this note")), run: () => { closePalette(); if (P.inSource()) P.goToLine(P.outline[i].line); else scrollToFragment(P.outline[i].slug, true); } });
    const cmds = [];
    if (P.folder) cmds.push({ icon: "plus", html: raw ? esc(T("New Note “{0}”", raw)) : esc(T("New Note")), key: "⌃N", run: () => { closePalette(); P.openNewNote(); } });
    if (document.body.hasAttribute("data-ai")) cmds.push({ icon: "spark", html: raw ? esc(T("Ask the assistant about “{0}”", raw)) : esc(T("Ask the assistant")), run: () => { closePalette(); document.getElementById("ai-bubble")?.click(); } });
    if (P.current) cmds.push({ icon: "search", html: raw ? esc(T("Find “{0}” in this note", raw)) : esc(T("Find in this note")), key: "⌃F", run: () => { closePalette(); openFind(); if (raw) { findInput.value = raw; runFind(raw, true); } } });
    palItems = [...rows, ...cmds.map((c) => ({ kind: "cmd", ...c }))];
    palHl = Math.min(palHl, Math.max(0, palItems.length - 1));
    const icon = (n) => (n === "spark" ? P.SVG_ICON.spark : ICON[n] || ICON.note);
    let html = "", last = "";
    palItems.forEach((it, i) => {
      const head = it.kind === "cmd" ? T("Commands") : it.kind === "heading" ? T("Headings") : T("Notes");
      if (head !== last) { html += `<div class="pal-head">${esc(head)}</div>`; last = head; }
      html += `<div class="pal-row${i === palHl ? " hl" : ""}" role="option" data-i="${i}">${icon(it.icon)}<span class="pal-t">${it.html}</span>${it.sub ? `<small>${it.sub}</small>` : ""}${it.key ? `<kbd>${esc(it.key)}</kbd>` : ""}</div>`;
    });
    palList.innerHTML = html || `<div class="menu-empty">${esc(T("Nothing found"))}</div>`;
  }
  function palSet(i) { palHl = i; palList.querySelectorAll(".pal-row").forEach((r) => r.classList.toggle("hl", Number(r.dataset.i) === i)); palList.querySelector(".pal-row.hl")?.scrollIntoView({ block: "nearest" }); }
  function openPalette() {
    closeFind(false); closeOutline();
    palInput.value = ""; palHl = 0; palBuild();
    pal.dataset.open = "";
    palInput.focus({ preventScroll: true });
  }
  function closePalette() { if (!palOpen()) return false; delete pal.dataset.open; return true; }
  palInput.addEventListener("input", () => { palHl = 0; palBuild(); });
  palInput.addEventListener("keydown", (e) => {
    e.stopPropagation(); // (the note's keys stay the note's: BUGS.md rule 1)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (palItems.length) palSet((palHl + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % palItems.length); }
    else if (e.key === "Enter") { e.preventDefault(); palItems[palHl]?.run(e.ctrlKey || e.metaKey); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });
  palList.addEventListener("mousemove", (e) => { const r = e.target.closest(".pal-row"); if (r && Number(r.dataset.i) !== palHl) palSet(Number(r.dataset.i)); });
  palList.addEventListener("click", (e) => { const r = e.target.closest(".pal-row"); if (r) palItems[Number(r.dataset.i)]?.run(e.ctrlKey || e.metaKey); });
  // a press beside it closes it, and does nothing else (as a menu)
  document.addEventListener("mousedown", (e) => { if (palOpen() && !pal.contains(e.target) && !e.target.closest('[data-act="palette"], [data-act="find"], #pal-btn')) { closePalette(); e.preventDefault(); e.stopPropagation(); } }, true);

  /* --- the outline at the right: Velum Refined and Velum Focus (prefs "look"; the lab's ~/Projects/velum/lab/web/mdview.html,
   * proposals A and C). The note's headings in a quiet list beside it (Refined), or as marks at the window's edge that open
   * on hover (Focus) — viewer/look.css says where and when it shows. Filled when the note is drawn (railOutline, from
   * viewer/render.js and viewer/modes.js); the heading read is marked as the note scrolls, a click goes there. */
  const rail = document.createElement("nav");
  rail.id = "orail";
  rail.hidden = true;
  rail.setAttribute("aria-label", T("Outline"));
  document.body.appendChild(rail);
  let railCur = -2, railFrame = 0;
  function railOutline() {
    const list = document.documentElement.dataset.velumLook && document.documentElement.dataset.velum ? P.outline || [] : []; // (only where Velum is: viewer/look.css)
    rail.hidden = list.length < 2; // (one heading is no outline)
    if (rail.hidden) { rail.textContent = ""; return; }
    const min = Math.min(...list.map((o) => o.level));
    rail.innerHTML = `<div class="or-head">${esc(T("Outline"))}</div>` +
      list.map((o, i) => `<button class="or-row" type="button" data-i="${i}" style="--indent:${Math.min(o.level - min, 3)}"><i></i><span>${esc(o.text)}</span></button>`).join("");
    railCur = -2;
    railMark();
  }
  function railMark() {
    if (rail.hidden) return;
    const i = currentSection();
    if (i === railCur) return;
    railCur = i;
    rail.querySelectorAll(".or-row").forEach((b, k) => b.classList.toggle("current", k === Math.max(i, 0)));
  }
  addEventListener("scroll", () => { if (!rail.hidden && !railFrame) railFrame = requestAnimationFrame(() => { railFrame = 0; railMark(); }); }, { passive: true });
  rail.addEventListener("click", (e) => {
    const b = e.target.closest(".or-row"), o = b && P.outline[Number(b.dataset.i)];
    if (!o) return;
    if (P.inSource()) P.goToLine(o.line);
    else scrollToFragment(o.slug, true);
  });

  outlinePop.addEventListener("mousemove", (e) => {
    const item = e.target.closest(".menu-item");
    if (item && Number(item.dataset.i) !== hl) setHl(Number(item.dataset.i));
  });
  outlinePop.addEventListener("mouseleave", () => setHl(-1));
  outlinePop.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (item) activateOutline(Number(item.dataset.i));
  });
  outlinePop.addEventListener("keydown", (e) => {
    const n = P.outline.length;
    if (!n) return;
    const moves = { ArrowDown: hl + 1, ArrowUp: hl - 1, Home: 0, End: n - 1 };
    if (e.key in moves) { e.preventDefault(); setHl(Math.min(n - 1, Math.max(0, moves[e.key]))); }
    else if (e.key === "Enter" && hl >= 0) { e.preventDefault(); activateOutline(hl); }
  });

  // --- find (CSS Custom Highlight API, DOM untouched)
  let hits = [], hitIdx = -1;
  const canHighlight = typeof Highlight !== "undefined" && CSS.highlights;
  function runFind(q, keepPos = false) {
    const prevRange = hits[hitIdx];
    hits = [];
    hitIdx = -1;
    if (canHighlight) { CSS.highlights.delete("find"); CSS.highlights.delete("find-current"); }
    findBar.classList.remove("no-hits");
    if (!q) { findCount.textContent = ""; return; }
    const needle = q.toLocaleLowerCase();
    if (P.inSource()) {
      const hay = P.edInput.value.toLocaleLowerCase();
      for (let i = hay.indexOf(needle); i !== -1 && hits.length < 5000; i = hay.indexOf(needle, i + needle.length)) {
        const r = P.rangeOf(i, i + q.length);
        r.at = i;
        hits.push(r);
      }
    } else {
      const walker = document.createTreeWalker(shownRoot(), NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement.closest(".katex-mathml, style, script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = walker.nextNode(); n && hits.length < 5000; n = walker.nextNode()) {
        const hay = n.data.toLocaleLowerCase();
        for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
          const r = new Range();
          r.setStart(n, i);
          r.setEnd(n, Math.min(n.data.length, i + q.length));
          hits.push(r);
        }
      }
    }
    if (!hits.length) {
      findCount.textContent = T("No matches");
      findBar.classList.add("no-hits");
      return;
    }
    if (canHighlight) CSS.highlights.set("find", new Highlight(...hits));
    const refTop = keepPos && prevRange ? prevRange.getBoundingClientRect().top - 1 : 0;
    const start = hits.findIndex((r) => r.getBoundingClientRect().top >= refTop);
    focusHit(start < 0 ? 0 : start, !keepPos);
  }
  function focusHit(i, scroll = true) {
    if (!hits.length) return;
    hitIdx = (i + hits.length) % hits.length;
    const r = hits[hitIdx];
    if (canHighlight) CSS.highlights.set("find-current", new Highlight(r));
    findCount.textContent = T("{0} of {1}", hitIdx + 1, hits.length);
    if (!scroll) return;
    const rect = r.getBoundingClientRect();
    if (rect.top < 80 || rect.bottom > innerHeight - 40) {
      window.scrollBy({ top: rect.top - innerHeight / 3, behavior: reducedMotion() ? "instant" : "smooth" });
    }
  }
  function openFind() {
    closeOutline();
    showToolbar(true);
    findBar.dataset.open = "";
    const sel = P.inSource() ? P.edInput.value.slice(P.edInput.selectionStart, P.edInput.selectionEnd) : String(getSelection());
    if (sel && !sel.includes("\n") && sel.length < 80) findInput.value = sel;
    findInput.focus();
    findInput.select();
    runFind(findInput.value);
  }
  function closeFind(refocus = true) {
    if (!findOpen()) return false;
    delete findBar.dataset.open;
    if (canHighlight) { CSS.highlights.delete("find"); CSS.highlights.delete("find-current"); }
    const r = hits[hitIdx];
    hits = [];
    if (refocus) {
      findInput.blur();
      if (P.inSource()) {
        P.edInput.focus({ preventScroll: true });
        if (r) P.edInput.setSelectionRange(r.at, r.at + String(r).length);
      } else if (r) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    }
    return true;
  }
  let findTimer = 0;
  findInput.addEventListener("input", () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => runFind(findInput.value), hits.length > 500 ? 120 : 30);
  });
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); focusHit(hitIdx + (e.shiftKey ? -1 : 1)); }
  });

  // what the page's other files use of this one
  Object.assign(P, { toolbar, outlinePop, findBar, findInput, toast, updateNotice, outlineOpen, findOpen, showToolbar,
    buildOutline, openOutline, closeOutline, runFind, focusHit, openFind, closeFind, railOutline, openPalette, closePalette, palOpen });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    hitIdx: [() => hitIdx],
    findTimer: [() => findTimer, (v) => { findTimer = v; }],
  });
})();
