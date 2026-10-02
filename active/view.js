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
  const pictures = (root) => [...root.querySelectorAll("img:not(.ProseMirror-separator)")];
  function unreserve(img) {
    const set = reserved.get(img);
    if (!set) return;
    img.style.aspectRatio = "";
    if (set.width) img.style.width = "";
    if (!img.getAttribute("style")) img.removeAttribute("style");
    reserved.delete(img);
  }
  /* The page's style sheet sizes pictures by their own proportions
   * (`height: auto`, whatever the height attribute says), so that is what is
   * reserved: the proportions, and the natural width unless one is given. */
  function reserve(img) {
    const size = sizes.get(img.src);
    if (!size || img.complete || reserved.has(img)) return;
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
      const state = EditorState.create({ doc: open.doc, selection, plugins: A.edit.plugins() });
      if (view) view.updateState(state);
      else {
        view = new EditorView(el, {
          state, nodeViews,
          attributes: { class: "pm", role: "textbox", "aria-multiline": "true", "aria-label": window.MdStrings.t("active.label"), spellcheck: "false" },
          editable: () => !shown.p.readonly,
          dispatchTransaction(tr) {
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

  let dirty = false;  // edits not yet handed over for saving
  let edited = false; // the document is not what it was built from any more
  A.view = {
    el, show, serialize, take, anchor, restore, caretToView,
    onChange: null, // set by viewer.js: called after every edit
    // the reading view is about to show again: its pictures back
    leave() { if (view) lend(view.dom, content); },
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
