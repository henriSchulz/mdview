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
  for (const f of ["board/format.js", "board/render.js", "board/shape.js", "board/items.js", "board/ink.js", "vendor/hershey.js", "board/hand.js", "board/glyphs.js", "board/claude.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), w, { filename: f });
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
  const was = plain(ink[1].pts[0].slice(0, 2));
  C.apply(m, { move: ink[1].id, dx: 10, dy: -5 }, names);
  assert.ok(Math.abs(ink[1].pts[0][0] - was[0] - 10) < 0.15 && Math.abs(ink[1].pts[0][1] - was[1] + 5) < 0.15, "moved by dx, dy");
  assert.ok(Math.abs(was[0] - 50) < 0.4 && Math.abs(was[1]) < 0.4, "a stroke begins where its path does (a pen's tremor aside): " + was);
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
  assert.equal(line.tool, "pen");
  assert.ok([8, 8, 105, 55].every((v, i) => Math.abs(line.box[i] - v) <= 2), "the box around the points and the stroke's width (as a pen leaves it): " + line.box);
  assert.ok(!("pts" in line), "a stroke's points are not told");
  assert.match(said, new RegExp(`Chosen by the user right now.*${ink.id}`));
  assert.match(C.describe(board()), /The board is empty/);
});

test("words written by hand: strokes of the font's letters, each its own (chosen one by one), all of one writing; umlauts with their dots, lines broken at maxw; set, move, delete the whole by its id", () => {
  const m = board(), names = new Map();
  const got = C.apply(m, { add: "write", as: "t", x: 100, y: 50, text: "Hallo Welt", size: 21 }, names).added;
  assert.ok(got.length > 10, "a stroke for each part of each letter");
  const g = got[0].of;
  assert.ok(g && got.every((it) => it.k === "ink" && it.of === g && !it.group), "all of one writing, none in a group: chosen stroke by stroke (Henri, 2026-11-02)");
  assert.equal(names.get("t"), g, "its name is the writing's");
  const box = got.map((it) => B.format.boundsOf(it)).reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
  assert.ok(box[0] > 92 && box[0] < 112 && box[1] > 38 && box[1] < 62 && box[3] < 84, "where it was put, a line high (as a hand puts it): " + box.map(Math.round));
  assert.ok(box[2] - box[0] > 21 * 10 * 0.45 && box[2] - box[0] < 21 * 10 * 0.8, "about 0.6 × size a letter: " + Math.round(box[2] - box[0]));
  // (the file keeps which writing a stroke is part of)
  assert.deepEqual([...new Set(B.format.parse(B.format.write(m)).items.map((it) => it.of))], [g]);
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

test("handwriting never writes a \"?\" for a sign it has not: accents are letters with their marks, arrows and signs are drawn, raised digits small, an emoji left out (Henri, 2026-11-02: so many question marks)", () => {
  const n = (text) => C.write({ x: 0, y: 0, text, size: 21 }).length;
  const shape = (ch) => JSON.stringify(plain(C.letter(ch).runs)), q = shape("?");
  for (const ch of "→←↑↓↔⇒✓✗°≈≠≤≥±÷√∞•€²³éñçå") assert.ok(C.letter(ch).runs.length >= 1 && shape(ch) !== q, ch + " is written, and is no question mark");
  assert.equal(n("é"), n("e") + 1, "é: an e and its mark");
  assert.equal(n("ç"), n("c") + 1, "ç: a c and its cedilla");
  assert.equal(n("í"), n("i"), "í: an i without its dot, and its mark");
  assert.equal(n("😀"), 0, "an emoji: nothing — and no question mark");
  assert.equal(n("a 😀 b"), n("ab"), "… around it, the words as they are");
});

// #33: what Claude takes away goes in one step — a list of ids, or a group of strokes by one name — not stroke by stroke
test("taken away at once: a del of several ids, and the strokes of one step are one group (told once, gone with one del)", () => {
  const m = board(), names = new Map();
  for (const [as, x] of [["a", 0], ["b", 200], ["c", 400]]) C.apply(m, { add: "shape", shape: "rect", as, x, y: 0, w: 100, h: 80 }, names);
  const got = C.apply(m, { del: ["a", "c"] }, names);
  assert.equal(got.removed.length, 2);
  assert.deepEqual(plain(m.items.map((it) => it.k)), ["shape"]);
  // a word Claude wrote itself: one ink step of several strokes — one thing to it
  const word = C.apply(m, { add: "ink", as: "w", d: "M 0 200 L 10 230 L 20 200 M 30 200 L 30 230 M 40 200 C 50 190, 60 210, 70 200" }, names);
  assert.equal(word.added.length, 3);
  assert.equal(new Set(word.added.map((it) => it.of)).size, 1, "the strokes share one group");
  const told = C.describe(m).split("\n").filter((l) => l.includes('"k":"ink"'));
  assert.equal(told.length, 1, "told as one");
  assert.match(told[0], /"strokes":3/);
  assert.equal(C.apply(m, { del: "w" }, names).removed.length, 3, "one del takes all of it");
  assert.equal(m.items.filter((it) => it.k === "ink").length, 0);
  // a single stroke stays a stroke of its own
  const one = C.apply(m, { add: "ink", d: "M 0 0 L 50 50" }, names);
  assert.equal(one.added[0].of, undefined);
});

// #32: a notebook is told that it grows — a long study sheet is written on, page after page
test("a notebook is told to Claude as one that grows: what goes on below the last page gets pages", () => {
  const told = C.describe(board(), { pages: [{ n: 1, x: -397, y: 0, w: 794, h: 1123 }], paper: { bg: "grid", color: "white", size: "a4", n: 1 } });
  assert.match(told, /notebook of 1 page/);
  assert.match(told, /below the last page gets pages of its own/);
});

// Improve: strokes chosen, made a little neater — told to Claude alone, from the box round them; its steps done on them only.
test("Improve: the strokes chosen are told from the box round them, smoothed with their ends kept", () => {
  const ink = (id, pts, o = {}) => ({ id, k: "ink", t: "pen", c: "#e5372c", w: 3, o: 1, ch: "xypt", pts: pts.map(([x, y], i) => [x, y, 0.5, i * 10]), ...o });
  const a = ink("a", [[100, 200], [110, 204], [120, 198], [130, 203], [140, 200]]), b = ink("b", [[150, 190], [150, 230]]);
  const told = C.tellPick([a, b]);
  assert.deepEqual(plain(told.origin), [B.format.boundsOf(a)[0], B.format.boundsOf(b)[1]], "from the box round them all");
  const lines = told.text.split("\n").slice(1).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.id), ["a", "b"], "in the order they were drawn");
  assert.match(lines[1].d, /^M\d+ \d+ L\d+ \d+$/, "a path in whole pixels");
  assert.ok(lines.every((l) => l.box[0] >= 0 && l.box[1] >= 0), "from the box's top left");
  const sm = C.smooth(a.pts, 2);
  assert.ok(sm.every((p, i) => Math.hypot(p[0] - a.pts[i][0], p[1] - a.pts[i][1]) <= 2 + 0.1), "never farther than it may go: a letter's corners stay");
  assert.deepEqual(plain(sm[0]), plain(a.pts[0]));
  assert.deepEqual(plain(sm.at(-1)), plain(a.pts.at(-1)), "the ends stay");
  assert.ok(Math.abs(sm[2][1] - 200) < Math.abs(a.pts[2][1] - 200) + 1e-9 && sm[1][1] < a.pts[1][1], "the tremble smoothed");
  assert.deepEqual(plain(sm.map((p) => p.slice(2))), plain(a.pts.map((p) => p.slice(2))), "pressure and time kept");
});

