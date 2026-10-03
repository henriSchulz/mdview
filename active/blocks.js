/* mdview active mode — moving blocks by dragging: a handle shows beside the
 * block the pointer is over (only then); dragged, the block itself is the
 * picture under the pointer and a line shows where it will go (ProseMirror's
 * drop cursor). Dropped, it moves there — one undo step, written back as it
 * stood in the file. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, NodeSelection } = PM.state;
  const handle = document.createElement("div");
  handle.className = "blk-h";
  handle.draggable = true;
  handle.setAttribute("aria-hidden", "true"); // (the keyboard moves blocks with the clipboard; the handle is for the pointer)
  handle.innerHTML = '<svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
  document.body.appendChild(handle);
  let over = null, view = null; // the block element the handle belongs to

  const blockOf = (v, target) => {
    let el = target && target.nodeType === 1 ? target : target && target.parentElement;
    while (el && el.parentElement !== v.dom) el = el.parentElement;
    if (!el || el.classList.contains("hid") || el.classList.contains("none") || el.dataset.kind === "footnotes") return null;
    return el;
  };
  function place(el) {
    over = el;
    const r = el.getBoundingClientRect(), pm = view.dom.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(el).lineHeight) || 26;
    const first = el.matches("h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote") ? Math.min(r.height, line) : Math.min(r.height, 28);
    handle.style.left = pm.left - 26 + scrollX + "px";
    handle.style.top = r.top + first / 2 - 9 + scrollY + "px";
    handle.dataset.on = "";
  }
  function hide() { over = null; delete handle.dataset.on; }

  handle.addEventListener("mousedown", (e) => e.stopPropagation());
  handle.addEventListener("dragstart", (e) => {
    if (!view || !over || !over.isConnected) { e.preventDefault(); return; }
    const $p = view.state.doc.resolve(view.posAtDOM(over, 0));
    const pos = $p.depth ? $p.before(1) : $p.pos;
    const node = view.state.doc.nodeAt(pos);
    if (!node) { e.preventDefault(); return; }
    const sel = NodeSelection.create(view.state.doc, pos);
    view.dispatch(view.state.tr.setSelection(sel));
    const slice = sel.content();
    view.dragging = { slice, move: true, node: sel }; // what ProseMirror's own drop takes and moves
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", A.clip.markdownOf(view.state, slice));
    const r = over.getBoundingClientRect();
    e.dataTransfer.setDragImage(over, Math.min(40, r.width / 2), Math.min(16, r.height / 2));
    handle.dataset.dragging = "";
  });
  handle.addEventListener("dragend", () => { delete handle.dataset.dragging; hide(); if (view) view.dragging = null; });

  const plugin = new Plugin({
    key: new PluginKey("blocks"),
    view(v) { view = v; return { destroy() { hide(); if (view === v) view = null; } }; },
    props: {
      handleDOMEvents: {
        mousemove(v, e) {
          if (!v.editable || A.menu.isOpen || A.dialog.open || handle.hasAttribute("data-dragging")) return false;
          const el = blockOf(v, e.target);
          if (el && el !== over) place(el); else if (!el && over && !e.target.closest?.(".blk-h")) hide();
          return false;
        },
        mouseleave(_v, e) { if (over && !e.relatedTarget?.closest?.(".blk-h")) hide(); return false; },
        keydown() { if (over) hide(); return false; },
      },
    },
  });
  handle.addEventListener("mouseleave", (e) => { if (view && !view.dom.contains(e.relatedTarget)) hide(); });
  window.addEventListener("scroll", () => { if (over && !handle.hasAttribute("data-dragging")) hide(); }, { passive: true });

  A.blocks = { plugins: () => [plugin, PM.dropcursor.dropCursor({ class: "drop-line", width: 2 })], hide, handle };
})();
