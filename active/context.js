/* mdview active mode — the context menu, and the commands it shares with the
 * formatting bar: what a selection is (bold, a heading, a list …) and what
 * can be put in at the caret. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { Plugin, PluginKey, TextSelection, NodeSelection, Selection } = PM.state;
  const C = PM.commands;
  const N = A.schema.nodes, M = A.schema.marks;
  const { copy, follow } = window.MdView.core;
  const post = (type, data = {}) => window.webkit?.messageHandlers?.mdview?.postMessage(JSON.stringify({ type, ...data }));

  // ------------------------------------------------------------ what the selection is
  function markActive(state, type) {
    const { from, to, empty, $from } = state.selection;
    return empty ? !!type.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, type);
  }
  // the kind of block the selection starts in: "text", "h1"…"h6", "bullet", "ordered", "task", plus quote
  function blockKind(state) {
    const { $from } = state.selection;
    const item = A.edit.itemAt($from), list = A.edit.ancestor($from, (n) => /_list$/.test(n.type.name));
    const q = A.edit.ancestor($from, (n) => n.type === N.blockquote), quote = !!q;
    let kind = $from.parent.type === N.heading ? "h" + $from.parent.attrs.level : "text";
    if (item && list) kind = item.node.attrs.task != null ? "task" : list.node.type === N.ordered_list ? "ordered" : "bullet";
    return { kind, quote, deco: q ? (q.node.attrs.callout ? "callout" : q.node.attrs.deco || "quote") : null, color: q ? q.node.attrs.color : null,
      callout: q && q.node.attrs.callout ? q.node.attrs.callout.toLowerCase() : null, cell: !!A.tableui.cellAt($from), textblock: $from.parent.isTextblock };
  }
  const toggleQuote = (state, dispatch) => (A.edit.ancestor(state.selection.$from, (n) => n.type === N.blockquote) ? C.lift(state, dispatch) : C.wrapIn(N.blockquote)(state, dispatch));
  /* A decoration around the block: a quote (deco null), a tinted block, a focus bar — in a colour.
   * In a quote already, that quote becomes it. */
  const setDeco = (deco, color = null) => (state, dispatch) => {
    const q = A.edit.ancestor(state.selection.$from, (n) => n.type === N.blockquote);
    if (!q) return C.wrapIn(N.blockquote, { deco, color: deco ? color : null })(state, dispatch);
    if (dispatch) dispatch(state.tr.setNodeMarkup(q.pos, null, { ...q.node.attrs, deco, color: deco ? color : null, callout: null, title: null }));
    return true;
  };
  // a callout around the block (an info, a warning …); a quote or a callout that is there becomes it, its title stays
  const setCallout = (type) => (state, dispatch) => {
    const q = A.edit.ancestor(state.selection.$from, (n) => n.type === N.blockquote);
    if (!q) return C.wrapIn(N.blockquote, { callout: type })(state, dispatch);
    if (dispatch) dispatch(state.tr.setNodeMarkup(q.pos, null, { ...q.node.attrs, deco: null, color: null, callout: type }));
    return true;
  };
  // out of a list first, then the command (a heading does not sit in a list item by choice)
  const E = () => A.edit.commands;
  const PARAGRAPH = {
    text: (s, d) => E().setParagraph(s, d),
    h1: (s, d) => E().setHeading(1)(s, d), h2: (s, d) => E().setHeading(2)(s, d), h3: (s, d) => E().setHeading(3)(s, d),
    h4: (s, d) => E().setHeading(4)(s, d), h5: (s, d) => E().setHeading(5)(s, d), h6: (s, d) => E().setHeading(6)(s, d),
    bullet: (s, d) => E().toggleList(N.bullet_list)(s, d),
    ordered: (s, d) => E().toggleList(N.ordered_list)(s, d),
    task: (s, d) => E().toggleTaskList(s, d),
    quote: toggleQuote,
  };
  const MARKS = { strong: "Mod-b", em: "Mod-i", s: "Shift-Mod-x", code: "Mod-`" };
  const run = (view, command) => { if (!view.hasFocus()) view.focus(); return command(view.state, (tr) => view.dispatch(tr.setMeta("step", true)), view); };
  const toggle = (view, mark) => run(view, A.edit.keys[MARKS[mark]]);

  // the selected text as a formula
  function toMath(view) {
    const { from, to, empty, $from, $to } = view.state.selection;
    if (empty || !$from.sameParent($to) || !$from.parent.isTextblock) return false;
    const text = view.state.doc.textBetween(from, to).trim();
    if (!text) return false;
    const made = A.islands.blocksOf("$" + text + "$", A.view.store)[0];
    let atom = null;
    if (made) made.descendants((n) => { if (n.type === N.iatom && n.attrs.kind === "math") atom = n; });
    if (!atom) return false;
    view.dispatch(view.state.tr.replaceWith(from, to, atom).scrollIntoView().setMeta("step", true));
    view.focus();
    return true;
  }

  // ------------------------------------------------------------ putting something in
  /* A block at the caret: in place of an empty paragraph, else below the block the caret is in.
   * at: a place between two blocks instead (something dropped there). -> its position */
  function putBlock(view, node, caretIn, at = null) {
    const state = view.state, { $from } = state.selection;
    const tr = state.tr;
    let pos;
    if (at != null) {
      pos = at;
      tr.insert(pos, node);
    } else if ($from.parent.type === N.paragraph && !$from.parent.content.size && $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), node.type)) {
      pos = $from.before();
      tr.replaceWith(pos, $from.after(), node);
    } else {
      // below the block the caret is in (inside a list item or a quote: there), else below the whole block
      const here = $from.depth > 1 && $from.node(-1).canReplaceWith($from.indexAfter(-1), $from.indexAfter(-1), node.type);
      pos = here ? $from.after() : $from.depth ? $from.after(1) : $from.pos;
      tr.insert(pos, node);
    }
    if (caretIn) tr.setSelection(Selection.near(tr.doc.resolve(pos + 1), 1));
    else if (NodeSelection.isSelectable(node)) tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr.scrollIntoView().setMeta("step", true));
    view.focus();
    return pos;
  }
  const island = (raw, kind) => A.islands.blocksOf(raw, A.view.store).find((n) => n.type === N.island) || N.island.create({ kind, raw });
  const INSERT = {
    graphic(view) { setTimeout(() => A.graphic.open(view), 0); }, // a figure drawn by Claude (graphic.js)
    code(view, at) { const pos = putBlock(view, island("```\n```", "code"), false, at); setTimeout(() => A.islands.open(view, pos, true), 0); },
    math(view, at) { const pos = putBlock(view, island("$$\n\n$$", "math"), false, at); setTimeout(() => A.islands.open(view, pos, true), 0); },
    table(view, at) {
      const row = (header) => N.table_row.create(null, [0, 1].map(() => N.table_cell.create({ header })));
      putBlock(view, N.table.create(null, [row(true), row(false), row(false)]), true, at);
    },
    rule(view, at) {
      const pos = putBlock(view, N.horizontal_rule.create(), false, at);
      const tr = view.state.tr, after = pos + 1;
      if (after >= tr.doc.content.size) tr.insert(after, N.paragraph.create());
      view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(after + 1, tr.doc.content.size)), 1)));
    },
    footnote(view) { run(view, A.notes.insert); },
    image(view) {
      const { from, to } = view.state.selection;
      if (!view.state.selection.$from.parent.inlineContent) return;
      view.dispatch(view.state.tr.replaceWith(from, to, N.image.create({ src: "", alt: "" })).setMeta("step", true));
      setTimeout(() => A.islands.open(view, from), 0);
    },
  };

  // ------------------------------------------------------------ the menu
  const item = (key, runIt, more) => ({ label: T(key), run: runIt, ...more });
  function clipboard(view, what) {
    view.focus();
    if (document.execCommand(what)) return;
    // not allowed by the page: the Markdown by hand
    const sel = view.state.selection;
    copy(A.clip.markdownOf(view.state, sel.content()));
    if (what === "cut") view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  }
  function textItems(view, pos) {
    const state = view.state, { empty } = state.selection, b = blockKind(state);
    const link = A.link.linkAt(state, pos);
    const go = (command) => () => run(view, command);
    const para = (kind, key, more) => item(key, go(PARAGRAPH[kind]), { checked: kind === "quote" ? b.quote : b.kind === kind, ...more });
    const items = [
      item("menu.cut", () => clipboard(view, "cut"), { key: "Ctrl+X", disabled: empty }),
      item("menu.copy", () => clipboard(view, "copy"), { key: "Ctrl+C", disabled: empty }),
      item("menu.paste", () => { view.focus(); post("pasteclip"); }, { key: "Ctrl+V" }),
      item("menu.pastePlain", () => { view.focus(); post("pastetext"); }, { key: "Ctrl+Shift+V" }),
      null,
    ];
    if (link) items.push(item("menu.openLink", () => follow(link.mark.attrs.href)));
    items.push(item(link ? "menu.editLink" : "menu.link", () => { view.focus(); A.link.edit(view); }, { key: "Ctrl+K", disabled: !b.textblock }), null);
    items.push({ label: T("menu.format"), disabled: !b.textblock, items: [
      item("menu.bold", () => toggle(view, "strong"), { key: "Ctrl+B", checked: markActive(state, M.strong) }),
      item("menu.italic", () => toggle(view, "em"), { key: "Ctrl+I", checked: markActive(state, M.em) }),
      item("menu.strike", () => toggle(view, "s"), { key: "Ctrl+Shift+X", checked: markActive(state, M.s) }),
      item("menu.code", () => toggle(view, "code"), { key: "Ctrl+`", checked: markActive(state, M.code) }),
      null,
      item("menu.math", () => toMath(view), { disabled: empty }),
    ] });
    if (!b.cell) {
      items.push({ label: T("menu.paragraph"), items: [
        para("text", "menu.text"),
        ...[1, 2, 3, 4, 5, 6].map((n) => item("menu.heading", go(PARAGRAPH["h" + n]), { label: T("menu.heading", n), checked: b.kind === "h" + n })),
        null,
        para("bullet", "menu.bullet"), para("ordered", "menu.ordered"), para("task", "menu.task"), para("quote", "menu.quote"),
      ] });
      items.push({ label: T("menu.insert"), items: [
        item("menu.codeBlock", () => INSERT.code(view)), item("menu.formula", () => INSERT.math(view)),
        item("menu.table", () => INSERT.table(view)), item("menu.rule", () => INSERT.rule(view)),
        item("menu.image", () => INSERT.image(view)),
        item("menu.graphic", () => INSERT.graphic(view)),
        item("menu.footnote", () => INSERT.footnote(view), { key: "Ctrl+Alt+F" }),
      ] });
    } else {
      const cell = A.tableui.cellAt(state.selection.$from);
      items.push(null, { label: T("table.row"), items: A.tableui.rowItems(view, cell) }, { label: T("table.column"), items: A.tableui.colItems(view, cell) },
        item("table.wide", () => A.tableui.wide(view, cell), { checked: !!cell.table.attrs.wide }),
        item("table.delete", () => A.tableui.change(view, cell.tablePos, A.tableui.ops.remove()), { danger: true }));
    }
    // in a column: what can be done with the columns (the "/" menu's entries for them)
    if (A.columns.at(state)) {
      const group = A.slash.entries(view).find((e) => e && e.key === "slash.columns");
      if (group) items.push(null, { label: T("slash.columns"), items: group.items.map((e) => e && { label: e.label || T(e.key, e.n), run: () => e.act(view), disabled: e.disabled, danger: e.danger }) });
    }
    items.push(null, item("prefs.open", () => A.prefs.open(), { key: "Ctrl+," }));
    return items;
  }
  function nodeItems(view, pos, node) {
    const raw = node.type === N.image ? A.clip.markdownOf(view.state, new PM.model.Slice(PM.model.Fragment.from(node), 0, 0)) : node.attrs.raw;
    const editable = !(node.type === N.island && node.attrs.virtual);
    // a picture, an embedded picture or PDF page: how large it shows, and — a PDF — which part of the page
    const pic = editable ? A.islands.picture(view, pos, node) : null;
    return [
      item("menu.edit", () => A.islands.open(view, pos), { key: "↩", disabled: !editable }),
      ...(pic ? [null, { label: T("dialog.size"), items: pic.sizes.map(([v, label]) => item("dialog.size", () => pic.setSize(v), { label, checked: v === pic.size })) },
        ...(pic.pdf ? [item("dialog.adjust", () => A.islands.adjust(view, pos), { label: T("dialog.adjust") + "…" })] : [])] : []),
      null,
      item("menu.cut", () => { copy(raw); view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize)); view.focus(); }, { key: "Ctrl+X" }),
      item("menu.copyMarkdown", () => { copy(raw); view.focus(); }, { key: "Ctrl+C" }),
      null,
      item("menu.delete", () => { view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize)); view.focus(); }, { danger: true, key: "⌫" }),
    ];
  }

  const plugin = new Plugin({
    key: new PluginKey("context"),
    props: {
      // the menu key, Shift+F10: the menu at the caret
      handleKeyDown(view, e) {
        if (!(e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) || !view.editable) return false;
        e.preventDefault();
        const sel = view.state.selection, c = view.coordsAtPos(sel.to, -1);
        const node = sel.node && sel.node.isAtom ? sel.node : null;
        A.menu.open({ x: c.left, y: c.bottom + 4, above: c.top - 4, items: node ? nodeItems(view, sel.from, node) : textItems(view, sel.from), closed: () => view.focus() });
        return true;
      },
      handleDOMEvents: {
        contextmenu(view, e) {
          if (!view.editable || e.target.closest?.(".pm") !== view.dom) return false;
          e.preventDefault();
          A.tableui.hide();
          const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
          if (!at) return true;
          // an island, a formula, a picture: the thing itself
          const inside = at.inside >= 0 ? view.state.doc.nodeAt(at.inside) : null;
          const atomDom = e.target.closest?.(".isl, .ia, .im");
          let node = inside && inside.isAtom && !inside.isText && inside.type !== N.hard_break ? inside : null, pos = at.inside;
          if (!node && atomDom && atomDom.closest(".pm") === view.dom) {
            pos = view.posAtDOM(atomDom, 0);
            const $p = view.state.doc.resolve(pos);
            node = [$p.nodeAfter, $p.nodeBefore].find((n) => n && n.isAtom && !n.isText) || null;
            if (node && node === $p.nodeBefore && node !== $p.nodeAfter) pos -= node.nodeSize;
          }
          if (node && (node.type === N.hidden || (node.type === N.island && node.attrs.virtual))) return true;
          let items;
          if (node) {
            if (NodeSelection.isSelectable(node)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            items = nodeItems(view, pos, node);
          } else {
            const { from, to } = view.state.selection;
            if (at.pos < from || at.pos > to) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at.pos))));
            items = textItems(view, at.pos);
          }
          A.menu.open({ x: e.clientX, y: e.clientY, items, closed: () => view.focus() });
          return true;
        },
      },
    },
  });

  A.context = { plugin, markActive, blockKind, toggle, toMath, run, setDeco, setCallout, putBlock, island, PARAGRAPH, INSERT, textItems, nodeItems };
})();
