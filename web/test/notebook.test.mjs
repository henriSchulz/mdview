// A notebook (board/paper.js, #27): a whiteboard of pages, as GoodNotes has them — made from the
// sidebar's menu, its paper chosen (blank, ruled, squared, dotted), pages added, drawn on with the
// whiteboard's tools, kept in commits. The built app, a real Chromium, a GitHub of the test's own.
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
const R = "/octo/notes";
const text = (p) => gh.repo.files.get(p)?.toString();
const put = (p, t) => gh.repo.files.set(p, Buffer.from(t));

before(async () => {
  put("Alpha.md", "# Alpha\n\nfirst paragraph\n");
  put(".mdview/project.json", '{"id":"x","version":1}\n');
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "ignore" });
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
  await context.addInitScript(() => { if (!localStorage.getItem("mdview:set")) localStorage.setItem("mdview:set", JSON.stringify({ historyQuiet: 1, sidebarLayout: "source" })); });
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  if (process.env.DEBUG_WEB) page.on("console", (m) => console.log("  [page]", m.text()));
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const until = async (f, what, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`not within ${ms} ms: ${what}`); };
const menu = () => page.evaluate(() => [...document.querySelectorAll("#ctxmenu[data-open] .menu-item")].filter((e) => !e.hidden).map((e) => e.dataset.cmd));
const boardOpen = () => page.waitForFunction(() => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready"), null, { timeout: 15000 });
const book = () => page.evaluate(() => MdBoard.state().book);
const head = () => JSON.parse((text("Heft.board.svg") || "").split("\n").find((l) => l.startsWith('{"board"')) || "{}");
const shown = (sel) => page.evaluate((s) => { const b = document.querySelector(s); return !!b && getComputedStyle(b).display !== "none"; }, sel);

test("a notebook is made from the sidebar's menu: pages of paper, the paper chosen, pages added, drawn on, kept", async () => {
  await page.goto(`${base}/r/octo/notes?n=Alpha.md`);
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name === "Alpha.md", null, { timeout: 15000 });
  await page.evaluate(() => { if (document.body.dataset.sidebar !== "open") document.querySelector('#tabs [data-act="sidebar"]').click(); });
  await page.evaluate(() => MdPage.sbList.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 600 })));
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  assert.deepEqual((await menu()).filter((c) => !c.startsWith("sort:")).slice(0, 4), ["newnote", "newfolder", "newboard", "newbook"]);
  await page.click('#ctxmenu[data-open] .menu-item[data-cmd="newbook"]');
  await page.waitForSelector("#newdlg[data-open] #new-name", { timeout: 4000 });
  assert.equal(await page.textContent("#new-title"), "New Notebook");
  await page.fill("#new-name", "Heft");
  await page.keyboard.press("Enter");
  await boardOpen();
  await until(() => text("Heft.board.svg") !== undefined, "the notebook's file in the repository");
  // one squared page of A4 to begin with: in the file's head, and as a sheet under the board
  assert.deepEqual(head().paper, { bg: "grid", color: "white", size: "a4", n: 1 });
  assert.deepEqual(await book(), { pages: 1, bg: "grid", color: "white", drawn: [1] });
  assert.equal(await page.locator("#board .bd-paper .bd-sheet > svg").count(), 1);
  assert.ok(await page.evaluate(() => document.getElementById("board").hasAttribute("data-book")));
  assert.equal(await page.textContent("#board .bd-name"), "Heft");
  assert.ok(await shown('#board [data-do="paper"]'), "the paper's button");
  assert.ok(!(await shown('#board [data-do="grid"]')), "no dots over the paper");
  assert.ok(!(await shown('#board [data-do="connect"]')), "no connectors in a notebook");
  assert.ok(await shown('#board .bd-actions [data-do="page"]'), "a page more, in the bar at the top");
  assert.ok(await shown("#board .bd-addpage"), "… and under the last page");
  // the paper: GoodNotes' writing papers, each a small page in its menu, and its colours — for every page
  await page.waitForTimeout(500);
  await page.click('#board [data-do="paper"]');
  await page.waitForSelector('#board .bd-vpop[data-open] [data-paper="dots"]', { timeout: 4000 });
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#board .bd-vpop [data-paper]")].map((b) => [b.dataset.paper, b.querySelector("span").textContent, b.getAttribute("aria-checked") === "true", !!b.querySelector("svg g.paper")])),
    [["blank", "Blank", false, true], ["dots", "Dotted", false, true], ["grid", "Squared", true, true], ["narrow", "Narrow Ruled", false, true], ["wide", "Wide Ruled", false, true], ["legal", "Legal", false, true], ["cornell", "Cornell", false, true], ["music", "Music", false, true]]);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("#board .bd-vpop [data-tone]")].map((b) => [b.dataset.tone, b.getAttribute("aria-checked") === "true"])), [["white", true], ["yellow", false], ["dark", false]]);
  await page.click('#board .bd-vpop [data-paper="dots"]');
  assert.equal((await book()).bg, "dots");
  assert.equal(await page.locator('#board .bd-sheet[data-paper="dots"]').count(), 1);
  await page.click('#board .bd-vpop [data-tone="dark"]');
  assert.equal((await book()).color, "dark");
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#board .bd-world")).color), "rgb(242, 242, 247)"); // (on dark paper the ink is light)
  assert.equal(await page.evaluate(() => document.querySelector('#board [data-fav][data-ink="auto"]').style.getPropertyValue("--ink")), "#f2f2f7"); // (… and so is its well)
  await page.keyboard.press("Control+z");
  assert.deepEqual([(await book()).bg, (await book()).color], ["dots", "white"]);
  // a page more: from the same menu, from +, from the bar at the top, from the sheet under the last page — undone and done again like any change
  if (!(await page.evaluate(() => document.querySelector("#board .bd-vpop").hasAttribute("data-open")))) await page.click('#board [data-do="paper"]'); // (still open from before the undo)
  await page.click('#board .bd-vpop [data-m="page"]');
  assert.equal((await book()).pages, 2);
  await page.click('#board [data-do="plus"]');
  await page.click('#board .bd-vpop [data-m="page"]');
  assert.equal((await book()).pages, 3);
  await page.click('#board .bd-actions [data-do="page"]');
  assert.equal((await book()).pages, 4);
  const items = await page.evaluate(() => MdBoard.state().items);
  await page.click("#board .bd-addpage");
  assert.equal((await book()).pages, 5);
  assert.equal(await page.evaluate(() => MdBoard.state().items), items, "no stroke begun on it");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  assert.equal((await book()).pages, 3);
  await page.keyboard.press("Control+z");
  assert.equal((await book()).pages, 2);
  assert.equal(await page.locator("#board .bd-sheet").count(), 2);
  // (… and the view back on the last page, not where the one taken away lay)
  const inSight = () => page.evaluate(() => { const s = [...document.querySelectorAll("#board .bd-sheet")].at(-1).getBoundingClientRect(); return s.top < innerHeight / 2 && s.bottom > innerHeight / 2; });
  assert.ok(await inSight(), "the last page in the middle of the window");
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+z");
  assert.equal((await book()).pages, 2);
  // drawn on with the whiteboard's pen, in the page's ink whatever the theme
  await page.click('#board [data-kind="pen"]');
  await page.mouse.move(500, 300);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(500 + i * 8, 300 + Math.sin(i / 2) * 30);
  await page.mouse.up();
  await until(() => head().paper && head().paper.n === 2 && (text("Heft.board.svg") || "").split("\n").some((l) => l.startsWith('{"id"')), "the pages and the stroke in a commit", 12000);
  assert.deepEqual(head().paper, { bg: "dots", color: "white", size: "a4", n: 2 });
  // the file's picture is the first page: its paper and what is on it
  assert.match(text("Heft.board.svg"), /<g class="paper"><rect [^>]*fill="#ffffff"\/><path [^>]*stroke-linecap="round"/);
  // shut and opened again from its row: as it was left
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !MdBoard.shown && document.getElementById("board").hidden, null, { timeout: 5000 });
  await page.locator(`#sidebar .sb-item[data-key="${R}/Heft.board.svg"] .sb-row`).first().click();
  await boardOpen();
  assert.deepEqual(await book(), { pages: 2, bg: "dots", color: "white", drawn: [1, 2] });
  assert.equal(await page.evaluate(() => MdBoard.state().items), 1);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !MdBoard.shown, null, { timeout: 5000 });
  // a whiteboard is no notebook: no pages, no paper's button
  await page.evaluate(() => MdPage.sbList.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 600 })));
  await page.waitForSelector("#ctxmenu[data-open]", { timeout: 4000 });
  await page.click('#ctxmenu[data-open] .menu-item[data-cmd="newboard"]');
  await page.waitForSelector("#newdlg[data-open] #new-name", { timeout: 4000 });
  await page.fill("#new-name", "Tafel");
  await page.keyboard.press("Enter");
  await boardOpen();
  await page.waitForFunction(() => MdBoard.state().ref.endsWith("Tafel.board.svg"), null, { timeout: 8000 });
  assert.equal(await book(), null);
  assert.equal(await page.locator("#board .bd-sheet").count(), 0);
  assert.ok(!(await shown('#board [data-do="paper"]')));
  assert.ok(await shown('#board [data-do="grid"]'));
  assert.ok(await shown('#board [data-do="connect"]'));
  assert.ok(!(await shown('#board [data-do="page"]')));
  assert.deepEqual(problems, []);
});

