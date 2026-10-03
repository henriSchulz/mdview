/* mdview active mode — editing: commands, keys, input rules and the plugins
 * that keep the document in order while it is typed in. */
"use strict";
(() => {
  const A = window.MdActive;
  const { md, slugify, isExternal } = window.MdView.core;
  const { Plugin, PluginKey, TextSelection, NodeSelection, AllSelection, Selection } = PM.state;
  const { Decoration, DecorationSet } = PM.view;
  const { keymap } = PM.keymap;
  const C = PM.commands, L = PM.schemaList, IR = PM.inputrules, H = PM.history;
  const schema = A.schema, N = schema.nodes, M = schema.marks;

  // ------------------------------------------------------------ helpers
  // the nearest ancestor of a kind: { node, pos, depth } or null
  function ancestor($pos, test) {
    for (let d = $pos.depth; d > 0; d--) if (test($pos.node(d))) return { node: $pos.node(d), pos: $pos.before(d), depth: d };
    return null;
  }
  const isList = (n) => n.type === N.bullet_list || n.type === N.ordered_list;
  const itemAt = ($pos) => ancestor($pos, (n) => n.type === N.list_item);
  // the document a state belongs to ({ store, loaded }), for what depends on the file: its links, its style
  const context = new PluginKey("context");
  const storeOf = (state) => (context.getState(state) || {}).store || null;
  const docOf = (state) => context.getState(state) || null;
  const renderInline = (state, src) => md.renderInline(src, { links: (storeOf(state) && storeOf(state).env.links) || {}, depth: 0 });

  // ------------------------------------------------------------ commands
  const setParagraph = C.setBlockType(N.paragraph);
  const setHeading = (level) => (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.parent.type === N.heading && $from.parent.attrs.level === level) return keepBid(setParagraph)(state, dispatch);
    return keepBid(C.setBlockType(N.heading, { level }))(state, dispatch);
  };
  /* setBlockType gives the block fresh attributes; it is still the block the
   * file has there, so it keeps its place in the source (bid). */
  const keepBid = (command) => (state, dispatch) => command(state, dispatch && ((tr) => {
    const { $from } = state.selection;
    const bid = $from.parent.attrs.bid;
    if (bid != null) {
      const pos = tr.mapping.map($from.before());
      const node = tr.doc.nodeAt(pos);
      if (node && node.isTextblock && node.attrs.bid == null) tr.setNodeMarkup(pos, null, { ...node.attrs, bid });
    }
    dispatch(tr);
  }));

  function toggleList(type, attrs) {
    return (state, dispatch) => {
      const { $from } = state.selection;
      const list = ancestor($from, isList);
      if (list && list.node.type === type) return L.liftListItem(N.list_item)(state, dispatch);
      if (list) { // the other kind of list: change it in place (its markers are the other kind's now)
        if (dispatch) {
          const tr = state.tr.setNodeMarkup(list.pos, type, { ...attrs, tight: list.node.attrs.tight, tasks: list.node.attrs.tasks });
          list.node.forEach((item, offset) => tr.setNodeMarkup(list.pos + 1 + offset, null, { ...item.attrs, markup: null, num: null }));
          dispatch(tr);
        }
        return true;
      }
      return L.wrapInList(type, attrs)(state, dispatch);
    };
  }
  // two lists of one kind next to each other are one list in Markdown
  const sameList = (a, b) => isList(a) && a.type === b.type && (a.attrs.markup == null || b.attrs.markup == null || a.attrs.markup === b.attrs.markup);
  // every list item the selection touches: task ↔ plain
  function toggleTaskList(state, dispatch) {
    const { $from, $to } = state.selection;
    if (!itemAt($from)) {
      if ($from.parent.type !== N.paragraph) return false;
      return L.wrapInList(N.bullet_list)(state, dispatch && ((tr) => {
        const item = itemAt(tr.selection.$from);
        if (item) tr.setNodeMarkup(item.pos, null, { ...item.node.attrs, task: " " });
        dispatch(tr);
      }));
    }
    const items = [];
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => { if (node.type === N.list_item) items.push([node, pos]); });
    // only the innermost items the selection is in
    const inner = items.filter(([n, p]) => !items.some(([n2, p2]) => p2 > p && p2 < p + n.nodeSize));
    const able = inner.filter(([n]) => n.firstChild.type === N.paragraph); // "[ ]" is the start of a paragraph
    if (!able.length) return false;
    const on = able.some(([n]) => n.attrs.task == null);
    if (dispatch) {
      const tr = state.tr;
      for (const [n, p] of able) tr.setNodeMarkup(p, null, { ...n.attrs, task: on ? (n.attrs.task ?? " ") : null, box: true });
      dispatch(tr);
    }
    return true;
  }
  const doneChar = (state) => {
    const store = storeOf(state);
    if (!store) return "x";
    if (store.done == null) store.done = (store.text.match(/\[X\]/g) || []).length > (store.text.match(/\[x\]/g) || []).length ? "X" : "x";
    return store.done;
  };
  const toggledTask = (state, ch) => (ch === " " ? doneChar(state) : " ");
  function toggleTask(state, dispatch) {
    const item = itemAt(state.selection.$from);
    if (!item || item.node.attrs.task == null) return false;
    if (dispatch) dispatch(state.tr.setNodeMarkup(item.pos, null, { ...item.node.attrs, task: toggledTask(state, item.node.attrs.task) }));
    return true;
  }

  /* Enter in a list: a new item of the same kind (a task starts unticked).
   * In an empty item: out one level, and at the top out of the list. */
  function enterInList(state, dispatch) {
    const { $from, empty } = state.selection;
    const item = itemAt($from);
    if (!item || !$from.parent.isTextblock) return false;
    if (empty && $from.parent.content.size === 0 && item.node.childCount === 1) return L.liftListItem(N.list_item)(state, dispatch);
    const attrs = { markup: item.node.attrs.markup, task: item.node.attrs.task == null ? null : " " };
    return trimSplit(L.splitListItem(N.list_item, attrs))(state, dispatch);
  }
  /* Enter in a heading: at its end a paragraph follows; in the middle the
   * second part becomes a paragraph. Elsewhere the block is split as it is. */
  const splitBlockAs = C.splitBlockAs((node, atEnd) => {
    if (node.type === N.heading) return { type: N.paragraph, attrs: atEnd ? null : { bid: node.attrs.bid } };
    return atEnd ? { type: N.paragraph } : null;
  });
  // … and the space the line was broken at goes: neither block starts or ends with one
  const trimSplit = (command) => (state, dispatch) => command(state, dispatch && ((tr) => {
    const $pos = tr.selection.$from;
    if ($pos.parent.isTextblock && $pos.parentOffset === 0) {
      const lead = /^[ \t]+/.exec($pos.parent.textBetween(0, Math.min($pos.parent.content.size, 20), null, "\ufffc"));
      if (lead) tr.delete($pos.pos, $pos.pos + lead[0].length);
      const prev = tr.doc.resolve($pos.before()).nodeBefore;
      if (prev && prev.isTextblock && prev.lastChild && prev.lastChild.isText) {
        const tail = /[ \t]+$/.exec(prev.lastChild.text);
        if (tail) { const end = $pos.before() - 1; tr.delete(end - tail[0].length, end); }
      }
    }
    dispatch(tr);
  }));
  const splitBlock = trimSplit(splitBlockAs);
  // "---" (or *** or ___) and Enter: a rule
  function ruleOnEnter(state, dispatch) {
    const { $from, empty } = state.selection;
    const p = $from.parent;
    if (!empty || p.type !== N.paragraph || $from.parentOffset !== p.content.size || $from.depth !== 1) return false;
    const m = /^(-{3,}|\*{3,}|_{3,})$/.exec(p.textContent);
    if (!m || p.childCount !== 1) return false;
    if (dispatch) {
      const tr = state.tr.replaceWith($from.before(), $from.after(), [N.horizontal_rule.create({ markup: m[1] }), N.paragraph.create()]);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.before() + 2)).scrollIntoView());
    }
    return true;
  }
  function hardBreak(state, dispatch) {
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.parent.type === N.heading) return true; // a heading is one line
    // a break needs a line to break: Markdown has no paragraph of nothing but line breaks
    let lines = false;
    $from.parent.forEach((child) => { if (child.type !== N.hard_break) lines = true; });
    if (!lines) return true;
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(N.hard_break.create());
      const $at = tr.selection.$from, next = $at.nodeAfter;
      const lead = next && next.isText ? /^[ \t]+/.exec(next.text) : null; // the new line does not start with the old space
      if (lead) tr.delete($at.pos, $at.pos + lead[0].length);
      dispatch(tr.scrollIntoView());
    }
    return true;
  }

  // the block before this one in its parent, hidden segments skipped: { node, pos } or null
  function visibleBefore($pos, depth) {
    const parent = $pos.node(depth - 1);
    let index = $pos.index(depth - 1), pos = $pos.before(depth);
    while (index > 0) {
      const node = parent.child(--index);
      pos -= node.nodeSize;
      if (node.type !== N.hidden) return { node, pos };
    }
    return null;
  }
  /* Backspace at the start of a block takes its formatting off first: a
   * heading becomes a paragraph, a list item or quote is left. Only then does
   * the next Backspace join it with what is above; an island above is
   * selected first, so that nothing is deleted by accident. */
  function backspaceAtStart(state, dispatch, view) {
    const { $cursor } = state.selection;
    if (!$cursor || $cursor.parentOffset > 0) return false;
    const block = $cursor.parent, depth = $cursor.depth;
    if (block.type === N.heading) return keepBid(setParagraph)(state, dispatch);
    const outer = $cursor.node(depth - 1);
    if ($cursor.index(depth - 1) === 0) {
      if (outer.type === N.list_item) return L.liftListItem(N.list_item)(state, dispatch);
      if (outer.type === N.blockquote) return C.lift(state, dispatch);
      return false;
    }
    const before = visibleBefore($cursor, depth);
    if (!before) return true; // only hidden segments above: nothing to join with
    if (before.node.isAtom && NodeSelection.isSelectable(before.node)) {
      if (dispatch) {
        const tr = state.tr;
        if (block.content.size === 0 && block.type === N.paragraph) tr.delete($cursor.before(), $cursor.after());
        dispatch(tr.setSelection(NodeSelection.create(tr.doc, before.pos)).scrollIntoView());
      }
      return true;
    }
    // a hidden segment in between: join by hand, it stays where it is
    if (before.pos + before.node.nodeSize !== $cursor.before() && before.node.isTextblock) {
      if (dispatch) {
        const end = before.pos + before.node.nodeSize - 1;
        const tr = state.tr.delete($cursor.before(), $cursor.after()).insert(end, block.content);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView());
      }
      return true;
    }
    return false;
  }
  // Ctrl+A: the block first, then everything
  function selectMore(state, dispatch) {
    const { $from, $to, from, to } = state.selection;
    if ($from.parent.isTextblock && $from.sameParent($to)) {
      const start = $from.start(), end = $from.end();
      if (from > start || to < end) {
        if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, end)));
        return true;
      }
    }
    return C.selectAll(state, dispatch);
  }
  function escape(state, dispatch, view) {
    const sel = state.selection;
    if (sel.empty && !(sel instanceof NodeSelection)) return false;
    if (dispatch) dispatch(state.tr.setSelection(Selection.near(sel.$head, 1)));
    return true;
  }
  // Enter or Space on a selected island, formula or picture: its dialog
  function openSelected(state, dispatch, view) {
    const sel = state.selection;
    if (!(sel instanceof NodeSelection) || !view || ![N.island, N.iatom, N.image].includes(sel.node.type)) return false;
    return A.islands.open(view, sel.from);
  }
  const inList = (command) => (state, dispatch) => (itemAt(state.selection.$from) ? command(state, dispatch) : false);
  const swallow = () => true;

  // after undo and redo the caret comes into view gently (view.js)
  const gently = (command) => (state, dispatch, view) => { if (dispatch) A.view.gentle = true; const ok = command(state, dispatch, view); if (!ok) A.view.gentle = false; return ok; };
  // nothing left to undo here: what was done before this mode took the document over (viewer.js)
  const beyond = (dir) => (_state, dispatch) => !!(dispatch && A.view.onHistory && A.view.onHistory(dir));
  const keys = {
    "Mod-z": C.chainCommands(IR.undoInputRule, gently(H.undo), beyond(-1)),
    "Shift-Mod-z": C.chainCommands(gently(H.redo), beyond(1)),
    "Mod-y": C.chainCommands(gently(H.redo), beyond(1)),
    "Mod-b": C.toggleMark(M.strong),
    "Mod-i": C.toggleMark(M.em),
    "Shift-Mod-x": C.toggleMark(M.s),
    "Mod-`": C.toggleMark(M.code),
    "Mod-k": (state, dispatch, view) => A.link.edit(view),
    "Mod-Alt-f": (s, d, v) => A.notes.insert(s, d, v),
    "Mod-,": () => A.prefs.open(),
    "Shift-Mod-0": keepBid(setParagraph),
    "Shift-Mod-7": toggleList(N.ordered_list),
    "Shift-Mod-8": toggleList(N.bullet_list),
    "Shift-Mod-9": toggleTaskList,
    "Mod-]": L.sinkListItem(N.list_item),
    "Mod-[": L.liftListItem(N.list_item),
    // (A.tableui and A.islands are loaded by the time a key is pressed)
    Tab: C.chainCommands((s, d, v) => A.tableui.tab(1)(s, d, v), inList(L.sinkListItem(N.list_item)), swallow),
    "Shift-Tab": C.chainCommands((s, d, v) => A.tableui.tab(-1)(s, d, v), inList(L.liftListItem(N.list_item)), swallow),
    "Mod-Enter": toggleTask,
    "Shift-Enter": C.chainCommands((s) => A.tableui.noBreak(s), hardBreak),
    Enter: C.chainCommands(openSelected, (s, d, v) => A.tableui.enter(s, d, v), (s, d, v) => A.islands.onEnter(s, d, v), (s, d) => A.tableui.make(s, d), ruleOnEnter, enterInList, C.createParagraphNear, C.liftEmptyBlock, splitBlock),
    Space: openSelected,
    Backspace: C.chainCommands(IR.undoInputRule, C.deleteSelection, backspaceAtStart, C.joinBackward, C.selectNodeBackward),
    Delete: C.chainCommands(C.deleteSelection, C.joinForward, C.selectNodeForward),
    "Mod-a": selectMore,
    Escape: escape,
  };
  for (let level = 1; level <= 6; level++) keys["Shift-Mod-" + level] = setHeading(level);

  // ------------------------------------------------------------ input rules
  /* `**text**` and friends: when the closing delimiter is typed, the
   * delimiters go and the text gets the mark. match[1]: all of it, match[2]: the text. */
  function markRule(re, type, attrs) {
    return new IR.InputRule(re, (state, match, start, end) => {
      const tr = state.tr;
      const textStart = start + match[0].indexOf(match[1]);
      const innerStart = textStart + match[1].indexOf(match[2]), innerEnd = innerStart + match[2].length;
      if (state.doc.rangeHasMark(textStart, end, M.code)) return null;
      // behind a backtick that is still open, this is code being typed: its stars stay stars
      if (type !== M.code) {
        const $s = state.doc.resolve(textStart);
        if ((($s.parent.textBetween(0, $s.parentOffset, null, "\ufffc").match(/`/g) || []).length) % 2) return null;
      }
      if (innerEnd < end) tr.delete(innerEnd, end);
      if (innerStart > textStart) tr.delete(textStart, innerStart);
      const to = textStart + match[2].length;
      tr.addMark(textStart, to, type.create(typeof attrs === "function" ? attrs(match) : attrs));
      tr.removeStoredMark(type);
      return tr;
    });
  }
  // `$x$`, `[[Note]]`: text that becomes an atom, drawn by the reading view's renderer
  function atomRule(re, kind) {
    return new IR.InputRule(re, (state, match, start, end) => {
      const raw = match[1], from = start + match[0].indexOf(raw);
      const html = renderInline(state, raw);
      if (!/</.test(html)) return null; // the renderer does not see it as that
      return state.tr.replaceWith(from, end, N.iatom.create({ kind, raw, html }));
    });
  }
  const startOfTextblock = (state, start) => state.doc.resolve(start).parentOffset === 0;
  const rules = [
    IR.textblockTypeInputRule(/^(#{1,6})\s$/, N.heading, (m) => ({ level: m[1].length })),
    IR.wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list, (m) => ({ markup: m[1] })),
    IR.wrappingInputRule(/^(\d{1,9})([.)])\s$/, N.ordered_list, (m) => ({ start: Number(m[1]), markup: m[2] }),
      (m, node) => node.childCount + node.attrs.start === Number(m[1])),
    IR.wrappingInputRule(/^\s*>\s$/, N.blockquote),
    // "[ ] " at the start of an item makes it a task; in a paragraph it starts a task list
    new IR.InputRule(/^\[([ xX]?)\]\s$/, (state, match, start, end) => {
      if (!startOfTextblock(state, start)) return null;
      const $start = state.doc.resolve(start);
      const task = match[1] || " ";
      const item = itemAt($start);
      const tr = state.tr.delete(start, end);
      if (item && $start.index($start.depth - 1) === 0) return tr.setNodeMarkup(item.pos, null, { ...item.node.attrs, task, box: true });
      const range = tr.doc.resolve(start).blockRange();
      const wrap = range && PM.transform.findWrapping(range, N.bullet_list);
      if (!wrap) return null;
      tr.wrap(range, wrap);
      const made = itemAt(tr.doc.resolve(tr.mapping.map(start)));
      return made ? tr.setNodeMarkup(made.pos, null, { ...made.node.attrs, task }) : tr;
    }),
    markRule(/(?:^|[^*])(\*\*([^*\s](?:[^*]*[^*\s])?)\*\*)$/, M.strong, { markup: "**" }),
    markRule(/(?:^|[^\p{L}\p{N}_])(__([^_\s](?:[^_]*[^_\s])?)__)$/u, M.strong, { markup: "__" }),
    markRule(/(?:^|[^*])(\*([^*\s](?:[^*]*[^*\s])?)\*)$/, M.em, { markup: "*" }),
    markRule(/(?:^|[^\p{L}\p{N}_])(_([^_\s](?:[^_]*[^_\s])?)_)$/u, M.em, { markup: "_" }),
    markRule(/(~~([^~\s](?:[^~]*[^~\s])?)~~)$/, M.s),
    markRule(/(==([^=\s](?:[^=]*[^=\s])?)==)$/, M.mark),
    markRule(/(`([^`]+)`)$/, M.code),
    markRule(/(\[([^\]\[]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\))$/, M.link, (m) => ({ href: m[3], title: m[4] || null, cls: isExternal(m[3]) ? "external" : null })),
    markRule(/(<(https?:\/\/[^\s<>]+)>)$/, M.link, (m) => ({ href: m[2], markup: "autolink", cls: "external" })),
    // a bare address, once the space after it is typed
    new IR.InputRule(/(?:^|\s)(https?:\/\/[^\s<>]+)\s$/, (state, match, start, end) => {
      const from = start + match[0].indexOf(match[1]), to = from + match[1].length;
      if (state.doc.rangeHasMark(from, to, M.link) || state.doc.rangeHasMark(from, to, M.code)) return null;
      return state.tr.addMark(from, to, M.link.create({ href: match[1], markup: "linkify", cls: "external" })).insertText(" ", end);
    }),
    // a tag, once the space after it is typed
    new IR.InputRule(/(?:^|[\s(])(#[\p{L}\p{N}_\-/]+)\s$/u, (state, match, start, end) => {
      if (/^#[\d/_-]+$/.test(match[1])) return null;
      const from = start + match[0].indexOf(match[1]), to = from + match[1].length;
      if (state.doc.rangeHasMark(from, to, M.code) || state.doc.resolve(from).parent.type === N.heading && from === state.doc.resolve(from).start()) return null;
      return state.tr.addMark(from, to, M.tag.create()).insertText(" ", end);
    }),
    // typographic quotes, when the settings have them: opening after a space or a bracket, closing elsewhere
    new IR.InputRule(/(^|[\s(\[{\u2014\u2013-])?(["'])$/, (state, match, start, end) => {
      if (!(window.MdPrefs || {}).quotes) return null;
      const $s = state.doc.resolve(end);
      if ($s.parent.type.spec.code || M.code.isInSet($s.marks())) return null;
      if (($s.parent.textBetween(0, $s.parentOffset, null, "\ufffc").match(/`/g) || []).length % 2) return null; // code being typed
      const de = (window.MdPrefs || {}).lang === "de", single = match[2] === "'";
      const opening = match[1] !== undefined;
      const q = single ? (opening ? (de ? "\u201a" : "\u2018") : (de ? "\u2018" : "\u2019")) : (opening ? (de ? "\u201e" : "\u201c") : (de ? "\u201c" : "\u201d"));
      // (a ' inside a word is an apostrophe)
      const apostrophe = single && /[\p{L}\p{N}]$/u.test(state.doc.textBetween(Math.max($s.start(), end - 1), end));
      return state.tr.insertText(apostrophe ? "\u2019" : q, start + match[0].length - 1, end); // (the quote typed is not in the document yet)
    }),
    // $$…$$: a formula on its own lines. What stands before and after it in the paragraph stays, above and below.
    new IR.InputRule(/\$\$([^$]*[^$\\\s][^$]*)\$\$$/, (state, match, start, end) => {
      const $start = state.doc.resolve(start), para = $start.parent;
      if (M.code.isInSet($start.marks()) || (para.textBetween(0, $start.parentOffset, null, "\ufffc").match(/`/g) || []).length % 2) return null;
      if (para.type !== N.paragraph) { // a heading, a cell: one line — the formula stays in it
        const raw = "$" + match[1].trim() + "$", html = renderInline(state, raw);
        return /</.test(html) ? state.tr.replaceWith(start, end, N.iatom.create({ kind: "math", raw, html })) : null;
      }
      const raw = "$$" + match[1] + "$$";
      const island = A.islands.blocksOf(raw, storeOf(state)).find((n) => n.type === N.island && n.attrs.kind === "math");
      if (!island) return null;
      const from = $start.before(), to = $start.after(), a = $start.parentOffset, b = a + (end - start);
      const before = para.cut(0, a), after = para.cut(b);
      const trimmed = (node, atEnd) => { // the space that stood next to the dollars
        const t = atEnd ? node.lastChild : node.firstChild;
        if (!t || !t.isText) return node;
        const text = atEnd ? t.text.replace(/\s+$/, "") : t.text.replace(/^\s+/, "");
        return atEnd ? node.cut(0, node.content.size - (t.text.length - text.length)) : node.cut(t.text.length - text.length);
      };
      const head = trimmed(before, true), tail = trimmed(after, false);
      const nodes = [];
      if (head.content.size) nodes.push(head);
      nodes.push(head.content.size ? island : N.island.create({ ...island.attrs, bid: para.attrs.bid }));
      nodes.push(tail.content.size ? N.paragraph.create(null, tail.content) : null);
      const tr = state.tr;
      const last = nodes[nodes.length - 1];
      // the caret goes on below the formula: in what followed it, or in a new line if nothing does
      const following = $start.node(-1).maybeChild($start.indexAfter(-1));
      const below = last || (following && following.isTextblock ? null : N.paragraph.create());
      tr.replaceWith(from, to, nodes.filter(Boolean).concat(below && !last ? [below] : []));
      let at = from;
      for (const n of nodes.slice(0, 2)) if (n) at += n.nodeSize;
      return tr.setSelection(PM.state.Selection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size)), 1));
    }),
    // math: nothing that looks like prices ("$5 and $10")
    atomRule(/(?:^|[^\\$\p{L}\p{N}])(\$[^\s$](?:[^$]*[^\s$\\])?\$)$/u, "math"),
    atomRule(/(\[\[[^\[\]\n]+\]\])$/, "wikilink"),
    // :smile: — whatever the reading view would show as an emoji
    new IR.InputRule(/(:[a-z0-9_+-]+:)$/, (state, match, start, end) => {
      const shown = renderInline(state, match[1]);
      if (shown === match[1] || /[<&]/.test(shown)) return null;
      return state.tr.insertText(shown, start + match[0].indexOf(match[1]), end);
    }),
  ];

  // ------------------------------------------------------------ plugins
  /* Heading ids, as the reading view numbers them (outline, links to sections). */
  const ids = new Plugin({
    key: new PluginKey("ids"),
    state: {
      init: (_c, state) => headingIds(state.doc),
      apply: (tr, old) => (tr.docChanged ? headingIds(tr.doc) : old),
    },
    props: { decorations(state) { return this.getState(state); } },
  });
  function headingIds(doc) {
    const seen = new Map(), decos = [];
    const take = (slug) => {
      const n = seen.get(slug) || 0;
      seen.set(slug, n + 1);
      return n ? slug + "-" + n : slug;
    };
    doc.descendants((node, pos) => {
      if (node.type === N.heading) {
        let text = "";
        node.forEach((n) => { text += n.isText ? n.text : n.type === N.iatom ? atomText(n) : ""; });
        // untouched, it keeps the slug the reading view gives it (which reads the source's line breaks its own way)
        const slug = node.attrs.slug != null && node.textContent === node.attrs.slugOf ? node.attrs.slug : slugify(text) || "section";
        decos.push(Decoration.node(pos, pos + node.nodeSize, { id: take(slug) }));
        return false;
      }
      if (node.type === N.island) { // headings inside count along
        for (const m of node.attrs.html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/g)) take(slugify(m[1].replace(/<[^>]*>/g, "")) || "section");
        return false;
      }
      return !node.isTextblock;
    });
    return DecorationSet.create(doc, decos);
  }
  const atomText = (n) => (n.attrs.kind === "math" ? n.attrs.raw.slice(1, -1)
    : n.attrs.kind === "wikilink" ? n.attrs.raw.slice(2, -2).split("|").pop() : "");

  /* The block being typed in keeps its white space (see active.css); an
   * empty document says what to do. */
  const typing = new Plugin({
    key: new PluginKey("typing"),
    props: {
      decorations(state) {
        const decos = [], { doc, selection } = state;
        if (doc.childCount === 1 && doc.firstChild.type === N.paragraph && doc.firstChild.content.size === 0) {
          decos.push(Decoration.node(0, doc.firstChild.nodeSize, { class: "placeholder", "data-placeholder": window.MdStrings.t("active.placeholder") }));
        }
        const seen = new Set();
        for (const r of selection.ranges) {
          doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos) => {
            if (node.isTextblock && !seen.has(pos)) { seen.add(pos); decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "typing" })); }
            return !node.isTextblock;
          });
        }
        return DecorationSet.create(doc, decos);
      },
    },
  });

  // the ranges the transactions changed, in the last one's document
  function changed(trs) {
    const out = [];
    trs.forEach((t, i) => t.mapping.maps.forEach((map, k) => map.forEach((_a, _b, from, to) => {
      for (let j = k + 1; j < t.mapping.maps.length; j++) { from = t.mapping.maps[j].map(from, -1); to = t.mapping.maps[j].map(to, 1); }
      for (let j = i + 1; j < trs.length; j++) { from = trs[j].mapping.map(from, -1); to = trs[j].mapping.map(to, 1); }
      out.push([from, to]);
    })));
    // setNodeMarkup and marks change no positions: take the selection's surroundings as well
    const last = trs[trs.length - 1];
    if (last.steps.length) out.push([last.selection.from, last.selection.to]);
    for (const t of trs) for (const step of t.steps) {
      const json = step.toJSON();
      if (json.from != null) out.push([Math.min(json.from, t.doc.content.size), Math.min(json.to ?? json.from, t.doc.content.size)]);
      else if (json.pos != null) out.push([Math.min(json.pos, t.doc.content.size), Math.min(json.pos + 1, t.doc.content.size)]);
    }
    return out;
  }

  /* Keeps the document in order after every change:
   * - hidden segments (definitions) and the footnote section are not the
   *   user's to delete by accident: they come back where they were;
   * - a list knows whether it has tasks (the reading view's class);
   * - a bare or <bracketed> address links to what its text says. */
  const order = new Plugin({
    key: new PluginKey("order"),
    appendTransaction(trs, oldState, state) {
      if (!trs.some((t) => t.docChanged)) return null;
      const tr = state.tr;
      // hidden segments
      const have = new Set();
      state.doc.forEach((n) => { if (n.type === N.hidden || (n.type === N.island && n.attrs.virtual)) have.add(n.attrs.bid ?? "virtual"); });
      const lost = [];
      oldState.doc.forEach((n, pos) => {
        if ((n.type === N.hidden || (n.type === N.island && n.attrs.virtual)) && !have.has(n.attrs.bid ?? "virtual")) lost.push([n, pos]);
      });
      if (lost.length && !trs.some((t) => t.getMeta("allowLoss"))) {
        for (const [node, pos] of lost.reverse()) {
          let at = pos;
          for (const t of trs) at = t.mapping.map(at, -1);
          const $at = state.doc.resolve(Math.min(at, state.doc.content.size));
          const where = node.attrs.virtual ? state.doc.content.size : $at.depth ? $at.after(1) : $at.pos;
          tr.insert(tr.mapping.map(where), node);
        }
      }
      // lists and links, where something changed
      const touched = (node, pos) => {
        if (isList(node)) {
          let tasks = false;
          node.forEach((item, offset) => {
            if (item.attrs.task == null) return;
            // "[ ]" needs a paragraph to start; without one the item is no task
            if (item.firstChild.type === N.paragraph || !item.attrs.box) tasks = true;
            else tr.setNodeMarkup(pos + 1 + offset, null, { ...item.attrs, task: null });
          });
          if (tasks !== node.attrs.tasks) tr.setNodeMarkup(pos, null, { ...node.attrs, tasks });
        }
        if (node.isTextblock) {
          // code is text: a picture, a formula or a line break inside it cannot be code
          node.forEach((child, offset) => {
            if (!child.isText && M.code.isInSet(child.marks)) tr.removeMark(pos + 1 + offset, pos + 1 + offset + child.nodeSize, M.code);
          });
          let from = -1, text = "", mark = null;
          const flush = (end) => {
            if (mark) {
              // <a@b.c> links to mailto:a@b.c, any other address to itself
              const href = /^[^\s@:]+@[^\s@]+$/.test(text) ? "mailto:" + text : text;
              // a bare address that is none any more is plain text again, as the reading view would show it
              if (mark.attrs.markup === "linkify" && !A.markdown.plainOk("linkify", text, href)) tr.removeMark(from, end, mark);
              else if (href !== mark.attrs.href && /^\S+$/.test(text)) {
                tr.removeMark(from, end, mark).addMark(from, end, M.link.create({ ...mark.attrs, href, cls: isExternal(href) ? "external" : null }));
              }
            }
            mark = null; text = "";
          };
          node.forEach((child, offset) => {
            const m = child.isText ? child.marks.find((x) => x.type === M.link && (x.attrs.markup === "autolink" || x.attrs.markup === "linkify")) : null;
            const at = pos + 1 + offset;
            if (mark && !(m && m.eq(mark))) flush(at);
            if (m) { if (!mark) { mark = m; from = at; } text += child.text; }
          });
          flush(pos + 1 + node.content.size);
          return false;
        }
        return true;
      };
      const size = tr.doc.content.size;
      for (const [from, to] of changed(trs)) {
        const a = Math.max(0, tr.mapping.map(from, -1) - 1), b = Math.min(size, tr.mapping.map(to, 1) + 1);
        tr.doc.nodesBetween(a, b, touched);
      }
      // neighbouring lists of one kind become one (innermost first, from the end, so positions hold)
      const joins = [];
      for (const [from, to] of changed(trs)) {
        const a = Math.max(0, Math.min(size, tr.mapping.map(from, -1)) - 1), b = Math.min(size, tr.mapping.map(to, 1) + 1);
        tr.doc.nodesBetween(a, b, (node, pos, parent, index) => {
          const next = parent && index + 1 < parent.childCount ? parent.child(index + 1) : null;
          if (next && sameList(node, next)) joins.push(pos + node.nodeSize);
          const prev = parent && index > 0 ? parent.child(index - 1) : null;
          if (prev && sameList(prev, node)) joins.push(pos);
          return !node.isTextblock;
        });
      }
      for (const pos of [...new Set(joins)].sort((x, y) => y - x)) {
        const $pos = tr.doc.resolve(pos);
        if ($pos.nodeBefore && $pos.nodeAfter && sameList($pos.nodeBefore, $pos.nodeAfter)) {
          const a = $pos.nodeBefore, tight = a.attrs.tight && $pos.nodeAfter.attrs.tight;
          if (a.attrs.tight !== tight) tr.setNodeMarkup(pos - a.nodeSize, null, { ...a.attrs, tight });
          tr.join(pos);
        }
      }
      return tr.docChanged ? tr : null;
    },
  });

  /* A click on a task's box ticks it; Ctrl+click on a link follows it (the
   * page's own click handler does that, a plain click only places the caret). */
  /* A task ticked: its check is drawn from left to right. A cover in the box's colour lies over
   * the check and shrinks away to the right (only a transform moves). */
  function drawTick(view, pos) {
    const li = view.nodeDOM(pos), box = li && li.querySelector(":scope > input.task");
    if (!box || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cover = document.createElement("span");
    cover.className = "tick-cover";
    cover.style.left = box.offsetLeft + 3 + "px";
    cover.style.top = box.offsetTop + 3 + "px";
    cover.style.width = box.offsetWidth - 6 + "px";
    cover.style.height = box.offsetHeight - 6 + "px";
    li.appendChild(cover);
    void cover.offsetWidth;
    cover.classList.add("go");
    setTimeout(() => cover.remove(), 400);
  }
  const clicks = new Plugin({
    key: new PluginKey("clicks"),
    props: {
      // a click on an island opens its dialog; on a formula its popover; a picture wants a double click
      handleClickOn(view, pos, node, nodePos, event, direct) {
        if (!direct || event.button !== 0 || event.ctrlKey || event.metaKey || !view.editable) return false;
        if (node.type === N.island && node.attrs.virtual) return A.notes.clicked(view, event);
        if (node.type === N.island || (node.type === N.iatom && node.attrs.kind === "math")) return A.islands.open(view, nodePos);
        return false;
      },
      handleDoubleClickOn(view, pos, node, nodePos, event, direct) {
        if (!direct || !view.editable || ![N.image, N.iatom].includes(node.type)) return false;
        return A.islands.open(view, nodePos);
      },
      handleDOMEvents: {
        mousedown(view, event) {
          if (event.target.matches?.("input.task") && view.editable && event.target.closest(".pm") === view.dom && !event.target.closest(".isl")) {
            event.preventDefault(); // the caret stays where it is
            const li = event.target.closest("li");
            const pos = view.posAtDOM(li, 0);
            const item = itemAt(view.state.doc.resolve(pos + 1)) || itemAt(view.state.doc.resolve(pos));
            if (item && item.node.attrs.task != null) {
              const task = toggledTask(view.state, item.node.attrs.task);
              view.dispatch(view.state.tr.setNodeMarkup(item.pos, null, { ...item.node.attrs, task }));
              if (task !== " ") drawTick(view, item.pos);
            }
            return true;
          }
          return false;
        },
      },
    },
  });

  A.edit = {
    // d: the document ({ store, loaded }) the state is made for
    plugins: (d) => [
      new Plugin({ key: context, state: { init: () => d || null, apply: (_tr, value) => value } }),
      IR.inputRules({ rules: [...rules, A.notes.rule] }),
      keymap(keys),
      keymap(C.baseKeymap),
      H.history({ newGroupDelay: 500 }),
      PM.gapcursor.gapCursor(),
      ids, typing, order, A.notes.plugin, A.clip.plugin, A.context.plugin, A.bar.plugin, A.slash.plugin, A.syntax.plugin, ...A.blocks.plugins(), clicks, A.link.plugin, ...A.tableui.plugins(),
    ],
    keys, storeOf, docOf,
    commands: { setHeading, setParagraph: keepBid(setParagraph), toggleList, toggleTaskList, toggleTask, hardBreak },
    itemAt, ancestor,
  };
})();
