// The welcome page's app with ?samples=1: a PDF of many pages and whiteboards to try on a tablet, kept in the window's
// memory — drawn on a PDF and on a whiteboard, left and opened again, what was drawn is there. Without the flag the
// welcome page's notes are as they were.
// Run: npm run build && npm test          (SHOT_DIR=/dir keeps pictures of every state)
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const SHOTS = process.env.SHOT_DIR || "";
let app, base, browser;
const problems = [];

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", NEXT_TELEMETRY_DISABLED: "1", APP_ORIGIN: base }, stdio: "ignore" });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/welcome/app?view=write")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(browserPath && existsSync(browserPath), "no Chromium found (set CHROMIUM)");
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});
after(async () => { await browser?.close(); app?.kill(); });

async function ipad() {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, deviceScaleFactor: 2, userAgent: IPAD_UA });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const stroke = async (pts) => { await touch("touchStart", [pts[0]]); for (const q of pts.slice(1)) { await touch("touchMove", [q]); await page.waitForTimeout(12); } await touch("touchEnd", []); await page.waitForTimeout(300); };
  return { context, page, stroke };
}
const center = (page, fn) => page.evaluate((src) => { const e = new Function("return " + src)()(); if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 20), r.top + r.height / 2]; }, fn.toString());
const tapAt = async (page, at, ms = 2500) => { assert.ok(at, "there to tap"); await page.touchscreen.tap(at[0], at[1]); await page.waitForTimeout(ms); };
const shot = async (page, what) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `samples-${what}.png`) }); };
const wave = (y) => Array.from({ length: 30 }, (_, i) => [400 + i * 9, y + Math.sin(i / 3) * 25]);

test("without the flag the welcome page's notes are as they were", async () => {
  const { context, page } = await ipad();
  await page.goto(base + "/welcome/app?view=write");
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name, null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => MdView.core.current.name), "Welcome.md");
  assert.equal(await page.evaluate(() => /Lecture\.pdf|board\.svg/.test(document.body.innerHTML)), false, "no samples");
  await context.close();
});

test("?samples=1 on an iPad: a PDF drawn on keeps what was drawn; a whiteboard drawn on keeps it, and the note shows it so", async () => {
  const { context, page, stroke } = await ipad();
  await page.goto(base + "/welcome/app?view=write&samples=1");
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name, null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => MdView.core.current.name), "PDF and whiteboard.md");
  assert.ok(await page.evaluate(() => document.querySelectorAll("#content .pdfv, #content img").length >= 2), "the PDF's page and part, and the whiteboard, in the note");
  // the PDF: opened, drawn on with a finger, left, and opened again
  await tapAt(page, await center(page, () => [...document.querySelectorAll("#content a")].find((a) => /Lecture/.test(a.textContent))), 3000);
  assert.deepEqual(await page.evaluate(() => [MdView.core.current.name, document.querySelectorAll(".pdf-page").length]), ["Lecture.pdf", 15], "the PDF, all its pages");
  await tapAt(page, await center(page, () => document.querySelector('[data-do="draw"]')));
  assert.equal(await page.evaluate(() => !!(window.MdBoard && MdBoard.shown)), true, "drawing on it");
  await tapAt(page, await center(page, () => [...document.querySelectorAll("#board button")].find((b) => b.getAttribute("aria-label") === "Pens" && b.offsetParent)), 400);
  await stroke(wave(450));
  await shot(page, "pdf-drawn");
  await tapAt(page, await center(page, () => document.querySelector('#board [data-do="back"]')));
  assert.ok(await page.evaluate(() => document.querySelectorAll(".pdf-ink").length) > 0, "what was drawn lies on the PDF");
  await shot(page, "pdf-after");
  // the whiteboard: back to the note, opened, drawn on, left
  await page.goto(base + "/welcome/app?view=write&samples=1"); // (a new window: the board as the server has it)
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name, null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  await tapAt(page, await center(page, () => [...document.querySelectorAll("#content a")].find((a) => /Sketch/.test(a.textContent))));
  assert.equal(await page.evaluate(() => !!(window.MdBoard && MdBoard.shown)), true, "the whiteboard opened");
  await tapAt(page, await center(page, () => [...document.querySelectorAll("#board button")].find((b) => b.getAttribute("aria-label") === "Pens" && b.offsetParent)), 400);
  await stroke(wave(650));
  await tapAt(page, await center(page, () => document.querySelector('#board [data-do="back"]')));
  assert.equal(await page.evaluate(() => !!(window.MdBoard && MdBoard.shown)), false, "left");
  const img = await page.evaluate(() => { const i = [...document.querySelectorAll("#content img")].find((x) => x.dataset.board || /board\.svg/.test(x.src)); return i && i.src.startsWith("blob:"); });
  assert.equal(img, true, "the note shows the whiteboard as drawn here");
  // opened again: what was drawn is there (its text has one more line of ink)
  const lines = await page.evaluate(() => new Promise((ok) => { const id = "t" + Date.now(); const was = MdBoard.answer; MdBoard.answer = (i, text, err) => { if (i === id) { MdBoard.answer = was; ok((text.match(/"k":"ink"/g) || []).length); } else was(i, text, err); }; MdHost.post(JSON.stringify({ type: "board-read", path: "/welcome/notes/Sketch.board.svg", id })); }));
  assert.equal(lines, 4, "three strokes of the sample and the one drawn");
  await shot(page, "board-after");
  await context.close();
});

test("nothing was refused or thrown along the way", () => { assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource/.test(p)), []); });
