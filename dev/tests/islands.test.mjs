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

test("properties from the form: only the lines of what changed are written anew", () => {
  const I = w.MdActive.islands;
  const yaml = "title: A note\ntags: [one, two]\naliases:\n  - first\n  - second\ndate: 2026-10-02\ndraft: true\nnested:\n  key: value";
  const data = w.jsyaml.load(yaml);
  assert.equal(I.applyForm(yaml, data, {}, [], []), yaml, "nothing changed: nothing written");
  assert.equal(I.applyForm(yaml, data, { title: "Another: note" }, [], []), yaml.replace("title: A note", 'title: "Another: note"'), "a value YAML would read otherwise is quoted");
  assert.equal(I.applyForm(yaml, data, { title: "Plain" }, [], []), yaml.replace("A note", "Plain"));
  assert.equal(I.applyForm(yaml, data, { tags: ["one", "two", "three"] }, [], []), yaml.replace("[one, two]", "[one, two, three]"), "a list on one line stays on one line");
  assert.equal(I.applyForm(yaml, data, { aliases: ["first", "third"] }, [], []), yaml.replace("  - second", "  - third"), "a list of lines stays a list of lines");
  assert.equal(I.applyForm(yaml, data, { draft: false, date: "2026-10-03" }, [], []), yaml.replace("draft: true", "draft: false").replace("2026-10-02", "2026-10-03"));
  assert.equal(I.applyForm(yaml, data, {}, ["aliases"], []), yaml.replace("aliases:\n  - first\n  - second\n", ""), "a property removed with its lines");
  assert.equal(I.applyForm(yaml, data, {}, [], [["author", "Henri"]]), yaml + "\nauthor: Henri", "a property added at the end");
  assert.deepEqual(JSON.stringify(w.jsyaml.load(I.applyForm(yaml, data, { title: "x # y" }, [], [])).title), JSON.stringify("x # y"), "a # stays text");
});

test("code that is put away: \"hide\" after the language, a card in the note, switched from the menu", () => {
  const hidden = w.MdView.core.codeHidden;
  assert.deepEqual([hidden("verilog hide The ALU"), hidden("js hide"), hidden('py hide "Quoted"'), hidden("js"), hidden("hide"), hidden("js title=\"a.js\""), hidden("js hidden")].map((h) => h && h.title), ["The ALU", "", "Quoted", null, null, null, null]);
  const render = (src) => w.MdView.core.md.render(src, { links: {}, outline: [], depth: 0 });
  const card = render("```verilog hide The ALU\nmodule alu;\nendmodule\n```\n");
  assert.match(card, /class="code-block code-hidden"/);
  assert.match(card, /<span class="code-card-title">The ALU<\/span><span class="code-lang">verilog<\/span><span class="code-card-count">2 lines<\/span>/);
  assert.match(card, /<pre hidden><code class="hljs language-verilog"><span class="hljs-keyword">module<\/span>/); // (the code is there, coloured, for the window that shows it)
  assert.match(render("```js hide\n\nconst a = 1;\n```\n"), /code-card-peek">const a = 1;<\/span>/); // (no title: the code's first line)
  assert.ok(!/code-hidden/.test(render("```js\nconst a = 1;\n```\n")));
  // the fence's head, taken apart and put together with "hide" in it
  const c = I.parseCode("```js hide A title\nlet a;\n```");
  assert.deepEqual([c.lang, c.rest], ["js", " hide A title"]);
  assert.equal(I.buildCode(c), "```js hide A title\nlet a;\n```");
});

test("a property that is true or false is switched in the properties as they are written", () => {
  const P = w.MdView.core.toggleProp;
  const note = "---\ntitle: A note\ndone: false # not yet\n\"with space\": True\ncount: 3\n---\n\n# Text\n\ndone: false\n";
  assert.equal(P(note, "done", true), note.replace("done: false # not yet", "done: true # not yet")); // (its remark stays, and the same words in the text are left)
  assert.equal(P(note, "with space", false), note.replace("\"with space\": True", "\"with space\": false"));
  assert.equal(P(note, "count", true), null); // (no true or false there)
  assert.equal(P(note, "missing", true), null);
  assert.equal(P("# no properties\n\ndone: false\n", "done", true), null);
  assert.equal(P("---\r\ndone: true\r\n---\r\ntext\r\n", "done", false), "---\r\ndone: false\r\n---\r\ntext\r\n"); // (line ends as they are)
  // the box says which property it is, and can be clicked
  assert.match(w.MdView.core.renderProps({ done: true }, {}), /<input type="checkbox" class="task" data-prop="done" checked>/);
});
