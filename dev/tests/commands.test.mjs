// Editing commands and what they write: each case is a document, a caret or
// selection, a command — and the Markdown expected afterwards. Then random
// sequences of edits, after each of which the file must say what the editor
// shows (test C) and contain nothing Markdown has its own syntax for.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPage, ACTIVE, ROOT } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection, AllSelection } = PM.state;
const K = A.edit.keys, M = A.schema.marks;

/* A document with an editor state. `|` in the source marks the caret, or
 * with two of them the selection (they are not part of the document). */
function doc(src) {
  const marks = [];
  const text = src.replace(/\|/g, (m, at) => { marks.push(at - marks.length); return ""; });
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  let state = EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) });
  const api = {
    d,
    get state() { return state; },
    md: () => A.document.serialize(d, state.doc, false),
    // position of a source offset: by the text before it (counted in the document's text)
    at(needle, after = true) {
      let found = -1;
      state.doc.descendants((n, pos) => { if (found < 0 && n.isText && n.text.includes(needle)) found = pos + n.text.indexOf(needle) + (after ? needle.length : 0); });
      assert.ok(found >= 0, "not in the document: " + needle);
      return found;
    },
    select(from, to = from) { state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))); return api; },
    caretAfter(needle) { return api.select(api.at(needle)); },
    caretBefore(needle) { return api.select(api.at(needle, false)); },
    selectText(needle) { return api.select(api.at(needle, false), api.at(needle)); },
    run(command) { const ok = command(state, (tr) => { state = state.apply(tr); }); return ok; },
    press(key) { assert.ok(K[key], "no such key: " + key); return api.run(K[key]); },
    type(str) { state = state.apply(state.tr.insertText(str)); return api; },
  };
  return api;
}
const is = (e, expected) => assert.equal(e.md(), expected);

test("Enter and Backspace", () => {
  let e = doc("one two\nthree four\n").caretAfter("one two");
  e.press("Enter");
  is(e, "one two\n\nthree four\n");
  e.press("Backspace");
  is(e, "one twothree four\n");

  e = doc("# Heading\n\ntext\n").caretAfter("Heading");
  e.press("Enter"); e.type("new");
  is(e, "# Heading\n\nnew\n\ntext\n");

  e = doc("# Head ing\n").caretAfter("Head");
  e.press("Enter");
  is(e, "# Head\n\ning\n");

  e = doc("## Title\n\nafter\n").caretBefore("Title");
  e.press("Backspace");
  is(e, "Title\n\nafter\n");
  e.press("Mod-z");
  is(e, "## Title\n\nafter\n");

  e = doc("> quoted\n\nafter\n").caretBefore("quoted");
  e.press("Backspace");
  is(e, "quoted\n\nafter\n");

  e = doc("- one\n- two\n").caretBefore("two");
  e.press("Backspace");
  is(e, "- one\n\ntwo\n");
});

test("a definition between two paragraphs stays when they are joined", () => {
  const e = doc("first[^1]\n\n[^1]: note\n\nsecond\n").caretBefore("second");
  e.press("Backspace");
  is(e, "firstsecond[^1]\n\n[^1]: note\n".replace("firstsecond[^1]", "first[^1]second"));
  e.run((s, dispatch) => { dispatch(s.tr.setSelection(new AllSelection(s.doc))); return true; });
  e.press("Backspace");
  assert.match(e.md(), /\[\^1\]: note/);
});

test("lists", () => {
  let e = doc("- one\n- two\n").caretAfter("two");
  e.press("Enter"); e.type("three");
  is(e, "- one\n- two\n- three\n");
  e.press("Tab");
  is(e, "- one\n- two\n  - three\n");
  e.press("Shift-Tab");
  is(e, "- one\n- two\n- three\n");
  e.press("Enter"); e.press("Enter"); e.type("out");
  is(e, "- one\n- two\n- three\n\nout\n");

  e = doc("* star\n* list\n").caretAfter("list");
  e.press("Enter"); e.type("more");
  is(e, "* star\n* list\n* more\n");

  e = doc("1. a\n1. b\n").caretAfter("b");
  e.press("Enter"); e.type("c");
  is(e, "1. a\n1. b\n1. c\n");
  e = doc("3. a\n4. b\n").caretAfter("b");
  e.press("Enter"); e.type("c");
  is(e, "3. a\n4. b\n5. c\n");

  e = doc("alpha\n\nbeta\n").select(2, 9);
  e.press("Shift-Mod-8");
  is(e, "- alpha\n- beta\n");
  e.press("Shift-Mod-7");
  is(e, "1. alpha\n2. beta\n");
  e.press("Shift-Mod-7");
  is(e, "alpha\n\nbeta\n");

  // other items keep their spelling, whatever it is
  e = doc("-   wide marker\n-   second\n    continued\n").caretAfter("wide");
  e.type("r");
  is(e, "-   wider marker\n-   second\n    continued\n");

  // code in an item is not touched by an edit next to it
  e = doc("- item\n\n  ```js\n  let a = 1;\n  ```\n- next\n").caretAfter("next");
  e.type("!");
  is(e, "- item\n\n  ```js\n  let a = 1;\n  ```\n- next!\n");
});

