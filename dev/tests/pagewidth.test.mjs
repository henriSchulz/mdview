// The text column's width is the note's to say — narrow, normal, wide or full — and is a share
// of the room the note has, not a fixed measure; the settings have no say in it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPage } from "./harness.mjs";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

test("four widths, each a share of the room; normal where a note says nothing", async () => {
  const w = await loadPage(), root = w.document.documentElement;
  const show = (text) => { w.MdView.render({ name: "n.md", path: "/x/n.md", text, links: {}, base: "file:///x/" }); return root.style.getPropertyValue("--measure"); };
  assert.equal(show("# A\n"), ""); // (normal: the page's own, from page.css)
  assert.match(read("viewer/page.css"), /--measure: max\(66%, min\(100%, 30rem\)\)/);
  assert.equal(show("---\nwidth: narrow\n---\n# A\n"), "max(50%, min(100%, 30rem))");
  assert.equal(show("---\nwidth: wide\n---\n# A\n"), "max(82%, min(100%, 30rem))");
  assert.equal(show("---\nwidth: full\n---\n# A\n"), "none");
  assert.equal(show("---\nwide: true\n---\n# A\n"), "max(82%, min(100%, 30rem))"); // (as it was written before)
  assert.equal(show("# A\n"), "");
});

test("the settings have no width of their own", () => {
  assert.doesNotMatch(read("active/prefs.js"), /\["measure"/);
  assert.doesNotMatch(read("src-tauri/src/shell.rs"), /"measure":/);
});
