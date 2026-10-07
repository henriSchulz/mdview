// Blocks by the keyboard: Esc takes the block the caret is in, then Space,
// Ctrl+D and Alt+Shift+arrows work on it — and what that writes into the file.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;

function open(text, needle) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
    // a key, as the editor gets it: the blocks' own handling first, then the key map
    key(key, mods = {}) {
      const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...mods };
      if (A.blocks.gapPlugin.props.handleKeyDown(v, e) || A.blocks.selPlugin.props.handleKeyDown(v, e)) return true;
      const name = (mods.ctrlKey ? "Mod-" : "") + (key === " " ? "Space" : key);
      return A.edit.keys[name] ? A.edit.keys[name](v.state, (tr) => v.dispatch(tr), v) : false;
    },
    blocks: () => A.blocks.selection(v.state),
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
  assert.ok(at >= 0, "not in the document: " + needle);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  return v;
}
const type = (v, text) => v.dispatch(v.state.tr.insertText(text));

test("Esc takes the block, Esc again gives the caret back where it was", () => {
  const v = open("one\n\ntwo words\n\nthree\n", "two");
  const caret = v.state.selection.from;
  assert.ok(v.key("Escape"));
  assert.equal(v.state.doc.nodeAt(v.blocks().from).textContent, "two words");
  assert.ok(v.key("Escape"));
  assert.equal(v.blocks(), null);
  assert.equal(v.state.selection.from, caret);
  // moved to another block in between: the caret goes to that block's end
  v.key("Escape"); v.key("ArrowDown"); v.key("Enter");
  assert.equal(v.state.selection.$from.parent.textContent, "three");
  assert.equal(v.state.selection.$from.parentOffset, 5);
});

test("in a list the block is the item, in a table the table", () => {
  let v = open("- a\n- b\n", "b");
  v.key("Escape");
  assert.equal(v.state.doc.nodeAt(v.blocks().from).type.name, "list_item");
  v = open("| a | b |\n| - | - |\n| c | d |\n", "c");
  v.key("Escape");
  assert.equal(v.state.doc.nodeAt(v.blocks().from).type.name, "table");
});

test("Space: an empty block below, Shift+Space above, the caret in it", () => {
  let v = open("one\n\ntwo\n", "one");
  v.key("Escape"); v.key(" ");
  assert.equal(v.blocks(), null);
  type(v, "new");
  assert.equal(v.md(), "one\n\nnew\n\ntwo\n");
  v = open("one\n\ntwo\n", "two");
  v.key("Escape"); v.key(" ", { shiftKey: true });
  type(v, "new");
  assert.equal(v.md(), "one\n\nnew\n\ntwo\n");
  v = open("- [x] a\n- [ ] b\n", "a");
  v.key("Escape"); v.key(" ");
  type(v, "new");
  assert.equal(v.md(), "- [x] a\n- [ ] new\n- [ ] b\n");
});

test("Ctrl+D: once more, below — on blocks and in the text", () => {
  let v = open("one\n\ntwo\n\nthree\n", "one");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  v.key("d", { ctrlKey: true });
  assert.equal(v.md(), "one\n\ntwo\n\none\n\ntwo\n\nthree\n");
  const r = v.blocks();
  assert.equal(v.state.doc.textBetween(r.from, r.to, "|"), "one|two"); // the copies are what is selected now
  v = open("one\n\ntwo\n", "one");
  v.key("d", { ctrlKey: true });
  assert.equal(v.md(), "one\n\none\n\ntwo\n");
});

test("Alt+Shift+arrows: to the top, to the end", () => {
  const v = open("one\n\ntwo\n\nthree\n\nfour\n", "three");
  v.key("Escape");
  v.key("ArrowUp", { altKey: true, shiftKey: true });
  assert.equal(v.md(), "three\n\none\n\ntwo\n\nfour\n");
  v.key("ArrowDown", { altKey: true, shiftKey: true });
  assert.equal(v.md(), "one\n\ntwo\n\nfour\n\nthree\n");
  v.key("ArrowDown", { altKey: true, shiftKey: true }); // already there
  assert.equal(v.md(), "one\n\ntwo\n\nfour\n\nthree\n");
  v.key("ArrowUp", { altKey: true });
  assert.equal(v.md(), "one\n\ntwo\n\nthree\n\nfour\n");
});

