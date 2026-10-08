// How a table looks: as wide as the text column unless a line before it in the file says
// narrow, and its head row in a colour where that line names one (<!-- table narrow head=… -->;
// <!-- wide -->, the line of before, is still read). Read, shown the same in both views,
// switched from a cell, written back.
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

test("the reader: a table is as wide as the column, the line before it says otherwise, and is gone", () => {
  assert.match(md.render(T), /<div class="table-wrap wide"><table/);
  assert.match(md.render("<!-- wide -->\n" + T), /<div class="table-wrap wide"><table/);
  const narrow = md.render("<!-- table narrow -->\n" + T);
  assert.match(narrow, /<div class="table-wrap"><table/);
  assert.equal(narrow.includes("<!--"), false);
  // its head row's colour: one of the theme's, or any written as #rrggbb (its text dark or light, whichever is read on it)
  assert.match(md.render("<!-- table head=blue -->\n" + T), /<div class="table-wrap wide" style="--th: color-mix\(in srgb, var\(--c-blue\) 24%, var\(--bg\)\);">/);
  assert.match(md.render("<!-- table narrow head=#cfeefc -->\n" + T), /<div class="table-wrap" style="--th: #cfeefc; --th-ink: #1d1d1f;">/);
  assert.match(md.render("<!-- table head=#123 -->\n" + T), /--th: #123; --th-ink: #fff;/);
  // what is no colour is none (nothing of the note's gets into the page's styles)
  assert.equal(md.render("<!-- table head=url(x) -->\n" + T).includes("style="), false);
  assert.equal(md.render('<!-- table head=red;color:red -->\n' + T).includes("style="), false);
  // only right before a table, and only these comments
  assert.match(md.render("<!-- table narrow -->\n\n" + T), /<div class="table-wrap wide">/);
  assert.match(md.render("<!-- note -->\n" + T), /<div class="table-wrap wide">/);
});

test("round trip: untouched, it is written as it stands", () => {
  for (const src of [T, "<!-- wide -->\n" + T, "before\n\n<!-- wide -->\n" + T + "\nafter\n", "<!--wide-->\n|a|b|\n|-|-|\n|c|d|\n", "<!-- wide -->\n\n" + T, "<!-- note -->\n" + T,
    "<!-- table narrow -->\n" + T, "<!--table   head=blue   narrow-->\n" + T, "<!-- table head=#CFEEFC -->\n" + T]) {
    assert.equal(open(src, "c").md(), src);
  }
});

test("switched from a cell; a cell edited keeps the line as it was written", () => {
  const v = open("before\n\n" + T + "\nafter\n", "c");
  assert.equal(v.cell().table.attrs.wide, true);
  A.tableui.wide(v, v.cell());
  assert.equal(v.md(), "before\n\n<!-- table narrow -->\n" + T + "\nafter\n");
  assert.equal(v.state.selection.$from.parent.textContent, "c"); // the caret stays in its cell
  v.dispatch(v.state.tr.insertText("x"));
  assert.equal(v.md(), "before\n\n<!-- table narrow -->\n| a | b |\n| - | - |\n| cx | d |\n\nafter\n");
  A.tableui.wide(v, v.cell());
  assert.equal(v.md(), "before\n\n| a | b |\n| - | - |\n| cx | d |\n\nafter\n");

  // the line of before stays while it still says what is so, and is written anew when it does not
  const loaded = open("<!-- wide -->\n" + T, "c");
  assert.equal(loaded.cell().table.attrs.wide, true);
  loaded.dispatch(loaded.state.tr.insertText("x"));
  assert.equal(loaded.md(), "<!-- wide -->\n| a | b |\n| - | - |\n| cx | d |\n");
  A.tableui.wide(loaded, loaded.cell());
  assert.equal(loaded.md(), "<!-- table narrow -->\n| a | b |\n| - | - |\n| cx | d |\n");
});

test("the head row's colour: set, changed, taken away", () => {
  const v = open(T, "c");
  A.tableui.head(v, v.cell(), "green");
  assert.equal(v.md(), "<!-- table head=green -->\n" + T);
  A.tableui.head(v, v.cell(), "#CFEEFC");
  assert.equal(v.md(), "<!-- table head=#cfeefc -->\n" + T);
  A.tableui.wide(v, v.cell());
  assert.equal(v.md(), "<!-- table narrow head=#cfeefc -->\n" + T);
  A.tableui.head(v, v.cell(), "not a colour");
  assert.equal(v.md(), "<!-- table narrow -->\n" + T);
  const items = A.tableui.headItems(v, v.cell());
  assert.equal(items.filter(Boolean).map((i) => i.label).slice(0, 3).join(), "None,Red,Orange");
  assert.equal(items[0].checked, true);
});

test("the menus offer it, ticked when it is on", () => {
  const v = open(T, "c");
  const view = { ...v, get state() { return v.state; }, posAtCoords: () => null };
  const all = A.context.textItems(view, v.state.selection.from);
  assert.equal(all.find((i) => i && i.label === "Full Width").checked, true);
  assert.ok(all.find((i) => i && i.label === "Header Color").items.length > 5);
  assert.ok(A.slash.entries(v).some((e) => e && e.key === "table.wide"));
});