test("what is pulled to the window's edge takes the board along: a stroke moved down onto the next page", async () => {
  if (await page.evaluate(() => MdBoard.shown)) { await page.keyboard.press("Escape"); await page.waitForFunction(() => !MdBoard.shown, null, { timeout: 5000 }); }
  await page.evaluate((p) => MdPage.openBoardFile(p), `${R}/Heft.board.svg`);
  await boardOpen();
  await page.waitForFunction(() => MdBoard.state().book && MdBoard.state().items === 1, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.click('#board [data-kind="lasso"]');
  await page.keyboard.press("Control+a");
  const box = await page.evaluate(() => MdBoard.state().chosenBox), v0 = await page.evaluate(() => MdBoard.state().view);
  assert.ok(box, "the stroke chosen");
  // taken by its middle and pulled to the lower edge, the hand held still there
  const st = await page.evaluate(() => { const b = document.querySelector("#board .bd-stage").getBoundingClientRect(); return { left: b.left, top: b.top, h: b.height }; });
  const from = [st.left + ((box[0] + box[2]) / 2 - v0.x) * v0.z, st.top + ((box[1] + box[3]) / 2 - v0.y) * v0.z], to = [from[0], st.top + st.h - 8];
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from[0], from[1] + ((to[1] - from[1]) * i) / 12);
  // (held there until the board has run a good way — however slowly frames come on a busy machine)
  const ran = () => page.evaluate((y0) => MdBoard.state().view.y - y0, v0.y);
  await until(async () => (await ran()) > 200, "the board running down under the hand", 8000);
  await page.mouse.up();
  const v1 = await page.evaluate(() => MdBoard.state().view); // (after the hand let go: the board stops where it is)
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => MdBoard.state().view)).y, v1.y, "let go: the board stops");
  const after = await page.evaluate(() => MdBoard.state().chosenBox), hand = (to[1] - from[1]) / v0.z;
  assert.ok(v1.y - v0.y > 150, `the board ran down under the hand (${v0.y} → ${v1.y})`);
  // the stroke went as far as the hand and the board together: still under the hand
  assert.ok(after[1] - box[1] > hand + 150, `the stroke went with the board (${after[1] - box[1]} > ${hand})`);
  assert.ok(Math.abs(after[1] - box[1] - (hand + v1.y - v0.y)) < 40, "… as far as both");
  // a hand that rests away from the edge moves nothing
  const v2 = await page.evaluate(() => MdBoard.state().view);
  await page.mouse.move(640, 450);
  await page.mouse.down();
  await page.mouse.move(660, 470);
  await page.waitForTimeout(300);
  await page.mouse.up();
  assert.equal((await page.evaluate(() => MdBoard.state().view)).y, v2.y);
  assert.deepEqual(problems, []);
});

