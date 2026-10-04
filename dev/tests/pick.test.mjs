// Blocks picked one by one (Ctrl+click): the selection they make, and what the
// keyboard and the clipboard do with them.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState } = PM.state;

function open(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
    pos(text) { let f = -1; v.state.doc.descendants((n, p) => { if (f < 0 && n.isTextblock && n.textContent === text) f = p; }); assert.ok(f >= 0, "no block " + text); return f; },
    item(text) { const $ = v.state.doc.resolve(v.pos(text)); return $.before($.depth); },
    click(text) { return A.blocks.toggle(v, v.pos(text)); },
    picked: () => A.blocks.picked(v.state).map((x) => x.node.textContent).join("|"),
    key(key, mods = {}) { return A.blocks.selPlugin.props.handleKeyDown(v, { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...mods }); },
  };
  return v;
}
const DOC = "one\n\ntwo\n\nthree\n\nfour\n\nfive\n";

test("Ctrl+click: blocks join, and leave again", () => {
  const v = open(DOC);
  v.click("two");
  assert.equal(v.picked(), "two");
  v.click("four");
  assert.equal(v.picked(), "two|four");
  v.click("five"); // beside "four": still picked one by one, in the document's order
  assert.equal(v.picked(), "two|four|five");
  v.click("two");
  assert.equal(v.picked(), "four|five");
  assert.equal(A.blocks.selection(v.state).a + ".." + A.blocks.selection(v.state).b, "3..4"); // standing together: a range like any other
  v.click("four"); v.click("five");
  assert.equal(A.blocks.selection(v.state), null); // the last one left: nothing selected
});

test("deleted, duplicated, brought together", () => {
  let v = open(DOC);
  v.click("one"); v.click("three"); v.click("five");
  v.key("Backspace");
  assert.equal(v.md(), "two\n\nfour\n");

  v = open(DOC);
  v.click("one"); v.click("three");
  v.key("d", { ctrlKey: true }); // once more, below the last of them
  assert.equal(v.md(), "one\n\ntwo\n\nthree\n\none\n\nthree\n\nfour\n\nfive\n");
  assert.equal(v.picked(), "one|three"); // the copies are what is selected now
  assert.equal(A.blocks.picked(v.state)[0].pos > v.pos("two"), true);

  v = open(DOC);
  v.click("two"); v.click("four"); v.click("five");
  v.key("ArrowUp", { altKey: true }); // moved: first they come together where the first stands
  assert.equal(v.md(), "one\n\ntwo\n\nfour\n\nfive\n\nthree\n");
  assert.equal(v.picked(), "two|four|five");
  v.key("ArrowUp", { altKey: true }); // … then they move as a range
  assert.equal(v.md(), "two\n\nfour\n\nfive\n\none\n\nthree\n");
});

test("the arrows go on from the block picked last", () => {
  const v = open(DOC);
  v.click("one"); v.click("four");
  v.key("ArrowDown");
  assert.equal(v.picked(), "five");
});

test("copied and cut: each of them, one after the other", () => {
  const v = open(DOC);
  v.click("one"); v.click("three");
  const data = {}, e = { clipboardData: { setData: (k, x) => { data[k] = x; } }, preventDefault() {} };
  A.blocks.selPlugin.props.handleDOMEvents.cut(v, e);
  assert.equal(data["text/plain"].trim(), "one\n\nthree");
  assert.equal(v.md(), "two\n\nfour\n\nfive\n");
});

test("not a block and one inside it; not list items among other blocks", () => {
  const v = open("para\n\n- a\n- b\n\n<!-- columns -->\n\nleft\n\n<!-- column -->\n\nright\n\n<!-- /columns -->\n");
  v.click("left"); v.click("right");
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.type.name).join(), "columns"); // all a row holds: the row
  A.blocks.toggle(v, v.item("a")); // a list item: what was picked is let go
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.type.name).join(), "list_item");
  A.blocks.toggle(v, v.item("b"));
  assert.equal(A.blocks.picked(v.state).length, 2);
  v.click("para"); // … and a paragraph begins anew as well
  assert.equal(v.picked(), "para");
  A.blocks.toggle(v, 0 + v.state.doc.child(0).nodeSize + v.state.doc.child(1).nodeSize); // the row of columns
  v.click("left"); // a block of it: the row itself is let go
  assert.equal(v.picked(), "para|left");
});

test("every block of every column of a row picked: the row itself", () => {
  const v = open("para\n\n<!-- columns -->\n\nleft\n\nmore\n\n<!-- column -->\n\nright\n\n<!-- /columns -->\n\nend\n");
  v.click("left"); v.click("more");
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.type.name).join(), "paragraph,paragraph"); // one column: its blocks
  v.click("right");
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.type.name).join(), "columns");
  v.key("ArrowUp", { altKey: true }); // moved, it stays a row
  assert.equal(v.md(), "<!-- columns -->\n\nleft\n\nmore\n\n<!-- column -->\n\nright\n\n<!-- /columns -->\n\npara\n\nend\n");
  v.click("para"); // together with another block
  assert.equal(A.blocks.picked(v.state).map((x) => x.node.type.name).join(), "columns,paragraph");
});
