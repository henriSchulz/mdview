// The sidebar's notes are in the order of their names until another order is chosen — on the
// desktop and in the browser alike (the page's default, the shell's, the web app's).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadPage } from "./harness.mjs";

const root = new URL("../../", import.meta.url), read = (f) => readFileSync(new URL(f, root), "utf8");

test("by name, where nothing else was chosen", async () => {
  const w = await loadPage();
  w.MdPrefs = {};
  assert.equal(w.MdPage.sortKey(), "name");
  w.MdPrefs = { sidebarSort: "opened" };
  assert.equal(w.MdPage.sortKey(), "opened"); // (what was chosen stays)
  assert.match(read("src-tauri/src/shell.rs"), /"sidebarSort": "name",/);
  assert.match(read("web/lib/page.ts"), /sidebarSort: "name",/);
  assert.match(read("active/prefs.js"), /sidebarSort: "name",/);
});
