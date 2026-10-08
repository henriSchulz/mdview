// A whiteboard's file (board/format.js, board/render.js): what is written is read back as it was,
// a file that a merge damaged costs single lines, and the picture the note shows is well formed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { loadPage } from "./harness.mjs";

const root = new URL("../../", import.meta.url);
function load() {
  const w = { Math, JSON, String, Number, Object, Array, Map, Set, Error, Infinity };
  w.window = w;
  vm.createContext(w);
  for (const f of ["board/format.js", "board/render.js", "board/shape.js", "board/items.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), w, { filename: f });
  return w.MdBoard;
}
const B = load(), F = B.format;
const plain = (v) => JSON.parse(JSON.stringify(v)); // (what the scripts made is of their own realm)
const ink = (id, pts, more = {}) => ({ id, k: "ink", t: "pen", c: "auto", o: 1, w: 3, ch: "xypt", pts, ...more });
const wave = (n, x0 = 0, p = () => 0.5) => Array.from({ length: n }, (_v, i) => [x0 + i * 3.7, 40 + Math.round(Math.sin(i / 3) * 200) / 10, p(i), i * 8]);

test("points are written and read back: tenths of a pixel, hundredths of pressure, milliseconds", () => {
  const pts = [[0, 0, 0.5, 0], [12.3, -4.5, 0.75, 16], [-300.1, 9000.2, 1, 40], [1e6, -1e6, 0, 100000]];
  assert.deepEqual(JSON.parse(JSON.stringify(F.unpack(F.pack(pts)))), pts);
  assert.deepEqual(plain(F.unpack(F.pack([]))), []);
  const six = [[1, 2, 0.5, 0, 30, -120], [2, 3, 0.6, 8, 31, -119]];
  assert.deepEqual(JSON.parse(JSON.stringify(F.unpack(F.pack(six, "xyptia"), "xyptia"))), six);
  assert.throws(() => F.unpack("A"), /cut off/);
  assert.throws(() => F.unpack("not base64!"), /not a stroke/);
});

test("a board written and read is the same board, and written again the same text", () => {
  const model = F.fresh();
  model.board.view = { x: -120, y: 33, z: 0.75 };
  model.board.grid = false;
  model.items.push(ink("aaaaaaa1", wave(40)), ink("aaaaaaa2", wave(25, 200, (i) => (i % 10) / 10), { c: "#1f6fe5" }), ink("aaaaaaa3", [[5, 5, 0.5, 0]], { t: "mono", w: 2 }));
  const text = F.write(model), back = F.parse(text);
  assert.equal(back.lost, 0);
  assert.deepEqual(plain(back.board), { v: 1, bg: "auto", grid: false, view: { x: -120, y: 33, z: 0.75 } });
  assert.deepEqual(plain(back.items.map((it) => it.id)), ["aaaaaaa1", "aaaaaaa2", "aaaaaaa3"]);
  assert.deepEqual(JSON.parse(JSON.stringify(back.items[1].pts)), JSON.parse(JSON.stringify(model.items[1].pts)));
  // the data is the same at once; the picture too from then on (it is drawn from points that have been rounded as the file rounds them)
  const data = (t) => t.slice(0, t.indexOf("]]>"));
  assert.equal(data(F.write(back)), data(text));
  assert.equal(F.write(F.parse(F.write(back))), F.write(back));
  assert.equal(text.split("\n").filter((l) => l.startsWith('{"id"')).length, 3, "one line per item");
});

test("the file is a picture: well-formed SVG with a size, one drawn element per item", () => {
  const model = F.fresh();
  model.items.push(ink("aaaaaaa1", wave(40)), ink("aaaaaaa2", wave(25, 200, (i) => (i % 10) / 10)));
  const text = F.write(model);
  const doc = new JSDOM(text, { contentType: "image/svg+xml" }).window.document, svg = doc.documentElement; // (throws where it is not well formed)
  assert.equal(svg.localName, "svg");
  assert.ok(Number(svg.getAttribute("width")) > 100 && Number(svg.getAttribute("height")) > 20);
  assert.deepEqual([...svg.querySelectorAll("path")].map((p) => p.id), ["aaaaaaa1", "aaaaaaa2"]);
  assert.equal(svg.querySelector("#aaaaaaa1").getAttribute("fill"), "none", "one width: a line");
  assert.ok(svg.querySelector("#aaaaaaa2").getAttribute("d").includes("Z"), "pressure: an outline");
  assert.ok(!/NaN|undefined|Infinity/.test(text));
  const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
  assert.ok(x < 0 && y < 40 && w > 290 && h > 40, "everything drawn is inside the picture, with room around");
});

test("an empty board is a picture too, and a board again", () => {
  const text = F.empty();
  new JSDOM(text, { contentType: "image/svg+xml" });
  assert.deepEqual(plain(F.parse(text).items), []);
  assert.match(text, /width="640" height="200"/);
});

test("a damaged file costs single lines", () => {
  const model = F.fresh();
  model.items.push(ink("aaaaaaa1", wave(10)), ink("aaaaaaa2", wave(10, 100)), ink("aaaaaaa3", wave(10, 200)));
  const lines = F.write(model).split("\n");
  const at = (id) => lines.findIndex((l) => l.includes(`"id":"${id}"`));
  // a line cut in two by a merge, a conflict marker, a line that is no item, and one item twice (the later stands)
  const twice = lines[at("aaaaaaa3")].replace('"w":3', '"w":7');
  lines[at("aaaaaaa2")] = lines[at("aaaaaaa2")].slice(0, 30);
  lines.splice(at("aaaaaaa3") + 1, 0, "<<<<<<< HEAD", '{"id":"zzz"}', twice);
  const back = F.parse(lines.join("\n"));
  assert.deepEqual(plain(back.items.map((it) => [it.id, it.w])), [["aaaaaaa1", 3], ["aaaaaaa3", 7]]);
  assert.equal(back.lost, 3);
  assert.throws(() => F.parse("<svg></svg>"), /not a whiteboard/);
});

test("an item of a kind this version does not know is carried along as it is", () => {
  const model = F.fresh();
  model.items.push(ink("aaaaaaa1", wave(5)));
  const lines = F.write(model).split("\n"), i = lines.findIndex((l) => l.startsWith('{"id"'));
  lines.splice(i, 0, '{"id":"later001","k":"hologram","x":1,"deep":{"a":[1,2]}}');
  const back = F.parse(lines.join("\n"));
  assert.equal(back.lost, 0);
  assert.ok(F.write(back).includes('{"id":"later001","k":"hologram","x":1,"deep":{"a":[1,2]}}'));
});

test("what a text holds cannot end the data early", () => {
  const model = F.fresh();
  model.items.push({ id: "later002", k: "note", foreign: { id: "later002", k: "note", text: "]]> </metadata><script>&" } });
  const text = F.write(model);
  assert.equal(text.split("]]>").length, 2);
  assert.equal(F.parse(text).items[0].foreign.text, "]]> </metadata><script>&");
});

test("a marker's stroke ends flat, a stroke made straight keeps its corners — in the file and in the picture", () => {
  const model = F.fresh();
  model.items.push(ink("aaaaaaa1", wave(12), { t: "marker", w: 14, o: 0.4, c: "#f2b90f" }), ink("aaaaaaa2", [[0, 0, 0.5, 0], [100, 0, 0.5, 0], [100, 60, 0.5, 0], [0, 60, 0.5, 0], [0, 0, 0.5, 0]], { t: "mono", w: 2, sharp: true }));
  const text = F.write(model), back = F.parse(text);
  assert.deepEqual(plain(back.items.map((it) => [it.t, it.o, !!it.sharp])), [["marker", 0.4, false], ["mono", 1, true]]);
  const svg = new JSDOM(text, { contentType: "image/svg+xml" }).window.document.documentElement;
  assert.deepEqual([svg.querySelector("#aaaaaaa1").getAttribute("stroke-linecap"), svg.querySelector("#aaaaaaa1").getAttribute("opacity")], ["butt", "0.4"]);
  assert.equal(svg.querySelector("#aaaaaaa2").getAttribute("d"), "M0 0L100 0L100 60L0 60Z");
  assert.equal(F.write(F.parse(F.write(back))), F.write(back));
});

// a hand's version of a figure: its points, each a little off
const shaky = (pts, by = 1.5) => pts.map(([x, y], i) => [x + Math.sin(i * 12.9898) * by, y + Math.cos(i * 78.233) * by, 0.5, i * 8]);
const along = (corners, step = 4) => corners.slice(1).flatMap((b, i) => { const a = corners[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); return Array.from({ length: n }, (_v, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); });
const kind = (pts) => { const g = B.shape.guess(pts); return g ? g.kind : null; };

test("a hand that rests at the end of a stroke: what it drew is made clean", () => {
  assert.equal(kind(shaky(along([[0, 0], [200, 60]]))), "line");
  const line = B.shape.guess(shaky(along([[10, 10], [210, 70]])));
  assert.deepEqual([line.sharp, line.pts.length], [true, 2]);
  const ring = (rx, ry, n = 80) => Array.from({ length: n }, (_v, i) => [300 + rx * Math.cos((2 * Math.PI * i) / (n - 2)), 200 + ry * Math.sin((2 * Math.PI * i) / (n - 2))]);
  assert.equal(kind(shaky(ring(60, 60), 2.5)), "circle");
  assert.equal(kind(shaky(ring(110, 50), 2.5)), "ellipse");
  const circle = B.shape.guess(shaky(ring(60, 62), 2.5));
  const radii = plain(circle.pts).map((p) => Math.hypot(p[0] - 300, p[1] - 200));
  assert.ok(Math.max(...radii) - Math.min(...radii) < 2.5, "a circle is round, about where it was drawn");
  assert.deepEqual(plain(circle.pts[0]), plain(circle.pts[circle.pts.length - 1]), "and shut");
  assert.equal(kind(shaky(along([[0, 0], [180, 4], [176, 110], [3, 104], [0, 6]]))), "rectangle");
  const rect = B.shape.guess(shaky(along([[0, 0], [180, 4], [176, 110], [3, 104], [0, 6]])));
  assert.deepEqual([rect.sharp, rect.pts.length], [true, 5]);
  assert.equal(kind(shaky(along([[100, 0], [200, 160], [0, 150], [98, 4]]))), "triangle");
});

test("… and what is nothing in particular is left as drawn", () => {
  assert.equal(kind(shaky(wave(40))), null, "a wave");
  assert.equal(kind(shaky(along([[0, 0], [100, 0], [100, 100]]))), null, "a corner");
  assert.equal(kind([[0, 0, 0.5, 0], [3, 2, 0.5, 8], [6, 1, 0.5, 16]]), null, "a tick too short to mean anything");
  assert.equal(kind(shaky(along([[0, 0], [40, 80], [80, 0], [120, 80], [160, 0]]))), null, "a zigzag");
});

test("an eraser put through a stroke leaves the pieces beside it", () => {
  const line = Array.from({ length: 21 }, (_v, i) => [i * 10, 0, 0.5, i * 8]);
  assert.equal(B.shape.cut(line, 100, 50, 10), null, "not touched: as it was");
  const mid = plain(B.shape.cut(line, 100, 0, 15));
  assert.equal(mid.length, 2);
  assert.deepEqual([mid[0][0][0], mid[0].at(-1)[0], mid[1][0][0], mid[1].at(-1)[0]], [0, 85, 115, 200]);
  assert.equal(mid[0].at(-1)[3], 68, "the cut has the time the stroke had there");
  const end = plain(B.shape.cut(line, 200, 0, 15));
  assert.deepEqual([end.length, end[0].at(-1)[0]], [1, 185]);
  assert.deepEqual(plain(B.shape.cut(line, 100, 0, 500)), [], "all of it under the eraser: nothing stays");
  assert.deepEqual(plain(B.shape.cut([[5, 5, 0.5, 0]], 5, 5, 3)), []);
  assert.equal(B.shape.cut([[5, 5, 0.5, 0]], 50, 5, 3), null);
  // between two points that are both outside: the eraser still cuts what runs under it
  const two = plain(B.shape.cut([[0, 0, 0.2, 0], [100, 0, 0.8, 100]], 50, 0, 10));
  assert.deepEqual(two.map((p) => [p[0][0], p.at(-1)[0]]), [[0, 40], [60, 100]]);
  assert.deepEqual([two[0].at(-1)[2], two[1][0][2]], [0.44, 0.56], "the pressure the stroke had there");
});

test("text boxes, sticky notes, shapes and lines: a line of the file each, the picture drawn from them under the ink", () => {
  const I = B.items, model = F.fresh();
  const box = I.fresh("text", 100, 40), note = I.fresh("sticky", 400, 100), star = I.fresh("shape", 100, 300, { shape: "star" }), arrow = I.fresh("line", 400, 300, { arrow: true });
  box.text = "A heading & <more>\nsecond line"; box.ts.bold = true;
  note.text = "Ask about the lab report on Thursday, before the seminar begins"; note.r = -4;
  star.stroke = { c: "auto", w: 4 }; star.lock = true; star.group = "g1"; arrow.group = "g1";
  model.items.push(box, ink("aaaaaaa1", wave(10)), note, star, arrow);
  const text = F.write(model), back = F.parse(text);
  assert.equal(back.lost, 0);
  assert.deepEqual(plain(back.items.filter((it) => it.k !== "ink")), plain([box, note, star, arrow]));
  assert.equal(F.write(back), F.write(F.parse(F.write(back))));
  const svg = new JSDOM(text, { contentType: "image/svg+xml" }).window.document.documentElement;
  assert.deepEqual([...svg.children].slice(1).map((e) => e.id), [box.id, note.id, star.id, arrow.id, "aaaaaaa1"], "the ink lies over what stands on the board");
  assert.deepEqual([...svg.querySelectorAll(`#${box.id} tspan`)].map((t) => t.textContent), ["A heading & <more>", "second line"]);
  assert.equal(svg.querySelector(`#${box.id} text`).getAttribute("font-weight"), "600");
  assert.ok(svg.querySelectorAll(`#${note.id} tspan`).length >= 3, "a note's text is broken into lines that fit it");
  assert.match(svg.querySelector(`#${note.id}`).getAttribute("transform"), /^rotate\(-4 /);
  assert.equal(svg.querySelector(`#${note.id} text`).getAttribute("fill"), "#1d1d1f");
  assert.equal(svg.querySelectorAll(`#${arrow.id} path`).length, 2, "a line and its one head");
  const [x, y, w, h] = svg.getAttribute("viewBox").split(" ").map(Number), b = I.bounds(note);
  assert.ok(x <= b[0] && y <= b[1] && x + w >= b[2] && y + h >= b[3], "a turned note is inside the picture, corners and all");
});

test("an item is hit where it is, turned or not; what a file may not say about one is put right or left out", () => {
  const I = B.items, it = I.fresh("shape", 0, 0, { shape: "rect" });
  assert.deepEqual([I.hit(it, 70, 45), I.hit(it, 80, 0), I.hit(it, 0, 55)], [true, false, false]);
  it.r = 90;
  assert.deepEqual([I.hit(it, 45, 70), I.hit(it, 70, 45)], [true, false]);
  const line = I.fresh("line", 0, 0);
  assert.deepEqual([I.hit(line, 0, 3), I.hit(line, 0, 12), I.hit(line, 90, 0)], [true, false, false]);
  const odd = I.norm({ id: "x1", k: "shape", x: 0, y: 0, w: -5, h: 1e9, r: "9", shape: "blob", fill: "url(#x)", stroke: { c: "red", w: 999 }, ts: { size: "big", align: "justify", color: "javascript:1" }, text: 7, lock: "yes", onclick: "x()" });
  assert.deepEqual(plain(odd), { id: "x1", k: "shape", x: 0, y: 0, w: 4, h: 20000, r: 0, text: "", ts: { size: 16, align: "center", color: "auto" }, shape: "rect", fill: "#1f6fe5", stroke: { c: "none", w: 60 } });
  assert.equal(I.norm({ id: "x2", k: "line", p: [0, 0, 1] }), null);
  assert.equal(I.norm({ id: "x3", k: "text", x: 0, y: 0, w: 10 }), null);
});

test("a picture on a board: named by its file's name, with a small copy of it in the board's picture", () => {
  const I = B.items, model = F.fresh(), small = "data:image/png;base64,iVBORw0KGgo=";
  model.items.push({ id: "pic00001", k: "image", x: 10, y: 20, w: 200, h: 120, r: 15, src: 'Photo & "more".png' });
  I.thumbs.clear(); I.missing.clear();
  const bare = F.write(model);
  assert.deepEqual([...I.missing], ['Photo & "more".png'], "no copy yet: said, so that the board is kept again once there is one");
  assert.match(bare, /<rect x="10" y="20" width="200" height="120"/, "… and a grey field stands for it");
  I.thumbs.set('Photo & "more".png', small);
  const text = F.write(model), svg = new JSDOM(text, { contentType: "image/svg+xml" }).window.document.documentElement, image = svg.querySelector("image");
  assert.deepEqual([image.getAttribute("href"), image.getAttribute("width"), image.getAttribute("data-src")], [small, "200", 'Photo & "more".png']);
  assert.match(svg.querySelector("#pic00001").getAttribute("transform"), /^rotate\(15 110 80\)/);
  assert.deepEqual(plain(F.parse(text).items), plain(model.items));
  // read again in another session: the copy comes out of the file
  I.thumbs.clear();
  I.thumbsFrom(text);
  assert.equal(I.thumbs.get('Photo & "more".png'), small);
  assert.equal(F.write(F.parse(text)), text);
  // a name is a name: nothing that leads elsewhere
  for (const src of ["../secret.png", "a/b.png", "C:\\x.png", ".hidden.png", "", 5]) assert.equal(I.norm({ id: "x", k: "image", x: 0, y: 0, w: 10, h: 10, src }), null, String(src));
});

test("in a note a board alone in its paragraph is a block of its own, by both ways of writing it", async () => {
  const w = await loadPage(), md = w.MdView.core.md;
  assert.match(md.render("![](assets/board-1.board.svg)\n", {}), /<p class="pic-block board-block"[^>]*><img src="assets\/board-1\.board\.svg"/);
  assert.match(md.render("![[b.board.svg]]\n", { links: { "b.board.svg": { kind: "image", url: "md://x/b.board.svg", path: "/b.board.svg" } } }), /<p class="pic-block board-block"/);
  assert.doesNotMatch(md.render("![](tree.svg)\n", {}), /board-block/);
  assert.doesNotMatch(md.render("text ![](a.board.svg) text\n", {}), /board-block/);
});
