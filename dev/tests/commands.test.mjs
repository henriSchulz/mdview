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
function doc(src, plain = false) { // plain: the text as it is, pipes and all
  const marks = [];
  const text = plain ? src : src.replace(/\|/g, (m, at) => { marks.push(at - marks.length); return ""; });
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
    apply(tr) { state = state.apply(tr); return api; },
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
const OPS = ["type", "type", "delete", "strong", "em", "code", "strike", "enter", "backspace", "heading", "paragraph", "bullets", "numbers", "task", "tab", "untab", "break", "paste", "table", "island", "note"];
const FORBIDDEN = /<br\b|<span\b|<b>|<i>|<div\b|&nbsp;|[​‌‍﻿]/;

const PASTES = ["* one\n* two", "**bold** text", "> quoted\n\nafter", "| x | y |\n|---|---|\n| 1 | 2 |", "~~~\ncode\n~~~", "plain words", "1) a\n2) b", "Setext\n------"];
const N = A.schema.nodes;
// each(out, op): called with the file after every step (it may return a failure)
function fuzz(name, src, random, steps, each = null, ops = OPS) {
  const text = src.replace(/\r\n?/g, "\n");
  const e = doc(text, true);
  const viewLike = { get state() { return e.state; }, dispatch(tr) { e.apply(tr); }, dom: w.document.createElement("div"), focus() {} };
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
    const op = pick(ops);
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
      else if (op === "paste") { e.select(a); A.clip.insertMarkdown(viewLike, pick(PASTES)); }
      else if (op === "note") { e.select(a); e.run(A.notes.insert); }
      else if (op === "table") { // something done to a table's rows and columns, if there is a table
        const cells = [];
        e.state.doc.descendants((n, p) => { if (n.type === N.table_cell) cells.push(p + 1); return !n.isTextblock; });
        if (cells.length) {
          e.select(pick(cells));
          const c = A.tableui.cellAt(e.state.selection.$from), O = A.tableui.ops;
          const make = pick([O.rowBelow(c.r), O.rowAbove(Math.max(1, c.r)), O.rowMove(c.r, 1), O.rowDelete(c.r), O.colLeft(c.c), O.colRight(c.c), O.colMove(c.c, 1), O.colDelete(c.c), O.align(c.c, pick(["left", "center", "right"]))]);
          const did = (c.r === 0 && make.name === "") ? null : A.tableui.changed(e.state, c.tablePos, make);
          if (did) e.apply(did.tr);
        }
      } else if (op === "island") { // a code block or a formula changed as its dialog would
        const islands = [];
        e.state.doc.descendants((n, p) => { if (n.type === N.island && !n.attrs.virtual && /^(code|math)$/.test(n.attrs.kind)) islands.push([n, p]); return !n.isTextblock && n.type !== N.island; });
        if (islands.length) {
          const [node, p] = pick(islands), I = A.islands;
          const raw = node.attrs.kind === "code" ? I.buildCode({ ...I.parseCode(node.attrs.raw), code: I.parseCode(node.attrs.raw).code + "\nmore();" }) : I.buildMath({ ...I.parseMath(node.attrs.raw), tex: I.parseMath(node.attrs.raw).tex + " + 1" });
          const made = I.blocksOf(raw, e.d.store).map((n, i) => n.type.create({ ...n.attrs, bid: i === 0 ? node.attrs.bid : null, line: null }, n.content, n.marks));
          if (made.length === 1 && made[0].type === N.island) e.apply(e.state.tr.replaceWith(p, p + node.nodeSize, N.island.create({ ...made[0].attrs, raw })));
        }
      }
      e.state.doc.check();
    } catch (err) {
      return { failed: `${name}: ${err.message}\n  steps: ${log.join(" ")}` };
    }
    const out = e.md();
    if (each) { const said = each(out, op); if (said) return { failed: `${name}: ${said}\n  steps: ${log.join(" ")}\n  file: ${JSON.stringify(out.slice(0, 500))}` }; }
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
  if (failures.length) assert.fail(`${failures.length} of ${runs} sequences failed, first:\n${failures.slice(0, Number(process.env.MDVIEW_SHOW || 3)).join("\n\n")}`);
});

// ------------------------------------------------------------ portability (test D)
/* What the file says must not depend on this app's parser. A second,
 * independent one (micromark with its GFM extension) reads every text the
 * random edits produce; where the two agreed on the text before the edits,
 * they must agree after each of them. */
