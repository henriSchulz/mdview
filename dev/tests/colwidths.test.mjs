// A table's column widths: shares in percent, said by the line before the table
// (<!-- table cols=30,20,50 -->), drawn by both views, written back as they were — and set anew
// when the line between two columns is pulled (active/tableui.js).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, core = w.MdView.core, md = core.md;
const { EditorState } = PM.state;
const TABLE = "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n";

test("the line before a table: its columns' shares, read and written", () => {
  assert.equal(JSON.stringify(core.tableLook("<!-- table cols=30,20,50 -->")), JSON.stringify({ wide: true, head: "", cols: [30, 20, 50] }));
  assert.equal(core.tableLook("<!-- table cols=30,x -->").cols, null);
  assert.equal(core.tableLook("<!-- table cols=50 -->").cols, null); // (one column has nothing to share)
  assert.equal(core.tableMark({ wide: true, head: "", cols: [30, 20, 50] }), "<!-- table cols=30,20,50 -->");
  assert.equal(core.tableMark({ wide: true, head: "blue", cols: [40, 60] }), "<!-- table head=blue cols=40,60 -->");
  assert.equal(core.tableMark({ wide: true, head: "", cols: null }), "");
});

test("the reader: a table of fixed layout, its columns as wide as said", () => {
  const html = md.render("<!-- table cols=30,20,50 -->\n" + TABLE);
  assert.match(html, /<div class="table-wrap wide"><table[^>]*class="has-cols"[^>]*>\n?<colgroup><col style="width:30%"><col style="width:20%"><col style="width:50%"><\/colgroup>/);
  assert.doesNotMatch(md.render(TABLE), /colgroup/);
});

test("the active mode: kept as written; widths set anew are written into the line", () => {
  const text = "Intro\n\n<!-- table cols=30,20,50 -->\n" + TABLE + "\nEnd\n";
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  let state = EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) });
  let tablePos = -1; state.doc.forEach((n, p) => { if (n.type.name === "table") tablePos = p; });
  assert.equal(String(state.doc.nodeAt(tablePos).attrs.cols), "30,20,50");
  assert.equal(A.document.serialize(d, state.doc, false), text);
  const node = state.doc.nodeAt(tablePos);
  state = state.apply(state.tr.setNodeMarkup(tablePos, null, { ...node.attrs, cols: [45, 15, 40] }));
  assert.equal(A.document.serialize(d, state.doc, false), "Intro\n\n<!-- table cols=45,15,40 -->\n" + TABLE + "\nEnd\n");
  // a table without widths gets its line
  const plain = "x\n\n" + TABLE, d2 = A.document.open({ text: plain, raw: plain, links: {}, vault: false });
  let s2 = EditorState.create({ doc: d2.doc, plugins: A.edit.plugins(d2) }), p2 = -1;
  s2.doc.forEach((n, p) => { if (n.type.name === "table") p2 = p; });
  s2 = s2.apply(s2.tr.setNodeMarkup(p2, null, { ...s2.doc.nodeAt(p2).attrs, cols: [50, 25, 25] }));
  assert.equal(A.document.serialize(d2, s2.doc, false), "x\n\n<!-- table cols=50,25,25 -->\n" + TABLE);
});
