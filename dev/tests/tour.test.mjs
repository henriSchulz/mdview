// The tour of the controls (viewer/tour.js, issue #2): it walks the controls that are on the screen,
// one after the other — the table of contents among them —, passes over those that are not, says
// each in the language chosen, and keeps the keys from the note while it is open.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPage, ROOT } from "./harness.mjs";

const opened = [];
after(() => { for (const w of opened) w.close(); });
async function page(lang = "en") {
  const w = await loadPage([], (win) => { win.MdPrefs = { lang }; win.MdHost = { post: () => {} }; });
  opened.push(w);
  w.MdView.render({ name: "Note.md", path: "/n/Note.md", base: "/n/", text: "# One\n\ntext\n\n## Two\n", links: {} });
  return w;
}
// (jsdom lays nothing out: a control is put on the screen by giving it a box)
const box = (el, left, top, width = 28, height = 28) => { el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }); };
const tour = (w) => w.document.getElementById("tour");
const card = (w) => ({ step: tour(w).dataset.step, count: tour(w).querySelector(".tour-count").textContent, title: tour(w).querySelector("h2").textContent, text: tour(w).querySelector(".tour-text").textContent });
const next = (w) => tour(w).querySelector(".tour-next").click();

test("the steps are those whose control is on the screen; the table of contents is one, with a ring around its button", async () => {
  const w = await page();
  const bar = w.document.getElementById("toolbar");
  box(bar.querySelector('[data-act="sidebar"]'), 700, 10);
  box(bar.querySelector('[data-act="outline"]'), 760, 10);
  w.MdView.tour();
  assert.ok(!tour(w).hidden, "the tour is open");
  assert.deepEqual(card(w), { step: "welcome", count: "1 of 4", title: "Welcome to Markdown Notes", text: card(w).text });
  const steps = [card(w).step];
  for (let i = 0; i < 3; i++) { next(w); steps.push(card(w).step); }
  assert.deepEqual(steps, ["welcome", "sidebar", "outline", "end"]);
  next(w); next(w); // (back to the table of contents: one back)
  assert.ok(tour(w).hidden, "Done closes it");
  w.MdView.tour();
  next(w); next(w);
  assert.equal(card(w).title, "Table of contents");
  const spot = tour(w).querySelector(".tour-spot").style;
  assert.deepEqual([spot.left, spot.top, spot.width, spot.height], ["754px", "4px", "40px", "40px"], "the ring stands around the button");
  assert.ok(parseFloat(tour(w).querySelector(".tour-card").style.top) > 44, "the card is under the button");
});

test("Escape closes it, the arrows walk it, and no key reaches the note while it is open", async () => {
  const w = await page();
  let heard = 0;
  w.document.addEventListener("keydown", () => heard++);
  w.MdView.tour();
  const key = (k) => w.document.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  key("ArrowRight");
  assert.equal(card(w).step, "end", "nothing on the screen in jsdom: a welcome and an end");
  key("ArrowLeft");
  assert.equal(card(w).step, "welcome");
  key("a");
  key("Escape");
  assert.ok(tour(w).hidden);
  assert.equal(heard, 0, "the note heard none of the tour's keys");
  key("a");
  assert.equal(heard, 1, "closed, the keys are the note's again");
});

test("in German, the table of contents is the Inhaltsverzeichnis — and every word of the tour is there in both languages", async () => {
  const w = await page("de");
  box(w.document.querySelector('#toolbar [data-act="outline"]'), 760, 10);
  w.MdView.tour();
  assert.equal(card(w).count, "1 von 3");
  next(w);
  assert.equal(card(w).title, "Inhaltsverzeichnis");
  const src = readFileSync(ROOT + "/strings.js", "utf8"), de = src.slice(src.indexOf("    de: {"));
  const keys = [...src.slice(0, src.indexOf("    de: {")).matchAll(/"((?:tour|prefs\.tour)[\w.]*)":/g)].map((m) => m[1]);
  assert.ok(keys.length > 20, String(keys.length));
  assert.deepEqual(keys.filter((k) => !de.includes(`"${k}":`)), []);
});
