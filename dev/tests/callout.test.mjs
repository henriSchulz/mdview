// Callouts: a plain one (a kind, maybe a title, something in it) is edited in
// place, one that folds too; the / menu makes them. Those of PDFs stay islands.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md;
const { EditorState, TextSelection } = PM.state;
const { DOMSerializer } = PM.model;

function open(text, needle) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
    pick(group, key) { A.slash.entries(v).find((e) => e && e.key === group).items.find((e) => e && e.key === key).act(v); },
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
  if (at >= 0) v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at))); // (not in an island's text)
  return v;
}
const kinds = (v) => { const out = []; v.state.doc.forEach((n) => out.push(n.type.name + (n.attrs.callout ? ":" + n.attrs.callout : ""))); return out.join(" "); };

test("a plain callout is a block of the document, others are islands", () => {
  assert.equal(kinds(open("> [!info]\n> text\n", "text")), "blockquote:info");
  assert.equal(kinds(open("> [!WARNING] Mind **this**\n> text\n", "text")), "blockquote:WARNING");
  assert.equal(kinds(open("> [!note]- Folded\n> text\n", "text")), "blockquote:note");
  assert.equal(kinds(open("> [!pdf|yellow] x\n> text\n", "text")), "island");
  assert.equal(kinds(open("before\n\n> [!tip] Only a title\n", "before")), "paragraph island");
});

test("round trip: untouched, as it stands", () => {
  for (const src of ["> [!info]\n> text\n", "> [!WARNING] Mind **this**\n> one\n>\n> - a\n> - b\n", "a\n\n> [!note] A callout\n> With **content**.\n\nb\n", "> [!tip]\n>\n> text\n", ">[!bug]\n>text\n"]) {
    assert.equal(open(src, "t").md(), src);
  }
});

test("it shows as the reading view shows it", () => {
  const src = "> [!warning] Mind **this**\n> text\n";
  const read = Object.assign(w.document.createElement("div"), { innerHTML: md.render(src) }).firstElementChild;
  const v = open(src, "text"), box = w.document.createElement("div");
  box.appendChild(DOMSerializer.fromSchema(A.schema).serializeFragment(v.state.doc.content, { document: w.document }));
  const act = box.firstElementChild, strip = (el) => el.outerHTML.replace(/ (data-line|contenteditable)="[^"]*"/g, "").replace(/\n/g, "");
  assert.equal(strip(act), strip(read));
});

test("typed in, only the text changes; the title stays", () => {
  const v = open("> [!info] Heads up\n> one\n", "one");
  v.dispatch(v.state.tr.insertText(" two"));
  assert.equal(v.md(), "> [!info] Heads up\n> one two\n");
});

test("the / menu: a callout around the block, another kind, and away again", () => {
  let v = open("one\n\ntwo\n", "two");
  v.pick("slash.callout", "callout.info");
  assert.equal(v.md(), "one\n\n> [!info]\n> two\n");
  assert.equal(v.state.selection.$from.parent.textContent + "@" + v.state.selection.$from.parentOffset, "two@3"); // the caret stays
  v.pick("slash.callout", "callout.error");
  assert.equal(v.md(), "one\n\n> [!error]\n> two\n");
  assert.equal(A.slash.entries(v).find((e) => e && e.key === "slash.callout").items.filter((e) => e && e.checked).map((e) => e.key).join(), "callout.error");
  v.pick("slash.callout", "callout.error"); // the same again: it goes
  assert.equal(v.md(), "one\n\ntwo\n");

  v = open("> [!info] Heads up\n> text\n", "text"); // another kind keeps the title
  v.pick("slash.callout", "callout.warning");
  assert.equal(v.md(), "> [!warning] Heads up\n> text\n");
  v.pick("slash.deco", "slash.block"); // a decoration instead: the callout is gone
  assert.equal(v.md(), "> [!block]\n> text\n");
  v.pick("slash.callout", "callout.tip"); // … and back
  assert.equal(v.md(), "> [!tip]\n> text\n");
  v.pick("slash.deco", "menu.quote");
  assert.equal(v.md(), "> text\n");
});

test("a callout that folds is edited in place too, and written as it was; the / menu makes one fold", () => {
  for (const src of ["> [!note]- Folded at first\n> text\n", "> [!tip]+ Open\n> text\n> more\n", "> [!warning]-\n> text\n"]) {
    const v = open(src, "text");
    assert.equal(kinds(v), "blockquote:" + /\[!(\w+)\]/.exec(src)[1]);
    assert.equal(v.state.doc.firstChild.attrs.fold, /\]([-+])/.exec(src)[1]);
    assert.equal(v.md(), src);
  }
  const v = open("> [!info] A title\n> text\n", "text");
  const names = () => A.slash.entries(v).find((e) => e && e.key === "slash.callout").items.filter(Boolean).map((e) => e.key);
  assert.ok(names().includes("callout.fold") && !names().includes("callout.foldOpen"));
  v.pick("slash.callout", "callout.fold");
  assert.equal(v.md(), "> [!info]- A title\n> text\n");
  assert.ok(names().includes("callout.foldOpen"));
  v.pick("slash.callout", "callout.foldOpen");
  assert.equal(v.md(), "> [!info]+ A title\n> text\n");
  v.pick("slash.callout", "callout.fold"); // (chosen again: it folds no more)
  assert.equal(v.md(), "> [!info] A title\n> text\n");
  // as the reading view draws it: <details> with its <summary>, open or not
  const dom = (src) => DOMSerializer.fromSchema(A.schema.schema || open(src, "text").state.schema).serializeFragment(open(src, "text").state.doc.content, { document: w.document }).firstChild;
  const folded = dom("> [!note]- T\n> text\n"), opened = dom("> [!note]+ T\n> text\n");
  assert.deepEqual([folded.tagName, folded.hasAttribute("open"), folded.firstChild.tagName, !!folded.querySelector(".callout-fold")], ["DETAILS", false, "SUMMARY", true]);
  assert.equal(opened.hasAttribute("open"), true);
});