test("Improve: fit and redraw change only the strokes chosen, and keep their pen, colour and width", () => {
  const m = board();
  const ink = (id, pts) => ({ id, k: "ink", t: "pencil", c: "#1f6fe5", w: 4, o: 1, ch: "xypt", pts: pts.map(([x, y], i) => [x, y, 0.5, i * 10]) });
  m.items.push(ink("a", [[0, 0], [10, 0]]), ink("b", [[0, 20], [10, 22]]), ink("c", [[50, 50], [60, 60]]), ink("other", [[300, 300], [310, 310]]));
  const ids = new Set(["a", "b", "c"]), origin = [0, 0];
  const fit = C.refine(m, { fit: "a", dy: 3 }, ids, origin);
  assert.deepEqual(plain(fit.changed.map((it) => it.pts.map((p) => p[1]))), [[3, 3]]);
  assert.equal(C.refine(m, { fit: "other", dy: 3 }, ids, origin), null, "a stroke not chosen is left alone");
  assert.equal(C.refine(m, { fit: "a", dy: 9999 }, ids, origin).changed[0].pts[0][1], 403, "moves are kept small");
  const two = C.refine(m, { fit: ["a", "b"], rotate: 90 }, ids, origin);
  assert.equal(two.changed.length, 2, "several turned as one");
  const re = C.refine(m, { redraw: "b", d: "M 0 0 L 20 0" }, ids, [100, 50]);
  const b = re.changed[0];
  assert.equal(b.id, "b");
  assert.deepEqual([b.t, b.c, b.w], ["pencil", "#1f6fe5", 4], "its pen, colour and width");
  assert.deepEqual(plain([b.pts[0].slice(0, 2), b.pts.at(-1).slice(0, 2)]), [[100, 50], [120, 50]], "the path from the box's top left");
  const join = C.refine(m, { redraw: ["a", "c"], d: "M 0 0 L 30 0" }, ids, origin);
  assert.deepEqual(plain([join.changed.map((it) => it.id), join.removed.map((it) => it.id)]), [["a"], ["c"]], "fewer parts than strokes: the rest go");
  assert.ok(!m.items.some((it) => it.id === "c"));
  const split = C.refine(m, { redraw: "a", d: "M 0 0 L 5 0 M 10 0 L 15 0" }, ids, origin);
  assert.equal(split.added.length, 1);
  assert.deepEqual([split.added[0].t, split.added[0].c], ["pencil", "#1f6fe5"], "more parts: strokes of their own, in its look");
  assert.equal(C.refine(m, { del: ["other", "b"] }, ids, origin).removed.map((it) => it.id).join(), "b", "only what was chosen is taken away");
  assert.ok(m.items.some((it) => it.id === "other"));
});

