// A whiteboard's view (board/view.js): a board of pages — a notebook, a PDF — keeps its pages in sight as GoodNotes' notebooks
// do (Henri, 2026-11-19: "nicht intuitiv … das verschieben des notizbuches, das ist man ganz noch außerhalb des bildes"):
// pulled beyond an edge it gives way less and less and goes back when let go; never smaller than a page whole in the window;
// a size let go near the page's width becomes it. An endless board has no edges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load() {
  const w = { Math, JSON, Number, Array, Object, matchMedia: () => ({ matches: true }), requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, performance: { now: () => 0 } };
  w.window = w;
  vm.runInNewContext(readFileSync(new URL("../../board/view.js", import.meta.url), "utf8"), w);
  return w.MdBoard.view;
}
const W = 1180, H = 820;
// a notebook of three A4 pages as board/pdf.js lays them, the bars as the board measures them
const PW = 793.7, PH = 1122.5, GAP = 16, pages = [0, 1, 2].map((i) => ({ x: -PW / 2, y: i * (PH + GAP), w: PW, h: PH }));
const room = { top: 56, bottom: 12, left: 12, right: 109 };
const across = (W - room.left - room.right) / PW, whole = (H - room.top - room.bottom) / PH;
function book() {
  const V = load(), v = V.make(() => ({ w: W, h: H }), () => {});
  v.max = 16;
  v.limit = () => ({ box: [-PW / 2, 0, PW / 2, pages[2].y + PH + 168], ...room, least: Math.min(across, whole), sizes: [across, whole] });
  v.set(-PW / 2 - room.left / across, -room.top / across, across); // (opened: the first page across the room, its top under the bars)
  return v;
}
const screenTop = (v) => (0 - v.y) * v.z; // the first page's top in the window

test("pulled down past the first page, it gives way less and less, and goes back when let go", () => {
  const v = book();
  assert.equal(Math.round(screenTop(v)), room.top);
  v.panBy(0, 300);
  const a = screenTop(v) - room.top;
  v.panBy(0, 300);
  const b = screenTop(v) - room.top;
  assert.ok(a > 60 && a < 300, `the first 300 px gave ${a}`);
  assert.ok(b - a < a, `the next 300 gave ${b - a}, not less than ${a}`);
  assert.ok(b < H, "pulled the window's height away");
  assert.ok(v.bent());
  v.settle(true);
  assert.equal(Math.round(screenTop(v)), room.top);
  assert.ok(!v.bent());
});

test("at the page's width it does not go sideways for good, and the last page stops above the foot", () => {
  const v = book(), x = v.x;
  v.panBy(-400, 0);
  assert.notEqual(v.x, x);
  v.settle(true);
  assert.ok(Math.abs(v.x - x) * v.z < 0.5, "sideways after it was let go");
  v.panBy(0, -1e6);
  v.settle(true);
  const foot = (pages[2].y + PH + 168 - v.y) * v.z;
  assert.ok(Math.abs(foot - (H - room.bottom)) < 0.5, `the end stands at ${foot}, not at the foot ${H - room.bottom}`);
});

test("pinched smaller than a page whole, it gives way and comes back to the page whole; let go near the width, it is the width", () => {
  const v = book(), least = Math.min(across, whole);
  v.zoomAt(W / 2, H / 2, v.z * 0.2);
  assert.ok(v.z < least && v.z > least * 0.5, `pinched to ${v.z}`);
  v.settle(true);
  assert.ok(Math.abs(v.z - least) < 1e-9);
  v.zoomAt(W / 2, H / 2, across * 1.06);
  v.settle(true);
  assert.ok(Math.abs(v.z - across) < 1e-9, `let go at 1.06 × the width: ${v.z}`);
  v.zoomAt(W / 2, H / 2, across * 1.5);
  v.settle(true);
  assert.ok(Math.abs(v.z - across * 1.5) < 1e-9, "a size well away from the width is kept");
});

test("zoomed in, the page can be moved to its edges and no further", () => {
  const v = book();
  v.zoomAt(W / 2, H / 2, across * 2);
  v.settle(true);
  v.panBy(1e5, 0);
  v.settle(true);
  assert.ok(Math.abs((-PW / 2 - v.x) * v.z - room.left) < 0.5, "the page's left edge is not at the room's left");
  v.panBy(-1e5, 0);
  v.settle(true);
  assert.ok(Math.abs((PW / 2 - v.x) * v.z - (W - room.right)) < 0.5, "the page's right edge is not at the room's right");
});

test("an endless board has no edges", () => {
  const V = load(), v = V.make(() => ({ w: W, h: H }), () => {});
  v.set(0, 0, 1);
  v.panBy(5000, 5000);
  assert.equal(v.x, -5000);
  assert.ok(!v.bent());
});
