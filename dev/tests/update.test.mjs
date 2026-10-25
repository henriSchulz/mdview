// A newer version of the app (src-tauri/src/update.rs): the notice the shell has every window show,
// and the settings' rows for it — there only where the install looks for a newer version.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const posted = [];
const w = await loadPage(ACTIVE, (win) => { win.__TAURI_INTERNALS__ = {}; win.MdHost = { post: (m) => posted.push(JSON.parse(m)) }; });
after(() => w.close());
const $ = (s) => w.document.querySelector(s);
const said = (type) => posted.filter((m) => m.type === type);

test("downloaded: the notice says the version, and its buttons say what to do — Later takes it away", () => {
  w.MdView.updateNotice({ version: "0.1.5", kind: "restart", url: "https://github.com/henriSchulz/mdview/releases/tag/v0.1.5" });
  const n = $("#update");
  assert.ok(n.hasAttribute("data-open"));
  assert.match(n.textContent, /Markdown Notes 0\.1\.5 is available/);
  assert.deepEqual([...n.querySelectorAll("button")].map((b) => b.textContent), ["What's new", "Later", "Restart to Update"]);
  n.querySelector('[data-act="notes"]').click();
  assert.deepEqual(said("link").at(-1), { type: "link", href: "https://github.com/henriSchulz/mdview/releases/tag/v0.1.5" });
  n.querySelector('[data-act="restart"]').click();
  assert.equal(said("update-restart").length, 1);
  assert.ok(n.querySelector('[data-act="restart"]').disabled, "pressed once: not again");
  n.querySelector('[data-act="later"]').click();
  assert.equal(said("update-later").length, 1);
  w.MdView.updateNotice(null); // (the shell takes it away in every window)
  assert.ok(!n.hasAttribute("data-open"));
  assert.ok(!w.document.body.hasAttribute("data-update"));
});

test("a .deb or an .rpm: Download opens the download page, nothing is restarted", () => {
  w.MdView.updateNotice({ version: "0.1.5", kind: "download", url: "https://md.henrischulz.com/download", notes: "https://github.com/henriSchulz/mdview/releases/tag/v0.1.5" });
  const n = $("#update");
  assert.deepEqual([...n.querySelectorAll("button")].map((b) => b.dataset.act), ["notes", "later", "download"]);
  n.querySelector('[data-act="download"]').click();
  assert.deepEqual(said("link").at(-1), { type: "link", href: "https://md.henrischulz.com/download" });
  w.MdView.updateNotice(null);
});

test("the notice is the app's chrome: the note does not take its clicks", async () => {
  const { readFileSync } = await import("node:fs");
  const { ROOT } = await import("./harness.mjs");
  assert.match(readFileSync(ROOT + "/active/blocks.js", "utf8"), /const CHROME = "[^"]*#update[,"]/);
  assert.match(readFileSync(ROOT + "/viewer/menus.js", "utf8"), /t\.closest\("[^"]*#update"\)\) return;/);
});

test("the settings: no rows for updates where the install looks for none (a checkout's build, the web)", () => {
  w.MdActive.prefs.open("about");
  w.MdView.settingsInfo({ version: "abc1234 · 2026-10-25" });
  for (const key of ["updateCheck", "updateAuto"]) assert.ok($(`#settings .pf-row[data-key="${key}"]`).hidden, key);
  w.MdActive.prefs.close();
});

test("the settings: the version, how the last look went, and Check Now", () => {
  w.MdActive.prefs.open("about");
  w.MdView.settingsInfo({ update: { install: "appimage", version: "0.1.4", state: "current" } });
  const row = $('#settings .pf-row[data-key="updateCheck"]');
  assert.ok(!row.hidden && !$('#settings .pf-row[data-key="updateAuto"]').hidden);
  assert.match(row.textContent, /Version 0\.1\.4 — up to date/);
  const button = row.querySelector("button");
  assert.equal(button.textContent, "Check Now");
  button.click();
  assert.equal(said("update-check").length, 1);
  w.MdView.settingsInfo({ update: { install: "appimage", version: "0.1.4", state: "checking" } });
  assert.ok(button.disabled);
  w.MdView.settingsInfo({ update: { install: "appimage", version: "0.1.4", state: "failed", why: "network unreachable" } });
  assert.match(row.textContent, /Couldn't check for updates: network unreachable/);
  assert.ok(!button.disabled);
  w.MdView.settingsInfo({ update: { install: "appimage", version: "0.1.4", state: "ready", latest: "0.1.5" } });
  assert.match(row.textContent, /0\.1\.5 is ready/);
  assert.equal(button.textContent, "Restart to Update");
  button.click();
  assert.equal(said("update-restart").length, 2);
  // "Check for updates automatically": on by itself, and a change is kept by the application
  const auto = $('#settings .pf-row[data-key="updateAuto"] input');
  assert.ok(auto.checked);
  auto.checked = false;
  auto.dispatchEvent(new w.Event("change"));
  assert.deepEqual(said("prefs").at(-1), { type: "prefs", prefs: { updateAuto: false } });
  w.MdActive.prefs.close();
});
