// Columns: blocks side by side, written one under the other between comment
// lines. Read, shown the same in both views, edited in place, written back.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md;
const { EditorState, TextSelection } = PM.state;

export function open(text, needle) {
  const d = A.document.open({ text: text.replace(/\r\n?/g, "\n"), raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: (exact = false) => A.document.serialize(d, v.state.doc, exact),
    caret(n) { let at = -1; v.state.doc.descendants((x, pos) => { if (at < 0 && x.isText && x.text.includes(n)) at = pos + x.text.indexOf(n) + n.length; }); assert.ok(at >= 0, "not in the document: " + n); v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at))); return v; },
    shape() { const out = []; v.state.doc.forEach((n) => out.push(n.type.name === "columns" ? "columns(" + n.content.content.map((c) => c.attrs.width + ":" + c.content.content.map((b) => b.type.name[0] + (b.textContent ? "'" + b.textContent + "'" : "")).join(",")).join(" | ") + ")" : n.type.name)); return out.join(" "); },
  };
  if (needle) v.caret(needle);
  return v;
}
const TWO = "<!-- columns -->\n\nleft\n\n<!-- column -->\n\nright\n\n<!-- /columns -->\n";
const flat = (html) => html.replace(/ data-line="\d+"/g, "").replace(/\n/g, "");

