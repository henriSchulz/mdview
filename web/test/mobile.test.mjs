// The app on a phone and on a tablet: the built app in a real browser of that size, with a finger
// for a pointer. Nothing runs off the screen's side, the sidebar is a drawer over the note, what is
// pressed is large enough for a finger, and a long press has the menu a right click has.
// Run: npm run build && npm test          (SHOT_DIR=/dir keeps pictures of every state)
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(web, "..", "dev", "tests", "tauri-check");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, session;
const problems = [];
const SHOTS = process.env.SHOT_DIR || "";
const SIZES = { phone: { width: 390, height: 844 }, small: { width: 320, height: 568 }, tablet: { width: 820, height: 1180 }, wide: { width: 1180, height: 820 } };

const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of the long note, with enough words in it to fill a line of a phone and wrap onto the next one.`).join("\n\n");
const files = {
  "Home.md": "---\ntags: [test]\ncolor: blue\n---\n\n# Home\n\nSee [[Second note]] and [a link](sub/Deep.md#part-two).\n\n![a picture](pic.png)\n\n- [ ] a task\n- [x] done\n\n| Column one | Column two | Column three | Column four | Column five |\n|---|---|---|---|---|\n| a rather long cell | another long cell | and one more | and more | the last one |\n\n```python\ndef a_function_with_a_long_name(argument_one, argument_two, argument_three, argument_four):\n    return argument_one\n```\n\n$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2} + a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12}$$\n\n" + long + "\n",
  "Second note.md": "# The second\n\nBack to [[Home]].\n",
  "A note with a very long name that does not fit a narrow sidebar at all.md": "# Long\n",
  "sub/Deep.md": "# Deep\n\ntext\n\n## Part two\n\nmore text\n",
  ".mdview/project.json": "{\"id\":\"x\",\"version\":1}",
};

before(async () => {
  for (const [p, text] of Object.entries(files)) gh.repo.files.set(p, Buffer.from(text));
  gh.repo.files.set("pic.png", readFileSync(join(fixtures, "bild.png")));
  gh.repo.files.set("paper.pdf", readFileSync(join(fixtures, "paper.pdf")));
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

// a browser of that size, touched with a finger, signed in
async function device(name) {
  const touch = name !== "wide";
  const context = await browser.newContext({ viewport: SIZES[name], hasTouch: touch, isMobile: touch && name !== "tablet", deviceScaleFactor: 2 });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${name}: ${e}`));
  return { context, page, name };
}
const shot = async (d, what) => { if (SHOTS) await d.page.screenshot({ path: join(SHOTS, `${d.name}-${what}.png`) }); };
const untilNote = (page, name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
// nothing wider than the window: the page itself does not scroll sideways
const shownName = (page) => page.evaluate(() => MdView.core.current && MdView.core.current.name);
const sideways = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth);

const rect = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
// a finger held where it is put down (no browser's tap: down, a wait, up)
async function hold(d, sel, ms = 750) {
  const r = await rect(d.page, sel), x = Math.round(r.x + Math.min(r.w / 2, 60)), y = Math.round(r.y + r.h / 2);
  const cdp = await d.context.newCDPSession(d.page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await d.page.waitForTimeout(ms);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await d.page.waitForTimeout(250);
}
const open = async (d, note = "Home.md") => { await d.page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(note)}`); await untilNote(d.page, note); await d.page.waitForTimeout(400); };

test("nothing runs off the screen's side: the repositories, a note in each mode, All Notes, the windows", async () => {
  for (const name of ["small", "phone", "tablet", "wide"]) {
    const d = await device(name);
    await d.page.goto(base + "/"); await d.page.waitForSelector(".home-head");
    assert.ok((await sideways(d.page)) <= 0, `${name}: the repositories`); await shot(d, "home");
    await open(d);
    assert.ok((await sideways(d.page)) <= 0, `${name}: the note, read`); await shot(d, "note");
    for (const mode of ["active", "edit", "read"]) {
      await d.page.evaluate((m) => MdView.setMode(m), mode); await d.page.waitForTimeout(700);
      assert.ok((await sideways(d.page)) <= 0, `${name}: the note, ${mode}`);
      if (mode !== "read") await shot(d, mode);
    }
    await d.page.evaluate(() => MdOverview.open()); await d.page.waitForTimeout(500);
    assert.ok((await sideways(d.page)) <= 0, `${name}: All Notes`); await shot(d, "overview");
    assert.deepEqual(await d.page.evaluate(() => { const o = document.querySelector("#overview"); return o.scrollWidth <= o.clientWidth; }), true, `${name}: All Notes' own room`);
    await d.page.evaluate(() => MdOverview.close());
    // every button of the toolbar and of the strip of tabs is on the screen
    const off = await d.page.evaluate(() => [...document.querySelectorAll("#toolbar .tb, #tabs button")].filter((b) => b.offsetParent && getComputedStyle(b).display !== "none").map((b) => b.getBoundingClientRect()).filter((r) => r.width && (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1)).length);
    assert.equal(off, 0, `${name}: the toolbar's and the tabs' buttons`);
    await d.context.close();
  }
});