test("a page is put in before or after another, or deleted, from its menu — what is on the pages moves with them", async () => {
  if (await page.evaluate(() => MdBoard.shown)) { await page.keyboard.press("Escape"); await page.waitForFunction(() => !MdBoard.shown, null, { timeout: 5000 }); }
  await page.evaluate((p) => MdPage.openBoardFile(p), `${R}/Heft.board.svg`);
  await boardOpen();
  await page.waitForFunction(() => MdBoard.state().book && MdBoard.state().items === 1, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.click('#board [data-kind="lasso"]');
  const strokeTop = async () => { await page.keyboard.press("Control+a"); const b = await page.evaluate(() => MdBoard.state().chosenBox); await page.keyboard.press("Escape"); return b[1]; };
  const pages = () => page.evaluate(() => MdBoard.state().book.pages);
  const n0 = await pages(), top0 = await strokeTop(), step = await page.evaluate(() => { const s = document.querySelectorAll("#board .bd-sheet"); return s[1].offsetTop - s[0].offsetTop; });
  assert.ok(step > 1000, "A4 and its gap");
  const pageOfStroke = Math.min(n0 - 1, Math.max(0, Math.floor(top0 / step))); // (0-based: the page the stroke is on — below the last one: that one)
  // a right click on the bare page the stroke is on: the page's rows in the board's menu
  const sheet = await page.evaluate((i) => { const r = document.querySelectorAll("#board .bd-sheet")[i].getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, pageOfStroke);
  await page.mouse.click(sheet[0] + 30, Math.max(sheet[1] + 30, 120), { button: "right" });
  const item = (label) => page.locator(".menu-item", { hasText: label }).first();
  await item("Insert Page Before").waitFor({ timeout: 4000 });
  assert.ok(await item("Insert Page After").isVisible());
  assert.ok(await item("Delete Page").isEnabled());
  await item("Insert Page Before").click();
  await until(async () => (await pages()) === n0 + 1, "the page put in (once the row has blinked)", 3000);
  assert.ok(Math.abs((await strokeTop()) - (top0 + step)) < 2, "the stroke went down with its page");
  // taken back: the page out again, the stroke where it was
  await page.keyboard.press("Control+z");
  assert.equal(await pages(), n0);
  assert.ok(Math.abs((await strokeTop()) - top0) < 1);
  // a page put in after it leaves the stroke where it is
  await page.evaluate((i) => MdBoard.page("after", i), pageOfStroke);
  assert.equal(await pages(), n0 + 1);
  assert.ok(Math.abs((await strokeTop()) - top0) < 1);
  await page.keyboard.press("Control+z");
  // the page deleted: the stroke on it goes with it; one step back brings both
  await page.evaluate((i) => MdBoard.page("delete", i), pageOfStroke);
  assert.equal(await pages(), n0 - 1);
  assert.equal(await page.evaluate(() => MdBoard.state().items), 0);
  await page.keyboard.press("Control+z");
  assert.equal(await pages(), n0);
  assert.equal(await page.evaluate(() => MdBoard.state().items), 1);
  // a page above it deleted: the stroke moves up with its page
  if (pageOfStroke > 0) {
    await page.evaluate(() => MdBoard.page("delete", 0));
    assert.ok(Math.abs((await strokeTop()) - (top0 - step)) < 2, "the stroke went up with its page");
    await page.keyboard.press("Control+z");
  }
  // … and from the paper's menu (a tablet has no right click): the page in sight
  await page.click('#board [data-do="paper"]');
  assert.ok(await page.locator('#board .bd-vpop [data-m="page-del"]').isEnabled());
  await page.click('#board .bd-vpop [data-m="page-del"]');
  assert.equal(await pages(), n0 - 1);
  await page.keyboard.press("Control+z");
  await until(() => head().paper && head().paper.n === n0, "kept as it was after the steps back", 8000);
  assert.deepEqual(problems, []);
});
