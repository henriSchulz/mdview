// A link to another note looks one of three ways: in the text, or — a block of its own, written
// [[Name]] <!-- link row --> — as a page's line does, a row or a card.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md;
const { EditorState } = PM.state;
function open(text) {
  A.view.show({ text, raw: text, links: {}, vault: false }); // (what is made from Markdown is read with the shown note's definitions)
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = { state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), editable: true, dispatch(tr) { v.state = v.state.apply(tr); }, focus() {}, hasFocus: () => true, nodeDOM: () => null, md: () => A.document.serialize(d, v.state.doc, false) };
  // the link (in the text, or the block), and its menu's styles
  v.link = () => { let hit = null; v.state.doc.descendants((n, p) => { if (!hit && ((n.type.name === "iatom" && n.attrs.kind === "wikilink") || (n.type.name === "island" && w.MdView.core.pages.link.isRow(n.attrs.raw)))) hit = { n, p }; }); return hit; };
  v.menu = () => { const { n, p } = v.link(); return A.context.nodeItems(v, p, n); };
  v.styles = () => v.menu().find((i) => i && i.items && i.label === "Style").items;
  v.style = (label) => v.styles().find((i) => i.label === label).run();
  v.now = () => v.styles().find((i) => i.checked).label;
  return v;
}

test("the reader: a row, a card, a colour; a link with text behind it stays a link", () => {
  assert.match(md.render("[[Plan]] <!-- link row -->\n", { links: { Plan: {} } }), /^<div class="page-row link-row" data-style="row" data-wiki="Plan"/);
  assert.match(md.render("[[Plan|The plan]] <!-- link card blue -->\n", { links: {} }), /class="page-row link-row unresolved" data-style="card" data-color="blue"[^>]*data-wiki="Plan"[\s\S]*>The plan</);
  assert.match(md.render("[[Plan]] and more <!-- link card -->\n", {}), /^<p[^>]*><a class="wikilink/);
  assert.match(md.render("- [[Plan]] <!-- link card -->\n", {}), /<li[^>]*><a class="wikilink/);
});

test("in the text → a card: out of the text, a block under it", () => {
  const v = open("See [[Plan]] for more.\n\nafter\n");
  assert.equal(v.now(), "In Text");
  v.style("Card");
  assert.equal(v.md(), "See for more.\n\n[[Plan]] <!-- link card -->\n\nafter\n");
  assert.equal(v.now(), "Card");
  v.style("Row");
  assert.equal(v.md(), "See for more.\n\n[[Plan]] <!-- link row -->\n\nafter\n");
  const again = open(v.md());
  assert.equal(again.now(), "Row");
  assert.equal(again.md(), v.md());
});

test("at the text's end, alone, with its own text, in a list", () => {
  let v = open("See [[Plan]]\n");
  v.style("Row");
  assert.equal(v.md(), "See\n\n[[Plan]] <!-- link row -->\n");
  v = open("before\n\n[[Plan|The plan]]\n\nafter\n");
  v.style("Card");
  assert.equal(v.md(), "before\n\n[[Plan|The plan]] <!-- link card -->\n\nafter\n");
  v = open("- one [[Plan]]\n- two\n\nafter\n");
  v.style("Card");
  assert.equal(v.md(), "- one\n- two\n\n[[Plan]] <!-- link card -->\n\nafter\n");
});

test("a block → in the text again; its colour", () => {
  const v = open("before\n\n[[Plan]] <!-- link card -->\n\nafter\n");
  v.menu().find((i) => i && i.label === "Color").items.find((i) => i.label === "Blue").run();
  assert.equal(v.md(), "before\n\n[[Plan]] <!-- link card blue -->\n\nafter\n");
  v.style("In Text");
  assert.equal(v.md(), "before\n\n[[Plan]]\n\nafter\n");
  assert.equal(v.now(), "In Text");
});
