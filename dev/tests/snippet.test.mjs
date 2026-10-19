// A note's first words — under its name in All Notes' list and in the sidebar — are what the note says: not the style sheet
// of a drawing in it (an svg fence) or the text of a code block.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

test("a drawing's style and a code block are not a note's words", async () => {
  const w = await loadPage();
  const note = "# Test\n\n```svg\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><style>:root{color:#1d1d1f}</style><circle cx=\"5\" cy=\"5\" r=\"4\"/></svg>\n```\n\n```js\nconst x = 1;\n```\n\nThe words of the note.\n";
  const p = w.MdPage.previewOf("/n/Test.md", note);
  assert.equal(p.text, "The words of the note.");
  assert.match(p.html, /<svg/); // (the sheet still shows the drawing)
});
