// A file block's size ("small", "large": written where a link has its title) is the block's in
// both views, and still its size when the note is read again.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md;
const { EditorState, TextSelection } = PM.state;
function open(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = { state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), editable: true, dispatch(tr) { v.state = v.state.apply(tr); }, focus() {}, hasFocus: () => true, md: () => A.document.serialize(d, v.state.doc, false) };
  let pos = -1;
  v.state.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text.includes("report")) pos = p + 2; });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos)));
  v.sizes = () => A.context.textItems({ ...v, get state() { return v.state; } }, v.state.selection.from).find((i) => i && i.items && i.label === "Size").items;
  v.size = () => (v.sizes().find((i) => i.checked) || {}).label;
  return v;
}

test("the reader: the size is the card's class, and no title", () => {
  const html = md.render('[report.zip](report.zip "large")\n');
  assert.match(html, /<p class="file-block file-large"[^>]*><a href="report.zip">report.zip<\/a><\/p>/);
  assert.match(md.render('[report.zip](report.zip "A real title")\n'), /title="A real title"/);
});

test("set from the menu, written, and read again: the size it was given", () => {
  const v = open("before\n\n[report.zip](report.zip)\n\nafter\n");
  assert.equal(v.size(), "Medium");
  v.sizes().find((i) => i.label === "Large").run();
  assert.equal(v.md(), 'before\n\n[report.zip](report.zip "large")\n\nafter\n');
  assert.equal(v.size(), "Large");
  // the note read anew (a reload, another window): Large still, in the menu and as the card is drawn
  const again = open(v.md());
  assert.equal(again.size(), "Large");
  assert.equal(again.md(), v.md());
  again.sizes().find((i) => i.label === "Small").run();
  assert.equal(again.md(), 'before\n\n[report.zip](report.zip "small")\n\nafter\n');
  assert.equal(open(again.md()).size(), "Small");
});
