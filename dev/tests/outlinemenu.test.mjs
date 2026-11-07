// The outline at the right (Velum Refined) put away from the menu of a right click beside the note,
// and shown again from there (Henri, 2026-11-07: "man soll die outline ausblenden können über das
// allgemeine Kontextmenü, wenn man ins Nichts klickt").
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const opened = [];
after(() => { for (const w of opened) w.close(); });
async function page(prefs = {}) {
  const said = [];
  const w = await loadPage([], (win) => {
    win.MdPrefs = { lang: "en", look: "refined", ...prefs };
    win.MdHost = { post: (m) => said.push(typeof m === "string" ? JSON.parse(m) : m) };
  });
  opened.push(w);
  w.document.documentElement.dataset.velum = "opal"; // (only where Velum is: the variant the desktop wears)
  w.MdPage.prefsChanged();
  w.MdView.render({ name: "Note.md", path: "/n/Note.md", base: "/n/", text: "# One\n\ntext\n\n## Two\n\nmore\n", links: {} });
  return { w, said };
}
const rightClick = (w, el) => el.dispatchEvent(new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 }));
const rows = (w) => [...w.document.querySelectorAll("#textmenu .menu-label")].map((s) => s.textContent);
const choose = async (w, name) => {
  const b = [...w.document.querySelectorAll("#textmenu .menu-item")].find((x) => x.textContent.includes(name));
  b.click();
  await new Promise((r) => setTimeout(r, 300)); // (the entry blinks, then acts)
};

test("a right click beside the note puts the outline away, and the next one shows it again", async () => {
  const { w, said } = await page();
  const rail = w.document.getElementById("orail");
  assert.equal(rail.hidden, false, "the outline is there to begin with");
  rightClick(w, w.document.body);
  assert.ok(rows(w).includes("Hide Outline"), rows(w).join(", "));
  await choose(w, "Hide Outline");
  assert.equal(rail.hidden, true, "put away");
  assert.deepEqual(said.filter((m) => m.type === "prefs").map((m) => m.prefs), [{ outline: false }]);
  rightClick(w, w.document.body);
  assert.ok(rows(w).includes("Show Outline"), rows(w).join(", "));
  await choose(w, "Show Outline");
  assert.equal(rail.hidden, false, "shown again");
});

test("put away, it stays away for the next note", async () => {
  const { w } = await page({ outline: false });
  assert.equal(w.document.getElementById("orail").hidden, true);
});

test("no such entry where the look has no outline at the right", async () => {
  const { w } = await page({ look: "app" });
  rightClick(w, w.document.body);
  assert.ok(!rows(w).some((r) => /Outline/.test(r)), rows(w).join(", "));
});
