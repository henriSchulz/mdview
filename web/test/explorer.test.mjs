// Working with files in the browser, as the desktop app's list does it: whiteboards that are
// files of their own (All Notes › Whiteboards), what is put out of sight, copies, and files from
// elsewhere — each a commit to the repository. The built app, a real Chromium, a GitHub of the
// test's own.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, context, page;
const problems = [];
const R = "/octo/notes", ATTACH = ".mdview/attachments.json", HIDDEN = ".mdview/hidden.json";
const text = (p) => gh.repo.files.get(p)?.toString();
const put = (p, t) => gh.repo.files.set(p, Buffer.from(t));
const BOARD = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><metadata id="mdview-board"><![CDATA[\n]]></metadata></svg>\n'; // (enough for a tile: never opened)

before(async () => {
  put("Alpha.md", "# Alpha\n\nfirst paragraph\n");
  put("Beta.md", "# Beta\n\n![](assets/kept.board.svg)\n");
  put("assets/kept.board.svg", BOARD);
  put("sub/Loose.board.svg", BOARD);
  put("assets/pic.png", "not a picture");
  put("node_modules/x/index.js", "0");
  put(ATTACH, JSON.stringify({ "assets/kept.board.svg": "Beta.md", "assets/pic.png": "Beta.md" }, null, 2) + "\n");
  put(".mdview/project.json", '{"id":"x","version":1}\n');
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  const cookie = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: cookie.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await context.addInitScript(() => { if (!localStorage.getItem("mdview:set")) localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1, sidebarLayout: "source" })); }); // (a commit a second after the last change; the list as a tree — the sheets, the default, fetch a picture to show it)
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("dialog", (d) => d.accept());
  if (process.env.DEBUG_WEB) { page.on("console", (m) => console.log("  [page]", m.text())); page.on("response", (r) => { if (/\/api\//.test(r.url())) console.log("  [api]", r.status(), r.url().replace(base, "")); }); }
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const untilNote = (name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
const post = (m) => page.evaluate((m) => MdHost.post(JSON.stringify(m)), m);
const until = async (f, what, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`not within ${ms} ms: ${what}`); };
const open = async (note) => {
  if (page.url().startsWith(base)) await page.evaluate(() => localStorage.setItem("mdview:mode", '"read"'));
  await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(note)}`);
  await untilNote(note);
};
// the sidebar's rows, as paths below the repository (a folder's with a stroke; what is shown dimmed with a star)
const rows = () => page.evaluate((R) => [...new Set([...document.querySelectorAll("#sidebar .sb-item")].map((el) => el.dataset.key.slice(R.length + 1) + (el.classList.contains("is-dir") ? "/" : "") + (el.classList.contains("is-hidden") || el.querySelector(".sb-row.is-hidden") ? "*" : "")))].sort(), R); // (a note opened lately has a second row, under Recent)
// the menu of a right click, as it stands open: its entries' commands
const menu = () => page.evaluate(() => [...document.querySelectorAll("#ctxmenu[data-open] .menu-item")].filter((e) => !e.hidden).map((e) => e.dataset.cmd));
// a right click in the list's empty room: new things, in the repository itself
const blank = async () => { await page.evaluate(() => MdPage.sbList.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 600 }))); await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 }); };
const choose = async (cmd) => { await page.click(`#ctxmenu[data-open] .menu-item[data-cmd="${cmd}"]`); await page.waitForFunction(() => !document.querySelector("#ctxmenu[data-open]"), null, { timeout: 4000 }); };
const row = (r) => page.locator(`#sidebar .sb-item[data-key="${R}/${r}"] > :first-child .sb-row, #sidebar .sb-item[data-key="${R}/${r}"] .sb-row`).first();
const boardOpen = (items) => page.waitForFunction((n) => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready") && (n == null || MdBoard.state().items === n), items ?? null, { timeout: 15000 });
const boardShut = async () => { await page.keyboard.press("Escape"); await page.waitForFunction(() => !MdBoard.shown && document.getElementById("board").hidden, null, { timeout: 5000 }); };
const tiles = () => page.evaluate((R) => [...document.querySelectorAll("#overview .ov-item")].map((t) => [t.dataset.path.slice(R.length + 1), t.querySelector(".ov-sub, .ov-snip").textContent, t.dataset.kept != null]), R);
const allNotes = async () => {
  if (!(await page.evaluate(() => !!(window.MdOverview && MdOverview.isOpen)))) await page.keyboard.press("Control+Alt+g");
  await page.waitForFunction(() => window.MdOverview && MdOverview.isOpen, null, { timeout: 8000 });
  // (the sidebar lies over All Notes' first sheets: shut, for the pointer to reach them — viewer/drawer.js)
  if (await page.evaluate(() => { const was = document.body.dataset.sidebar === "open"; MdPage.showSidebar(false, false); return was; })) await page.waitForTimeout(100); // (not kept: the next page has it open)
};

test("a whiteboard is made as a file from the sidebar's menu, drawn on, kept in commits, opened from its row and shown in a note", async () => {
  await open("Alpha.md");
  // what a note keeps is the note's: in no list of the repository — a whiteboard that is a file is
  assert.deepEqual(await rows(), ["Alpha.md", "Beta.md", "sub/", "sub/Loose.board.svg"]);
  await blank();
  assert.deepEqual((await menu()).filter((c) => !c.startsWith("sort:")).slice(0, 3), ["newnote", "newfolder", "newboard"]);
  await choose("newboard");
  await page.waitForSelector("#newdlg[data-open] #new-name", { timeout: 4000 });
  await page.fill("#new-name", "Plan");
  await page.keyboard.press("Enter");
  await boardOpen(0);
  await until(() => text("Plan.board.svg") !== undefined, "the board's file in the repository");
  assert.match(text("Plan.board.svg"), /<metadata id="mdview-board">/);
  assert.deepEqual([gh.commits.at(-1).headline, gh.commits.at(-1).added], ["Plan.board.svg", ["Plan.board.svg"]]);
  assert.equal(JSON.parse(text(ATTACH))["Plan.board.svg"], undefined); // (no note's: a file of its own)
  await page.waitForTimeout(700); // (grown to the window's size)
  await page.click('#board [data-kind="pen"]');
  await page.mouse.move(400, 400);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) await page.mouse.move(400 + i * 10, 400 + Math.sin(i / 2) * 40);
  await page.mouse.up();
  const strokes = () => (text("Plan.board.svg") || "").split("\n").filter((l) => l.startsWith('{"id"')).length;
  await until(() => strokes() === 1, "the stroke in a commit", 12000);
  await boardShut();
  // its row: listed under its name, with the sign of its kind — a click opens it over the window
  assert.ok((await rows()).includes("Plan.board.svg"));
  assert.equal(await row("Plan.board.svg").innerText(), "Plan");
  await row("Plan.board.svg").click();
  await boardOpen(1);
  await boardShut();
  // … and its menu puts it into the note on screen, at the caret (the file stays its own)
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await page.click("#active p");
  await row("Plan.board.svg").click({ button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  const has = await menu();
  for (const cmd of ["embed", "rename", "trash", "download"]) assert.ok(has.includes(cmd), `${cmd} in ${has}`);
  for (const cmd of ["default", "openwith", "reveal", "copypath", "boardnote", "boardfree"]) assert.ok(!has.includes(cmd), `no ${cmd} in ${has}`); // (the desktop's own, and a kept board's)
  await choose("embed");
  await until(() => (text("Alpha.md") || "").includes("![](Plan.board.svg)"), "the note names the board");
  await page.waitForFunction(() => [...document.querySelectorAll("#active img")].some((i) => /Plan\.board\.svg/.test(i.dataset.board || i.src)), null, { timeout: 8000 });
  assert.equal(JSON.parse(text(ATTACH))["Plan.board.svg"], undefined);
});

test("All Notes: a tile keeps the pose it has under the pointer while its menu is open on it (the pointer is on the menu then; the tile used to fall back and rise again)", async () => {
  await open("Alpha.md");
  await allNotes();
  await page.click('#overview [data-seg="scope"] .ov-opt[data-v="folders"]');
  const tile = page.locator("#overview .ov-item[data-dir]").first();
  await tile.waitFor({ timeout: 8000 });
  const pose = () => page.evaluate(() => { const t = document.querySelector("#overview .ov-item[data-dir]"); return [...t.querySelectorAll(".ov-stack > i")].map((i) => getComputedStyle(i).transform); });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(700);
  const rest = await pose();
  await tile.screenshot({ path: join(web, ".next", "stack.png") });
  await tile.hover();
  await page.waitForTimeout(700);
  const raised = await pose();
  assert.notDeepEqual(raised, rest, "the stack opens under the pointer");
  await tile.click({ button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  await page.waitForTimeout(700);
  assert.deepEqual(await pose(), raised, "…and stays open while the menu is on it");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#ctxmenu[data-open]"), null, { timeout: 4000 });
});

test("All Notes › Whiteboards: every whiteboard of the repository with the note that shows it, all of them alike; one a note keeps becomes a file of its own", async () => {
  await open("Alpha.md");
  await allNotes();
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#overview [data-seg="scope"] .ov-opt')].map((o) => o.dataset.v)), ["all", "folders", "boards"]); // (the pasteboard: a tab of its own — paste.test.mjs)
  await page.click('#overview [data-seg="scope"] .ov-opt[data-v="boards"]');
  await page.waitForFunction(() => document.querySelectorAll("#overview .ov-item").length === 3, null, { timeout: 8000 });
  assert.deepEqual(await tiles(), [["assets/kept.board.svg", "In “Beta”", true], ["Plan.board.svg", "In “Alpha”", false], ["sub/Loose.board.svg", "In no note", false]]);
  assert.equal(await page.evaluate(() => document.querySelector("#overview .ov-count").textContent), "3 whiteboards");
  assert.equal(await page.evaluate(() => !!document.querySelector('#overview [data-seg="boards"]')), false); // (no choice among them: all of them)
  // All Notes opens on the folders the next time, whatever was shown last
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !MdOverview.isOpen, null, { timeout: 4000 });
  await allNotes();
  await page.waitForFunction(() => document.querySelector("#overview").dataset.scope === "folders", null, { timeout: 8000 });
  await page.click('#overview [data-seg="scope"] .ov-opt[data-v="boards"]');
  await page.waitForFunction(() => document.querySelector("#overview").dataset.scope === "boards" && document.querySelectorAll("#overview .ov-item").length === 3, null, { timeout: 8000 });
  // a tile's picture is the board's, from the repository
  await page.waitForFunction(() => { const i = document.querySelector('#overview .ov-item[data-path$="Plan.board.svg"] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 });
  // a board a note keeps: its menu leads to the note, or makes it a file of its own
  await page.click('#overview .ov-item[data-path$="kept.board.svg"]', { button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  assert.deepEqual(await menu(), ["open", "embed", "boardnote", "boardfree", "sub:show"]); // (nothing that would take it from its note)
  await choose("boardfree");
  await until(() => text(ATTACH) !== undefined && !("assets/kept.board.svg" in JSON.parse(text(ATTACH))), "the board is no note's any more");
  await page.waitForFunction(() => { const t = document.querySelector('#overview .ov-item[data-path$="kept.board.svg"]'); return t && t.dataset.kept == null; }, null, { timeout: 8000 });
  assert.deepEqual((await tiles())[0], ["assets/kept.board.svg", "In “Beta”", false]);
  // a click on a tile opens the board over the window
  await page.click('#overview .ov-item[data-path$="Plan.board.svg"]');
  await boardOpen(1);
  await boardShut();
  await page.click('#overview [data-seg="scope"] .ov-opt[data-v="all"]');
  await page.keyboard.press("Escape");
  assert.ok((await rows()).includes("assets/kept.board.svg"), String(await rows())); // (listed from now on)
});

test("Show › Hidden Items lists what is put away, dimmed: what a note keeps, names with a dot, what tools make", async () => {
  await open("Alpha.md");
  const usual = await rows();
  assert.ok(!usual.some((r) => /pic\.png|^\.mdview|node_modules/.test(r)), String(usual));
  await row("Alpha.md").click({ button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  await page.click('#ctxmenu [data-cmd="sub:show"]');
  await page.waitForSelector("#ctxsub[data-open]", { timeout: 4000 });
  await page.click('#ctxsub [data-pref="showHidden"]');
  await page.waitForFunction(() => document.querySelector("#sidebar .sb-item.is-hidden"), null, { timeout: 8000 });
  const all = await rows();
  for (const r of [".mdview/*", ".mdview/attachments.json*", "assets/", "assets/pic.png*", "node_modules/*", "Alpha.md", "sub/Loose.board.svg"]) assert.ok(all.includes(r), `${r} in ${all}`);
  assert.ok(!all.some((r) => r.startsWith("node_modules/x")), String(all)); // (named, not gone into)
  // … and the settings have the same switch
  await page.keyboard.press("Control+,");
  await page.waitForFunction(() => { const s = document.querySelector("#settings"); return s && s.hasAttribute("data-open"); }, null, { timeout: 15000 });
  await page.click('#settings .st-nav[data-page="sidebarPage"]');
  assert.equal(await page.evaluate(() => { const r = document.querySelector('.pf-row[data-key="showHidden"]'); return r.offsetParent !== null && r.querySelector("input").checked; }), true);
  await page.keyboard.press("Escape");
  await post({ type: "prefs", prefs: { showHidden: false } });
  await until(async () => JSON.stringify(await rows()) === JSON.stringify(usual), "the list as it was");
});

test("a file and a folder are hidden from their menus: kept in .mdview/hidden.json as the desktop app writes it, taken back from the message, shown again; what is hidden stays so under another name and is named no more once it is deleted", async () => {
  put("Gamma.md", "# Gamma\n");
  put("doc.pdf", "%PDF-1.4\n");
  put("arch/Old.md", "# Old\n");
  put("arch/in/Older.md", "# Older\n");
  await open("Alpha.md");
  const hidden = () => (text(HIDDEN) === undefined ? null : JSON.parse(text(HIDDEN)).hidden);
  const lists = async (...names) => { const all = await rows(); return names.map((n) => all.includes(n)); };
  // a file's menu: Hide — a commit of the list alone, and the row is gone
  await row("Gamma.md").click({ button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  assert.deepEqual([(await menu()).includes("hide"), (await menu()).includes("unhide")], [true, false]);
  await choose("hide");
  await until(async () => !(await lists("Gamma.md"))[0], "the row gone");
  await until(() => text(HIDDEN) !== undefined, "the list in the repository");
  assert.equal(text(HIDDEN), '{\n  "version": 1,\n  "hidden": [\n    "Gamma.md"\n  ]\n}\n'); // (byte for byte what hidden.rs writes)
  assert.deepEqual([gh.commits.at(-1).added, gh.commits.at(-1).deleted], [[HIDDEN], []]);
  assert.equal(text("Gamma.md"), "# Gamma\n"); // (out of sight, not gone)
  // Undo in the message that says so: with nothing hidden there is no file
  await post({ type: "hide", paths: [`${R}/Gamma.md`] }); // (said once more: the message stands anew)
  await page.waitForFunction(() => /is hidden/.test(document.querySelector("#toast").textContent) && document.querySelector("#toast button"), null, { timeout: 4000 });
  await page.click("#toast button");
  await until(async () => (await lists("Gamma.md"))[0], "the row back");
  await until(() => text(HIDDEN) === undefined, "no list any more");
  // several at once, a folder among them: one commit, and all that is in the folder goes with it
  const before = gh.commits.length;
  await post({ type: "hide", paths: [`${R}/Gamma.md`, `${R}/arch`, "/elsewhere/x.md", `${R}/Nothing.md`], on: true });
  await until(() => (hidden() || []).length === 2, "both in the list");
  assert.deepEqual(hidden(), ["Gamma.md", "arch"]);
  assert.equal(gh.commits.length, before + 1);
  assert.deepEqual(await lists("Gamma.md", "arch/", "arch/Old.md", "doc.pdf"), [false, false, false, true]);
  // what another device hid (the desktop app writes the same file) is hidden here
  put(HIDDEN, JSON.stringify({ version: 1, hidden: ["Gamma.md", "arch", "doc.pdf"] }, null, 2) + "\n");
  await post({ type: "sync-now" });
  await until(async () => !(await lists("doc.pdf"))[0], "what was hidden elsewhere");
  // Hidden Items: listed dimmed, with Show Again in the menu
  await post({ type: "prefs", prefs: { showHidden: true } });
  await until(async () => (await lists("Gamma.md*"))[0], "the hidden rows, dimmed");
  assert.deepEqual(await lists("arch/*", "arch/Old.md*", "arch/in/*", "doc.pdf*", "Alpha.md"), [true, true, true, true, true]);
  await row("Gamma.md").click({ button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  assert.deepEqual([(await menu()).includes("hide"), (await menu()).includes("unhide")], [false, true]);
  await choose("unhide");
  await until(() => JSON.stringify(hidden()) === '["arch","doc.pdf"]', "shown again");
  assert.deepEqual(await lists("Gamma.md", "Gamma.md*"), [true, false]);
  // a hidden folder renamed stays hidden; a hidden file deleted is named no more
  await post({ type: "rename", path: `${R}/arch`, name: "attic" });
  await until(() => JSON.stringify(hidden()) === '["attic","doc.pdf"]' && text("attic/in/Older.md") !== undefined, "the folder, renamed and still hidden");
  await post({ type: "trash", path: `${R}/doc.pdf` });
  await until(() => JSON.stringify(hidden()) === '["attic"]' && text("doc.pdf") === undefined, "the deleted file out of the list");
  await post({ type: "trash", path: `${R}/attic` });
  await until(() => text(HIDDEN) === undefined && text("attic/Old.md") === undefined, "the folder gone, and the list with it");
  await post({ type: "prefs", prefs: { showHidden: false } });
});

// what GitHub was asked since a point: whether a file's bytes went over the line, down or up
const transferred = (since, name) => gh.seen.slice(since).map(([path]) => decodeURIComponent(path)).filter((path) => path.endsWith("/git/blobs") || (path.includes("/contents/") && path.endsWith(name)));

test("a large file moved, and a folder renamed: the row stands at its new place at once, and the commit names the blobs the repository has — nothing of them is fetched or sent", async () => {
  gh.repo.files.set("big.bin", Buffer.alloc(30 * 1024 * 1024, 7)); // (more than a commit takes as contents, twice over)
  put("stuff/a.png", "a picture, as far as anyone looks");
  put("stuff/n.md", "# N\n");
  await open("Alpha.md");
  const before = gh.commits.length, since = gh.seen.length;
  let release;
  gh.stall = new Promise((r) => { release = r; }); // (GitHub takes its time over the commit)
  await post({ type: "move", path: `${R}/big.bin`, dir: `${R}/sub` });
  await until(() => gh.stall === null, "the commit on its way");
  assert.deepEqual([(await rows()).includes("sub/big.bin"), (await rows()).includes("big.bin"), gh.commits.length], [true, false, before]); // (the page first: GitHub has not answered yet)
  release();
  await until(() => gh.repo.files.has("sub/big.bin") && !gh.repo.files.has("big.bin"), "the move in the repository");
  assert.deepEqual([gh.commits.length, gh.commits.at(-1).linked, gh.commits.at(-1).deleted, gh.commits.at(-1).headline], [before + 1, ["sub/big.bin"], ["big.bin"], "2 files: big.bin, big.bin"]);
  assert.equal(gh.repo.files.get("sub/big.bin").length, 30 * 1024 * 1024);
  assert.deepEqual(transferred(since, "big.bin"), []);
  // a folder under another name: every file in it by its blob, in one commit
  await post({ type: "rename", path: `${R}/stuff`, name: "things" });
  await until(() => text("things/n.md") !== undefined && text("stuff/n.md") === undefined, "the folder, renamed");
  assert.deepEqual([gh.commits.length, [...gh.commits.at(-1).linked].sort(), [...gh.commits.at(-1).deleted].sort()], [before + 2, ["things/a.png", "things/n.md"], ["stuff/a.png", "stuff/n.md"]]);
  assert.deepEqual(transferred(since, "a.png"), []);
});

test("a commit GitHub will not take: what was moved is put back and said; one that only fails is tried again, and what waits for it survives a reload", async () => {
  await open("Alpha.md");
  const before = gh.commits.length;
  gh.refuse = 403; // (no right to write: trying again mends nothing)
  await post({ type: "move", path: `${R}/sub/big.bin`, dir: R });
  await until(async () => (await rows()).includes("big.bin"), "the row at its new place");
  await until(async () => (await rows()).includes("sub/big.bin") && !(await rows()).includes("big.bin"), "the row back where the repository has the file");
  assert.match(await page.evaluate(() => document.querySelector("#toast").textContent), /did not take the change to “big\.bin”/);
  assert.deepEqual([gh.commits.length, gh.repo.files.has("sub/big.bin"), gh.repo.files.has("big.bin")], [before, true, false]);
  // the line broke, the server stumbled: the row stays where it was put, also in a tab opened anew, and the commit follows
  gh.refuse = 500;
  await post({ type: "rename", path: `${R}/sub/big.bin`, name: "huge" });
  await until(() => gh.refuse === 0, "the commit that failed");
  assert.equal(gh.repo.files.has("sub/huge.bin"), false);
  await open("Alpha.md");
  assert.deepEqual([(await rows()).includes("sub/huge.bin"), (await rows()).includes("sub/big.bin")], [true, false]);
  await until(() => gh.repo.files.has("sub/huge.bin") && !gh.repo.files.has("sub/big.bin"), "the commit, tried again");
  assert.deepEqual(gh.commits.at(-1).linked, ["sub/huge.bin"]);
});

test("files and folders copied, cut, pasted and duplicated — from the menu and with the keys: copies under free names, one commit each, by the blobs the repository has", async () => {
  put("box/p.png", "a picture, as far as anyone looks");
  put("box/in/q.md", "# Q\n");
  await open("Alpha.md");
  const since = gh.seen.length, said = () => page.evaluate(() => document.querySelector("#toast").textContent);
  let n = gh.commits.length;
  const last = () => [gh.commits.length - n, [...(gh.commits.at(-1).linked || [])].sort(), [...gh.commits.at(-1).deleted].sort()];
  // Duplicate, from a file's menu: a copy beside it
  await row("Beta.md").click({ button: "right" });
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  for (const cmd of ["copyf", "cutf", "duplicate"]) assert.ok((await menu()).includes(cmd), cmd);
  await choose("duplicate");
  await until(async () => (await rows()).includes("Beta copy.md"), "the copy's row");
  await until(() => text("Beta copy.md") !== undefined, "the copy in the repository");
  assert.deepEqual([text("Beta copy.md"), ...last()], [text("Beta.md"), 1, ["Beta copy.md"], []]);
  // a folder and a note copied, and pasted into another folder: all that is in the folder, in one commit
  n = gh.commits.length;
  await post({ type: "copyfiles", paths: [`${R}/box`, `${R}/Beta.md`, `${R}/Nothing.md`] });
  await until(async () => (await said()) === "Copied 2 items", "the message");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "box\nBeta.md");
  await post({ type: "pastefiles", dir: `${R}/sub` });
  await until(() => text("sub/box/in/q.md") !== undefined, "the paste in the repository");
  assert.deepEqual(last(), [1, ["sub/Beta.md", "sub/box/in/q.md", "sub/box/p.png"], []]);
  assert.deepEqual([text("sub/box/p.png"), text("box/p.png"), await said()], ["a picture, as far as anyone looks", "a picture, as far as anyone looks", "Pasted 2 items"]);
  // … and once more: the next free names
  await post({ type: "pastefiles", dir: `${R}/sub` });
  await until(() => text("sub/box 2/in/q.md") !== undefined && text("sub/Beta 2.md") !== undefined, "the second paste");
  // not into itself
  await post({ type: "copyfiles", paths: [`${R}/box`] });
  await post({ type: "pastefiles", dir: `${R}/box/in` });
  await until(async () => /can't be copied into itself/.test(await said()), "the refusal");
  // the keys on a row: Ctrl+X, and Ctrl+V on a folder's row — what was cut is moved, in one commit
  n = gh.commits.length;
  await row("Beta copy.md").focus();
  await page.keyboard.press("Control+x");
  await until(async () => /^Cut “Beta copy\.md”/.test(await said()), "the cut");
  await row("box").focus();
  await page.keyboard.press("Control+v");
  await until(async () => (await rows()).includes("box/Beta copy.md") && !(await rows()).includes("Beta copy.md"), "the row moved");
  await until(() => text("box/Beta copy.md") !== undefined && text("Beta copy.md") === undefined, "the move in the repository");
  assert.deepEqual(last(), [1, ["box/Beta copy.md"], ["Beta copy.md"]]);
  await page.keyboard.press("Control+v"); // (what was cut is pasted once)
  await until(async () => (await said()) === "No files to paste", "nothing left to paste");
  // Ctrl+D on a folder's row: the folder whole
  await page.keyboard.press("Control+d");
  await until(() => text("box copy/in/q.md") !== undefined && text("box copy/p.png") !== undefined && text("box copy/Beta copy.md") !== undefined, "the folder's copy");
  // none of it took a file's bytes over the line
  assert.deepEqual([transferred(since, "p.png"), transferred(since, "q.md"), transferred(since, "Beta.md")], [[], [], []]);
  // the empty room's menu has Paste; All Notes' tiles the same entries
  await blank();
  assert.ok((await menu()).includes("pastef"));
  await page.keyboard.press("Escape");
});

// files let go on a row of the list, as a browser hands them over: [name, size or text]
const dropOn = (r, files) => page.evaluate(([key, files]) => {
  const dt = new DataTransfer();
  for (const [name, what] of files) dt.items.add(new File([typeof what === "number" ? new Uint8Array(what).fill(65) : what], name));
  const on = key ? [...document.querySelectorAll("#sidebar .sb-list .sb-item")].find((el) => el.dataset.key === key).querySelector(".sb-row") : MdPage.sbList;
  for (const type of ["dragover", "drop"]) on.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
}, [r == null ? null : `${R}/${r}`, files]);
const coming = () => page.evaluate((R) => [...document.querySelectorAll("#sidebar .sb-list .sb-item.is-coming")].map((el) => el.dataset.key.slice(R.length + 1)).sort(), R);

test("files from elsewhere, dropped on the list or chosen with Add Files…: listed at once and marked as on their way, kept in a commit, under a free name; too large is said, and a refused commit takes the row away again", async () => {
  await open("Alpha.md");
  const said = () => page.evaluate(() => document.querySelector("#toast").textContent);
  let n = gh.commits.length, release;
  gh.stall = new Promise((r) => { release = r; });
  await dropOn("box", [["new.txt", "from elsewhere\n"], ["p.png", "another picture"]]);
  await until(() => gh.stall === null, "the commit on its way");
  assert.deepEqual([await coming(), gh.commits.length - n, (await rows()).includes("box/new.txt")], [["box/new.txt", "box/p 2.png"], 0, true]); // (there, marked, before GitHub has them; a name that is taken gets a number)
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#sidebar .sb-item.is-coming .sb-row"), "::after").animationDelay.split(",")[0].trim()), "0.3s"); // (the wheel only once the wait is one)
  release();
  await until(() => text("box/new.txt") !== undefined && text("box/p 2.png") !== undefined, "the files in the repository");
  assert.deepEqual([text("box/new.txt"), text("box/p 2.png"), text("box/p.png"), gh.commits.length - n, [...gh.commits.at(-1).added].sort()], ["from elsewhere\n", "another picture", "a picture, as far as anyone looks", 1, ["box/new.txt", "box/p 2.png"]]);
  await until(async () => (await coming()).length === 0, "the marks gone");
  // Add Files…, from the empty room's menu: the browser's own window for files
  await blank();
  assert.ok((await menu()).includes("addfiles"));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), choose("addfiles")]);
  await chooser.setFiles([{ name: "chosen.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n") }]);
  await until(() => text("chosen.csv") === "a,b\n", "the chosen file in the repository");
  // too large for a commit: said, and not listed
  await dropOn(null, [["huge.iso", 15 * 1024 * 1024]]);
  await until(async () => /“huge\.iso” is too large to add here \(over 14 MB\)/.test(await said()), "the refusal");
  assert.equal((await rows()).includes("huge.iso"), false);
  // more than one commit takes: two, one after the other
  n = gh.commits.length;
  await dropOn("box", [["one.bin", 9 * 1024 * 1024], ["two.bin", 9 * 1024 * 1024]]);
  await until(() => gh.repo.files.has("box/one.bin") && gh.repo.files.has("box/two.bin"), "both in the repository", 30000);
  assert.deepEqual([gh.commits.length - n, gh.repo.files.get("box/two.bin").length], [2, 9 * 1024 * 1024]);
  // a commit GitHub will not take: the row goes again, and it is said which file
  n = gh.commits.length;
  gh.refuse = 403;
  await dropOn(null, [["lost.txt", "never there"]]);
  await until(async () => /did not take the change to “lost\.txt”/.test(await said()), "the message");
  await until(async () => !(await rows()).includes("lost.txt"), "the row gone again");
  assert.deepEqual([gh.repo.files.has("lost.txt"), gh.commits.length - n], [false, 0]);
});

test("nothing was refused or thrown along the way", () => {
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
});
