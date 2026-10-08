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

test("a line joined to items goes where they go; cornered and curved, it takes its way by which sides it leaves", () => {
  const I = B.items, a = I.fresh("shape", 0, 0, { shape: "rect" }), z = I.fresh("shape", 400, 0, { shape: "rect" });
  const line = I.norm({ id: "ln000001", k: "line", p: [0, 0, 1, 1], stroke: { c: "auto", w: 2 }, ends: ["none", "arrow"], route: "corner", from: { id: a.id, at: "auto" }, to: { id: z.id, at: "auto" } });
  const items = [a, z, line];
  assert.equal(I.relink(items), true);
  assert.deepEqual(plain(line.p), [75, 0, 325, 0], "from the right side of the one to the left side of the other");
  assert.equal(I.relink(items), false, "nothing moved: nothing to do");
  z.y += 300; z.x -= 400; // now below
  I.relink(items);
  assert.deepEqual(plain(line.p), [0, 50, 0, 250], "the other moved below: bottom to top");
  assert.deepEqual(plain(I.way(line)), [[0, 50], [0, 150], [0, 150], [0, 250]]);
  line.from.at = "r";
  I.relink(items);
  assert.deepEqual(plain(line.p.slice(0, 2)), [75, 0], "a side that was named stays that side");
  assert.deepEqual(plain(I.way(line)), [[75, 0], [0, 0], [0, 250]]);
  assert.equal(I.way(line).length, 3, "sideways out, then down in: one corner");
  line.route = "curve";
  assert.ok(I.way(line).length > 10 && I.hit(line, ...I.way(line)[12]), "a curved line is hit along its bow");
  a.r = 90;
  I.relink(items);
  assert.deepEqual(plain(line.p.slice(0, 2)), [0, 75], "a turned item's right side is where it has turned to");
  // the file keeps what an end is joined to, not which way it was worked out to leave
  const model = F.fresh();
  model.items.push(...items);
  const text = F.write(model), back = F.parse(text).items.find((it) => it.k === "line");
  assert.deepEqual(plain([back.from, back.to, back.route, back.sides]), plain([{ id: a.id, at: "r" }, { id: z.id, at: "auto" }, "curve", undefined]));
  assert.ok(!text.includes('"sides"'));
  // the item it was joined to is gone: the end stays where it was, joined to nothing
  const where = [...line.p];
  I.relink([a, line]);
  assert.deepEqual(plain([line.to, line.p.slice(2)]), plain([undefined, where.slice(2)]));
  assert.equal(I.norm({ id: "x", k: "line", p: [0, 0, 1, 1], from: { id: 5 }, to: { id: "y", at: "sideways" }, route: "zigzag" }).from, undefined);
  assert.deepEqual(plain(I.norm({ id: "x", k: "line", p: [0, 0, 1, 1], to: { id: "y", at: "sideways" }, route: "zigzag" }).to), { id: "y", at: "auto" });
});

test("scenes and the board's own settings are lines of the file too", () => {
  const model = F.fresh();
  model.board.snap = true;
  model.scenes.push({ id: "sc000001", name: "Overview", view: [-100, -50, 1200, 800] }, { id: "sc000002", name: 'Details <&> "x"', view: [300, 200, 400.4, 300.6] });
  model.items.push(ink("aaaaaaa1", wave(5)));
  const text = F.write(model), back = F.parse(text);
  assert.deepEqual(plain([back.board.snap, back.scenes, back.items.length, back.lost]), [true, [{ id: "sc000001", name: "Overview", view: [-100, -50, 1200, 800] }, { id: "sc000002", name: 'Details <&> "x"', view: [300, 200, 400, 301] }], 1, 0]);
  assert.equal(F.write(back), F.write(F.parse(F.write(back))));
  assert.ok(!F.write(F.fresh()).includes("snap"), "a board that does not snap says nothing of it");
  // a scene that says nothing usable is left out and counted; of two with one id the later stands
  const lines = text.split("\n"), i = lines.findIndex((l) => l.includes('"k":"scene"'));
  lines.splice(i, 0, '{"id":"sc000009","k":"scene","name":"x","view":[0,0,0,10]}', '{"id":"sc000002","k":"scene","name":"old","view":[0,0,10,10]}');
  const again = F.parse(lines.join("\n"));
  assert.deepEqual(plain([again.lost, again.scenes.map((sc) => sc.name)]), [1, ["Overview", 'Details <&> "x"']]);
});

test("in a note a board alone in its paragraph is a block of its own, by both ways of writing it", async () => {
  const w = await loadPage(), md = w.MdView.core.md;
  assert.match(md.render("![](assets/board-1.board.svg)\n", {}), /<p class="pic-block board-block"[^>]*><img src="assets\/board-1\.board\.svg"/);
  assert.match(md.render("![[b.board.svg]]\n", { links: { "b.board.svg": { kind: "image", url: "md://x/b.board.svg", path: "/b.board.svg" } } }), /<p class="pic-block board-block"/);
  assert.doesNotMatch(md.render("![](tree.svg)\n", {}), /board-block/);
  assert.doesNotMatch(md.render("text ![](a.board.svg) text\n", {}), /board-block/);
});
