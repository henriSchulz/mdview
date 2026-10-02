/* mdview active mode — working on a table: keys in a cell, the handles that
 * show over a row and a column, and the menu with what can be done to them. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, TextSelection } = PM.state;
  const N = A.schema.nodes;

  // the cell around a position: { node, pos, r, c, table, tablePos }
  function cellAt($pos) {
    for (let d = $pos.depth; d > 2; d--) {
      if ($pos.node(d).type !== N.table_cell) continue;
      return { node: $pos.node(d), pos: $pos.before(d), r: $pos.index(d - 2), c: $pos.index(d - 1), table: $pos.node(d - 2), tablePos: $pos.before(d - 2) };
    }
    return null;
  }
  const matrixOf = (table) => { const rows = []; table.forEach((row) => { const cells = []; row.forEach((cell) => cells.push(cell)); rows.push(cells); }); return rows; };
  const alignsOf = (table) => matrixOf(table)[0].map((cell) => cell.attrs.align);
  const empty = () => N.table_cell.create();
  // a table from rows of cells: the first row is the header, a column has one alignment
  function build(table, rows, aligns) {
    return N.table.create(table.attrs, rows.map((cells, r) => N.table_row.create(null, cells.map((cell, c) => {
      const header = r === 0, align = aligns[c] || null;
      return cell.attrs.header === header && cell.attrs.align === align ? cell : N.table_cell.create({ ...cell.attrs, header, align }, cell.content);
    }))));
  }
  // the position inside cell r, c of the table at tablePos
  function inside(table, tablePos, r, c) {
    let pos = tablePos + 1;
    for (let i = 0; i < r; i++) pos += table.child(i).nodeSize;
    pos += 1;
    for (let i = 0; i < c; i++) pos += table.child(r).child(i).nodeSize;
    return pos + 1;
  }
  function select(tr, table, tablePos, r, c, whole) {
    const start = inside(table, tablePos, r, c), end = start + table.child(r).child(c).content.size;
    return tr.setSelection(TextSelection.create(tr.doc, whole ? start : end, end));
  }

  /* One change to a table's rows and columns: one step, so one undo.
   * fn(rows, aligns) -> { rows, aligns, focus: [r, c], fresh: { row } | { col } } or null. */
  function changed(state, tablePos, fn) {
    const table = state.doc.nodeAt(tablePos);
    if (!table || table.type !== N.table) return null;
    const res = fn(matrixOf(table), alignsOf(table));
    if (!res) return null;
    const tr = state.tr;
    if (!res.rows.length || !res.rows[0].length) { // nothing left of it
      tr.replaceWith(tablePos, tablePos + table.nodeSize, N.paragraph.create({ bid: table.attrs.bid }));
      return { tr: tr.setSelection(TextSelection.create(tr.doc, tablePos + 1)).scrollIntoView().setMeta("step", true), res: {} };
    }
    const made = build(table, res.rows, res.aligns);
    tr.replaceWith(tablePos, tablePos + table.nodeSize, made);
    const [r, c] = res.focus;
    select(tr, made, tablePos, Math.min(r, made.childCount - 1), Math.min(c, made.child(0).childCount - 1), false);
    return { tr: tr.scrollIntoView().setMeta("step", true), res };
  }
  // … done in the view; what is new shimmers once
  function change(view, tablePos, fn) {
    const did = changed(view.state, tablePos, fn);
    if (!did) return false;
    const res = did.res;
    A.view.gentle = "near"; // if the page has to move for it, it moves gently and no further than needed
    view.dispatch(did.tr);
    A.view.gentle = false;
    if (!view.hasFocus()) view.focus();
    const dom = view.nodeDOM(tablePos), rowsEl = dom && dom.querySelectorAll ? [...dom.querySelectorAll("tr")] : [];
    const cells = res.fresh && res.fresh.row != null ? [...(rowsEl[res.fresh.row]?.children || [])]
      : res.fresh && res.fresh.col != null ? rowsEl.map((row) => row.children[res.fresh.col]).filter(Boolean) : [];
    cells.forEach((cell) => cell.classList.add("fresh"));
    if (cells.length) requestAnimationFrame(() => requestAnimationFrame(() => cells.forEach((cell) => cell.classList.remove("fresh"))));
    return true;
  }
  const move = (list, from, to) => { const out = list.slice(); out.splice(to, 0, out.splice(from, 1)[0]); return out; };
  const ops = {
    // (c: the column the caret goes to in the new row — the one it was asked from)
    rowAbove: (r, c = 0) => (rows, aligns) => ({ rows: [...rows.slice(0, r), aligns.map(empty), ...rows.slice(r)], aligns, focus: [r, c], fresh: { row: r } }),
    rowBelow: (r, c = 0) => (rows, aligns) => ({ rows: [...rows.slice(0, r + 1), aligns.map(empty), ...rows.slice(r + 1)], aligns, focus: [r + 1, c], fresh: { row: r + 1 } }),
    rowMove: (r, by, c = 0) => (rows, aligns) => (r + by < 0 || r + by >= rows.length ? null : { rows: move(rows, r, r + by), aligns, focus: [r + by, c], fresh: { row: r + by } }),
    rowDelete: (r) => (rows, aligns) => ({ rows: rows.filter((_x, i) => i !== r), aligns, focus: [Math.max(0, Math.min(r, rows.length - 2)), 0] }),
    colLeft: (c) => (rows, aligns) => ({ rows: rows.map((cells) => [...cells.slice(0, c), empty(), ...cells.slice(c)]), aligns: [...aligns.slice(0, c), null, ...aligns.slice(c)], focus: [0, c], fresh: { col: c } }),
    colRight: (c) => (rows, aligns) => ({ rows: rows.map((cells) => [...cells.slice(0, c + 1), empty(), ...cells.slice(c + 1)]), aligns: [...aligns.slice(0, c + 1), null, ...aligns.slice(c + 1)], focus: [0, c + 1], fresh: { col: c + 1 } }),
    colMove: (c, by, r = 0) => (rows, aligns) => (c + by < 0 || c + by >= aligns.length ? null : { rows: rows.map((cells) => move(cells, c, c + by)), aligns: move(aligns, c, c + by), focus: [r, c + by], fresh: { col: c + by } }),
    colDelete: (c) => (rows, aligns) => ({ rows: rows.map((cells) => cells.filter((_x, i) => i !== c)), aligns: aligns.filter((_x, i) => i !== c), focus: [0, Math.max(0, Math.min(c, aligns.length - 2))] }),
    align: (c, how, r = 0) => (rows, aligns) => ({ rows, aligns: aligns.map((a, i) => (i === c ? (a === how ? null : how) : a)), focus: [r, c] }),
    remove: () => () => ({ rows: [], aligns: [] }),
  };

  // ------------------------------------------------------------ keys
  // Tab: the next cell (its content selected); behind the last one, a new row
  const tab = (dir) => (state, dispatch) => {
    const cell = cellAt(state.selection.$from);
    if (!cell) return false;
    const cols = cell.table.child(0).childCount, rows = cell.table.childCount;
    const i = cell.r * cols + cell.c + dir;
    if (i < 0) return true;
    if (i >= rows * cols) { if (dispatch) dispatch(changed(state, cell.tablePos, ops.rowBelow(rows - 1)).tr); return true; }
    if (dispatch) dispatch(select(state.tr, cell.table, cell.tablePos, Math.floor(i / cols), i % cols, true).scrollIntoView());
    return true;
  };
  // Enter: the cell below; in the last row, a new one
  function enter(state, dispatch) {
    const cell = cellAt(state.selection.$from);
    if (!cell) return false;
    if (!dispatch) return true;
    if (cell.r === cell.table.childCount - 1) dispatch(changed(state, cell.tablePos, (rows, aligns) => ({ ...ops.rowBelow(cell.r)(rows, aligns), focus: [cell.r + 1, cell.c] })).tr);
    else dispatch(select(state.tr, cell.table, cell.tablePos, cell.r + 1, cell.c, false).scrollIntoView());
    return true;
  }
  // a cell holds one line: no break in it
  const noBreak = (state) => !!cellAt(state.selection.$from);
  // `| a | b |` and Enter: a table with these columns
  function make(state, dispatch) {
    const { $from, empty: caret } = state.selection, para = $from.parent;
    if (!caret || para.type !== N.paragraph || $from.parentOffset !== para.content.size) return false;
    const text = para.textContent;
    if (!/^\|.*[^\\]\|\s*$/.test(text) || para.content.size !== text.length) return false;
    const names = A.tables.splitRow(text);
    if (!names.length || /^[\s:|-]*$/.test(text)) return false;
    const index = $from.index(-1);
    if (!$from.node(-1).canReplaceWith(index, index + 1, N.table)) return false;
    if (!dispatch) return true;
    const cellOf = (name, header) => N.table_cell.create({ header }, name ? state.schema.text(name.replace(/\\\|/g, "|")) : null);
    const table = N.table.create({ bid: para.attrs.bid }, [
      N.table_row.create(null, names.map((name) => cellOf(name, true))),
      N.table_row.create(null, names.map(() => cellOf("", false))),
    ]);
    const pos = $from.before();
    const tr = state.tr.replaceWith(pos, $from.after(), table);
    dispatch(select(tr, table, pos, 1, 0, false).scrollIntoView());
    return true;
  }

  // ------------------------------------------------------------ menu
  const item = (key, run, more) => ({ label: T(key), run, ...more });
  function rowItems(view, cell) {
    const go = (op) => () => change(view, cell.tablePos, op), last = cell.table.childCount - 1;
    return [
      item("table.rowAbove", go(ops.rowAbove(cell.r, cell.c)), { disabled: cell.r === 0 }),
      item("table.rowBelow", go(ops.rowBelow(cell.r, cell.c))),
      item("table.rowUp", go(ops.rowMove(cell.r, -1, cell.c)), { disabled: cell.r < 2 }),
      item("table.rowDown", go(ops.rowMove(cell.r, 1, cell.c)), { disabled: cell.r === 0 || cell.r === last }),
      null,
      item("table.rowDelete", go(ops.rowDelete(cell.r)), { danger: true, disabled: cell.r === 0 }),
    ];
  }
  function colItems(view, cell) {
    const go = (op) => () => change(view, cell.tablePos, op), last = cell.table.child(0).childCount - 1;
    const align = cell.table.child(0).child(cell.c).attrs.align;
    return [
      item("table.colLeft", go(ops.colLeft(cell.c))),
      item("table.colRight", go(ops.colRight(cell.c))),
      item("table.colMoveLeft", go(ops.colMove(cell.c, -1, cell.r)), { disabled: cell.c === 0 }),
      item("table.colMoveRight", go(ops.colMove(cell.c, 1, cell.r)), { disabled: cell.c === last }),
      null,
      ...["left", "center", "right"].map((how) => item("table.align." + how, go(ops.align(cell.c, how, cell.r)), { checked: align === how })),
      null,
      item("table.colDelete", go(ops.colDelete(cell.c)), { danger: true, disabled: last === 0 }),
    ];
  }
  const cellOfDom = (view, dom) => { const pos = view.posAtDOM(dom, 0); return cellAt(view.state.doc.resolve(pos)); };

  // ------------------------------------------------------------ handles
  const handles = { col: document.createElement("button"), row: document.createElement("button") };
  for (const [kind, h] of Object.entries(handles)) {
    h.className = "tbl-h tbl-h-" + kind;
    h.type = "button";
    h.tabIndex = -1;
    h.setAttribute("aria-label", T(kind === "col" ? "table.column" : "table.row"));
    h.innerHTML = "<i></i><i></i><i></i>";
    document.body.appendChild(h);
  }
  let over = null; // the cell element the handles belong to
  function place(td) {
    over = td;
    const table = td.closest("table").getBoundingClientRect(), wrap = td.closest(".table-wrap").getBoundingClientRect(), r = td.getBoundingClientRect();
    const sx = scrollX, sy = scrollY;
    const cx = Math.max(wrap.left, Math.min(r.left + r.width / 2, wrap.right));
    handles.col.style.left = cx + sx + "px";
    handles.col.style.top = table.top + sy + "px";
    handles.row.style.left = Math.max(wrap.left, table.left) + sx + "px";
    handles.row.style.top = r.top + r.height / 2 + sy + "px";
    handles.col.dataset.on = handles.row.dataset.on = "";
  }
  function hide() {
    over = null;
    delete handles.col.dataset.on;
    delete handles.row.dataset.on;
  }
  for (const [kind, h] of Object.entries(handles)) {
    h.addEventListener("mousedown", (e) => e.preventDefault()); // the caret stays
    h.addEventListener("mouseleave", (e) => { if (!e.relatedTarget?.closest?.(".pm table, .tbl-h") && !A.menu.isOpen) hide(); });
    h.addEventListener("click", () => {
      const view = A.view.pm, td = over;
      if (!view || !td || !td.isConnected) return;
      const cell = cellOfDom(view, td);
      if (!cell) return;
      const r = h.getBoundingClientRect();
      h.dataset.held = "";
      A.menu.open({ x: kind === "col" ? r.left : r.right + 4, y: kind === "col" ? r.bottom + 4 : r.top, items: kind === "col" ? colItems(view, cell) : rowItems(view, cell), closed: () => view.focus() });
      const done = new MutationObserver(() => { if (!A.menu.isOpen) { delete h.dataset.held; done.disconnect(); if (!h.matches(":hover")) hide(); } });
      done.observe(A.menu.el, { attributes: true });
    });
  }

  const key = new PluginKey("tables");
  const plugin = new Plugin({
    key,
    // a table stays what GFM can write: a header row, one alignment per column, one line per cell
    appendTransaction(trs, _old, state) {
      if (!trs.some((tr) => tr.docChanged)) return null;
      let tr = null;
      state.doc.descendants((node, pos) => {
        if (node.type !== N.table) return !node.isTextblock;
        const aligns = alignsOf(node);
        node.forEach((row, ro, r) => row.forEach((cell, co, c) => {
          const at = pos + 1 + ro + 1 + co, header = r === 0, align = aligns[c] || null;
          if (cell.attrs.header !== header || cell.attrs.align !== align) (tr = tr || state.tr).setNodeMarkup(at, null, { ...cell.attrs, header, align });
          cell.forEach((child, o) => {
            if (child.type === N.hard_break) (tr = tr || state.tr).replaceWith(tr.mapping.map(at + 1 + o), tr.mapping.map(at + 1 + o + 1), state.schema.text(" "));
          });
        }));
        return false;
      });
      return tr;
    },
    props: {
      handleDOMEvents: {
        mousemove(view, e) {
          if (!view.editable || A.menu.isOpen) return false;
          const td = e.target.closest?.("td, th");
          if (td && td.closest(".pm") === view.dom && !td.closest(".isl")) { if (td !== over) place(td); }
          else if (over) hide();
          return false;
        },
        mouseleave(_view, e) {
          if (over && !e.relatedTarget?.closest?.(".tbl-h") && !A.menu.isOpen) hide();
          return false;
        },
        keydown() { if (over) hide(); return false; },
      },
    },
  });

  A.tableui = { plugins: () => [plugin, PM.tables.tableEditing({ allowTableNodeSelection: false })], tab, enter, noBreak, make, change, changed, ops, cellAt, hide, rowItems, colItems };
})();
