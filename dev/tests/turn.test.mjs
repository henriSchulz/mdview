// A picture turned by quarters: written before its size (|r90|300), read by the reader and the
// active mode alike, set from the picture's menu, and written back as it was read.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, core = w.MdView.core, md = core.md;
const { EditorState } = PM.state;
Object.defineProperty(A.view, "store", { configurable: true, get: () => ({ env: { links: {} }, vault: false }) }); // (what a block written anew is read with: islands.js, blocksOf)
function open(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = { state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), editable: true, dispatch(tr) { v.state = v.state.apply(tr); }, focus() {}, hasFocus: () => true, md: () => A.document.serialize(d, v.state.doc, false) };
  v.pic = () => { let at = null; v.state.doc.descendants((n, p) => { if (!at && (n.type.name === "image" || n.type.name === "island")) at = { n, p }; }); return A.islands.picture(v, at.p, at.n); };
  return v;
}

test("what is written: the turn before the size, either alone, a description left alone", () => {
  assert.deepEqual({ ...core.imageSize("a tree|r90|300") }, { alt: "a tree", size: "300", turn: "90" });
  assert.deepEqual({ ...core.imageSize("a tree|300") }, { alt: "a tree", size: "300", turn: "" });
  assert.deepEqual({ ...core.imageSize("a tree|r270") }, { alt: "a tree", size: "", turn: "270" });
  assert.deepEqual({ ...core.imageSize("a tree|full|r180") }, { alt: "a tree", size: "full", turn: "180" });
  assert.deepEqual({ ...core.imageSize("r90 is a road|r45") }, { alt: "r90 is a road|r45", size: "", turn: "" });
  assert.equal(core.picText("a tree", "90", "300"), "a tree|r90|300");
  assert.equal(core.picText("a tree", "", ""), "a tree");
});

test("the reader: the turn is the picture's, the description is clean, the size as before", () => {
  const html = md.render("![a tree|r90|300](tree.png)\n");
  assert.match(html, /<img src="tree.png" alt="a tree" width="300" data-turn="90">/);
  assert.match(md.render("![a tree|r180](tree.png)\n"), /<img src="tree.png" alt="a tree" data-turn="180">/);
  assert.doesNotMatch(md.render("![a tree|400](tree.png)\n"), /data-turn/);
  const links = { "tree.png": { kind: "image", url: "tree.png", path: "/x/tree.png" } };
  assert.match(md.render("![[tree.png|r270|400]]\n", { links }), /<img class="embed" src="tree.png" alt="tree(\.png)?" width="400" data-turn="270">/);
  assert.match(md.render("![[tree.png|a tree]]\n", { links }), /alt="a tree">/);
});

test("the active mode: turned from the picture's menu, a quarter at a time, the size kept — and written so", () => {
  const v = open("before ![a tree|300](tree.png) after\n");
  assert.equal(v.pic().turn, "");
  v.pic().turnBy(90); // (and, changed, the picture is a block of its own: tests/pictureblocks)
  assert.equal(v.md(), "before\n\n![a tree|r90|300](tree.png)\n\nafter\n");
  v.pic().turnBy(90);
  assert.equal(v.md(), "before\n\n![a tree|r180|300](tree.png)\n\nafter\n");
  v.pic().turnBy(-90); v.pic().turnBy(-90); v.pic().turnBy(-90);
  assert.equal(v.md(), "before\n\n![a tree|r270|300](tree.png)\n\nafter\n");
  v.pic().setSize("full");
  assert.equal(v.md(), "before\n\n![a tree|r270|full](tree.png)\n\nafter\n");
  v.pic().turnBy(90);
  assert.equal(v.md(), "before\n\n![a tree|full](tree.png)\n\nafter\n"); // (upright again: nothing is written)
});

test("a picture on a line of its own, and an embed: the same, in what is written", () => {
  const own = open("![a tree|r90](tree.png)\n");
  assert.equal(own.pic().turn, "90");
  assert.equal(own.md(), "![a tree|r90](tree.png)\n"); // (read anew: as it was written)
  assert.equal(typeof own.pic().turnBy, "function");
  assert.equal(open("![[tree.png|r270|400]]\n").pic().turn + "/" + open("![[tree.png|r270|400]]\n").pic().size, "270/400");
  // (turning these writes the block anew, which takes a window: dev/rig.sh turn)
  // a description of one's own in the size's place is left alone; a PDF's page is not turned
  assert.equal(open("![[tree.png|my tree]]\n").pic(), null);
  assert.equal(open("![[paper.pdf#page=2|400]]\n").pic().turnBy, undefined);
});
