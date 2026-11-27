// A note's own ground (its property "background") in a real browser, in the look the app comes with (#60):
// it is what lies around the note — the body and the band under the tabs let it through — and each kind is drawn.
// Run: npm run build && npm test
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, page;
const problems = []; // what the browser complained of: a script refused, an error thrown

const files = {
  "Bg.md": "---\nbackground: cyan\n---\n\n# A note on a ground\n\n" + "Some text of a paragraph.\n\n".repeat(40),
};

before(async () => {
  for (const [p, text] of Object.entries(files)) gh.repo.files.set(p, Buffer.from(text));
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  // signed in as a browser would be: to GitHub and back, the cookie kept
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  const session = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  assert.ok(browserPath && existsSync(browserPath), "no Chromium found (set CHROMIUM)");
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  // (the tests here go to notes by their rows in the sidebar: the sheets, the default before the library, have them — the library has only folders: library.test.mjs)
  await context.addInitScript(() => { localStorage.setItem("mdview:library-first", "1"); if (!localStorage.getItem("mdview:set")) localStorage.setItem("mdview:set", JSON.stringify({ sidebarLayout: "sheets" })); });
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });


test("a note's ground shows around it, under the tabs too, whatever its kind", async () => {
  await page.goto(`${base}/r/octo/notes?n=Bg.md`);
  await page.waitForFunction(() => document.documentElement.dataset.docBg === "cyan" && document.body.hasAttribute("data-tabs"), null, { timeout: 15000 });
  await page.waitForTimeout(800); // (the body's colour glides)
  const now = await page.evaluate(() => ({ look: document.documentElement.dataset.look, body: getComputedStyle(document.body).backgroundColor, band: getComputedStyle(document.body, "::after").backgroundImage }));
  assert.equal(now.look, "velum");
  assert.equal(now.body, "rgba(0, 0, 0, 0)", "the body covers the ground");
  const drawn = await page.evaluate(() => ["cyan", "dots", "grid", "lines"].map((g) => {
    document.documentElement.dataset.docBg = g;
    const of = (el, part) => getComputedStyle(el, part).backgroundImage;
    return { g, ground: of(document.documentElement, "::before"), band: of(document.body, "::after") };
  }));
  for (const { g, ground, band } of drawn) {
    assert.notEqual(ground, "none", `${g}: no picture around the note`);
    assert.equal(band, ground, `${g}: the band under the tabs is not of the ground`);
  }
});
