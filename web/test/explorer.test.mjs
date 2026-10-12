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
  await context.addInitScript(() => { if (!localStorage.getItem("mdview:set")) localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1 })); }); // (a commit a second after the last change)
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
const allNotes = async () => { if (!(await page.evaluate(() => !!(window.MdOverview && MdOverview.isOpen)))) await page.keyboard.press("Control+Alt+g"); await page.waitForFunction(() => window.MdOverview && MdOverview.isOpen, null, { timeout: 8000 }); };

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

test("All Notes › Whiteboards: every whiteboard of the repository with the note that shows it, all, embedded or not; one a note keeps becomes a file of its own", async () => {
  await open("Alpha.md");
  await allNotes();
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#overview [data-seg="scope"] .ov-opt')].map((o) => o.dataset.v)), ["all", "folders", "boards"]);
  await page.click('#overview [data-seg="scope"] .ov-opt[data-v="boards"]');
  await page.waitForFunction(() => document.querySelectorAll("#overview .ov-item").length === 3, null, { timeout: 8000 });
  assert.deepEqual(await tiles(), [["assets/kept.board.svg", "In “Beta”", true], ["Plan.board.svg", "In “Alpha”", false], ["sub/Loose.board.svg", "In no note", false]]);
  assert.equal(await page.evaluate(() => document.querySelector("#overview .ov-count").textContent), "3 whiteboards");
  await page.click('#overview [data-seg="boards"] .ov-opt[data-v="embedded"]');
  assert.deepEqual((await tiles()).map((t) => t[0]), ["assets/kept.board.svg", "Plan.board.svg"]);
  await page.click('#overview [data-seg="boards"] .ov-opt[data-v="loose"]');
  assert.deepEqual((await tiles()).map((t) => t[0]), ["sub/Loose.board.svg"]);
  await page.click('#overview [data-seg="boards"] .ov-opt[data-v="all"]');
  // the view is the setting's (ovScope): All Notes opens in it the next time
  assert.equal(await page.evaluate(() => MdPrefs.ovScope), "boards");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !MdOverview.isOpen, null, { timeout: 4000 });
  await allNotes();
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

test("nothing was refused or thrown along the way", () => {
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/.test(p)), []);
});
