// The document store: how a file is cut into segments and put together again.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const { store } = w.MdActive;
const parse = (src, opts) => store.parse(src, opts);
const shape = (s) => s.segs.map((x) => `${x.kind}:${x.type}`);
// arrays built inside the page belong to another realm; compare by value
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

test("blocks, separators and what stands before the first block", () => {
  const s = parse("\n\n# Title\n\nText\nmore\n\n\n- a\n- b\n");
  same(shape(s), ["block:heading", "block:paragraph", "block:list"]);
  assert.equal(s.head.raw, "\n\n");
  same(s.segs.map((x) => x.raw), ["# Title", "Text\nmore", "- a\n- b"]);
  same(s.segs.map((x) => x.sep.raw), ["\n\n", "\n\n\n", "\n"]);
  same(s.segs.map((x) => [x.line, x.lines]), [[2, 1], [4, 2], [8, 2]]);
});

test("definitions are kept as hidden segments, in place", () => {
  const s = parse("Text[^1] and [a link][ref].\n\n[ref]: https://example.com\n[^1]: A note\n    continued\n\n*[HTML]: Hyper Text\n\nEnd.\n");
  same(shape(s), ["block:paragraph", "hidden:definition", "block:paragraph"]);
  assert.equal(s.segs[1].raw, "[ref]: https://example.com\n[^1]: A note\n    continued\n\n*[HTML]: Hyper Text", "one segment per run of definitions");
  assert.equal(s.virtual.length, 1, "the footnote section is output without a place in the source");
});

test("frontmatter is one segment; invalid frontmatter is ordinary Markdown", () => {
  const ok = parse("---\ntitle: x\n---\n\nText\n");
  same(shape(ok), ["block:frontmatter", "block:paragraph"]);
  assert.equal(ok.segs[0].raw, "---\ntitle: x\n---");
  const bare = parse("---\ntitle: x\n---");
  same(shape(bare), ["block:frontmatter"]);
  assert.equal(bare.segs[0].sep.raw, "");
  const bad = parse("---\n: : :\n  - [\n---\n\nText\n");
  assert.ok(!shape(bad).includes("block:frontmatter"));
});

test("an unclosed fence keeps its blank lines; a closed one does not take the ones after it", () => {
  const open = parse("```\ncode\n\n\n");
  assert.equal(open.segs[0].raw, "```\ncode\n\n");
  assert.equal(open.segs[0].sep.raw, "\n");
  const closed = parse("```\ncode\n```\n\n\nText");
  assert.equal(closed.segs[0].raw, "```\ncode\n```");
  assert.equal(closed.segs[0].sep.raw, "\n\n\n");
});

test("comments are invisible but stay in the text", () => {
  const s = parse("One\n\n%% a comment %%\n\nTwo %%inline%% end\n");
  same(shape(s), ["block:paragraph", "block:paragraph"]);
  assert.equal(s.segs[0].sep.raw, "\n\n%% a comment %%\n\n");
  assert.equal(s.segs[1].raw, "Two %%inline%% end");
});

test("a comment between two blocks stays when its neighbours change", () => {
  const s = parse("A\n\n%%\nkept\n%%\n\nB\n\nC\n"), ser = (parts) => store.serialize(s, parts);
  assert.equal(ser([{ id: 0 }]), "A\n\n%%\nkept\n%%\n", "the block after it gone");
  assert.equal(ser([{ id: 0 }, { text: "new" }, { id: 1 }, { id: 2 }]), "A\n\n%%\nkept\n%%\n\nnew\n\nB\n\nC\n", "a block typed behind it");
  assert.equal(ser([{ id: 1 }, { id: 2 }]), "%%\nkept\n%%\n\nB\n\nC\n", "its own block gone: before the next");
  assert.equal(ser([{ id: 1 }, { id: 0 }, { id: 2 }]), "B\n\nA\n\n%%\nkept\n%%\n\nC\n", "moved: it goes with its block");
  assert.equal(ser([{ id: 0 }, { id: 1 }, { id: 2 }]), "A\n\n%%\nkept\n%%\n\nB\n\nC\n", "nothing changed: as written");
  assert.equal(ser([{ id: 2 }]), "%%\nkept\n%%\n\nC\n", "only the last block left");
});

