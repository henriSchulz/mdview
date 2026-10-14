/* mdview, the page — a note's text before it is rendered: frontmatter and comments taken off,
 * the pages inside a note (parsed, shown one at a time, put back into the file's text), and
 * the properties shown above the note. */
"use strict";
(() => {
  const P = window.MdPage;
  const { post, T, esc, ICON, DECO_COLORS } = P; // viewer/base.js
  const { md, safeHtml } = P; // viewer/markdown.js

  const FM_RE = /^---[ \t]*\n(?:([\s\S]*?)\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/;
  function stripFrontmatter(text) {
    const m = FM_RE.exec(text);
    if (!m) return { body: text, props: null, offset: 0 };
    let props;
    try {
      props = m[1] ? jsyaml.load(m[1]) : {};
    } catch (e) {
      return { body: text, props: null, offset: 0 };
    }
    if (props !== null && typeof props !== "object") return { body: text, props: null, offset: 0 };
    return { body: text.slice(m[0].length), props: props || {}, offset: (m[0].match(/\n/g) || []).length };
  }
  /* %% comments %% are blank to the parser (their line breaks stay: the lines keep their numbers).
   * Not what stands in code: there "%%" is the code's — a cell magic, a format string — and two
   * of them in two code blocks would swallow everything between them. */
  const stripComments = (text) => {
    const next = /%%|^ {0,3}(?:(`{3,})[^`\n]*|(~{3,})[^\n]*)$|(`+)/gm;
    let out = "", at = 0, m;
    while ((m = next.exec(text))) {
      let end;
      if (m[0] === "%%") {
        const close = text.indexOf("%%", m.index + 2);
        if (close < 0) break; // (never closed: text)
        end = close + 2;
        out += text.slice(at, m.index) + text.slice(m.index, end).replace(/[^\n]/g, "");
      } else {
        const run = m[1] || m[2] || m[3];
        if (m[3]) { // code in the line: to the same run of backticks, within its paragraph
          const stop = text.indexOf("\n\n", m.index), close = new RegExp("(?<!`)" + run + "(?!`)", "g");
          close.lastIndex = m.index + run.length;
          const c = close.exec(text);
          end = c && (stop < 0 || c.index < stop) ? c.index + run.length : m.index + run.length;
        } else { // a fence: to the line that closes it, or the end
          const close = new RegExp("^ {0,3}" + run[0] + "{" + run.length + ",}[ \\t]*$", "gm");
          close.lastIndex = next.lastIndex;
          const c = close.exec(text);
          end = c ? c.index + c[0].length : text.length;
        }
        out += text.slice(at, end);
      }
      at = end;
      next.lastIndex = end;
    }
    return out + text.slice(at);
  };

  /* ------------------------------------------------------------ pages in a note
   * A note can hold pages of its own. In the file — one Markdown file, as ever — a page is what
   * stands between two comment lines:
   *
   *     <!-- page: Meeting notes -->
   *     …
   *     <!-- /page -->
   *
   * (any other program shows that text where it stands). Here the page is a line with its name on
   * the page it lies on; opened, it is shown alone, and edited as a note of its own — the text
   * around it in the file is not touched by that. Pages can lie in pages.
   *
   * So what is shown and edited is a view of the file: a page's own text, each page in it one
   * line, <!-- page: Name #p3 --> (the id says which). Saved, the view is put back into the file.
   * A note without pages is its own view: nothing here changes anything for it.
   *
   * The tree: { id, title, open, close (the comment lines as written), lead, trail (the empty
   * lines after the first and before the second), items: [a line | a page] }; the note itself is
   * the root (id null). Lines keep their own ends (a "\r" before the "\n" stays on the line). */
  /* How a page's line looks on the page it lies on — a word after "page": a plain row (nothing),
   * or a card (a cell of a list) — and, after that, one of the theme's colours:
   *   <!-- page card: Name -->   <!-- page card blue: Name -->   <!-- page green: Name -->
   * Three more show what is on the page: sheet (a small sheet of paper beside its name and how
   * its text begins), preview (the sheet large, the name under it) and widget (a tile with its
   * tasks, the pages in it, or its text). A link to another note is a row or a card. */
  const CALLOUT_STYLES = ["tip", "label"]; // (beside the box, which needs no name)
  const PAGE_STYLES = ["row", "card", "sheet", "preview", "widget"], LINK_STYLES = ["row", "card"];
  const PAGE_OPEN = /^ {0,3}<!--\s*page(?:\s+([a-z]+(?:\s+[a-z]+)?))?\s*:\s*(.*?)\s*-->\s*$/, PAGE_CLOSE = /^ {0,3}<!--\s*\/page\s*-->\s*$/, PAGE_ROW = /^ {0,3}<!--\s*page(?:\s+([a-z]+(?:\s+[a-z]+)?))?\s*:\s*(.*?)\s*#([a-z]\d+)\s*-->\s*$/;
  const pageLook = (words) => { const [a, b] = String(words || "").split(/\s+/), style = PAGE_STYLES.includes(a) ? a : "row", color = [a, b].find((x) => DECO_COLORS.includes(x)) || ""; return { style, color }; };
  const pageWords = (look) => [look.style === "row" ? "" : look.style, look.color].filter(Boolean).join(" ");
  const pageMark = (look, title, id = "") => `<!-- page${pageWords(look) ? " " + pageWords(look) : ""}: ${title}${id ? " #" + id : ""} -->`;
  const pageRow = (page, eol = "") => pageMark(pageLook(page.look), page.title, page.id) + eol;
  let pageFresh = 0; // (pages made here, until the file is read anew: x1, x2 …)
  function parsePages(raw) {
    const root = { id: null, title: "", items: [], byId: new Map() };
    const lines = raw.split("\n"), stack = [root];
    let fence = null, n = 0;
    for (const line of lines) {
      const text = line.replace(/\r$/, ""), top = stack[stack.length - 1];
      const f = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (f && !fence) fence = f[1]; else if (f && fence && f[1][0] === fence[0] && f[1].length >= fence.length && !text.slice(f[0].length).trim()) fence = null;
      const open = !fence && !PAGE_ROW.test(text) ? PAGE_OPEN.exec(text) : null;
      if (open) { stack.push({ id: "p" + ++n, title: open[2], look: open[1] || "", open: line, close: null, lead: [], trail: [], items: [], lines: [line] }); continue; }
      if (!fence && PAGE_CLOSE.test(text) && stack.length > 1) {
        const page = stack.pop();
        page.close = line;
        while (page.items.length && typeof page.items[0] === "string" && !page.items[0].trim()) page.lead.push(page.items.shift());
        while (page.items.length && typeof page.items[page.items.length - 1] === "string" && !page.items[page.items.length - 1].trim()) page.trail.unshift(page.items.pop());
        delete page.lines;
        stack[stack.length - 1].items.push(page);
        continue;
      }
      top.items.push(line);
    }
    // a page that is never closed is no page: its lines are the text they are
    while (stack.length > 1) { const open = stack.pop(), flat = (x) => (typeof x === "string" ? [x] : [x.open, ...x.lead, ...x.items.flatMap(flat), ...x.trail, x.close]); stack[stack.length - 1].items.push(open.open, ...open.items.flatMap(flat)); }
    const index = (page) => { for (const x of page.items) if (typeof x !== "string") { root.byId.set(x.id, x); x.parent = page; index(x); } };
    index(root);
    return root;
  }
  const pageLines = (page) => (page.id == null ? [] : [page.open]).concat(page.id == null ? [] : page.lead, page.items.flatMap((x) => (typeof x === "string" ? [x] : pageLines(x))), page.id == null ? [] : page.trail, page.id == null ? [] : [page.close]);
  const pagesText = (root) => pageLines(root).join("\n");
  const eolOf = (page) => { let p = page; while (p && p.id != null) { if (p.open) return /\r$/.test(p.open) ? "\r" : ""; p = p.parent; } const l = (page.items || []).find((x) => typeof x === "string"); return l && /\r$/.test(l) ? "\r" : ""; };
  // the view of a page: its own text, the pages in it a line each
  function pageView(page) {
    const eol = eolOf(page), lines = page.items.map((x) => (typeof x === "string" ? x : pageRow(x, eol)));
    return page.id == null ? lines.join("\n") : lines.length ? lines.join("\n") + "\n" : "";
  }
  // … and the view, as it was edited, put back: the page's lines are these now
  function pagePut(root, page, view) {
    const lines = view.split("\n"), eol = eolOf(page), seen = new Set();
    if (page.id != null && lines[lines.length - 1] === "") lines.pop();
    const clone = (x) => { const c = { ...x, id: "x" + ++pageFresh, items: x.items.map((y) => (typeof y === "string" ? y : clone(y))) }; return c; };
    page.items = lines.map((line) => {
      const m = PAGE_ROW.exec(line.replace(/\r$/, ""));
      if (!m) return line;
      let sub = root.byId.get(m[3]);
      const words = pageWords(pageLook(m[1]));
      if (!sub) sub = { id: m[3], title: m[2], look: words, open: null, close: `<!-- /page -->${eol}`, lead: [eol], trail: [eol], items: [] }; // (a page made here: nothing in it yet)
      else if (seen.has(sub.id)) sub = clone(sub); // (its line once more — copied, duplicated: a page of its own with the same in it)
      seen.add(sub.id);
      // (another name, another look: its first line says so — else that line stays as it was written)
      if (sub.title !== m[2] || pageWords(pageLook(sub.look)) !== words || !sub.open) { sub.title = m[2]; sub.look = words; sub.open = pageMark(pageLook(words), m[2]) + (/\r$/.test(sub.close || "") ? "\r" : eol); }
      return sub;
    });
    root.byId = new Map();
    const index = (pg) => { for (const x of pg.items) if (typeof x !== "string") { root.byId.set(x.id, x); x.parent = pg; index(x); } };
    index(root);
    return pagesText(root);
  }
  // the line of the file a line of the view is (0-based both)
  function pageFileLine(root, page, viewLine) {
    let at = 0, found = -1;
    const walk = (pg) => {
      if (pg.id != null) at += 1 + pg.lead.length;
      pg.items.forEach((x, i) => {
        if (pg === page && i === viewLine) found = at;
        if (typeof x === "string") at++; else walk(x);
      });
      if (pg.id != null) at += pg.trail.length + 1;
    };
    walk(root);
    return found;
  }

  /* Which page of the note is shown: its ids from the note's own text down (a file read anew
   * numbers its pages anew: the place among the pages is remembered too). The tree is that of
   * the note's text as it is (kept while that text is the same). */
  let pageTree = { raw: null, path: null, root: null }, pageAt = { path: null, ids: [], idx: [] }, pagesShown = null;
  function pageNow(p) {
    if (pageTree.raw !== p.raw || pageTree.path !== p.path) pageTree = { raw: p.raw, path: p.path, root: parsePages(p.raw || "") };
    const root = pageTree.root;
    if (pageAt.path !== p.path) pageAt = { path: p.path, ids: [], idx: [] };
    let page = root;
    const ids = [], idx = [];
    for (let i = 0; i < pageAt.ids.length; i++) {
      const subs = page.items.filter((x) => typeof x !== "string");
      const sub = subs.find((x) => x.id === pageAt.ids[i]) || subs[pageAt.idx[i]];
      if (!sub) break;
      ids.push(sub.id); idx.push(subs.indexOf(sub));
      page = sub;
    }
    pageAt = { path: p.path, ids, idx };
    return { root, page };
  }
  // what the reading view and the active mode show of a note: the note itself, or — a note with pages — the view of the page it is at
  function viewOf(p) {
    if (!p || p.kind === "pdf" || p.error || typeof p.raw !== "string") return p;
    const { root, page } = pageNow(p);
    if (!root.byId.size) return p;
    if (p._view && p._view.of === p.raw && p._view.vp.page === page) return p._view.vp;
    const vp = Object.create(p);
    vp.raw = pageView(page);
    vp.text = vp.raw.replace(/\r\n?/g, "\n");
    vp.pageOf = p; vp.page = page; vp.root = root;
    p._view = { of: p.raw, vp };
    return vp;
  }
  // a view that was edited, put back into its note: the note's text is the file as it is to be
  function viewPut(vp) {
    const p = vp.pageOf;
    if (!p) { // the note is its own view — until a page is made in it: then its text is the file, and what was edited a view of it
      if (!vp.raw.split("\n").some((l) => PAGE_ROW.test(l.replace(/\r$/, "")))) return vp;
      const root = parsePages("");
      vp.raw = pagePut(root, root, vp.raw);
      vp.text = vp.raw.replace(/\r\n?/g, "\n");
      pageTree = { raw: vp.raw, path: vp.path, root };
      return vp;
    }
    p.raw = pagePut(vp.root, vp.page, vp.raw);
    p.text = p.raw.replace(/\r\n?/g, "\n");
    pageTree = { raw: p.raw, path: p.path, root: vp.root };
    p._view = { of: p.raw, vp };
    return p;
  }
  // to another page of the note: down into one that lies on this page, or up along the way here
  /* Where one has been among the pages of the note on screen, in order: back and forward go along it (the buttons before
   * the way over a page, Alt+← and Alt+→). Going to a page from anywhere else cuts off what lay ahead. */
  let pageWalk = { path: null, list: [[]], at: 0 };
  const walkOf = () => { if (P.current && pageWalk.path !== P.current.path) pageWalk = { path: P.current.path, list: [pageAt.path === P.current.path ? pageAt.ids : []], at: 0 }; return pageWalk; };
  const pageCan = (by) => { if (!P.current || P.current.kind === "pdf" || P.mode === "edit") return false; const w = walkOf(); return w.at + by >= 0 && w.at + by < w.list.length; };
  function pageStep(by) {
    if (!pageCan(by)) return false;
    const w = walkOf(), v = viewOf(P.current), root = v && v.root;
    w.at += by;
    // (a page that is gone meanwhile: as far along its way as there still is one)
    let ids = w.list[w.at];
    if (root) { const k = ids.findIndex((id) => !root.byId.has(id)); if (k >= 0) ids = w.list[w.at] = ids.slice(0, k); }
    pageGo(ids, null, true);
    return true;
  }
  /* Where one stood on each page of the note (path + the way to the page → how far down), kept as a page is left: come
   * back to — up from a page in it, or along the way one went — it is where it was. Left for a page in it, that is at the
   * page's line; so "back" lands on the line of the page one comes from. A page gone into anew begins at its top. */
  const pageStood = new Map();
  const stoodKey = (path, ids) => path + "\n" + ids.join("/");
  function pageGo(ids, then = null, walked = false) {
    if (!P.current || P.current.kind === "pdf" || P.mode === "edit") return;
    const from = pageAt.path === P.current.path ? pageAt.ids : [];
    { // (… and, going into a page, where that page's line stood on screen: it is put back there exactly)
      const into = ids.length > from.length ? String(ids[from.length]) : null, row = into && [...document.querySelectorAll("#content .page-row[data-page], #active .page-row[data-page]")].find((r) => r.offsetParent && r.dataset.page === into);
      pageStood.set(stoodKey(P.current.path, from), { y: scrollY, id: row ? into : null, top: row ? row.getBoundingClientRect().top : 0 });
    }
    if (pageStood.size > 300) pageStood.delete(pageStood.keys().next().value);
    if (!walked) { const w = walkOf(); if (w.list[w.at].join("/") !== ids.join("/")) { w.list.length = w.at + 1; w.list.push(ids.slice()); if (w.list.length > 60) w.list.shift(); w.at = w.list.length - 1; } }
    if (P.mode === "active") { P.leaving = true; P.flushSave(); P.leaving = false; } // (what is typed is the file's first)
    pageAt = { path: P.current.path, ids, idx: ids.map((_id, i) => (i < pageAt.idx.length ? pageAt.idx[i] : -1)) };
    P.current.arriving = false;
    if (P.mode === "active") { P.drawn = null; P.showActive(P.current, null); } else P.draw(P.current, null);
    // up out of a page, or back along the way: where one stood there — and, where that is not known, at the line of the
    // page one comes from; into a page: its top
    const up = ids.length < from.length && ids.every((id, i) => id === from[i]), stood = pageStood.get(stoodKey(P.current.path, ids));
    if ((up || walked) && stood) window.scrollTo({ top: stood.y, behavior: "instant" });
    else window.scrollTo(0, 0);
    if (up) {
      // (the line of the page one was in: in sight in any case — the page above may have changed meanwhile — and marked for a moment)
      const row = [...document.querySelectorAll("#content .page-row[data-page], #active .page-row[data-page]")].find((r) => r.offsetParent && r.dataset.page === String(from[ids.length]));
      if (row) {
        // (what stands above it may be taller or shorter now — the bar with the way forward is there: the line itself is put
        // where it was)
        if (stood && stood.id === row.dataset.page) window.scrollBy({ top: row.getBoundingClientRect().top - stood.top, behavior: "instant" });
        const r = row.getBoundingClientRect(), top = (document.documentElement.style.getPropertyValue("--top") ? parseFloat(document.documentElement.style.getPropertyValue("--top")) : 0) + 12;
        if (r.top < top || r.bottom > innerHeight - 12) row.scrollIntoView({ block: "center", behavior: "instant" });
        row.classList.add("came-from");
        setTimeout(() => row.classList.remove("came-from"), 900);
      }
    }
    if (then) then();
  }
  /* Blocks put into a page (dragged onto its line): their Markdown stands at the page's end. A
   * page among them goes along as the page it is. (What is typed is the file's first, and with it
   * the blocks are gone from where they stood.) */
  function pageAppend(id, markdown) {
    if (P.mode !== "active" || !P.current || !window.MdActive || !MdActive.view.payload) return false;
    const before = MdActive.view.payload.root || pageTree.root;
    const lines = String(markdown || "").replace(/\n+$/, "").split("\n").map((l) => { const m = PAGE_ROW.exec(l); return (m && before && before.byId.get(m[3])) || l; });
    MdActive.view.touch();
    P.leaving = true; P.flushSave(); P.leaving = false;
    const p = P.current, root = pageTree.path === p.path ? pageTree.root : null, page = root && root.byId.get(id);
    if (!page) return false;
    const eol = eolOf(page);
    if (page.items.length) page.items.push(eol);
    for (const l of lines) page.items.push(typeof l === "string" ? l + eol : l);
    root.byId = new Map();
    const index = (pg) => { for (const x of pg.items) if (typeof x !== "string") { root.byId.set(x.id, x); x.parent = pg; index(x); } };
    index(root);
    p.raw = pagesText(root);
    p.text = p.raw.replace(/\r\n?/g, "\n");
    pageTree = { raw: p.raw, path: p.path, root };
    if (p._view) p._view.of = p.raw;
    P.trailPush(p.path, p.text);
    post("save", { text: p.raw, path: p.path, exact: true, seq: ++P.saveSeq });
    return true;
  }
  const pageOpen = (id) => { const v = viewOf(P.current); if (v && v.root && v.root.byId.has(id)) pageGo([...pageAt.ids, id]); else if (P.mode === "active" && P.current) pageGo([...pageAt.ids, id], () => document.querySelector("#pagebar .pb-title")?.select()); };
  /* Over a page that is open: the way to it — the note, the pages down to the one it lies on — and
   * its name, which is typed there (in the active mode). */
  const pagebar = document.createElement("nav");
  pagebar.id = "pagebar";
  pagebar.setAttribute("aria-label", "Pages");
  function pageBar(v, host) {
    // (on the note itself there is a bar only while there is a way forward again)
    if (!v || !v.pageOf || (v.page.id == null && !pageCan(1))) { pagebar.remove(); return; }
    const nav = `<span class="pb-nav"><button class="pb-step" type="button" data-step="-1" title="${esc(T("page.back"))}" aria-label="${esc(T("page.back"))}"${pageCan(-1) ? "" : " disabled"}>${ICON.chevron}</button><button class="pb-step" type="button" data-step="1" title="${esc(T("page.forward"))}" aria-label="${esc(T("page.forward"))}"${pageCan(1) ? "" : " disabled"}>${ICON.chevron}</button></span>`;
    if (v.page.id == null) {
      pagebar.innerHTML = `<div class="pb-way">${nav}</div>`;
      pagebar.dataset.bare = "";
      if (pagebar.parentNode !== host || host.firstChild !== pagebar) host.prepend(pagebar);
      return;
    }
    delete pagebar.dataset.bare;
    const way = [];
    for (let pg = v.page.parent; pg; pg = pg.parent) way.unshift(pg);
    const name = (pg) => (pg.id == null ? (v.name || "").replace(/\.(md|markdown)$/i, "") || "Note" : pg.title || "Untitled");
    // (the name being typed stays as typed: the bar is drawn anew whenever the note is — a save, a picture that changed —
    // and what was in the field would be gone, with the hand still on it)
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches(".pb-title") && pagebar.contains(document.activeElement) && pagebar.dataset.page === String(v.page.id) ? { value: document.activeElement.value, a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    pagebar.dataset.page = String(v.page.id);
    pagebar.innerHTML = `<div class="pb-way">${nav}` + way.map((pg, i) => `<button class="pb-crumb" type="button" data-depth="${i}">${esc(name(pg))}</button><span class="pb-sep" aria-hidden="true">${ICON.chevron}</span>`).join("") + `<span class="pb-here"></span></div>` +
      `<input class="pb-title" type="text" aria-label="${esc(T("Page name"))}" spellcheck="false" autocomplete="off">`;
    const title = pagebar.querySelector(".pb-title");
    title.value = typing ? typing.value : v.page.title;
    title.placeholder = T("page.untitled");
    // (the way ends at the page one is on: its name, as it is typed below)
    const here = pagebar.querySelector(".pb-here"), named = () => { here.textContent = title.value.trim() || T("page.untitled"); };
    named();
    title.addEventListener("input", named);
    title.readOnly = !!v.readonly || P.mode === "edit"; // (typed here in the reading view as well: written at once, as a ticked task is)
    if (pagebar.parentNode !== host || host.firstChild !== pagebar) host.prepend(pagebar);
    if (typing) { title.focus({ preventScroll: true }); try { title.setSelectionRange(typing.a, typing.b); } catch (e) { /* (as it stands) */ } }
  }
  pagebar.addEventListener("click", (e) => { const s = e.target.closest(".pb-step"); if (s) { pageStep(Number(s.dataset.step)); return; } const c = e.target.closest(".pb-crumb"); if (c) pageGo(pageAt.ids.slice(0, Number(c.dataset.depth))); });
  pagebar.addEventListener("keydown", (e) => {
    if (!e.target.matches(".pb-title")) return;
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape" || e.key === "ArrowDown") { e.preventDefault(); e.target.blur(); if (P.mode === "active") window.MdActive.view.focus(); }
  });
  // a page's name, as it can stand in its line: one line, nothing that ends the comment or reads as its number
  const pageName = (name) => String(name || "").replace(/[\r\n]+/g, " ").replace(/--+>/g, "→").replace(/\s#[a-z]\d+\s*$/, "").trim();
  // (the name is the page's as it is typed, a moment after the last letter — not only when the field is left: left by a
  // click on something that draws the page anew, the change never came)
  let nameTimer = 0;
  pagebar.addEventListener("input", (e) => { if (!e.target.matches(".pb-title")) return; clearTimeout(nameTimer); nameTimer = setTimeout(() => { if (e.target.isConnected) renamePage(e.target, false); }, 350); });
  pagebar.addEventListener("change", (e) => { if (e.target.matches(".pb-title")) { clearTimeout(nameTimer); renamePage(e.target, true); } });
  function renamePage(field, done) {
    const to = pageName(field.value);
    if (done) field.value = to; // (while it is typed the field is left as it is: a space at its end is on its way to a word)
    if (P.mode === "active" && window.MdActive) {
      const vp = MdActive.view.payload;
      if (!vp || !vp.pageOf || vp.page.id == null || vp.readonly || to === vp.page.title) return;
      vp.page.title = to;
      vp.page.open = pageMark(pageLook(vp.page.look), to) + (/\r$/.test(vp.page.close || "") ? "\r" : "");
      MdActive.view.touch(); // (the name is in the file with the next save)
      P.activeChanged();
      return;
    }
    // the reading view: the page's first line says the new name, and the file is written at once
    const vp = P.mode === "read" ? viewOf(P.current) : null;
    if (!vp || !vp.pageOf || vp.page.id == null || vp.readonly || to === vp.page.title) return;
    vp.page.title = to;
    vp.page.open = pageMark(pageLook(vp.page.look), to) + (/\r$/.test(vp.page.close || "") ? "\r" : "");
    const p = vp.pageOf;
    p.raw = pagesText(vp.root);
    p.text = p.raw.replace(/\r\n?/g, "\n");
    pageTree = { raw: p.raw, path: p.path, root: vp.root };
    p._view = null;
    post("save", { text: p.raw, path: p.path, exact: true, seq: ++P.saveSeq });
    for (const el of P.tabEls()) { const t = P.tabs.find((x) => String(x.id) === el.dataset.id); if (t) P.paintTab(el, t); }
  }

  /* A property that is true or false, switched: its line in the properties at the head of the
   * text (a note, or the properties alone) says the other — everything else stays as written.
   * -> the text, or null where there is no such line (a value written another way: left alone). */
  function toggleProp(text, key, on) {
    const m = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(text || "");
    if (!m) return null;
    const k = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const line = new RegExp(`^((?:${k}|"${k}"|'${k}')[ \\t]*:[ \\t]*)(?:true|false)([ \\t]*(?:#.*)?)$`, "im");
    if (!line.test(m[2])) return null;
    return m[1] + m[2].replace(line, (_all, head, tail) => head + (on ? "true" : "false") + tail) + m[3] + text.slice(m[0].length);
  }
  /* A property set by the app (the panel's Document tab): its line in the properties at the head
   * of the text (a note, or the properties alone) says value — written anew, or added, and the
   * properties with it where the text has none. With null it is taken away, and the properties
   * too when nothing else stands in them. Everything else stays as written.
   * -> the text, or null where the head is not properties that can be read. */
  function setProp(text, key, value) {
    text = String(text || "");
    const bom = text.startsWith("﻿") ? "﻿" : "", rest = text.slice(bom.length);
    const m = /^(---[ \t]*\r?\n)(?:([\s\S]*?)\r?\n)?((?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(rest);
    const nl = /\r\n/.test(m ? m[1] : rest) ? "\r\n" : "\n";
    if (!m) return value == null ? text : `${bom}---${nl}${key}: ${value}${nl}---${nl}${rest && !/^\r?\n/.test(rest) ? nl : ""}${rest}`;
    if (!stripFrontmatter(m[0].replace(/\r\n?/g, "\n")).props) return null;
    const lines = m[2] ? m[2].split(/\r?\n/) : [], k = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const at = lines.findIndex((l) => new RegExp(`^(?:${k}|"${k}"|'${k}')[ \\t]*:`).test(l));
    let end = at + 1;
    while (at >= 0 && end < lines.length && /^(?:[ \t]+\S|-(?: |$))/.test(lines[end])) end++; // (a value over several lines goes with its key)
    if (at < 0 && value == null) return text;
    lines.splice(at < 0 ? lines.length : at, at < 0 ? 0 : end - at, ...(value == null ? [] : [`${key}: ${value}`]));
    if (value == null && !lines.some((l) => l.trim())) return bom + rest.slice(m[0].length).replace(/^\r?\n/, "");
    return bom + m[1] + lines.join(nl) + (lines.length ? nl : "") + m[3] + rest.slice(m[0].length);
  }
  /* How a note says it wants to be shown, in its properties (viewer.js: docSync):
   *   background: gray | red … magenta | dots | grid | lines   the page's ground — a quiet tint of
   *               one of the theme's colours, or paper (viewer/page.css)
   *   width: narrow | wide | full   how much of the window the text column takes (normal, where it says nothing);
   *               "wide: true", as it was written before, is wide
   * -> { background ("" for the theme's own), width } */
  const BACKGROUNDS = ["gray", ...DECO_COLORS, "dots", "grid", "lines"];
  const docLook = (props) => {
    const bg = props && typeof props.background === "string" ? props.background.trim().toLowerCase().replace(/^grey$/, "gray") : "";
    const w = props && typeof props.width === "string" ? props.width.trim().toLowerCase() : "";
    return { background: BACKGROUNDS.includes(bg) ? bg : "", width: ["narrow", "wide", "full"].includes(w) ? w : props && props.wide === true ? "wide" : "normal" };
  };
  // a line's text as it is read: no marks of Markdown, pictures and comments gone, a link its words
  const plainText = (s) => s.replace(/<!--.*?-->/g, "").replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`~$]|==/g, "").replace(/\s+/g, " ").trim();
  /* What a note's text holds, counted (the panel's Document tab) — the file's whole text, the pages
   * in it too; properties and comments are not the document's. Line by line, without parsing it:
   * a block is a heading, a list entry, a rule, a page, code or a formula between its fences, and
   * the lines of a paragraph, a table or a quote together. Words and characters are the text's as
   * it is read (code and formulas are not read); a minute of reading is 220 words.
   * -> { words, chars, blocks, minutes, headings, pictures, links, tasks, done, pages } */
  function docFacts(text) {
    const f = { words: 0, chars: 0, blocks: 0, minutes: 0, headings: 0, pictures: 0, links: 0, tasks: 0, done: 0, pages: 0 };
    let fence = null, math = false, run = "";
    for (const raw of stripComments(stripFrontmatter(String(text || "").replace(/\r\n?/g, "\n")).body).split("\n")) {
      const fm = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
      if (fence) { if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null; continue; }
      if (fm) { fence = fm[1]; f.blocks++; run = ""; continue; }
      if (math) { if (/\$\$\s*$/.test(raw)) math = false; continue; }
      if (/^\s*\$\$/.test(raw)) { f.blocks++; run = ""; math = !/^\s*\$\$.+\$\$\s*$/.test(raw); continue; }
      if (!raw.trim()) { run = ""; continue; }
      if (PAGE_OPEN.test(raw)) { f.pages++; f.blocks++; run = ""; continue; }
      if (/^\s*<!--.*-->\s*$/.test(raw)) continue; // (a page's end, how a table looks: nothing of its own)
      if (/^ {0,3}([-*_])( *\1){2,} *$/.test(raw)) { f.blocks++; run = ""; continue; }
      f.pictures += (raw.match(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)|<img\b/g) || []).length;
      f.links += (raw.match(/(?<!!)\[\[[^\]]+\]\]|(?<!!)\[[^\]]*\]\([^)]*\)|<https?:\/\/[^>\s]+>|(?<![(<\w])https?:\/\/[^\s)>\]]+/g) || []).length;
      const head = /^ {0,3}#{1,6}(?:\s+|$)/.exec(raw), item = !head && /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?/.exec(raw);
      const kind = head ? "" : item ? "i" : /^\s*\|/.test(raw) ? "t" : /^\s*>/.test(raw) ? "q" : "p";
      if (head) f.headings++;
      if (item && item[1]) { f.tasks++; if (item[1] !== " ") f.done++; }
      if (!kind || kind === "i" || kind !== run) f.blocks++;
      run = kind === "i" ? "p" : kind; // (what follows an entry without an empty line is the entry's)
      if (kind === "t" && /^[\s|:-]+$/.test(raw)) continue; // (the line under a table's head)
      const t = plainText(raw.slice((head || item || [""])[0].length).replace(kind === "t" ? /\|/g : /^\s*(?:>\s*)*(?:\[![^\]]*\][+-]?)?/, " "));
      f.words += (t.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) || []).length;
      f.chars += t.length;
    }
    f.minutes = Math.ceil(f.words / 220);
    return f;
  }
  /* What a page says about itself on its line (the looks sheet, preview and widget): how its own
   * text begins, its tasks, the pages in it, the words in all of it — and its shape, a letter a
   * line: h a heading, t text, i a picture, f a formula or code, c a task. */
  function pageFacts(page) {
    const text = [], subs = [], tasks = [], shape = [];
    const plain = plainText;
    const wordsOf = (pg) => pg.items.reduce((n, x) => n + (typeof x === "string" ? (plain(x).match(/[\p{L}\p{N}]+/gu) || []).length : wordsOf(x)), 0);
    let fence = null, math = false;
    for (const x of page.items) {
      if (typeof x !== "string") { subs.push(x.title || "Untitled"); shape.push("t"); continue; }
      const line = x.replace(/\r$/, ""), f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (f && !fence) { fence = f[1]; shape.push("f"); continue; }
      if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
      if (/^\s*\$\$/.test(line)) { if (!math) shape.push("f"); if (!/^\s*\$\$.+\$\$\s*$/.test(line)) math = !math; continue; }
      if (math || !line.trim() || /^ {0,3}([-*_])( *\1){2,} *$/.test(line)) continue;
      const task = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (task) { tasks.push({ text: plain(task[2]), done: task[1] !== " " }); shape.push("c"); continue; }
      if (/^\s*!\[/.test(line)) { shape.push("i"); continue; }
      if (/^ {0,3}#{1,6}\s/.test(line)) { shape.push("h"); continue; }
      if (/^\s*\|/.test(line)) { shape.push("t"); continue; }
      const t = plain(line.replace(/^\s*(?:>\s*)*(?:\[![^\]]*\][+-]?)?\s*(?:(?:[-*+]|\d+[.)])\s+)?/, ""));
      if (!t) continue;
      text.push(t);
      for (let i = Math.min(3, Math.ceil(t.length / 90)); i > 0; i--) shape.push("t");
    }
    const all = text.join(" "), excerpt = all.length > 240 ? all.slice(0, 240).replace(/\s+\S*$/, "") + "…" : all;
    return { excerpt, words: wordsOf(page), subs, tasks, done: tasks.filter((t) => t.done).length, shape: shape.slice(0, 9).join("") };
  }
  // … and the line drawn in one of those looks (page: null where the page is not at hand — its name alone)
  function pageRowInner(look, name, page) {
    const f = page ? pageFacts(page) : { excerpt: "", words: 0, subs: [], tasks: [], done: 0, shape: "" };
    const said = [f.tasks.length ? T("page.tasksDone", f.done, f.tasks.length) : "", f.subs.length ? T(f.subs.length === 1 ? "page.subOne" : "page.subs", f.subs.length) : "", f.words || !page ? T(f.words === 1 ? "page.wordOne" : "page.words", f.words.toLocaleString()) : T("page.empty")].filter(Boolean);
    const lines = [...f.shape].map((l) => `<i class="${l}"></i>`).join("");
    const sheets = (head) => `<span class="page-sheets" aria-hidden="true">${f.subs.length > 1 ? '<span class="page-sheet back2"></span>' : ""}${f.subs.length ? '<span class="page-sheet back1"></span>' : ""}<span class="page-sheet">${head}${lines}</span></span>`;
    if (look.style === "sheet") return `${sheets('<i class="h"></i>')}<span class="page-row-text"><span class="page-row-name">${name}</span>${f.excerpt ? `<span class="page-row-ex">${esc(f.excerpt)}</span>` : ""}<span class="page-row-meta">${said.map((s, i) => (i ? esc(s) : `<b>${esc(s)}</b>`)).join(" · ")}</span></span>`;
    if (look.style === "preview") return `${sheets(`<b>${name}</b>`)}<span class="page-row-name">${name}</span><span class="page-row-meta">${esc(said[0])}</span>`;
    // a widget: what is still to do first, then the pages in it, then how its text begins
    const open = f.tasks.length - f.done, count = f.tasks.length ? open : f.subs.length;
    const rows = f.tasks.length ? [...f.tasks].sort((a, b) => a.done - b.done).slice(0, 4).map((t) => `<span class="page-row-li${t.done ? " done" : ""}"><span class="page-row-box"></span><span>${esc(t.text)}</span></span>`) : f.subs.slice(0, 4).map((s) => `<span class="page-row-li">${ICON.note}<span>${esc(s)}</span></span>`);
    const room = 5 - rows.length - (rows.length ? 1 : 0);
    return `<span class="page-row-head"><span class="page-row-icon">${ICON.note}</span><span class="page-row-name">${name}</span>${count ? `<span class="page-row-count">${count}</span>` : ""}</span>${rows.join("")}`
      + (f.tasks.length ? `<span class="page-row-more">${esc(said[0])}</span>` : room > 0 && f.excerpt ? `<span class="page-row-ex" style="--n: ${room}">${esc(f.excerpt)}</span>` : !rows.length ? `<span class="page-row-more">${esc(said[said.length - 1])}</span>` : "");
  }
  // a page's line on the page it lies on: its name, to be opened (reading view and active mode alike)
  const htmlBlockRule = md.renderer.rules.html_block;
  md.renderer.rules.html_block = (t, i, o, env, self) => {
    const m = PAGE_ROW.exec(t[i].content.trim());
    if (!m) return safeHtml(t[i].content);
    const page = pagesShown && pagesShown.byId.get(m[3]), look = pageLook(m[1]), name = esc((page ? page.title : m[2]) || "Untitled");
    const head = `<div class="page-row" data-style="${look.style}"${look.color ? ` data-color="${look.color}" style="--pc: var(--c-${look.color})"` : ""} data-page="${esc(m[3])}" role="link" tabindex="0">`;
    if (look.style !== "row" && look.style !== "card") return head + pageRowInner(look, name, page) + (look.style === "sheet" ? "</div>\n" : "</div>"); // (tiles stand side by side: nothing between them, not even a space)
    return `${head}<span class="page-row-icon">${ICON.note}</span><span class="page-row-name">${name}</span><span class="page-row-go">${ICON.chevron}</span></div>\n`;
  };
  function renderProps(props, env) {
    const keys = Object.keys(props);
    if (!keys.length) return "";
    const chip = (k, v) => /^tags?$/i.test(k)
      ? `<span class="tag">#${esc(String(v).replace(/^#/, ""))}</span>`
      : `<span class="chip">${md.renderInline(String(v), env)}</span>`;
    const value = (k, v) => {
      if (v == null || v === "") return '<span class="prop-empty">Empty</span>';
      if (Array.isArray(v)) return v.map((x) => chip(k, Array.isArray(x) ? `[[${x.flat().join("")}]]` : x)).join("");
      if (typeof v === "boolean") return `<input type="checkbox" class="task" data-prop="${esc(k)}"${v ? " checked" : ""}>`; // (a click writes it: toggleProp)
      if (v instanceof Date) {
        const dateOnly = v.getUTCHours() === 0 && v.getUTCMinutes() === 0;
        return esc(dateOnly
          ? v.toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })
          : v.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }));
      }
      if (typeof v === "object") return `<code>${esc(JSON.stringify(v))}</code>`;
      if (/^(tags?|aliases)$/i.test(k)) return String(v).split(/[,\s]+/).filter(Boolean).map((x) => chip(k, x)).join("");
      return md.renderInline(String(v), env);
    };
    const rows = keys.map((k) => `<tr><th>${esc(k)}</th><td>${value(k, props[k])}</td></tr>`).join("");
    return `<details class="props" open><summary><span class="callout-fold">${ICON.chevron}</span>${esc(T("Properties"))}</summary><table>${rows}</table></details>`;
  }

  // what the page's other files use of this one
  Object.assign(P, { stripFrontmatter, stripComments, CALLOUT_STYLES, PAGE_STYLES, LINK_STYLES, PAGE_ROW,
    pageLook, pageMark, parsePages, pageLines, pagesText, pageView, pagePut, pageFileLine, viewOf, viewPut,
    pageStep, pageAppend, pageOpen, pagebar, pageBar, pageName, toggleProp, setProp, BACKGROUNDS, docLook,
    docFacts, pageFacts, renderProps });
  // … and what changes while the page runs (set from elsewhere where a second function is given)
  P.live({
    pageFresh: [() => pageFresh, (v) => { pageFresh = v; }],
    pageTree: [() => pageTree, (v) => { pageTree = v; }],
    pagesShown: [() => pagesShown, (v) => { pagesShown = v; }],
  });
})();
