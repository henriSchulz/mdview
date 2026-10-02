// Islands: their Markdown taken apart for the dialog and put together again.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const I = w.MdActive.islands;

test("a code block comes back as written when nothing changes", () => {
  for (const raw of [
    "```js\nlet a = 1;\n```",
    "```\nplain\n```",
    "~~~python\nprint(1)\n~~~",
    "````md\n```js\nnested\n```\n````",
    '```js title="a.js" {1,3}\nx\n```',
    "``` js\nspace before the language\n```",
    "  ```sh\n  echo hi\n\n  echo again\n  ```",
    "    indented\n\n    second",
    "```js\n```",
    "```\n\ttab\n  trailing  \n```",
  ]) assert.equal(I.buildCode(I.parseCode(raw)), raw, JSON.stringify(raw));
});

test("code: language, info string, fence and indentation", () => {
  const c = I.parseCode('```js title="a.js" {1,3}\nlet a;\n```');
  assert.equal(c.lang, "js");
  assert.equal(c.rest, ' title="a.js" {1,3}');
  assert.equal(c.code, "let a;");
  assert.equal(I.buildCode({ ...c, lang: "ts" }), '```ts title="a.js" {1,3}\nlet a;\n```', "only the first word is the language");
  assert.equal(I.buildCode({ ...c, lang: "" }), '```title="a.js" {1,3}\nlet a;\n```', "no language: the rest stays");
  // code that holds a fence gets a longer one
  assert.equal(I.buildCode({ ...I.parseCode("```\nx\n```"), code: "a\n```\nb" }), "````\na\n```\nb\n````");
  assert.equal(I.buildCode({ ...I.parseCode("~~~\nx\n~~~"), code: "~~~~" }), "~~~~~\n~~~~\n~~~~~");
  // inside a list item the dialog sees the code without the indentation and puts it back
  const nested = I.parseCode("  ```sh\n  echo hi\n  ```");
  assert.equal(nested.code, "echo hi");
  assert.equal(I.buildCode({ ...nested, code: "echo ho\n\nmore" }), "  ```sh\n  echo ho\n\n  more\n  ```");
  // indented code stays indented until it gets a language
  const ind = I.parseCode("    a\n\n    b");
  assert.equal(ind.code, "a\n\nb");
  assert.equal(I.buildCode({ ...ind, code: "a\nc" }), "    a\n    c");
  assert.equal(I.buildCode({ ...ind, lang: "js" }), "```js\na\n\nb\n```");
  // an unclosed fence is closed by an edit
  assert.equal(I.buildCode(I.parseCode("```js\nopen")), "```js\nopen\n```");
});

test("a formula keeps the way its dollars are written", () => {
  for (const raw of ["$$\nE = mc^2\n$$", "$$ E = mc^2 $$", "$$E = mc^2$$", "$$\na\n\nb\n$$", "$$\n\\begin{pmatrix}\n1 & 2\n\\end{pmatrix}\n$$"]) {
    const p = I.parseMath(raw);
    assert.equal(I.buildMath(p), raw);
    assert.equal(I.buildMath({ ...p, tex: "x" }), raw.replace(p.tex, "x"));
  }
  assert.equal(I.parseMath("$$\nE = mc^2\n$$").tex, "E = mc^2");
  assert.equal(I.parseMath("$$ E = mc^2 $$").tex, "E = mc^2");
});

test("frontmatter keeps its fences", () => {
  for (const raw of ["---\ntitle: x\n---", "---\ntitle: x\ntags: [a, b]\n...", "---\n---"]) assert.equal(I.buildFront(I.parseFront(raw)), raw);
  assert.equal(I.buildFront({ ...I.parseFront("---\n---"), yaml: "a: 1" }), "---\na: 1\n---");
  assert.equal(I.parseFront("---\ntitle: x\n# comment\n---").yaml, "title: x\n# comment");
});

test("a formula's error says where", () => {
  assert.ok(I.mathPreview("x^2", true).html.includes("katex"));
  const bad = I.mathPreview("\\frac{1}{", true);
  assert.ok(bad.error && bad.html == null);
  assert.equal(typeof bad.pos, "number");
});
