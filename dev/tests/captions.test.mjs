// A caption: a line that begins with ": " under a picture alone, a code block or a formula block.
// The reader shows the two as one figure; the active mode keeps them as one block, written as it
// was read, and its menu gives a caption or takes it away.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, md = w.MdView.core.md;
const fig = (html) => /^<figure class="fig"[^>]*>\n([\s\S]*)<figcaption>([\s\S]*)<\/figcaption>\n<\/figure>/.exec(html);

test("the reader: a figure, the caption its figcaption, in Markdown of its own", () => {
  let m = fig(md.render("![](tree.png)\n: A tree in *winter*\n"));
  assert.ok(m, "a picture and its caption");
  assert.match(m[1], /<p class="pic-block"[^>]*><img src="tree.png"/);
  assert.equal(m[2], "A tree in <em>winter</em>");
  assert.ok(fig(md.render("![](tree.png)\n\n: A tree\n")), "a blank line between them");
  m = fig(md.render("```js\nconst a = 1;\n```\n: The first line\n"));
  assert.ok(m && /code-block/.test(m[1]) && m[2] === "The first line", "a code block");
  m = fig(md.render("$$\ne=mc^2\n$$\n: Einstein\n"));
  assert.ok(m && /math-block/.test(m[1]) && m[2] === "Einstein", "a formula block");
  m = fig(md.render("![](x.board.svg)\n: A sketch\n"));
  assert.ok(m && /board-block/.test(m[1]), "a whiteboard");
  m = fig(md.render("![[paper.pdf#page=2]]\n: Page two\n", { links: { "paper.pdf#page=2": { kind: "pdf", path: "/x/paper.pdf", url: "paper.pdf" } } }));
  assert.ok(m && /pdf-embed/.test(m[1]) && m[2] === "Page two", "a PDF's page");
});

test("… and nothing else is a caption: a definition, a paragraph's line, a picture in a line of text", () => {
  assert.match(md.render("Term\n: definition\n"), /^<dl/);
  assert.doesNotMatch(md.render("A line\n\n: not under a picture\n"), /<figure/);
  assert.doesNotMatch(md.render("Some text ![](tree.png) more\n: no\n"), /<figure/);
  assert.doesNotMatch(md.render("```\ncode\n```\n:no space\n"), /<figure/);
});

test("the active mode: one block, written as it was read; the menu gives a caption and takes it away", () => {
  const text = "Intro\n\n![a tree|300](tree.png)\n: A tree\n\n```js\nconst a = 1;\n```\n: Code\n\n$$\nx\n$$\n\nEnd\n";
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const blocks = []; d.doc.forEach((n, p) => blocks.push({ n, p }));
  assert.equal(blocks.length, 5);
  assert.equal(A.document.serialize(d, d.doc, false), text);
  const view = { state: { doc: d.doc } }, cap = (i) => A.islands.caption(view, blocks[i].p, blocks[i].n);
  assert.equal(cap(0), null); // (a paragraph has none)
  assert.equal(cap(1).has, true);
  assert.equal(cap(2).has, true);
  assert.equal(cap(3).has, false); // (a formula without one: Add Caption)
  // a picture with a caption keeps its size and turn in the menu
  assert.equal(A.islands.picture(view, blocks[1].p, blocks[1].n).size, "300");
});

test("a code block's and a formula's caption: taken apart from the block, edited, put back (#12)", () => {
  const I = A.islands;
  let c = I.parseCode("```js\nconst a = 1;\n```\n: The first line");
  assert.equal(c.code, "const a = 1;", "the caption is not part of the code");
  assert.equal(c.closed, true);
  assert.equal(c.caption, "The first line");
  assert.equal(I.buildCode(c), "```js\nconst a = 1;\n```\n: The first line", "as it was");
  assert.equal(I.buildCode({ ...c, caption: "Another" }), "```js\nconst a = 1;\n```\n: Another");
  assert.equal(I.buildCode({ ...c, caption: "" }), "```js\nconst a = 1;\n```", "an empty caption: none");
  c = I.parseCode("```js\nx\n```\n\n:  spaced");
  assert.equal(I.buildCode(c), "```js\nx\n```\n\n:  spaced", "an untouched caption stays as it was written");
  let p = I.parseMath("$$\ne=mc^2\n$$\n: Einstein");
  assert.equal(p.tex, "e=mc^2");
  assert.equal(p.caption, "Einstein");
  assert.equal(I.buildMath({ ...p, caption: "Relativity" }), "$$\ne=mc^2\n$$\n: Relativity");
  assert.equal(I.buildMath(I.parseMath("$$\nx\n$$")), "$$\nx\n$$");
  // … and with its caption the block is still a code block, a formula: its own dialog opens, not the Markdown's
  const text = "```js\nconst a = 1;\n```\n: Code\n\n$$\nx\n$$\n: F\n";
  const d = A.document.open({ text, raw: text, links: {}, vault: false }), kinds = [];
  d.doc.forEach((n) => kinds.push(n.attrs.kind));
  assert.deepEqual(kinds, ["code", "math"]);
  assert.equal(A.document.serialize(d, d.doc, false), text);
});

