/* mdview active mode — the editor view inside #active.
 * viewer.js owns the modes and calls show(); this file owns the ProseMirror
 * view and the store behind it. */
"use strict";
(() => {
  const A = window.MdActive;
  const { EditorState } = PM.state;
  const { EditorView } = PM.view;

  const el = document.createElement("section");
  el.id = "active";
  document.getElementById("content").after(el);

  let view = null, open = null; // open: { store, doc, loaded } of the document shown
  let shown = {};               // the payload and text it was built from

  /* Pictures. The active mode builds its own <img> elements, and a new
   * element shows nothing until it has loaded again — on every switch from
   * reading the pictures would flash and the page would jump. So:
   * - lend(): elements that are loaded change places with the same picture's
   *   new element in the other view (the reading view is hidden while this
   *   one shows, and the other way round);
   * - reserve(): where there is no loaded element to take, the size seen
   *   earlier keeps the place until the picture is there. */
  const content = document.getElementById("content");
  const sizes = new Map(); // src -> [width, height] of pictures seen loaded
  const reserved = new WeakMap(); // img -> what reserve() added
  const remember = (img) => { // by src: inside <picture> the file shown (currentSrc) is another one
    if (img.naturalWidth && img.src) sizes.set(img.src, [img.naturalWidth, img.naturalHeight]);
  };
  // loaded: from here on the picture's own size counts (a reserved one can be a pixel off)
  document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") { remember(e.target); unreserve(e.target); } }, true);
  document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") unreserve(e.target); }, true);
  /* Pictures that failed to load show a placeholder (their alternative text);
   * how much room it takes is only known while the view is on screen. */
  const broken = new Map(); // src -> [width, height]
  function note(root) {
    for (const img of pictures(root)) {
      if (!img.complete || img.naturalWidth || !img.src) continue;
      const r = img.getBoundingClientRect();
      if (r.width || r.height) broken.set(img.src, [r.width, r.height]);
    }
  }
  const pictures = (root) => [...root.querySelectorAll("img:not(.ProseMirror-separator)")];
  function unreserve(img) {
    const set = reserved.get(img);
    if (!set) return;
    img.style.aspectRatio = "";
    if (set.width) img.style.width = "";
    if (set.box) img.style.height = "";
    if (!img.getAttribute("style")) img.removeAttribute("style");
    reserved.delete(img);
  }
  /* The page's style sheet sizes pictures by their own proportions
   * (`height: auto`, whatever the height attribute says), so that is what is
   * reserved: the proportions, and the natural width unless one is given. */
  function reserve(img) {
    const size = sizes.get(img.src), box = broken.get(img.src);
    if (img.complete || reserved.has(img)) return;
    if (!size && box) { // it failed to load before and will again: the room its placeholder took
      img.style.width = box[0] + "px";
      img.style.height = box[1] + "px";
      reserved.set(img, { width: true, box: true });
      return;
    }
    if (!size) return;
    const width = !img.hasAttribute("width") && !img.style.width && !img.style.height;
    img.style.aspectRatio = `${size[0]} / ${size[1]}`;
    if (width) img.style.width = size[0] + "px";
    reserved.set(img, { width });
  }
  // (a picture that failed to load is left alone: moved, WebKit requests it again)
  const loaded = (img) => img.complete && img.naturalWidth > 0;
  // <picture> and srcset choose their file by where the element sits; those stay put
  const movable = (img) => !img.closest("picture") && !img.hasAttribute("srcset");
  function lend(from, to) {
    const have = new Map();
    for (const img of pictures(from)) {
      remember(img);
      if (!loaded(img) || !movable(img)) continue;
      if (!have.has(img.src)) have.set(img.src, []);
      have.get(img.src).push(img);
    }
    for (const img of pictures(to)) {
      if (img.complete) continue;
      if (!movable(img)) { reserve(img); continue; }
      unreserve(img);
      const list = have.get(img.src);
      const at = list ? list.findIndex((d) => d.outerHTML === img.outerHTML) : -1;
      if (at < 0) { reserve(img); continue; }
      const donor = list.splice(at, 1)[0], mark = document.createComment("");
      donor.replaceWith(mark);
      img.replaceWith(donor);
      mark.replaceWith(img);
    }
  }

  // Islands show the reading view's own HTML; nothing inside them is the editor's business.
  const htmlView = (tag, cls) => (node) => {
    const dom = document.createElement(tag);
    dom.className = cls;
    dom.dataset.kind = node.attrs.kind;
    dom.innerHTML = node.attrs.html;
    if (!dom.firstElementChild && !dom.textContent.trim()) dom.classList.add("none"); // an HTML comment, an empty properties block
    else if (tag === "div" && !node.attrs.virtual) { // what it is, and that Enter edits it
      const T = window.MdStrings.t, kind = { code: "dialog.code", math: "dialog.math", frontmatter: "dialog.frontmatter", html: "dialog.html", table: "dialog.table", deflist: "dialog.deflist", blockquote: "dialog.callout" }[node.attrs.kind] || "dialog.markdown";
      dom.setAttribute("role", "button");
      // "Code block, python, 12 lines. …" / "Formula: a^2 + b^2. …" — a formula is read out by its source
      let label = T("island.hint", T(kind), node.attrs.raw.split("\n").length);
      if (node.attrs.kind === "code") { const c = A.islands.parseCode(node.attrs.raw); const n = c.code.split("\n").length; label = T(n === 1 ? "island.code1" : "island.code", c.lang ? T(kind) + ", " + c.lang : T(kind), n); }
      else if (node.attrs.kind === "math") label = T("island.math", A.islands.parseMath(node.attrs.raw).tex.replace(/\s+/g, " ").trim().slice(0, 300));
      dom.setAttribute("aria-label", label);
    }
    // what is to be clicked inside stays the page's business (copy button, fold marker, player)
    return { dom, ignoreMutation: () => true, stopEvent: (e) => !!e.target.closest?.("button, summary, input, audio, video, a") };
  };
  const nodeViews = {
    island: htmlView("div", "isl"),
    iatom: htmlView("span", "ia"),
    // in a wrapper, so the <img> inside can change places with the reading view's
    image(node) {
      const dom = document.createElement("span"), img = document.createElement("img");
      dom.className = "im";
      img.src = node.attrs.src;
      img.alt = node.attrs.alt;
      if (node.attrs.title != null) img.title = node.attrs.title;
      dom.appendChild(img);
      return { dom, ignoreMutation: () => true };
    },
  };

  /* p: the payload the reading view draws (text, raw, links, vault, readonly).
   * The same text as last time keeps the editor as it is: undo history, caret. */
  function show(p) {
    const fresh = !(open && shown.text === p.text && shown.p.path === p.path && !!shown.p.vault === !!p.vault);
    if (!fresh) open.store.env.links = p.links || {}; // what new wikilinks resolve against
    shown = { p, text: p.text };
    if (fresh) {
      open = A.document.open(p);
      // the caret starts in text; an island at the top would otherwise show up selected
      const selection = PM.state.Selection.findFrom(open.doc.resolve(0), 1, true) || undefined;
      const state = EditorState.create({ doc: open.doc, selection, plugins: A.edit.plugins(open) });
      built++;

      if (view) view.updateState(state);
      else {
        view = new EditorView(el, {
          state, nodeViews,
          attributes: { class: "pm", role: "textbox", "aria-multiline": "true", "aria-label": window.MdStrings.t("active.label"), spellcheck: "false" },
          editable: () => !shown.p.readonly,
          handleScrollToSelection: scrollToCaret,
          dispatchTransaction(tr) {
            // a file that cannot be written is not changed here either, whatever asks for it
            if (tr.docChanged && shown.p.readonly && tr.getMeta("addToHistory") !== false) return;
            // An action (from a menu, a dialog, a paste) is a step of its own in the undo history:
            // it does not run together with the typing before it or after it.
            if (tr.docChanged && tr.getMeta("addToHistory") !== false && !tr.getMeta("history$")) {
              const action = tr.getMeta("step") || tr.getMeta("paste") || /^(paste|cut|drop)$/.test(tr.getMeta("uiEvent") || "");
              if (action || closeNext) PM.history.closeHistory(tr);
              closeNext = !!action;
            }
            view.updateState(view.state.apply(tr));
            if (tr.docChanged) { dirty = edited = true; if (A.view.onChange) A.view.onChange(); }
          },
        });
      }
      dirty = edited = false;
    }
    view.setProps({ editable: () => !shown.p.readonly }); // read again: the file may be read-only now

    lend(content, view.dom);
    return open.store;
  }
  const serialize = (exact = true) => A.document.serialize(open, view.state.doc, exact);
  /* The document as it is to be saved. From here on it counts as saved. */
  function take() {
    const text = serialize(true);
    dirty = false;
    shown.text = text.replace(/\r\n?/g, "\n");
    return text;
  }

  /* Where things are, for keeping the place across a change of mode. While
   * nothing was edited the lines the blocks were built with are right, and
   * viewer.js reads them off the DOM (down to list items). After an edit they
   * are not; then the top-level blocks are counted out in the Markdown. */
  function startLines() {
    const offsets = [], out = [];
    const text = A.document.serialize(open, view.state.doc, false, offsets);
    let line = 0, at = 0, k = 0;
    view.state.doc.forEach((node, pos, index) => {
      if (node.type.name === "island" && node.attrs.virtual) return;
      if (node.type.name === "paragraph" && !node.content.size && view.state.doc.childCount > 1) { out.push([pos, line]); return; }
      const offset = offsets[k++];
      for (; at < offset; at++) if (text.charCodeAt(at) === 10) line++;
      out.push([pos, line]);
    });
    return out;
  }
  function anchor() {
    if (!edited) return null;
    for (const [pos, line] of startLines()) {
      const dom = view.nodeDOM(pos);
      if (!dom || !dom.getBoundingClientRect) continue;
      const r = dom.getBoundingClientRect();
      if (r.bottom > 0 && r.height > 0) return { line, top: r.top, y: window.scrollY };
    }
    return { line: null, y: window.scrollY };
  }
  function restore(a) {
    if (!edited) return false;
    let best = null;
    for (const [pos, line] of startLines()) { if (line <= a.line) best = pos; else break; }
    const dom = best == null ? null : view.nodeDOM(best);
    if (!dom || !dom.getBoundingClientRect) { window.scrollTo(0, a.y || 0); return true; }
    window.scrollBy({ top: dom.getBoundingClientRect().top - a.top, behavior: "instant" });
    return true;
  }
  // the caret into the first block on screen (a fresh document has it at the very top)
  function caretToView() {
    const { doc } = view.state;
    let target = null;
    doc.forEach((node, pos) => {
      if (target != null || node.type.name === "hidden") return;
      const dom = view.nodeDOM(pos);
      if (dom && dom.getBoundingClientRect && dom.getBoundingClientRect().bottom > 60) target = pos;
    });
    if (target == null) return;
    const sel = PM.state.Selection.findFrom(doc.resolve(target), 1, true);
    if (sel) view.dispatch(view.state.tr.setSelection(sel));
  }

  /* The caret into view. Typing keeps it clear of the window's edges; after
   * undo and redo it comes to rest a fifth of the window in, and gently. */
  function scrollToCaret(v) {
    const jump = A.view.gentle;
    A.view.gentle = false;
    let c;
    try { c = v.coordsAtPos(v.state.selection.head); } catch (_e) { return false; }
    const comfort = jump ? innerHeight * 0.2 : 0;
    const top = Math.max(56, comfort), bottom = innerHeight - Math.max(28, comfort); // (the toolbar floats over the top)
    const by = c.top < top ? c.top - top : c.bottom > bottom ? c.bottom - bottom : 0;
    if (by) window.scrollBy({ top: by, behavior: jump && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
    return true;
  }

  /* The caret's place in the Markdown, and back: for keeping it when the
   * source editor takes over or hands back. Found by the block it is in and
   * the word before it (the n-th time that word stands in the block). */
  const WORD = /[\p{L}\p{N}]+$/u;
  const nth = (hay, needle, n) => { let at = -1; for (let i = 0; i <= n; i++) { at = hay.indexOf(needle, at + 1); if (at < 0) return -1; } return at; };
  const count = (hay, needle) => { let n = 0, at = -1; while ((at = hay.indexOf(needle, at + 1)) >= 0) n++; return n; };
  function blocks() { // [pos, node, from, to] of every block that is written, with its place in the Markdown
    const offsets = [], out = [], doc = view.state.doc;
    const text = A.document.serialize(open, doc, false, offsets);
    let k = 0;
    doc.forEach((node, pos) => {
      if (node.type.name === "island" && node.attrs.virtual) return;
      if (node.type.name === "paragraph" && !node.content.size && doc.childCount > 1) return;
      out.push({ pos, node, from: offsets[k++] });
    });
    out.forEach((b, i) => { b.to = i + 1 < out.length ? out[i + 1].from : text.length; });
    return { text, list: out };
  }
  function caretOffset() {
    if (!view) return null;
    const head = view.state.selection.head, { text, list } = blocks();
    let b = null;
    for (const x of list) { if (x.pos <= head) b = x; else break; }
    if (!b) return 0;
    const before = view.state.doc.textBetween(b.pos, Math.min(head, b.pos + b.node.nodeSize), "\n", " ");
    const word = (WORD.exec(before) || [""])[0];
    if (!word) return b.from;
    const at = nth(text.slice(b.from, b.to), word, count(before, word) - 1);
    return at < 0 ? b.from : b.from + at + word.length;
  }
  function caretAt(offset) {
    if (!view || offset == null) return;
    const { text, list } = blocks(), doc = view.state.doc;
    let b = null;
    for (const x of list) { if (x.from <= offset) b = x; else break; }
    if (!b) return;
    const before = text.slice(b.from, Math.min(offset, b.to));
    const word = (WORD.exec(before) || [""])[0];
    let pos = -1;
    if (word) {
      let left = count(before, word);
      b.node.descendants((n, p) => {
        if (pos >= 0 || !n.isText) return;
        const c = count(n.text, word);
        if (c >= left) pos = b.pos + 1 + p + nth(n.text, word, left - 1) + word.length - (b.node.isTextblock ? 0 : 0); else left -= c;
      });
      if (pos >= 0 && !b.node.isTextblock) pos = Math.min(pos, b.pos + b.node.nodeSize - 1);
    }
    const $at = doc.resolve(Math.max(0, Math.min(pos >= 0 ? pos : b.pos + 1, doc.content.size)));
    const sel = $at.parent.isTextblock ? PM.state.TextSelection.create(doc, $at.pos) : PM.state.Selection.findFrom(doc.resolve(b.pos), 1, true);
    if (sel) view.dispatch(view.state.tr.setSelection(sel));
  }

  let closeNext = false; // the last change was an action: what follows starts a new undo step
  let built = 0;      // how many times a document was built anew (its undo history started over)
  let dirty = false;  // edits not yet handed over for saving
  let edited = false; // the document is not what it was built from any more
  A.view = {
    el, show, serialize, take, anchor, restore, caretToView, caretOffset, caretAt,
    onHistory: null, // set by viewer.js: undo / redo beyond what was done in this mode (-1 / 1) -> done?
    gentle: false,   // the next scroll to the caret is one after undo or redo
    touch() { dirty = edited = true; },
    /* After a save: read the saved text again — every island the editor holds must still be one
     * there. -> what is wrong, or null. */
    verify() {
      if (!open || !view || view.state.doc.childCount > 4000) return null;
      const count = (doc) => { const n = {}; doc.descendants((x) => { if (x.type.name === "island" && !x.attrs.virtual) n[x.attrs.kind] = (n[x.attrs.kind] || 0) + 1; return !x.isTextblock; }); return n; };
      const have = count(view.state.doc), again = count(A.document.open({ text: shown.text, raw: shown.text, links: shown.p.links, vault: shown.p.vault }).doc);
      const lost = Object.keys(have).filter((k) => (again[k] || 0) < have[k]);
      return lost.length ? "the saved file lost blocks the editor holds: " + lost.map((k) => `${k} ${have[k]} -> ${again[k] || 0}`).join(", ") : null;
    },
    // is what is built here the text of this payload?
    shows(p) { return !!open && !dirty && shown.p.path === p.path && shown.text === p.text && !!shown.p.vault === !!p.vault; }, // the document shown is not the one saved
    get built() { return built; },
    // the reading view is still on screen and about to be left for this one
    arriving() { note(content); },
    onChange: null, // set by viewer.js: called after every edit
    // the reading view is about to show again: its pictures back
    leave() { if (view) lend(view.dom, content); },
    leaving() { if (view) note(view.dom); },
    focus() { if (view && view.editable) view.focus(); },
    failed() { dirty = true; }, // the save did not happen
    get dirty() { return dirty; },
    get edited() { return edited; },
    get editable() { return !!view && view.editable; },
    get payload() { return shown.p; },
    get dom() { return view ? view.dom : el; },
    get store() { return open && open.store; },
    get pm() { return view; },
  };
})();