test("Improve: a line of handwriting set straight, its letters the user's own — on one baseline, of even heights and slant", () => {
  const m = board();
  const ink = (id, pts) => ({ id, k: "ink", t: "pen", c: "#1f6fe5", w: 3, o: 1, ch: "xypt", pts: pts.map(([x, y], i) => [x, y, 0.5, i * 10]) });
  // "llo": an l that leans and stands high, one upright and tall, an o that sits low; and a stroke not chosen
  const circle = (cx, cy, r) => Array.from({ length: 25 }, (_, i) => [cx + Math.cos((i / 24) * Math.PI * 2) * r, cy + Math.sin((i / 24) * Math.PI * 2) * r]);
  m.items.push(ink("l1", [[0, 0], [10, 20], [20, 40], [30, 60], [40, 80]]), ink("l2", [[60, -10], [60, 40], [60, 100]]), ink("o", circle(100, 90, 20)), ink("other", [[0, 300], [9, 300]]));
  const ids = new Set(["l1", "l2", "o"]);
  const got = C.refine(m, { line: "llo", letters: [["l", ["l1"]], ["l", ["l2", "other"]], ["o", ["o"]]] }, ids, [0, 0]);
  assert.deepEqual(plain(got.changed.map((it) => it.id)), ["l1", "l2", "o"], "only the letters chosen");
  assert.deepEqual(plain(m.items.find((it) => it.id === "other").pts.map((p) => p.slice(0, 2))), [[0, 300], [9, 300]]);
  const b = (id) => { const ps = m.items.find((it) => it.id === id).pts; return [Math.min(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[1])), Math.max(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[1]))]; };
  const feet = ["l1", "l2", "o"].map((id) => b(id)[3]);
  assert.ok(Math.max(...feet) - Math.min(...feet) < 30 * 0.25, "most of the way to one baseline (their feet 30 apart before): " + feet);
  assert.ok(Math.abs((b("l1")[3] - b("l1")[1]) - (b("l2")[3] - b("l2")[1])) < 12, "the two l about as tall");
  const lean = (id) => { const ps = m.items.find((it) => it.id === id).pts; return (ps.at(-1)[0] - ps[0][0]) / (ps.at(-1)[1] - ps[0][1]); };
  assert.ok(Math.abs(lean("l1") - lean("l2")) < 0.35, "their slant brought together: " + [lean("l1"), lean("l2")]);
  assert.ok(Math.abs(lean("l2") - lean("l1")) > 0.03, "…not all of the way: the hand stays a hand");
  assert.equal(C.refine(m, { line: "x", letters: [["x", ["other"]]] }, ids, [0, 0]), null, "nothing chosen: nothing set");
  const m2 = board();
  m2.items.push(ink("a", circle(20, 90, 10)), ink("sq", [[34, 60], [40, 58], [36, 70], [42, 70]]), ink("b", [[60, 50], [60, 100]]));
  const sq0 = plain(m2.items[1].pts.map((p) => p[1]));
  C.refine(m2, { line: "a²b", letters: [["a", ["a"]], ["²", ["sq"]], ["b", ["b"]]] }, new Set(["a", "sq", "b"]), [0, 0]);
  const sq1 = m2.items.find((it) => it.id === "sq").pts.map((p) => p[1]);
  assert.ok(Math.max(...sq1) < 75 && Math.abs(Math.min(...sq1) - Math.min(...sq0)) < 3, "an exponent keeps its height: " + [Math.min(...sq1), Math.max(...sq1)]);
});

