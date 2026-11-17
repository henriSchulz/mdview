// A whiteboard's hands (board/pointer.js): fingers, a pen and the palm beside it, as made-up pointer events on a stage of
// its own (review 2026-11-17: a palm lifted after a pen's dot undid the stroke; a third finger made a pinch jump).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function hands() {
  const w = { MdBoard: {}, performance, setTimeout, clearTimeout, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, matchMedia: () => ({ matches: false }) };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(readFileSync(new URL("../../board/pointer.js", import.meta.url), "utf8"), w);
  const on = {}, stage = { on: {}, dataset: {}, addEventListener(t, f) { this.on[t] = f; }, setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }) };
  const said = [];
  for (const k of ["start", "move", "end", "cancel", "pan", "zoom", "hover", "tap", "menu", "taps", "space", "twisting", "twisted"]) on[k] = (...a) => { said.push([k, ...a]); return k === "space" ? false : k === "start" ? true : undefined; };
  w.MdBoard.pointer.attach(stage, on);
  const ev = (type, id, kind, x, y, t) => stage.on[type]({ type, pointerId: id, pointerType: kind, clientX: x, clientY: y, timeStamp: t, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: 0.5, isPrimary: true, cancelable: true, target: { closest: () => null }, preventDefault() {}, stopPropagation() {} });
  return { ev, said };
}

test("a palm that lifts after a pen's dot does not take the stroke back", () => {
  const { ev, said } = hands();
  ev("pointerdown", 1, "touch", 100, 100, 0); // (the hand comes down)
  ev("pointerdown", 2, "touch", 140, 110, 5);
  ev("pointerdown", 9, "pen", 400, 300, 20); // (a dot with the pen)
  ev("pointerup", 9, "pen", 400, 300, 40);
  ev("pointerup", 1, "touch", 100, 100, 200); // (the hand lifts, within the time a tap takes)
  ev("pointerup", 2, "touch", 140, 110, 210);
  assert.deepEqual(said.filter(([k]) => k === "taps"), [], "the palm was a two-finger tap: the stroke was undone");
});

test("two fingers left of three go on pinching from where they are", () => {
  const { ev, said } = hands();
  ev("pointerdown", 1, "touch", 100, 100, 0);
  ev("pointerdown", 2, "touch", 300, 100, 5); // (a pinch)
  ev("pointerdown", 3, "touch", 600, 500, 10); // (a third finger: not one of it)
  ev("pointerup", 1, "touch", 100, 100, 50); // (the first lifts: two are left)
  said.length = 0;
  ev("pointermove", 3, "touch", 600, 500, 60); // (and none of them has moved)
  const pans = said.filter(([k]) => k === "pan");
  assert.ok(pans.every(([, dx, dy]) => Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9), "the board jumped: " + JSON.stringify(pans));
  const zooms = said.filter(([k]) => k === "zoom");
  assert.ok(zooms.every(([, f]) => Math.abs(f - 1) < 1e-9), "the board grew: " + JSON.stringify(zooms));
});