test("tasks", () => {
  let e = doc("- [ ] open\n- [x] done\n").caretAfter("open");
  e.press("Mod-Enter");
  is(e, "- [x] open\n- [x] done\n");
  e.press("Mod-Enter");
  is(e, "- [ ] open\n- [x] done\n");
  e.press("Enter"); e.type("new");
  is(e, "- [ ] open\n- [ ] new\n- [x] done\n");
  e = doc("- [X] capital\n- [ ] next\n").caretAfter("next");
  e.press("Mod-Enter");
  is(e, "- [X] capital\n- [X] next\n");
  e = doc("plain\n").caretAfter("plain");
  e.press("Shift-Mod-9");
  is(e, "- [ ] plain\n");
  e.press("Shift-Mod-9");
  is(e, "- plain\n");
});

test("headings and marks", () => {
  let e = doc("some text\nwrapped here\n").caretAfter("some");
  e.press("Shift-Mod-2");
  is(e, "## some text wrapped here\n");
  e.press("Shift-Mod-2");
  is(e, "some text\nwrapped here\n"); // back to what the file had, line break included

  e = doc("Setext\n======\n\nbody\n").caretAfter("Setext");
  e.type(" grows");
  is(e, "Setext grows\n======\n\nbody\n");

  e = doc("aaa bbb\nccc ddd\n").select(5, 12);
  e.press("Mod-b");
  is(e, "aaa **bbb\nccc** ddd\n");
  e.press("Mod-b");
  is(e, "aaa bbb\nccc ddd\n");

  e = doc("uses _underscores_ here\n").selectText("here");
  e.press("Mod-i");
  is(e, "uses _underscores_ _here_\n");
  e = doc("plain words\n").selectText("words");
  e.run(PM.commands.toggleMark(M.code));
  is(e, "plain `words`\n");
  e = doc("line one\n").caretAfter("line");
  e.press("Shift-Enter");
  is(e, "line\\\none\n");
});

test("typed characters that Markdown would read as syntax are escaped; others are not", () => {
  const cases = [
    ["3 * 4 = 12", "3 * 4 = 12"],
    ["*text*", "\\*text\\*"],
    ["# not a heading", "\\# not a heading"],
    ["1. not a list", "1\\. not a list"],
    ["- not a list", "\\- not a list"],
    ["> not a quote", "\\> not a quote"],
    ["snake_case_name", "snake_case_name"],
    ["a <div> tag", "a \\<div> tag"],
    ["a < b", "a < b"],
    ["costs $5", "costs $5"],
    ["$5 and $10", "$5 and $10"],
    ["&amp; literally", "\\&amp; literally"],
    ["AT&T", "AT&T"],
    ["a sentence.", "a sentence."],
    ["semi-detached", "semi-detached"],
    ["back\\slash", "back\\slash"],
    ["---", "\\---"],
    ["[not a link](url)", "\\[not a link\\](url)"],
    ["`tick", "`tick"],
  ];
  for (const [typed, expected] of cases) {
    const e = doc("before\n\nafter\n").caretAfter("before");
    e.press("Enter"); e.type(typed);
    is(e, `before\n\n${expected}\n\nafter\n`);
  }
});

test("new blocks follow the document's style", () => {
  const e = doc("* a list\n\ntext with __strong__ and _em_\n\npara\n").caretAfter("para");
  e.select(e.at("para", false), e.at("para"));
  e.press("Mod-b");
  assert.match(e.md(), /__para__/);
  e.press("Shift-Mod-8");
  assert.match(e.md(), /\* __para__/);
});

// ------------------------------------------------------------ random edits
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// the blocks the file holds: no footnote section, no empty paragraphs; definitions that
// stand next to each other count as one (read again, they are one run of lines)
const blocksOf = (d) => {
  const out = [];
  d.forEach((n) => {
    if ((n.type.name === "island" && n.attrs.virtual) || (n.type.name === "paragraph" && !n.content.size && d.childCount > 1)) return;
    const last = out[out.length - 1];
    if (n.type.name === "hidden" && last && last.type.name === "hidden") out[out.length - 1] = last.type.create({ raw: last.attrs.raw + "\n\n" + n.attrs.raw });
    else out.push(n);
  });
  return out;
};
const FORBIDDEN = /<br\b|<span\b|<b>|<i>|<div\b|&nbsp;|[​‌‍﻿]/;

