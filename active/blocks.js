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
  const itemIn = (list, y) => { // the item of this list at that height (the nearest one)
    let best = null, d = Infinity;
    for (const li of list.children) {
      if (!li.matches("li")) continue;
      const r = li.getBoundingClientRect(), dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (dist < d) { d = dist; best = li; }
    }
    return best;
  };
  const blockOf = (v, target, y = null) => {
    let el = target && target.nodeType === 1 ? target : target && target.parentElement;
    // on a list itself (its bullets, its indent): the item at that height
    if (y != null && el && el.matches("ul, ol") && v.dom.contains(el)) el = itemIn(el, y) || el;
    while (el && el !== v.dom && !(el.parentElement && el.parentElement.matches(".pm, li, .li-body, blockquote, .callout-content, .col, ul, ol") && !el.matches(".li-body, input"))) el = el.parentElement;
    if (!el || el === v.dom || !v.dom.contains(el)) return null;
    const holder = el.parentElement.matches(".li-body") ? el.parentElement.parentElement : el.parentElement;
    if (holder.matches("li") && !el.previousElementSibling) el = holder; // the item itself
    if (el.classList.contains("hid") || el.classList.contains("none") || el.dataset.kind === "footnotes" || !el.pmViewDesc || !el.pmViewDesc.node) return null;
    return el;
  };
  /* Where the handle stands: close to the left of the block, inside the highlight a selected block
   * gets (active.css --blk-out is this distance); left
   * of its bullet or checkbox for a list item. In a column that is not the first, it stays in the
   * gap before that column (further left is the text of the column beside it). */
  function leftOf(el, r) {
    const left = r.left - (el.matches("li") || el.classList.contains("cols") ? 46 : 22), col = el.closest(".col"); // (a row of columns: further out than the handles of its first column's blocks)
    return col && col.previousElementSibling ? Math.max(left, col.getBoundingClientRect().left - 20) : left;
  }
  function place(el) {
    over = el;
    delete handle.dataset.group;
    delete handle.dataset.apart;
    handle.style.height = "";
    const r = el.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(el).lineHeight) || 26;
    const first = el.matches("h1, h2, h3, h4, h5, h6, p, ul, ol, li, blockquote") ? Math.min(r.height, line) : Math.min(r.height, 28);
    // left of the block; left of its bullet or checkbox for a list item
    handle.style.left = leftOf(el, r) + scrollX + "px";
    handle.style.top = r.top + first / 2 - 9 + scrollY + "px";
    handle.dataset.on = "";
  }
  /* Several blocks selected have one handle between them: it stands beside all of them, from the
   * first to the last, and dragging it takes them all. */
  function placeGroup(els, at = null) {
    if (view && ((selOf(view.state) || {}).more || []).length) { // picked one by one: the handle of the block under the pointer takes them all
      place(at && els.includes(at) ? at : els[0]);
      handle.dataset.group = "";
      handle.dataset.apart = "";
      return;
    }
    delete handle.dataset.apart;
    over = els[0];
    const a = els[0].getBoundingClientRect(), b = els[els.length - 1].getBoundingClientRect();
    handle.style.left = leftOf(els[0], a) + scrollX + "px";
    handle.style.top = a.top - 4 + scrollY + "px"; // (as far as the highlight of the selected blocks goes)
    handle.style.height = b.bottom - a.top + 8 + "px";
    handle.dataset.group = "";
    handle.dataset.on = "";
  }
  let leaving = 0;
  function hide() { clearTimeout(leaving); if (typeof rest === "function") rest(null); over = null; delete handle.dataset.on; }
  // the pointer left the block: the handle stays long enough to be reached across the gap beside the text
  function hideSoon() { clearTimeout(leaving); leaving = setTimeout(() => { if (!handle.matches(":hover") && !handle.hasAttribute("data-dragging")) hide(); }, 350); }

  /* ---------------------------------------------------------------- blocks selected as wholes
   * A click on a handle selects its block, and so does Esc in the text (the block the caret is
   * in; Esc or Enter again puts the caret back where it was). From then on the keyboard works on blocks:
   *   ↑ ↓            the block before / after          Shift+↑ ↓   more blocks
   *   Ctrl+↑ ↓       the first / last block            (with Shift: up to there)
   *   Alt+↑ ↓        move what is selected up / down   (with Shift: to the top / the end)
   *   Space          a new, empty block below, the caret in it   (with Shift: above)
   *   Ctrl+D         what is selected once more, below it
   *   Ctrl+A         all blocks beside it, then all of the document
   *   Enter          into the block (its dialog, for an island); Esc: the caret back into it
   *   Backspace / Delete, Ctrl+C / X   delete, copy, cut
   * The state: positions before the block the selection started on and the one it reaches to
   * (siblings: both in the document, or both in the same list, item or quote). */
  const selKey = new PluginKey("blocksel");
  const selOf = (state) => selKey.getState(state);
  // (a comment shows nothing: it is no block to select or to take by a handle)
  const usable = (node) => !!node && node.type.name !== "hidden" && !(node.type.name === "island" && (node.attrs.virtual || (node.attrs.kind === "html" && !String(node.attrs.raw || "").replace(/<!--[\s\S]*?-->/g, "").trim())));
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
  /* Beside the range, blocks picked one by one (Ctrl+click; a rectangle pulled inside a row of
   * columns): `more`, their positions. -> all selected blocks in the document's order: [{ pos, node }] */
  function pickedOf(state, sel = selOf(state)) {
    const r = rangeOf(state, sel);
    if (!r) return [];
    const out = [];
    for (let i = r.a, pos = posOfChild(r, r.a); i <= r.b; pos += r.parent.child(i).nodeSize, i++) if (usable(r.parent.child(i))) out.push({ pos, node: r.parent.child(i) });
    for (const p of sel.more || []) {
      const n = p <= state.doc.content.size ? state.doc.nodeAt(p) : null;
      if (n && usable(n) && !out.some((x) => x.pos === p)) out.push({ pos: p, node: n });
    }
    return out.sort((a, b) => a.pos - b.pos);
  }
  /* The selection for these blocks (positions), `head` the one the keyboard goes on from: a range
   * where they stand one after the other in the same place, else one of them and the others beside it. */
  // the columns of the row a block stands in that are picked whole (every block of theirs): { colsPos, cols, full: [column index…] } or null
  function fullColumns(doc, list, pos) {
    const c = A.columns.around(doc.resolve(pos));
    if (!c) return null;
    const full = [];
    let colPos = c.colsPos + 1;
    c.cols.forEach((col, _o, i) => {
      let p = colPos + 1, all = true, any = false;
      col.forEach((b) => { if (usable(b)) { any = true; if (!list.includes(p)) all = false; } p += b.nodeSize; });
      if (all && any) full.push(i);
      colPos += col.nodeSize;
    });
    return { colsPos: c.colsPos, cols: c.cols, full };
  }
  function selFor(doc, list, head) {
    list = [...new Set(list)].sort((a, b) => a - b);
    if (!list.length) return null;
    // every block of every column of a row picked: the row itself is what is picked (moved, it stays a row)
    for (const p of list.slice()) {
      if (!list.includes(p)) continue;
      const f = fullColumns(doc, list, p);
      if (!f || f.full.length !== f.cols.childCount) continue;
      const inRow = (x) => x > f.colsPos && x < f.colsPos + f.cols.nodeSize;
      if (inRow(head)) head = f.colsPos;
      list = list.filter((x) => !inRow(x)).concat(f.colsPos).sort((a, b) => a - b);
    }
    if (!list.includes(head)) head = list[list.length - 1];
    const $ = list.map((p) => doc.resolve(p));
    const row = $.every((x, i) => x.depth === $[0].depth && x.start() === $[0].start() && (!i || x.index() === $[i - 1].index() + 1));
    return row ? { anchor: head === list[0] ? list[list.length - 1] : list[0], head: head === list[0] ? list[0] : list[list.length - 1] } : { anchor: head, head, more: list.filter((p) => p !== head) };
  }
  // Ctrl+click on a block: it joins what is selected, or leaves it
  function toggle(v, pos) {
    const doc = v.state.doc, node = doc.nodeAt(pos);
    if (!node || !usable(node)) return false;
    const item = (n) => n.type.name === "list_item";
    let list = pickedOf(v.state);
    if (list.some((x) => x.pos === pos)) list = list.filter((x) => x.pos !== pos);
    else {
      // not a block and one inside it, and not list items among other blocks: what is clicked then begins anew
      list = list.filter((x) => !(x.pos < pos && pos < x.pos + x.node.nodeSize) && !(pos < x.pos && x.pos < pos + node.nodeSize));
      if (list.some((x) => item(x.node) !== item(node))) list = [];
      list.push({ pos, node });
    }
    const sel = selFor(doc, list.map((x) => x.pos), pos);
    const tr = v.state.tr.setMeta(selKey, sel);
    v.dispatch(sel ? tr.setSelection(pmSel(doc, sel.head)) : tr.setSelection(Selection.near(doc.resolve(pos + node.nodeSize), -1)));
    v.focus();
    return true;
  }
  function setSel(state, anchor, head) {
    const tr = state.tr.setMeta(selKey, { anchor, head });
    tr.setSelection(pmSel(state.doc, head));
    return tr.scrollIntoView();
  }
  /* Blocks once more, made of their Markdown as pasted ones would be (so a copy is a block of its
   * own in the file, not a second mention of the first). -> a Fragment, or null */
  function copyOf(state, from, to) {
    const first = state.doc.nodeAt(from);
    let made = A.clip.blocksOf(state, A.clip.markdownOf(state, state.doc.slice(from, to)));
    if (first && first.type.name === "list_item" && made.length === 1 && made[0].type.name !== "list_item") made = made[0].content.content;
    return made.length ? Fragment.from(made) : null;
  }
  /* Esc in the text: the block the caret is in, as a whole — the item in a list, the table around
   * a cell, else the paragraph or heading itself. Where the caret was is kept for the way back. */
  function selectAt(v) {
    const sel = v.state.selection, $f = sel.$from;
    if (!v.editable || !sel.empty || !$f.depth || document.querySelector("#findbar[data-open], #outline[data-open]")) return false;
    let d = $f.depth;
    for (let k = d; k > 0; k--) if ($f.node(k).type.name === "table") d = k;
    if (d > 1 && $f.node(d - 1).type.name === "list_item" && $f.index(d - 1) === 0) d--;
    const pos = $f.before(d);
    if (!usable(v.state.doc.nodeAt(pos))) return false;
    const tr = v.state.tr.setMeta(selKey, { anchor: pos, head: pos, back: sel.from });
    v.dispatch(tr.setSelection(pmSel(v.state.doc, pos)));
    return true;
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
    if (sel.more && sel.more.length) { // blocks picked one by one, not standing together
      const P = pickedOf(v.state, sel);
      if ((up || down) && e.altKey && !mod) { // moved: first they come together, where the first of them stands
        let all = Fragment.empty;
        for (const x of P) all = all.addToEnd(x.node);
        const tr = v.state.tr;
        for (const x of P.slice().reverse()) tr.delete(x.pos, x.pos + x.node.nodeSize);
        const at = tr.mapping.map(P[0].pos, -1), $at = tr.doc.resolve(at);
        if (!$at.parent.canReplace($at.index(), $at.index(), all)) { e.preventDefault(); return true; } // (they do not all fit where the first stands)
        tr.insert(at, all);
        let last = at;
        for (let i = 0, p = at; i < all.childCount; p += all.child(i).nodeSize, i++) last = p;
        tr.setMeta(selKey, { anchor: at, head: last }).setMeta("step", true);
        return done(tr.setSelection(pmSel(tr.doc, last)).scrollIntoView());
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        const tr = v.state.tr;
        for (const x of P.slice().reverse()) tr.deleteRange(x.pos, x.pos + x.node.nodeSize);
        if (!tr.doc.content.size || !tr.doc.firstChild) tr.insert(0, A.schema.nodes.paragraph.create());
        tr.setMeta(selKey, null).setMeta("step", true);
        return done(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.mapping.map(P[0].pos), tr.doc.content.size)), -1)).scrollIntoView());
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") { // once more, below the last of them
        if (!v.editable) return false;
        const end = P[P.length - 1], at = end.pos + end.node.nodeSize, $at = v.state.doc.resolve(at);
        let copies = Fragment.empty;
        for (const x of P) { const c = copyOf(v.state, x.pos, x.pos + x.node.nodeSize); if (c) copies = copies.append(c); }
        if (!copies.childCount || !$at.parent.canReplace($at.index(), $at.index(), copies)) { e.preventDefault(); return true; }
        const tr = v.state.tr.insert(at, copies).setMeta("step", true);
        let last = at;
        for (let i = 0, p = at; i < copies.childCount; p += copies.child(i).nodeSize, i++) last = p;
        tr.setMeta(selKey, { anchor: at, head: last });
        return done(tr.setSelection(pmSel(tr.doc, last)).scrollIntoView());
      }
      // (the arrows, Space, Enter and Esc go on from the block picked last, as for a range of one)
    }
    if ((up || down) && e.altKey && !mod) { // the selected blocks change places with the one above / below
      let k = up ? nextUsable(r, r.a, -1) : nextUsable(r, r.b, 1);
      if (k < 0) { e.preventDefault(); return true; }
      if (e.shiftKey) { // all the way: before the first block there is, behind the last
        k = up ? nextUsable(r, -1, 1) : nextUsable(r, r.parent.childCount, -1);
        const slice = v.state.doc.slice(r.from, r.to), size = r.to - r.from, edge = posOfChild(r, k);
        const at = up ? edge : edge + r.parent.child(k).nodeSize - size;
        const tr = v.state.tr.delete(r.from, r.to).insert(at, slice.content), shift = at - r.from;
        tr.setMeta(selKey, { anchor: sel.anchor + shift, head: sel.head + shift }).setMeta("step", true);
        return done(tr.setSelection(pmSel(tr.doc, sel.head + shift)).scrollIntoView());
      }
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
      // the caret into the block: where it was when Esc took the block, else at its end
      const back = sel.back != null && sel.anchor === sel.head && sel.back > sel.head && sel.back < sel.head + (node ? node.nodeSize : 0);
      const $in = v.state.doc.resolve(back ? sel.back : sel.head + (node ? node.nodeSize : 0));
      return done(v.state.tr.setMeta(selKey, null).setSelection(back && $in.parent.inlineContent ? TextSelection.create(v.state.doc, sel.back) : Selection.near($in, -1)));
    }
    if (e.key === " " && !mod && !e.altKey) { // an empty block below (Shift: above), the caret in it
      if (!v.editable) return false;
      const like = r.parent.child(e.shiftKey ? r.a : r.b), S = A.schema.nodes;
      const fresh = like.type === S.list_item
        ? S.list_item.create({ markup: like.attrs.markup, task: like.attrs.task == null ? null : " " }, S.paragraph.create())
        : S.paragraph.create();
      const index = e.shiftKey ? r.a : r.b + 1, at = e.shiftKey ? r.from : r.to;
      if (!r.parent.canReplaceWith(index, index, fresh.type)) { e.preventDefault(); return true; }
      const tr = v.state.tr.insert(at, fresh).setMeta(selKey, null).setMeta("step", true);
      return done(tr.setSelection(Selection.near(tr.doc.resolve(at + 1), 1)).scrollIntoView());
    }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") { // once more, below; the copies are selected
      if (!v.editable) return false;
      const copies = copyOf(v.state, r.from, r.to);
      if (!copies || !r.parent.canReplaceWith(r.b + 1, r.b + 1, copies.firstChild.type)) { e.preventDefault(); return true; }
      const tr = v.state.tr.insert(r.to, copies).setMeta("step", true);
      let last = r.to;
      for (let i = 0, p = r.to; i < copies.childCount; p += copies.child(i).nodeSize, i++) last = p;
      tr.setMeta(selKey, { anchor: r.to, head: last });
      return done(tr.setSelection(pmSel(tr.doc, last)).scrollIntoView());
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
    const r = rangeOf(v.state), P = pickedOf(v.state);
    if (!r || !e.clipboardData) return false;
    const apart = P.length && (selOf(v.state).more || []).length; // picked one by one: each of them, one after the other
    let all = Fragment.empty;
    if (apart) for (const x of P) all = all.addToEnd(x.node);
    const slice = apart ? new Slice(all, 0, 0) : v.state.doc.slice(r.from, r.to);
    e.preventDefault();
    e.clipboardData.setData("text/plain", A.clip.markdownOf(v.state, slice));
    const box = document.createElement("div");
    box.appendChild(A.clip.plugin.props.clipboardSerializer.serializeFragment(slice.content));
    e.clipboardData.setData("text/html", box.innerHTML);
    if (cut && v.editable) {
      const tr = v.state.tr;
      if (apart) for (const x of P.slice().reverse()) tr.deleteRange(x.pos, x.pos + x.node.nodeSize); else tr.deleteRange(r.from, r.to);
      tr.setMeta(selKey, null).setMeta("step", true);
      if (!tr.doc.content.size) tr.insert(0, A.schema.nodes.paragraph.create());
      v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(r.from, tr.doc.content.size)), -1)));
    }
    return true;
  }
  let drawnDoc = null; // the document the page shows (see decorations)
  const selPlugin = new Plugin({
    view(v) {
      drawnDoc = v.state.doc;
      return { update(now, prev) {
        const doc = now.state.doc;
        drawnDoc = doc;
        if (prev.doc !== doc && pickedOf(now.state).length) requestAnimationFrame(() => { if (now.state.doc === doc && !now.isDestroyed) now.dispatch(now.state.tr.setMeta("addToHistory", false)); });
      } };
    },
    key: selKey,
    state: {
      init: () => null,
      apply(tr, value, _old, state) {
        const meta = tr.getMeta(selKey);
        if (meta !== undefined) return meta;
        if (!value) return null;
        if (tr.docChanged) { // it goes with its blocks, as long as they are there
          const a = tr.mapping.mapResult(value.anchor, 1), h = tr.mapping.mapResult(value.head, 1);
          if (a.deletedAfter || h.deletedAfter) return null; // (undone, deleted: what stands there now was never selected)
          const more = (value.more || []).map((p) => tr.mapping.mapResult(p, 1)).filter((m) => !m.deletedAfter).map((m) => m.pos);
          const next = { anchor: a.pos, head: h.pos, ...(value.back != null ? { back: tr.mapping.map(value.back) } : null), ...(more.length ? { more } : null) };
          return rangeOf(state, next) ? next : null;
        }
        return tr.selectionSet && !tr.getMeta("appendedTransaction") ? null : value; // the caret put somewhere: the blocks are let go
      },
    },
    props: {
      decorations(state) {
        const P = pickedOf(state);
        if (!P.length) return null;
        // Blocks that follow each other are one box (active.css): each reaches up over the gap to the
        // one before it. How far is measured — the gap is the blocks' margins, and those differ (a
        // formula, a table, a heading) — and handed over as --up: the gap less the 4 px each of the
        // two reaches into it already.
        // (only when what is drawn is this document: after a change the blocks are measured a frame later)
        const view = A.view.pm;
        const rectAt = (pos) => { try { const d = view && drawnDoc === state.doc ? view.nodeDOM(pos) : null; return d && d.nodeType === 1 ? d.getBoundingClientRect() : null; } catch (e) { return null; } };
        return DecorationSet.create(state.doc, P.map((x, i) => {
          const before = i > 0 && P[i - 1].pos + P[i - 1].node.nodeSize === x.pos ? rectAt(P[i - 1].pos) : null, here = before ? rectAt(x.pos) : null;
          const up = before && here ? Math.max(0, Math.round((here.top - before.bottom - 8) * 10) / 10) : null;
          return Decoration.node(x.pos, x.pos + x.node.nodeSize, up == null ? { class: "blk-sel" } : { class: "blk-sel", style: `--up: ${up}px` });
        }));
      },
      attributes: (state) => (rangeOf(state) ? { class: "has-blocksel" } : null),
      handleKeyDown: keydown,
      handleDOMEvents: {
        // Ctrl+click on a block: it joins the selected blocks, or leaves them (a link keeps its own Ctrl+click)
        mousedown(v, e) {
          if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.target.closest?.("a[href], .task")) return false;
          const el = blockOf(v, e.target, e.clientY);
          if (!el || !el.pmViewDesc) return false;
          e.preventDefault();
          return toggle(v, el.pmViewDesc.posBefore);
        },
        copy: (v, e) => toClipboard(v, e, false),
        cut: (v, e) => toClipboard(v, e, true),
      },
    },
  });

  // what floats over or stands beside the text: a press there is neither a click into the empty space nor the start of a rectangle
  const CHROME = ".blk-h, .tbl-h, .col-grip, .actmenu, #dlg, #dlg-scrim, #settings, #settings-scrim, #fmtbar, #linkpop, #atompop, #notepop, #toolbar, #sidebar, #sb-grip, #settings-btn, #rpanel, #overview, #outline, #findbar, #ctxmenu, #zoom, #toast, #acttip, #apptip";

  /* ---------------------------------------------------------------- a rectangle pulled over blocks
   * Pressed in the empty space beside or below the text and pulled, the pointer draws a rectangle;
   * the blocks of the document it reaches are selected as wholes (not the text in them), and stay
   * so when it is let go: the keyboard works on them. Near the window's upper and lower edge the
   * page scrolls along. A press let go where it was is a click: the blocks are let go, and below
   * the last block an empty line is made. */
  const band = document.createElement("div");
  band.className = "blk-band";
  document.body.appendChild(band);
  const THRESHOLD = 4; // px the pointer moves before it is a pull and no click
  let rubber = null;   // { x, y (page), pulled, scroll (px per frame), cx, cy (client), frame }
  // may a rectangle start where this press is?
  const bare = (e) => !!view && (e.target === view.dom || (view.dom.contains(e.target) && e.target.matches?.(".cols, .col"))); // no block under the pointer
  const rubberAt = (e) => !!view && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && document.body.dataset.view === "active" && (!view.dom.contains(e.target) || bare(e)) &&
    !e.target.closest?.(CHROME) && e.clientX < document.documentElement.clientWidth && !A.menu.isOpen && !A.dialog.open;
  // the blocks of the document the rectangle (page coordinates) reaches: [first, last] positions, or null
  function reached(x0, y0, x1, y1) {
    const pm = view.dom.getBoundingClientRect();
    if (Math.max(x0, x1) - scrollX < pm.left || Math.min(x0, x1) - scrollX > pm.right) return null; // (not as far as the text yet)
    const top = Math.min(y0, y1) - scrollY, bottom = Math.max(y0, y1) - scrollY;
    let first = null, last = null;
    for (const c of view.dom.children) {
      const d = c.pmViewDesc;
      if (!d || !d.node || d.dom !== c || !usable(d.node) || c.classList.contains("hid")) continue;
      const r = c.getBoundingClientRect();
      if (!r.height || r.bottom < top || r.top > bottom) continue;
      if (first == null) first = d.posBefore;
      last = d.posBefore;
    }
    return first == null ? null : [first, last];
  }
  /* Only a row of columns reached: the blocks in its columns the rectangle touches (they are picked
   * one by one, column by column). -> their positions, or null */
  function reachedIn(pos, x0, y0, x1, y1) {
    const row = view.nodeDOM(pos);
    if (!row || !row.classList || !row.classList.contains("cols")) return null;
    const L = Math.min(x0, x1) - scrollX, R = Math.max(x0, x1) - scrollX, T = Math.min(y0, y1) - scrollY, B = Math.max(y0, y1) - scrollY, out = [];
    for (const col of row.children) for (const c of col.children) {
      const d = c.pmViewDesc;
      if (!d || !d.node || d.dom !== c || !usable(d.node)) continue;
      const r = c.getBoundingClientRect();
      if (r.height && r.right >= L && r.left <= R && r.bottom >= T && r.top <= B) out.push(d.posBefore);
    }
    return out.length ? out : null;
  }
  function pull() {
    const r = rubber, x = r.cx + scrollX, y = r.cy + scrollY;
    band.style.left = Math.min(r.x, x) + "px";
    band.style.top = Math.min(r.y, y) + "px";
    band.style.width = Math.abs(x - r.x) + "px";
    band.style.height = Math.abs(y - r.y) + "px";
    const got = reached(r.x, r.y, x, y), cur = selOf(view.state);
    // from the block the pull began at to the one it has reached (pulled upwards: the other way round)
    const anchor = got && (y >= r.y ? got[0] : got[1]), head = got && (y >= r.y ? got[1] : got[0]);
    if (!got) { if (cur) view.dispatch(view.state.tr.setMeta(selKey, null)); return; }
    const inner = got[0] === got[1] ? reachedIn(got[0], r.x, r.y, x, y) : null;
    const next = inner ? selFor(view.state.doc, inner, y >= r.y ? inner[inner.length - 1] : inner[0]) : { anchor, head };
    if (cur && cur.anchor === next.anchor && cur.head === next.head && String(cur.more || "") === String(next.more || "")) return;
    const tr = view.state.tr.setMeta(selKey, next);
    view.dispatch(tr.setSelection(pmSel(view.state.doc, next.head)));
  }
  function scrollAlong() {
    if (!rubber) return;
    rubber.frame = 0;
    const edge = 48, y = rubber.cy, speed = y < edge ? -Math.ceil((edge - y) / 4) : y > innerHeight - edge ? Math.ceil((y - (innerHeight - edge)) / 4) : 0;
    if (!speed) return;
    const before = scrollY;
    window.scrollBy({ top: speed, behavior: "instant" });
    if (scrollY !== before) { pull(); rubber.frame = requestAnimationFrame(scrollAlong); }
  }
  function endRubber(e, cancel = false) {
    const r = rubber;
    if (!r) return;
    rubber = null;
    cancelAnimationFrame(r.frame);
    delete band.dataset.on;
    document.body.classList.remove("blk-pulling");
    if (r.pulled || cancel || !view) return;
    if (r.inText && e) { // a click between blocks: the caret where the editor would have put it
      const p = view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (p) view.dispatch(view.state.tr.setMeta(selKey, null).setSelection(Selection.near(view.state.doc.resolve(p.pos), 1)));
      view.focus();
      return;
    }
    // a click: below the last block an empty line, the caret in it
    if (view.editable && e && e.clientY > view.dom.getBoundingClientRect().bottom && view.dom.parentElement && view.dom.parentElement.contains(e.target)) lineBelow(view);
  }
  document.addEventListener("mousedown", (e) => {
    if (!rubberAt(e)) return;
    e.preventDefault(); // (no text is selected by the pull)
    const inText = bare(e);
    if (inText) e.stopPropagation(); // (the editor does not take the press for a click of its own; let go where it was, it gets its caret below)
    hide();
    rubber = { x: e.clientX + scrollX, y: e.clientY + scrollY, cx: e.clientX, cy: e.clientY, pulled: false, frame: 0, inText };
    if (!view.hasFocus()) view.focus(); // (blocks selected before are let go by the click into the empty space, below)
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (!rubber || !view) return;
    if (e.buttons === 0) { endRubber(e, true); return; } // (let go outside the window)
    rubber.cx = e.clientX;
    rubber.cy = e.clientY;
    if (!rubber.pulled) {
      if (Math.hypot(e.clientX + scrollX - rubber.x, e.clientY + scrollY - rubber.y) < THRESHOLD) return;
      rubber.pulled = true;
      band.dataset.on = "";
      document.body.classList.add("blk-pulling");
    }
    e.preventDefault();
    pull();
    if (!rubber.frame) rubber.frame = requestAnimationFrame(scrollAlong);
  }, true);
  document.addEventListener("mouseup", (e) => { if (rubber && e.button === 0) endRubber(e); }, true);
  window.addEventListener("blur", () => endRubber(null, true));
  document.addEventListener("keydown", (e) => { if (rubber && rubber.pulled && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endRubber(null, true); if (view && selOf(view.state)) view.dispatch(view.state.tr.setMeta(selKey, null)); } }, true);

  // a click into the empty space around the text lets the selected blocks go
  document.addEventListener("mousedown", (e) => {
    if (!view || e.button !== 0 || !selOf(view.state)) return;
    if (view.dom.contains(e.target) || e.target.closest?.(CHROME)) return;
    const sel = selOf(view.state), node = view.state.doc.nodeAt(sel.head);
    view.dispatch(view.state.tr.setMeta(selKey, null).setSelection(Selection.near(view.state.doc.resolve(sel.head + (node ? node.nodeSize : 0)), -1)));
  });
  handle.addEventListener("mousedown", (e) => e.stopPropagation());
  handle.addEventListener("click", (e) => {
    if (!view || !over || !over.isConnected || !over.pmViewDesc) return;
    if (e.ctrlKey || e.metaKey) { toggle(view, over.pmViewDesc.posBefore); return; } // (with Ctrl: this block joins the selected ones, or leaves them)
    if (handle.hasAttribute("data-group")) { view.focus(); return; } // (the handle of all that is selected: they stay selected)
    selectBlock(view, over.pmViewDesc.posBefore, e.shiftKey);
  });
  /* Dragging by the handle. The move is the handle's own business from start to end: wherever
   * the pointer is (also beside the text, where the handle stands), a line shows the gap the
   * block will go to — before or after the block at the pointer's height — and letting go moves it. */
  let drag = null; // { from, to, slice, items, list, target: { pos, wrap, x, y, w } | null }
  const line = document.createElement("div");
  line.className = "blk-line";
  document.body.appendChild(line);
  const isList = (node) => !!node && /_list$/.test(node.type.name);
  handle.addEventListener("dragstart", (e) => {
    if (!view || !over || !over.isConnected) { e.preventDefault(); return; }
    const desc = over.pmViewDesc, pos = desc && desc.posBefore;
    const node = pos == null ? null : view.state.doc.nodeAt(pos);
    if (!node || node !== desc.node) { e.preventDefault(); return; }
    // all selected blocks, if this is one of them; else this one
    const P = pickedOf(view.state), many = P.some((x) => x.pos === pos);
    // what goes, as stretches of the document (blocks standing together are one stretch)
    const ranges = [];
    for (const x of many ? P : [{ pos, node }]) {
      const last = ranges[ranges.length - 1];
      if (last && last.to === x.pos) last.to = x.pos + x.node.nodeSize; else ranges.push({ from: x.pos, to: x.pos + x.node.nodeSize });
    }
    const from = ranges[0].from, to = ranges[0].to;
    let all = Fragment.empty;
    for (const x of many ? P : [{ pos, node }]) all = all.addToEnd(x.node);
    let slice = ranges.length === 1 ? view.state.doc.slice(from, to) : new Slice(all, 0, 0);
    // whole columns of one row, two or more of them and nothing else: they go as columns, a row of their own
    if (many && P.length > 1) {
      const list = P.map((x) => x.pos), f = fullColumns(view.state.doc, list, list[0]);
      const inFull = (p) => { const c = A.columns.around(view.state.doc.resolve(p)); return !!c && c.colsPos === f.colsPos && f.full.includes(c.index); };
      if (f && f.full.length >= 2 && list.every(inFull)) slice = new Slice(Fragment.from(A.schema.nodes.columns.create(null, f.full.map((i) => f.cols.child(i)))), 0, 0);
    }
    // list items carry the kind of list they come from: outside a list they need one around them
    let items = slice.content.childCount > 0;
    slice.content.forEach((n) => { if (n.type.name !== "list_item") items = false; });
    const parent = view.state.doc.resolve(from).parent;
    // how far in the pointer is says how deep the block goes — measured from where it was taken:
    // moved straight up or down it keeps its depth, moved right it goes deeper, left further out
    const dx = e.clientX ? over.getBoundingClientRect().left - e.clientX : 0;
    let cols = false; // a row of columns among them: it goes beside nothing (no columns in columns)
    slice.content.forEach((n) => { if (n.type.name === "columns") cols = true; });
    drag = { from, to, ranges, slice, items, cols, dx, list: items && isList(parent) ? parent : null, target: null };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", A.clip.markdownOf(view.state, slice));
    const r = over.getBoundingClientRect();
    // the picture under the pointer: the block — or all the blocks that go, as they stand
    const els = many ? groupEls(view.state) : null;
    if (els) {
      const ghost = ghostOf(els);
      e.dataTransfer.setDragImage(ghost, Math.max(0, Math.min(e.clientX - r.left + 10, ghost.offsetWidth - 10)), Math.max(0, Math.min(e.clientY - r.top + 6, ghost.offsetHeight - 10)));
      setTimeout(() => ghost.remove(), 0);
    } else e.dataTransfer.setDragImage(over, Math.min(40, r.width / 2), Math.min(16, r.height / 2));
    // (after the picture is taken:) the selected blocks stand back where they are while they are dragged.
    // By a class on the page — the editor's own elements are not touched, it would draw them anew
    if (els) setTimeout(() => { if (drag) document.body.classList.add("blk-dragging"); }, 0);
    handle.dataset.dragging = "";
  });
  // the elements of the blocks selected (two or more), or null
  function groupEls(state) {
    const els = [];
    for (const x of view ? pickedOf(state) : []) { const dom = view.nodeDOM(x.pos); if (dom && dom.nodeType === 1) els.push(dom); }
    return els.length > 1 ? els : null;
  }
  /* What is dragged, as a picture: the blocks as they stand, one under the other, on a card. A long
   * selection is shown by its beginning. */
  function ghostOf(els) {
    const box = document.createElement("div"), inner = box.appendChild(document.createElement("div"));
    box.className = "blk-ghost";
    inner.className = view.dom.className.replace(/\b(has-blocksel|ProseMirror-focused)\b/g, "");
    inner.contentEditable = "false";
    box.style.width = view.dom.getBoundingClientRect().width + "px";
    let list = null; // items stand in a list like the one they come from
    for (const el of els) {
      const copy = el.cloneNode(true);
      copy.classList.remove("blk-sel", "ProseMirror-selectednode");
      if (el.matches("li")) {
        if (!list || list.dataset.of !== String(els.indexOf(el) - 1)) list = inner.appendChild(el.parentElement.cloneNode(false));
        list.dataset.of = String(els.indexOf(el));
        list.appendChild(copy);
      } else { list = null; inner.appendChild(copy); }
    }
    document.body.appendChild(box);
    return box;
  }

  /* Where it would go. The block at the pointer's height says between which blocks; how far in
   * the pointer is says how deep:
   *   list items   — beside an item (before / after it), under an item (pointer right of its
   *                  text start: its first sub-item, or a new sub-list), or out a level (pointer
   *                  left of the item); outside any list they get a list of their own
   *   other blocks — before / after the block; over an item's text, into the item at its end
   * -> { pos, wrap (the items need a list around them), x, y, w (the line) } or null */
  const INDENT = 28;
  const descOf = (el) => (el && el.pmViewDesc && el.pmViewDesc.node && el.pmViewDesc.dom === el ? el.pmViewDesc : null);
  const outerOf = (v, el) => { let up = el.parentElement; while (up && up !== v.dom && !descOf(up)) up = up.parentElement; return up && up !== v.dom ? up : null; };
  const liOf = (v, el) => { while (el && el !== v.dom && !(descOf(el) && descOf(el).node.type.name === "list_item")) el = el.parentElement; return el && el !== v.dom ? el : null; };
  function targetAt(e) {
    const v = view, doc = v.state.doc, pm = v.dom.getBoundingClientRect();
    // (beside the text, the pointer counts as being over it: a little way in, where nested blocks begin too)
    const x = e.clientX < pm.left + 60 ? pm.left + 60 : Math.min(e.clientX, pm.right - 12), y = Math.max(pm.top + 1, Math.min(e.clientY, pm.bottom - 1));
    let el = blockOf(v, document.elementFromPoint(x, y), y);
    if (!el) { // between two blocks: the nearer one
      let best = null, d = Infinity;
      for (const c of v.dom.children) {
        if (!descOf(c) || c.classList.contains("hid")) continue;
        const r = c.getBoundingClientRect(), dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        if (r.height && dist < d) { d = dist; best = c; }
      }
      el = best;
    }
    if (!el) return null;
    const within = (pos) => drag.ranges.some((r) => pos > r.from && pos < r.to);
    const fits = (pos, content) => { const $p = doc.resolve(pos); return $p.parent.canReplace($p.index(), $p.index(), content); };
    const made = (pos, wrap, x0, y0) => (within(pos) || (!wrap && drag.ranges.length === 1 && (pos === drag.from || pos === drag.to)) ? null : { pos, wrap, x: x0, y: y0, w: Math.max(40, pm.right - x0) });
    // the edge between an element and its neighbour (the middle of the gap)
    const edge = (elx, after) => {
      const r = elx.getBoundingClientRect(), sib = after ? elx.nextElementSibling : elx.previousElementSibling, sr = sib && sib.getBoundingClientRect();
      return sr && sr.height ? ((after ? r.bottom : r.top) + (after ? sr.top : sr.bottom)) / 2 : after ? r.bottom + 3 : r.top - 3;
    };
    const wrapped = PM.model.Fragment.from(drag.list ? drag.list.type.create(drag.list.attrs, drag.slice.content) : A.schema.nodes.bullet_list.create(null, drag.slice.content));

    /* To the side of a block of the document, or of a column of a row: beside it, as a column.
     * (At a block's right end, or at the very left of the text; at a column's own edges.) */
    if (!drag.cols) {
      let top = el;
      while (top.parentElement !== v.dom && outerOf(v, top)) top = outerOf(v, top);
      const d = top.parentElement === v.dom ? descOf(top) : null;
      if (d && !drag.ranges.some((x) => d.posBefore >= x.from && d.posBefore < x.to) && e.clientY >= top.getBoundingClientRect().top && e.clientY <= top.getBoundingClientRect().bottom) {
        const r = top.getBoundingClientRect(), mk = (pos, side, x0, box) => ({ pos, side, wrap: false, x: x0, y: box.top, h: box.height, w: 2 });
        if (d.node.type.name === "columns") {
          for (const c of top.children) {
            const cd = descOf(c);
            if (!cd || cd.node.type.name !== "column") continue;
            const a = c.getBoundingClientRect(), alone = cd.posBefore + 1 === drag.from && cd.posBefore + cd.node.nodeSize - 1 === drag.to; // (all its column holds: it would only change places with itself)
            if (alone || e.clientX < a.left - 14 || e.clientX > a.right + 14) continue;
            if (e.clientX < a.left + 16) return mk(cd.posBefore, -1, a.left - 14, r);
            if (e.clientX > a.right - 16) return mk(cd.posBefore, 1, a.right + 12, r);
          }
        } else if (usable(d.node) && !(drag.items && isList(d.node))) { // (items over a list: how far in the pointer is says how deep, nothing else)
          if (e.clientX > r.right - Math.max(40, r.width * 0.16) && e.clientX <= pm.right + 24) return mk(d.posBefore, 1, r.right + 8, r);
          // (a list's left is where its bullets are pointed at: no column from there)
          if (!isList(d.node) && e.clientX >= pm.left - 6 && e.clientX < r.left + 16) return mk(d.posBefore, -1, r.left - 10, r);
        }
      }
    }
    const xe = e.clientX + drag.dx; // where the dragged block's left edge would be
    if (drag.items) {
      // the deepest item at this height
      const row = document.elementFromPoint(pm.right - 24, y);
      let li = liOf(v, row && v.dom.contains(row) ? row : el);
      if (!li && el.matches("ul, ol")) li = itemIn(el, y);
      const ownOf = (x0) => (x0.querySelector(":scope > p, :scope > .li-body > p") || x0).getBoundingClientRect();
      const subOf = (x0) => { const d = descOf(x0), last = d && d.node.lastChild; return d && d.node.childCount > 1 && isList(last) ? [...x0.querySelectorAll(":scope > ul, :scope > ol, :scope > .li-body > ul, :scope > .li-body > ol")].pop() || null : null; };
      for (let sub; li && (sub = subOf(li)) && y > ownOf(li).bottom && itemIn(sub, y); ) li = itemIn(sub, y); // (between two rows)
      if (li) {
        const d0 = descOf(li), or = ownOf(li);
        const after = y > or.top + or.height / 2;
        /* the gap below item D: beside it, under it, or beside one of the items around it (if it is the last there) */
        const below = (D, yLine) => {
          const d = descOf(D), r = D.getBoundingClientRect(), sub = subOf(D), cands = [];
          if (sub) { // its sub-items begin right below: only as their first
            const firstLi = sub.querySelector(":scope > li");
            cands.push({ pos: d.posBefore + d.node.nodeSize - 1 - d.node.lastChild.nodeSize + 1, wrap: false, left: (firstLi || sub).getBoundingClientRect().left });
          } else {
            const P = liOf(v, D.parentElement);
            const indent = P ? r.left - P.getBoundingClientRect().left : parseFloat(getComputedStyle(D.parentElement).paddingLeft) || INDENT;
            cands.push({ pos: d.posBefore + d.node.nodeSize, wrap: false, left: r.left });
            cands.push({ pos: d.posBefore + d.node.nodeSize - 1, wrap: true, left: r.left + indent });
            for (let cur = D, up = P; up && !cur.nextElementSibling && !cur.parentElement.nextElementSibling; cur = up, up = liOf(v, up.parentElement)) {
              const du = descOf(up);
              cands.push({ pos: du.posBefore + du.node.nodeSize, wrap: false, left: up.getBoundingClientRect().left });
            }
          }
          let best = null;
          for (const c of cands) {
            if (within(c.pos) || !fits(c.pos, c.wrap ? wrapped : drag.slice.content)) continue;
            if (!best || Math.abs(c.left - xe) < Math.abs(best.left - xe)) best = c;
          }
          return best && made(best.pos, best.wrap, best.left, yLine);
        };
        if (after) return below(li, subOf(li) ? or.bottom + 2 : li.nextElementSibling ? edge(li, true) : li.getBoundingClientRect().bottom + 2);
        const S = li.previousElementSibling;
        if (S && S.matches("li")) { // the gap above it is the gap below what stands before it
          let D = S;
          for (let sub; (sub = subOf(D)) && sub.querySelector(":scope > li"); ) D = [...sub.querySelectorAll(":scope > li")].pop();
          return below(D, li.getBoundingClientRect().top - 3);
        }
        return fits(d0.posBefore, drag.slice.content) ? made(d0.posBefore, false, li.getBoundingClientRect().left, li.getBoundingClientRect().top - 3) : null;
      }
      // not over a list: between blocks, in a list of their own
      while (outerOf(v, el) && xe < el.getBoundingClientRect().left - INDENT / 2) el = outerOf(v, el);
      for (; el; el = outerOf(v, el)) {
        const d = descOf(el);
        if (!d) continue;
        const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2, pos = d.posBefore + (after ? d.node.nodeSize : 0);
        if (within(pos)) return null;
        if (fits(pos, wrapped)) return made(pos, true, r.left, edge(el, after));
      }
      return null;
    }

    // how far in the pointer is says how deep: left of a nested block, the block around it is meant
    while (el.parentElement !== v.dom && xe < el.getBoundingClientRect().left - INDENT / 2 && outerOf(v, el)) el = outerOf(v, el);
    for (; el; el = outerOf(v, el)) {
      const d = descOf(el);
      if (!d) continue;
      const r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
      const pos = d.posBefore + (after ? d.node.nodeSize : 0);
      if (within(pos)) return null;
      if (fits(pos, drag.slice.content)) return made(pos, false, r.left, edge(el, after));
      // it does not fit beside a list item (a table, a paragraph): into the item, at its end
      if (d.node.type.name === "list_item" && after) {
        const end = d.posBefore + d.node.nodeSize - 1;
        if (!within(end) && end !== drag.to && fits(end, drag.slice.content)) return made(end, false, r.left, r.bottom + 2);
      }
    }
    return null;
  }
  function showLine(t) {
    if (!t) { delete line.dataset.on; return; }
    line.style.left = t.x + scrollX + "px";
    line.style.width = t.w + "px";
    line.style.height = t.side ? t.h + "px" : ""; // (beside a block: a line down its side)
    line.style.top = t.y - (t.side ? 0 : 1) + scrollY + "px";
    line.dataset.on = "";
  }
  // (Both before anything else sees them: the editor's own drop handling and drop line stay out of it.)
  document.addEventListener("dragover", (e) => {
    if (!drag || !view) return;
    e.stopPropagation();
    e.preventDefault(); // (a drop is possible everywhere while one of the editor's blocks is dragged)
    e.dataTransfer.dropEffect = "move";
    const t = targetAt(e), same = (a, b) => (!a && !b) || (a && b && a.pos === b.pos && a.wrap === b.wrap && a.x === b.x && (a.side || 0) === (b.side || 0));
    if (!same(t, drag.target)) { drag.target = t; showLine(t); }
  }, true);
  document.addEventListener("drop", (e) => {
    if (!drag || !view) return;
    e.stopPropagation();
    e.preventDefault();
    const d = drag, t = d.target;
    drag = null;
    showLine(null);
    if (!t) return;
    const listed = () => PM.model.Fragment.from(d.list ? d.list.type.create(d.list.attrs, d.slice.content) : A.schema.nodes.bullet_list.create(null, d.slice.content));
    if (t.side) { // beside a block or a column: as a column of its own
      const tr = view.state.tr;
      for (const x of d.ranges.slice().reverse()) tr.deleteRange(x.from, x.to);
      const began = A.columns.beside(tr, tr.mapping.map(t.pos, t.pos <= d.from ? -1 : 1), t.side, d.items ? listed() : d.slice.content);
      if (began < 0) return;
      const n = tr.steps.length;
      for (const x of d.ranges.slice().reverse()) A.columns.tidy(tr, tr.mapping.map(x.from)); // (the columns they came from, if nothing is left in them)
      tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.slice(n).map(began)), 1)).setMeta("uiEvent", "drop").setMeta("step", true);
      view.dispatch(tr.scrollIntoView());
      view.focus();
      return;
    }
    const content = t.wrap ? listed() : d.slice.content;
    const tr = view.state.tr;
    for (const x of d.ranges.slice().reverse()) tr.deleteRange(x.from, x.to); // (a list left without items goes with them)
    const at = tr.mapping.map(t.pos, t.pos <= d.from ? -1 : 1);
    tr.insert(at, content);
    // what was moved stays selected as blocks: the keyboard can go on with it
    const first = at + (t.wrap ? 1 : 0);
    let last = first;
    for (let i = 0, p = first; i < d.slice.content.childCount; p += d.slice.content.child(i).nodeSize, i++) last = p;
    // a column left with nothing in it goes (what was moved is found again behind that change)
    const n = tr.steps.length;
    for (const x of d.ranges.slice().reverse()) A.columns.tidy(tr, tr.mapping.map(x.from));
    const after = tr.mapping.slice(n), anchor = after.map(first), head = after.map(last);
    tr.setMeta(selKey, { anchor, head }).setMeta("uiEvent", "drop").setMeta("step", true);
    tr.setSelection(pmSel(tr.doc, head));
    view.dispatch(tr);
    view.focus();
  }, true);
  handle.addEventListener("dragend", () => {
    drag = null; showLine(null); delete handle.dataset.dragging; hide();
    document.body.classList.remove("blk-dragging");
  });
  const plugin = new Plugin({
    key: new PluginKey("blocks"),
    view(v) { view = v; setTimeout(() => hookBelow(v), 0); return { update(now) { hookBelow(now); follow(now.state); }, destroy() { hide(); if (view === v) view = null; } }; },
    props: {
      // while a block is dragged by its handle, the editor's own drop handling and drop line stay out of it
      handleDrop: () => !!drag,
      handleDOMEvents: {
        mousemove(v, e) {
          if (!v.editable || rubber || A.menu.isOpen || A.dialog.open || handle.hasAttribute("data-dragging")) return false; // (no handle while a rectangle is pulled)
          // on the way to the handle the pointer crosses what lies left of the block (the list it is in):
          // the handle stays the block's while the pointer is beside it, at its height
          if (over && over.isConnected) {
            const r = over.getBoundingClientRect(), h = handle.getBoundingClientRect();
            const bottom = handle.hasAttribute("data-group") ? h.bottom : over.matches("li") ? Math.min(r.bottom, h.bottom + 6) : r.bottom;
            if (e.clientY >= r.top - 6 && e.clientY <= bottom + 6 && e.clientX < r.left + 6 && e.clientX >= h.left - 12) { clearTimeout(leaving); return false; }
          }
          if (bare(e)) return false; // (between blocks, in a row's gap: the pointer beside a block decides, below)
          if (!showFor(v, blockOf(v, e.target, e.clientY)) && over && !e.target.closest?.(".blk-h")) hideSoon();
          return false;
        },
        mouseleave(_v, e) { rest(null); if (over && !e.relatedTarget?.closest?.(".blk-h")) hideSoon(); return false; }, // (gone from the text: nothing is waited for)
        keydown() { if (over) hide(); return false; },
      },
    },
  });
  // the handle for this block (or for what is selected around it, with it). -> shown?
  function showFor(v, el) {
    // inside a selected block (a block of a selected row of columns): that block's handle, not its own
    if (el && selOf(v.state)) { const holder = pickedOf(v.state).map((x) => v.nodeDOM(x.pos)).find((d) => d && d.nodeType === 1 && d !== el && d.contains(el)); if (holder) el = holder; }
    // over one of several selected blocks: the handle they share
    const group = el ? groupEls(v.state) : null;
    const mine = group && group.find((x) => x === el || x.contains(el));
    if (!el) { rest(null); return false; }
    // there already: it stays
    const there = handle.hasAttribute("data-on") && (mine ? handle.hasAttribute("data-group") && over === (handle.hasAttribute("data-apart") ? mine : group[0]) : el === over && !handle.hasAttribute("data-group"));
    if (there) { clearTimeout(leaving); rest(null); return true; }
    /* Not at once: the pointer has to rest on the block a moment. Passing over the text on its way
     * elsewhere, it sets nothing off; the handle shown last goes meanwhile, as when the text is left. */
    if (over) hideSoon();
    rest(mine || el, () => { clearTimeout(leaving); if (mine) placeGroup(group, mine); else place(el); });
    return true;
  }
  /* What is shown moved under the handle — a column's width pulled, a block above it changed: the
   * handle goes with its block (it stood where the block had been). Its block gone, it goes too. */
  function follow(state) {
    if (!handle.hasAttribute("data-on") || handle.hasAttribute("data-dragging") || !over) return;
    if (!over.isConnected) { hide(); return; }
    if (handle.hasAttribute("data-group")) { const g = groupEls(state); if (!g) hide(); else placeGroup(g, g.includes(over) ? over : null); }
    else place(over);
  }
  let resting = null, restTimer = 0; // the block the pointer is on, waiting for its handle
  function rest(el, show) {
    if (el && el === resting) return;
    clearTimeout(restTimer);
    resting = el;
    if (!el) return;
    restTimer = setTimeout(() => { resting = null; if (el.isConnected && view && !rubber && !drag) show(); }, A.dwell());
  }
  /* The handle is a part of its block: it shows where it stands, too — with the pointer beside the
   * block, at the place the handle has, not only with the pointer over the block's text.
   *   left of the text      the block at the pointer's height (in a list: the item; in a row of
   *                         columns: the block of its first column — further out, the row itself)
   *   in a row's gap        the block of the column right of it whose first line is at that height
   * -> the block's element, or null */
  const GUTTER = 44, FAR = 76; // px left of the text: a block's own handle; beyond it, up to here: the row of columns'
  const inner = (el, y) => { // the block meant at height y: an item of a list, not the list
    if (el && el.matches("ul, ol")) { const li = itemIn(el, y); return li && li.pmViewDesc ? li : el; }
    return el;
  };
  const blockAtY = (parent, y, slack = 3) => {
    for (const c of parent.children) {
      const d = c.pmViewDesc;
      if (!d || !d.node || d.dom !== c || !usable(d.node) || c.classList.contains("hid")) continue;
      const r = c.getBoundingClientRect();
      if (r.height && y >= r.top - slack && y <= r.bottom + slack) return c;
    }
    return null;
  };
  function besideAt(v, e) {
    const pm = v.dom.getBoundingClientRect(), x = e.clientX, y = e.clientY;
    // (in a row's gap the pointer is over the grip for the widths, which lies over the row)
    const gapRow = e.target.classList?.contains("col-grip") ? document.elementsFromPoint(x, y).find((n) => n.classList && n.classList.contains("cols") && n.parentElement === v.dom) : null;
    if (!v.dom.contains(e.target) && !gapRow) { // left of the text
      if (e.target.closest?.(CHROME) || x > pm.left + 2 || x < pm.left - FAR || y < pm.top || y > pm.bottom) return null;
      const top = blockAtY(v.dom, y);
      if (!top) return null;
      if (top.classList.contains("cols")) {
        const first = x >= pm.left - GUTTER ? top.querySelector(":scope > .col") : null, b = first && blockAtY(first, y);
        return b ? inner(b, y) : top;
      }
      return inner(top, y);
    }
    if (!gapRow && !e.target.matches?.(".cols, .col")) return null;
    const row = gapRow || e.target.closest(".cols");
    for (const col of row.children) { // in the gap before a column: the block of that column that begins at this height
      if (!col.previousElementSibling || !col.classList.contains("col")) continue;
      const a = col.getBoundingClientRect();
      if (x < a.left - 22 || x >= a.left + 2) continue; // (the gap's left part is for pulling the columns' widths, at any height)
      for (const c of col.children) {
        const b = inner(c, y), d = b.pmViewDesc;
        if (!d || !d.node || !usable(d.node)) continue;
        const r = b.getBoundingClientRect(), line = Math.min(r.height, parseFloat(getComputedStyle(b).lineHeight) || 28);
        if (y >= r.top - 5 && y <= r.top + line + 5) return b;
      }
    }
    return null;
  }
  document.addEventListener("mousemove", (e) => {
    if (!view || !view.editable || document.body.dataset.view !== "active" || e.buttons || rubber || drag || A.menu.isOpen || A.dialog.open || handle.hasAttribute("data-dragging")) return;
    if (handle.contains(e.target)) return;
    const inText = view.dom.contains(e.target);
    if (inText && !bare(e)) return; // (over a block: the editor's own handler has it)
    const el = besideAt(view, e);
    if (el) showFor(view, el);
    else rest(null);
    if (!el && over) {
      // on the way to the handle, beside its block: it stays (as within the text)
      const r = over.getBoundingClientRect(), h = handle.getBoundingClientRect();
      if (!(e.clientY >= r.top - 6 && e.clientY <= Math.max(r.bottom, h.bottom) + 6 && e.clientX < r.left + 6 && e.clientX >= h.left - 12)) hideSoon();
    }
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
  const hookBelow = () => {}; // (a click below the text is the rectangle's business now: a press let go where it was)

  A.blocks = { over: () => over, select: selectBlock, selectAt, copyOf, groupEls, ghostOf, toggle, picked: (state) => pickedOf(state), targetAt: (e) => targetAt(e), dragging: () => drag, selection: (state) => rangeOf(state), selPlugin, plugins: () => [plugin, PM.dropcursor.dropCursor({ class: "drop-line", width: 2, color: false })], hide, handle };
})();
