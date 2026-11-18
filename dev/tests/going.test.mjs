// A note chosen (viewer/render.js going) is drawn as the shell's answer comes, and shown with the next frame — not two
// frames later and a third before it shows (2026-11-18: 100 ms of every click at Low Power Mode's 30 frames a second).
// A long note makes way first, as before: the one on screen goes at once, it comes two frames later.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const w = await loadPage();
const P = w.MdPage, body = w.document.body;
const note = (name, text) => ({ name, path: "/x/" + name, text, links: {}, base: "file:///x/" });
const frames = (n) => new Promise((done) => { const step = (k) => (k ? w.requestAnimationFrame(() => step(k - 1)) : done()); step(n); });

test("a note chosen is drawn as the answer comes, and the page is no longer on its way", () => {
  w.MdView.render(note("a.md", "# A\n\none"));
  P.going("/x/b.md");
  assert.ok(body.hasAttribute("data-going"), "the note on screen does not make way at the click");
  w.MdView.render(note("b.md", "# B\n\ntwo"));
  assert.equal(P.current.path, "/x/b.md", "not drawn as the answer came");
  assert.match(w.document.getElementById("content").textContent, /two/);
  assert.ok(!body.hasAttribute("data-going"), "still on the way after it was drawn");
});

test("a long note makes way first: drawn two frames later, then shown", async () => {
  w.MdView.render(note("a.md", "# A\n\none"));
  P.going("/x/long.md");
  w.MdView.render(note("long.md", "# Long\n\n" + "A line of the long note.\n\n".repeat(2000)));
  assert.equal(P.current.path, "/x/a.md", "a long note drawn before the frame that shows the old one gone");
  assert.ok(body.hasAttribute("data-going"));
  await frames(4);
  assert.equal(P.current.path, "/x/long.md");
  assert.ok(!body.hasAttribute("data-going"));
});
