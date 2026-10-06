// Blocks by the keyboard: Esc takes the block the caret is in, then Space,
// Ctrl+D and Alt+Shift+arrows work on it — and what that writes into the file.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;

function open(text, needle) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  const v = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true,
    dispatch(tr) { v.state = v.state.apply(tr); },
    focus() {}, hasFocus: () => true,
    md: () => A.document.serialize(d, v.state.doc, false),
    // a key, as the editor gets it: the blocks' own handling first, then the key map
    key(key, mods = {}) {
      const e = { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...mods };
      if (A.blocks.selPlugin.props.handleKeyDown(v, e)) return true;
      const name = (mods.ctrlKey ? "Mod-" : "") + (key === " " ? "Space" : key);
      return A.edit.keys[name] ? A.edit.keys[name](v.state, (tr) => v.dispatch(tr), v) : false;
    },
    blocks: () => A.blocks.selection(v.state),
  };
  let at = -1;
  v.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
  assert.ok(at >= 0, "not in the document: " + needle);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, at)));
  return v;
}
const type = (v, text) => v.dispatch(v.state.tr.insertText(text));

test("Esc takes the block, Esc again gives the caret back where it was", () => {
  const v = open("one\n\ntwo words\n\nthree\n", "two");
  const caret = v.state.selection.from;
  assert.ok(v.key("Escape"));
  assert.equal(v.state.doc.nodeAt(v.blocks().from).textContent, "two words");
  assert.ok(v.key("Escape"));
  assert.equal(v.blocks(), null);
  assert.equal(v.state.selection.from, caret);
  // moved to another block in between: the caret goes to that block's end
  v.key("Escape"); v.key("ArrowDown"); v.key("Enter");
  assert.equal(v.state.selection.$from.parent.textContent, "three");
  assert.equal(v.state.selection.$from.parentOffset, 5);
});

test("in a list the block is the item, in a table the table", () => {
  let v = open("- a\n- b\n", "b");
  v.key("Escape");
  assert.equal(v.state.doc.nodeAt(v.blocks().from).type.name, "list_item");
  v = open("| a | b |\n| - | - |\n| c | d |\n", "c");
  v.key("Escape");
  assert.equal(v.state.doc.nodeAt(v.blocks().from).type.name, "table");
});

test("Space: an empty block below, Shift+Space above, the caret in it", () => {
  let v = open("one\n\ntwo\n", "one");
  v.key("Escape"); v.key(" ");
  assert.equal(v.blocks(), null);
  type(v, "new");
  assert.equal(v.md(), "one\n\nnew\n\ntwo\n");
  v = open("one\n\ntwo\n", "two");
  v.key("Escape"); v.key(" ", { shiftKey: true });
  type(v, "new");
  assert.equal(v.md(), "one\n\nnew\n\ntwo\n");
  v = open("- [x] a\n- [ ] b\n", "a");
  v.key("Escape"); v.key(" ");
  type(v, "new");
  assert.equal(v.md(), "- [x] a\n- [ ] new\n- [ ] b\n");
});

test("Ctrl+D: once more, below — on blocks and in the text", () => {
  let v = open("one\n\ntwo\n\nthree\n", "one");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  v.key("d", { ctrlKey: true });
  assert.equal(v.md(), "one\n\ntwo\n\none\n\ntwo\n\nthree\n");
  const r = v.blocks();
  assert.equal(v.state.doc.textBetween(r.from, r.to, "|"), "one|two"); // the copies are what is selected now
  v = open("one\n\ntwo\n", "one");
  v.key("d", { ctrlKey: true });
  assert.equal(v.md(), "one\n\none\n\ntwo\n");
});

test("Alt+Shift+arrows: to the top, to the end", () => {
  const v = open("one\n\ntwo\n\nthree\n\nfour\n", "three");
  v.key("Escape");
  v.key("ArrowUp", { altKey: true, shiftKey: true });
  assert.equal(v.md(), "three\n\none\n\ntwo\n\nfour\n");
  v.key("ArrowDown", { altKey: true, shiftKey: true });
  assert.equal(v.md(), "one\n\ntwo\n\nfour\n\nthree\n");
  v.key("ArrowDown", { altKey: true, shiftKey: true }); // already there
  assert.equal(v.md(), "one\n\ntwo\n\nfour\n\nthree\n");
  v.key("ArrowUp", { altKey: true });
  assert.equal(v.md(), "one\n\ntwo\n\nthree\n\nfour\n");
});

test("Tab and Shift+Tab on selected blocks: further in together, and out again", () => {
  // two items of a list: both under the one above
  let v = open("- one\n- two\n- three\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  assert.ok(v.key("Tab"));
  assert.equal(v.md(), "- one\n  - two\n  - three\n");
  // a paragraph and a code block right below a list: into its last item; they stay selected
  v = open("- one\n\nbelow\n\n```\ncode\n```\n\nafter\n", "below");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  v.key("Tab");
  assert.equal(v.md(), "- one\n\n  below\n\n  ```\n  code\n  ```\n\nafter\n");
  assert.equal(v.blocks().b - v.blocks().a, 1);
  // … and out again with Shift+Tab
  v.key("Tab", { shiftKey: true });
  assert.equal(v.md(), "- one\n\nbelow\n\n```\ncode\n```\n\nafter\n");
  // no list above: further in all the same, together, in a quote that only indents — and out again
  v = open("first\n\nsecond\n\nthird\n", "second");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  assert.ok(v.key("Tab"));
  assert.equal(v.md(), "first\n\n> [!indent]\n> second\n>\n> third\n");
  assert.equal(v.blocks().b - v.blocks().a, 1);
  v.key("Tab", { shiftKey: true });
  assert.equal(v.md(), "first\n\nsecond\n\nthird\n");
});

test("the / menu for selected blocks: for all of them at once", () => {
  const pick = (v, group, key, n) => {
    const was = A.menu.open;
    let items = null;
    A.menu.open = (o) => { items = o.items; };
    v.coordsAtPos = () => ({ left: 0, top: 0, bottom: 0 });
    try { assert.ok(v.key("/")); } finally { A.menu.open = was; }
    const T = w.MdStrings.t;
    const entry = items.find((g) => g.label === T(group)).items.find((e) => e.label === T(key, n));
    entry.run();
    return items;
  };
  // blocks that stand together: one list of them
  let v = open("one\n\ntwo\n\nthree\n\nfour\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  const items = pick(v, "slash.list", "menu.bullet");
  assert.deepEqual([...items].map((g) => g.label), ["slash.style", "slash.list", "slash.deco", "slash.color", "slash.callout"].map((k) => w.MdStrings.t(k))); // (what is put in — a table, a rule — is not for blocks that are there)
  assert.equal(v.md(), "one\n\n- two\n- three\n\nfour\n");
  // … one callout around them
  v = open("one\n\ntwo\n\nthree\n", "one");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  pick(v, "slash.callout", "callout.note");
  assert.equal(v.md(), "> [!note]\n> one\n>\n> two\n\nthree\n");
  // … each a heading
  v = open("one\n\ntwo\n\nthree\n", "two");
  v.key("Escape"); v.key("ArrowDown", { shiftKey: true });
  pick(v, "slash.style", "menu.heading", 2);
  assert.equal(v.md(), "one\n\n## two\n\n## three\n");
});
