// Search (viewer/search.js): Ctrl+K in a folder window on the desktop. The shell hands over the notes that have every word
// (search.rs); the page takes them apart into the blocks the reading view draws and opens a note at the line of the block.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { loadPage } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const opened = [];
after(() => { for (const w of opened) w.close(); });

const NOTE = "---\ntitle: Dini\n---\n# Dini's theorem\n\nIntro without the word.\n\n## Proof\n\nThe **uniform** limit holds.\n\n- an item\n- [ ] redo the uniform proof\n- [x] done\n\n> [!note] Uniform\n> callout text\n\n```js\nconst uniform = 1;\n```\n";
const OTHER = "# Sheet\n\nNothing here but the word UNIFORM in capitals.\n";

async function page(desktop = true) {
  const posted = [];
  const w = await loadPage([], (win) => { if (desktop) win.__TAURI_INTERNALS__ = {}; win.MdHost = { post: (m) => posted.push(JSON.parse(m)) }; win.Element.prototype.scrollIntoView = () => {}; });
  opened.push(w);
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {} });
  w.MdView.render({ name: "a.md", path: "/x/a.md", text: "# A\n\nbody\n", links: {}, base: "file:///x/" });
  await sleep(30);
  const notes = [{ name: "dini.md", path: "/x/dini.md", real: "/x/dini.md", mtime: 2, opened: 1 }, { name: "sheet.md", path: "/x/sub/sheet.md", real: "/x/sub/sheet.md", mtime: 1 }];
  w.MdView.setFolder({ root: "/x", name: "x", tree: { name: "x", path: "/x", dirs: [{ name: "sub", path: "/x/sub", dirs: [], notes: [notes[1]] }], notes: [notes[0], { name: "a.md", path: "/x/a.md", real: "/x/a.md" }] } });
  await sleep(50);
  return { w, P: w.MdPage, posted, box: w.document.getElementById("search") };
}
const key = (w, el, k, more = {}) => el.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, ...more }));
async function ask(w, posted, q, answer) {
  const input = w.document.querySelector("#search input");
  input.value = q;
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  await sleep(150);
  const asked = posted.filter((m) => m.type === "search").pop();
  assert.equal(asked.q, q);
  w.MdView.searchResults(asked.id, answer);
  await sleep(30);
}
const rows = (box) => [...box.querySelectorAll(".sr-list .sr-h, .sr-list .sr-row")]
  .map((r) => (r.classList.contains("sr-h") ? "# " + r.textContent : [...r.children].map((c) => c.textContent.trim()).filter(Boolean).join(" ")).replace(/\s+/g, " "));

test("Ctrl+K in a folder window on the desktop opens Search, and the shell reads the notes at once", async () => {
  const { w, P, posted, box } = await page();
  key(w, w.document.body, "k", { ctrlKey: true });
  assert.ok(box.hasAttribute("data-open"));
  assert.ok(!w.document.getElementById("palette").hasAttribute("data-open"));
  assert.deepEqual(posted.filter((m) => m.type === "search").map((m) => m.q), [""]);
  assert.deepEqual(rows(box).slice(0, 2), ["# Recent", "dini x"]); // (the one opened last first)
  key(w, box.querySelector("input"), "Escape");
  assert.ok(!box.hasAttribute("data-open"));
  assert.ok(P.searchHere());
});

test("the notes found are taken apart into the blocks the reading view draws; each block has every word", async () => {
  const { w, P, posted, box } = await page();
  P.openPalette();
  await ask(w, posted, "uniform", { notes: [{ path: "/x/dini.md", text: NOTE, mtime: 2 }, { path: "/x/sub/sheet.md", text: OTHER, mtime: 1 }], found: 2 });
  const all = rows(box);
  assert.deepEqual(all.slice(0, 3), ["# Notes", "dini The uniform limit holds.", "sheet …but the word UNIFORM in capitals."]); // (a line cut so that the word shows)
  P.closeSearch(); P.openSearch();
  key(w, box.querySelector("input"), "Tab"); key(w, box.querySelector("input"), "Tab"); // (All → Notes → Blocks)
  await ask(w, posted, "uniform", { notes: [{ path: "/x/dini.md", text: NOTE, mtime: 2 }, { path: "/x/sub/sheet.md", text: OTHER, mtime: 1 }], found: 2 });
  const blocks = rows(box);
  assert.equal(blocks[0], "# Blocks");
  assert.equal(blocks.length, 1 + 5, blocks.join("\n")); // a paragraph, a task, the callout, the code (dini), the paragraph (sheet)
  assert.ok(blocks.some((r) => r === "dini › Proof redo the uniform proof"), blocks.join("\n"));
  assert.ok(!blocks.some((r) => /an item|Intro/.test(r)));
  assert.match(box.querySelector(".sr-seg [data-scope=blocks] i").textContent, /^5$/);
  // the words marked in the row
  assert.equal(box.querySelector(".sr-row.hl mark").textContent.toLowerCase(), "uniform");
  // the note's name as its first heading is the note, not a block of it; words that stand apart are no block
  await ask(w, posted, "sheet", { notes: [{ path: "/x/sub/sheet.md", text: OTHER, mtime: 1 }], found: 1 });
  assert.deepEqual(rows(box), []);
  assert.match(box.querySelector(".sr-none").textContent, /No single block has all of/);
});

