// The page under a finger where WebKitGTK shows it — the application on Linux (Henri, 2026-10-24: a tablet's fingers on the
// Mac's screen, over mac-cast): the built app in Chromium that says it is WebKitGTK (its user agent), so that the page does
// what it does there (viewer/hand.js). What WebKitGTK itself does with fingers is checked in WebKitGTK: dev/rig.sh gtktouch.
// - a PDF's pages: one finger moves them and throws them on, two size them around the middle between them (not a whole
//   window made larger: the app's page is not to be pinched, user-scalable=no — without the PDF's own fingers nothing changes);
// - a finger in use makes the PDF's bar and a whiteboard's bars a finger's size, though the pointer is said to be a fine one;
//   a wheel turned makes them a mouse's again.
// Run: npm run build && npm test
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(web, "..", "dev", "tests", "tauri-check");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const GTK = "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"; // (WebKitGTK's own)
const gh = fakeGitHub();
let app, base, browser, session;
const problems = [];

before(async () => {
  gh.repo.files.set("Home.md", Buffer.from("# Home\n\n[[paper.pdf]]\n"));
  gh.repo.files.set("paper.pdf", readFileSync(join(fixtures, "paper.pdf")));
  gh.repo.files.set(".mdview/project.json", Buffer.from("{\"id\":\"x\",\"version\":1}"));
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", NEXT_TELEMETRY_DISABLED: "1", APP_ORIGIN: base }, stdio: "ignore" });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  session = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  assert.ok(browserPath && existsSync(browserPath), "no Chromium found (set CHROMIUM)");
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});
after(async () => { await browser?.close(); app?.kill(); gh.close(); assert.deepEqual(problems, []); });

// a window of Henri's tablet's size, in WebKitGTK's name; with fingers or without
async function device(touch) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: touch, deviceScaleFactor: 2, userAgent: GTK });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto(`${base}/r/octo/notes?n=paper.pdf`);
  await page.waitForFunction(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length && MdPdf.shown.pages[0].state === "done", null, { timeout: 20000 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.MdHand && MdHand.GTK), "the page takes itself to be in WebKitGTK");
  return { context, page };
}

