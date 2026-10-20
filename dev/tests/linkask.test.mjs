// A link the application said leads nowhere is asked about once more when the note is drawn —
// the files may not all have been known when the note was read — and not again for those links:
// no question asked over and over. (Henri: "links to notes or PDFs are shown as not existing,
// although the file is there"; "a PDF embedded with rect does not render".)
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const w = await loadPage();
const asked = [];
w.MdHost = { post: (m) => { const o = JSON.parse(m); if (o.type === "resolve") asked.push(o.target); } };
const tick = () => new Promise((r) => setTimeout(r, 5));
const PDF = "risc-v-e-trace-spec.pdf#page=12&rect=76,65,557,363", NOTE = "Spec";
const show = (links) => w.MdView.render({ name: "x.md", path: "/x/risc-v/tracing/x.md", text: `See [[${NOTE}|the spec]].\n\n![[${PDF}]]\n`, links, base: "file:///x/" });

test("a link said to lead nowhere is asked once more, then shown when found", async () => {
  const links = { [PDF]: null, [NOTE]: null };
  show(links);
  await tick();
  assert.deepEqual(asked.sort(), [NOTE, PDF].sort(), "both asked about once more");
  w.MdView.linkResolved(NOTE, { path: "/x/risc-v/Spec.md", url: "file:///x/risc-v/Spec.md", kind: "md" });
  w.MdView.linkResolved(PDF, { path: "/x/assets/risc-v/risc-v-e-trace-spec.pdf", url: "file:///x/assets/risc-v/risc-v-e-trace-spec.pdf", kind: "pdf" });
  const doc = w.document;
  assert.equal(doc.querySelector("a.wikilink").classList.contains("unresolved"), false, "the link is no longer shown as missing");
  assert.ok(doc.querySelector(".pdf-embed[data-frag='page=12&rect=76,65,557,363']"), "the PDF's part is embedded");
  assert.equal(doc.querySelector(".embed-missing"), null);
});

test("a second nowhere stands: drawn again, nothing is asked again until the note is read anew", async () => {
  asked.length = 0;
  const links = { [PDF]: null, [NOTE]: null };
  show(links);
  await tick();
  assert.equal(asked.length, 2);
  w.MdView.linkResolved(NOTE, null);
  w.MdView.linkResolved(PDF, null);
  for (let i = 0; i < 3; i++) { show(links); await tick(); } // (redrawn — a change of mode, a reload of the same read)
  assert.equal(asked.length, 2, "no loop");
  assert.ok(w.document.querySelector("a.wikilink.unresolved"));
  show({ [PDF]: null, [NOTE]: null }); // (read anew: links of its own)
  await tick();
  assert.equal(asked.length, 4, "read anew: asked once more");
});

test("a note drawn elsewhere (a tile) asks nothing about the note on screen", async () => {
  asked.length = 0;
  w.MdView.core.md.render(`[[Elsewhere]] ![[else.pdf]]`, { links: {}, depth: 0 });
  await tick();
  assert.deepEqual(asked, []);
});
