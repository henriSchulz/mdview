// A dialog that edits a block is the whole window — the Leinwand (Henri, 2026-11-04, dev/modal-lab-2.html 6c): no width or
// place of its own, Cancel and Done in its head. Before, it was as wide as the page the note is on (#25); a dialog without
// a block (an inline formula) still keeps its own width, its buttons at its foot.
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
  const got = { canvas: dlg.dataset.canvas != null, left: dlg.style.left, width: dlg.style.width, done: dlg.querySelector('[data-do="done"]').parentElement.className };
  D.close("cancel");
  return got;
}

test("a dialog over a short code block is the whole window", () => {
  const block = doc.createElement("div");
  block.className = "code-block";
  page.appendChild(block);
  block.getBoundingClientRect = rect(340, 420); // (a block narrower than the page, off its middle)
  assert.deepEqual(openOver(block), { canvas: true, left: "", width: "", done: "dlg-head" });
});

test("a block wider than the page: the whole window too", () => {
  const block = doc.createElement("div");
  page.appendChild(block);
  block.getBoundingClientRect = rect(200, 1000);
  assert.deepEqual(openOver(block), { canvas: true, left: "", width: "", done: "dlg-head" });
});

test("an inline formula keeps a dialog of its own width, its buttons at its foot", () => {
  const span = doc.createElement("span");
  page.appendChild(span);
  span.getBoundingClientRect = rect(400, 40);
  assert.deepEqual(openOver(span), { canvas: false, left: "", width: "", done: "dlg-foot" });
});

test("after a block's dialog, an inline formula's has its buttons back at its foot", () => {
  const block = doc.createElement("div"), span = doc.createElement("span");
  page.append(block, span);
  block.getBoundingClientRect = rect(340, 420);
  span.getBoundingClientRect = rect(400, 40);
  openOver(block);
  assert.equal(openOver(span).done, "dlg-foot");
});