test("linux: a finger moves a PDF's pages and throws them on; two fingers size them, what lay between them staying there", async () => {
  const { context, page: p } = await device(true), cdp = await context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const fingers = async (from, to, { steps = 10, rest = 120, gap = 16 } = {}) => {
    await touch("touchStart", from);
    for (let i = 1; i <= steps; i++) { await touch("touchMove", from.map(([x, y], k) => [x + ((to[k][0] - x) * i) / steps, y + ((to[k][1] - y) * i) / steps])); if (gap) await p.waitForTimeout(gap); }
    if (rest) await p.waitForTimeout(rest);
    await touch("touchEnd", []);
  };
  // (pages enough to move through: the PDF made larger by the bar's button first)
  for (let i = 0; i < 6; i++) await p.click('.pdf-bar [data-do="in"]');
  await p.waitForTimeout(400);
  const y0 = await p.evaluate(() => scrollY);
  await fingers([[640, 600]], [[640, 300]]);
  await p.waitForTimeout(300);
  const y1 = await p.evaluate(() => scrollY);
  assert.ok(Math.abs(y1 - y0 - 300) <= 12, `the pages followed the finger, and stayed where it let go: ${y0} → ${y1}`);
  // thrown: let go while moving fast, they go on after it
  await fingers([[640, 600]], [[640, 450]], { steps: 4, rest: 0, gap: 0 });
  await p.waitForTimeout(900);
  const y2 = await p.evaluate(() => scrollY);
  assert.ok(y2 - y1 > 150 + 120, `thrown, the pages went on after the finger: ${y1} → ${y2}`);
  // two fingers brought together: half as far apart, half the size; the place under the middle between them stays under it
  const under = () => p.evaluate(() => { const v = MdPdf.shown, pg = v.pages.find((x) => x.div.getBoundingClientRect().bottom > 400), r = pg.div.getBoundingClientRect(); return { n: pg.n, fx: (640 - r.left) / r.width, fy: (400 - r.top) / r.height, scale: v.scale }; });
  const was = await under();
  await fingers([[480, 400], [800, 400]], [[560, 400], [720, 400]]);
  await p.waitForTimeout(400);
  const now = await p.evaluate((n) => { const v = MdPdf.shown, r = v.pages[n - 1].div.getBoundingClientRect(); return { fx: (640 - r.left) / r.width, fy: (400 - r.top) / r.height, scale: v.scale }; }, was.n);
  assert.ok(Math.abs(now.scale / was.scale - 0.5) < 0.05, `half as far apart, half the size: ${was.scale} → ${now.scale}`);
  assert.ok(Math.abs(now.fx - was.fx) < 0.03 && Math.abs(now.fy - was.fy) < 0.03, `what lay under the middle stays under it: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
  // a tap on the bar is still a click
  const z = await p.evaluate(() => MdPdf.shown.scale);
  const b = await p.evaluate(() => { const r = document.querySelector('.pdf-bar [data-do="out"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.touchscreen.tap(b[0], b[1]);
  await p.waitForTimeout(300);
  assert.ok((await p.evaluate(() => MdPdf.shown.scale)) < z, "a tap on Zoom out zooms out");
  await context.close();
});

test("linux: a finger in use makes the PDF's bar and a whiteboard's a finger's size, a wheel a mouse's again", async () => {
  const { context, page: p } = await device(false);
  assert.ok(await p.evaluate(() => !matchMedia("(pointer: coarse)").matches), "a pointer said to be a fine one, as WebKitGTK says it");
  const sizes = (sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((b) => b.offsetWidth && getComputedStyle(b).visibility !== "hidden").map((b) => Math.min(b.offsetWidth, b.offsetHeight)), sel);
  // (a finger, as WebKitGTK tells of one: a pointer of a touch screen)
  const tap = (sel) => p.evaluate((q) => { const t = document.querySelector(q), r = t.getBoundingClientRect(), o = { bubbles: true, pointerType: "touch", pointerId: 9, isPrimary: true, clientX: r.left + 4, clientY: r.top + 4 }; t.dispatchEvent(new PointerEvent("pointerdown", o)); t.dispatchEvent(new PointerEvent("pointerup", o)); }, sel);
  const small = Math.min(...(await sizes(".pdf-bar .tb")));
  assert.ok(small < 40, `a mouse's size first: ${small}`);
  await tap(".pdf-pages .pdf-page");
  assert.ok(await p.evaluate(() => document.documentElement.hasAttribute("data-finger")), "the hand is a finger");
  const pdf = await sizes(".pdf-bar .tb");
  assert.ok(pdf.length >= 6 && Math.min(...pdf) >= 40, `the PDF's bar a finger's size: ${pdf}`);
  await p.click('.pdf-bar [data-do="draw"]');
  await p.waitForFunction(() => window.MdBoard && MdBoard.shown && document.querySelector("#board[data-open]") && MdBoard.state().pdf, null, { timeout: 15000 });
  await p.waitForTimeout(700);
  await tap("#board .bd-stage");
  const board = await sizes("#board .bd-bar .bd-btn, #board .bd-tool");
  assert.ok(board.length >= 6 && Math.min(...board) >= 40, `the whiteboard's bars a finger's size: ${board}`);
  // a wheel turned (no finger on the screen, none a moment before): a mouse's again
  await p.waitForTimeout(1600);
  await p.mouse.move(640, 500);
  await p.mouse.wheel(0, 40);
  await p.waitForTimeout(200);
  assert.ok(!(await p.evaluate(() => document.documentElement.hasAttribute("data-finger"))), "a wheel: the hand is no finger");
  assert.ok(Math.min(...(await sizes("#board .bd-bar .bd-btn"))) < 40, "the whiteboard's bars a mouse's size again");
  await context.close();
});
