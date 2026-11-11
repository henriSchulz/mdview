/* mdview, the page — Search: every note of the folder, as a whole or by its blocks (Henri, 2026-11-11: "eine globale
 * Suchfunktion, sowohl einzelne Blöcke oder Dokument"; he chose proposal 2 of dev/search-lab.html, Spotlight with a look
 * inside). A panel in the middle of the room beside the sidebar: the field, All · Notes · Blocks (Tab), the results at the
 * left in two lines, at the right the note itself, scrolled to what was found, the words marked. ↑ ↓ go through them without
 * opening anything; Enter (a click) opens the note there, Ctrl+Enter in a new tab, Esc closes. It is Go to in a folder window
 * on the desktop (Ctrl+K, the island's search): the browser and a window of one note keep Go to (viewer/chrome.js).
 *
 * The shell finds the notes that have every word and hands over their text (search.rs: the page may not read files); here
 * each is taken apart into the blocks the reading view draws — a heading, a paragraph, an item of a list, a task, code, a
 * formula, a quote or callout, a table — with the line it begins at, so that a block found is the block shown, and the note
 * opens at it (`^line=`, viewer/render.js: scrollToFragment). */
"use strict";
(() => {
  const P = window.MdPage;
  const { DESKTOP, post, T, esc, ICON, SVG_ICON } = P; // viewer/base.js
  const { md } = P; // viewer/markdown.js
  const { stripFrontmatter, stripComments } = P; // viewer/prep.js
  const { scrollToFragment } = P; // viewer/render.js

  const box = document.createElement("div");
  box.id = "search";
  box.className = "ui-popover surface";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", T("Search"));
  box.innerHTML = `<div class="sr-field">${ICON.search}<input type="text" spellcheck="false" autocomplete="off" placeholder="${esc(T("Search all notes"))}">` +
    `<div class="sr-seg" role="tablist">${[["all", "All"], ["notes", "Notes"], ["blocks", "Blocks"]].map(([v, l]) => `<button type="button" role="tab" data-scope="${v}">${esc(T(l))}<i></i></button>`).join("")}</div></div>` +
    `<div class="sr-body"><div class="sr-list" role="listbox"></div><div class="sr-peek"><div class="sr-doc"></div><div class="sr-foot"><span class="sr-where"></span><span class="sr-keys">↵ ${esc(T("open"))} · ⌃↵ ${esc(T("open in new tab"))} · ⇥ ${esc(T("All, Notes, Blocks"))}</span></div></div></div>`;
  document.body.appendChild(box);
  const input = box.querySelector("input"), list = box.querySelector(".sr-list"), peek = box.querySelector(".sr-doc"), where = box.querySelector(".sr-where");

  const S = { scope: "all", q: "", seq: 0, asked: 0, got: null, items: [], hl: 0, shown: "" };
  const shown = () => box.hasAttribute("data-open");
  // where it is: a folder window on the desktop (the shell answers "search"; the browser's host does not: BUGS.md rule 55)
  const here = () => DESKTOP && !!P.folder && !P.folder.quick;

  // ---------------------------------------------------------------- what is asked, and the notes' blocks
  // the words asked for, in small letters: split at spaces, what stands in "quotes" one word (search.rs: words)
  const wordsOf = (q) => String(q).split('"').flatMap((part, i) => (i % 2 ? [part.trim()] : part.split(/\s+/))).map((w) => w.toLowerCase()).filter(Boolean);
  const count = (hay, words) => words.reduce((a, w) => { let c = 0; for (let i = hay.indexOf(w); i >= 0; i = hay.indexOf(w, i + w.length)) c++; return a + c; }, 0);

  // A block's words as they read: the Markdown's marks taken off (a row's two lines)
  function plain(src, kind) {
    let s = src;
    if (kind === "code") s = s.replace(/^\s*(```|~~~).*$/gm, "");
    else if (kind === "math") s = s.replace(/^\s*\$\$\s*$/gm, "");
    else s = s.replace(/^\s{0,3}(#{1,6}\s+|>\s?(\[![^\]]*\][+-]?\s*)?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
      .replace(/^\s*(\|\s*)?:?-{2,}:?(\s*\|\s*:?-{2,}:?)*\s*\|?\s*$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "").replace(/(\*\*|__|~~|==)/g, "").replace(/(^|[^\w*])[*_](?=\S)([^*_]+?)[*_](?!\w)/g, "$1$2").replace(/`/g, "").replace(/\|/g, " ");
    return s.replace(/\s+/g, " ").trim();
  }
  // A note taken apart as the reading view draws it: [{ kind, line, src, text, low, head }] (kept while its text stays)
  const parts = new Map();
  function blocksOf(path, text) {
    const kept = parts.get(path);
    if (kept && kept.text === text) return kept.blocks;
    const fm = stripFrontmatter(text.replace(/\r\n?/g, "\n")), body = stripComments(fm.body), lines = body.split("\n"), blocks = [];
    let toks = [];
    try { toks = md.parse(body, { lineOffset: 0, links: {}, outline: [], depth: 1 }); } catch (e) { toks = []; }
    let head = "";
    const add = (t, kind, done) => {
      if (!t.map) return;
      const src = lines.slice(t.map[0], t.map[1]).join("\n"), words = plain(src, kind);
      if (!words) return;
      blocks.push({ kind, done, line: t.map[0] + fm.offset, text: words, low: (kind === "code" ? src : words).toLowerCase(), head: kind === "heading" ? "" : head });
      if (kind === "heading") head = words;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.level !== 0 || t.nesting === -1) continue;
      if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
        // every item of a list is a block of its own (with what is under it)
        const end = t.type.replace("_open", "_close");
        for (i++; i < toks.length && !(toks[i].level === 0 && toks[i].type === end); i++) {
          const x = toks[i];
          if (x.type !== "list_item_open" || x.level !== 1 || !x.map) continue;
          const first = lines[x.map[0]] || "", task = /^\s*([-*+]|\d+[.)])\s+\[([ xX])\]/.exec(first);
          add(x, task ? "task" : "item", task ? task[2] !== " " : undefined);
        }
      } else if (t.type === "heading_open") add(t, "heading");
      else if (t.type === "paragraph_open") add(t, "text");
      else if (t.type === "fence" || t.type === "code_block") add(t, "code");
      else if (t.type === "math_block") add(t, "math");
      else if (t.type === "blockquote_open") add(t, /^\s*>\s*\[!/.test(lines[t.map ? t.map[0] : 0] || "") ? "callout" : "quote");
      else if (t.type === "table_open") add(t, "table");
      else if (t.block && t.map && t.type !== "hr" && t.type !== "front_matter") add(t, "text");
    }
    parts.set(path, { text, blocks });
    return blocks;
  }
  const SIGNS = { note: "note", heading: "title", text: "para", item: "list", task: "todo", code: "source", math: "sigma", quote: "quote", callout: "info", table: "row" };
  const sign = (k) => (k === "spark" ? SVG_ICON.spark : ICON[SIGNS[k] || k] || ICON.note);

  // the folder's notes, as the sidebar has them (a name, where it lies, when it was opened)
  function folderNotes() {
    const out = new Map(), root = P.folder ? P.folder.root + "/" : "";
    const walk = (n) => { if (!n) return; for (const x of n.notes || []) if (!x.pdf) out.set(x.path, { path: x.path, name: String(x.title || x.name || "").replace(/\.(md|markdown|mdown)$/i, ""), dir: x.path.startsWith(root) ? x.path.slice(root.length).replace(/\/?[^/]*$/, "") : "", opened: x.opened || 0, mtime: x.mtime || 0 }); for (const d of n.dirs || []) walk(d); };
    walk(P.folder && (P.folder.all || P.folder.tree));
    return out;
  }
  const nameOf = (path) => path.replace(/^.*\//, "").replace(/\.(md|markdown|mdown)$/i, "");

  // ---------------------------------------------------------------- the words marked
  function mark(text, words) {
    const low = text.toLowerCase(), r = [];
    for (const w of words) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) r.push([i, i + w.length]);
    r.sort((a, b) => a[0] - b[0]);
    let out = "", at = 0;
    for (const [a, b] of r) { if (a < at) continue; out += esc(text.slice(at, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>"; at = b; }
    return out + esc(text.slice(at));
  }
  // a line cut so that the first word found shows near its beginning
  function snippet(text, words, lead = 24) {
    const low = text.toLowerCase();
    const first = Math.min(...words.map((w) => { const i = low.indexOf(w); return i < 0 ? Infinity : i; }));
    if (!isFinite(first) || first <= lead) return mark(text.slice(0, 400), words);
    const sp = text.lastIndexOf(" ", first - lead);
    return sp < 0 ? mark(text.slice(0, 400), words) : "…" + mark(text.slice(sp + 1, sp + 400), words);
  }
  // … and in the note at the right, as find marks (the CSS Custom Highlight API: the note's text untouched)
  const canHighlight = typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights;
  function markPeek(words) {
    if (!canHighlight) return;
    const ranges = [];
    const walker = document.createTreeWalker(peek, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest(".katex-mathml, style, script") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = walker.nextNode(); n && ranges.length < 2000; n = walker.nextNode()) {
      const low = n.data.toLowerCase();
      for (const w of words) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) { const r = new Range(); r.setStart(n, i); r.setEnd(n, Math.min(n.data.length, i + w.length)); ranges.push(r); }
    }
    if (ranges.length) CSS.highlights.set("search-hit", new Highlight(...ranges)); else CSS.highlights.delete("search-hit");
  }

  // ---------------------------------------------------------------- the results
  function build() {
    const raw = input.value.trim(), words = wordsOf(raw), notes = folderNotes(), items = [];
    const head = (t) => items.push({ kind: "head", text: t });
    let nNotes = 0, nBlocks = 0;
    if (!words.length) {
      head(T("Recent"));
      [...notes.values()].sort((a, b) => b.opened - a.opened || b.mtime - a.mtime).slice(0, 10)
        .forEach((n) => items.push({ kind: "note", path: n.path, name: n.name, top: esc(n.name), sub: esc(n.dir || P.folder.name), line: -1 }));
    } else if (S.got) {
      const found = [], blocks = [];
      for (const n of S.got.notes) {
        const info = notes.get(n.path) || { name: nameOf(n.path), dir: "" };
        const own = info.name.toLowerCase(), titled = (b) => b.kind === "heading" && b.text.toLowerCase() === own; // (the note's name as its first heading: the note, not a block of it)
        const all = blocksOf(n.path, n.text), mine = all.filter((b) => !titled(b) && words.every((w) => b.low.includes(w)));
        const inName = words.filter((w) => info.name.toLowerCase().includes(w)).length;
        const any = mine[0] || all.find((b) => words.some((w) => b.low.includes(w)));
        found.push({ kind: "note", path: n.path, name: info.name, line: any ? any.line : -1, text: n.text, top: mark(info.name, words),
          sub: inName || !any ? esc([info.dir, T(count(n.text.toLowerCase(), words) === 1 ? "1 match" : "{0} matches", count(n.text.toLowerCase(), words))].filter(Boolean).join(" · ")) : snippet(any.text, words, 12) });
        for (const b of mine) blocks.push({ kind: b.kind, path: n.path, name: info.name, line: b.line, text: n.text, done: b.done, score: count(b.low, words) + (b.kind === "heading" ? 3 : 0) + (inName ? 1 : 0), mtime: n.mtime,
          top: esc(info.name) + (b.head && b.head.toLowerCase() !== own ? ` <span class="sr-head">› ${esc(b.head)}</span>` : ""), sub: snippet(b.text, words, 16) });
      }
      blocks.sort((a, b) => b.score - a.score || b.mtime - a.mtime || a.line - b.line);
      nNotes = S.got.found; nBlocks = blocks.length;
      if (S.scope !== "blocks" && found.length) { head(T("Notes")); items.push(...found.slice(0, S.scope === "all" ? 5 : found.length)); }
      if (S.scope !== "notes" && blocks.length) { head(T("Blocks")); items.push(...blocks.slice(0, 200)); }
      if (S.scope === "all") {
        head(T("Commands"));
        items.push({ kind: "cmd", icon: "plus", top: esc(T("New Note “{0}”", raw)), run: () => { close(); P.openNewNote(); } });
        if (P.current) items.push({ kind: "cmd", icon: "search", top: esc(T("Find “{0}” in this note", raw)), run: () => { close(); P.openFind(); P.findInput.value = raw; P.runFind(raw, true); } });
        if (document.body.hasAttribute("data-ai")) items.push({ kind: "cmd", icon: "spark", top: esc(T("Ask the assistant about “{0}”", raw)), run: () => { close(); document.getElementById("ai-bubble")?.click(); } });
      }
    }
    S.items = items;
    const counts = { notes: words.length && S.got ? nNotes : "", blocks: words.length && S.got ? nBlocks : "" };
    for (const b of box.querySelectorAll(".sr-seg button")) { b.setAttribute("aria-selected", String(b.dataset.scope === S.scope)); b.querySelector("i").textContent = counts[b.dataset.scope] ?? ""; }
    let html = "";
    items.forEach((it, i) => {
      if (it.kind === "head") { html += `<div class="sr-h">${esc(it.text)}</div>`; return; }
      const s = it.kind === "cmd" ? sign(it.icon) : sign(it.kind === "task" && it.done ? "todo" : it.kind);
      html += `<div class="sr-row${it.kind === "cmd" ? " cmd" : ""}" role="option" data-i="${i}">${s}<b>${it.top}</b>${it.sub != null ? `<small>${it.sub}</small>` : ""}</div>`;
    });
    if (words.length && S.got && !items.some((it) => it.kind !== "head" && it.kind !== "cmd")) // (nothing, or only notes where the words stand apart, and Blocks chosen)
      html = `<div class="sr-none">${esc(S.got.notes.length ? T("No single block has all of “{0}”", raw) : T("No note has “{0}”", raw))}</div>` + html;
    list.innerHTML = html;
    const first = items.findIndex((it) => it.kind !== "head");
    pick(first < 0 ? -1 : first, true);
  }

  // the row chosen, and the note it is in at the right
  let peekTimer = 0;
  function pick(i, fresh = false) {
    S.hl = i;
    for (const r of list.querySelectorAll(".sr-row")) r.classList.toggle("hl", Number(r.dataset.i) === i);
    const row = list.querySelector(".sr-row.hl");
    if (row && !fresh) row.scrollIntoView({ block: "nearest" });
    else if (fresh) list.scrollTop = 0;
    cancelAnimationFrame(peekTimer);
    peekTimer = requestAnimationFrame(() => show(S.items[i]));
  }
  function show(it) {
    if (!it || it.kind === "cmd" || it.kind === "head") { peek.innerHTML = ""; where.textContent = ""; S.shown = ""; box.classList.toggle("sr-empty", true); return; }
    box.classList.remove("sr-empty");
    const text = it.text ?? reads.get(it.path);
    if (text == null) { ask(it.path); peek.innerHTML = ""; S.shown = ""; return; }
    const key = it.path + "\n" + input.value;
    if (S.shown !== key) {
      peek.innerHTML = P.previewOf(it.path, text, { whole: true, lines: true }).html || `<p class="sr-none">${esc(T("Empty"))}</p>`;
      S.shown = key;
      markPeek(wordsOf(input.value));
    }
    const rel = it.path.startsWith(P.folder.root + "/") ? it.path.slice(P.folder.root.length + 1) : it.path;
    where.textContent = rel.replace(/\.(md|markdown|mdown)$/i, "").split("/").join(" › ");
    for (const x of peek.querySelectorAll(".sr-at")) x.classList.remove("sr-at");
    let at = null;
    if (it.line >= 0) for (const x of peek.querySelectorAll("[data-line]")) { if (Number(x.dataset.line) <= it.line) at = x; else break; }
    if (at && it.kind !== "note") at.classList.add("sr-at");
    peek.scrollTop = 0;
    if (at) peek.scrollTop = Math.max(0, at.getBoundingClientRect().top - peek.getBoundingClientRect().top - peek.clientHeight * 0.28);
  }
  // a note without a search's text (the recent ones): read by the shell, once (note-read)
  const reads = new Map();
  let readSeq = 0;
  function ask(path) { if (reads.has(path)) return; reads.set(path, null); post("note-read", { path, id: "search:" + ++readSeq + ":" + path }); }
  function read(id, data) {
    const path = String(id).replace(/^search:\d+:/, "");
    reads.set(path, data && typeof data.text === "string" ? data.text : "");
    const it = S.items[S.hl];
    if (shown() && it && it.path === path) show(it);
  }

  // ---------------------------------------------------------------- asking the shell, and what it says
  let askTimer = 0;
  function search() {
    clearTimeout(askTimer);
    const raw = input.value.trim();
    if (!wordsOf(raw).length) { S.got = null; build(); return; }
    askTimer = setTimeout(() => { S.asked = ++S.seq; post("search", { q: raw, id: S.asked }); }, 90);
  }
  function got(id, data) {
    if (id !== S.asked || !shown()) return; // (an answer to a question asked before the last one)
    S.got = data && Array.isArray(data.notes) ? data : { notes: [], found: 0 };
    build();
  }

  // ---------------------------------------------------------------- opening, and the keys
  function open(it, tab) {
    if (!it || it.kind === "head") return;
    if (it.kind === "cmd") return it.run();
    close();
    const cur = P.current && (P.current.real || P.current.path);
    const fragment = it.line >= 0 ? "^line=" + it.line : "";
    if (!tab && cur && (cur === it.path || (P.current.path === it.path))) {
      // the note on screen: only the way to the place
      if (it.line < 0) return;
      if (P.inSource()) P.goToLine(it.line); else scrollToFragment(fragment, true);
      return;
    }
    post("note", { path: it.path, tab, fragment });
  }
  function move(d) {
    const n = S.items.length;
    if (!n) return;
    let i = S.hl;
    for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (S.items[i].kind !== "head") break; }
    pick(i);
  }
  function setScope(v) { S.scope = v; build(); input.focus({ preventScroll: true }); }
  const SCOPES = ["all", "notes", "blocks"];
  input.addEventListener("input", search);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // (the note's keys stay the note's: BUGS.md rule 1)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter") { e.preventDefault(); open(S.items[S.hl], e.ctrlKey || e.metaKey); }
    else if (e.key === "Tab") { e.preventDefault(); setScope(SCOPES[(SCOPES.indexOf(S.scope) + (e.shiftKey ? 2 : 1)) % 3]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  box.querySelector(".sr-seg").addEventListener("mousedown", (e) => { const b = e.target.closest && e.target.closest("button"); if (b) { e.preventDefault(); setScope(b.dataset.scope); } });
  // the pointer moved over a row chooses it (not a row that came under a pointer at rest, as the list scrolls)
  list.addEventListener("mousemove", (e) => { if (!e.movementX && !e.movementY) return; const r = e.target.closest && e.target.closest(".sr-row"); if (r && Number(r.dataset.i) !== S.hl) pick(Number(r.dataset.i)); });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // (the field keeps the keys)
  list.addEventListener("click", (e) => { const r = e.target.closest && e.target.closest(".sr-row"); if (r) open(S.items[Number(r.dataset.i)], e.ctrlKey || e.metaKey); });
  // the wheel over it is its own (BUGS.md rule 2)
  box.addEventListener("wheel", (e) => {
    const sc = e.target.closest && e.target.closest(".sr-list, .sr-doc");
    if (!sc || sc.scrollHeight <= sc.clientHeight) e.preventDefault();
  }, { passive: false });
  // a press beside it closes it, and does nothing else (as a menu)
  document.addEventListener("mousedown", (e) => {
    if (!shown() || box.contains(e.target) || (e.target.closest && e.target.closest('[data-act="palette"], [data-act="find"], #pal-btn'))) return;
    close(); e.preventDefault(); e.stopPropagation();
  }, true);

  function openSearch() {
    if (P.closeFind) P.closeFind(false);
    box.dataset.open = "";
    input.value = ""; S.got = null; S.scope = "all"; S.shown = ""; reads.clear();
    build();
    input.focus({ preventScroll: true });
    post("search", { q: "", id: -1 }); // (the shell reads the notes now, not at the first key; its answer is nothing to draw)
  }
  function close() {
    if (!shown()) return false;
    delete box.dataset.open;
    clearTimeout(askTimer); cancelAnimationFrame(peekTimer);
    peek.innerHTML = ""; list.innerHTML = ""; S.shown = "";
    if (canHighlight) CSS.highlights.delete("search-hit");
    return true;
  }

  Object.assign(P, { searchHere: here, searchShown: shown, openSearch, closeSearch: close, searchGot: got, searchRead: read });
})();
