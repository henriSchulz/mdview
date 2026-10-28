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
