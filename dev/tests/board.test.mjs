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
  for (const f of ["board/format.js", "board/render.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), w, { filename: f });
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

test("in a note a board alone in its paragraph is a block of its own, by both ways of writing it", async () => {
  const w = await loadPage(), md = w.MdView.core.md;
  assert.match(md.render("![](assets/board-1.board.svg)\n", {}), /<p class="pic-block board-block"[^>]*><img src="assets\/board-1\.board\.svg"/);
  assert.match(md.render("![[b.board.svg]]\n", { links: { "b.board.svg": { kind: "image", url: "md://x/b.board.svg", path: "/b.board.svg" } } }), /<p class="pic-block board-block"/);
  assert.doesNotMatch(md.render("![](tree.svg)\n", {}), /board-block/);
  assert.doesNotMatch(md.render("text ![](a.board.svg) text\n", {}), /board-block/);
});