test("on a phone the sidebar is a drawer over the note; a note chosen in it shuts it", async () => {
  const d = await device("phone");
  await open(d);
  assert.equal(await d.page.evaluate(() => document.body.dataset.sidebar), "closed"); // (shut until it is asked for)
  const text = await rect(d.page, "#content h1");
  assert.ok(text.x < 60 && text.w > 250, "the note has the screen's width");
  await d.page.tap(".tab-side"); await d.page.waitForTimeout(700);
  const side = await rect(d.page, "#sidebar"), after = await rect(d.page, "#content h1");
  assert.equal(await d.page.evaluate(() => document.body.dataset.sidebar), "open");
  assert.ok(side.x >= 0 && side.right <= 390 && side.w >= 280, "the drawer is on the screen");
  assert.equal(Math.round(after.x), Math.round(text.x), "the note does not move aside for it");
  assert.equal(await d.page.evaluate(() => getComputedStyle(document.querySelector("#sb-scrim")).visibility), "visible");
  await shot(d, "drawer");
  // a note chosen: it shows, the drawer is shut
  await d.page.tap('.sb-row[data-real="/octo/notes/Second note.md"]'); await untilNote(d.page, "Second note.md"); await d.page.waitForTimeout(600);
  assert.equal(await d.page.evaluate(() => document.body.dataset.sidebar), "closed");
  // the shade beside it shuts it too
  await d.page.tap(".tab-side"); await d.page.waitForTimeout(600);
  await d.page.touchscreen.tap(375, 400); await d.page.waitForTimeout(600);
  assert.equal(await d.page.evaluate(() => document.body.dataset.sidebar), "closed");
  assert.equal((await shownName(d.page)), "Second note.md"); // (and nothing under the shade was pressed)
  await d.context.close();
});

test("on a tablet the sidebar stands beside the note", async () => {
  const d = await device("tablet");
  await open(d);
  await d.page.evaluate(() => { if (document.body.dataset.sidebar !== "open") document.querySelector(".tab-side").click(); }); await d.page.waitForTimeout(700);
  const side = await rect(d.page, "#sidebar"), text = await rect(d.page, "#content h1");
  assert.ok(text.x >= side.right, "the note begins beside the sidebar");
  assert.equal(await d.page.evaluate(() => getComputedStyle(document.querySelector("#sb-scrim")).display), "none");
  await d.context.close();
});

test("what a finger presses is as large as a finger, and the toolbar stands at the foot", async () => {
  const d = await device("phone");
  await open(d);
  const small = await d.page.evaluate(() => [...document.querySelectorAll("#toolbar .tb, #tabs button")].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.act || b.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 38 || h < 38));
  assert.deepEqual(small, [], "buttons under 38 px");
  const bar = await rect(d.page, "#toolbar");
  assert.ok(bar.y > 844 * 0.8 && bar.bottom <= 844 && Math.abs(bar.x + bar.w / 2 - 195) < 3, "the toolbar: at the foot, in the middle");
  await d.page.tap(".tab-side"); await d.page.waitForTimeout(600);
  const row = await rect(d.page, ".sb-row");
  assert.ok(row.h >= 40, "a row of the sidebar");
  await d.context.close();
});

