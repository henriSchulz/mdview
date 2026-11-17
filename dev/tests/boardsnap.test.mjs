// What is taken back on a board (board/select.js snapshot/restore): a stroke as it was — its points and what they hold
// (review 2026-11-17: Improve drew a pencil's stroke anew with four channels; Undo put back six points under "xypt", and
// its tilt was lost for good).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("a stroke taken back is its points with the channels they hold", () => {
  const w = { Math, JSON, String, Number, Object, Array, Map, Set, Error, Infinity, document: { createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {}, setAttribute() {} }) } };
  w.window = w;
  vm.createContext(w);
  for (const f of ["board/format.js", "board/render.js", "board/shape.js", "board/items.js", "board/select.js"]) vm.runInContext(readFileSync(new URL("../../" + f, import.meta.url), "utf8"), w, { filename: f });
  const pencil = { id: "aaaaaaa1", k: "ink", t: "pencil", c: "auto", o: 0.9, w: 2.5, ch: "xyptia", pts: [[0, 0, 0.5, 0, 30, -120], [10, 2, 0.6, 8, 31, -119]] };
  const st = { model: { items: [pencil] }, pick: [], view: { z: 1 } };
  const sel = w.MdBoard.select.make({ S: () => st, T: (k) => k, esc: (s) => s, el: () => null, paint() {}, did() {} });
  const before = sel.snapshot();
  // (Improve draws it anew: its points made by the pen's machinery, with four channels)
  pencil.pts = [[0, 0, 0.5, 0], [10, 2, 0.6, 8]];
  pencil.ch = "xypt";
  sel.restore(before);
  assert.equal(pencil.ch, "xyptia", "taken back with the channels of the stroke drawn anew");
  assert.equal(pencil.pts[0].length, 6);
});
