// The "/" menu: what it offers where the caret is, and what its block actions
// write into the file.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;

// a document with a caret behind `needle`, and a view as far as the menu's commands need one
function open(text, needle) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
  assert.ok(at >= 0, "not in the document: " + needle);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  return v;
}
const keys = (entries) => entries.map((e) => (e ? e.key : "-")).join(" ");

test("what it offers follows the caret", () => {
  let v = open("one\n\ntwo\n", "one");
  assert.equal(keys(A.slash.entries(v)), "slash.style slash.list menu.format slash.deco slash.color slash.callout slash.columns - menu.codeBlock menu.formula menu.table menu.rule menu.image menu.file menu.graphic menu.footnote menu.page - slash.actions");
  const style = A.slash.entries(v)[0].items;
  assert.equal(style.map((e) => +!!e.checked).join(""), "10000");

  v = open("## Head\n\ntext\n", "Head");
  assert.equal(A.slash.entries(v)[0].items.map((e) => +!!e.checked).join(""), "00100");

  v = open("- [ ] open\n- [x] done\n", "open");
  assert.equal(A.slash.entries(v)[0].key, "slash.check");
  v = open("- [ ] open\n- [x] done\n", "done");
  assert.equal(A.slash.entries(v)[0].key, "slash.uncheck");
  A.slash.entries(v)[0].act(v);
  assert.equal(v.md(), "- [ ] open\n- [ ] done\n");

  v = open("| a | b |\n| - | - |\n| c | d |\n", "c");
  assert.equal(keys(A.slash.entries(v)), "table.row table.column menu.format table.wide - table.delete");
  v.dispatch(v.state.tr.insertText(" /"));
  assert.equal(A.slash.typed(v.state)?.query, ""); // a "/" typed in a cell opens it too
});

test("the first and the last block cannot be moved further", () => {
  const actions = (v) => A.slash.entries(v).at(-1).items;
  let v = open("one\n\ntwo\n\nthree\n", "one");
  assert.deepEqual([actions(v)[1].disabled, actions(v)[2].disabled], [true, false]);
  v = open("one\n\ntwo\n\nthree\n", "three");
  assert.deepEqual([actions(v)[1].disabled, actions(v)[2].disabled], [false, true]);
});

test("block actions and the Markdown they leave", () => {
  let v = open("one\n\ntwo *x*\n\nthree\n", "two");
  A.slash.BLOCK.duplicate(v);
  assert.equal(v.md(), "one\n\ntwo *x*\n\ntwo *x*\n\nthree\n");

  v = open("one\n\ntwo\n\nthree\n", "two");
  A.slash.BLOCK.move(v, -1);
  assert.equal(v.md(), "two\n\none\n\nthree\n");
  assert.equal(v.state.selection.$from.parent.textContent, "two"); // the caret went with it
  A.slash.BLOCK.move(v, 1);
  A.slash.BLOCK.move(v, 1);
  assert.equal(v.md(), "one\n\nthree\n\ntwo\n");
  A.slash.BLOCK.move(v, 1); // at the end: nothing
  assert.equal(v.md(), "one\n\nthree\n\ntwo\n");

  v = open("one\n\ntwo\n\nthree\n", "two");
  A.slash.BLOCK.remove(v);
  assert.equal(v.md(), "one\n\nthree\n");

  v = open("only\n", "only");
  A.slash.BLOCK.remove(v);
  assert.equal(v.state.doc.childCount, 1);
  assert.equal(v.state.doc.firstChild.type.name, "paragraph");
});

test("in a list the block is the item", () => {
  let v = open("- a\n- b\n- c\n", "b");
  A.slash.BLOCK.move(v, -1);
  assert.equal(v.md(), "- b\n- a\n- c\n");
  v = open("- a\n- b\n- c\n", "b");
  A.slash.BLOCK.duplicate(v);
  assert.equal(v.md(), "- a\n- b\n- b\n- c\n");
  v = open("- a\n- b\n- c\n", "b");
  A.slash.BLOCK.remove(v);
  assert.equal(v.md(), "- a\n- c\n");
  v = open("- [ ] a\n- [x] b\n", "b");
  A.slash.BLOCK.duplicate(v);
  assert.equal(v.md(), "- [ ] a\n- [x] b\n- [x] b\n");
});