test("Enter opens the note at the line of the block (Ctrl+Enter in a new tab); the note on screen only goes there", async () => {
  const { w, P, posted, box } = await page();
  P.openSearch();
  key(w, box.querySelector("input"), "Tab"); key(w, box.querySelector("input"), "Tab");
  await ask(w, posted, "redo uniform", { notes: [{ path: "/x/dini.md", text: NOTE, mtime: 2 }], found: 1 });
  assert.deepEqual(rows(box), ["# Blocks", "dini › Proof redo the uniform proof"]);
  key(w, box.querySelector("input"), "Enter", { ctrlKey: true });
  const open = posted.filter((m) => m.type === "note").pop();
  // (line 12 of the file, counted from 0 — as the reading view's data-line has it, the properties above included)
  assert.deepEqual(open, { type: "note", path: "/x/dini.md", tab: true, fragment: "^line=12" });
  assert.equal(NOTE.split("\n")[12], "- [ ] redo the uniform proof");
  assert.ok(!box.hasAttribute("data-open"));
  // the note on screen: nothing is asked of the shell
  P.openSearch();
  await ask(w, posted, "body", { notes: [{ path: "/x/a.md", text: "# A\n\nbody\n", mtime: 3 }], found: 1 });
  const before = posted.length;
  key(w, box.querySelector("input"), "ArrowDown");
  key(w, box.querySelector("input"), "Enter");
  assert.equal(posted.slice(before).filter((m) => m.type === "note").length, 0);
});

test("the note at the right is drawn with each block's line, scrolled to the one found, the words marked", async () => {
  const { w, P, posted, box } = await page();
  P.openSearch();
  await ask(w, posted, "redo uniform", { notes: [{ path: "/x/dini.md", text: NOTE, mtime: 2 }], found: 1 });
  key(w, box.querySelector("input"), "ArrowDown"); // (from the note to its block)
  await sleep(50);
  const at = box.querySelector(".sr-doc .sr-at");
  assert.ok(at, box.querySelector(".sr-doc").innerHTML.slice(0, 300));
  assert.match(at.textContent, /redo the uniform proof/);
  assert.equal(box.querySelector(".sr-doc input[data-line]"), null); // (a box in the look inside is no box of the note on screen)
  assert.equal(box.querySelector(".sr-where").textContent, "dini");
});

test("an answer to an earlier question is not drawn over the later one", async () => {
  const { w, P, posted, box } = await page();
  P.openSearch();
  const input = box.querySelector("input");
  input.value = "uni"; input.dispatchEvent(new w.Event("input")); await sleep(150);
  const first = posted.filter((m) => m.type === "search").pop();
  input.value = "uniform"; input.dispatchEvent(new w.Event("input")); await sleep(150);
  w.MdView.searchResults(first.id, { notes: [{ path: "/x/sub/sheet.md", text: OTHER, mtime: 1 }], found: 1 });
  await sleep(20);
  assert.deepEqual(rows(box).slice(0, 2), ["# Recent", "dini x"]);
});

test("in the browser Ctrl+K stays Go to: nothing is asked of a host that has no search", async () => {
  const { w, P, posted, box } = await page(false);
  assert.ok(!P.searchHere());
  P.openPalette();
  assert.ok(!box.hasAttribute("data-open"));
  assert.equal(posted.filter((m) => m.type === "search").length, 0);
});
