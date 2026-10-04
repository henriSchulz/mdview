// A table as wide as the text column: a line <!-- wide --> before it in the
// file. Read, shown the same in both views, switched on and off, written back.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md;
const { EditorState, TextSelection } = PM.state;

function open(text, needle) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
    cell: () => A.tableui.cellAt(v.state.selection.$from),
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
  assert.ok(at >= 0, "not in the document: " + needle);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  return v;
}
const T = "| a | b |\n| - | - |\n| c | d |\n";

test("the reader: the wrap says it, the comment line is gone", () => {
  const html = md.render("<!-- wide -->\n" + T);
  assert.match(html, /<div class="table-wrap wide"><table/);
  assert.equal(html.includes("<!--"), false);
  assert.match(md.render(T), /<div class="table-wrap"><table/);
  // only right before a table, and only this comment
  assert.equal(md.render("<!-- wide -->\n\n" + T).includes("table-wrap wide"), false);
  assert.equal(md.render("<!-- note -->\n" + T).includes("table-wrap wide"), false);
  assert.equal(md.render("<!-- wide -->\n\ntext\n").includes("wide\""), false);
});

test("round trip: untouched, it is written as it stands", () => {
  for (const src of ["<!-- wide -->\n" + T, "before\n\n<!-- wide -->\n" + T + "\nafter\n", "<!--wide-->\n|a|b|\n|-|-|\n|c|d|\n", "<!-- wide -->\n\n" + T, "<!-- note -->\n" + T]) {
    assert.equal(open(src, "c").md(), src);
  }
});

test("switched on and off from a cell; a cell edited keeps it", () => {
  const v = open("before\n\n" + T + "\nafter\n", "c");
  assert.equal(v.cell().table.attrs.wide, false);
  A.tableui.wide(v, v.cell());
  assert.equal(v.md(), "before\n\n<!-- wide -->\n" + T + "\nafter\n");
  assert.equal(v.state.selection.$from.parent.textContent, "c"); // the caret stays in its cell
  v.dispatch(v.state.tr.insertText("x"));
  assert.equal(v.md(), "before\n\n<!-- wide -->\n| a | b |\n| - | - |\n| cx | d |\n\nafter\n");
  A.tableui.wide(v, v.cell());
  assert.equal(v.md(), "before\n\n| a | b |\n| - | - |\n| cx | d |\n\nafter\n");

  const loaded = open("<!-- wide -->\n" + T, "c");
  assert.equal(loaded.cell().table.attrs.wide, true);
  A.tableui.wide(loaded, loaded.cell());
  assert.equal(loaded.md(), T);
});

test("the menus offer it, ticked when it is on", () => {
  const v = open("<!-- wide -->\n" + T, "c");
  const view = { ...v, get state() { return v.state; }, posAtCoords: () => null };
  const item = A.context.textItems(view, v.state.selection.from).find((i) => i && i.label === "Full Width");
  assert.equal(item.checked, true);
  assert.ok(A.slash.entries(v).some((e) => e && e.key === "table.wide"));
});
