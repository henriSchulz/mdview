// Where a paragraph or a heading stands in its line — left, centred, right: a comment at the
// block's end says so, both views show it, the "/" menu sets it, and it is written back as read.
// And a rule's four looks, each in the "/" menu.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md, T = w.MdStrings.t;
const { EditorState, TextSelection } = PM.state;
function open(text, at) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = { state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), editable: true, dispatch(tr) { v.state = v.state.apply(tr); }, focus() {}, hasFocus: () => true, md: () => A.document.serialize(d, v.state.doc, false) };
  v.caret = (word, to = null) => { let from = -1, end = -1; v.state.doc.descendants((n, p) => { if (n.isText && from < 0 && n.text.includes(word)) from = p + n.text.indexOf(word) + 1; if (to && n.isText && n.text.includes(to)) end = p + n.text.indexOf(to) + 1; }); v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, from, to ? end : from))); return v; };
  v.group = (key) => A.slash.entries(v).find((g) => g && g.key === key);
  v.pick = (group, key) => v.group(group).items.find((e) => e.key === key).act(v);
  if (at) v.caret(at);
  return v;
}

test("the reader: the class is the block's, the comment is gone from its text", () => {
  assert.match(md.render("A line <!-- center -->\n"), /^<p[^>]*class="ta-center"[^>]*>A line<\/p>/);
  assert.match(md.render("## A heading <!-- right -->\n"), /<h2[^>]*class="ta-right"[^>]*>A heading<\/h2>/);
  assert.doesNotMatch(md.render("A line\n"), /class="ta-/);
  assert.doesNotMatch(md.render("A line <!-- centre of it -->\n"), /class="ta-/); // (any other comment is a comment)
  assert.doesNotMatch(md.render("<!-- center -->\n"), /class="ta-center"/); // (alone in its line: a comment, and no line)
});

test("set from the / menu: centred, right, left again — written as a comment at the block's end", () => {
  const v = open("one\n\ntwo\n\nthree\n", "two");
  assert.equal(v.group("slash.align").items.map((e) => +!!e.checked).join(""), "100");
  v.pick("slash.align", "align.center");
  assert.equal(v.md(), "one\n\ntwo <!-- center -->\n\nthree\n");
  assert.equal(v.group("slash.align").items.map((e) => +!!e.checked).join(""), "010");
  v.pick("slash.align", "align.right");
  assert.equal(v.md(), "one\n\ntwo <!-- right -->\n\nthree\n");
  v.pick("slash.align", "align.left");
  assert.equal(v.md(), "one\n\ntwo\n\nthree\n");
});

test("a heading, and several blocks at once", () => {
  const h = open("# Title\n\ntext\n", "Title");
  h.pick("slash.align", "align.center");
  assert.equal(h.md(), "# Title <!-- center -->\n\ntext\n");
  const v = open("one\n\ntwo\n\nthree\n");
  v.caret("one", "three");
  v.pick("slash.align", "align.right");
  assert.equal(v.md(), "one <!-- right -->\n\ntwo <!-- right -->\n\nthree <!-- right -->\n");
});

test("read anew: as it was written, and the block knows where it stands", () => {
  const text = "# Title <!-- center -->\n\nA line with **bold** <!-- right -->\n\nplain\n";
  const v = open(text, "bold");
  assert.equal(v.md(), text);
  assert.equal(v.group("slash.align").items.map((e) => +!!e.checked).join(""), "001");
  let aligns = [];
  v.state.doc.forEach((n) => aligns.push(n.attrs.align || ""));
  assert.equal(aligns.join(), "center,right,");
  // typed in: the comment stays at the end
  v.dispatch(v.state.tr.insertText("!", v.state.selection.from));
  assert.match(v.md(), /A line with \*\*b!old\*\* <!-- right -->\n/);
});

test("a rule's four looks in the / menu, each written as its line", () => {
  for (const [key, line] of [["panel.line.thin", "---"], ["panel.line.dots", "***"], ["panel.line.heavy", "___"], ["panel.line.dotted", "- - -"]]) {
    const v = open("one\n\ntwo\n", "one");
    assert.equal(v.group("menu.rule").items.length, 4);
    assert.ok(T(key) !== key, key);
    v.pick("menu.rule", key);
    assert.ok(v.md().includes("\n" + line + "\n"), key + ": " + JSON.stringify(v.md()));
  }
});
