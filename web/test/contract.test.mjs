// The seam, checked: what the page says and is told (read from its own files) against the list
// in host/contract.ts, and that list against what the web host does. A message the page learns
// to say, or the host forgets to answer, fails here instead of doing nothing in the browser.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), ".."), root = join(web, "..");
const read = (...p) => readFileSync(join(...p), "utf8");
const page = [...["viewer.js", "overview.js", "pdfview.js", "board.js"].map((f) => read(root, f)), ...readdirSync(join(root, "active")).filter((f) => f.endsWith(".js")).map((f) => read(root, "active", f))].join("\n");
const contract = read(web, "host", "contract.ts"), host = read(web, "public", "host", "host.js");

// the two lists of the contract: name → what the web host does with it
const list = (name) => {
  const body = contract.slice(contract.indexOf(`export const ${name}`)), out = new Map();
  for (const m of body.slice(0, body.indexOf("\n};")).matchAll(/^\s*(?:"([^"]+)"|([A-Za-z]\w*)): \["(answer|write|local|none)"/gm)) out.set(m[1] || m[2], m[3]);
  return out;
};
const fromPage = list("FROM_PAGE"), toPage = list("TO_PAGE");
const on = host.slice(host.indexOf("  const on = {"), host.indexOf("  function hear("));
const handled = new Set([...on.matchAll(/^    (?:async )?(?:"([^"]+)"|([A-Za-z]\w*))\(/gm)].map((m) => m[1] || m[2]));
const told = new Set([...host.matchAll(/\btell\("(\w+)"/g)].map((m) => m[1]));
const DEV = ["log", "probe", "probe-pointer", "snapshot-done"]; // (the rig's own, said only when it runs)

test("everything the page says is in the contract", () => {
  const said = new Set([...page.matchAll(/\bpost\("([a-z-]+)"/g), ...page.matchAll(/JSON\.stringify\(\{ type: "([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(said.size > 40, String(said.size));
  assert.deepEqual([...said].filter((t) => !fromPage.has(t) && !DEV.includes(t)).sort(), []);
});

test("what the contract says the web host does, it does — and nothing it says it leaves", () => {
  const does = [...fromPage].filter(([, d]) => d !== "none").map(([t]) => t);
  assert.deepEqual(does.filter((t) => !handled.has(t)).sort(), []);
  assert.deepEqual([...handled].filter((t) => !fromPage.has(t) || fromPage.get(t) === "none").sort(), []);
});

test("the host tells the page only what the contract has, and what the page can be told", () => {
  const api = page.slice(page.indexOf("window.MdView = {")), can = (n) => new RegExp(`[{,]\\s*${n}\\b`).test(api.slice(0, api.indexOf("};")));
  assert.deepEqual([...told].filter((n) => !toPage.has(n) || toPage.get(n) === "none" || !can(n)).sort(), []);
  assert.deepEqual([...toPage.keys()].filter((n) => !can(n)).sort(), []); // (nothing in the contract the page does not have)
  // what the host is to tell and never does: an answer that would not come
  assert.deepEqual([...toPage].filter(([n, d]) => d !== "none" && !told.has(n)).map(([n]) => n).sort(), []);
});
