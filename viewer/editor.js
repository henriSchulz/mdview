/* mdview, the page — the source editor: a textarea under a coloured copy of its text, saving,
 * and where a place in the text is on screen. */
"use strict";
(() => {
  const P = window.MdPage;
  const { content, post, esc } = P; // viewer/base.js
  const { md } = P; // viewer/markdown.js
  const { stripFrontmatter, stripComments, viewPut } = P; // viewer/prep.js
  const { reducedMotion } = P; // viewer/render.js
  const { toolbar } = P; // viewer/chrome.js

  // A plain <textarea> holds the text (native caret, undo, IME); its glyphs are
  // transparent. #ed-back on top shows the same text, one <div class="ln"> per
  // source line, with Markdown syntax coloured. Same font and width in both, so
  // they wrap alike; the backdrop gives the height and the page scrolls.
  const AUTOSAVE_MS = 800;
  const editor = document.createElement("section");
  editor.id = "editor";
  editor.innerHTML =
    '<div id="ed-wrap"><textarea id="ed-input" spellcheck="false" autocomplete="off" autocapitalize="off"' +
    ' aria-label="Markdown source" placeholder="Start writing…"></textarea><div id="ed-back" aria-hidden="true"></div></div>';
  content.after(editor);
  const edWrap = editor.firstChild;
  const edInput = edWrap.firstChild;
  const edBack = edWrap.lastChild;
  const modeSeg = toolbar.querySelector(".seg");
  // A host where a note is only read (a shared one, in the browser: MdHost.reading) has no modes
  // to switch between, and nothing to insert or format.
  const READING = !!(window.MdHost && window.MdHost.reading);
  if (READING) { modeSeg.hidden = true; for (const act of ["panel", "share"]) toolbar.querySelector(`[data-act="${act}"]`).hidden = true; }
  const MODES = ["edit", "active", "read"]; // as in the toolbar
  function showMode() {
    modeSeg.style.setProperty("--i", MODES.indexOf(P.mode));
    for (const b of modeSeg.querySelectorAll(".seg-btn")) b.setAttribute("aria-checked", String(b.dataset.mode === P.mode));
  }

  /* A change of mode asked for by hand. In a long note it lays the whole note out anew, and the
   * page stands still for that long (0.2 s and more): so the switch answers first — its thumb is on
   * its way, the chosen mode's sign turns into a wheel (it turns on the compositor, also while the
   * page is busy) — and the change itself begins two frames later. A short note changes at once. */
  const HEAVY = 6000; // characters of Markdown from which the change is felt
  let switching = 0;
  function switchMode(next) {
    if (next === P.mode || !P.current || switching) return;
    if (P.current.kind === "pdf" || !P.current.text || P.current.text.length < HEAVY || (next === "active" && P.current.error) || (next === "edit" && P.current.readonly)) { P.setMode(next); return; }
    const btn = modeSeg.querySelector(`.seg-btn[data-mode="${next}"]`);
    modeSeg.style.setProperty("--i", MODES.indexOf(next));
    for (const b of modeSeg.querySelectorAll(".seg-btn")) b.setAttribute("aria-checked", String(b === btn));
    btn.classList.add("busy");
    const done = () => { cancelAnimationFrame(switching); switching = 0; requestAnimationFrame(() => requestAnimationFrame(() => { btn.classList.remove("busy"); showMode(); })); };
    switching = requestAnimationFrame(() => { switching = requestAnimationFrame(() => {
      try { P.setMode(next); } finally {
        // (the active mode's first use fetches its scripts: the wheel turns until the mode is there)
        if (P.mode === next) done();
        else { const t0 = performance.now(), wait = () => { if (P.mode === next || performance.now() - t0 > 6000) done(); else switching = requestAnimationFrame(wait); }; wait(); }
      }
    }); });
  }

  let edPath = null;     // file the editor holds; null = nothing loaded
  let edFresh = false;   // text was just loaded: put the caret where the reader was
  let edReveal = false;  // caret was placed by the caller (new note): scroll to it
  let edKeys = [];       // per line: class + html currently in #ed-back
  let lineStarts = [0];  // offset of every line in the textarea value
  let savedText = null;  // what is on disk as far as we know
  let saveTimer = 0, swapTimer = 0;

  // --- syntax colours (line based; text content always equals the source)
  const span = (cls, html) => `<span class="m-${cls}">${html}</span>`;
  const EMPH = { "**": "b", "__": "b", "~~": "s", "==": "mark" };
  const INLINE = new RegExp([
    /\\./,                                              // escape
    /(`+)(?:(?!\1).)+?\1/,                              // 1: code span
    /!?\[\[[^\[\]]+?\]\]/,                              // wikilink, embed
    /!?\[[^\]]*\]\([^)]*\)/,                            // link, image
    /(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\2/,              // 2, 3: bold, strike, highlight
    /\*(?=\S)(.+?)(?<=\S)\*/,                           // 4: italic
    /(?<![\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/, // 5: italic
    /\$(?=[^\s$])[^$]*?(?<=\S)\$(?!\d)/,                // math
    /%%.*?%%/,                                          // comment
    /<\/?[a-zA-Z][^>]*>/,                               // html tag
    /(?<![\p{L}\p{N}/#&])#[\p{L}\p{N}_\-/]+/,           // tag
    /https?:\/\/[^\s<>)\]]+/,                           // bare url
  ].map((r) => r.source).join("|"), "gu");
  function hlInline(s) {
    let out = "", last = 0;
    for (const m of s.matchAll(INLINE)) {
      const t = m[0];
      out += esc(s.slice(last, m.index));
      last = m.index + t.length;
      if (t[0] === "\\") out += span("dim", "\\") + esc(t.slice(1));
      else if (m[1]) out += span("code", esc(t));
      else if (m[2]) { const d = span("dim", esc(m[2])); out += span(EMPH[m[2]], d + hlInline(m[3]) + d); }
      else if (m[4] != null) out += span("i", span("dim", "*") + hlInline(m[4]) + span("dim", "*"));
      else if (m[5] != null) out += span("i", span("dim", "_") + hlInline(m[5]) + span("dim", "_"));
      else if (t.startsWith("%%")) out += span("comment", esc(t));
      else if (t[0] === "$") out += span("math", esc(t));
      else if (t[0] === "<") out += span("html", esc(t));
      else if (t[0] === "#") out += /^#[\d/_-]+$/.test(t) ? esc(t) : span("tag", esc(t));
      else if (t[0] === "h") out += span("url", esc(t));
      else if (t.endsWith("]]")) out += span("link", esc(t));
      else { const i = t.indexOf("]("); out += span("link", esc(t.slice(0, i + 1))) + span("dim", esc(t.slice(i + 1))); }
    }
    return out + esc(s.slice(last));
  }
  // -> [html, line class, next state]. States: "start" (line 0), "" (text),
  // "fm" (frontmatter), "math" ($$ block), or the fence that opened a code block.
  function hlLineRaw(line, st) {
    let m;
    if (st === "start" && /^---[ \t]*$/.test(line)) return [span("dim", esc(line)), "meta", "fm"];
    if (st === "fm") {
      if (/^(---|\.\.\.)[ \t]*$/.test(line)) return [span("dim", esc(line)), "meta", ""];
      m = /^(\s*(?:- )?[^\s:#][^:]*?)(:)(\s.*|)$/.exec(line);
      return [m ? span("key", esc(m[1])) + span("dim", ":") + esc(m[3]) : esc(line), "meta", "fm"];
    }
    if (st[0] === "`" || st[0] === "~") {
      m = /^\s*(`{3,}|~{3,})[ \t]*$/.exec(line);
      return m && m[1][0] === st[0] && m[1].length >= st.length
        ? [span("dim", esc(line)), "code code-end", ""]
        : [esc(line), "code", st];
    }
    if (st === "math") return [span("math", esc(line)), "", line.trim().endsWith("$$") ? "" : "math"];
    if ((m = /^(\s*)(`{3,}(?=[^`]*$)|~{3,})(.*)$/.exec(line))) {
      return [span("dim", esc(m[1] + m[2])) + span("lang", esc(m[3])), "code code-start", m[2]];
    }
    if (/^ {0,3}\$\$/.test(line)) {
      const rest = line.trim().slice(2);
      return [span("math", esc(line)), "", rest.length >= 2 && rest.endsWith("$$") ? "" : "math"];
    }
    if ((m = /^( {0,3}#{1,6})([ \t].*|)$/.exec(line))) return [span("h", span("dim", m[1]) + hlInline(m[2])), "", ""];
    if (/^ {0,3}([-*_])([ \t]*\1){2,}[ \t]*$/.test(line)) return [span("dim", esc(line)), "", ""];
    let out = "", rest = line, cls = "";
    if ((m = /^\s*(?:>[ \t]?)+/.exec(rest))) {
      out += span("quote", esc(m[0]));
      rest = rest.slice(m[0].length);
      cls = "quote";
      if ((m = /^\[![\w-]+\][+-]?/.exec(rest))) { out += span("callout", esc(m[0])); rest = rest.slice(m[0].length); }
    }
    if ((m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[.\](?=\s|$))?/.exec(rest))) {
      out += m[1] + span("list", esc(m[2])) + m[3] + (m[4] ? span("task", esc(m[4])) : "");
      rest = rest.slice(m[0].length);
    }
    return [out + hlInline(rest), cls, ""];
  }
  const hlCache = new Map();
  function hlLine(line, st) {
    const key = st + "\n" + line;
    let r = hlCache.get(key);
    if (!r) {
      if (hlCache.size > 20000) hlCache.clear();
      hlCache.set(key, r = hlLineRaw(line, st));
    }
    return r;
  }

  // Repaint the backdrop; only the lines that changed are touched.
  function paint(text) {
    const lines = text.split("\n"), n = lines.length;
    const keys = new Array(n), html = new Array(n), cls = new Array(n);
    lineStarts = new Array(n);
    let st = "start", off = 0;
    for (let i = 0; i < n; i++) {
      lineStarts[i] = off;
      off += lines[i].length + 1;
      const r = hlLine(lines[i], st);
      html[i] = r[0];
      cls[i] = r[1];
      keys[i] = r[1] + "\n" + r[0];
      st = r[2];
    }
    const old = edKeys, max = Math.min(old.length, n);
    let a = 0, b = 0;
    while (a < max && old[a] === keys[a]) a++;
    while (b < max - a && old[old.length - 1 - b] === keys[n - 1 - b]) b++;
    if (!a && !b) edBack.textContent = "";
    else for (let i = old.length - b - 1; i >= a; i--) edBack.children[i].remove();
    const frag = document.createDocumentFragment();
    for (let i = a; i < n - b; i++) {
      const d = document.createElement("div");
      d.className = cls[i] ? "ln " + cls[i] : "ln";
      d.innerHTML = html[i] || "<br>";
      frag.appendChild(d);
    }
    edBack.insertBefore(frag, edBack.children[a] || null);
    edKeys = keys;
  }
  function setEditorText(text) {
    edInput.value = text;
    paint(text);
  }

  // --- geometry: textarea offsets -> backdrop DOM
  function lineOf(offset) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  function locate(offset) {
    const li = lineOf(offset), el = edBack.children[li];
    let rem = offset - lineStarts[li], last = null;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (rem <= n.data.length) return [n, rem];
      rem -= n.data.length;
      last = n;
    }
    return last ? [last, last.data.length] : [el, 0];
  }
  function rangeOf(start, end) {
    const r = new Range();
    r.setStart(...locate(start));
    r.setEnd(...locate(end));
    return r;
  }
  function revealCaret() {
    if (P.mode !== "edit") return;
    const pos = edInput.selectionDirection === "backward" ? edInput.selectionStart : edInput.selectionEnd;
    const r = rangeOf(pos, pos).getClientRects()[0] || edBack.children[lineOf(pos)].getBoundingClientRect();
    const top = 64 + P.topRoom(), bottom = innerHeight - 48;
    if (r.top < top) window.scrollBy({ top: r.top - top, behavior: "instant" });
    else if (r.bottom > bottom) window.scrollBy({ top: r.bottom - bottom, behavior: "instant" });
  }
  function captureEditAnchor() {
    const els = edBack.children;
    if (!els.length || window.scrollY < 4) return { line: null, y: 0 };
    let lo = 0, hi = els.length - 1; // first line that reaches below the top edge
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid].getBoundingClientRect().bottom > 0) hi = mid; else lo = mid + 1;
    }
    const r = els[lo].getBoundingClientRect();
    return { line: lo, top: r.top, height: r.height, y: window.scrollY };
  }
  function goToLine(line) {
    const el = edBack.children[line];
    if (!el) return;
    edInput.focus({ preventScroll: true });
    edInput.setSelectionRange(lineStarts[line], lineStarts[line]);
    el.scrollIntoView({ behavior: reducedMotion() ? "instant" : "smooth", block: "start" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1200);
  }
  function outlineOf(text) {
    const fm = stripFrontmatter(text);
    const env = { lineOffset: fm.offset, links: {}, outline: [], depth: 0 };
    md.parse(stripComments(fm.body), env);
    return env.outline;
  }

  // --- saving: automatic, shortly after the last keystroke
  const dirty = () => edPath != null && edInput.value !== savedText;
  let saveSeq = 0; // counts the saves sent; the application says which one it had when it read the file (render)
  // Some time after a save: does the file say what the editor holds? (An error is logged, nothing else.)
  let verifyTimer = 0;
  function verifySoon() {
    clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      if (P.mode !== "active" || MdActive.view.dirty) return;
      const lost = MdActive.view.verify();
      if (lost) { console.error("mdview: " + lost); post("log", { text: lost }); }
    }, 3000);
  }
  /* The note's text as the source editor has it now. The file as it is to be (raw) follows, its
   * line ends kept — the views of a note with pages are made from it, and the active mode showed
   * the note as it had been before the source was edited, until it was read anew. */
  function sourceIs(p, text) {
    p.text = text;
    p.raw = /\r\n/.test(p.raw || "") ? text.replace(/\n/g, "\r\n") : text;
    p._view = null;
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (P.mode === "active" && P.leaving) window.MdActive?.dialog?.finish(); // a dialog still open: its content counts
    if (window.MdActive?.view?.dirty) { // edits made in the active mode: the file as it is to be, byte for byte
      const shown = MdActive.view.payload;
      shown.raw = MdActive.view.take();
      shown.text = shown.raw.replace(/\r\n?/g, "\n");
      const p = viewPut(shown); // (a page of a note: put back into the note's text)
      p.error = null;
      P.trailPush(p.path, p.text);
      post("save", { text: p.raw, path: p.path, exact: true, seq: ++saveSeq });
      P.docSync(); // (its properties may say another ground or width now, and the panel counts anew)
      verifySoon();
      return;
    }
    if (!dirty()) return;
    savedText = edInput.value;
    if (P.current && P.current.path === edPath) { sourceIs(P.current, savedText); P.current.error = null; P.trailPush(edPath, savedText); }
    post("save", { text: savedText, path: edPath, seq: ++saveSeq });
    P.docSync();
  }
  function flush(thenClose) {
    // the window is closing over a dialog with changes in it: they are not the document's yet — ask
    if (thenClose && P.mode === "active" && window.MdActive?.dialog?.changed) {
      post("closehold");
      MdActive.dialog.ask().then((how) => {
        if (how === "cancel") return;
        MdActive.dialog.close(how === "apply" ? "done" : "cancel");
        flushSave();
        post("close");
      });
      return;
    }
    window.MdBoard?.leave?.();
    flushSave();
    if (thenClose) post("close");
  }

  // what the page's other files use of this one
  Object.assign(P, { AUTOSAVE_MS, editor, edWrap, edInput, edBack, READING, MODES, showMode, switchMode,
    paint, setEditorText, rangeOf, revealCaret, captureEditAnchor, goToLine, outlineOf, dirty, sourceIs,
    flushSave, flush });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    edPath: [() => edPath, (v) => { edPath = v; }],
    edFresh: [() => edFresh, (v) => { edFresh = v; }],
    edReveal: [() => edReveal, (v) => { edReveal = v; }],
    lineStarts: [() => lineStarts],
    savedText: [() => savedText, (v) => { savedText = v; }],
    saveTimer: [() => saveTimer, (v) => { saveTimer = v; }],
    swapTimer: [() => swapTimer, (v) => { swapTimer = v; }],
    saveSeq: [() => saveSeq, (v) => { saveSeq = v; }],
  });
})();
