// A plain text file (.txt, Henri 2026-10-29: "eine Funktion für einfache Textdateien"): opened in the source editor alone —
// nothing in it read as Markdown, nothing coloured, no switch of modes, no ** typed by Ctrl+B — and the note after it is in
// the mode it was in before.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXT = "# not a heading\n\nsome **words** and a [link](x)\n- not a list\n";
const NOTE = "# Title\n\nFirst paragraph.\n";
const txt = (more = {}) => ({ kind: "text", name: "plain.txt", path: "/x/plain.txt", text: TEXT, links: {}, base: "file:///x/", ...more });
const note = (more = {}) => ({ name: "n.md", path: "/x/n.md", text: NOTE, links: {}, base: "file:///x/", ...more });

const opened = [];
after(() => { for (const w of opened) w.close(); });
async function page(first) {
  const w = await loadPage(), P = w.MdPage, posts = [];
  opened.push(w);
  w.MdHost = { post: (s) => posts.push(JSON.parse(s)) };
  w.document.execCommand = () => false;
  w.MdView.render(first);
  await sleep(300);
  return { w, P, posts, body: w.document.body, seg: w.document.querySelector(".seg") };
}

test("a text file opens in the source editor, its text plain, the switch of modes hidden", async () => {
  const { P, posts, body, seg } = await page(txt());
  assert.equal(P.mode, "edit");
  assert.equal(body.dataset.view, "edit");
  assert.equal(P.edInput.value, TEXT);
  assert.equal(P.edBack.querySelector("span"), null, "nothing coloured as Markdown");
  assert.equal(P.edBack.textContent, TEXT.replace(/\n/g, ""));
  assert.ok(seg.hidden, "no modes to switch between");
  const mode = posts.filter((m) => m.type === "mode").pop();
  assert.equal(mode.plain, true, "the shell is told: not a mode chosen for the next window");
});

test("no other mode can be chosen for it", async () => {
  const { P } = await page(txt());
  for (const m of ["read", "split", "active"]) {
    P.setMode(m);
    await sleep(300);
    assert.equal(P.mode, "edit", m);
  }
});

test("Ctrl+B and Ctrl+K type no Markdown into it", async () => {
  const { w, P } = await page(txt());
  P.edInput.setSelectionRange(0, 5);
  for (const key of ["b", "k"]) {
    const e = new w.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, ctrlKey: true });
    P.edInput.dispatchEvent(e);
    assert.equal(e.defaultPrevented, false, key);
  }
  assert.equal(P.edInput.value, TEXT);
});

test("one that can't be written is shown as its text, plain", async () => {
  const { w, P } = await page(txt({ readonly: "file is not UTF-8" }));
  assert.equal(P.mode, "read");
  const pre = w.document.querySelector("#content pre.plain-text");
  assert.ok(pre);
  assert.equal(pre.textContent, TEXT);
  assert.equal(w.document.querySelector("#content h1"), null);
});

for (const before of ["read", "edit", "split"]) {
  test(`a note in ${before}, then a text file, then a note: in ${before} again, the switch back`, async () => {
    const { w, P, seg } = await page(note());
    P.setMode(before);
    await sleep(300);
    w.MdView.render(txt());
    await sleep(300);
    assert.equal(P.mode, "edit");
    w.MdView.render(note({ path: "/x/m.md", name: "m.md" }));
    await sleep(300);
    assert.equal(P.mode, before);
    assert.equal(seg.hidden, false);
    if (before === "edit") assert.ok(P.edBack.querySelector("span"), "Markdown coloured again");
  });
}
