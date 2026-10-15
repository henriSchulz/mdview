/* mdview, the page — the source beside its reading: the fourth mode ("split"). The source editor at the left, as in the
 * source mode, and at the right the note as it reads, drawn anew a moment after each key, and kept at the same place in the
 * text as the source — scrolled at the left, it follows; scrolled at the right, the source follows. A click on a block at the
 * right puts the caret at its line. Its own pane: not the sheet of viewer/split.js, which is for another thing beside the note
 * (opening that sheet leaves this mode for the source alone). In a window too narrow for two, the source has it alone. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, esc, slugify, motionMs } = P; // viewer/base.js
  const { noteHtml } = P; // viewer/render.js
  const { edInput, edBack, captureEditAnchor } = P; // viewer/editor.js
  const still = () => !!window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; // (jsdom has no matchMedia)

  const pane = document.createElement("section");
  pane.id = "twin";
  pane.setAttribute("aria-label", T("mode.split.pane"));
  pane.innerHTML = `<div class="twin-body" tabindex="-1"><div class="twin-doc"></div></div>`;
  document.body.appendChild(pane);
  const body = pane.firstChild, doc = body.firstChild;

  let on = false;        // the mode is this one (and the window has room for two)
  let shown = null;      // the text the right side shows, and of which note
  let shownOf = null;
  let marks = [], lines = []; // the blocks at the right with the source line each begins at, in order
  let lead = "ed";       // which side is scrolled by hand: "ed" (the source) or "twin" — the other follows

  // ---------------------------------------------------------------- there, or not
  const ROOM = 600; // (the two halves: 300 px each at the least, as for the sheet beside the note)
  const sideW = () => (document.body.dataset.sidebar === "open" ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sb-w")) || 0 : 0);
  const fits = () => innerWidth - sideW() >= ROOM;
  /* The mode says whether the right half is there (editor.js: showMode). Coming and going, the source glides to its new place
   * from where it stood (only transform), at the same line of the text. */
  function sync() {
    const want = P.mode === "split" && !!P.current && P.current.kind !== "pdf" && !P.current.error && fits();
    if (want === on) { if (on) { follow(); place(); } return; }
    on = want;
    if (on && document.body.dataset.split != null && P.splitClose) P.splitClose(); // (one thing beside the note at a time)
    const ed = P.editor, glide = document.body.dataset.view === "edit" && !still();
    const before = glide ? ed.getBoundingClientRect().left : 0;
    const a = document.body.dataset.view === "edit" ? captureEditAnchor() : null;
    document.body.toggleAttribute("data-twin", on);
    if (a && a.line != null) { const el = edBack.children[a.line]; if (el) window.scrollBy({ top: el.getBoundingClientRect().top - a.top, behavior: "instant" }); }
    if (glide && ed.animate) {
      const by = before - ed.getBoundingClientRect().left, css = getComputedStyle(document.documentElement);
      if (Math.abs(by) > 1) try { ed.animate([{ transform: `translateX(${by}px)` }, { transform: "none" }], { duration: motionMs("--spring-smooth-dur", 510), easing: css.getPropertyValue("--spring-smooth").trim() || "ease-out" }); } catch (e) { /* (a curve this engine does not know: no glide) */ }
    }
    // (the right half is drawn a frame after the source stands: in a long note, two short holds of the page, not one long one)
    if (on) { shown = null; lead = "ed"; requestAnimationFrame(() => setTimeout(() => { follow(); place(); }, 0)); }
    clearInterval(watch);
    watch = on ? setInterval(() => follow(), 400) : 0; // (what changes the source without a key: undo, a paste from the host, the disk)
  }
  let watch = 0;
  addEventListener("resize", () => { if (P.mode === "split") sync(); else if (on) sync(); });
  if (typeof MutationObserver === "function") new MutationObserver(() => { if (P.mode === "split" || on) sync(); }).observe(document.body, { attributes: true, attributeFilter: ["data-sidebar", "data-view"] });

  // ---------------------------------------------------------------- what it shows
  /* Drawn anew when the source is another text: at once after a pause in typing, and at most every so often while one types —
   * as long as drawing took, twice, so that a long note does not hold the keys up. */
  let drawTimer = 0, lastDraw = 0, took = 0;
  function follow() {
    if (!on) return;
    const text = edInput.value, of = P.current && P.current.path;
    if (text === shown && of === shownOf) return;
    const wait = Math.max(0, Math.max(90, took * 2) - (performance.now() - lastDraw));
    clearTimeout(drawTimer);
    if (shown == null || of !== shownOf || !wait) { drawTimer = 0; draw(); }
    else drawTimer = setTimeout(draw, wait);
  }
  edInput.addEventListener("input", () => { lead = "ed"; follow(); });
  function draw() {
    drawTimer = 0;
    if (!on || !P.current) return;
    const t0 = performance.now(), text = edInput.value, again = shownOf === P.current.path;
    shown = text; shownOf = P.current.path;
    let html = "";
    try { html = noteHtml(P.current, text).html; } catch (e) { html = ""; }
    doc.innerHTML = html || `<p class="twin-empty">${esc(T("Empty"))}</p>`;
    // (only to be read here: its own ids would be the reading view's twice; its fields are the source's to change)
    for (const x of doc.querySelectorAll("[id]")) { x.dataset.twinId = x.id; x.removeAttribute("id"); }
    for (const x of doc.querySelectorAll("input, textarea, select, button")) { x.disabled = true; x.tabIndex = -1; }
    for (const x of doc.querySelectorAll("[contenteditable]")) x.removeAttribute("contenteditable");
    marks = [...doc.querySelectorAll("[data-line]")];
    lines = marks.map((el) => Number(el.dataset.line));
    if (doc.querySelector("pre.mermaid")) P.renderMermaid(P.generation, null, doc).then(() => place(), () => {});
    if (doc.querySelector(".pdf-embed")) P.pdfEmbedsSoon();
    took = performance.now() - t0;
    lastDraw = performance.now();
    if (again) place(); else { body.scrollTop = 0; lead = "ed"; place(); }
  }
  P.twinRedraw = () => { if (on) { shown = null; follow(); } };

  // ---------------------------------------------------------------- the same place in both
  /* Where the two meet: a line across both halves, a little under the top (under the toolbar). A source line there at the left
   * is the place in the text; at the right that place is found between the blocks it lies between. */
  const meet = () => pane.getBoundingClientRect().top + 64;
  // the source line (with how far into it) at a height in the window
  function edLineAt(y) {
    const els = edBack.children;
    if (!els.length) return 0;
    let lo = 0, hi = els.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (els[mid].getBoundingClientRect().bottom > y) hi = mid; else lo = mid + 1; }
    const r = els[lo].getBoundingClientRect();
    return lo + (r.height ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0);
  }
  // the last block at the right that begins at or before a line
  function markAt(line) {
    let lo = 0, hi = lines.length - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid] <= line) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    return at;
  }
  const topIn = (el) => el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  /* the source's place, at the right */
  function place() {
    if (!on) return;
    const el = document.scrollingElement || document.documentElement, far = el.scrollHeight - innerHeight;
    if (el.scrollTop <= 2 || !marks.length) { body.scrollTop = 0; return; }
    if (far > 0 && el.scrollTop >= far - 2) { body.scrollTop = body.scrollHeight; return; }
    const y = meet(), line = edLineAt(y), i = markAt(line);
    if (i < 0) { body.scrollTop = 0; return; }
    // (the next block that begins further down: nested blocks begin at the same line as the one they are in)
    let j = i + 1;
    while (j < lines.length && lines[j] <= lines[i]) j++;
    const a = topIn(marks[i]), b = j < marks.length ? topIn(marks[j]) : Math.max(a, topIn(marks[i]) + marks[i].offsetHeight);
    const to = j < marks.length ? lines[j] : lines[i] + Math.max(1, edBack.children.length - lines[i]);
    const into = Math.min(1, Math.max(0, (line - lines[i]) / Math.max(1, to - lines[i])));
    body.scrollTop = a + into * (b - a) - (y - body.getBoundingClientRect().top);
  }
  /* the right side's place, in the source */
  function back() {
    if (!on || !marks.length) return;
    if (body.scrollTop <= 2) { window.scrollTo(0, 0); return; }
    if (body.scrollTop >= body.scrollHeight - body.clientHeight - 2) { window.scrollTo(0, (document.scrollingElement || document.documentElement).scrollHeight); return; }
    const y = meet(), at = y - body.getBoundingClientRect().top + body.scrollTop;
    let lo = 0, hi = marks.length - 1, i = 0; // the last block that begins above the meeting line
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (topIn(marks[mid]) <= at) { i = mid; lo = mid + 1; } else hi = mid - 1; }
    let j = i + 1;
    while (j < lines.length && lines[j] <= lines[i]) j++;
    const a = topIn(marks[i]), b = j < marks.length ? topIn(marks[j]) : a + marks[i].offsetHeight;
    const to = j < marks.length ? lines[j] : edBack.children.length;
    const line = lines[i] + Math.min(1, Math.max(0, (at - a) / Math.max(1, b - a))) * Math.max(1, to - lines[i]);
    const row = edBack.children[Math.min(Math.floor(line), edBack.children.length - 1)];
    if (!row) return;
    const r = row.getBoundingClientRect();
    window.scrollBy({ top: r.top + (line - Math.floor(line)) * r.height - y, behavior: "instant" });
  }
  // (at once: a scroll event comes once a frame at the most)
  addEventListener("scroll", () => { if (on && lead === "ed") place(); }, { passive: true });
  body.addEventListener("scroll", () => { if (on && lead === "twin") back(); }, { passive: true });
  // who leads: the side the hand is on
  for (const ev of ["wheel", "pointerdown", "touchstart"]) {
    addEventListener(ev, (e) => { if (on) lead = e.target instanceof Node && pane.contains(e.target) ? "twin" : "ed"; }, { passive: true, capture: true });
  }
  addEventListener("keydown", (e) => { if (on && !(e.target instanceof Node && pane.contains(e.target))) lead = "ed"; }, true);
  body.addEventListener("keydown", () => { lead = "twin"; });
  body.addEventListener("wheel", (e) => { if (body.scrollHeight <= body.clientHeight) e.preventDefault(); }, { passive: false }); // (nothing to scroll: not the source behind)

  // ---------------------------------------------------------------- clicks
  /* A link leads where it leads in the reading view; a block — a click that did not select — puts the caret at its line, the
   * line at the height the block stood at. */
  pane.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const a = e.target.closest("a");
    e.preventDefault(); e.stopPropagation();
    if (a) {
      if (a.dataset.wiki != null) { post("wikilink", { target: a.dataset.wiki, tab: "own" }); return; }
      const href = a.getAttribute("href");
      if (!href) return;
      if (href.startsWith("#")) {
        const id = decodeURIComponent(href.slice(1)), el = doc.querySelector(`[data-twin-id="${CSS.escape(id)}"]`) || doc.querySelector(`[data-twin-id="${CSS.escape(slugify(id))}"]`);
        if (el) { lead = "twin"; body.scrollTo({ top: topIn(el) - 56, behavior: still() ? "instant" : "smooth" }); }
        return;
      }
      post("link", { href: a.href, tab: "own" });
      return;
    }
    if (!getSelection().isCollapsed) return;
    const block = e.target.closest("[data-line]");
    if (!block || !doc.contains(block)) return;
    const line = Number(block.dataset.line), row = edBack.children[line];
    if (!row || P.lineStarts[line] == null) return;
    edInput.focus({ preventScroll: true });
    edInput.setSelectionRange(P.lineStarts[line], P.lineStarts[line]);
    lead = "ed";
    window.scrollBy({ top: row.getBoundingClientRect().top - block.getBoundingClientRect().top, behavior: "instant" });
  }, true);

  // what the page's other files use of this one
  Object.assign(P, { twinSync: sync });
  P.live({ twinOn: [() => on] });
})();
