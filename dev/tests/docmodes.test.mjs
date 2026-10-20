// The document's style (the panel's Style tab: the ground a note stands on, the width of its column) in every mode — beside
// the source alone and beside the source with its reading too (Henri, 2026-10-20): the panel shows there with what is the
// document's, and what is chosen is written into the head of the source as an edit of it, the rest of the text as it was,
// the caret where it was, saved at once.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WITH = ACTIVE.flatMap((s) => (s === "active/view.js" ? ["active/panel.js", s] : [s])); // (the panel: loaded with the active mode, before its view)
const HEAD = "---\ntitle: A note\nwide: true\n---\n";
const BODY = "# Title\n\nFirst paragraph.\n\nSecond paragraph, where the caret is.\n";

const opened = [];
after(() => { for (const w of opened) w.close(); });
async function page(text, mode) {
  const w = await loadPage(WITH), P = w.MdPage, posts = [];
  opened.push(w);
  w.MdHost = { post: (s) => posts.push(JSON.parse(s)) };
  // (jsdom has no execCommand: what the editor asks of it is noted — its undo — and the editor puts the text in itself)
  w.document.execCommand = (cmd, _ui, text) => { (w.execs ||= []).push([cmd, text]); return false; };
  w.Range.prototype.getClientRects = () => []; // (… nor a range's rectangles: the caret is shown by its line's)
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {} }); // (… nor media queries: motion reduced, a ground comes without a fade)
  w.MdPrefs = { panel: true, panelTab: "style" };
  w.MdView.render({ name: "n.md", path: "/x/n.md", text, links: {}, base: "file:///x/" });
  await sleep(50);
  P.setMode(mode);
  await sleep(300);
  w.MdActive.panel.sync();
  return { w, P, posts, root: w.document.documentElement, body: w.document.body, panel: w.MdActive.panel };
}
const saves = (posts) => posts.filter((m) => m.type === "save");

for (const mode of ["edit", "split"]) {
  test(`${mode}: the panel shows with the document's tabs, the others dimmed, no rail`, async () => {
    const { P, body, panel } = await page(HEAD + BODY, mode);
    assert.equal(P.mode, mode);
    assert.equal(body.dataset.view, "edit");
    assert.ok(body.hasAttribute("data-panel"), "the panel is open, as the settings have it");
    assert.equal(panel.el.dataset.tab, "style");
    const off = [...panel.rail.querySelectorAll(".rp-tab")].filter((b) => b.disabled).map((b) => b.dataset.tab);
    assert.deepEqual(off, ["insert", "format"]);
    assert.ok(!body.hasAttribute("data-rail"), "the rail is the active mode's");
    assert.ok(!panel.el.querySelector(".rp-ground").disabled, "a ground can be chosen");
    panel.toggle(); // (Ctrl+Alt+P)
    assert.ok(!body.hasAttribute("data-panel"));
    panel.toggle();
    assert.ok(body.hasAttribute("data-panel"));
  });

  test(`${mode}: a ground chosen is written into the source's head — the rest as it was, the caret kept, saved`, async () => {
    const { w, P, posts, root, panel } = await page(HEAD + BODY, mode);
    const at = P.edInput.value.indexOf("caret");
    P.edInput.focus();
    P.edInput.setSelectionRange(at, at + 5);
    panel.el.querySelector('.rp-ground[data-bg="blue"]').click();
    const want = HEAD.replace("wide: true\n", "wide: true\nbackground: blue\n") + BODY;
    assert.equal(P.edInput.value, want);
    assert.equal(P.edInput.value.slice(P.edInput.selectionStart, P.edInput.selectionEnd), "caret");
    assert.equal(w.document.activeElement, P.edInput);
    assert.equal(P.current.text, want);
    assert.deepEqual(saves(posts).map((m) => [m.path, m.text]), [["/x/n.md", want]]);
    assert.deepEqual(w.execs, [["insertText", "background: blue\n"]], "one step of the editor's undo, of the head alone");
    assert.equal(root.dataset.docBg, "blue", "the ground shows at once");
    assert.equal(panel.el.querySelector('.rp-ground[data-bg="blue"]').getAttribute("aria-checked"), "true");
    // and taken away again
    panel.el.querySelector('.rp-ground[data-bg=""]').click();
    assert.equal(P.edInput.value, HEAD + BODY);
    assert.equal(root.dataset.docBg, undefined);
  });

  test(`${mode}: a width chosen is written, and an old "wide" goes`, async () => {
    const { w, P, root, panel } = await page(HEAD + BODY, mode);
    const box = panel.el.querySelector(".rp-width");
    assert.equal(box.value, "wide");
    box.value = "narrow";
    box.dispatchEvent(new w.Event("change"));
    assert.equal(P.edInput.value, "---\ntitle: A note\nwidth: narrow\n---\n" + BODY);
    assert.match(root.style.getPropertyValue("--measure"), /40%/);
  });

  test(`${mode}: a note without properties gets a head; the caret at its start stays before its text, not in the head`, async () => {
    const { P, panel } = await page(BODY, mode);
    P.edInput.focus();
    P.edInput.setSelectionRange(0, 0);
    panel.el.querySelector('.rp-ground[data-bg="dots"]').click();
    assert.equal(P.edInput.value, "---\nbackground: dots\n---\n\n" + BODY);
    assert.equal(P.edInput.value.slice(P.edInput.selectionStart), BODY);
  });
}

test("split: the right half reads the note with its new head", async () => {
  const { w, P, panel } = await page(HEAD + BODY, "split");
  panel.el.querySelector('.rp-ground[data-bg="green"]').click();
  await sleep(500);
  assert.equal(w.document.querySelector("#twin .twin-doc h1").textContent, "Title");
  assert.equal(P.mode, "split");
});

test("a note only shown, or one that cannot be written: nothing is written from the source", async () => {
  const { P, posts, w } = await page(HEAD + BODY, "edit");
  P.current.readonly = "locked";
  assert.equal(w.MdView.core.doc.set("background", "red"), false);
  assert.equal(P.edInput.value, HEAD + BODY);
  assert.equal(saves(posts).length, 0);
});
