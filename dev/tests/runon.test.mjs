// What a block takes in from below it (active/document.js serialize): a list's last item and a footnote's definition
// take an indented line as their own, a comment not closed takes the rest of the file. Blocks brought together under
// them in the active mode stay blocks of their own when the note is read again.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;

const open = (raw) => A.document.open({ text: raw, raw, links: {}, vault: false });
const kinds = (raw) => { const k = []; open(raw).doc.forEach((n) => { if (!(n.type.name === "island" && n.attrs.virtual)) k.push(n.type.name === "island" ? "island:" + n.attrs.kind : n.type.name); }); return k; };
// the note with the block that holds `needle` deleted
function without(raw, needle) {
  const d = open(raw);
  let from = -1, to = -1;
  d.doc.forEach((n, pos) => { if (from < 0 && n.textContent.includes(needle)) { from = pos; to = pos + n.nodeSize; } });
  assert.ok(from >= 0, "not in the note: " + needle);
  return A.document.serialize(d, d.doc.replace(from, to, PM.model.Slice.empty), false);
}
function below(raw, text) {
  const d = open(raw);
  const p = d.doc.type.schema.nodes.paragraph.create(null, d.doc.type.schema.text(text));
  return A.document.serialize(d, d.doc.replace(d.doc.content.size, d.doc.content.size, new PM.model.Slice(PM.model.Fragment.from(p), 0, 0)), false);
}

// Review of 2026-11-17: the paragraph between a list and indented code deleted, the code became the item's.
test("indented code brought under a list stays code", () => {
  const out = without("- first item\n\nA paragraph between.\n\n    indented code\n    more code\n", "between");
  assert.deepEqual(kinds(out), ["bullet_list", "island:code"], out);
  assert.match(out, /indented code\nmore code/);
});

test("indented code brought under a footnote's definition stays code", () => {
  const out = without("Text[^1]\n\n[^1]: The note.\n\nBetween\n\n    code line\n", "Between");
  assert.deepEqual(kinds(out).filter((k) => k !== "island:footnotes"), ["paragraph", "hidden", "island:code"], out);
});

test("a list and code that stood apart by a comment stand as they stood", () => {
  const raw = "- first item\n\n%% end of the list %%\n\n    indented code\n\nAnd a paragraph.\n";
  assert.equal(without(raw, "And a paragraph"), "- first item\n\n%% end of the list %%\n\n    indented code\n");
});

test("a paragraph written below a comment that is not closed stays a paragraph", () => {
  const out = below("Text\n\n<!-- open comment\nmore\n", "New words");
  assert.deepEqual(kinds(out), ["paragraph", "island:html", "paragraph"], out);
});
