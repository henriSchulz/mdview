// The edge cases of the spec (§15), as far as they concern the document and
// its Markdown: each text comes back byte for byte, and a word typed into one
// place leaves everything else as it was. (What needs the running app — the
// placeholder, dialogs, quick changes of mode, large files on screen — is in
// dev/probe-edges.js.)
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;

function open(raw) {
  // (the app hands the file over as it was decoded: a byte order mark is its first character)
  const d = A.document.open({ text: raw.replace(/\r\n?/g, "\n"), raw, links: {}, vault: false });
  let state = EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) });
  return {
    d,
    get state() { return state; },
    md: () => A.document.serialize(d, state.doc, true),
    // a word typed right after `needle`
    typeAfter(needle, word) {
      let at = -1;
      state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
      assert.ok(at >= 0, "not in the document: " + needle);
      state = state.apply(state.tr.insertText(word, at));
      return this;
    },
    apply(make) { state = state.apply(make(state)); return this; },
  };
}
/* raw comes back as it is; with `word` typed after `needle` the file is raw with exactly that. */
function check(name, raw, needle, shown = needle) {
  const e = open(raw);
  assert.equal(e.md(), raw, name + ": unchanged, it is written back byte for byte");
  if (needle == null) return e;
  e.typeAfter(shown, "X");
  const at = raw.indexOf(needle) + needle.length;
  assert.equal(e.md(), raw.slice(0, at) + "X" + raw.slice(at), name + ": a letter typed after " + JSON.stringify(needle) + " changes only that place");
  return e;
}

test("2: a document that is one island — text before it and after it", () => {
  for (const raw of ["---\ntitle: T\n---\n", "```js\nlet a;\n```\n", "$$\nx^2\n$$\n"]) {
    const e = check("only an island", raw);
    const N = A.schema.nodes;
    e.apply((s) => s.tr.insert(s.doc.content.size - (s.doc.lastChild.attrs.virtual ? s.doc.lastChild.nodeSize : 0), N.paragraph.create(null, s.schema.text("after"))));
    assert.equal(e.md(), raw + "\nafter\n", "a paragraph below");
    if (!raw.startsWith("---")) { // (nothing can stand above the properties)
      e.apply((s) => s.tr.insert(0, N.paragraph.create(null, s.schema.text("before"))));
      assert.equal(e.md(), "before\n\n" + raw + "\nafter\n", "a paragraph above");
    }
  }
});

test("3: a very long line", () => {
  const long = Array.from({ length: 2200 }, (_v, i) => "word" + i).join(" ");
  assert.ok(long.length > 10000);
  const t = performance.now();
  check("12 000 characters on a line", "Intro.\n\n" + long + " *end*.\n\nOutro.\n", "word1100 ", "word1100 ");
  assert.ok(performance.now() - t < 3000, "in reasonable time");
});

test("4: nested structures", () => {
  check("a list in a quote in a list", "- outer\n  > quoted\n  > - inner one\n  >   more\n  > - inner two\n- next\n", "inner one");
  check("code in a list item keeps its indentation", "1. step\n\n   ```sh\n   make -j4\n   ```\n\n2. then this\n", "then this");
  check("a formula in a table", "| f | note |\n|---|---|\n| $x^2$ | square |\n", "square");
  check("inline code with backticks in it", "Use `` a ` b `` and ``` `` ``` here.\n", "here");
});

test("5: fences", () => {
  check("a code block that holds a fence", "Text.\n\n````md\n```js\nx\n```\n````\n\nMore.\n", "More");
  check("a code block not closed at the end of the file", "Text here.\n\n```js\nlet a = 1;\n", "Text here");
  check("… without a last newline", "Text here.\n\n```js\nlet a = 1;", "Text here");
});

test("6: dollars", () => {
  check("prices", "It costs $5 and then $10 more.\n", "more");
  check("prices, typed between them", "It costs $5 and then $10 more.\n", "and");
  check("$$ in inline code, an escaped dollar", "Write `$$` or \\$x\\$ for $y$ literally.\n", "literally");
});

test("7: broken Markdown stays as it is", () => {
  check("unpaired emphasis", "This is **not closed and _neither is this.\n\nNext.\n", "Next");
  check("unpaired emphasis, typed into it", "This is **not closed and _neither is this.\n\nNext.\n", "closed");
  check("half a table", "| a | b\n|---\n| 1\n\nNext.\n", "Next");
  check("a link without an end", "See [the docs](http://example.com and more.\n", "more");
});

test("8: HTML comments are never lost", () => {
  const raw = "First.\n\n<!-- keep me -->\n\nSecond <!-- and me --> here.\n\n<!--\nmany\nlines\n-->\nThird.\n";
  check("comments", raw, "First");
  check("comments", raw, "Third");
  // deleting the text around a comment leaves the comment
  const e = open(raw);
  e.apply((s) => { let a = -1, b = -1; s.doc.forEach((n, p) => { if (n.textContent.startsWith("First")) a = p; if (n.textContent.startsWith("Third")) b = p + n.nodeSize; }); return s.tr.delete(a, a + s.doc.nodeAt(a).nodeSize); });
  assert.ok(e.md().includes("<!-- keep me -->") && e.md().includes("<!-- and me -->") && e.md().includes("<!--\nmany\nlines\n-->"), e.md());
});

test("9: a reference link without its definition", () => {
  check("missing definition", "See [the text][missing] and [another].\n\nNext line.\n", "Next line");
  check("missing definition, typed beside it", "See [the text][missing] and [another].\n", "and");
});

test("10: setext headings and breaks made of two spaces", () => {
  const raw = "Title\n=====\n\nSub\n---\n\nline one  \nline two  \nline three\n\nEnd.\n";
  check("setext", raw, "End");
  check("two spaces", raw, "line two");
  check("a setext heading: its underline stays as it is", raw, "Title");
});

test("11: line endings, BOM, no newline at the end", () => {
  check("CRLF", "One.\r\n\r\nTwo.\r\n", "Two");
  check("mixed", "One.\r\n\r\nTwo.\n\nThree.\r\n", "Three");
  check("mixed", "One.\r\n\r\nTwo.\n\nThree.\r\n", "Two");
  check("BOM", "﻿# Title\n\nText.\n", "Text");
  check("no newline at the end", "One.\n\nTwo.", "Two");
  check("several newlines at the end", "One.\n\nTwo.\n\n\n", "One");
});

test("12: emoji, combining characters, right-to-left, CJK", () => {
  const raw = "Family 👨‍👩‍👧‍👦 and flag 🇩🇪 done.\n\nCafé with a combining accent.\n\nשלום עולם, זה טקסט.\n\n日本語のテキストです。\n\nمرحبا بالعالم\n\nEnd.\n";
  for (const needle of ["done", "accent", "End"]) check("unicode", raw, needle);
  check("typed into Hebrew", raw, "שלום");
  check("typed into Japanese", raw, "日本語");
  check("typed after an emoji", raw, "👨‍👩‍👧‍👦");
  assert.ok(!/[​ ﻿]/.test(open(raw).typeAfter("End", " more").md()), "no invisible characters come in");
});
