// What the panel's Document tab is made of: a note's text counted, a property written into its
// head — the rest of the file as it was — and how a note says it wants to be shown.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const w = await loadPage();
const { setProp, stripFrontmatter, doc } = w.MdView.core;
const facts = (text) => ({ ...doc.facts(text) });

test("a note counted: words, characters, blocks, and what is in it", () => {
  const f = facts("---\ntitle: Not counted here\n---\n\n# A title\n\nOne two three, don't stop.\nStill the same paragraph.\n\n- first\n- [x] done\n- [ ] open [a link](https://example.org)\n\n![a picture](p.png) and ![[q.png]]\n\n| a | b |\n|---|---|\n| c | d |\n\n> a quote\n> of two lines\n\n---\n\n```js\nconst notCounted = 1;\n```\n\n$$\nx^2\n$$\n\nSee [[Other note]] and https://example.com. %% a comment %%\n");
  assert.deepEqual(f, { words: 32, chars: 145, blocks: 12, minutes: 1, headings: 1, pictures: 2, links: 3, tasks: 2, done: 1, pages: 0 });
});

test("nothing counts as nothing, and a long text takes its minutes", () => {
  assert.deepEqual(facts(""), { words: 0, chars: 0, blocks: 0, minutes: 0, headings: 0, pictures: 0, links: 0, tasks: 0, done: 0, pages: 0 });
  assert.deepEqual(facts("---\nwide: true\n---\n"), facts(""));
  const long = facts(Array.from({ length: 50 }, () => "word ".repeat(22).trim()).join("\n\n"));
  assert.deepEqual([long.words, long.blocks, long.minutes], [1100, 50, 5]);
});

test("the pages in a note are the document's too", () => {
  const f = facts("# Main\n\ntext\n\n<!-- page card blue: Meeting notes -->\n\n## Agenda\n\n- one\n\n<!-- /page -->\n\nend\n");
  assert.deepEqual([f.pages, f.headings, f.blocks, f.words], [1, 2, 6, 5]);
});

test("a property is added to a note without properties, and they go with the last of them", () => {
  const made = setProp("# Title\n\ntext\n", "wide", true);
  assert.equal(made, "---\nwide: true\n---\n\n# Title\n\ntext\n");
  assert.equal(setProp(made, "wide", null), "# Title\n\ntext\n");
  assert.equal(setProp("", "background", "blue"), "---\nbackground: blue\n---\n");
  assert.equal(setProp("# Title\n", "wide", null), "# Title\n"); // (nothing to take away)
});

test("a property is written into the properties that stand there: the rest as it was", () => {
  const note = "---\ntitle: A note # the name\ntags: [one, two]\nbackground: blue\n---\n# Title\n";
  assert.equal(setProp(note, "background", "paper"), note.replace("background: blue", "background: paper"));
  assert.equal(setProp(note, "wide", true), note.replace("background: blue\n", "background: blue\nwide: true\n"));
  assert.equal(setProp(note, "background", null), note.replace("background: blue\n", ""));
  assert.equal(setProp("---\n---\n# T\n", "wide", true), "---\nwide: true\n---\n# T\n");
  assert.equal(setProp("---\nwide: true\n---", "wide", null), ""); // (the properties alone, as the editor holds them)
  assert.equal(setProp("---\ntitle: x\n---", "wide", true), "---\ntitle: x\nwide: true\n---");
  // a value over several lines goes with its key; one that only begins alike is another
  assert.equal(setProp("---\nbackground:\n  - a\n  - b\nbackgrounds: 2\n---\n", "background", "red"), "---\nbackground: red\nbackgrounds: 2\n---\n");
  assert.equal(setProp("---\nwide:\n- a\nlast: 1\n---\n", "wide", null), "---\nlast: 1\n---\n");
});

test("line ends and a mark at the file's beginning stay; a head that cannot be read is left alone", () => {
  assert.equal(setProp("---\r\ntitle: x\r\n---\r\n# T\r\n", "wide", true), "---\r\ntitle: x\r\nwide: true\r\n---\r\n# T\r\n");
  assert.equal(setProp("a\r\nb\r\n", "wide", true), "---\r\nwide: true\r\n---\r\n\r\na\r\nb\r\n");
  assert.equal(setProp("﻿---\ntitle: x\n---\n", "wide", true), "﻿---\ntitle: x\nwide: true\n---\n");
  assert.equal(setProp("---\ntitle: [unclosed\n---\n# T\n", "wide", true), null);
  // a rule at the very top is no properties: they are put before it
  assert.equal(setProp("---\n\ntext\n", "wide", true), "---\nwide: true\n---\n\n---\n\ntext\n");
});

test("what was written is read again", () => {
  let text = "# T\n";
  text = setProp(text, "background", "green");
  text = setProp(text, "wide", true);
  assert.deepEqual({ ...stripFrontmatter(text).props }, { background: "green", wide: true });
  assert.equal(stripFrontmatter(text).body, "\n# T\n");
});

test("how a note says it wants to be shown: one of the grounds, and wide only when it says true", () => {
  const P = w.MdPage, look = (props) => ({ ...P.docLook(props) });
  assert.deepEqual(look(null), { background: "", wide: false });
  assert.deepEqual(look({ background: "Blue ", wide: true }), { background: "blue", wide: true });
  assert.deepEqual(look({ background: "grey", wide: "yes" }), { background: "gray", wide: false });
  assert.deepEqual(look({ background: "#ff0000" }), { background: "", wide: false });
  assert.deepEqual(look({ background: ["dots"], wide: 1 }), { background: "", wide: false });
  assert.deepEqual([...doc.BACKGROUNDS], ["gray", "red", "orange", "yellow", "green", "cyan", "blue", "magenta", "dots", "grid", "lines"]);
});
