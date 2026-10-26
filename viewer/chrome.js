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
    buildOutline, openOutline, closeOutline, runFind, focusHit, openFind, closeFind });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    hitIdx: [() => hitIdx],
    findTimer: [() => findTimer, (v) => { findTimer = v; }],
  });
})();