// A table's caption (#16): the same line under it — right under its last row, where GitHub's tables would take it for a
// row of one cell, or after a blank line, as Pandoc writes it. In the active mode the table stays a table to type in.
const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |\n";
function edit(text) {
  const { EditorState, TextSelection } = w.PM.state;
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true, dispatch(tr) { v.state = v.state.apply(tr); }, focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text === "1") at = pos + 1; });
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  v.cell = () => A.tableui.cellAt(v.state.selection.$from);
  return v;
}

test("the reader: a table and its caption are one figure (#16)", () => {
  let m = fig(md.render(TABLE + ": Results in *May*\n"));
  assert.ok(m, "right under the table");
  assert.match(m[1], /^<div class="table-wrap wide"><table/);
  assert.equal((m[1].match(/<tr/g) || []).length, 2, "the caption is no row of the table");
  assert.equal(m[2], "Results in <em>May</em>");
  m = fig(md.render(TABLE + "\n: Results\n"));
  assert.ok(m && m[2] === "Results", "after a blank line");
  m = fig(md.render("<!-- table narrow -->\n" + TABLE + ": Narrow\n"));
  assert.ok(m && /^<div class="table-wrap"><table/.test(m[1]) && m[2] === "Narrow", "a table with the line that says how it looks");
  m = fig(md.render("| a | b |\n|---|---|\n: Only a head\n"));
  assert.ok(m && !/<tbody/.test(m[1]) && m[2] === "Only a head", "a table of its head alone");
  assert.match(md.render(TABLE + ": a | b\n"), /<td>: a<\/td>/, "a line with a pipe in it is a row");
  assert.doesNotMatch(md.render(TABLE + ":no space\n"), /<figure/);
  assert.match(md.render("> " + TABLE.trim().split("\n").join("\n> ") + "\n> : Quoted\n"), /<blockquote[^>]*>\n<figure class="fig"/, "in a quote");
});

test("the active mode: a table with its caption is still a table, written as it was read (#16)", () => {
  for (const text of ["Intro\n\n" + TABLE + ": Results\n\nEnd\n", TABLE + "\n:  spaced\n", "<!-- table head=blue -->\n" + TABLE + ": Blue\n"]) {
    const d = A.document.open({ text, raw: text, links: {}, vault: false }), kinds = [];
    d.doc.forEach((n) => kinds.push(n.type.name));
    assert.ok(kinds.includes("table"), "a table: " + JSON.stringify(text) + " " + kinds);
    assert.equal(A.document.serialize(d, d.doc, false), text);
  }
  // a cell typed into: the caption stays under the table
  const v = edit(TABLE + ": Results\n");
  assert.equal(v.cell().table.attrs.caption, "Results");
  v.dispatch(v.state.tr.insertText("0"));
  assert.match(v.md(), /\| 10 \| 2 \|\n: Results\n$/);
});

test("the active mode: the table's menu gives a caption, changes it and takes it away (#16)", () => {
  const v = edit(TABLE);
  const labels = () => A.tableui.tableItems(v, v.cell()).filter(Boolean).map((i) => i.label);
  assert.ok(labels().includes("Add Caption"));
  assert.ok(!labels().includes("Remove Caption"));
  A.tableui.caption(v, v.cell().tablePos, "Results");
  assert.equal(v.md(), TABLE + ": Results\n");
  assert.ok(labels().includes("Remove Caption"));
  A.tableui.caption(v, v.cell().tablePos, "A | B");
  assert.equal(v.md(), TABLE + "\n: A | B\n", "with a pipe in it: after a blank line, else it would be a row");
  A.tableui.caption(v, v.cell().tablePos, "  ");
  assert.equal(v.md(), TABLE, "an empty caption: none");
  // drawn under the table, as the reader draws it
  const spec = A.schema.nodes.table.spec.toDOM(A.schema.nodes.table.create({ caption: "On top" }, v.cell().table.content));
  assert.equal(spec.dom ? spec.dom.tagName : spec[0], spec.dom ? "FIGURE" : "figure");
});
