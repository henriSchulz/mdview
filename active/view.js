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
    return { dom, ignoreMutation: () => true };
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

  /* p: the payload the reading view draws (text, raw, links, vault). */
  function show(p) {
    if (!(open && shown.p === p && shown.text === p.text)) { // else: still on screen as it is
      open = A.document.open(p);
      shown = { p, text: p.text };
      const state = EditorState.create({ doc: open.doc });
      if (view) view.updateState(state);
      else view = new EditorView(el, { state, nodeViews, editable: () => false, attributes: { class: "pm" } });
    }
    lend(content, view.dom);
    return open.store;
  }
  const serialize = (exact = true) => A.document.serialize(open, view.state.doc, exact);

  A.view = {
    el, show, serialize,
    // the reading view is about to show again: its pictures back
    leave() { if (view) lend(view.dom, content); },
    get dom() { return view ? view.dom : el; },
    get store() { return open && open.store; },
    get pm() { return view; },
  };
})();
