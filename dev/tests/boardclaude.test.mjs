// A whiteboard drawn on by Claude (board/claude.js): what it is told of the board, its answer read as it comes in pieces,
// a path made a stroke, and each step done on the board — added, changed, moved, taken away, with names it gave itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
function load() {
  const w = { Math, JSON, String, Number, Object, Array, Map, Set, Error, Infinity };
  w.window = w;
  vm.createContext(w);
  for (const f of ["board/format.js", "board/render.js", "board/shape.js", "board/items.js", "board/ink.js", "vendor/hershey.js", "board/claude.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), w, { filename: f });
  return w.MdBoard;
}
const B = load(), C = B.claude;
const plain = (v) => JSON.parse(JSON.stringify(v));
const board = () => B.format.fresh();

test("the answer is read as it comes: a step is done once its line is whole, the words around the block are what is said", () => {
  const r = C.reader(), answer = 'A house.\n<board>\n{"add":"shape","shape":"rect","x":0,"y":0,"w":100,"h":80}\n{"add":"ink","d":"M 0 0 L 50 -40 L 100 0"}\nnot a step\n{"del":"x"}</board>\nDone.';
  const got = [];
  for (let i = 0; i < answer.length; i += 7) got.push(...r.feed(answer.slice(i, i + 7)).map((s) => Object.keys(s)[0] + ":" + Object.values(s)[0]));
  got.push(...r.end());
  assert.deepEqual(got, ["add:shape", "add:ink", "del:x"]);
  assert.equal(r.bad, 1);
  assert.equal(C.words(answer), "A house.\n\nDone.");
  assert.equal(C.words('Drawing…\n<board>\n{"add":"ink"'), "Drawing…", "a block still being written is not said");
});

test("a path is points along it: lines, curves, relative steps, several strokes", () => {
  const [line] = plain(C.flatten("M 0 0 L 10 0", 2));
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line.at(-1), [10, 0]);
  assert.equal(line.length, 6);
  const [curve] = plain(C.flatten("M0,0 C 0,100 100,100 100,0"));
  assert.ok(curve.length > 20);
  assert.ok(Math.abs(Math.max(...curve.map((p) => p[1])) - 75) < 1, "the curve's top at three quarters of its controls");
  const rel = plain(C.flatten("m 10 10 h 20 v 20 z m 100 0 l 5 5"));
  assert.equal(rel.length, 2, "two strokes");
  assert.deepEqual(rel[0].at(-1), [10, 10], "Z goes back to the start");
  assert.deepEqual(rel[1][0], [110, 10]);
  assert.deepEqual(plain(C.flatten("nonsense")), []);
});

test("steps done on the board: things added as the file has them, a stroke from a path, names used by later steps, set, move, delete", () => {
  const m = board(), names = new Map();
  const a = C.apply(m, { add: "sticky", as: "idea", x: 10, y: 20, text: "Idea" }, names);
  assert.equal(a.added[0].k, "sticky");
  assert.deepEqual([a.added[0].w, a.added[0].h, a.added[0].text], [180, 180, "Idea"], "what was not given is as a new one is");
  const s = C.apply(m, { add: "shape", shape: "ellipse", as: "c", x: 300, y: 0, w: 100, h: 100 }, names).added[0];
  assert.deepEqual([s.fill, s.stroke.c], ["none", "auto"], "a shape Claude draws is an outline unless it fills it");
  const l = C.apply(m, { add: "line", p: [190, 110, 300, 50], arrow: true, from: { id: "idea" }, to: { id: "c" } }, names).added[0];
  assert.deepEqual(plain([l.ends, l.from.id, l.to.id]), [["none", "arrow"], a.added[0].id, s.id], "the arrow joins what it was named to");
  const ink = C.apply(m, { add: "ink", tool: "marker", c: "#E5372C", d: "M 0 0 C 10 10 20 10 30 0 M 50 0 L 60 0" }, names).added;
  assert.equal(ink.length, 2, "a path of two parts is two strokes");
  assert.deepEqual([ink[0].t, ink[0].c, ink[0].o], ["marker", "#e5372c", 0.4]);
  assert.ok(ink[0].pts.every((p) => p.length === 4 && p[2] > 0 && p[2] <= 1), "each point with a pressure and a time");
  assert.ok(ink[0].pts.at(-1)[3] > ink[0].pts[0][3], "time goes on along the stroke");
  assert.equal(m.items.length, 5);
  // (the file takes it as it is)
  assert.equal(B.format.parse(B.format.write(m)).items.length, 5);
  C.apply(m, { set: "idea", text: "Better", size: 24, fill: "#bfe8b0" }, names);
  const st = m.items.find((it) => it.id === a.added[0].id);
  assert.deepEqual([st.text, st.ts.size, st.fill, st.ts.align], ["Better", 24, "#bfe8b0", "center"], "set changes only what it names");
  C.apply(m, { move: ink[1].id, dx: 10, dy: -5 }, names);
  assert.deepEqual(plain(ink[1].pts[0].slice(0, 2)), [60, -5]);
  C.apply(m, { set: ink[1].id, c: "#1f6fe5", w: 6 }, names);
  assert.deepEqual([ink[1].c, ink[1].w], ["#1f6fe5", 6]);
  assert.ok(C.apply(m, { del: "c" }, names));
  assert.equal(m.items.length, 4);
  assert.equal(C.apply(m, { del: "nothing" }, names), null, "a thing that is not there: nothing done");
  assert.equal(C.apply(m, { add: "rocket", x: 0, y: 0 }, names), null, "a kind the board has not: nothing done");
  assert.equal(C.apply(m, { set: "idea", x: Number.NaN, text: 5 }, names).changed.length, 1, "values that cannot be are left as they were");
  assert.deepEqual([st.text, st.x], ["Better", 10]);
});

test("what Claude is told: where the window looks, the PDF's pages, each thing as its line, a stroke by its box, what is chosen", () => {
  const m = board(), names = new Map();
  C.apply(m, { add: "text", x: 0, y: 0, text: "Title" }, names);
  const [ink] = C.apply(m, { add: "ink", d: "M 10 10 L 110 60" }, names).added;
  const said = C.describe(m, { view: [-100, -50, 800, 600], pages: [{ n: 1, x: -408, y: 0, w: 816, h: 1056 }], pick: [ink.id] });
  assert.match(said, /x -100 to 700, y -50 to 550/);
  assert.match(said, /page 1: -408, 0, 816, 1056/);
  assert.match(said, /"k":"text".*"text":"Title"/);
  const line = JSON.parse(said.split("\n").find((l) => l.includes('"k":"ink"')));
  assert.deepEqual([line.tool, line.box.map(Math.round)], ["pen", [8, 8, 105, 55]], "the box around the points and the stroke's width");
  assert.ok(!("pts" in line), "a stroke's points are not told");
  assert.match(said, new RegExp(`Chosen by the user right now.*${ink.id}`));
  assert.match(C.describe(board()), /The board is empty/);
});

test("words written by hand: strokes of the font's letters, one group, umlauts with their dots, lines broken at maxw; set, move, delete the whole", () => {
  const m = board(), names = new Map();
  const got = C.apply(m, { add: "write", as: "t", x: 100, y: 50, text: "Hallo Welt", size: 21 }, names).added;
  assert.ok(got.length > 10, "a stroke for each part of each letter");
  const g = got[0].group;
  assert.ok(g && got.every((it) => it.k === "ink" && it.group === g), "all of them one group");
  assert.equal(names.get("t"), g, "its name is the group's");
  const box = got.map((it) => B.format.boundsOf(it)).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
  assert.ok(box[0] > 95 && box[0] < 110 && box[1] > 45 && box[1] < 60 && box[3] < 80, "where it was put, a line high: " + box.map(Math.round));
  assert.ok(box[2] - box[0] > 21 * 0.75 * 10 * 0.75 && box[2] - box[0] < 21 * 0.75 * 10 * 1.3, "about 0.75 × size a letter: " + Math.round(box[2] - box[0]));
  // (the group is one thing in the file, too)
  assert.equal(new Set(B.format.parse(B.format.write(m)).items.map((it) => it.group)).size, 1);
  const n = (text) => C.write({ x: 0, y: 0, text, size: 21 }).length;
  assert.equal(n("ä"), n("a") + 2, "ä: an a and two dots");
  assert.ok(n("ß") >= 1 && n("“ok”…") > n("ok"), "ß and the typographer's signs are written too");
  const wrapped = C.write({ x: 0, y: 0, text: "one two three four five six", size: 20, maxw: 120 });
  const bottom = Math.max(...wrapped.map((it) => B.format.boundsOf(it)[3]));
  assert.ok(bottom > 60, "broken into lines at maxw: " + Math.round(bottom));
  const said = C.describe(m);
  assert.match(said, new RegExp(`"id":"${g}","k":"ink","strokes":${got.length}.*"text":"Hallo Welt"`), "told as one line, with what it says");
  const x = got.map((it) => it.pts[0][0]);
  C.apply(m, { move: "t", dx: 10, dy: 0 }, names);
  assert.ok(got.every((it, i) => Math.abs(it.pts[0][0] - x[i] - 10) < 0.2), "move: every stroke of it");
  C.apply(m, { set: g, c: "#e5372c" }, names);
  assert.ok(m.items.every((it) => it.c === "#e5372c"), "set: every stroke of it");
  C.apply(m, { del: g }, names);
  assert.equal(m.items.length, 0, "del: all of it");
});