test("#37: the signs of a formula and the Greek letters are written — none left out as a gap", () => {
  const missing = [..."−·×∈∉∀∃∫∑∏∂∇αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩ⊂⊆∪∩∧∨¬≡∝ℝℕℤℚℂ½⁻¹₀₁₂₃ₙᵢ"].filter((ch) => !C.letter(ch).runs.length);
  assert.deepEqual(missing, []);
  const made = C.write({ text: "a − b ∈ ℝ, α ≡ π", x: 0, y: 0, size: 28 });
  assert.ok(made.length >= 14, "every sign drawn: " + made.length);
});

test("#36: a formula is written as a hand sets it — a fraction over its bar, exponents raised — never as typed (1/(5z^4), z^5)", () => {
  // a fraction: its numerator above a bar, its denominator below it
  const f = C.formula("\\frac{1}{5z^4}");
  const bar = f.runs.find((r) => r.length === 2 && Math.abs(r[0][1] - r[1][1]) < 0.01 && r[1][0] - r[0][0] > 15);
  assert.ok(bar, "a bar");
  const above = f.runs.filter((r) => r !== bar && Math.max(...r.map((p) => p[1])) < bar[0][1]), below = f.runs.filter((r) => r !== bar && Math.min(...r.map((p) => p[1])) > bar[0][1]);
  assert.ok(above.length >= 1 && below.length >= 3, "1 above the bar, 5z⁴ below it: " + [above.length, below.length]);
  // an exponent raised: written in plain words, or in a formula — the ^ is never a sign of its own
  assert.deepEqual(plain(C.units("z^4 und a_1").map((u) => u.ch ?? "$" + u.tex)), ["z", "$^{4}", " ", "u", "n", "d", " ", "a", "$_{1}"]);
  assert.deepEqual(plain(C.units("da $z^5 = 1$").map((u) => u.ch ?? "$" + u.tex)), ["d", "a", " ", "$z^5 = 1"]);
  const n = C.formula("z").runs.length, z = C.formula("z^5"), ys = (r) => r.map((p) => p[1]), zb = Math.max(...z.runs.slice(0, n).flatMap(ys)), five = z.runs.slice(n).flatMap(ys);
  assert.ok(Math.max(...five) < zb - 4, "the 5 stands raised over the z's line");
  // a line with a fraction stands taller: the line after it further down
  const one = C.write({ text: "a\nb", x: 0, y: 0, size: 28, mess: 0.3 }), two = C.write({ text: "$\\frac{a}{b}$\nb", x: 0, y: 0, size: 28, mess: 0.3 });
  const low = (made) => Math.max(...made.at(-1).pts.map((p) => p[1]));
  assert.ok(low(two) > low(one) + 10, "room for the fraction: " + [low(one), low(two)]);
  // what follows a long formula stands after it, not in its end (a letter's chance on its width once put it there)
  const m = C.formula("\\frac{e^{2it} - 1}{e^{it} - e^{-it}} = e^{it}").runs.length;
  for (let i = 0; i < 20; i++) {
    const made = C.write({ text: "$\\frac{e^{2it} - 1}{e^{it} - e^{-it}} = e^{it}$, analog", x: 0, y: 0, size: 24, mess: 1.4 });
    // (at the comma's height: a raised exponent leans over it as letters lean, and that is no overlap — Henri's print leans far)
    const comma = made[m].pts, lo = Math.min(...comma.map((p) => p[1])) - 4, hi = Math.max(...comma.map((p) => p[1])) + 4;
    const end = Math.max(...made.slice(0, m).flatMap((it) => it.pts.filter((p) => p[1] >= lo && p[1] <= hi).map((p) => p[0]))), next = Math.min(...made.slice(m).flatMap((it) => it.pts.map((p) => p[0])));
    assert.ok(next > end - 1, "the comma after the formula: " + [end, next]);
  }
});

