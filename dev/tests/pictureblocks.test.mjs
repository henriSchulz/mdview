// A picture is a block of its own (Henri, 2026-10-14): one that an edit puts into a paragraph with text or with another
// picture is split off into its own — the text before and after it in theirs, the line breaks at the cut gone. A note
// written so elsewhere is left as it is until it is edited there; a table's cell keeps its picture in its text.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, N = A.schema.nodes;
const { EditorState, TextSelection } = PM.state;
Object.defineProperty(A.view, "store", { configurable: true, get: () => ({ env: { links: {} }, vault: false }) });
function open(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = { state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), dispatch(tr) { v.state = v.state.apply(tr); }, md: () => A.document.serialize(d, v.state.doc, false) };
  return v;
}
const at = (v, text) => { let pos = null; v.state.doc.descendants((n, p) => { if (pos == null && n.isText && n.text.includes(text)) pos = p + n.text.indexOf(text); }); return pos; };
const pic = (src) => N.image.create({ src, alt: "" });

test("a picture put in the middle of a line: the line before, the picture, the line after — each a block", () => {
  const v = open("# T\n\nbefore after\n\nEnd.\n");
  const p = at(v, " after");
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, p)).replaceSelectionWith(pic("a.png")));
  assert.equal(v.md(), "# T\n\nbefore\n\n![](a.png)\n\nafter\n\nEnd.\n");
  // the caret: after the picture, at the start of what followed it
  assert.equal(v.state.selection.$from.parent.textContent, "after");
});

test("at a line's end, or its start: the picture under it, or above it", () => {
  let v = open("text\n");
  v.dispatch(v.state.tr.insert(at(v, "text") + 4, pic("b.png")));
  assert.equal(v.md(), "text\n\n![](b.png)\n");
  v = open("text\n");
  v.dispatch(v.state.tr.insert(at(v, "text"), pic("c.png")));
  assert.equal(v.md(), "![](c.png)\n\ntext\n");
});

test("two pictures pasted into one line: two blocks; line breaks at the cut go", () => {
  const v = open("one\n");
  const p = at(v, "one") + 3;
  v.dispatch(v.state.tr.insert(p, PM.model.Fragment.from([w.MdActive.schema.nodes.hard_break.create(), pic("a.png"), w.MdActive.schema.text(" "), pic("b.png")])));
  assert.equal(v.md(), "one\n\n![](a.png)\n\n![](b.png)\n");
});

test("text written where a picture was put stays in its line; in a list item the picture stays in the item", () => {
  let v = open("text\n");
  v.dispatch(v.state.tr.insert(at(v, "text") + 4, pic("a.png")));
  v.dispatch(v.state.tr.insert(at(v, "text") + 4, w.MdActive.schema.text("x")));
  assert.equal(v.md(), "textx\n\n![](a.png)\n");
  v = open("- item\n");
  v.dispatch(v.state.tr.insert(at(v, "item") + 4, pic("a.png")));
  assert.match(v.md(), /^- item\n\n  !\[\]\(a\.png\)\n$/);
});

test("left alone: a note written so, until edited there; a picture in a table's cell", () => {
  const v = open("before ![](a.png) after\n\nOther.\n");
  v.dispatch(v.state.tr.insertText("!", at(v, "Other.") + 6));
  assert.equal(v.md(), "before ![](a.png) after\n\nOther.!\n");
  const t = open("| a | b |\n|---|---|\n| x | y |\n");
  t.dispatch(t.state.tr.insert(at(t, "x") + 1, pic("a.png")));
  assert.match(t.md(), /\| x!\[\]\(a\.png\) \| y \|/);
});
