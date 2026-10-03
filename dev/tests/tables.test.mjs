// Tables: a cell is edited in place and the table keeps the way it was
// written; rows and columns are inserted, moved, deleted and aligned.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;
const K = A.edit.keys, TU = A.tableui;

function doc(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  let state = EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) });
  const api = {
    get state() { return state; },
    md: () => A.document.serialize(d, state.doc, false),
    at(needle, after = true) {
      let found = -1;
      state.doc.descendants((n, pos) => { if (found < 0 && n.isText && n.text.includes(needle)) found = pos + n.text.indexOf(needle) + (after ? needle.length : 0); });
      assert.ok(found >= 0, "not in the document: " + needle);
      return found;
    },
    caretAfter(needle) { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, api.at(needle)))); return api; },
    run(command) { return command(state, (tr) => { state = state.apply(tr); }); },
    press(key) { return api.run(K[key]); },
    type(str) { state = state.apply(state.tr.insertText(str)); return api; },
    cell() { return TU.cellAt(state.selection.$from); },
    op(make) { const c = api.cell(); state = state.apply(TU.changed(state, c.tablePos, make(c)).tr); return api; },
    undo() { return api.run(PM.history.undo); },
  };
  return api;
}
const is = (e, expected) => assert.equal(e.md(), expected);

const PADDED = "| Name  | Qty |\n|-------|----:|\n| apple |   3 |\n| pear  |  12 |\n";
const COMPACT = "|a|b|\n|-|-|\n|1|2|\n";
const BARE = "a | b\n--- | ---\n1 | 2\n";

test("a cell edited in place: the table keeps its style", () => {
  let e = doc(PADDED).caretAfter("pear");
  e.type("s");
  is(e, "| Name  | Qty |\n|-------|----:|\n| apple |   3 |\n| pears |  12 |\n", "fits its column: only its line changes — and numbers stay right-aligned as written");

  e = doc(PADDED).caretAfter("apple");
  e.type(" pie");
  is(e, "| Name      | Qty |\n|-----------|----:|\n| apple pie | 3   |\n| pear      | 12  |\n".replace("| 3   |", "|   3 |").replace("| 12  |", "|  12 |"), "outgrows its column: the column is padded again, the other cells stay");

  e = doc(COMPACT).caretAfter("2");
  e.type("0");
  is(e, "|a|b|\n|-|-|\n|1|20|\n", "compact stays compact");

  e = doc(BARE).caretAfter("2");
  e.type("0");
  is(e, "a | b\n--- | ---\n1 | 20\n", "no pipes at the ends: none added");

  e = doc(COMPACT).caretAfter("1");
  e.type(" | x");
  is(e, "|a|b|\n|-|-|\n|1 \\| x|2|\n", "a pipe in a cell is escaped");

  e = doc("| a | b |\n|---|---|\n| **x** | `c` |\n").caretAfter("x");
  e.type("y");
  is(e, "| a | b |\n|---|---|\n| **xy** | `c` |\n", "marks in a cell");
});

test("keys in a cell", () => {
  let e = doc(COMPACT).caretAfter("a");
  e.press("Tab");
  assert.deepEqual([e.cell().r, e.cell().c], [0, 1]);
  assert.equal(e.state.doc.textBetween(e.state.selection.from, e.state.selection.to), "b", "Tab selects the next cell's content");
  e.press("Tab"); e.press("Tab");
  assert.deepEqual([e.cell().r, e.cell().c], [1, 1]);
  e.press("Shift-Tab");
  assert.deepEqual([e.cell().r, e.cell().c], [1, 0]);
  e.press("Tab"); e.press("Tab");
  assert.deepEqual([e.cell().r, e.cell().c], [2, 0], "Tab behind the last cell: a new row");
  e.type("3");
  is(e, "|a|b|\n|-|-|\n|1|2|\n|3||\n");

  e = doc(COMPACT).caretAfter("b");
  e.press("Enter");
  assert.deepEqual([e.cell().r, e.cell().c], [1, 1], "Enter: the cell below");
  e.press("Enter");
  assert.deepEqual([e.cell().r, e.cell().c], [2, 1], "… in the last row a new one");
  is(e, "|a|b|\n|-|-|\n|1|2|\n|||\n");
  e.undo();
  is(e, COMPACT, "one undo step");

  e = doc(COMPACT).caretAfter("1");
  e.press("Shift-Enter");
  is(e, COMPACT, "no line break in a cell");
});

test("rows and columns", () => {
  const O = TU.ops;
  let e = doc(PADDED).caretAfter("apple");
  e.op((c) => O.rowBelow(c.r));
  e.type("fig");
  is(e, "| Name  | Qty |\n|-------|----:|\n| apple |   3 |\n| fig   |     |\n| pear  |  12 |\n");
  e.op((c) => O.rowMove(c.r, 1));
  is(e, "| Name  | Qty |\n|-------|----:|\n| apple |   3 |\n| pear  |  12 |\n| fig   |     |\n", "moved rows keep their lines");
  e.op((c) => O.rowDelete(c.r));
  is(e, PADDED);

  e = doc(PADDED).caretAfter("Name");
  e.op((c) => O.colRight(c.c));
  e.type("Unit");
  is(e, "| Name  | Unit | Qty |\n|-------|------|----:|\n| apple |      |   3 |\n| pear  |      |  12 |\n", "a new column; the right-aligned one keeps its marker and its cells");
  e.op((c) => O.colMove(c.c, 1));
  is(e, "| Name  | Qty | Unit |\n|-------|----:|------|\n| apple |   3 |      |\n| pear  |  12 |      |\n");
  e.op((c) => O.align(c.c, "center"));
  is(e, "| Name  | Qty | Unit |\n|-------|----:|:----:|\n| apple |   3 |      |\n| pear  |  12 |      |\n");
  e.op((c) => O.align(c.c, "center"));
  e.op((c) => O.colDelete(c.c));
  is(e, PADDED, "aligned twice is not aligned; column deleted: the table as it was");

  e = doc(COMPACT + "\ntext\n").caretAfter("a");
  e.op((c) => O.colDelete(c.c));
  is(e, "|b|\n|-|\n|2|\n\ntext\n");
  e.op(() => O.remove());
  is(e, "text\n", "the table deleted");
});

test("| a | b | and Enter make a table", () => {
  let e = doc("| Name | Qty |\n").caretAfter("Qty |");
  assert.ok(e.press("Enter"));
  assert.deepEqual([e.cell().r, e.cell().c], [1, 0], "the caret is in the first cell below the header");
  e.type("x");
  is(e, "| Name | Qty |\n| ---- | --- |\n| x    |     |\n");

  e = doc("a | b\n").caretAfter("b");
  e.press("Enter");
  assert.equal(e.state.doc.child(0).type.name, "paragraph", "not without pipes at both ends");
});

test("a cell with a <br> in it: the table is edited in its cells, the <br> stays", () => {
  const text = "| a | b |\n|---|---|\n| one<br>two | x |\n";
  const e = doc(text);
  assert.equal(e.state.doc.child(0).type.name, "table", "a table, not an island");
  assert.equal(e.md(), text);
  e.caretAfter("x");
  e.type("y");
  assert.equal(e.md(), "| a | b |\n|---|---|\n| one<br>two | xy |\n");
  e.caretAfter("two");
  e.type("!");
  assert.equal(e.md(), "| a | b |\n|---|---|\n| one<br>two! | xy |\n");
});