test("Tab and Shift+Tab on selected blocks: further in together, and out again", () => {
  // two items of a list: both under the one above
  let v = open("- one\n- two\n- three\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  assert.ok(v.key("Tab"));
  assert.equal(v.md(), "- one\n  - two\n  - three\n");
  // a paragraph and a code block right below a list: into its last item; they stay selected
  v = open("- one\n\nbelow\n\n```\ncode\n```\n\nafter\n", "below");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  v.key("Tab");
  assert.equal(v.md(), "- one\n\n  below\n\n  ```\n  code\n  ```\n\nafter\n");
  assert.equal(v.blocks().b - v.blocks().a, 1);
  // … and out again with Shift+Tab
  v.key("Tab", { shiftKey: true });
  assert.equal(v.md(), "- one\n\nbelow\n\n```\ncode\n```\n\nafter\n");
  // no list above: further in all the same, together, in a quote that only indents — and out again
  v = open("first\n\nsecond\n\nthird\n", "second");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  assert.ok(v.key("Tab"));
  assert.equal(v.md(), "first\n\n> [!indent]\n> second\n>\n> third\n");
  assert.equal(v.blocks().b - v.blocks().a, 1);
  v.key("Tab", { shiftKey: true });
  assert.equal(v.md(), "first\n\nsecond\n\nthird\n");
});

test("the / menu for selected blocks: for all of them at once", () => {
  const menu = (v, q = "") => {
    const was = A.menu.open;
    let items = null;
    A.menu.open = (o) => { items = o.find(q); };
    v.coordsAtPos = () => ({ left: 0, top: 0, bottom: 0 });
    try { assert.ok(v.key("/")); } finally { A.menu.open = was; }
    return items;
  };
  const pick = (v, group, key, n) => {
    const was = A.menu.open;
    let items = null;
    A.menu.open = (o) => { items = o.find(""); };
    v.coordsAtPos = () => ({ left: 0, top: 0, bottom: 0 });
    try { assert.ok(v.key("/")); } finally { A.menu.open = was; }
    const T = w.MdStrings.t;
    const entry = items.find((g) => g && g.label === T(group)).items.find((e) => e.label === T(key, n));
    entry.run();
    return items;
  };
  // blocks that stand together: one list of them
  let v = open("one\n\ntwo\n\nthree\n\nfour\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  const items = pick(v, "slash.list", "menu.bullet");
  // (all the "/" menu has: the groups, what can be put in, what can be done with the blocks)
  for (const k of ["slash.style", "slash.list", "menu.format", "slash.deco", "slash.color", "slash.callout", "slash.columns", "menu.table", "slash.actions"]) assert.ok(items.some((g) => g && g.label === w.MdStrings.t(k)), k);
  assert.equal(v.md(), "one\n\n- two\n- three\n\nfour\n");
  // … one callout around them
  v = open("one\n\ntwo\n\nthree\n", "one");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  pick(v, "slash.callout", "callout.note");
  assert.equal(v.md(), "> [!note]\n> one\n>\n> two\n\nthree\n");
  // a list in a callout stays a list: the whole list, some of its items, one item
  v = open("before\n\n- one\n- two\n\nafter\n", "before");
  v.dispatch(A.blocks.selectTr(v.state, v.state.doc.firstChild.nodeSize)); // (the list as one block: what its handle selects)
  pick(v, "slash.callout", "callout.note");
  assert.equal(v.md(), "before\n\n> [!note]\n> - one\n> - two\n\nafter\n");
  v = open("- one\n- two\n- three\n", "one");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true }); v.key("ArrowDown", { shiftKey: true });
  pick(v, "slash.callout", "callout.tip");
  assert.equal(v.md(), "> [!tip]\n> - one\n> - two\n> - three\n");
  v = open("- one\n- two\n- three\n", "two");
  v.key("Escape");
  pick(v, "slash.deco", "menu.quote");
  assert.equal(v.md(), "- one\n\n> - two\n\n- three\n");
  // … and what is on has its tick, on its group too: chosen again, it goes
  v = open("> [!note]\n> one\n\ntwo\n", "two");
  v.key("Escape"); v.key("ArrowUp"); v.key("ArrowUp");
  {
    const T = w.MdStrings.t, group = menu(v).find((g) => g && g.label === T("slash.callout"));
    assert.equal(group.checked, true);
    assert.equal(group.items.find((e) => e && e.label === T("callout.note")).checked, true);
    assert.equal(menu(v).find((g) => g && g.label === T("slash.style")).checked, false);
    assert.equal(menu(v, "note").find((e) => e.label === T("callout.note")).checked, true);
    group.items.find((e) => e && e.label === T("callout.note")).run();
    assert.equal(v.md(), "one\n\ntwo\n");
  }
  // … each a heading
  v = open("one\n\ntwo\n\nthree\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  pick(v, "slash.style", "menu.heading", 2);
  assert.equal(v.md(), "one\n\n## two\n\n## three\n");
  // searched: one list of what is found, and it does the same
  v = open("one\n\ntwo\n\nthree\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  let found = menu(v, "todo");
  assert.equal(found.map((e) => e.label).join(), w.MdStrings.t("menu.task"));
  assert.equal(menu(v, "zzzz").length, 0);
  found[0].run();
  assert.equal(v.md(), "one\n\n- [ ] two\n- [ ] three\n");
  // bold, for all of them
  v = open("one\n\ntwo\n\nthree\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  pick(v, "menu.format", "menu.bold");
  assert.equal(v.md(), "one\n\n**two**\n\n**three**\n");
  // moved down together, and still selected; a rule put in below the last of them
  v = open("one\n\ntwo\n\nthree\n\nfour\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  pick(v, "slash.actions", "slash.moveDown");
  assert.equal(v.md(), "one\n\nfour\n\ntwo\n\nthree\n");
  assert.equal(v.blocks().b - v.blocks().a, 1);
  menu(v, "").find((e) => e && e.label === w.MdStrings.t("menu.rule")).run();
  assert.match(v.md(), /^one\n\nfour\n\ntwo\n\nthree\n\n(---|\*\*\*|___)\n/);
});

test("the place between two blocks: a stop beside a block one cannot type next to", () => {
  // from a code block down: first the place below it, then the next block
  let v = open("one\n\n```\ncode\n```\n\ntwo\n", "one");
  v.key("Escape"); v.key("ArrowDown"); // (the code block is selected: a stop above it came first)
  assert.equal(v.blocks(), null);
  v.key("ArrowDown");
  assert.equal(v.blocks().a, 1);
  v.key("ArrowDown");
  assert.equal(v.blocks(), null); // between the code and "two"
  v.key("ArrowDown");
  assert.equal(v.blocks().a, 2);
  v.key("ArrowUp"); v.key("Enter"); // back to the place, and a new block there
  type(v, "new");
  assert.equal(v.md(), "one\n\n```\ncode\n```\n\nnew\n\ntwo\n");
  // behind the last block, and Esc back to it
  v = open("one\n\n---\n", "one");
  v.key("Escape"); v.key("ArrowDown"); v.key("ArrowDown");
  assert.equal(v.blocks().a, 1);
  v.key("ArrowDown");
  assert.equal(v.blocks(), null);
  v.key("Escape");
  assert.equal(v.blocks().a, 1);
  v.key("ArrowDown"); v.key(" "); type(v, "end");
  assert.equal(v.md(), "one\n\n---\n\nend\n");
  // between two paragraphs there is no stop
  v = open("one\n\ntwo\n", "one");
  v.key("Escape"); v.key("ArrowDown");
  assert.equal(v.blocks().a, 1);
});

test("what is around blocks follows the blocks that are selected: every kind of block, in and out of a callout", () => {
  const T = w.MdStrings.t;
  const menuOf = (v) => {
    const was = A.menu.open;
    let o = null;
    A.menu.open = (x) => { o = x; };
    v.coordsAtPos = () => ({ left: 0, top: 0, bottom: 0 });
    try { assert.ok(v.key("/")); } finally { A.menu.open = was; }
    return o.find("");
  };
  const entry = (v, group, key) => menuOf(v).find((g) => g && g.label === T(group)).items.find((e) => e && e.label === T(key));
  // the block at the top of the document (a line "top" stands before it), selected as a whole
  const second = (text) => { const v = open("top\n\n" + text, "top"); v.dispatch(A.blocks.selectTr(v.state, v.state.doc.firstChild.nodeSize)); return v; };
  const quoted = (text) => text.trimEnd().split("\n").map((l) => (l ? "> " + l : ">")).join("\n") + "\n";
  const BLOCKS = { paragraph: "text\n", heading: "## head\n", list: "- one\n- two\n", tasks: "- [ ] one\n- [x] two\n", code: "```js\nlet a;\n```\n", table: "| a | b |\n|---|---|\n| 1 | 2 |\n", rule: "***\n", formula: "$$\nx^2\n$$\n", mixed: "text\n\n- one\n\n```\ncode\n```\n" };
  for (const [name, block] of Object.entries(BLOCKS)) {
    if (name === "mixed") continue; // (several blocks: below)
    // a callout around it, as it stands
    let v = second(block);
    entry(v, "slash.callout", "callout.note").run();
    assert.equal(v.md(), "top\n\n> [!note]\n" + quoted(block), name + ": into a callout");
    // … which, selected, has the tick; chosen again the callout alone goes
    v = second("> [!note]\n" + quoted(block));
    assert.equal(entry(v, "slash.callout", "callout.note").checked, true, name + ": the tick");
    assert.equal(entry(v, "slash.callout", "callout.tip").checked, false);
    entry(v, "slash.callout", "callout.note").run();
    assert.equal(v.md(), "top\n\n" + block, name + ": out of the callout, as it was");
    // … another kind changes it, a plain quote goes the same way
    v = second("> [!note]\n" + quoted(block));
    entry(v, "slash.callout", "callout.tip").run();
    assert.equal(v.md(), "top\n\n> [!tip]\n" + quoted(block), name + ": another kind");
    v = second(quoted(block));
    assert.equal(entry(v, "slash.deco", "menu.quote").checked, true);
    entry(v, "slash.deco", "menu.quote").run();
    assert.equal(v.md(), "top\n\n" + block, name + ": out of a quote");
  }
  // several kinds in one callout: all of them come out, each as it was
  let v = second("> [!warning]\n" + quoted(BLOCKS.mixed));
  entry(v, "slash.callout", "callout.warning").run();
  assert.equal(v.md(), "top\n\n" + BLOCKS.mixed);
  // a block inside a callout: it gets one of its own, the one around stays
  for (const [name, block] of Object.entries(BLOCKS)) {
    if (name === "mixed") continue;
    v = open("> [!note]\n> top\n>\n" + quoted(block), "top");
    v.dispatch(A.blocks.selectTr(v.state, 1 + v.state.doc.firstChild.firstChild.nodeSize));
    assert.equal(entry(v, "slash.callout", "callout.note").checked, false, name + ": no tick for the callout around it");
    entry(v, "slash.callout", "callout.tip").run();
    assert.equal(v.md(), "> [!note]\n> top\n>\n> > [!tip]\n" + quoted(quoted(block)).replace(/^> >$/gm, "> >"), name + ": a callout in a callout");
  }
  // a callout in a callout, the inner one selected: it alone goes
  v = open("> [!note]\n> top\n>\n> > [!tip]\n> > inner\n", "top");
  v.dispatch(A.blocks.selectTr(v.state, 1 + v.state.doc.firstChild.firstChild.nodeSize));
  assert.equal(entry(v, "slash.callout", "callout.tip").checked, true);
  entry(v, "slash.callout", "callout.tip").run();
  assert.equal(v.md(), "> [!note]\n> top\n>\n> inner\n");
});

test("the caret's own / menu: a callout around a list is around the list, and it alone goes again", () => {
  const run = (v, command) => command(v.state, (tr) => v.dispatch(tr));
  // the caret in an item: the whole list in the callout
  let v = open("before\n\n- one\n- two\n  - sub\n- three\n\nafter\n", "two");
  run(v, A.context.setCallout("note"));
  assert.equal(v.md(), "before\n\n> [!note]\n> - one\n> - two\n>   - sub\n> - three\n\nafter\n");
  // … in an item further in: the list it is an item of
  v = open("- one\n  - sub\n- two\n", "sub");
  run(v, A.context.setDeco("block"));
  assert.equal(v.md(), "- one\n  > [!block]\n  > - sub\n- two\n");
  // a paragraph: as before
  v = open("one\n\ntwo\n", "one");
  run(v, A.context.setCallout("tip"));
  assert.equal(v.md(), "> [!tip]\n> one\n\ntwo\n");
  // the callout chosen again: it goes, all that is in it stays — wherever in it the caret is
  for (const needle of ["text", "one", "last"]) {
    v = open("> [!note]\n> ## text\n>\n> - [ ] one\n> - [x] two\n>\n> ```js\n> let a;\n> ```\n>\n> last\n\nafter\n", needle);
    run(v, A.context.PARAGRAPH.quote);
    assert.equal(v.md(), "## text\n\n- [ ] one\n- [x] two\n\n```js\nlet a;\n```\n\nlast\n\nafter\n", "caret in: " + needle);
  }
  // a callout in a callout: the inner one alone
  v = open("> [!note]\n> top\n>\n> > [!tip]\n> > inner\n", "inner");
  run(v, A.context.PARAGRAPH.quote);
  assert.equal(v.md(), "> [!note]\n> top\n>\n> inner\n");
});

test("a block dragged out of a callout: the callout stays, also when nothing else was in it", () => {
  const out = (text, to) => {
    const v = open(text, "x");
    let pos = -1;
    v.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === "island") pos = p; });
    const tr = v.state.tr;
    A.blocks.takeOut(tr, { from: pos, to: pos + v.state.doc.nodeAt(pos).nodeSize }, to == null ? 0 : pos + to);
    v.dispatch(tr);
    return v.md();
  };
  assert.match(out("x\n\n> [!note] Title\n> ```\n> code\n> ```\n\nafter\n"), /^x\n\n> \[!note\] Title\n(>\s*\n)?\nafter\n$/);
  assert.equal(out("x\n\n> [!note]\n> text\n>\n> ```\n> code\n> ```\n\nafter\n"), "x\n\n> [!note]\n> text\n\nafter\n");
  assert.match(out("x\n\n> [!note]\n> > [!tip]\n> > ```\n> > code\n> > ```\n\nafter\n"), /^x\n\n> \[!note\]\n> > \[!tip\]\n/);
  // (a list left without items still goes)
  assert.equal(out("x\n\n- ```\n  code\n  ```\n\nafter\n"), "x\n\nafter\n");
});

test("the arrows go from block to block through all of the note: item by item through lists, and out of what a block stands in", () => {
  const here = (v) => { const b = v.blocks(); if (!b) return A.blocks.gap(v.state) ? "(gap)" : "(text)"; const n = v.state.doc.nodeAt(b.from); return n.type.name + ":" + n.textContent.slice(0, 12).replace(/\n/g, " "); };
  const walk = (v, key, n) => { const seen = [here(v)]; for (let i = 0; i < n; i++) { v.key(key); seen.push(here(v)); } return seen.join(" | "); };
  const DOC = "before\n\n- one\n  - sub a\n  - sub b\n- two\n\n> [!note]\n> in the note\n>\n> - quoted item\n\nafter\n";
  // down: into the list at its first item, the items under an item after it, out at its end
  let v = open(DOC, "before");
  v.key("Escape");
  assert.equal(walk(v, "ArrowDown", 8), "paragraph:before | list_item:onesub asub  | list_item:sub a | list_item:sub b | list_item:two | (gap) | blockquote:in the noteq | (gap) | paragraph:after");
  // up: the same way back — into a list at the last item there is in it
  assert.equal(walk(v, "ArrowUp", 8), "paragraph:after | (gap) | blockquote:in the noteq | (gap) | list_item:two | list_item:sub b | list_item:sub a | list_item:onesub asub  | paragraph:before");
  // out of a callout from what is in it, both ways
  v = open(DOC, "quoted item");
  v.key("Escape");
  assert.equal(walk(v, "ArrowDown", 1), "list_item:quoted item | paragraph:after");
  v = open(DOC, "in the note");
  v.key("Escape");
  assert.equal(walk(v, "ArrowUp", 1), "paragraph:in the note | list_item:two");
  v = open(DOC, "in the note");
  v.key("Escape");
  assert.equal(walk(v, "ArrowDown", 2), "paragraph:in the note | list_item:quoted item | paragraph:after");
  // with Shift the blocks on the way are taken: beside one another first, then on outside
  v = open(DOC, "sub a");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  assert.deepEqual([v.blocks().a, v.blocks().b, v.blocks().parent.type.name], [0, 1, "bullet_list"]);
  v.key("ArrowDown", { shiftKey: true });
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.textContent.slice(0, 5)).join("|"), "sub a|sub b|two");
  // a picture clicked on (selected as a thing), then an arrow: on from it as from a selected block
  v = open("- one\n- two\n\n![](p.png)\n\nafter\n", "two");
  let img = -1;
  v.state.doc.descendants((n, p) => { if (img < 0 && n.isAtom && !n.isText && n.type.name !== "hard_break") img = p; });
  v.dispatch(v.state.tr.setSelection(w.PM.state.NodeSelection.create(v.state.doc, img)));
  assert.equal(walk(v, "ArrowUp", 2), "(text) | (gap) | list_item:two");
});