test("#36: an underline put where a line of words would end goes under the line's fraction, not through it", () => {
  const m = board(), names = new Map();
  C.apply(m, { add: "write", x: 0, y: 0, size: 28, text: "Residuum von $\\frac{1}{z^5 - 1}$" }, names);
  const low = Math.max(...m.items.map((it) => B.format.boundsOf(it)[3]));
  const got = C.apply(m, { add: "ink", d: "M 0 36 L 400 36" }, names), b = B.format.boundsOf(got.added[0]);
  assert.ok(b[1] > low, "under the denominator: " + [b[1], low]);
  const far = C.apply(m, { add: "ink", d: "M 0 200 L 400 200" }, names);
  assert.ok(Math.abs(B.format.boundsOf(far.added[0])[1] - 200) < 4, "a line elsewhere stays where it was drawn");
});

test("#39: a thick stroke whose points lie close is not a row of beads: its breadth is evened out along a stretch of it, not over five points", () => {
  // (a pen's stroke along x, a point every 0.75 px as the hand gives them, its pressure going up and down from one to the next)
  const it = { k: "ink", t: "pen", w: 8, c: "auto", o: 1, ch: "xypt", pts: Array.from({ length: 200 }, (_v, i) => [i * 0.75, 0, i % 2 ? 0.7 : 0.3, i * 6]) };
  const nums = B.render.outline(it).d.match(/-?\d+(\.\d+)?/g).map(Number), edge = [];
  for (let i = 0; i + 1 < nums.length; i += 2) if (nums[i + 1] > 0 && nums[i] > 20 && nums[i] < 130) edge.push(nums[i + 1]); // (its upper edge, away from the ends)
  const most = Math.max(...edge.slice(1).map((y, i) => Math.abs(y - edge[i])));
  assert.ok(edge.length > 50 && most < 0.1, `the edge goes up and down by ${most} px from one point to the next`);
});

test("#39: Claude's words are written as a hand moves: slower where it turns, and heavier where it is slow", () => {
  // (the hand itself, with a style whose pressure follows the speed: Henri's print, set in the Hand Lab, hardly lets it)
  const st = { ...B.hand.styles.hand, heavy: 0.2 }, size = 40, k = size / 21;
  let diff = 0;
  for (let n = 0; n < 3; n++) {
    const runs = [..."Handschrift"].flatMap((ch, i) => C.letter(ch, "hand").runs.map((r) => r.map(([x, y]) => [x * k + i * 30, y * k])));
    const pairs = [];
    for (const run of runs) {
      const p = B.hand.write(run, { size, style: st }), len = p.length;
      for (let i = Math.max(1, Math.floor(len * 0.2)); i < Math.ceil(len * 0.8); i++) { const dt = p[i][3] - p[i - 1][3]; if (dt > 0) pairs.push([Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) / dt, p[i][2]]); }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const q = Math.floor(pairs.length / 4), mean = (a) => a.reduce((x, y) => x + y[1], 0) / a.length;
    diff += (mean(pairs.slice(0, q)) - mean(pairs.slice(-q))) / 3;
  }
  assert.ok(diff > 0.02, `the slowest quarter of the way is heavier than the fastest by ${diff.toFixed(3)} only`);
});

test("#39: \"%\" as Henri passed it in the Hand Lab: its upper ring stands by itself, not joined to the stroke", () => {
  const runs = C.letter("%", "hand").runs, ring = runs.find((r) => r.some(([x, y]) => x < 8 && y < 6));
  assert.equal(runs.length, 3);
  assert.ok(ring && Math.max(...ring.map((p) => p[0])) < 12, `the ring reaches x ${ring && Math.max(...ring.map((p) => p[0]))}`);
});

