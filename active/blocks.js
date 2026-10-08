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
    if (el.classList.contains("hid") || el.classList.contains("none") || el.dataset.kind === "footnotes" || el.dataset.kind === "frontmatter" || !el.pmViewDesc || !el.pmViewDesc.node) return null;
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
  const isList = (node) => !!node && /_list$/.test(node.type.name);
  const selKey = new PluginKey("blocksel");
  const selOf = (state) => selKey.getState(state);
  // (a comment shows nothing: it is no block to select or to take by a handle)
  const usable = (node) => !!node && node.type.name !== "hidden" && !(node.type.name === "island" && (node.attrs.virtual || node.attrs.kind === "frontmatter" || (node.attrs.kind === "html" && !String(node.attrs.raw || "").replace(/<!--[\s\S]*?-->/g, "").trim() && !window.MdView.core.pages.isRow(node.attrs.raw))));
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
  /* Blocks picked one by one, as what can stand anywhere: items of a list among other blocks
   * keep the list they come from around them (those that follow each other: one list). Items
   * alone stay items — where they go decides what is around them. [{ pos, node }] -> Fragment */
  function together(state, P) {
    if (P.every((x) => x.node.type.name === "list_item") || !P.some((x) => x.node.type.name === "list_item")) return Fragment.from(P.map((x) => x.node));
    const out = [];
    let run = null; // { list, items }
    const flush = () => { if (run) out.push(run.list.type.create("bid" in run.list.attrs ? { ...run.list.attrs, bid: null } : run.list.attrs, run.items)); run = null; };
    for (const x of P) {
      if (x.node.type.name !== "list_item") { flush(); out.push(x.node); continue; }
      const list = state.doc.resolve(x.pos).parent;
      if (run && run.list.type !== list.type) flush();
      if (!run) run = { list, items: [] };
      run.items.push(x.node);
    }
    flush();
    return Fragment.from(out);
  }
  // Ctrl+click on a block: it joins what is selected, or leaves it
  function toggle(v, pos) {
    const doc = v.state.doc, node = doc.nodeAt(pos);
    if (!node || !usable(node)) return false;
    let list = pickedOf(v.state);
    if (list.some((x) => x.pos === pos)) list = list.filter((x) => x.pos !== pos);
    else {
      // not a block and one inside it (items of a list and other blocks go together)
      list = list.filter((x) => !(x.pos < pos && pos < x.pos + x.node.nodeSize) && !(pos < x.pos && x.pos < pos + node.nodeSize));
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
    if (cur && extend && !same) { // (elsewhere — in a list, outside it: all the arrows would go through on the way there)
      const from = cur.from != null && v.state.doc.nodeAt(cur.from) ? cur.from : cur.more && cur.more.length ? cur.head : cur.anchor, next = stretch(v.state, from, pos);
      if (next) { v.dispatch(v.state.tr.setMeta(selKey, next).setSelection(pmSel(v.state.doc, pos))); v.focus(); return; }
    }
    v.dispatch(setSel(v.state, same ? cur.anchor : pos, pos));
    v.focus();
  }
  // the next block that can be selected, from index i in direction dir (or -1)
  const nextUsable = (r, i, dir) => { for (let k = i + dir; k >= 0 && k < r.parent.childCount; k += dir) if (usable(r.parent.child(k))) return k; return -1; };
  /* From block to block with the arrows, through all of the note: the blocks beside one another
   * first; then
   *   a list      is gone through item by item, those under an item after it (never the list as
   *               one block: that is what its handle selects)
   *   at an end   of a list, an item, a quote: on to what stands before / after it outside
   * A quote or callout is one block from outside (Esc in it selects what is in it).
   * seek: from index `from` in $p's parent in direction dir -> the position of the next block, or null. */
  function into(doc, pos, dir) { // a list: its first item — or, from below, the last there is in it
    let node = doc.nodeAt(pos);
    while (node && isList(node)) {
      const r = { parent: node, start: pos + 1 }, k = dir > 0 ? nextUsable(r, -1, 1) : nextUsable(r, node.childCount, -1);
      if (k < 0) break;
      pos = posOfChild(r, k); node = node.child(k);
      const under = node.lastChild;
      if (dir > 0 || node.childCount < 2 || !isList(under)) break;
      pos = pos + node.nodeSize - 1 - under.nodeSize; node = under; // (an item that ends in a list: on into that)
    }
    return pos;
  }
  function seek(doc, $p, from, dir) {
    for (let index = from; ; index = $p.index()) {
      const r = { parent: $p.parent, start: $p.start() }, k = nextUsable(r, index, dir);
      if (k >= 0) {
        if (dir < 0 && k === 0 && r.parent.type.name === "list_item") return $p.before(); // (an item's first block stands for the item)
        const at = posOfChild(r, k), kid = r.parent.child(k);
        if (isList(kid)) return into(doc, at, dir);
        // upwards onto an item that ends in a list: the last item there is in that
        if (dir < 0 && kid.type.name === "list_item" && kid.childCount > 1 && isList(kid.lastChild)) return into(doc, at + kid.nodeSize - 1 - kid.lastChild.nodeSize, -1);
        return at;
      }
      if (!$p.depth || ["column", "table_cell"].includes($p.parent.type.name)) return null; // (a column, a cell: not left by the arrows)
      $p = doc.resolve($p.before());
    }
  }
  function neighbour(state, pos, dir) {
    const doc = state.doc, $p = doc.resolve(pos), node = $p.nodeAfter;
    if (dir > 0 && node && node.type.name === "list_item") { // the items under it come after it
      for (let i = 1, at = pos + 1 + node.firstChild.nodeSize; i < node.childCount; at += node.child(i).nodeSize, i++) {
        if (!isList(node.child(i))) continue;
        const first = into(doc, at, 1);
        if (first !== at) return first;
      }
    }
    return seek(doc, $p, $p.index(), dir);
  }
  /* All blocks from one to another, in the order the arrows go through them — as a selection:
   * blocks beside one another are a range, others are picked one by one (`more`). A block that
   * holds one of the two is taken as a whole, and what stands in a block that is taken is not
   * taken once more. from: where it began, cur: where it reaches (it goes on from there). */
  function stretch(state, from, to) {
    const doc = state.doc, lo = Math.min(from, to), hi = Math.max(from, to), size = (p) => doc.nodeAt(p).nodeSize, list = [];
    for (let p = lo, n = 0; p != null && n < 5000; p = neighbour(state, p, 1), n++) {
      if (p > hi) break;
      list.push(p);
      if (p === hi || p + size(p) > hi) break; // (there, or in the block that holds it)
    }
    if (!list.some((p) => p <= hi && hi < p + size(p))) list.push(hi);
    const kept = list.filter((p) => !list.some((q) => q < p && p < q + size(q)));
    const sel = selFor(doc, kept, kept.includes(to) ? to : kept[to >= from ? kept.length - 1 : 0]);
    return sel && { ...sel, from, cur: to };
  }
  // what is selected as a thing by a click (a picture, a formula, code, a rule) -> the block that is, or -1
  function thingAt(state) {
    const s = state.selection;
    if (!(s instanceof NodeSelection)) return -1;
    if (s.node.isBlock) return s.node.isAtom && usable(s.node) ? s.from : -1;
    return closed(s.$from.parent) && s.$from.depth > 0 ? s.$from.before() : -1;
  }
  function keydown(v, e) {
    let sel = selOf(v.state), r = rangeOf(v.state, sel);
    const mod = e.ctrlKey || e.metaKey, up = e.key === "ArrowUp", down = e.key === "ArrowDown";
    // a picture, a formula, code clicked on, and then an arrow: on from it as from a selected block
    if (!r && (up || down) && !mod && !e.altKey && !gapOf(v.state)) {
      const at = thingAt(v.state);
      if (at < 0) return false;
      v.dispatch(setSel(v.state, at, at));
      sel = selOf(v.state); r = rangeOf(v.state, sel);
    }
    if (!r) return false;
    const done = (tr) => { e.preventDefault(); v.dispatch(tr); return true; };
    if (sel.more && sel.more.length) { // blocks picked one by one, not standing together
      const P = pickedOf(v.state, sel);
      if ((up || down) && e.altKey && !mod) { // moved: first they come together, where the first of them stands
        const all = together(v.state, P);
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
      if (!mod && e.shiftKey) { // more blocks, on the same way: all from the one it began on to the one it reaches
        const from = sel.from != null && v.state.doc.nodeAt(sel.from) ? sel.from : sel.more && sel.more.length ? sel.head : sel.anchor, cur = sel.cur != null && v.state.doc.nodeAt(sel.cur) ? sel.cur : sel.head;
        // (downwards past an item that is taken: what stands under it is taken with it — on to the next beside it)
        const $c = v.state.doc.resolve(cur), to = down && cur >= from ? seek(v.state.doc, $c, $c.index(), 1) : neighbour(v.state, cur, dir);
        e.preventDefault();
        if (to == null) return true;
        const next = stretch(v.state, from, to);
        if (next) v.dispatch(v.state.tr.setMeta(selKey, next).setSelection(pmSel(v.state.doc, to)).scrollIntoView());
        return true;
      }
      if (!mod && !e.shiftKey) { // one block on: through lists, and out of what the block stands in
        const to = neighbour(v.state, sel.head, dir);
        // beside a block one cannot type next to (a picture, code, a formula, a table …): first the
        // place between the two, where a new block can be made — the next block only after that
        if (v.editable && sel.anchor === sel.head && !(sel.more && sel.more.length)) {
          const cur = r.parent.child(r.head), other = to != null ? v.state.doc.nodeAt(to) : null;
          const at = up ? sel.head : sel.head + cur.nodeSize, index = up ? r.head : r.head + 1;
          if ((closed(cur) || (other && closed(other))) && r.parent.canReplaceWith(index, index, freshAt(v.state.doc.resolve(at)).type)) return done(toGap(v.state, at, sel.head));
        }
        if (to != null) return done(setSel(v.state, to, to));
      }
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
    if (e.key === "Tab" && !mod && !e.altKey) { // further in, or out again — together
      e.preventDefault();
      if (!v.editable || (sel.more && sel.more.length)) return true;
      if (r.parent.type.name.endsWith("_list")) { // items of a list: as Tab in them does, for all of them
        const doc = v.state.doc, among = v.state.apply(v.state.tr.setSelection(TextSelection.between(doc.resolve(r.from + 1), doc.resolve(r.to - 1))));
        const L = PM.schemaList, item = A.schema.nodes.list_item;
        (e.shiftKey ? L.liftListItem(item) : L.sinkListItem(item))(among, (tr) => v.dispatch(tr.setMeta(selKey, null).setMeta("step", true).scrollIntoView()));
        return true;
      }
      // blocks: under the list above them, or out of the item they are part of (edit.js)
      // (… and where no list is: into, or out of, a quote that only indents)
      const made = e.shiftKey ? A.edit.outdentBlocks(v.state, r.from) || A.edit.outdentPlain(v.state, r.from, r.to) : A.edit.indentBlocks(v.state, r.from, r.to) || A.edit.indentPlain(v.state, r.from, r.to);
      if (!made) return true;
      const size = r.to - r.from;
      let last = made.at;
      const $at = made.tr.doc.resolve(made.at);
      for (let i = $at.index(), p = made.at; i < $at.parent.childCount && p < made.at + size; p += $at.parent.child(i).nodeSize, i++) last = p;
      made.tr.setMeta(selKey, e.shiftKey ? null : { anchor: made.at, head: last });
      v.dispatch((e.shiftKey ? made.tr.setSelection(Selection.near(made.tr.doc.resolve(made.at + 1), 1)) : made.tr.setSelection(pmSel(made.tr.doc, last))).scrollIntoView());
      return true;
    }
    if (e.key === "/" && !mod && !e.altKey) { e.preventDefault(); slashMenu(v); return true; } // the "/" menu, for the blocks selected
    if (mod || e.altKey || /^(Shift|Control|Alt|Meta|CapsLock|Tab)$/.test(e.key) || e.key.length > 1) return mod || e.altKey ? false : (e.preventDefault(), true);
    // a character typed: back to the text, at the end of the block; it is typed there
    const node = v.state.doc.nodeAt(sel.head);
    v.dispatch(v.state.tr.setMeta(selKey, null).setSelection(Selection.near(v.state.doc.resolve(sel.head + (node ? node.nodeSize : 0)), -1)));
    return false;
  }
  /* The "/" menu for the blocks that are selected: a text style, a list, a decoration, a colour,
   * a callout — for all of them at once. Blocks that stand together get it together (one list,
   * one quote around them); blocks picked one by one each get it. What the first of them has
   * says whether an entry is ticked, and so whether choosing it puts it on or takes it off. */
  const PLAIN = ["menu.text", "slash.colorDefault"]; // (what a block is without anything chosen: no tick on its group for that)
  const WRAPS = ["slash.deco", "slash.color", "slash.callout"]; // (what puts a quote around the blocks)
  const SLASH_GROUPS = ["slash.style", "slash.list", "slash.deco", "slash.color", "slash.callout"];
  /* full: all the "/" menu has — the formats, columns, what can be put in (below the last of
   * them) and what can be done with the blocks; q: only what is found for it, in one list. */
  function slashItems(v, full = false, q = "") {
    const sel = selOf(v.state), r = rangeOf(v.state, sel);
    if (!r || !v.editable || !A.slash) return null;
    const T = window.MdStrings.t, single = !(sel.more && sel.more.length);
    const runs = single ? [{ from: r.from, to: r.to }] : pickedOf(v.state, sel).map((x) => ({ from: x.pos, to: x.pos + x.node.nodeSize }));
    const within = (state, run) => state.tr.setMeta(selKey, null).setSelection(TextSelection.between(state.doc.resolve(run.from + 1), state.doc.resolve(run.to - 1)));
    const flat = (view) => A.slash.entries(view).flatMap((g) => (!g ? [] : g.items ? g.items.filter(Boolean).map((x) => ({ ...x, group: g.key })) : [g]));
    const find = (view, group, e) => flat(view).find((x) => x.group === group && x.key === e.key && x.n === e.n && x.label === e.label);
    /* A quote, a block, a callout — what is around blocks — is told and changed by the blocks that
     * are selected themselves, not by where a caret in them would stand:
     *   a quote selected      it is the one meant: its kind has the tick; chosen again, the quote
     *                         alone goes and what is in it stays as it is; another kind changes it
     *   anything else         gets one around it, as the blocks stand — in a quote too (that one
     *                         stays as it is); a list in it stays a list (items of a list: they
     *                         are a list of their own in it, what was before and after them a list each)
     * What an entry does is asked on a document of its own: a line of plain text, or that line in
     * the quote that is selected. */
    const quoteAt = (state, run) => { const n = state.doc.nodeAt(run.from); return n && n.type.name === "blockquote" && run.from + n.nodeSize === run.to ? n : null; };
    const plainFor = (q) => {
      const S = A.schema, p = S.nodes.paragraph.create(null, S.text("x"));
      const plain = { state: PM.state.EditorState.create({ doc: S.node("doc", null, [q ? q.type.create(q.attrs, p) : p]) }), editable: true, focus() {}, hasFocus: () => true, made: undefined };
      plain.dispatch = (tr) => { plain.made = tr.doc.firstChild; };
      return plain;
    };
    // -> the quote's attributes after the entry, null: no quote (any more), undefined: the entry does nothing here
    const asked = (q, group, e) => {
      const plain = plainFor(q), now = find(plain, group, e);
      if (!now || now.disabled) return undefined;
      now.act(plain);
      return plain.made === undefined ? undefined : plain.made.type.name === "blockquote" ? plain.made.attrs : null;
    };
    const wrap = (run, attrs) => {
      const doc = v.state.doc, $from = doc.resolve(run.from), list = $from.parent, Q = A.schema.nodes.blockquote, tr = v.state.tr.setMeta(selKey, null).setMeta("step", true);
      if (list.type.name.endsWith("_list")) {
        const at = $from.before(), a = $from.index(), b = doc.resolve(run.to).index(), kids = [];
        list.forEach((n) => kids.push(n));
        const part = (items, first) => list.type.create(first || !("bid" in list.attrs) ? list.attrs : { ...list.attrs, bid: null }, items);
        const parts = [...(a > 0 ? [part(kids.slice(0, a), true)] : []), Q.create(attrs, part(kids.slice(a, b), a === 0)), ...(b < kids.length ? [part(kids.slice(b), false)] : [])];
        const $at = doc.resolve(at);
        if (!$at.parent.canReplace($at.index(), $at.index() + 1, Fragment.from(parts))) return false;
        tr.replaceWith(at, at + list.nodeSize, parts);
        v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(at + (a > 0 ? parts[0].nodeSize : 0) + 1), 1)));
        return true;
      }
      const range = $from.blockRange(doc.resolve(run.to));
      if (!range || !PM.transform.findWrapping(range, Q, attrs)) return false;
      tr.wrap(range, [{ type: Q, attrs }]);
      v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(run.from + 1), 1)));
      return true;
    };
    const around = (group, e) => () => {
      const want = !e.checked;
      for (const run of runs.slice().reverse()) {
        const q = quoteAt(v.state, run), here = find(plainFor(q), group, e);
        if (!here || here.disabled || (e.checked !== undefined && !!here.checked === want)) continue;
        const attrs = asked(q, group, e);
        if (attrs === undefined) continue;
        if (!q) { if (attrs) wrap(run, attrs); continue; }
        const tr = v.state.tr.setMeta(selKey, null).setMeta("step", true), $q = v.state.doc.resolve(run.from);
        if (attrs) tr.setNodeMarkup(run.from, null, attrs);
        else if ($q.parent.canReplace($q.index(), $q.index() + 1, q.content)) tr.replaceWith(run.from, run.to, q.content); // (the quote alone goes: what is in it stays as it is)
        else continue;
        v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(run.from + 1), 1)));
      }
      v.focus();
    };
    const choose = (group, e) => () => {
      const want = !e.checked;
      for (const run of runs.slice().reverse()) { // (from the last: what is changed below moves nothing above)
        v.dispatch(within(v.state, run));
        const now = find(v, group, e);
        if (!now || now.disabled || (e.checked !== undefined && !!now.checked === want)) continue;
        now.act(v);
      }
      v.focus();
    };
    // a page made of them: its line where the first of them stood, and they are what the page says
    const toPage = () => {
      const P = window.MdView.core.pages, id = P.fresh(), doc = v.state.doc;
      const markdown = runs.map((run) => {
        const list = doc.resolve(run.from).parent, slice = doc.slice(run.from, run.to);
        // (items of a list, without their list: as a list of that kind)
        return A.clip.markdownOf(v.state, list.type.name.endsWith("_list") ? new Slice(Fragment.from(list.type.create(list.attrs, slice.content)), 0, 0) : slice);
      }).join("\n\n");
      const tr = v.state.tr.setMeta(selKey, null).setMeta("step", true);
      for (const run of runs.slice().reverse()) takeOut(tr, run, -1);
      const row = A.context.island(`<!-- page: ${T("page.untitled")} #${id} -->`, "html");
      const at = PM.transform.insertPoint(tr.doc, Math.min(tr.mapping.map(runs[0].from, -1), tr.doc.content.size), row.type);
      if (at == null) return;
      tr.insert(at, row);
      v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(at), 1)));
      if (!P.append(id, markdown)) { PM.history.undo(v.state, v.dispatch); v.focus(); return; } // (the page did not take them: they are back)
      setTimeout(() => P.open(id), 0); // (to be named, as a page just made is)
    };
    // put in: once, below the last of them
    const insert = (e) => () => {
      const last = runs[runs.length - 1];
      v.dispatch(v.state.tr.setMeta(selKey, null).setSelection(Selection.near(v.state.doc.resolve(last.to - 1), -1)));
      const now = find(v, undefined, e);
      if (now && !now.disabled) now.act(v);
      v.focus();
    };
    // (what the menu shows is worked out with the caret in the first of them, on a state of its own: the selection stays until something is chosen)
    const first = { state: v.state.apply(within(v.state, runs[0])), editable: true };
    const label = (e) => e.label || T(e.key, e.n);
    // (… but what is around them: with the quote that is selected, or none)
    const own = A.slash.entries(plainFor(quoteAt(v.state, runs[0])));
    const all = (A.slash.entries(first).some((g) => g && g.key === "slash.style") ? A.slash.entries(first) : own).map((g) => (g && WRAPS.includes(g.key) ? own.find((x) => x && x.key === g.key) || g : g)), text = A.slash.entries(first).some((g) => g && g.key === "slash.style"); // (in a table the "/" menu is the table's own: of it only what goes around blocks is for them)
    const leaf = (group) => (e) => e && { label: label(e), icon: e.icon, words: e.words || "", run: group === undefined && e.key === "menu.page" ? toPage : group === undefined && e.key.startsWith("menu.") ? insert(e) : WRAPS.includes(group) ? around(group, e) : choose(group, e), disabled: e.disabled, checked: e.checked, danger: e.danger };
    const shown = (g) => g && g.key !== "slash.actions" && (full || SLASH_GROUPS.includes(g.key));
    const list = all.filter((g) => !g || (shown(g) && (text || WRAPS.includes(g.key)))).map((g) => g && (g.items ? { label: label(g), icon: g.icon, items: g.items.filter((e) => !e || e.key !== "callout.title").map(leaf(g.key)), ...(full ? { checked: g.items.some((e) => e && e.checked && !PLAIN.includes(e.key)) } : null) } : leaf(undefined)(g)));
    if (full) {
      const key = (k, mods) => () => { v.focus(); keydown(v, { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...mods }); };
      // they change places with the block above / below, and stay selected
      const other = (dir) => (single ? nextUsable(r, dir < 0 ? r.a : r.b, dir) : -1);
      const move = (dir) => () => {
        const o = other(dir);
        if (o !== (dir < 0 ? r.a - 1 : r.b + 1)) return;
        const blocks = v.state.doc.slice(r.from, r.to).content, to = dir < 0 ? r.from - r.parent.child(o).nodeSize : r.from + r.parent.child(o).nodeSize;
        const tr = v.state.tr.delete(r.from, r.to).insert(to, blocks).setMeta("step", true);
        let last = to;
        for (let i = 0, p = to; i < blocks.childCount; p += blocks.child(i).nodeSize, i++) last = p;
        v.dispatch(tr.setMeta(selKey, { anchor: to, head: last }).setSelection(pmSel(tr.doc, last)).scrollIntoView());
        v.focus();
      };
      const icons = Object.fromEntries((all.find((g) => g && g.key === "slash.actions")?.items || []).filter(Boolean).map((e) => [e.key, e.icon]));
      const act = (k, words, run, more) => ({ label: T(k), icon: icons[k], words, run, ...more });
      list.push(null, { label: T("slash.actions"), icon: all.find((g) => g && g.key === "slash.actions")?.icon, items: [
        act("slash.duplicate", "duplicate copy duplizieren verdoppeln", key("d", { ctrlKey: true })),
        act("slash.moveUp", "move up nach oben bewegen", move(-1), { disabled: other(-1) !== r.a - 1 || r.a === 0 }),
        act("slash.moveDown", "move down nach unten bewegen", move(1), { disabled: other(1) !== r.b + 1 }),
        act("menu.copyMarkdown", "copy markdown kopieren", () => { window.MdView.core.copy(A.clip.markdownOf(v.state, v.state.doc.slice(r.from, r.to))); v.focus(); }),
        null,
        act("slash.delete", "delete remove block löschen", key("Delete"), { danger: true }),
      ] });
    }
    // (no rule first, last, or after another)
    const tidy = list.filter((x, i) => x || (i > 0 && list[i - 1] && list.slice(i + 1).some(Boolean)));
    if (!q) return tidy;
    // found: one list of what the groups hold — what is called so before what is only found by another word for it
    const every = tidy.flatMap((x) => (!x ? [] : x.items ? x.items.filter(Boolean).map((e) => ({ ...e, icon: e.icon || x.icon })) : [x]));
    const byName = (e) => e.label.toLowerCase().split(/\s+/).some((w) => w.startsWith(q));
    const found = every.filter((e) => !e.disabled && (byName(e) || e.words.split(/\s+/).some((w) => w.startsWith(q))));
    return found.filter(byName).concat(found.filter((e) => !byName(e))); // (what is on keeps its tick: chosen again, it goes)
  }
  function slashMenu(v) {
    if (!slashItems(v, true)) return;
    const r = rangeOf(v.state), c = v.coordsAtPos(Math.min(r.from + 1, v.state.doc.content.size));
    A.menu.open({ x: c.left, y: c.bottom + 4, above: c.top - 4, steady: true, find: (q) => slashItems(v, true, q) || [] });
  }
  /* The menu of a right click on blocks that are selected: the clipboard, once more, away — and
   * what the "/" menu has for them. (The keys do the same: they are named beside the entries.) */
  function menuItems(v) {
    const T = window.MdStrings.t, key = (k, mods) => () => { v.focus(); keydown(v, { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...mods }); };
    const clip = (what) => () => {
      v.focus();
      if (document.execCommand(what)) return; // (the clipboard's own event takes the blocks: toClipboard)
      const r = rangeOf(v.state);
      if (!r) return;
      window.MdView.core.copy(A.clip.markdownOf(v.state, v.state.doc.slice(r.from, r.to)));
      if (what === "cut") key("Delete")();
    };
    const post = (type) => window.MdHost?.post(JSON.stringify({ type }));
    return [
      { label: T("menu.cut"), run: clip("cut"), key: "Ctrl+X" },
      { label: T("menu.copy"), run: clip("copy"), key: "Ctrl+C" },
      { label: T("menu.paste"), run: () => { v.focus(); post("pasteclip"); }, key: "Ctrl+V" },
      { label: T("slash.duplicate"), run: key("d", { ctrlKey: true }), key: "Ctrl+D" },
      null,
      ...(slashItems(v) || []),
      null,
      { label: T("menu.delete"), run: key("Delete"), danger: true, key: "⌫" },
    ];
  }
  function toClipboard(v, e, cut) {
    const r = rangeOf(v.state), P = pickedOf(v.state);
    if (!r || !e.clipboardData) return false;
    const apart = P.length && (selOf(v.state).more || []).length; // picked one by one: each of them, one after the other
    const slice = apart ? new Slice(together(v.state, P), 0, 0) : v.state.doc.slice(r.from, r.to);
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
  /* ---------------------------------------------------------------- the place between two blocks
   * Next to a picture, a code block, a formula, a table, a rule, a quote or a row of columns there
   * is no line to put the caret in. With such a block selected, the arrow first stops between it
   * and its neighbour (or behind it, at the end): a short line shows the place. There
   *   a character, Enter, Space, a paste   make a new block, the caret (and what was typed) in it
   *   ↑ ↓                                  select the block above / below
   *   Esc                                  selects the block it came from
   * The state: { pos (between the blocks), back (the block it came from) }. */
  const gapKey = new PluginKey("blockgap");
  const gapOf = (state) => gapKey.getState(state);
  // a block without a line of its own to type in beside it
  const closed = (node) => node.isAtom || ["table", "columns", "blockquote"].includes(node.type.name)
    || (node.isTextblock && node.childCount > 0 && !node.textContent.trim() && !node.type.spec.code); // (a paragraph that is a picture, a file, a formula)
  // what is made between two blocks: an item in a list, else a paragraph
  const freshAt = ($pos) => {
    const S = A.schema.nodes, like = $pos.nodeBefore || $pos.nodeAfter;
    return $pos.parent.type.name.endsWith("_list") && like ? S.list_item.create({ markup: like.attrs.markup, task: like.attrs.task == null ? null : " " }, S.paragraph.create()) : S.paragraph.create();
  };
  // (the editor's own selection stays on the block it came from, unseen: nothing else in the page follows a caret meanwhile)
  const toGap = (state, pos, back) => state.tr.setMeta(selKey, null).setMeta(gapKey, { pos, back });
  // a new block there, the caret in it
  function fillGap(v, g) {
    const $p = v.state.doc.resolve(g.pos), fresh = freshAt($p);
    if (!$p.parent.canReplaceWith($p.index(), $p.index(), fresh.type)) return false;
    const tr = v.state.tr.insert(g.pos, fresh).setMeta(gapKey, null).setMeta("step", true);
    v.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(g.pos + 1), 1)).scrollIntoView());
    return true;
  }
  function gapKeydown(v, e) {
    const g = gapOf(v.state);
    if (!g) return false;
    const mod = e.ctrlKey || e.metaKey, done = (tr) => { e.preventDefault(); v.dispatch(tr); return true; };
    if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return false;
    const $p = v.state.doc.resolve(g.pos), r = { parent: $p.parent, start: $p.start() };
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !mod && !e.altKey && !e.shiftKey) {
      const at = e.key === "ArrowUp" ? seek(v.state.doc, $p, $p.index(), -1) : seek(v.state.doc, $p, $p.index() - 1, 1);
      if (at == null) { e.preventDefault(); return true; }
      return done(setSel(v.state, at, at).setMeta(gapKey, null));
    }
    if (e.key === "Escape") {
      const back = v.state.doc.nodeAt(g.back);
      return done(back && usable(back) ? setSel(v.state, g.back, g.back).setMeta(gapKey, null) : v.state.tr.setMeta(gapKey, null));
    }
    if (mod && e.key.toLowerCase() === "v") return false; // (the paste itself makes the block: below)
    if (mod || e.altKey) { v.dispatch(v.state.tr.setMeta(gapKey, null)); return false; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fillGap(v, g); return true; }
    if (e.key.length === 1 || e.key === "Dead" || e.key === "Process") return fillGap(v, g) ? false : (e.preventDefault(), true); // a character: typed into the new block
    e.preventDefault();
    return true;
  }
  const gapPlugin = new Plugin({
    key: gapKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(gapKey);
        if (meta !== undefined) return meta;
        if (!value) return null;
        return tr.docChanged || (tr.selectionSet && !tr.getMeta("appendedTransaction")) ? null : value; // anything else done: the place is let go
      },
    },
    view: () => ({
      update(v, prev) {
        const g = gapOf(v.state);
        if (!g) { if (gapOf(prev)) showLine(null); return; }
        // the middle between the two blocks (at an end: a little off the one block there is)
        const rect = (pos) => { const d = pos != null ? v.nodeDOM(pos) : null; return d && d.nodeType === 1 ? d.getBoundingClientRect() : null; };
        const $p = v.state.doc.resolve(g.pos), a = rect($p.nodeBefore ? g.pos - $p.nodeBefore.nodeSize : null), b = rect($p.nodeAfter ? g.pos : null);
        if (!a && !b) return showLine(null);
        const y = a && b ? (a.bottom + b.top) / 2 : a ? a.bottom + 10 : b.top - 10;
        showLine({ x: (b || a).left, y, w: 28 });
        if (y < 60 || y > innerHeight - 40) window.scrollBy({ top: y - innerHeight / 2 });
      },
      destroy() { showLine(null); },
    }),
    props: {
      attributes: (state) => (gapOf(state) ? { class: "has-gap" } : null),
      handleKeyDown: gapKeydown,
      handleDOMEvents: {
        paste(v) { const g = gapOf(v.state); if (g) fillGap(v, g); return false; }, // (… and what is pasted goes into the new block)
        blur(v) { if (gapOf(v.state)) v.dispatch(v.state.tr.setMeta(gapKey, null)); return false; },
      },
    },
  });

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
        /* The browser's own highlight follows the selection out of the block: into what stands
         * before it, and over the room between blocks (painted by what holds them). Both are
         * marked, so that the highlight can be taken from them (active.css) — for blocks selected
         * as wholes, and for a thing selected by a click. */
        const around = (list) => {
          const out = [], seen = new Set();
          for (const pos of list) {
            const $p = state.doc.resolve(pos), before = $p.nodeBefore;
            if (before && !before.isText && !seen.has("b" + (pos - before.nodeSize))) { seen.add("b" + (pos - before.nodeSize)); out.push(Decoration.node(pos - before.nodeSize, pos, { class: "sel-before" })); }
            if ($p.depth > 0 && !seen.has("h" + $p.before())) { seen.add("h" + $p.before()); out.push(Decoration.node($p.before(), $p.after(), { class: "sel-holder" })); }
          }
          return out;
        };
        if (!P.length) {
          const s = state.selection;
          return s instanceof NodeSelection && s.node.isBlock ? DecorationSet.create(state.doc, around([s.from])) : null;
        }
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
        }).concat(around(P.map((x) => x.pos))));
      },
      attributes: (state) => (rangeOf(state) ? { class: "has-blocksel" } : state.selection instanceof NodeSelection ? { class: "has-nodesel" } : null),
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
   * so when it is let go: the keyboard works on them. Inside one list it takes the items it reaches. Near the window's upper and lower edge the
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
  /* Only a list reached: the items of it the rectangle touches, not the whole list — and where that
   * is one item, touched only below its own text, the items of the list inside it. All of a list's
   * items touched: the list itself. -> their positions, or null */
  function reachedItems(pos, y0, y1) {
    let list = view.nodeDOM(pos), out = null;
    const T = Math.min(y0, y1) - scrollY, B = Math.max(y0, y1) - scrollY;
    while (list && list.matches && list.matches("ul, ol")) {
      const items = [...list.children].filter((li) => li.matches("li") && li.pmViewDesc && li.pmViewDesc.dom === li && usable(li.pmViewDesc.node));
      const got = items.filter((li) => { const r = li.getBoundingClientRect(); return r.height && r.bottom >= T && r.top <= B; });
      if (!got.length || (!out && got.length === items.length && items.length > 1)) break;
      out = got.map((li) => li.pmViewDesc.posBefore);
      const sub = got.length === 1 ? got[0].querySelector(":scope > ul, :scope > ol, :scope > .li-body > ul, :scope > .li-body > ol") : null;
      list = sub && T >= sub.getBoundingClientRect().top ? sub : null;
    }
    return out;
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
    let inner = got[0] === got[1] ? reachedIn(got[0], r.x, r.y, x, y) || reachedItems(got[0], r.y, y) : null;
    // several blocks, a list the first or the last of them: of that list the items it reaches, not all of it
    if (!inner && got[0] !== got[1]) {
      const doc = view.state.doc, T = Math.min(r.y, y) - scrollY, B = Math.max(r.y, y) - scrollY, all = [];
      const itemsOf = (pos) => {
        const el = view.nodeDOM(pos);
        if (!el || !el.matches || !el.matches("ul, ol")) return null;
        const items = [...el.children].filter((li) => li.matches("li") && li.pmViewDesc && li.pmViewDesc.dom === li && usable(li.pmViewDesc.node));
        const hit = items.filter((li) => { const b = li.getBoundingClientRect(); return b.height && b.bottom >= T && b.top <= B; });
        return hit.length && hit.length < items.length ? hit.map((li) => li.pmViewDesc.posBefore) : null;
      };
      for (let p = got[0]; p <= got[1]; p += doc.nodeAt(p).nodeSize) {
        if (!usable(doc.nodeAt(p))) continue;
        const items = p === got[0] || p === got[1] ? itemsOf(p) : null;
        if (items) all.push(...items); else all.push(p);
      }
      if (all.length && (all[0] !== got[0] || all[all.length - 1] !== got[1] || all.some((p) => doc.resolve(p).depth > 0))) inner = all;
    }
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
    // a click into the empty space lets go of whatever was selected — blocks (below), and text too:
    // the press is held back so that no text is selected by a pull, which left a selection of text standing
    const st = view.state;
    if (!st.selection.empty && !selOf(st)) view.dispatch(st.tr.setSelection(Selection.near(st.doc.resolve(st.selection.head), -1)));
    getSelection()?.removeAllRanges(); // (… and what is selected outside the text: a title, a word of the reading view under it)
    // a click: below the last block an empty line, the caret in it
    if (view.editable && e && e.clientY > view.dom.getBoundingClientRect().bottom && view.dom.parentElement && view.dom.parentElement.contains(e.target)) lineBelow(view);
  }
  // every block of the document, selected as wholes (Select All from a menu) → whether there are any
  function selectAll(v) {
    const top = { parent: v.state.doc, start: 0 }, f = nextUsable(top, -1, 1), l = nextUsable(top, v.state.doc.childCount, -1);
    if (f < 0 || l < 0 || f >= v.state.doc.childCount) return false;
    v.dispatch(setSel(v.state, posOfChild(top, f), posOfChild(top, l)));
    v.focus();
    return true;
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
  // a right click on the handle: the block's menu (the one a right click on selected blocks has) — the block is selected for it
  handle.addEventListener("contextmenu", (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!view || !view.editable || !over || !over.isConnected || !over.pmViewDesc) return;
    const pos = over.pmViewDesc.posBefore;
    if (!handle.hasAttribute("data-group") && !pickedOf(view.state).some((x) => x.pos === pos)) selectBlock(view, pos, false);
    const items = menuItems(view);
    if (items) A.menu.open({ x: e.clientX, y: e.clientY, items, closed: () => view.focus() });
  });
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
    const all = together(view.state, many ? P : [{ pos, node }]);
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
    // over the line of a page of the note: into that page (at its end) — not a page into itself
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".page-row"), isl = row && row.closest(".isl");
    if (row && isl && v.dom.contains(isl) && isl.pmViewDesc && drag) {
      const pos = isl.pmViewDesc.posBefore;
      if (!drag.ranges.some((x) => pos >= x.from && pos < x.to)) return { into: row.dataset.page, el: row, pos };
    }
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
  let intoEl = null; // the page's line the blocks would go into
  function showLine(t) {
    if (intoEl && (!t || t.el !== intoEl)) { intoEl.classList.remove("drop-into"); intoEl = null; }
    if (t && t.into) { delete line.dataset.on; intoEl = t.el; intoEl.classList.add("drop-into"); return; }
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
    drag.cy = e.clientY;
    if (!drag.frame) drag.frame = requestAnimationFrame(dragScroll);
    const t = targetAt(e), same = (a, b) => (!a && !b) || (a && b && a.pos === b.pos && a.wrap === b.wrap && a.x === b.x && (a.side || 0) === (b.side || 0) && (a.into || "") === (b.into || ""));
    if (!same(t, drag.target)) { drag.target = t; showLine(t); }
  }, true);
  /* Dragged to the window's upper or lower edge, the page scrolls along — the faster the nearer
   * the edge — so a block can go further than what is on screen. (As the rectangle does, above.) */
  function dragScroll() {
    if (!drag) return;
    drag.frame = 0;
    const edge = 64, y = drag.cy, speed = y < edge ? -Math.ceil((edge - y) / 3) : y > innerHeight - edge ? Math.ceil((y - (innerHeight - edge)) / 3) : 0;
    if (!speed) return;
    const before = scrollY;
    window.scrollBy({ top: speed, behavior: "instant" });
    if (scrollY !== before) drag.frame = requestAnimationFrame(dragScroll);
  }
  /* Blocks taken out of where they stand (dragged elsewhere). A list left without items goes with
   * them — a quote or callout does not: it is a thing of its own (a kind, a title), and stays with
   * an empty line in it. (Moved within that same quote, it is not left at all.) */
  function takeOut(tr, x, to) {
    const $f = tr.doc.resolve(x.from), q = $f.parent;
    if (q.type.name === "blockquote" && x.from === $f.start() && x.to === $f.end() && !(to >= x.from && to <= x.to)) tr.replaceWith(x.from, x.to, A.schema.nodes.paragraph.create());
    else tr.deleteRange(x.from, x.to);
  }
  document.addEventListener("drop", (e) => {
    if (!drag || !view) return;
    e.stopPropagation();
    e.preventDefault();
    const d = drag, t = d.target;
    drag = null;
    showLine(null);
    if (!t) return;
    const listed = () => PM.model.Fragment.from(d.list ? d.list.type.create(d.list.attrs, d.slice.content) : A.schema.nodes.bullet_list.create(null, d.slice.content));
    if (t.into) { // into a page of the note: gone from here, at the end of what the page says
      const markdown = A.clip.markdownOf(view.state, d.items ? new Slice(listed(), 0, 0) : d.slice);
      const tr = view.state.tr;
      for (const x of d.ranges.slice().reverse()) takeOut(tr, x, -1);
      if (!tr.doc.content.size) tr.insert(0, A.schema.nodes.paragraph.create());
      tr.setMeta(selKey, null).setMeta("uiEvent", "drop").setMeta("step", true);
      view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.mapping.map(d.from), tr.doc.content.size)), 1)));
      if (!window.MdView.core.pages.append(t.into, markdown)) PM.history.undo(view.state, view.dispatch); // (the page is not there: the blocks are back)
      view.focus();
      return;
    }
    if (t.side) { // beside a block or a column: as a column of its own
      const tr = view.state.tr;
      for (const x of d.ranges.slice().reverse()) takeOut(tr, x, t.pos);
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
    for (const x of d.ranges.slice().reverse()) takeOut(tr, x, t.pos); // (a list left without items goes with them)
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

  A.blocks = { selectAll, menuItems, state: (state) => selOf(state), gap: (state) => gapOf(state), takeOut, selectTr: (state, pos) => setSel(state, pos, pos), over: () => over, select: selectBlock, selectAt, copyOf, groupEls, ghostOf, toggle, picked: (state) => pickedOf(state), targetAt: (e) => targetAt(e), dragging: () => drag, selection: (state) => rangeOf(state), selPlugin, gapPlugin, plugins: () => [plugin, PM.dropcursor.dropCursor({ class: "drop-line", width: 2, color: false })], hide, handle };
})();