test("Shift and the arrows take more blocks the same way: from a heading into a list item by item, and out of it again", () => {
  const picked = (v) => A.blocks.picked(v.state).map((x) => x.node.type.name + ":" + x.node.textContent.slice(0, 8)).join(" | ");
  const DOC = "## Head\n\n- one\n  - sub\n- two\n\n## Next\n\nlast\n";
  let v = open(DOC, "Head");
  v.key("Escape");
  v.key("ArrowDown", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub"); // (the first item, not the list)
  v.key("ArrowDown", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub | list_item:two"); // (what is under an item is taken with it)
  v.key("ArrowDown", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub | list_item:two | heading:Next"); // (out of the list, on to the heading)
  v.key("ArrowDown", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub | list_item:two | heading:Next | paragraph:last");
  // back again: one less each time
  v.key("ArrowUp", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub | list_item:two | heading:Next");
  v.key("ArrowUp", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub | list_item:two");
  // upwards from below a list: its last item first
  v = open(DOC, "Next");
  v.key("Escape");
  v.key("ArrowUp", { shiftKey: true });
  assert.equal(picked(v), "list_item:two | heading:Next");
  v.key("ArrowUp", { shiftKey: true });
  assert.equal(picked(v), "list_item:sub | list_item:two | heading:Next");
  v.key("ArrowUp", { shiftKey: true });
  assert.equal(picked(v), "list_item:onesub | list_item:two | heading:Next");
  v.key("ArrowUp", { shiftKey: true });
  assert.equal(picked(v), "heading:Head | list_item:onesub | list_item:two | heading:Next");
  // what is taken so is deleted, and copied, as what it is
  v.key("Delete");
  assert.equal(v.md(), "last\n");
  // blocks beside one another are still a range (Tab and the rest go on with them)
  v = open("one\n\ntwo\n\nthree\n", "one");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true }); v.key("ArrowDown", { shiftKey: true });
  assert.deepEqual([v.blocks().a, v.blocks().b, !!A.blocks.state(v.state).more], [0, 2, false]);
  v.key("ArrowUp", { shiftKey: true });
  assert.deepEqual([v.blocks().a, v.blocks().b], [0, 1]);
});

test("items of a list and other blocks, selected together, are moved and copied as what can stand anywhere", () => {
  // a heading and the first item of the list under it, taken up to the top: the item keeps a list around it
  let v = open("first\n\n## Head\n\n1. one\n2. two\n\nlast\n", "Head");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.textContent).join("|"), "Head|one");
  v.key("ArrowUp", { altKey: true }); // (picked one by one: they come together where the first stands — here they are there already)
  assert.equal(v.md(), "first\n\n## Head\n\n1. one\n2. two\n\nlast\n");
  // cut: both go, the rest of the list stays a list
  v = open("first\n\n## Head\n\n1. one\n2. two\n\nlast\n", "Head");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  v.key("Delete");
  assert.equal(v.md(), "first\n\n1. two\n\nlast\n");
  // Shift and a click on another block's handle: all on the way there
  v = open("## Head\n\n- one\n- two\n- three\n\nlast\n", "Head");
  v.key("Escape");
  let two = -1;
  v.state.doc.descendants((n, p) => { if (n.type.name === "list_item" && n.textContent === "two") two = p; });
  A.blocks.select(v, two, true);
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.textContent).join("|"), "Head|one|two");
});
