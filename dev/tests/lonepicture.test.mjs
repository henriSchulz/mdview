// A picture put into a line of text (active/edit.js pictures splits it off into a paragraph of its own): written as its
// line, and taken for what it is read back as — no "Markdown cannot write part of this…" at every save (review 2026-11-17).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

test("a picture split off a line of text is written without a word of not being able to", async () => {
  const w = await loadPage(ACTIVE);
  const A = w.MdActive, PM = w.PM;
  const raw = "Some text ![pic](a.png)\n";
  const d = A.document.open({ text: raw, raw, links: {}, vault: false });
  const view = { state: PM.state.EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), dispatch(tr) { this.state = this.state.apply(tr); }, dom: w.document.createElement("div") };
  let at = -1;
  view.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes("text")) at = pos + n.text.indexOf("text") + 4; });
  view.dispatch(view.state.tr.insertText("s", at)); // (a letter typed: the picture goes into a paragraph of its own)
  const said = [];
  const was = A.markdown.onMismatch;
  A.markdown.onMismatch = (node, text) => said.push(text);
  try {
    assert.equal(A.document.serialize(d, view.state.doc, false), "Some texts\n\n![pic](a.png)\n");
  } finally { A.markdown.onMismatch = was; }
  assert.deepEqual(said, [], "it said it could not write: " + JSON.stringify(said));
});
