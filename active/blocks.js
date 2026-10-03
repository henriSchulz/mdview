/* mdview active mode — moving blocks by dragging: a handle shows beside the
 * block the pointer is over (only then); dragged, the block itself is the
 * picture under the pointer and a line shows where it will go (ProseMirror's
 * drop cursor). Dropped, it moves there — one undo step, written back as it
 * stood in the file. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, NodeSelection, TextSelection, Selection } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const { Slice, Fragment } = PM.model;
  const handle = document.createElement("div");
  handle.className = "blk-h";
  handle.draggable = true;
  handle.setAttribute("aria-hidden", "true"); // (the keyboard moves blocks with the clipboard; the handle is for the pointer)
  handle.innerHTML = '<svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/><circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/><circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/></svg>';
  document.body.appendChild(handle);
  let over = null, view = null; // the block element the handle belongs to

  /* The block under the pointer: a block of the document, or one inside a list item or a quote.
   * The first block of a list item stands for the item (dragging it moves the item). */
  const blockOf = (v, target) => {
    let el = target && target.nodeType === 1 ? target : target && target.parentElement;
    while (el && el !== v.dom && !(el.parentElement && el.parentElement.matches(".pm, li, .li-body, blockquote, ul, ol") && !el.matches(".li-body, input"))) el = el.parentElement;
    if (!el || el === v.dom || !v.dom.contains(el)) return null;
    const holder = el.parentElement.matches(".li-body") ? el.parentElement.parentElement : el.parentElement;
    if (holder.matches("li") && !el.previousElementSibling) el = holder; // the item itself
    if (el.classList.contains("hid") || el.classList.contains("none") || el.dataset.kind === "footnotes" || !el.pmViewDesc || !el.pmViewDesc.node) return null;
    return el;
  };
  function place(el) {
    over = el;
    const r = el.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(el).lineHeight) || 26;
    const first = el.matches("h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote") ? Math.min(r.height, line) : Math.min(r.height, 28);
    // left of the block; left of its bullet or checkbox for a list item
    handle.style.left = r.left - (el.matches("li") ? 56 : 32) + scrollX + "px"; // (clear of the highlight a selected block gets)
    handle.style.top = r.top + first / 2 - 9 + scrollY + "px";
    handle.dataset.on = "";
  }
  let leaving = 0;
  function hide() { clearTimeout(leaving); over = null; delete handle.dataset.on; }
  // the pointer left the block: the handle stays long enough to be reached across the gap beside the text
  function hideSoon() { clearTimeout(leaving); leaving = setTimeout(() => { if (!handle.matches(":hover") && !handle.hasAttribute("data-dragging")) hide(); }, 350); }

  /* ---------------------------------------------------------------- blocks selected as wholes
   * A click on a handle selects its block. From then on the keyboard works on blocks:
   *   ↑ ↓            the block before / after          Shift+↑ ↓   more blocks
   *   Ctrl+↑ ↓       the first / last block            (with Shift: up to there)
   *   Alt+↑ ↓        move what is selected up / down
   *   Ctrl+A         all blocks beside it, then all of the document
   *   Enter          into the block (its dialog, for an island); Esc: the caret back into it
   *   Backspace / Delete, Ctrl+C / X   delete, copy, cut
   * The state: positions before the block the selection started on and the one it reaches to
   * (siblings: both in the document, or both in the same list, item or quote). */
  const selKey = new PluginKey("blocksel");
  const selOf = (state) => selKey.getState(state);
  const usable = (node) => !!node && node.type.name !== "hidden" && !(node.type.name === "island" && node.attrs.virtual);
  // the range of a selection: { parent, start (position of the parent's content), a, b (indexes), from, to }
  function rangeOf(state, sel = selOf(state)) {
    if (!sel) return null;
    const doc = state.doc;
    if (sel.anchor > doc.content.size || sel.head > doc.content.size) return null;
    const $a = doc.resolve(sel.anchor), $h = doc.resolve(sel.head);
    if (!$a.nodeAfter || !$h.nodeAfter || $a.depth !== $h.depth || $a.start() !== $h.start()) return null;
    const a = Math.min($a.index(), $h.index()), b = Math.max($a.index(), $h.index());
    const from = Math.min(sel.anchor, sel.head), last = doc.resolve(Math.max(sel.anchor, sel.head));
    return { parent: $a.parent, start: $a.start(), a, b, from, to: last.pos + last.nodeAfter.nodeSize, head: $h.index() };
  }
  const posOfChild = (r, index) => { let pos = r.start; for (let i = 0; i < index; i++) pos += r.parent.child(i).nodeSize; return pos; };
  // a selection of blocks set: the editor's own selection goes to the block it reaches to
  // (A table is not selected as a node: the table plugin would turn that into a selection of
  // cells, and the blocks would be let go. The caret waits in its first cell instead.)
  const pmSel = (doc, head) => {
    const node = doc.nodeAt(head);
    return node && node.type.name !== "table" && NodeSelection.isSelectable(node) ? NodeSelection.create(doc, head) : Selection.near(doc.resolve(head + (node && node.type.name === "table" ? 3 : 0)), 1);
  };
  function setSel(state, anchor, head) {
    const tr = state.tr.setMeta(selKey, { anchor, head });
    tr.setSelection(pmSel(state.doc, head));
    return tr.scrollIntoView();
  }
  function selectBlock(v, pos, extend) {
    const cur = selOf(v.state);
    const $p = v.state.doc.resolve(pos);
    const same = cur && extend && v.state.doc.resolve(cur.anchor).start() === $p.start();
    v.dispatch(setSel(v.state, same ? cur.anchor : pos, pos));
    v.focus();
  }
  // the next block that can be selected, from index i in direction dir (or -1)
  const nextUsable = (r, i, dir) => { for (let k = i + dir; k >= 0 && k < r.parent.childCount; k += dir) if (usable(r.parent.child(k))) return k; return -1; };
  function keydown(v, e) {
    const sel = selOf(v.state), r = rangeOf(v.state, sel);
    if (!r) return false;
    const mod = e.ctrlKey || e.metaKey, up = e.key === "ArrowUp", down = e.key === "ArrowDown";
    const done = (tr) => { e.preventDefault(); v.dispatch(tr); return true; };
    if ((up || down) && e.altKey && !mod) { // the selected blocks change places with the one above / below
      const k = up ? nextUsable(r, r.a, -1) : nextUsable(r, r.b, 1);
      if (k < 0) { e.preventDefault(); return true; }
      const slice = v.state.doc.slice(r.from, r.to), size = r.to - r.from;
      const other = posOfChild(r, k), otherSize = r.parent.child(k).nodeSize;
      const tr = v.state.tr.delete(r.from, r.to);
      const at = up ? other : other + otherSize - size;
      tr.insert(at, slice.content);
      const shift = at - r.from;
      tr.setMeta(selKey, { anchor: sel.anchor + shift, head: sel.head + shift }).setMeta("step", true);
      tr.setSelection(pmSel(tr.doc, sel.head + shift));
      return done(tr.scrollIntoView());
    }
    if (up || down) {
      const dir = up ? -1 : 1;
      let k = mod ? (up ? nextUsable(r, -1, 1) : nextUsable(r, r.parent.childCount, -1)) : nextUsable(r, r.head, dir);
      if (k < 0) { // at the edge: without Shift the selection comes down to the block it stands on
        if (!e.shiftKey && sel.anchor !== sel.head) return done(setSel(v.state, sel.head, sel.head));
        e.preventDefault();
        return true;
      }
      const head = posOfChild(r, k);
      return done(setSel(v.state, e.shiftKey ? sel.anchor : head, head));
    }
    if (mod && e.key.toLowerCase() === "a") { // all beside it; then all blocks of the document
      const first = nextUsable(r, -1, 1), last = nextUsable(r, r.parent.childCount, -1);
      if (r.a === first && r.b === last && r.start > 0) {
        const top = { parent: v.state.doc, start: 0 }, f = nextUsable(top, -1, 1), l = nextUsable(top, v.state.doc.childCount, -1);
        return done(setSel(v.state, posOfChild(top, f), posOfChild(top, l)));
      }
      return done(setSel(v.state, posOfChild(r, first), posOfChild(r, last)));
    }
    if (e.key === "Escape" || (e.key === "Enter" && !mod)) {
      const node = v.state.doc.nodeAt(sel.head);
      if (e.key === "Enter" && node && node.isAtom) { e.preventDefault(); v.dispatch(v.state.tr.setMeta(selKey, null)); A.islands.open(v, sel.head); return true; }
      // the caret into the block: at its end
      const $in = v.state.doc.resolve(sel.head + (node ? node.nodeSize : 0));
      return done(v.state.tr.setMeta(selKey, null).setSelection(Selection.near($in, -1)));
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const tr = v.state.tr.deleteRange(r.from, r.to).setMeta(selKey, null).setMeta("step", true);
      if (!tr.doc.content.size || !tr.doc.firstChild) tr.insert(0, A.schema.nodes.paragraph.create());
      return done(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(r.from, tr.doc.content.size)), -1)).scrollIntoView());
    }
    if (mod && /^[cxv]$/i.test(e.key)) return false; // the clipboard's events do it
    if (mod || e.altKey || /^(Shift|Control|Alt|Meta|CapsLock|Tab)$/.test(e.key) || e.key.length > 1) return mod || e.altKey ? false : (e.preventDefault(), true);
    // a character typed: back to the text, at the end of the block; it is typed there
    const node = v.state.doc.nodeAt(sel.head);
    v.dispatch(v.state.tr.setMeta(selKey, null).setSelection(Selection.near(v.state.doc.resolve(sel.head + (node ? node.nodeSize : 0)), -1)));
    return false;
  }
  function toClipboard(v, e, cut) {
    const r = rangeOf(v.state);
    if (!r || !e.clipboardData) return false;
    const slice = v.state.doc.slice(r.from, r.to);
    e.preventDefault();
    e.clipboardData.setData("text/plain", A.clip.markdownOf(v.state, slice));
    const box = document.createElement("div");
    box.appendChild(A.clip.plugin.props.clipboardSerializer.serializeFragment(slice.content));
    e.clipboardData.setData("text/html", box.innerHTML);
    if (cut && v.editable) {
      const tr = v.state.tr.deleteRange(r.from, r.to).setMeta(selKey, null).setMeta("step", true);
      if (!tr.doc.content.size) tr.insert(0, A.schema.nodes.paragraph.create());
      v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(r.from, tr.doc.content.size)), -1)));
    }
    return true;
  }
  const selPlugin = new Plugin({
    key: selKey,
    state: {
      init: () => null,
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(selKey);
        if (meta !== undefined) return meta;
        if (!value) return null;
        if (tr.docChanged) { // it goes with its blocks, as long as they are there
          const next = { anchor: tr.mapping.map(value.anchor, 1), head: tr.mapping.map(value.head, 1) };
          return rangeOf(state, next) ? next : null;
        }
        return tr.selectionSet && !tr.getMeta("appendedTransaction") ? null : value; // the caret put somewhere: the blocks are let go
      },
    },
    props: {
      decorations(state) {
        const r = rangeOf(state);
        if (!r) return null;
        const decos = [];
        for (let i = r.a, pos = posOfChild(r, r.a); i <= r.b; pos += r.parent.child(i).nodeSize, i++) {
          if (usable(r.parent.child(i))) decos.push(Decoration.node(pos, pos + r.parent.child(i).nodeSize, { class: "blk-sel" }));
        }
        return DecorationSet.create(state.doc, decos);
      },
      attributes: (state) => (rangeOf(state) ? { class: "has-blocksel" } : null),
      handleKeyDown: keydown,
      handleDOMEvents: {
        copy: (v, e) => toClipboard(v, e, false),
        cut: (v, e) => toClipboard(v, e, true),
      },
    },
  });

  // a click into the empty space around the text lets the selected blocks go
  document.addEventListener("mousedown", (e) => {
    if (!view || e.button !== 0 || !selOf(view.state)) return;
    if (view.dom.contains(e.target) || e.target.closest?.(".blk-h, .tbl-h, .actmenu, #dlg, #dlg-scrim, #fmtbar, #linkpop, #atompop, #toolbar, #sidebar")) return;
    const sel = selOf(view.state), node = view.state.doc.nodeAt(sel.head);
    view.dispatch(view.state.tr.setMeta(selKey, null).setSelection(Selection.near(view.state.doc.resolve(sel.head + (node ? node.nodeSize : 0)), -1)));
  });
  handle.addEventListener("mousedown", (e) => e.stopPropagation());
  handle.addEventListener("click", (e) => {
    if (!view || !over || !over.isConnected || !over.pmViewDesc) return;
    selectBlock(view, over.pmViewDesc.posBefore, e.shiftKey);
  });
  /* Dragging by the handle. The move is the handle's own business from start to end: wherever
   * the pointer is (also beside the text, where the handle stands), a line shows the gap the
   * block will go to — before or after the block at the pointer's height — and letting go moves it. */
  let drag = null; // { from, to, slice, target: { pos, el, after } | null }
  const line = document.createElement("div");
  line.className = "blk-line";
  document.body.appendChild(line);
  handle.addEventListener("dragstart", (e) => {
    if (!view || !over || !over.isConnected) { e.preventDefault(); return; }
    const desc = over.pmViewDesc, pos = desc && desc.posBefore;
    const node = pos == null ? null : view.state.doc.nodeAt(pos);
    if (!node || node !== desc.node) { e.preventDefault(); return; }
    // all selected blocks, if this is one of them; else this one
    const sr = rangeOf(view.state), many = sr && pos >= sr.from && pos < sr.to;
    const from = many ? sr.from : pos, to = many ? sr.to : pos + node.nodeSize;
    drag = { from, to, slice: view.state.doc.slice(from, to), target: null };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", A.clip.markdownOf(view.state, drag.slice));
    const r = over.getBoundingClientRect();
    e.dataTransfer.setDragImage(over, Math.min(40, r.width / 2), Math.min(16, r.height / 2));
    handle.dataset.dragging = "";
  });
  // where it would go: the gap before or after the block at the pointer's height
  function targetAt(e) {
    const v = view, pm = v.dom.getBoundingClientRect();
    // (beside the text, the pointer counts as being over it: a little way in, where nested blocks begin too)
    const x = e.clientX < pm.left + 60 ? pm.left + 60 : Math.min(e.clientX, pm.right - 12), y = Math.max(pm.top + 1, Math.min(e.clientY, pm.bottom - 1));
    let el = blockOf(v, document.elementFromPoint(x, y));
    if (!el) { // between two blocks: the nearer one
      let best = null, d = Infinity;
      for (const c of v.dom.children) {
        if (!c.pmViewDesc || c.classList.contains("hid")) continue;
        const r = c.getBoundingClientRect(), dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (r.height && dist < d) { d = dist; best = c; }
      }
      el = best && blockOf(v, best);
    }
    // how far in the pointer is says how deep: left of a nested block, the block around it is meant
    const outer = (x0) => { let up = x0.parentElement; while (up && up !== v.dom && !(up.pmViewDesc && up.pmViewDesc.node && up.pmViewDesc.dom === up)) up = up.parentElement; return up && up !== v.dom ? up : null; };
    while (el && el.parentElement !== v.dom && e.clientX < el.getBoundingClientRect().left - 28 && outer(el)) el = outer(el);
    while (el) {
      const desc = el.pmViewDesc, r = el.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const pos = desc.posBefore + (after ? desc.node.nodeSize : 0);
      const $p = v.state.doc.resolve(pos);
      const inside = pos > drag.from && pos < drag.to;
      if (!inside && $p.parent.canReplace($p.index(), $p.index(), drag.slice.content)) {
        return pos === drag.from || pos === drag.to ? null : { pos, el, after }; // (where it is already: nowhere to go)
      }
      // it does not fit beside a list item (a table, a paragraph): into the item, at its end
      if (!inside && desc.node.type.name === "list_item" && after && e.clientX >= r.left - 28) {
        const end = desc.posBefore + desc.node.nodeSize - 1, $e = v.state.doc.resolve(end);
        if (!(end > drag.from && end < drag.to) && end !== drag.to && $e.parent.canReplace($e.index(), $e.index(), drag.slice.content)) return { pos: end, el, after: true };
      }
      // it does not fit there (a paragraph among list items): one level up
      if (inside) return null;
      el = outer(el);
    }
    return null;
  }
  function showLine(t) {
    if (!t) { delete line.dataset.on; return; }
    const r = t.el.getBoundingClientRect();
    // in the middle of the gap to the neighbour
    const sib = t.after ? t.el.nextElementSibling : t.el.previousElementSibling;
    const edge = t.after ? r.bottom : r.top;
    const other = sib && sib.getBoundingClientRect().height ? (t.after ? sib.getBoundingClientRect().top : sib.getBoundingClientRect().bottom) : edge + (t.after ? 8 : -8);
    line.style.left = r.left + scrollX + "px";
    line.style.width = r.width + "px";
    line.style.top = (edge + other) / 2 - 1 + scrollY + "px";
    line.dataset.on = "";
  }
  document.addEventListener("dragover", (e) => {
    if (!drag || !view) return;
    e.preventDefault(); // (a drop is possible everywhere while one of the editor's blocks is dragged)
    e.dataTransfer.dropEffect = "move";
    const t = targetAt(e);
    if ((t && t.pos) !== (drag.target && drag.target.pos)) { drag.target = t; showLine(t); }
  });
  document.addEventListener("drop", (e) => {
    if (!drag || !view) return;
    e.preventDefault();
    const d = drag, t = d.target;
    drag = null;
    showLine(null);
    if (!t) return;
    const tr = view.state.tr.delete(d.from, d.to);
    const at = tr.mapping.map(t.pos, t.pos <= d.from ? -1 : 1);
    tr.insert(at, d.slice.content);
    // what was moved stays selected as blocks: the keyboard can go on with it
    const size = d.to - d.from;
    let last = at;
    tr.doc.nodesBetween(at, at + size, (n, p, parent) => { if (parent === tr.doc.resolve(at).parent && p >= at) last = p; return false; });
    tr.setMeta(selKey, { anchor: at, head: last }).setMeta("uiEvent", "drop").setMeta("step", true);
    tr.setSelection(pmSel(tr.doc, last));
    view.dispatch(tr);
    view.focus();
  });
  handle.addEventListener("dragend", () => { drag = null; showLine(null); delete handle.dataset.dragging; hide(); });
  const plugin = new Plugin({
    key: new PluginKey("blocks"),
    view(v) { view = v; setTimeout(() => hookBelow(v), 0); return { update(now) { hookBelow(now); }, destroy() { hide(); if (view === v) view = null; } }; },
    props: {
      // while a block is dragged by its handle, the editor's own drop handling and drop line stay out of it
      handleDrop: () => !!drag,
      handleDOMEvents: {
        dragover(_v, e) { if (drag) e.stopImmediatePropagation(); return false; },
        mousemove(v, e) {
          if (!v.editable || A.menu.isOpen || A.dialog.open || handle.hasAttribute("data-dragging")) return false;
          // on the way to the handle the pointer crosses what lies left of the block (the list it is in):
          // the handle stays the block's while the pointer is beside it, at its height
          if (over && over.isConnected) {
            const r = over.getBoundingClientRect(), h = handle.getBoundingClientRect();
            if (e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4 && e.clientX < r.left + 6 && e.clientX >= h.left - 8) { clearTimeout(leaving); return false; }
          }
          const el = blockOf(v, e.target);
          if (el) { clearTimeout(leaving); if (el !== over) place(el); } else if (over && !e.target.closest?.(".blk-h")) hideSoon();
          return false;
        },
        mouseleave(_v, e) { if (over && !e.relatedTarget?.closest?.(".blk-h")) hideSoon(); return false; },
        keydown() { if (over) hide(); return false; },
      },
    },
  });
  handle.addEventListener("mouseenter", () => clearTimeout(leaving));
  handle.addEventListener("mouseleave", (e) => { if (view && !view.dom.contains(e.relatedTarget)) hideSoon(); });
  window.addEventListener("scroll", () => { if (over && !handle.hasAttribute("data-dragging")) hide(); }, { passive: true });

  /* A click below the document's last block: an empty line there, the caret in it (the one that
   * is there already, if the document ends in one). */
  function lineBelow(v) {
    const doc = v.state.doc;
    let end = doc.content.size, last = doc.lastChild;
    while (last && ((last.type.name === "island" && last.attrs.virtual) || last.type.name === "hidden")) { end -= last.nodeSize; last = doc.resolve(end).nodeBefore; }
    const tr = v.state.tr;
    if (last && last.type.name === "paragraph" && !last.content.size) tr.setSelection(TextSelection.create(doc, end - 1));
    else { tr.insert(end, A.schema.nodes.paragraph.create()); tr.setSelection(TextSelection.create(tr.doc, end + 1)); }
    v.dispatch(tr.scrollIntoView());
    v.focus();
  }
  let hooked = false;
  function hookBelow(v) { // (the column around the editor exists once there is a view)
    if (hooked || !v.dom.parentElement) return;
    hooked = true;
    v.dom.parentElement.addEventListener("mousedown", (e) => {
      if (!view || !view.editable || e.button !== 0 || view.dom.contains(e.target)) return;
      if (e.clientY <= view.dom.getBoundingClientRect().bottom) return; // beside or above the text: nothing
      e.preventDefault();
      lineBelow(view);
    });
  }

  A.blocks = { over: () => over, select: selectBlock, selection: (state) => rangeOf(state), selPlugin, plugins: () => [plugin, PM.dropcursor.dropCursor({ class: "drop-line", width: 2, color: false })], hide, handle };
})();
