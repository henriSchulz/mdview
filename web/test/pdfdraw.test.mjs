// Drawing on a PDF (Henri, 2026-10-30, #15: "die tools auf der rechten Seite flackern kurz beim Öffnen des Modus"): the PDF's
// controls in the toolbar fade out as the board's bars fade in; they were gone in one frame, with nothing yet in their place.
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
  gh.repo.files.set("Blocks.md", Buffer.from("# Blocks\n\n" + Array.from({ length: 24 }, (_, i) => `Paragraph ${i + 1} of the note, with enough words in it to fill a line and wrap onto the next one.`).join("\n\n") + "\n"));
  gh.repo.files.set("Bold.md", Buffer.from("# Bold\n\n" + Array.from({ length: 16 }, (_, i) => `Paragraph ${i + 1} of the note, with enough words in it to fill a line and wrap onto the next one.`).join("\n\n") + "\n"));
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


test("opening the drawing on a PDF: the toolbar's controls fade, they are not gone in one frame (#15)", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto(`${base}/r/octo/notes?n=paper.pdf`);
  await page.waitForFunction(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length && MdPdf.shown.pages[0].state === "done", null, { timeout: 20000 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pdf-bar .tb:not([data-do="draw"])')).display !== "none"), true, "the control is there");
  await page.evaluate(() => { window.__seen = []; const t0 = performance.now(); const tick = () => { const e = document.querySelector('.pdf-bar .tb:not([data-do="draw"])'), cs = getComputedStyle(e); window.__seen.push([Math.round(performance.now() - t0), cs.display, +cs.opacity]); if (performance.now() - t0 < 700) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.click('.pdf-bar [data-do="draw"]');
  await page.waitForTimeout(900);
  const seen = await page.evaluate(() => window.__seen);
  const shown = seen.filter((s) => s[1] !== "none");
  assert.ok(shown.some((s) => s[2] > 0 && s[2] < 1), "a frame with the control half faded: " + JSON.stringify(seen.slice(0, 12)));
  assert.equal(seen[seen.length - 1][1], "none", "and in the end it is gone");
  assert.equal(await page.evaluate(() => document.body.hasAttribute("data-pdf-fading")), false);
  // pressed again, the toolbar is whole again
  await page.click('.pdf-bar [data-do="draw"]');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pdf-bar .tb:not([data-do="draw"])')).display !== "none"), true);
  await context.close();
});