test("%% in code is the code's, not a comment's", () => {
  const strip = w.MdView.core.stripComments;
  const two = "```\n%%time\n```\n\nVisible\n\n```\n%%time\n```\n";
  assert.equal(strip(two), two, "two fences with a cell magic each");
  assert.equal(strip('`printf("%%d %%s")` and %% gone %% text'), '`printf("%%d %%s")` and  text');
  assert.equal(strip("a %% one\ntwo %% b"), "a \n b", "a comment over lines keeps its line break");
  assert.equal(strip("~~~\n%% x %%\n~~~\nafter %%c%%"), "~~~\n%% x %%\n~~~\nafter ");
  assert.equal(strip("never %% closed"), "never %% closed");
  same(shape(parse(two)), ["block:code", "block:paragraph", "block:code"]);
});

test("blocks under one open HTML element are one segment", () => {
  const s = parse("Before\n\n<details>\n<summary>S</summary>\n\nInside *text*.\n\n- list\n\n</details>\n\nAfter\n");
  same(shape(s), ["block:paragraph", "block:html", "block:paragraph"]);
  assert.equal(s.segs[1].raw, "<details>\n<summary>S</summary>\n\nInside *text*.\n\n- list\n\n</details>");
  const self = parse("<div>one</div>\n\nText\n");
  same(shape(self), ["block:html", "block:paragraph"]);
  const never = parse("Start <b>bold\n\nSecond\n\nThird\n");
  same(shape(never), ["block:html"], "an element that is never closed takes the rest of the document");
});

test("line endings: every slice keeps its own, new text gets the file's", () => {
  const src = "A\r\n\r\nB\nstill B\r\n\r\nC\r\n";
  const s = parse(src);
  assert.equal(s.eol, "\r\n");
  assert.equal(s.text, "A\n\nB\nstill B\n\nC\n");
  assert.equal(s.segs[1].orig, "B\nstill B", "a block's own (mixed) endings stay");
  assert.equal(store.serialize(s), src);
  assert.equal(store.serialize(s, null, false), s.text);
  // a changed block in the middle: its neighbours and their separators are untouched
  const out = store.serialize(s, [{ id: 0 }, { text: "new\nlines" }, { id: 2 }]);
  assert.equal(out, "A\r\n\r\nnew\r\nlines\r\n\r\nC\r\n");
  assert.equal(parse("a\rb\r\rc").eol, "\r");
  assert.equal(parse("no line end").eol, "\n");
});

test("serialize: inserted, removed and moved blocks", () => {
  const s = parse("\nA\n\n\nB\n\nC\n\n\n\n");
  const ser = (parts) => store.serialize(s, parts);
  assert.equal(ser([{ id: 0 }, { id: 1 }, { id: 2 }]), s.original);
  assert.equal(ser([{ id: 0 }, { text: "X" }, { id: 1 }, { id: 2 }]), "\nA\n\nX\n\nB\n\nC\n\n\n\n", "a new block gets a blank line on both sides");
  assert.equal(ser([{ id: 0 }, { id: 2 }]), "\nA\n\nC\n\n\n\n", "a removed block takes its separator along");
  assert.equal(ser([{ id: 1 }, { id: 0 }, { id: 2 }]), "\nB\n\nA\n\nC\n\n\n\n", "what the file starts and ends with stays");
  assert.equal(ser([{ id: 2 }, { id: 2 }]), "\nC\n\nC\n\n\n\n", "a block may appear twice");
  assert.equal(ser([]), "\n", "nothing left: what stood before the first block");
  assert.equal(ser([{ text: "only" }]), "\nonly\n\n\n\n");
});

test("empty and blank documents", () => {
  for (const src of ["", "\n", "\n\n  \n", "%% only a comment %%\n"]) {
    const s = parse(src);
    assert.equal(s.segs.length, 0, JSON.stringify(src));
    assert.equal(store.serialize(s), src);
  }
});