test("a finger held on a row, or on the note, has the menu a right click has", async () => {
  const d = await device("phone");
  await open(d);
  await d.page.tap(".tab-side"); await d.page.waitForTimeout(600);
  await hold(d, '.sb-row[data-real="/octo/notes/Second note.md"]');
  const menu = await d.page.evaluate(() => { const m = document.querySelector("#ctxmenu"); return m.hasAttribute("data-open") ? [...m.querySelectorAll(".menu-item:not([hidden]) .menu-label")].map((e) => e.textContent) : null; });
  assert.ok(menu && menu.includes("Rename") && menu.includes("Download"), `the file's menu: ${menu}`);
  assert.equal(await shownName(d.page), "Home.md"); // (the row was not opened by the finger's lift)
  const box = await rect(d.page, "#ctxmenu");
  assert.ok(box.x >= 0 && box.right <= 390 && box.bottom <= 844, "the menu is on the screen");
  await shot(d, "menu");
  await d.page.keyboard.press("Escape"); await d.page.waitForTimeout(300);
  await d.page.evaluate(() => { if (document.body.dataset.sidebar === "open") document.querySelector("#sb-scrim").click(); }); await d.page.waitForTimeout(500);
  await hold(d, "#content h1");
  assert.equal(await d.page.evaluate(() => document.querySelector("#textmenu").hasAttribute("data-open")), true, "the text's menu");
  await d.context.close();
});

test("written on a phone: typed in the active mode, kept", async () => {
  const d = await device("phone");
  await open(d, "Second note.md");
  await d.page.tap('#toolbar [data-act="active"], #toolbar [data-mode="active"]').catch(async () => { await d.page.evaluate(() => MdView.setMode("active")); });
  await d.page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view.pm && MdActive.view.pm.editable, null, { timeout: 8000 });
  // a tap into the text has the keyboard (the mode's button alone does not bring it up: nothing is typed yet)
  assert.equal(await d.page.evaluate(() => MdActive.view.pm.hasFocus()), false, "the mode chosen with a finger: no keyboard yet");
  const end = await d.page.evaluate(() => { const r = document.querySelector("#active .pm > p:last-of-type").getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; });
  await d.page.touchscreen.tap(end[0], end[1]); await d.page.waitForTimeout(300);
  assert.equal(await d.page.evaluate(() => MdActive.view.pm.hasFocus()), true, "a tap into the text: the editor has the keyboard");
  await d.page.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.Selection.atEnd(v.state.doc))); });
  await d.page.keyboard.type(" Written on a phone.");
  await d.page.waitForFunction(() => /Written on a phone\./.test(MdActive.view.serialize(false)), null, { timeout: 5000 });
  assert.ok((await sideways(d.page)) <= 0);
  await shot(d, "typing");
  await d.context.close();
});

test("the settings fill a phone's screen, their groups in a row above", async () => {
  const d = await device("phone");
  await open(d);
  await d.page.tap(".tab-side"); await d.page.waitForTimeout(600);
  await d.page.tap("#settings-btn"); await d.page.waitForSelector("#settings[data-open]"); await d.page.waitForTimeout(500);
  const win = await rect(d.page, "#settings"), nav = await rect(d.page, "#settings .st-side"), main = await rect(d.page, "#settings .st-main");
  assert.ok(win.w >= 389 && win.h >= 843, "the whole screen");
  assert.ok(nav.bottom <= main.y + 1 && nav.w > 300, "the groups above what they choose");
  assert.equal(await d.page.evaluate(() => { const c = document.querySelector("#settings .st-content"); return c.scrollWidth <= c.clientWidth + 1; }), true, "a group's settings fit the width");
  await d.page.tap("#settings .st-nav:nth-of-type(1) ~ .st-nav, #settings .st-group:nth-child(3) .st-nav").catch(() => {});
  await shot(d, "settings");
  await d.context.close();
});

test("nothing was refused or thrown along the way", () => { assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource/.test(p)), []); });
