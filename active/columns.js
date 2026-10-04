/* mdview active mode — columns: blocks side by side (schema.js has the nodes,
 * viewer.js the way they stand in the file).
 *
 *   making them     a block becomes the first of n columns (the "/" menu, the
 *                   panel); a block dragged to the side of another one makes
 *                   two of them, dragged to the side of a column a new column
 *                   (blocks.js)
 *   in a column     add one left or right, move it, take it away (what it
 *                   holds goes to the one beside it), make all alike, or put
 *                   everything one under the other again
 *   widths          the gap between two columns can be pulled: both change,
 *                   the others stay; a double click makes all alike
 *   Backspace       in a column with nothing in it takes the column away
 *
 * A row has at least two columns: with one left, its blocks stand in the
 * document again. Columns are not put into columns, lists or quotes. */
"use strict";
(() => {
  const A = window.MdActive;
  const { Plugin, PluginKey, Selection, TextSelection } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const { Fragment } = PM.model;
  const N = A.schema.nodes;
  const MIN = 0.12; // of the row: no column is pulled narrower

  // ------------------------------------------------------------ where the caret is
  // the row and the column around a position: { cols, colsPos, col, colPos, index } or null
  function around($pos) {
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type === N.column) return { col: $pos.node(d), colPos: $pos.before(d), index: $pos.index(d - 1), cols: $pos.node(d - 1), colsPos: $pos.before(d - 1) };
    }
    return null;
  }
  const at = (state) => around(state.selection.$from);
  const blank = (col) => col.childCount === 1 && col.firstChild.type === N.paragraph && !col.firstChild.content.size;
  const empty = (width = 1) => N.column.create({ width }, N.paragraph.create());
  const columnsOf = (cols) => { const out = []; cols.forEach((c) => out.push(c)); return out; };
  const mean = (cols) => { const w = columnsOf(cols).map((c) => c.attrs.width); return Math.round((w.reduce((a, b) => a + b, 0) / w.length) * 100) / 100 || 1; };
  // the position inside column i of the row at colsPos (the start of what it holds)
  const inside = (doc, colsPos, i) => { let pos = colsPos + 1; const cols = doc.nodeAt(colsPos); for (let k = 0; k < i; k++) pos += cols.child(k).nodeSize; return pos + 1; };
  const caretIn = (tr, pos) => tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), 1));

  // ------------------------------------------------------------ making and changing them
  /* The row at colsPos with these columns instead of its own. Fewer than two: their blocks stand
   * in the document again. -> the position where the first of them begins */
  function put(tr, colsPos, list) {
    const old = tr.doc.nodeAt(colsPos);
    if (list.length >= 2) tr.replaceWith(colsPos, colsPos + old.nodeSize, N.columns.create(old.attrs, list));
    else {
      let blocks = Fragment.empty;
      for (const c of list) if (!blank(c)) blocks = blocks.append(c.content);
      tr.replaceWith(colsPos, colsPos + old.nodeSize, blocks.size ? blocks : N.paragraph.create());
    }
    return colsPos;
  }
  // n columns: the block the caret is in becomes the first of them; in a row, the row gets as many
  const make = (n) => (state, dispatch) => {
    const c = at(state);
    if (c) {
      const list = columnsOf(c.cols);
      if (n === list.length) return false;
      if (n > list.length) { const w = mean(c.cols); while (list.length < n) list.push(empty(w)); }
      else { // what the columns that go held joins the last that stays
        let rest = list[n - 1].content;
        for (const x of list.splice(n)) if (!blank(x)) rest = blank(list[n - 1]) && rest === list[n - 1].content ? x.content : rest.append(x.content);
        list[n - 1] = list[n - 1].copy(rest);
      }
      if (dispatch) { const tr = state.tr; put(tr, c.colsPos, list); dispatch(caretIn(tr, inside(tr.doc, c.colsPos, Math.min(c.index, n - 1)))); }
      return true;
    }
    const { $from, from, to } = state.selection;
    if (!$from.depth) return false;
    const pos = $from.before(1), node = $from.node(1);
    if (node.type === N.columns) return false;
    if (dispatch) {
      const list = [N.column.create(null, node)];
      while (list.length < n) list.push(empty());
      const tr = state.tr.replaceWith(pos, pos + node.nodeSize, N.columns.create(null, list));
      // the caret stays in its text, which now stands two nodes deeper
      dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 2, to + 2)));
    }
    return true;
  };
  const add = (side) => (state, dispatch) => {
    const c = at(state);
    if (!c) return false;
    if (dispatch) {
      const list = columnsOf(c.cols), i = c.index + (side > 0 ? 1 : 0);
      list.splice(i, 0, empty(mean(c.cols)));
      const tr = state.tr;
      put(tr, c.colsPos, list);
      dispatch(caretIn(tr, inside(tr.doc, c.colsPos, i)));
    }
    return true;
  };
  // the column goes; what it holds joins the one beside it (before it, or after the first)
  function remove(state, dispatch) {
    const c = at(state);
    if (!c) return false;
    if (dispatch) {
      const list = columnsOf(c.cols), gone = list.splice(c.index, 1)[0], to = Math.max(0, c.index - 1), tr = state.tr;
      if (!blank(gone)) list[to] = list[to].copy(blank(list[to]) ? gone.content : c.index ? list[to].content.append(gone.content) : gone.content.append(list[to].content));
      put(tr, c.colsPos, list);
      dispatch(caretIn(tr, list.length >= 2 ? inside(tr.doc, c.colsPos, to) : c.colsPos));
    }
    return true;
  }
  function unwrap(state, dispatch) {
    const c = at(state);
    if (!c) return false;
    if (dispatch) {
      const tr = state.tr;
      let blocks = Fragment.empty;
      c.cols.forEach((x) => { if (!blank(x)) blocks = blocks.append(x.content); });
      tr.replaceWith(c.colsPos, c.colsPos + c.cols.nodeSize, blocks.size ? blocks : N.paragraph.create());
      dispatch(caretIn(tr, c.colsPos));
    }
    return true;
  }
  const alike = (cols) => columnsOf(cols).every((x) => x.attrs.width === cols.firstChild.attrs.width);
  function equal(state, dispatch) {
    const c = at(state);
    if (!c || (alike(c.cols) && c.cols.firstChild.attrs.width === 1)) return false;
    if (dispatch) dispatch(widthsTr(state.tr, c.colsPos, columnsOf(c.cols).map(() => 1)));
    return true;
  }
  const move = (dir) => (state, dispatch) => {
    const c = at(state), j = c ? c.index + dir : -1;
    if (!c || j < 0 || j >= c.cols.childCount) return false;
    if (dispatch) {
      const list = columnsOf(c.cols), inCol = state.selection.from - (c.colPos + 1), tr = state.tr;
      [list[c.index], list[j]] = [list[j], list[c.index]];
      put(tr, c.colsPos, list);
      dispatch(tr.setSelection(Selection.near(tr.doc.resolve(inside(tr.doc, c.colsPos, j) + inCol), 1))); // (the caret goes with its column)
    }
    return true;
  };
  function widthsTr(tr, colsPos, widths) {
    const cols = tr.doc.nodeAt(colsPos);
    let pos = colsPos + 1;
    cols.forEach((col, _o, i) => { if (col.attrs.width !== widths[i]) tr.setNodeMarkup(pos, null, { ...col.attrs, width: widths[i] }); pos += col.nodeSize; });
    return tr;
  }
  /* After blocks were taken out of a column (dragged elsewhere): a column left with nothing in it
   * goes, and with it the row if only one column stays. pos: where they were taken from. */
  function tidy(tr, pos) {
    if (pos < 0 || pos > tr.doc.content.size) return tr;
    const c = around(tr.doc.resolve(pos));
    if (!c || !blank(c.col)) return tr;
    if (c.cols.childCount > 2) return tr.delete(c.colPos, c.colPos + c.col.nodeSize); // (the others stay where they are)
    const list = columnsOf(c.cols);
    list.splice(c.index, 1);
    put(tr, c.colsPos, list);
    return tr;
  }
  /* Blocks set beside a block (side: -1 left, 1 right): the two become a row of two columns — or,
   * beside a column of a row, a new column of that row. pos: before the block, or before the column. */
  function beside(tr, pos, side, content) { // -> the position where what was set there begins, or -1
    const node = tr.doc.nodeAt(pos);
    if (!node) return -1;
    if (node.type === N.column) { // (set in between: the row's other columns stay as they are)
      const c = around(tr.doc.resolve(pos + 1)), at = side > 0 ? pos + node.nodeSize : pos;
      tr.insert(at, N.column.create({ width: mean(c.cols) }, content));
      return at + 1;
    }
    const a = N.column.create(null, node), b = N.column.create(null, content);
    tr.replaceWith(pos, pos + node.nodeSize, N.columns.create(null, side > 0 ? [a, b] : [b, a]));
    return side > 0 ? pos + 1 + a.nodeSize + 1 : pos + 2;
  }

  // ------------------------------------------------------------ widths: the gap between two columns is pulled
  const key = new PluginKey("columns");
  const grip = document.createElement("div");
  grip.className = "col-grip";
  grip.setAttribute("aria-hidden", "true");
  document.body.appendChild(grip);
  let view = null, hot = null, pull = null, leaving = 0; // hot: { el, pos, i } the gap the grip stands in
  const colEls = (el) => [...el.children].filter((x) => x.classList.contains("col"));
  function gapAt(e) {
    const el = e.target.closest?.(".cols");
    if (!el || !view || el.parentElement !== view.dom || !el.pmViewDesc) return null;
    const cs = colEls(el);
    for (let i = 0; i < cs.length - 1; i++) {
      const a = cs[i].getBoundingClientRect(), b = cs[i + 1].getBoundingClientRect();
      if (e.clientX >= a.right - 3 && e.clientX <= b.left + 3) return { el, pos: el.pmViewDesc.posBefore, i };
    }
    return null;
  }
  function place(g) {
    hot = g;
    const cs = colEls(g.el), a = cs[g.i].getBoundingClientRect(), b = cs[g.i + 1].getBoundingClientRect(), r = g.el.getBoundingClientRect();
    grip.style.left = (a.right + b.left) / 2 - 6 + scrollX + "px";
    grip.style.top = r.top + scrollY + "px";
    grip.style.height = r.height + "px";
    grip.dataset.on = "";
  }
  const hide = () => { if (pull) return; clearTimeout(leaving); hot = null; delete grip.dataset.on; };
  document.addEventListener("mousemove", (e) => {
    if (pull || !view || !view.editable || document.body.dataset.view !== "active") return;
    if (e.buttons) return; // (something else is being dragged)
    if (grip.contains(e.target)) { clearTimeout(leaving); return; }
    const g = gapAt(e);
    if (g) { clearTimeout(leaving); if (!hot || hot.el !== g.el || hot.i !== g.i) place(g); }
    else if (hot) { clearTimeout(leaving); leaving = setTimeout(hide, 120); }
  });
  window.addEventListener("scroll", hide, { passive: true });
  grip.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !hot || !view || !hot.el.isConnected) return;
    e.preventDefault();
    e.stopPropagation();
    const cs = colEls(hot.el), cols = view.state.doc.nodeAt(hot.pos);
    if (!cols || cols.type !== N.columns) return;
    const w = columnsOf(cols).map((c) => c.attrs.width), total = w.reduce((a, b) => a + b, 0);
    pull = { ...hot, x: e.clientX, w, total, px: cs.map((c) => c.getBoundingClientRect().width), now: w.slice() };
    grip.dataset.pulling = "";
    document.body.classList.add("col-pulling");
  });
  document.addEventListener("mousemove", (e) => {
    if (!pull || !view) return;
    if (e.buttons === 0) { endPull(false); return; }
    e.preventDefault();
    const { i, w, total, px } = pull, both = w[i] + w[i + 1], span = px[i] + px[i + 1], floor = total * MIN;
    // the two beside the gap share what they had; no column narrower than its least
    let left = (both * (px[i] + e.clientX - pull.x)) / span;
    left = Math.max(Math.min(floor, both / 2), Math.min(both - Math.min(floor, both / 2), left));
    pull.now = w.slice();
    pull.now[i] = left;
    pull.now[i + 1] = both - left;
    view.dispatch(view.state.tr.setMeta(key, { pos: pull.pos, widths: pull.now }).setMeta("addToHistory", false));
    const cs = colEls(pull.el);
    if (cs[i] && cs[i + 1]) { const a = cs[i].getBoundingClientRect(), b = cs[i + 1].getBoundingClientRect(); grip.style.left = (a.right + b.left) / 2 - 6 + scrollX + "px"; }
  }, true);
  function endPull(write) {
    const p = pull;
    if (!p) return;
    pull = null;
    delete grip.dataset.pulling;
    document.body.classList.remove("col-pulling");
    if (!view) return;
    const tr = view.state.tr.setMeta(key, null);
    if (write && p.now.some((x, k) => Math.abs(x - p.w[k]) > 1e-6) && view.state.doc.nodeAt(p.pos)?.type === N.columns) {
      // written as whole shares of a hundred (62:38); alike again when they are nearly so
      const sum = p.now.reduce((a, b) => a + b, 0);
      let shares = p.now.map((x) => Math.max(1, Math.round((x / sum) * 100)));
      if (shares.every((s) => Math.abs(s - 100 / shares.length) <= 1.5)) shares = shares.map(() => 1);
      widthsTr(tr, p.pos, shares).setMeta("step", true);
    } else tr.setMeta("addToHistory", false);
    view.dispatch(tr);
  }
  document.addEventListener("mouseup", (e) => { if (pull && e.button === 0) endPull(true); }, true);
  window.addEventListener("blur", () => endPull(false));
  grip.addEventListener("dblclick", (e) => {
    if (!hot || !view) return;
    e.preventDefault();
    const cols = view.state.doc.nodeAt(hot.pos);
    if (cols && cols.type === N.columns && !(alike(cols) && cols.firstChild.attrs.width === 1)) view.dispatch(widthsTr(view.state.tr, hot.pos, columnsOf(cols).map(() => 1)).setMeta("step", true));
  });
  grip.addEventListener("mouseleave", () => { if (!pull) leaving = setTimeout(hide, 120); });

  const plugin = new Plugin({
    key,
    state: {
      init: () => null,
      apply: (tr, value) => { const m = tr.getMeta(key); return m !== undefined ? m : value && tr.docChanged ? null : value; },
    },
    view(v) { view = v; return { update() { if (hot && !hot.el.isConnected) hide(); }, destroy() { if (view === v) view = null; hide(); } }; },
    props: {
      // while the gap is pulled, the columns show the widths they would get
      decorations(state) {
        const p = key.getState(state), cols = p && state.doc.nodeAt(p.pos);
        if (!cols || cols.type !== N.columns || cols.childCount !== p.widths.length) return null;
        const decos = [];
        let pos = p.pos + 1;
        cols.forEach((col, _o, i) => { decos.push(Decoration.node(pos, pos + col.nodeSize, { style: `flex: ${p.widths[i]} 1 0` })); pos += col.nodeSize; });
        return DecorationSet.create(state.doc, decos);
      },
      // Backspace in a column with nothing in it: the column goes
      handleKeyDown(v, e) {
        if (e.key !== "Backspace" || e.ctrlKey || e.metaKey || e.altKey || !v.editable) return false;
        const sel = v.state.selection, c = at(v.state);
        if (!c || !sel.empty || !blank(c.col) || sel.$from.parent !== c.col.firstChild) return false;
        e.preventDefault();
        return remove(v.state, (tr) => v.dispatch(tr.setMeta("step", true)));
      },
    },
  });

  A.columns = { plugin, at, around, blank, make, add, remove, unwrap, equal, move, alike, tidy, beside, empty };
})();