function fuzz(name, src, random, steps) {
  const text = src.replace(/\r\n?/g, "\n");
  const e = doc(text.replace(/\|/g, "¦"));
  const clean = !FORBIDDEN.test(text);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const log = [];
  let impossible = 0;
  for (let s = 0; s < steps; s++) {
    const blocks = [];
    e.state.doc.descendants((n, pos) => { if (n.isTextblock) blocks.push([n, pos]); return !n.isTextblock; });
    if (!blocks.length) break;
    const [block, pos] = pick(blocks);
    const a = pos + 1 + Math.floor(random() * (block.content.size + 1)), b = pos + 1 + Math.floor(random() * (block.content.size + 1));
    const op = pick(["type", "type", "delete", "strong", "em", "code", "strike", "enter", "backspace", "heading", "paragraph", "bullets", "numbers", "task", "tab", "untab", "break"]);
    log.push(`${op}@${a},${b}`);
    try {
      if (op === "type") e.select(a).type(pick(["word", " and ", "x", "A.", " 12 "]));
      else if (op === "delete") { e.select(Math.min(a, b), Math.max(a, b)); e.run(PM.commands.deleteSelection); }
      else if (/^(strong|em|code|strike)$/.test(op)) { e.select(Math.min(a, b), Math.max(a, b)); e.run(PM.commands.toggleMark({ strong: M.strong, em: M.em, code: M.code, strike: M.s }[op])); }
      else if (op === "enter") { e.select(a); e.press("Enter"); }
      else if (op === "backspace") { e.select(pos + 1); e.press("Backspace"); }
      else if (op === "heading") { e.select(a); e.press("Shift-Mod-" + (1 + Math.floor(random() * 3))); }
      else if (op === "paragraph") { e.select(a); e.press("Shift-Mod-0"); }
      else if (op === "bullets") { e.select(a); e.press("Shift-Mod-8"); }
      else if (op === "numbers") { e.select(a); e.press("Shift-Mod-7"); }
      else if (op === "task") { e.select(a); e.press("Shift-Mod-9"); }
      else if (op === "tab") { e.select(a); e.press("Tab"); }
      else if (op === "untab") { e.select(a); e.press("Shift-Tab"); }
      else if (op === "break") { e.select(a); e.press("Shift-Enter"); }
      e.state.doc.check();
    } catch (err) {
      return { failed: `${name}: ${err.message}\n  steps: ${log.join(" ")}` };
    }
    const out = e.md();
    if (clean && FORBIDDEN.test(out)) return { failed: `${name}: forbidden output ${JSON.stringify(out.match(FORBIDDEN)[0])}\n  steps: ${log.join(" ")}` };
    const again = blocksOf(A.document.open({ text: out, raw: out, links: {}, vault: false }).doc), now = blocksOf(e.state.doc);
    const bad = again.length !== now.length ? -2 : now.findIndex((n, i) => !A.markdown.same(n, again[i]));
    if (bad === -1) continue;
    if (bad >= 0 && !A.markdown.expressible(now[bad], e.d)) { // from here on the file and the editor differ by design
      impossible++;
      if (process.env.MDVIEW_SHOW) console.log(`impossible after ${op}: ${JSON.stringify(A.markdown.shape(now[bad])).slice(0, 300)}\n   written: ${JSON.stringify(A.markdown.canonical(now[bad], { profile: A.markdown.profileOf(text), level: 0 }).slice(0, 200))}`);
      break;
    }
    return { failed: `${name}: after ${op} the file does not say what the editor shows (block ${bad})\n  steps: ${log.join(" ")}\n  file: ${JSON.stringify(out.slice(0, 600))}` +
      (bad >= 0 ? `\n  editor: ${JSON.stringify(A.markdown.shape(now[bad])).slice(0, 400)}\n  file:   ${JSON.stringify(A.markdown.shape(again[bad])).slice(0, 400)}` : `\n  blocks: ${now.length} in the editor, ${again.length} in the file`) };
  }
  return { impossible };
}
test("random edits: the file says what the editor shows", (t) => {
  const dir = path.join(ROOT, "dev/tests/fixtures");
  const docs = fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]);
  const rounds = Number(process.env.MDVIEW_FUZZ || 40), failures = [];
  let runs = 0, impossible = 0;
  for (let round = 0; round < rounds; round++) {
    for (const [name, src] of docs) {
      if (!src.trim()) continue;
      const r = fuzz(name, src, rng(round * 1000 + name.length), 12);
      runs++;
      if (r.failed) failures.push(`[round ${round}] ` + r.failed); else impossible += r.impossible;
    }
  }
  t.diagnostic(`${runs} sequences of 12 edits; ${impossible} ended in something Markdown cannot write; ${failures.length} failed`);
  if (failures.length) assert.fail(`${failures.length} of ${runs} sequences failed, first:\n${failures.slice(0, 3).join("\n\n")}`);
});
