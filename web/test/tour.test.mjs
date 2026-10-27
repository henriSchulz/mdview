// The tour of the controls (viewer/tour.js, issue #2: "Er hat z.B. das Inhaltsverzeichnis nicht
// gefunden"), in the built app in a real browser: it starts by itself at the first note a browser
// shows — once —, its ring stands around each control it names, the table of contents among them,
// and its card is on the screen beside it, never over it: in a wide window and on a phone, where
// the toolbar stands at the foot. In a browser a test drives it does not start by itself.
// Run: npm run build && npm test          (SHOT_DIR=/dir keeps pictures of every step)
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, session;
const problems = [];
const SHOTS = process.env.SHOT_DIR || "";
const files = {
  "Home.md": "# Home\n\nThe first note.\n\n## A part\n\ntext\n\n## Another part\n\nmore text\n",
  "Second note.md": "# The second\n\nBack to [[Home]].\n",
  ".mdview/project.json": "{\"id\":\"x\",\"version\":1}",
};
// where each step's control is (as viewer/tour.js has it)
const WHERE = {
  sidebar: '#tabs [data-act="sidebar"]', tabs: "#tabs .tab-new", overview: '#tabs [data-act="overview"]', outline: '#toolbar [data-act="outline"]',
  find: '#toolbar [data-act="find"]', share: '#toolbar [data-act="share"]', modes: "#toolbar .seg", settings: "#settings-btn",
};

before(async () => {
  for (const [p, text] of Object.entries(files)) gh.repo.files.set(p, Buffer.from(text));
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
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});
after(async () => { await browser?.close(); app?.kill(); gh.close(); });

// a browser of that size, signed in; asPerson: as someone's browser is (not driven by a test: navigator.webdriver false)
async function device(name, viewport, { touch = false, asPerson = true } = {}) {
  const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  if (asPerson) await context.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }));
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${name}: ${e}`));
  return { context, page, name };
}
const untilNote = (page, name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
const open = async (d) => { await d.page.goto(`${base}/r/octo/notes?n=Home.md`); await untilNote(d.page, "Home.md"); };
const isOpen = (page) => page.evaluate(() => !!document.querySelector("#tour[data-open]"));

/* Every step, Next after Next: its name, and once the ring has come to rest (it glides, and on a
 * phone the toolbar slides in at the foot), where the ring, the control and the card are. */
async function walk(d) {
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const step = await d.page.evaluate(() => document.getElementById("tour").dataset.step);
    const where = WHERE[step] || null;
    if (where) {
      // (the ring around the control: 6 px beside it on every side, give or take a pixel)
      await d.page.waitForFunction((q) => {
        const t = [...document.querySelectorAll(q)].find((e) => e.getBoundingClientRect().width > 0), s = document.querySelector(".tour-spot").getBoundingClientRect();
        if (!t) return false;
        const r = t.getBoundingClientRect();
        return [s.left - (r.left - 6), s.top - (r.top - 6), s.right - (r.right + 6), s.bottom - (r.bottom + 6)].every((v) => Math.abs(v) <= 1.5);
      }, where, { timeout: 5000 }).catch(() => {});
    }
    await d.page.waitForTimeout(350); // (the card glides too)
    const at = await d.page.evaluate((q) => {
      const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
      const t = q ? [...document.querySelectorAll(q)].find((e) => e.getBoundingClientRect().width > 0) : null;
      return { spot: box(document.querySelector(".tour-spot")), target: box(t), card: box(document.querySelector(".tour-card")), w: innerWidth, h: innerHeight, title: document.querySelector("#tour h2").textContent };
    }, where);
    seen.push({ step, ...at });
    if (SHOTS) await d.page.screenshot({ path: join(SHOTS, `tour-${d.name}-${i + 1}-${step}.png`) });
    const last = await d.page.evaluate(() => document.querySelector(".tour-back") && document.querySelector(".tour-skip").hidden);
    await d.page.click(".tour-next");
    if (last) break;
  }
  return seen;
}
function check(seen, label) {
  for (const s of seen) {
    const c = s.card;
    assert.ok(c.left >= 0 && c.top >= 0 && c.right <= s.w + 0.5 && c.bottom <= s.h + 0.5, `${label}, ${s.step}: the card is on the screen ${JSON.stringify(c)}`);
    if (!s.target) continue;
    const t = s.target, sp = s.spot;
    assert.ok([sp.left - (t.left - 6), sp.top - (t.top - 6), sp.right - (t.right + 6), sp.bottom - (t.bottom + 6)].every((v) => Math.abs(v) <= 1.5), `${label}, ${s.step}: the ring stands around its control ${JSON.stringify({ sp, t })}`);
    assert.ok(c.bottom <= t.top || c.top >= t.bottom || c.right <= t.left || c.left >= t.right, `${label}, ${s.step}: the card is beside its control, not over it`);
  }
}

test("a wide window: the tour starts at the first note, once; it shows the table of contents among the controls", async () => {
  const d = await device("wide", { width: 1180, height: 820 });
  try {
    await open(d);
    await d.page.waitForSelector("#tour[data-open]", { timeout: 5000 });
    const seen = await walk(d);
    const steps = seen.map((s) => s.step);
    assert.deepEqual(steps, ["welcome", "sidebar", "tabs", "overview", "outline", "find", "share", "modes", "settings", "end"]);
    assert.equal(seen.find((s) => s.step === "outline").title, "Table of contents");
    check(seen, "wide");
    assert.equal(await isOpen(d.page), false, "Done closes it");
    // (once: the next time this browser opens a note it does not come again)
    await open(d);
    await d.page.waitForTimeout(1500);
    assert.equal(await isOpen(d.page), false, "not again at the next note");
    // … but Settings › About starts it
    await d.page.click("#settings-btn");
    await d.page.waitForSelector("#settings[data-open]");
    await d.page.click('#settings .st-nav[data-page="about"]');
    await d.page.click('#settings .pf-row[data-key="tour"] button');
    await d.page.waitForSelector("#tour[data-open]", { timeout: 3000 });
    assert.equal(await d.page.evaluate(() => document.querySelector("#settings[data-open]")), null, "the settings closed for it");
    await d.page.keyboard.press("Escape");
    assert.equal(await isOpen(d.page), false, "Escape closes it");
  } finally { await d.context.close(); }
  assert.deepEqual(problems, []);
});

test("a phone: the ring finds the controls in the toolbar at the foot, and the card stands above them on the screen", async () => {
  const d = await device("phone", { width: 390, height: 844 }, { touch: true });
  try {
    await open(d);
    await d.page.waitForSelector("#tour[data-open]", { timeout: 5000 });
    const seen = await walk(d);
    const steps = seen.map((s) => s.step);
    for (const s of ["sidebar", "overview", "outline", "modes"]) assert.ok(steps.includes(s), `${s}: ${steps.join()}`);
    assert.ok(!steps.includes("settings"), "the gear is in the drawer on a phone: not on the screen, no step");
    check(seen, "phone");
    const o = seen.find((s) => s.step === "outline");
    assert.ok(o.target.top > 844 / 2 && o.card.bottom <= o.target.top, "the toolbar at the foot: the card above it");
  } finally { await d.context.close(); }
  assert.deepEqual(problems, []);
});

test("a browser a test drives: no tour by itself (it would take every click of the test)", async () => {
  const d = await device("driven", { width: 1180, height: 820 }, { asPerson: false });
  try {
    await open(d);
    await d.page.waitForTimeout(1500);
    assert.equal(await isOpen(d.page), false);
  } finally { await d.context.close(); }
});
