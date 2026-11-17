// %% comments %% on lines of their own, in the active mode: invisible there, they stay in the file where they stood —
// once — and stay in the file: a copy of a part of the note is that part, not the note's comments with it.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;
const K = A.edit.keys;

function doc(raw) {
  const d = A.document.open({ text: raw, raw, links: {}, vault: false });
  const view = {
    state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    dispatch(tr) { this.state = this.state.apply(tr); },
    dom: w.document.createElement("div"),
  };
  const at = (needle, after = true) => {
    let found = -1;
    view.state.doc.descendants((n, pos) => { if (found < 0 && n.isText && n.text.includes(needle)) found = pos + n.text.indexOf(needle) + (after ? needle.length : 0); });
    assert.ok(found >= 0, "not in the document: " + needle);
    return found;
  };
  return {
    view,
    md: () => A.document.serialize(d, view.state.doc, false),
    caret(needle, after = true) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(needle, after)))); return this; },
    select(a, b) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at(a, false), at(b)))); return this; },
    key(name) { assert.ok(K[name](view.state, (tr) => view.dispatch(tr), view), name + " did nothing"); return this; },
    copy() { return A.clip.markdownOf(view.state, view.state.selection.content()); },
  };
}

const count = (text, part) => text.split(part).length - 1;

// Review of 2026-11-17: a block split in two (Enter) or an item lifted out of its list (Backspace) is two parts with
// the block's id — and the comment after the block was written behind the first and again behind the last.
test("a block split in two keeps the comment after it once, behind its last part", () => {
  const e = doc("Hello world\n\n%% note %%\n\nNext\n").caret("Hello").key("Enter");
  assert.equal(e.md(), "Hello\n\nworld\n\n%% note %%\n\nNext\n");
});

test("an item lifted out of its list keeps the list's comment once, behind the list", () => {
  const e = doc("- alpha\n- beta\n- gamma\n\n%% remember %%\n\nNext\n").caret("beta", false).key("Backspace");
  const md = e.md();
  assert.equal(count(md, "%% remember %%"), 1, "the comment is there " + count(md, "%% remember %%") + " times:\n" + md);
  assert.ok(md.indexOf("%% remember %%") > md.indexOf("gamma"), "the comment is not behind the list's last part:\n" + md);
});

test("the store: parts of one id stand apart by a blank line, the comment after the last", () => {
  const s = A.store.parse("A\n\n%% c %%\n\nB\n");
  assert.equal(A.store.serialize(s, [{ id: 0, text: "A1" }, { id: 0, text: "A2" }, { id: 1 }]), "A1\n\nA2\n\n%% c %%\n\nB\n");
  assert.equal(A.store.serialize(s, [{ id: 0, text: "A1" }, { text: "x" }, { id: 0, text: "A2" }, { id: 1 }]), "A1\n\nx\n\nA2\n\n%% c %%\n\nB\n");
});

// Review of 2026-11-17: a copy wrote the note out from the part copied — and every comment whose block was not in it
// counted as left over, and came along: onto the clipboard, to Claude, into a page a block was dragged to.
test("a copy of a word is the word, without the note's comments", () => {
  const e = doc("# Title\n\nFirst para with a word.\n\nSecond\n\n%% todo: ask Bob about the salary %%\n\nThird\n\n%% another hidden remark %%\n\nFifth\n");
  assert.equal(e.select("word", "word").copy(), "word");
});

test("a copy of whole blocks has only the comment that stands between them", () => {
  const raw = "One\n\n%% far away %%\n\nTwo\n\n%% between %%\n\nThree\n\n%% after %%\n\nFour\n";
  assert.equal(doc(raw).select("Two", "Three").copy(), "Two\n\n%% between %%\n\nThree");
  assert.equal(doc(raw).select("Four", "Four").copy(), "Four");
});

test("the note itself, unchanged, keeps all its comments where they are", () => {
  const raw = "One\n\n%% far away %%\n\nTwo\n\n%% between %%\n\nThree\n";
  assert.equal(doc(raw).md(), raw);
});