test("#39: a letter, a formula's sign and a stroke Claude drew go through the one hand (board/hand.js)", () => {
  let calls = 0;
  const own = B.hand.write;
  B.hand.write = (...a) => { calls++; return own(...a); };
  try {
    const m = board();
    C.apply(m, { add: "write", x: 0, y: 0, size: 28, text: "a $\\int_0^1 x\\,dx$" }, new Map());
    const words = calls;
    C.apply(m, { add: "ink", d: "M 0 0 C 40 -30, 80 30, 120 0" }, new Map());
    assert.ok(words >= 6 && calls === words + 1, `the hand wrote ${words} strokes of the words and ${calls - words} of the drawing`);
  } finally { B.hand.write = own; }
});

test("#39: a sum is written taller than the letters, its limits under and over it; an integral tall, its limits at its top and foot; a script of a script still to be read", () => {
  const box = (tex) => { const f = C.formula(tex), ys = f.runs.flat().map((p) => p[1]), xs = f.runs.flat().map((p) => p[0]); return { f, top: Math.min(...ys), bot: Math.max(...ys), x0: Math.min(...xs), x1: Math.max(...xs) }; };
  const a = box("a"), sum = box("\\sum"), lim = box("\\sum_{k=0}^{n}"), int = box("\\int");
  assert.ok((sum.bot - sum.top) > (a.bot - a.top) * 1.3 + 4, `the sum ${sum.bot - sum.top} high, an a ${a.bot - a.top}`);
  assert.ok(int.bot - int.top > 30, `the integral ${int.bot - int.top} high`);
  assert.ok(lim.bot > sum.bot + 3 && lim.top < sum.top - 3, `its limits under and over it: ${[lim.top, lim.bot]} against ${[sum.top, sum.bot]}`);
  const mid = (pts) => (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2, all = lim.f.runs.flat();
  const sign = all.filter((p) => p[1] >= sum.top && p[1] <= sum.bot), under = all.filter((p) => p[1] > sum.bot + 3);
  assert.ok(under.length && Math.abs(mid(under) - mid(sign)) < 4, `the limit under the sum's middle, not beside it: ${[mid(under), mid(sign)]}`);
  // e^{i ω_0 t}: the 0, a script of a script, is more than half the size of a letter's script
  const n = C.formula("e^{x}").runs.length, zero = C.formula("e^{x_0}").runs.slice(n).flat(), high = Math.max(...zero.map((p) => p[1])) - Math.min(...zero.map((p) => p[1]));
  assert.ok(high > 10, `the 0 under the raised x is ${high.toFixed(1)} units high (a letter: 21), not a speck`);
});

test("#40: on a notebook what Claude writes stays on a page — a line that would run into the foot, the gap or the next page's head goes onto the next page, and what follows with it", () => {
  const book = { y: 0, h: 1123, step: 1139 }, m = book.h * 0.045, names = new Map(), mdl = board();
  const out = (y) => { const k = Math.floor(y / book.step), py = k * book.step; return y > py + book.h - m + 2 || y < py + m - 2; }; // (in a page's foot, the gap, or a page's head)
  C.apply(mdl, { add: "write", x: 40, y: 960, size: 24, maxw: 700, text: "Periodisches Signal (Periode T) → Fourier-Reihe, diskrete Frequenzen $k\\omega_0$: so geht es weiter, Zeile um Zeile, bis die Seite voll ist und darüber hinaus" }, names, { book });
  C.apply(mdl, { add: "write", x: 40, y: 1080, size: 24, text: "$f(t) = \\sum_{k=-\\infty}^{\\infty} c_k e^{ik\\omega_0 t}$" }, names, { book }); // (Claude's next line, where it thought the last one ended)
  C.apply(mdl, { add: "shape", shape: "rect", x: 40, y: 1170, w: 200, h: 60 }, names, { book }); // (under that line, as Claude put it)
  const pts = mdl.items.flatMap((it) => (it.k === "ink" ? it.pts.map((p) => p[1]) : [it.y, it.y + it.h]));
  const bad = pts.filter(out);
  assert.equal(bad.length, 0, `${bad.length} points off the pages' writing room, e.g. y ${bad.slice(0, 3).map(Math.round)}`);
  // … and nothing written over what came before it
  const boxes = mdl.items.map((it) => B.format.boundsOf(it)), firsts = boxes.slice(0, -1), last = boxes.at(-1);
  assert.ok(firsts.every((b) => b[3] <= last[1] + 1 || b[1] >= last[3] - 1 || b[2] <= last[0] || b[0] >= last[2]), "the frame lies over no writing");
});

test("#41: a formula's commands are signs, never their names written out — \\oplus is ⊕, \\bar{a} an a with a bar, and every sign they stand for is drawn", () => {
  const SYMS = ["oplus", "otimes", "odot", "ominus", "perp", "parallel", "angle", "emptyset", "varnothing", "supset", "supseteq", "setminus", "mp", "cong", "sim", "simeq", "ll", "gg",
    "star", "ast", "oint", "iint", "aleph", "ell", "hbar", "therefore", "because", "top", "vdash", "models", "Vert", "lfloor", "rfloor", "lceil", "rceil", "dagger", "mapsto", "Leftrightarrow", "Upsilon", "nexists", "complement", "ni"];
  const named = (name) => JSON.stringify(C.formula(name).runs); // (the name, written out as letters)
  const bad = SYMS.filter((c) => { const f = C.formula("\\" + c); return !f.runs.length || JSON.stringify(f.runs) === named(c); });
  assert.deepEqual(bad, [], "written as their names, or not drawn at all");
  for (const acc of ["bar", "overline", "hat", "tilde", "vec", "dot", "ddot", "underline"]) {
    const a = C.formula("a"), m = C.formula(`\\${acc}{a}`);
    assert.ok(m.adv < a.adv + 3 && m.runs.length > a.runs.length, `\\${acc}{a}: an a with its mark (${m.adv} wide, ${m.runs.length} strokes; an a: ${a.adv}, ${a.runs.length})`);
  }
  assert.equal(C.formula("x \\not= y").adv, C.formula("x \\ne y").adv, "\\not= is ≠");
  assert.ok(C.formula("\\|v\\|").adv < C.formula("|v|").adv + 6 && C.formula("\\|v\\|").runs.length > C.formula("|v|").runs.length, "\\| is ‖");
});

test("#42: a heading put where Claude thought the part before it ended goes under that part, and the parts after it with it — text never lies on text", () => {
  const book = { y: 0, h: 1123, step: 1139 }, names = new Map(), mdl = board(), groups = [];
  const put = (step) => { const got = C.apply(mdl, step, names, { book }); groups.push(got.added); };
  put({ add: "write", x: 40, y: 80, size: 24, c: "#2563eb", text: "1. Was ist Synthese?" });
  // (three lines by its "\n" — they break at maxw into more, as the hand writes them)
  put({ add: "write", x: 40, y: 125, size: 18, maxw: 560, text: "· Übersetzung einer RTL-Beschreibung (VHDL/Verilog: Register + Logik dazwischen) in eine Gatter-Netzliste\n· Eingaben: RTL-Code, Zellbibliothek (.lib), Constraints (Takt, Timing, Fläche); Ausgabe: Netzliste aus Standardzellen\n· Ziel: funktional gleiche Schaltung, die Timing, Fläche und Leistung optimiert" });
  put({ add: "write", x: 40, y: 125 + 3 * 18 * 1.75 + 10, size: 24, c: "#2563eb", text: "2. Ablauf der Synthese" });
  put({ add: "write", x: 40, y: 125 + 3 * 18 * 1.75 + 55, size: 18, maxw: 560, text: "RTL → Elaboration → generische Logik → Logikoptimierung → Technology Mapping → Netzliste" });
  put({ add: "ink", d: `M 40 ${125 + 3 * 18 * 1.75 + 42} L 320 ${125 + 3 * 18 * 1.75 + 42}`, c: "#2563eb" }); // (an underline under the heading, as Claude put it)
  const box = (its) => { const bs = its.map((it) => B.format.boundsOf(it)); return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))]; };
  const [h1, body1, h2, body2, line] = groups.map(box);
  assert.ok(h2[1] >= body1[3] + 4, `the heading under the part before it: ${Math.round(h2[1])} against its end ${Math.round(body1[3])}`);
  assert.ok(body2[1] >= h2[3] + 2, `the part after it under the heading: ${Math.round(body2[1])} against ${Math.round(h2[3])}`);
  assert.ok(line[1] > (h2[1] + h2[3]) / 2 && line[3] < body2[1] + 4, `the underline went along, under its heading: ${[line[1], line[3]].map(Math.round)} — heading ${Math.round(h2[3])}, next ${Math.round(body2[1])}`);
  assert.ok(h1[3] < body1[1] + 4, "the first heading stays where it was put");
});
