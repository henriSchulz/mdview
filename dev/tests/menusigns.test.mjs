// Every row of every menu has its sign (Henri, 2026-11-10, on the right click over text: „warum fehlen hier überall icons?“ —
// „ja, überall icons rein“). The menu of a right click over text had none at all, beside the menu of selected blocks that
// has them for the same entries. A row names its sign by the key of its name (active/menu.js: signOf, viewer/base.js: SIGN).
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPage, ACTIVE, ROOT } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, N = A.schema.nodes;
const { EditorState, TextSelection } = PM.state;
after(() => w.close());

function open(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true, dom: w.document.createElement("div"),
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true, nodeDOM: () => null, coordsAtPos: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  };
  return v;
}
const at = (v, needle) => { let pos = -1; v.state.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text.includes(needle)) pos = p + n.text.indexOf(needle) + 1; }); assert.ok(pos >= 0, needle); v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pos))); return pos; };
const nodeOf = (v, test) => { let out = null; v.state.doc.descendants((n, p) => { if (!out && test(n)) out = { pos: p, node: n }; }); assert.ok(out, "no such node"); return out; };
// the rows without a sign, in this menu and the menus beside it ("Format › Bold")
function bare(items, where = "") {
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const name = where + item.label;
    if (!A.menu.signOf(item)) out.push(name);
    if (item.items) out.push(...bare(item.items, name + " › "));
  }
  return out;
}

test("the right click over text: every row has its sign, and so has every row of the menus beside it", () => {
  const v = open("A paragraph with a [link](https://example.org) in it.\n\n| a | b |\n|---|---|\n| one | two |\n\n[file.pdf](file.pdf)\n");
  const rows = (needle) => { const pos = at(v, needle); return A.context.textItems(v, pos); };
  const text = rows("paragraph");
  assert.ok(text.length > 8 && text.some((i) => i && i.items), "the menu, with menus beside it");
  assert.deepEqual(bare(text), [], "in text");
  assert.deepEqual(bare(rows("link")), [], "on a link");
  assert.deepEqual(bare(rows("one")), [], "in a table's cell");
  assert.deepEqual(bare(rows("file")), [], "in a file's block");
});

test("the menu of a thing in the note (a formula, code, a picture, a page's line, a link to a note): every row has its sign", () => {
  const v = open("$$\nx^2\n$$\n\n```js\nlet a = 1;\n```\n\n![a picture](pic.png)\n\nSee [[Other note]] here.\n");
  const things = [
    nodeOf(v, (n) => n.type === N.island && /\$\$/.test(n.attrs.raw || "")),
    nodeOf(v, (n) => n.type === N.island && /```js/.test(n.attrs.raw || "")),
    nodeOf(v, (n) => (n.type === N.image) || (n.type === N.island && /pic\.png/.test(n.attrs.raw || ""))),
    nodeOf(v, (n) => n.type === N.iatom && n.attrs.kind === "wikilink"),
  ];
  for (const { pos, node } of things) assert.deepEqual(bare(A.context.nodeItems(v, pos, node)), [], node.type.name + " " + (node.attrs.raw || node.attrs.src || ""));
});

test("a table's own menus (its …, a row's, a column's): every row has its sign", () => {
  const v = open("| a | b |\n|---|---|\n| one | two |\n\nTable: a caption\n");
  at(v, "one");
  const cell = A.tableui.cellAt(v.state.selection.$from);
  for (const items of [A.tableui.tableItems(v, cell), A.tableui.rowItems(v, cell), A.tableui.colItems(v, cell)]) assert.deepEqual(bare(items), []);
});

test("drawn: a menu whose rows have their signs has a sign in each of its rows, none an empty box", () => {
  const v = open("Some text.\n");
  A.menu.open({ x: 10, y: 10, items: A.context.textItems(v, at(v, "text")) });
  const rows = [...A.menu.el.querySelectorAll(".menu-item")];
  assert.ok(rows.length > 8);
  assert.deepEqual(rows.filter((b) => !b.querySelector(".menu-icon")?.innerHTML).map((b) => b.textContent), []);
  A.menu.close();
});

test("the menu of a right click on the page's own text (the reading view, a field): every row has its sign", async () => {
  const p = await loadPage([], (win) => { win.MdPrefs = { lang: "en" }; win.MdHost = { post() {} }; });
  p.MdView.render({ name: "Note.md", path: "/n/Note.md", base: "/n/", text: "# One\n\ntext [a link](https://example.org)\n", links: {} });
  const rows = () => [...p.document.querySelectorAll("#textmenu .menu-item")];
  for (const el of [p.document.querySelector("#content p"), p.document.querySelector("#content a"), p.document.body]) {
    el.dispatchEvent(new p.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
    assert.ok(rows().length >= 2, el.tagName);
    assert.deepEqual(rows().filter((b) => !b.querySelector(".menu-icon")?.innerHTML).map((b) => b.textContent), [], el.tagName);
  }
  p.close();
});

test("a whiteboard's right click and the formatting bar's styles: every name they give has its sign", () => {
  // (the rows are made where the board is open; their names are what is looked up)
  const src = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
  const board = [...src("board/select.js").matchAll(/\brow\("([\w.]+)"/g), ...src("board.js").split("const pageRows = ")[1].split("\n\n")[0].matchAll(/T\("([\w.]+)"\)/g)].map((m) => m[1]);
  assert.ok(board.length > 10, board.join(", "));
  assert.deepEqual(board.filter((k) => !w.MdView.core.sign(k)), []);
  const bar = [...src("active/bar.js").matchAll(/\bentry\("\w+", "([\w.]+)"/g)].map((m) => m[1]);
  assert.ok(bar.length >= 8, bar.join(", "));
  assert.deepEqual(bar.filter((k) => !A.menu.signOf({ id: k })), []);
});
