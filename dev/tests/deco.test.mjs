// Decorations: a quote as a tinted block or with a bar in a colour ([!block],
// [!focus|red]) — read, shown the same in both views, edited in place, written back.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM, md = w.MdView.core.md;
const { EditorState, TextSelection } = PM.state;

function open(text, needle) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
    pick(group, key) { A.slash.entries(v).find((e) => e && e.key === group).items.find((e) => e.key === key).act(v); },
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
  assert.ok(at >= 0, "not in the document: " + needle);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  return v;
}

test("the reader: a quote with its class, the marker line gone, no title", () => {
  assert.equal(md.render("> [!block]\n> text\n").replace(/ data-line="\d+"/g, "").trim(), '<blockquote class="deco deco-block">\n<p>text</p>\n</blockquote>');
  assert.match(md.render("> [!focus|red]\n> text\n"), /<blockquote class="deco deco-focus deco-red"/);
  assert.match(md.render("> [!block-focus|blue]\n> text\n"), /<blockquote class="deco deco-block deco-focus deco-blue"/);
  assert.match(md.render("> [!focus-block]\n> text\n"), /<blockquote class="deco deco-block deco-focus"/);
  assert.match(md.render("> [!block|nonsense]\n> text\n"), /<blockquote class="deco deco-block"/);
  // with a title it is a callout as before, and so are the types that were there
  assert.match(md.render("> [!block] Title\n> text\n"), /class="callout /);
  assert.match(md.render("> [!note]\n> text\n"), /class="callout callout-note"/);
  assert.equal(md.render("> plain\n").includes("deco"), false);
});

test("round trip: untouched, a decorated quote is written as it stands", () => {
  for (const src of ["> [!block]\n> text\n", "> [!focus|red]\n> one\n>\n> two\n", "before\n\n> [!block|blue]\n> text\n\nafter\n", "> [!block]\n>\n> text\n", "> [!FOCUS|Green]\n> text\n", "> [!block-focus|red]\n> text\n", "> [!focus-block]\n> text\n"]) {
    const v = open(src, "t");
    assert.equal(v.md(), src);
  }
});

test("the caret stays where it is when a decoration is put around its block", () => {
  const v = open("one\n\ntwo words\n\nthree\n", "two");
  v.pick("slash.deco", "slash.block");
  v.pick("slash.deco", "slash.focus");
  v.pick("slash.color", "color.red");
  assert.equal(v.state.selection.$from.parent.textContent + "@" + v.state.selection.$from.parentOffset, "two words@3");
  v.pick("slash.actions", "slash.duplicate"); // … and when the block is made once more
  assert.equal(v.md(), "one\n\n> [!block-focus|red]\n> two words\n\n> [!block-focus|red]\n> two words\n\nthree\n");
  assert.equal(v.state.selection.$from.parentOffset, 3);
  assert.equal(v.state.selection.$from.index(0), 1); // still in the first of the two
});

test("edited in place, only the text changes", () => {
  const v = open("> [!focus|red]\n> one\n", "one");
  assert.equal(v.state.doc.firstChild.type.name, "blockquote");
  assert.equal(v.state.doc.firstChild.attrs.deco + "|" + v.state.doc.firstChild.attrs.color, "focus|red");
  v.dispatch(v.state.tr.insertText(" two"));
  assert.equal(v.md(), "> [!focus|red]\n> one two\n");
});

test("the / menu: decorations and colours", () => {
  let v = open("one\n\ntwo\n", "two");
  v.pick("slash.deco", "slash.block");
  assert.equal(v.md(), "one\n\n> [!block]\n> two\n");
  v.pick("slash.color", "color.green");
  assert.equal(v.md(), "one\n\n> [!block|green]\n> two\n");
  v.pick("slash.deco", "slash.focus"); // a bar as well: it is both, the colour stays
  assert.equal(v.md(), "one\n\n> [!block-focus|green]\n> two\n");
  assert.equal(A.slash.entries(v).find((e) => e && e.key === "slash.deco").items.filter((e) => e.checked).map((e) => e.key).join(), "slash.block,slash.focus");
  v.pick("slash.deco", "slash.block"); // the block switched off: the bar stays
  assert.equal(v.md(), "one\n\n> [!focus|green]\n> two\n");
  v.pick("slash.color", "slash.colorDefault");
  assert.equal(v.md(), "one\n\n> [!focus]\n> two\n");
  v.pick("slash.deco", "menu.quote");
  assert.equal(v.md(), "one\n\n> two\n");
  v.pick("slash.deco", "menu.quote"); // chosen again: it goes
  assert.equal(v.md(), "one\n\ntwo\n");
  v.pick("slash.deco", "slash.focus");
  v.pick("slash.deco", "slash.focus"); // the last decoration switched off: plain text again
  assert.equal(v.md(), "one\n\ntwo\n");

  v = open("plain\n", "plain"); // a colour for plain text makes a block of it
  v.pick("slash.color", "color.red");
  assert.equal(v.md(), "> [!block|red]\n> plain\n");
  v = open("> quoted\n", "quoted"); // … and a quote gets a bar in that colour
  v.pick("slash.color", "color.blue");
  assert.equal(v.md(), "> [!focus|blue]\n> quoted\n");
  const ticks = (g) => A.slash.entries(v).find((e) => e && e.key === g).items.filter((e) => e.checked).map((e) => e.key).join();
  assert.equal(ticks("slash.deco") + " " + ticks("slash.color"), "slash.focus color.blue");
});
