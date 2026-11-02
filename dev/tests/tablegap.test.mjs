// The place between two blocks is only between blocks: never inside a table — not between two
// cells of a row, not between two rows (#17: Henri, moving with the arrows through a table,
// met the editor's short insert line there).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { GapCursor } = PM.gapcursor;

const open = (text) => A.document.open({ text, raw: text, links: {}, vault: false }).doc;
// every position where the editor's own caret between blocks may stand -> [{ pos, in }]
function gaps(doc) {
  const out = [];
  for (let p = 0; p <= doc.content.size; p++) {
    const $p = doc.resolve(p);
    if (GapCursor.valid($p)) out.push({ pos: p, in: $p.parent.type.name });
  }
  return out;
}

test("no insert line inside a table", () => {
  const doc = open("Text\n\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nmore\n");
  const inTable = gaps(doc).filter((g) => /^table/.test(g.in));
  assert.deepEqual(inTable, [], "places between cells or rows: " + JSON.stringify(inTable));
});

test("between two blocks it is still there", () => {
  const doc = open("| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n| c | d |\n|---|---|\n| 3 | 4 |\n");
  assert.ok(gaps(doc).some((g) => g.in === "doc"), "between a table and a rule");
});