const { micromark } = await import("micromark");
const { gfm, gfmHtml } = await import("micromark-extension-gfm");
const other = (text) => micromark(text, { allowDangerousHtml: true, allowDangerousProtocol: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] });
const mine = (text) => w.MdView.core.md.render(text, { links: {}, outline: [], depth: 0, lineOffset: 0 });
const KEEP = /^(P|H[1-6]|BLOCKQUOTE|UL|OL|LI|PRE|TABLE|TR|TD|TH|HR|STRONG|EM|DEL|S|CODE|A|IMG|BR)$/;
// the structure of a rendering: its elements that mean something, and its text
// bare: without the links a parser makes of an address standing in the text by itself
function signature(html, bare = false) {
  const box = w.document.createElement("div");
  box.innerHTML = html;
  const out = [];
  let text = "";
  const flush = () => { const t = text.replace(/\s+/g, " ").trim(); if (t) out.push('"' + t + '"'); text = ""; };
  (function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { text += child.nodeValue; continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName;
      if (tag === "BUTTON" || tag === "SVG" || /\b(code-tools|code-lang|anchor)\b/.test(child.className || "")) continue;
      if (tag === "INPUT") { flush(); out.push(child.checked || child.hasAttribute("checked") ? "[x]" : "[ ]"); continue; }
      if (tag === "P" && child.parentElement.tagName === "LI") { flush(); walk(child); flush(); continue; } // tight or loose: the same content
      const address = bare && tag === "A" && [child.textContent, "mailto:" + child.textContent, "http://" + child.textContent].includes(decodeURI(child.getAttribute("href") || ""));
      const keep = KEEP.test(tag) && !address; // (anything else — this app's tags, wrappers — counts as its text)
      if (keep) { flush(); out.push("<" + (tag === "S" ? "DEL" : tag) + (tag === "A" ? " " + child.getAttribute("href") : tag === "IMG" ? " " + child.getAttribute("src") : "") + ">"); }
      walk(child);
      if (keep) { flush(); if (!/^(HR|BR|IMG)$/.test(tag)) out.push("</>"); }
    }
  })(box);
  flush();
  return out.join("");
}
test("portability: a second parser reads the edited file the same way", { skip: !fs.existsSync(path.join(ROOT, "dev/corpus/commonmark.json")) && "run dev/fetch-corpus.sh first" }, (t) => {
  const examples = JSON.parse(fs.readFileSync(path.join(ROOT, "dev/corpus/commonmark.json"), "utf8")).map((x) => [`example ${x.example}`, x.markdown]);
  const dir = path.join(ROOT, "dev/tests/fixtures");
  const docs = [...examples, ...fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")])];
  const agree = (text) => { try { return signature(mine(text)) === signature(other(text)); } catch (_e) { return false; } };
  // (no formulas, notes or code changed by dialog here: only what both parsers know)
  const ops = OPS.filter((op) => !/^(note|island)$/.test(op));
  let used = 0, steps = 0, addresses = 0;
  const failures = [];
  // Which bare text is an address is the one thing parsers settle differently (GFM leaves room): not a difference in what the file says.
  const differ = (out) => {
    steps++;
    if (agree(out)) return null;
    if (signature(mine(out), true) === signature(other(out), true)) { addresses++; return null; }
    return `the parsers differ:\n   here:  ${signature(mine(out)).slice(0, 300)}\n   there: ${signature(other(out)).slice(0, 300)}`;
  };
  for (const [name, src] of docs) {
    if (!src.trim() || !agree(src.replace(/\r\n?/g, "\n"))) continue;
    used++;
    for (let round = 0; round < 3; round++) {
      const r = fuzz(name, src, rng(round * 7919 + name.length), 6, differ, ops);
      if (r.failed && /the parsers differ/.test(r.failed)) failures.push(`[round ${round}] ` + r.failed);
    }
  }
  t.diagnostic(`${used} of ${docs.length} texts read the same by both parsers before editing; ${steps} edited files compared; ${failures.length} differ (and ${addresses} only in which bare text counts as an address)`);
  assert.ok(used > 400, "most of the examples take part");
  if (failures.length) assert.fail(`${failures.length} edited files are read differently, first:\n${failures.slice(0, Number(process.env.MDVIEW_SHOW || 3)).join("\n\n")}`);
});
