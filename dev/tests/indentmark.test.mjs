// A block moved in by Tab, or put in a callout (active/markdown.js, blockquote): the line that says what the quote is
// ("> [!indent]", "> [!note]") is a paragraph's first line — what comes under it must not be read as going on with it.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const open = (raw) => A.document.open({ text: raw, raw, links: {}, vault: false });
const shape = (n) => {
  const o = { t: n.type.name };
  for (const k of ["deco", "callout", "level", "start", "kind"]) if (n.attrs && n.attrs[k] != null && n.attrs[k] !== "") o[k] = n.attrs[k];
  if (n.isTextblock) o.text = n.textContent; else if (n.childCount) { o.c = []; n.forEach((c) => o.c.push(shape(c))); }
  return o;
};
const tree = (raw) => { const k = []; open(raw).doc.forEach((n) => { if (!(n.type.name === "island" && n.attrs.virtual)) k.push(shape(n)); }); return k; };
// Tab on the whole note: it moves in, as a quote marked [!indent]
function indented(raw) {
  const d = open(raw);
  const r = A.edit.indentPlain(PM.state.EditorState.create({ doc: d.doc }), 0, d.doc.content.size);
  return A.document.serialize(d, r.tr.doc, false);
}
const inQuote = (raw) => [{ t: "blockquote", deco: "indent", c: tree(raw) }];

// Review of 2026-11-17: these were read back as something else once moved in.
for (const [what, raw] of [["a heading underlined", "Title\n=====\n"], ["a list from 3", "3. three\n4. four\n"], ["a list whose first item is empty", "-\n- b\n"], ["code by indentation", "    code\n"]]) {
  test(`${what}, moved in by Tab, is read back as it was`, () => {
    const out = indented(raw);
    assert.deepEqual(plain(tree(out)), plain(inQuote(raw)), out);
  });
}

test("what goes on from the marker's line as before stands right under it", () => {
  assert.equal(indented("Some text\n"), "> [!indent]\n> Some text\n");
  assert.equal(indented("- one\n- two\n"), "> [!indent]\n> - one\n> - two\n");
  assert.equal(indented("| a | b |\n|---|---|\n| 1 | 2 |\n"), "> [!indent]\n> | a | b |\n> |---|---|\n> | 1 | 2 |\n");
});

function plain(v) { return JSON.parse(JSON.stringify(v)); }
