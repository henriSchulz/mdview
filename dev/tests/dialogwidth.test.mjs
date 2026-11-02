// A dialog that edits a block is as wide as the page the note is on (#25, Henri: "dass das Modal
// einfach immer genau so breit sein soll wie die Page") — the sheet's left and right edges, not the
// block's: a short code block has a dialog as wide as a long one. A dialog without a block (an inline
// formula) keeps its own width.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const doc = w.document;
Object.defineProperty(w, "innerWidth", { value: 1400, configurable: true });
Object.defineProperty(w, "innerHeight", { value: 900, configurable: true });
const rect = (left, width) => () => ({ left, width, right: left + width, top: 100, bottom: 160, height: 60, x: left, y: 100 });

// the page: #active, 800 px of sheet (its padding inside) between borders of 12 px, from 288 to 1112
const page = doc.createElement("div");
page.id = "active";
doc.body.appendChild(page);
page.getBoundingClientRect = rect(288, 824);
Object.defineProperty(page, "offsetWidth", { value: 824 });
Object.defineProperty(page, "clientWidth", { value: 800 });
Object.defineProperty(page, "clientLeft", { value: 12 });

function openOver(anchor) {
  const D = w.MdActive.dialog;
  D.show({ title: "Code", anchor: () => anchor, build: () => ({ focus() {}, result() {} }), done() {}, cancel() {} });
  const dlg = doc.getElementById("dlg");
  const got = { left: dlg.style.left, width: dlg.style.width };
  D.close("cancel");
  return got;
}

test("a dialog over a short code block is as wide as the page", () => {
  const block = doc.createElement("div");
  block.className = "code-block";
  page.appendChild(block);
  block.getBoundingClientRect = rect(340, 420); // (a block narrower than the page, off its middle)
  assert.deepEqual(openOver(block), { left: "300px", width: "800px" });
});

test("a block wider than the page: still the page's edges", () => {
  const block = doc.createElement("div");
  page.appendChild(block);
  block.getBoundingClientRect = rect(200, 1000);
  assert.deepEqual(openOver(block), { left: "300px", width: "800px" });
});

test("an inline formula keeps a dialog of its own width", () => {
  const span = doc.createElement("span");
  page.appendChild(span);
  span.getBoundingClientRect = rect(400, 40);
  assert.deepEqual(openOver(span), { left: "", width: "" });
});
