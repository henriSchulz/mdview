// Quick notes (mdview --quick) have the active mode alone: no switch of modes, and no other mode can be set.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WITH = ACTIVE.flatMap((s) => (s === "active/view.js" ? ["active/panel.js", s] : [s]));
const opened = [];
after(() => { for (const w of opened) w.close(); });

async function page(quick) {
  const w = await loadPage(WITH), P = w.MdPage;
  opened.push(w);
  w.MdHost = { post: () => {} };
  w.document.execCommand = () => false;
  w.Range.prototype.getClientRects = () => [];
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {} });
  w.MdView.render({ name: "n.md", path: "/x/n.md", text: "# T\n\nbody\n", links: {}, base: "file:///x/" });
  await sleep(50);
  w.MdView.setFolder({ root: "/x", name: "x", tree: { name: "x", path: "/x", dirs: [], notes: [] }, quick });
  await sleep(300);
  return { w, P };
}

test("quick notes: the active mode, no other can be set, the switch is hidden", async () => {
  const { w, P } = await page(true);
  assert.equal(P.mode, "active");
  for (const m of ["read", "edit", "split"]) { P.setMode(m); await sleep(100); assert.equal(P.mode, "active", m); }
  assert.ok(w.document.querySelector(".seg").hidden);
});

test("an ordinary folder keeps its modes", async () => {
  const { w, P } = await page(false);
  assert.equal(P.mode, "read");
  P.setMode("edit"); await sleep(100);
  assert.equal(P.mode, "edit");
  assert.ok(!w.document.querySelector(".seg").hidden);
});
