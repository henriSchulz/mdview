// The fourth mode: the source at the left and the note as it reads at the right ("split", viewer/twin.js) — its place in the
// mode switch, how it is entered and left, and that the right half follows what is typed at the left.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOTE = "# Title\n\nFirst paragraph.\n\n- [ ] a task\n\n## Second\n\nSee [there](#second).\n";

const opened = [];
after(() => { for (const w of opened) w.close(); }); // (the right half looks for changes every so often while it is there)
async function page(more = {}) {
  const w = await loadPage(), P = w.MdPage;
  opened.push(w);
  w.MdView.render({ name: "n.md", path: "/x/n.md", text: NOTE, links: {}, base: "file:///x/", ...more });
  await sleep(50);
  return { w, P, body: w.document.body, twin: w.document.querySelector("#twin .twin-doc") };
}
const key = (w, n) => w.dispatchEvent(new w.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: String(n), code: "Digit" + n, ctrlKey: true, altKey: true }));

test("the switch: active, the source beside its reading, the source, reading — in that order", async () => {
  const { w } = await page();
  assert.deepEqual([...w.document.querySelectorAll(".seg-btn")].map((b) => b.dataset.mode), ["active", "split", "edit", "read"]);
  assert.equal(w.document.querySelector(".seg-btn[aria-checked=true]").dataset.mode, "read");
});

test("entered and left by the keys of its place in the switch; the source is the editor's in both its modes", async () => {
  const { w, P, body, twin } = await page();
  key(w, 2); await sleep(300);
  assert.equal(P.mode, "split");
  assert.equal(body.dataset.view, "edit");
  assert.ok(body.hasAttribute("data-twin"));
  assert.equal(w.document.querySelector(".seg-btn[aria-checked=true]").dataset.mode, "split");
  assert.equal(P.edInput.value, NOTE);
  assert.equal(twin.querySelector("h1").textContent, "Title");
  assert.ok(twin.querySelector("[data-line]"), "blocks keep their source lines");
  assert.equal(twin.querySelector("[id]"), null, "no id of the reading view's twice");
  assert.ok(twin.querySelector("input.task").disabled, "a task is ticked in the source here");
  key(w, 3); await sleep(300);
  assert.equal(P.mode, "edit");
  assert.ok(!body.hasAttribute("data-twin"));
  key(w, 2); await sleep(300);
  assert.equal(P.mode, "split");
  key(w, 4); await sleep(300);
  assert.equal(P.mode, "read");
  assert.equal(body.dataset.view, "read");
  assert.ok(!body.hasAttribute("data-twin"));
});

test("what is typed at the left is read at the right a moment later", async () => {
  const { w, P, twin } = await page();
  P.setMode("split"); await sleep(300);
  P.edInput.value += "\nA new line here.\n";
  P.edInput.dispatchEvent(new w.Event("input"));
  await sleep(250);
  assert.match(twin.textContent, /A new line here\./);
});

test("Ctrl+E leaves it for reading, as it leaves the source", async () => {
  const { w, P } = await page();
  P.setMode("split"); await sleep(300);
  w.dispatchEvent(new w.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "e", code: "KeyE", ctrlKey: true }));
  await sleep(300);
  assert.equal(P.mode, "read");
});

test("a click on a block at the right puts the caret at its line", async () => {
  const { w, P, twin } = await page();
  P.setMode("split"); await sleep(300);
  const p = [...twin.querySelectorAll("p")].find((x) => x.textContent === "First paragraph.");
  p.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(P.edInput.selectionStart, NOTE.indexOf("First paragraph."));
});

test("a window that starts in it, and a note that is only read, which has no source to show", async () => {
  const a = await page({ startMode: "split" });
  await sleep(300);
  assert.equal(a.P.mode, "split");
  const b = await page({ readonly: "a shared note" });
  b.P.setMode("split"); await sleep(300);
  assert.equal(b.P.mode, "read");
  assert.ok(!b.body.hasAttribute("data-twin"));
});
