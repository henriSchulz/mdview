// A paste of HTML from elsewhere (active/clip.js pasteData): its plain text, never used, leaves nothing in the note's
// store — no "[x]: …" definition of it, that made "[x]" be written "\[x\]" from then on (review 2026-11-17).
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

test("a paste of HTML from elsewhere takes nothing from its plain text into the note", async () => {
  const w = await loadPage(ACTIVE);
  const A = w.MdActive, PM = w.PM;
  const raw = "# Note\n\nSome text.\n";
  const d = A.document.open({ text: raw, raw, links: {}, vault: false });
  let pastedHtml = null;
  const view = {
    state: PM.state.EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }),
    editable: true, focus() {}, dispatch(tr) { this.state = this.state.apply(tr); },
    pasteHTML(html) { pastedHtml = html; }, dom: w.document.createElement("div"),
  };
  const segs = d.store.segs.length;
  A.clip.pasteFrom(view, "Pasted words [zzz]\n\n[zzz]: https://example.invalid/zzz\n", "<p>Pasted <b>words</b></p>");
  assert.ok(pastedHtml, "the HTML was not pasted");
  const refs = JSON.stringify(d.store.env.references || {});
  assert.ok(!/zzz/i.test(refs), "the plain text's definition is the note's now: " + refs);
  assert.equal(d.store.segs.length, segs, "the plain text was taken into the note's store");
});
