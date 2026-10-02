// Footnotes: definitions found in a hidden block and written back, a new
// reference with its definition.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;
const NT = A.notes;

function doc(text) {
  const d = A.document.open({ text, raw: text, links: {}, vault: false });
  let state = EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) });
  return {
    get state() { return state; },
    md: () => A.document.serialize(d, state.doc, false),
    caretAfter(needle) {
      let at = -1;
      state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) + needle.length; });
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
      return this;
    },
    run(command) { return command(state, (tr) => { state = state.apply(tr); }); },
    apply(tr) { state = state.apply(tr); return this; },
  };
}

const RAW = "[^a]: first\n    more\n\n    second paragraph\n\n[^2]: two\nlazy\n[x]: http://x\n*[HTML]: Hyper";

test("definitions in a block", () => {
  const defs = NT.defsIn(RAW);
  assert.equal(JSON.stringify(defs.map((d) => [d.label, d.from, d.to, d.text])), JSON.stringify([["a", 0, 4, "first\nmore\n\nsecond paragraph"], ["2", 5, 7, "two\nlazy"]]));
  assert.equal(NT.withDef(RAW, defs[0], "changed"), "[^a]: changed\n\n[^2]: two\nlazy\n[x]: http://x\n*[HTML]: Hyper");
  assert.equal(NT.withDef(RAW, defs[1], "one\n\ntwo"), "[^a]: first\n    more\n\n    second paragraph\n\n[^2]: one\n\n    two\n[x]: http://x\n*[HTML]: Hyper");
  assert.equal(NT.withDef(RAW, defs[1], null), "[^a]: first\n    more\n\n    second paragraph\n\n[x]: http://x\n*[HTML]: Hyper");
  assert.equal(NT.withDef("[^1]: only", NT.defsIn("[^1]: only")[0], null), "");
});

test("a note changed: only its definition is written anew", () => {
  const text = "Text[^a] and[^2].\n\n" + RAW + "\n\nEnd.\n";
  const e = doc(text);
  const f = NT.find(e.state.doc, "2");
  e.apply(e.state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, raw: NT.withDef(f.node.attrs.raw, f.def, "zwei") }));
  assert.equal(e.md(), text.replace("[^2]: two\nlazy", "[^2]: zwei"));
});

test("a new note: the next free number, its definition at the end", () => {
  let e = doc("One[^1] two.\n\n[^1]: first\n").caretAfter("two");
  assert.ok(e.run(NT.insert));
  assert.equal(e.md(), "One[^1] two[^2].\n\n[^1]: first\n\n[^2]: \n");
  assert.equal(e.state.doc.lastChild.attrs.virtual, true, "the section stays last");

  e = doc("Plain text.\n").caretAfter("Plain");
  e.run(NT.insert);
  assert.equal(e.md(), "Plain[^1] text.\n\n[^1]: \n");
});
