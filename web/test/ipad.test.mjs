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
const SIZES = { ipad: { width: 1180, height: 820 }, ipadUp: { width: 820, height: 1180 }, phone: { width: 390, height: 844 }, small: { width: 320, height: 568 }, tablet: { width: 820, height: 1180 }, wide: { width: 1180, height: 820 } };

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
  const context = await browser.newContext({ viewport: SIZES[name], hasTouch: touch, isMobile: touch && !/tablet|ipad/.test(name), deviceScaleFactor: 2 });
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


for (const name of ["ipad", "ipadUp"]) {
  test(`${name}: under a finger — the sidebar's edge is pulled, a tapped block has its handle and its menu, a tapped cell the table's handles`, async () => {
    const d = await device(name), p = d.page, cdp = await d.context.newCDPSession(p);
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
    const pull = async (a, b, steps = 8) => { await touch("touchStart", [a]); for (let i = 1; i <= steps; i++) { await touch("touchMove", [[a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]]); await p.waitForTimeout(16); } await p.waitForTimeout(120); await touch("touchEnd", []); await p.waitForTimeout(300); };
    await open(d);
    assert.ok(await p.evaluate(() => matchMedia("(pointer: coarse)").matches), "a finger's device");
    // an app, not a page: not pinched larger, and what is no text of the note's is not selected
    assert.deepEqual(await p.evaluate(() => [/user-scalable=no/.test(document.querySelector("meta[name=viewport]").content), getComputedStyle(document.documentElement).touchAction, getComputedStyle(document.querySelector(".sb-row")).userSelect, getComputedStyle(document.querySelector("#toolbar")).userSelect, getComputedStyle(document.querySelector("#content p")).userSelect]), [true, "pan-x pan-y", "none", "none", "text"], "no pinch, no selecting of the app's own parts; the note's text can be selected");
    // the sidebar's edge
    const grip = await rect(p, "#sb-grip"), was = (await rect(p, "#sidebar")).w;
    assert.ok(grip.w >= 20, `the edge is wide enough to be met: ${grip.w}`);
    await pull([grip.x + grip.w / 2, 400], [grip.x + grip.w / 2 + 80, 400]);
    assert.ok(Math.abs((await rect(p, "#sidebar")).w - (was + 80)) <= 14, `the sidebar's edge pulled by a finger: ${was} → ${(await rect(p, "#sidebar")).w}`);
    assert.equal(await sideways(p), 0);
    // the active mode: a tap on a block
    await p.evaluate(() => MdView.setMode("active"));
    await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
    await p.waitForTimeout(600);
    const para = await p.evaluate(() => { const e = document.querySelector("#active .pm > h1"); const r = e.getBoundingClientRect(); return [r.left + 40, r.top + r.height / 2]; }); // (the heading: a tap on the paragraph under it would follow its link)
    await p.touchscreen.tap(para[0], para[1]);
    await p.waitForTimeout(350);
    let h = await p.evaluate(() => { const e = document.querySelector(".blk-h"), r = e.getBoundingClientRect(); return { on: e.hasAttribute("data-on"), x: r.left, y: r.top, w: r.width, h: r.height }; });
    assert.ok(h.on && h.w >= 28 && h.h >= 30 && Math.abs(h.y + h.h / 2 - para[1]) < 24 && h.x >= 0, `a tapped block has its handle beside it, large enough for a finger: ${JSON.stringify(h)}`);
    await p.touchscreen.tap(h.x + h.w / 2, h.y + h.h / 2);
    await p.waitForTimeout(400);
    const menu = await p.evaluate(() => (MdActive.menu.isOpen ? MdActive.menu.el.querySelectorAll(".menu-item").length : 0));
    assert.ok(menu > 3, `a tap on the handle: the block's menu (${menu} entries)`);
    assert.equal(await p.evaluate(() => MdActive.view.pm.hasFocus()), false, "a block chosen by its handle: the editor does not take the keyboard");
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    assert.equal(await p.evaluate(() => MdActive.view.pm.hasFocus()), false, "… nor when its menu shuts");
    // the handle pulled by a finger: the block goes where it is let go
    const order = () => p.evaluate(() => [...document.querySelectorAll("#active .pm > *")].map((e) => e.tagName + ":" + e.textContent.slice(0, 12)));
    const before = await order();
    await p.touchscreen.tap(para[0], para[1]); await p.waitForTimeout(350);
    h = await p.evaluate(() => { const e = document.querySelector(".blk-h"), r = e.getBoundingClientRect(); return { on: e.hasAttribute("data-on"), x: r.left, y: r.top, w: r.width, h: r.height }; });
    const below = await p.evaluate(() => { const kids = [...document.querySelectorAll("#active .pm > *")], i = kids.findIndex((e) => e.tagName === "H1"), r = kids[i + 2].getBoundingClientRect(); return [r.left + 60, r.bottom - 3]; });
    await pull([h.x + h.w / 2, h.y + h.h / 2], below, 10);
    const after2 = await order(), i0 = before.findIndex((x) => x.startsWith("H1")), i1 = after2.findIndex((x) => x.startsWith("H1"));
    assert.ok(i1 > i0 && after2.length === before.length, `the handle pulled by a finger moves its block down: ${JSON.stringify([before.slice(0, 5), after2.slice(0, 5)])}`);
    assert.equal(await p.evaluate(() => MdActive.menu.isOpen), false, "… and that was no tap on the handle");
    await p.evaluate(() => { const v = MdActive.view.pm; PM.history.undo(v.state, v.dispatch); });
    await p.waitForTimeout(300);
    // a table: a tap on a cell
    const cell = await p.evaluate(() => { const e = document.querySelector("#active .pm .table-wrap td"); if (!e) return null; e.scrollIntoView({ block: "center" }); return true; });
    assert.ok(cell, "the note has a table");
    await p.waitForTimeout(400);
    const at = await p.evaluate(() => { const r = document.querySelector("#active .pm .table-wrap td").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await p.touchscreen.tap(at[0], at[1]);
    await p.waitForTimeout(350);
    const hs = await p.evaluate(() => [...document.querySelectorAll(".tbl-h")].map((e) => { const r = e.getBoundingClientRect(); return [e.hasAttribute("data-on"), Math.round(r.width), Math.round(r.height)]; }));
    assert.ok(hs.length === 3 && hs.every(([on]) => on) && hs.every(([, w, hh]) => Math.max(w, hh) >= 40), `a tapped cell has the table's handles, large enough: ${JSON.stringify(hs)}`);
    // a field typed in is 16 px: an iPhone makes the page larger under less
    const small = await p.evaluate(() => [...document.querySelectorAll("input[type=text], input:not([type]), textarea, input[type=search]")].map((e) => [e.id || e.className.slice(0, 24), parseFloat(getComputedStyle(e).fontSize)]).filter(([, f]) => f < 16));
    assert.deepEqual(small, [], "fields under 16 px");
    await shot(d, "active");
    await d.context.close();
  });
}
test("nothing was refused or thrown along the way", () => { assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource/.test(p)), []); });