test("the reader: a row of columns, the comment lines gone", () => {
  assert.equal(flat(md.render(TWO)), '<div class="cols"><div class="col" style="flex: 1 1 0"><p>left</p></div><div class="col" style="flex: 1 1 0"><p>right</p></div></div>');
  assert.match(flat(md.render("<!-- columns 2:1 -->\na\n<!-- column -->\nb\n<!-- /columns -->\n")), /style="flex: 2 1 0"><p>a<\/p><\/div><div class="col" style="flex: 1 1 0"><p>b/);
  assert.equal((md.render("<!-- columns -->\na\n<!-- column -->\n\n- x\n- y\n\n<!-- column -->\n# H\n<!-- /columns -->\n").match(/class="col"/g) || []).length, 3);
  // what is no row of columns stays what it was
  for (const src of ["<!-- columns -->\n\na\n\n<!-- /columns -->\n", "<!-- columns -->\n\na\n\n<!-- column -->\n\nb\n", "<!-- column -->\n\na\n", "- x\n\n  <!-- columns -->\n\n  a\n\n  <!-- column -->\n\n  b\n\n  <!-- /columns -->\n"]) assert.equal(md.render(src).includes('class="cols"'), false, src);
  // widths that do not fit the columns: alike
  assert.match(flat(md.render("<!-- columns 2:1:1 -->\na\n<!-- column -->\nb\n<!-- /columns -->\n")), /flex: 1 1 0"><p>a/);
  // a wide table, a callout and a decoration inside
  const inside = md.render("<!-- columns -->\n\n<!-- wide -->\n| a |\n| - |\n\n<!-- column -->\n\n> [!info]\n> x\n\n> [!block]\n> y\n\n<!-- /columns -->\n");
  assert.ok(inside.includes("table-wrap wide") && inside.includes("callout-info") && inside.includes("deco-block") && inside.includes('class="cols"'));
});

test("the active mode: columns with their blocks", () => {
  assert.equal(open(TWO).shape(), "columns(1:p'left' | 1:p'right')");
  assert.equal(open("before\n\n<!-- columns 3:1 -->\n# A\n\ntext\n<!-- column -->\n- x\n<!-- /columns -->\n\nafter\n").shape(), "paragraph columns(3:h'A',p'text' | 1:b'x') paragraph");
  assert.equal(open("<!-- columns -->\n\n<!-- column -->\n\nb\n\n<!-- /columns -->\n").shape(), "columns(1:p | 1:p'b')"); // an empty column: a place to type
});

test("round trip: untouched, as it stands", () => {
  for (const src of [TWO, "before\n\n" + TWO + "\nafter\n", "<!-- columns 2:1 -->\na\n<!-- column -->\nb\n<!-- /columns -->\n", "<!--columns-->\n# A\n\n- x\n- y\n<!--column-->\n| a | b |\n| - | - |\n| c | d |\n<!--/columns-->\n",
    "<!-- columns -->\n\n<!-- column -->\n\nb\n\n<!-- /columns -->\n", "<!-- columns -->\n\na\n\n<!-- /columns -->\n", "<!-- columns -->\r\n\r\na\r\n\r\n<!-- column -->\r\n\r\nb\r\n\r\n<!-- /columns -->\r\n"]) {
    assert.equal(open(src).md(true), src);
  }
});

test("typed into a column, only that text changes", () => {
  let v = open("before\n\n" + TWO + "\nafter\n", "right");
  v.dispatch(v.state.tr.insertText(" side"));
  assert.equal(v.md(), "before\n\n<!-- columns -->\n\nleft\n\n<!-- column -->\n\nright side\n\n<!-- /columns -->\n\nafter\n");
  v = open("<!-- columns 2:1 -->\na\n<!-- column -->\nb\n<!-- /columns -->\n", "b"); // the file's own spelling of the rest stays
  v.dispatch(v.state.tr.insertText("!"));
  assert.equal(v.md(), "<!-- columns 2:1 -->\na\n<!-- column -->\nb!\n<!-- /columns -->\n");
});

const run = (v, command) => command(v.state, (tr) => v.dispatch(tr));
const C = A.columns;

test("a block becomes the first of n columns; the caret stays in it", () => {
  const v = open("one\n\ntwo words\n\nthree\n", "two");
  assert.ok(run(v, C.make(2)));
  assert.equal(v.shape(), "paragraph columns(1:p'two words' | 1:p) paragraph");
  assert.equal(v.state.selection.$from.parent.textContent + "@" + v.state.selection.$from.parentOffset, "two words@3");
  assert.equal(v.md(), "one\n\n<!-- columns -->\n\ntwo words\n\n<!-- column -->\n\n<!-- /columns -->\n\nthree\n");
  run(v, C.make(3));
  assert.equal(v.shape(), "paragraph columns(1:p'two words' | 1:p | 1:p) paragraph");
  assert.equal(run(v, C.make(3)), false); // as many as there are
});

test("fewer columns: what the others held joins the last that stays", () => {
  const v = open("<!-- columns -->\n\na\n\n<!-- column -->\n\nb\n\n<!-- column -->\n\nc\n\n<!-- /columns -->\n", "a");
  run(v, C.make(2));
  assert.equal(v.shape(), "columns(1:p'a' | 1:p'b',p'c')");
  assert.equal(v.md(), "<!-- columns -->\n\na\n\n<!-- column -->\n\nb\n\nc\n\n<!-- /columns -->\n");
});

test("in a column: add, move, remove, alike, unwrap", () => {
  const src = "<!-- columns 2:1 -->\n\nleft\n\n<!-- column -->\n\nright\n\n<!-- /columns -->\n";
  let v = open(src, "right");
  run(v, C.add(-1));
  assert.equal(v.shape(), "columns(2:p'left' | 1.5:p | 1:p'right')");
  assert.equal(C.at(v.state).index, 1); // the caret is in the new one
  v.dispatch(v.state.tr.insertText("mid"));
  run(v, C.move(1));
  assert.equal(v.shape(), "columns(2:p'left' | 1:p'right' | 1.5:p'mid')");
  assert.equal(v.state.selection.$from.parent.textContent, "mid"); // … and goes with its column
  assert.equal(run(v, C.move(1)), false);
  run(v, C.equal);
  assert.equal(v.md(), "<!-- columns -->\n\nleft\n\n<!-- column -->\n\nright\n\n<!-- column -->\n\nmid\n\n<!-- /columns -->\n");
  run(v, C.remove); // what it held joins the column before it
  assert.equal(v.shape(), "columns(1:p'left' | 1:p'right',p'mid')");
  v.caret("left");
  run(v, C.remove); // the first: joins the next — and one column is no row
  assert.equal(v.shape(), "paragraph paragraph paragraph");
  assert.equal(v.md(), "left\n\nright\n\nmid\n");

  v = open(src, "left");
  run(v, C.unwrap);
  assert.equal(v.md(), "left\n\nright\n");
  v = open("<!-- columns -->\n\n<!-- column -->\n\nb\n\n<!-- /columns -->\n", "b"); // a column with nothing in it leaves nothing behind
  run(v, C.unwrap);
  assert.equal(v.md(), "b\n");
});

test("Backspace in a column with nothing in it takes the column away", () => {
  const v = open("x\n\ny\n", "x");
  run(v, C.make(3));
  run(v, C.add(1)); // (the caret is in the new, empty one)
  const key = (k) => A.columns.plugin.props.handleKeyDown(v, { key: k, preventDefault() {} });
  assert.equal(v.shape(), "columns(1:p'x' | 1:p | 1:p | 1:p) paragraph");
  assert.ok(key("Backspace"));
  assert.equal(v.shape(), "columns(1:p'x' | 1:p | 1:p) paragraph");
  v.caret("x");
  assert.equal(key("Backspace"), false); // text in it: the key is the text's
});

test("blocks set beside a block, beside a column; a column emptied by a drag goes", () => {
  let v = open("one\n\ntwo\n\nthree\n", "one");
  const P = (t) => A.schema.nodes.paragraph.create(null, A.schema.text(t));
  let tr = v.state.tr;
  const began = C.beside(tr, 5, 1, PM.model.Fragment.from(P("new"))); // right of "two"
  v.dispatch(tr);
  assert.equal(v.state.doc.resolve(began).nodeAfter.textContent, "new"); // (it says where what was set there begins)
  assert.equal(v.shape(), "paragraph columns(1:p'two' | 1:p'new') paragraph");
  tr = v.state.tr;
  C.beside(tr, 6, -1, PM.model.Fragment.from(P("first"))); // left of its first column
  v.dispatch(tr);
  assert.equal(v.shape(), "paragraph columns(1:p'first' | 1:p'two' | 1:p'new') paragraph");
  // "two" dragged out of its column: delete it, then tidy where it stood
  v.caret("two");
  const c = C.at(v.state);
  tr = v.state.tr.deleteRange(c.colPos + 1, c.colPos + c.col.nodeSize - 1);
  C.tidy(tr, tr.mapping.map(c.colPos + 1));
  v.dispatch(tr);
  assert.equal(v.shape(), "paragraph columns(1:p'first' | 1:p'new') paragraph");
});

test("the / menu: columns for a block, column commands in a column; a block's actions stay in its column", () => {
  let v = open("one\n\ntwo\n", "two");
  const group = () => A.slash.entries(v).find((e) => e && e.key === "slash.columns").items.filter(Boolean);
  assert.equal(group().map((e) => e.key + (e.n || "")).join(), "columns.n2,columns.n3,columns.n4");
  group()[1].act(v);
  assert.equal(v.shape(), "paragraph columns(1:p'two' | 1:p | 1:p)");
  assert.equal(group().map((e) => e.key).join(), "columns.addLeft,columns.addRight,columns.moveLeft,columns.moveRight,columns.equal,columns.unwrap,columns.remove");
  assert.equal(group().filter((e) => e.disabled).map((e) => e.key).join(), "columns.moveLeft,columns.equal");
  A.slash.BLOCK.duplicate(v); // the paragraph, not the row of columns
  assert.equal(v.shape(), "paragraph columns(1:p'two',p'two' | 1:p | 1:p)");
  A.slash.entries(v).find((e) => e && e.key === "slash.callout").items.find((e) => e && e.key === "callout.info").act(v);
  assert.match(v.md(), /<!-- columns -->\n\n> \[!info\]\n> two\n\ntwo\n\n<!-- column -->/);
});
