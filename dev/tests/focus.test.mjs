// The focus mode (issue #9: "a full screen and a key that hides all controls — the focus only on
// the document"): F11 or Ctrl+Shift+F hides the toolbar, the tabs, the sidebar and the gear and
// asks the host for the full screen; the same key, or Esc, gives them back as they were.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPage, ROOT } from "./harness.mjs";

const opened = [];
after(() => { for (const w of opened) w.close(); });
async function page() {
  const said = [];
  const w = await loadPage([], (win) => { win.MdPrefs = { lang: "en" }; win.MdHost = { post: (m) => said.push(typeof m === "string" ? JSON.parse(m) : m) }; });
  opened.push(w);
  const sheet = w.document.createElement("style"); // (the harness links no sheet: the one that has the focus mode's rules)
  sheet.textContent = readFileSync(ROOT + "/viewer/chrome.css", "utf8");
  w.document.head.append(sheet);
  w.MdView.render({ name: "Note.md", path: "/n/Note.md", base: "/n/", text: "# One\n\ntext\n", links: {} });
  return { w, screens: () => said.filter((m) => m.type === "fullscreen").map((m) => m.on) };
}
const key = (w, k, o = {}) => w.document.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...o }));
const focused = (w) => w.document.body.hasAttribute("data-focus");

test("F11 hides the controls and asks for the full screen; F11 again gives them back", async () => {
  const { w, screens } = await page();
  key(w, "F11");
  assert.ok(focused(w), "focus mode on");
  const hidden = (sel) => w.getComputedStyle(w.document.querySelector(sel)).display === "none";
  assert.ok(hidden("#toolbar"), "the toolbar is gone");
  assert.ok(hidden("#settings-btn"), "the gear is gone");
  key(w, "F11");
  assert.ok(!focused(w), "focus mode off");
  assert.ok(!hidden("#toolbar"), "the toolbar is back");
  assert.deepEqual(screens(), [true, false]);
});

test("Ctrl+Shift+F does the same, and Esc leaves it", async () => {
  const { w, screens } = await page();
  key(w, "F", { ctrlKey: true, shiftKey: true });
  assert.ok(focused(w));
  key(w, "Escape");
  assert.ok(!focused(w));
  assert.deepEqual(screens(), [true, false]);
});

test("the browser's own full screen left (its Esc) ends the focus mode too", async () => {
  const { w } = await page();
  key(w, "F11");
  Object.defineProperty(w.document, "fullscreenElement", { configurable: true, get: () => w.document.documentElement });
  w.document.dispatchEvent(new w.Event("fullscreenchange"));
  assert.ok(focused(w), "still on while the full screen holds");
  Object.defineProperty(w.document, "fullscreenElement", { configurable: true, get: () => null });
  w.document.dispatchEvent(new w.Event("fullscreenchange"));
  assert.ok(!focused(w), "off once the full screen is left");
});
