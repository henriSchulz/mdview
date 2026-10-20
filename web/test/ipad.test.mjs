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
  "Swipe.md": "# Swipe\n\nThe first paragraph, a block to be swiped to the right on its own text.\n\nThe second paragraph, another block of the note.\n\n- the first item of a list\n- the second item of a list\n- the third item\n\n> [!note]\n> A paragraph inside a callout.\n\n```python\ndef a_function_with_a_very_long_name_that_runs_far_past_the_side_of_the_window(argument_one, argument_two, argument_three):\n    return argument_one\n```\n\n| Column one | Column two | Column three | Column four | Column five | Column six | Column seven |\n|---|---|---|---|---|---|---|\n| a rather long cell | another long cell | and one more | and more | the fifth one | and the sixth | the last one |\n\n<!-- columns -->\n\nLeft column's paragraph.\n\n<!-- column -->\n\nRight column's paragraph.\n\n<!-- /columns -->\n\n" + long + "\n",
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
    // a swipe to the right, begun in the margin beside a block: the block is chosen, and its handle stays
    const count = () => p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).length);
    await p.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.Selection.atStart(v.state.doc))); document.activeElement.blur(); scrollTo(0, 0); });
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    const kids = await p.evaluate(() => [...document.querySelectorAll("#active .pm > *")].filter((e) => /^(H1|P)$/.test(e.tagName)).slice(0, 2).map((e) => { const r = e.getBoundingClientRect(), pm = document.querySelector("#active .pm").getBoundingClientRect(); return { y: r.top + Math.min(r.height / 2, 14), left: pm.left }; }));
    assert.ok(kids[0].left >= 60, `room beside the text to begin a swipe in: ${kids[0].left}`);
    // up and down the margin: the note moves, nothing is chosen
    await pull([kids[0].left - 30, kids[0].y], [kids[0].left - 26, kids[0].y + 60]);
    assert.equal(await count(), 0, "a finger moving down the margin chooses nothing");
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200);
    await pull([kids[0].left - 34, kids[0].y], [kids[0].left + 50, kids[0].y + 4]);
    await p.waitForTimeout(500); // (the block springs back into its place; then its handle shows)
    let hh = await p.evaluate(() => document.querySelector(".blk-h").hasAttribute("data-on"));
    assert.deepEqual([await count(), hh, await p.evaluate(() => MdActive.view.pm.hasFocus())], [1, true, false], "a swipe to the right beside a block chooses it; its handle stands by it, no keyboard");
    await p.evaluate(() => scrollBy(0, 30)); await p.waitForTimeout(250); await p.evaluate(() => scrollBy(0, -30)); await p.waitForTimeout(250);
    assert.equal(await p.evaluate(() => document.querySelector(".blk-h").hasAttribute("data-on")), true, "… and stays while the note is moved");
    await pull([kids[1].left - 34, kids[1].y], [kids[1].left + 50, kids[1].y + 4]);
    assert.equal(await count(), 2, "the same swipe beside another block adds it");
    await pull([kids[0].left - 58, kids[0].y], [kids[0].left + 30, kids[0].y + 2]);
    assert.equal(await count(), 1, "the swipe beside a chosen block lets it go");
    await p.keyboard.press("Escape"); await p.waitForTimeout(200);
    // a formula, a diagram: a finger resting on it selects nothing
    assert.deepEqual(await p.evaluate(() => { const isl = document.querySelector("#active .pm .isl"); return isl ? getComputedStyle(isl).userSelect : "none"; }), "none");
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
test("ipad: a block swiped to the right on its own text is chosen, as in Craft; what scrolls and what is tapped stays the browser's", async () => {
  const d = await device("ipad"), p = d.page, cdp = await d.context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const down = (a) => touch("touchStart", [a]);
  const move = async (a, b, steps = 8) => { for (let i = 1; i <= steps; i++) { await touch("touchMove", [[a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]]); await p.waitForTimeout(16); } };
  const up = async () => { await p.waitForTimeout(120); await touch("touchEnd", []); await p.waitForTimeout(700); };
  const swipe = async (a, b, steps) => { await down(a); await move(a, b, steps); await up(); };
  const picked = () => p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).map((x) => x.node.type.name + ":" + x.node.textContent.slice(0, 16)));
  const clear = async () => { await p.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.Selection.atStart(v.state.doc))); document.activeElement.blur(); }); await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(250); assert.deepEqual(await picked(), []); };
  // a point on the text of the element the function finds (scrolled to the middle of the window first)
  const at = (fn, dx = 0.3) => p.evaluate(async ([src, f]) => { const e = new Function("return " + src)()(); e.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 150)); const r = e.getBoundingClientRect(); return [Math.round(r.left + Math.min(r.width * f, 200)), Math.round(r.top + Math.min(r.height / 2, 12))]; }, [fn.toString(), dx]);
  await open(d, "Swipe.md");
  await p.evaluate(() => MdView.setMode("active"));
  await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await p.waitForTimeout(600);
  await clear();
  const para = () => document.querySelectorAll("#active .pm > p")[0];
  // on its text, the block goes along with the finger — less far than the finger (it resists) — and is chosen when let go
  let a = await at(para);
  await down(a); await move(a, [a[0] + 120, a[1] + 3]);
  const shift = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelectorAll("#active .pm > p")[0]).transform).m41);
  assert.ok(shift > 8 && shift < 100, `the block follows the finger, held back: ${shift}px for a finger 120px on`);
  await shot(d, "swipe");
  // … past the distance that chooses: no circle or tick of its own — the block's field has faded in and its tint deepened, the block bumps once
  assert.deepEqual(await p.evaluate(() => { const f = document.querySelector(".blk-fields .blk-field[data-swipe='add']"); return [!!document.querySelector(".blk-dot"), !!f && +getComputedStyle(f).opacity > 0.9, document.documentElement.classList.contains("blk-swipe-reached"), !!f && getComputedStyle(f).animationName, getComputedStyle(document.querySelector("#active .pm .blk-swiping")).animationName]; }), [false, true, true, "blk-swipe-bump", "blk-swipe-bump"], "no circle; the field shown, deeper, the block bumps");
  await up();
  assert.deepEqual(await picked(), ["paragraph:The first paragr"], "a swipe to the right on a block's text chooses it");
  assert.equal(await p.evaluate(() => MdActive.view.pm.hasFocus()), false, "… without the keyboard");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelectorAll("#active .pm > p")[0]).transform), "none", "… and springs back into its place");
  // in that state the same swipe on another block adds it; on a chosen one, to the left, lets it go
  const para2 = () => document.querySelectorAll("#active .pm > p")[1];
  a = await at(para2);
  await swipe(a, [a[0] + 100, a[1] + 2]);
  assert.equal((await picked()).length, 2, "a swipe on another block adds it");
  a = await at(para);
  await swipe(a, [a[0] - 100, a[1] + 2]);
  assert.deepEqual(await picked(), ["paragraph:The second parag"], "a swipe to the left on a chosen block lets it go");
  a = await at(para2);
  await swipe(a, [a[0] + 100, a[1] + 2]);
  assert.deepEqual(await picked(), [], "… and so does one to the right");
  await clear();
  // a short swipe springs back and chooses nothing
  a = await at(para);
  await swipe(a, [a[0] + 30, a[1]], 6);
  assert.deepEqual(await picked(), [], "a short swipe chooses nothing");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelectorAll("#active .pm > p")[0]).transform), "none", "… and the block is back in its place");
  // up and down on the text: the note scrolls, nothing is chosen
  a = await at(para2);
  const y0 = await p.evaluate(() => scrollY);
  await swipe(a, [a[0] + 12, a[1] - 160], 8);
  assert.ok((await p.evaluate(() => scrollY)) > y0 + 40, "a finger moving up the text scrolls the note");
  assert.deepEqual(await picked(), [], "… and chooses nothing");
  // nested: the item of a list, the paragraph in a callout — the innermost block, not what holds it
  a = await at(() => document.querySelectorAll("#active .pm li")[1]);
  await swipe(a, [a[0] + 100, a[1] + 2]);
  assert.deepEqual(await picked(), ["list_item:the second item "], "in a list: the item swiped, not the list");
  await clear();
  a = await at(() => document.querySelector("#active .pm .callout-content > p"));
  await swipe(a, [a[0] + 100, a[1] + 2]);
  assert.deepEqual(await picked(), ["paragraph:A paragraph insi"], "in a callout: the paragraph swiped");
  await clear();
  a = await at(() => [...document.querySelectorAll("#active .pm .col > p")][1]);
  await swipe(a, [a[0] + 80, a[1] + 2]);
  assert.deepEqual(await picked(), ["paragraph:Right column's p"], "in a column: the paragraph swiped, not the row");
  await clear();
  // a code block scrolled sideways: the swipe scrolls it back; at its left edge, the swipe chooses it
  const scroller = () => [...document.querySelectorAll("#active .pm *")].find((e) => e.closest("pre") && e.scrollWidth > e.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(e).overflowX)) || document.querySelector("#active .pm pre");
  const codeAt = await at(scroller, 0.5);
  await p.evaluate((src) => { new Function("return " + src)()().scrollLeft = 150; }, scroller.toString());
  const left0 = await p.evaluate((src) => new Function("return " + src)()().scrollLeft, scroller.toString());
  assert.ok(left0 > 100, `the code block can scroll sideways: ${left0}`);
  await swipe(codeAt, [codeAt[0] + 100, codeAt[1] + 2]);
  const left1 = await p.evaluate((src) => new Function("return " + src)()().scrollLeft, scroller.toString());
  assert.ok(left1 < left0 - 40, `a swipe in a code block scrolled sideways scrolls it back: ${left0} → ${left1}`);
  assert.deepEqual(await picked(), [], "… and chooses nothing");
  await p.evaluate((src) => { new Function("return " + src)()().scrollLeft = 0; }, scroller.toString());
  await swipe(codeAt, [codeAt[0] - 100, codeAt[1] + 2]);
  assert.ok((await p.evaluate((src) => new Function("return " + src)()().scrollLeft, scroller.toString())) > 40, "a swipe to the left in it scrolls it");
  assert.deepEqual(await picked(), [], "… and chooses nothing");
  await p.evaluate((src) => { new Function("return " + src)()().scrollLeft = 0; }, scroller.toString());
  await swipe(codeAt, [codeAt[0] + 100, codeAt[1] + 2]);
  assert.deepEqual((await picked()).map((x) => x.split(":")[0]), ["island"], "at its left edge the swipe chooses the code block");
  await clear();
  // a wide table, at its left edge: the swipe on a cell chooses the table
  a = await at(() => document.querySelector("#active .pm .table-wrap td"), 0.5);
  await p.evaluate(() => { document.querySelector("#active .pm .table-wrap").scrollLeft = 0; });
  await swipe(a, [a[0] + 100, a[1] + 2]);
  assert.deepEqual((await picked()).map((x) => x.split(":")[0]), ["table"], "a swipe on a table's cell chooses the table");
  await clear();
  // several blocks of every kind selected: each wears the same field, a little wider than the block, and the fields of blocks
  // that follow each other leave the same room between them, whatever the blocks are
  const plain = await p.evaluate(() => [...document.querySelectorAll("#active .pm > *")].slice(1, 7).map((e) => getComputedStyle(e).boxShadow + "|" + getComputedStyle(e).backgroundColor));
  await p.evaluate(() => { const v = MdActive.view.pm, kids = []; v.state.doc.forEach((n, pos) => kids.push(pos)); scrollTo(0, 0); MdActive.blocks.select(v, kids[1], false); MdActive.blocks.select(v, kids[6], true); document.activeElement.blur(); });
  await p.waitForTimeout(400);
  const look = await p.evaluate(() => {
    const fields = [...document.querySelectorAll(".blk-fields .blk-field")].map((f) => f.getBoundingClientRect());
    const els = MdActive.blocks.picked(MdActive.view.pm.state).map((x) => MdActive.view.pm.nodeDOM(x.pos));
    const kinds = els.map((e) => e.className.split(" ")[0] || e.tagName);
    const tints = [...document.querySelectorAll(".blk-fields .blk-field")].map((f) => getComputedStyle(f).backgroundColor);
    const gaps = fields.slice(1).map((f, i) => Math.round((f.top - fields[i].bottom) * 10) / 10);
    const sides = fields.map((f, i) => { const r = els[i].getBoundingClientRect(); return [Math.round(r.right - f.right + 5), Math.round(f.right - f.left - r.width)]; });
    return { n: fields.length, picked: els.length, kinds, tints: new Set(tints).size, gaps, sides, own: els.map((e) => getComputedStyle(e).boxShadow + "|" + getComputedStyle(e).backgroundColor) };
  });
  assert.equal(look.n, look.picked, `a field for each selected block: ${JSON.stringify(look)}`);
  assert.equal(look.tints, 1, "one tint for all");
  assert.ok(look.gaps.every((g) => Math.abs(g - 6) < 0.6), `the same room between fields: ${look.gaps}`);
  assert.ok(look.sides.every(([r]) => r === 0), `each field reaches the same out of its block's right: ${JSON.stringify(look.sides)}`);
  assert.deepEqual(look.own, plain, "nothing of the field is painted on the blocks themselves: they look as they do unselected");
  const hb = await p.evaluate(() => { const h = document.querySelector(".blk-h").getBoundingClientRect(), f = document.querySelector(".blk-fields .blk-field").getBoundingClientRect(); return [h.right, f.left, document.querySelector(".blk-h").hasAttribute("data-on")]; });
  assert.ok(hb[2] && hb[0] <= hb[1] - 4, `the handle stands clear of the fields: ${hb}`);
  await clear();
  // a tap on the text still puts the caret there
  a = await at(para2);
  await p.touchscreen.tap(a[0], a[1]);
  await p.waitForTimeout(300);
  assert.deepEqual(await p.evaluate(() => { const s = MdActive.view.pm.state.selection; return [s.empty, s.$from.parent.textContent.slice(0, 10)]; }), [true, "The second"], "a tap puts the caret into the text");
  assert.deepEqual(await picked(), []);
  await d.context.close();
});
test("nothing was refused or thrown along the way", () => { assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource/.test(p)), []); });
