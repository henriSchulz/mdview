// The whiteboard under fingers: the board alone (dev/board-lab.html) in a real browser of a
// tablet's and a phone's size, with real touches. One finger draws, or with the pointer in hand
// takes and moves things; on the bare board it moves the board; held still first, it pulls a box;
// two fingers move and size the board, or turn the thing they both lie on. Nothing of the board's
// bars runs off the screen, and what is pressed is large enough for a finger.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const lab = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dev", "board-lab.html")).href;
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const SIZES = { tablet: { width: 820, height: 1180 }, phone: { width: 390, height: 844 } };
let browser;
const problems = [];
before(async () => { browser = await chromium.launch({ executablePath: browserPath, headless: true }); });
after(async () => { await browser?.close(); });

async function open(size) {
  const context = await browser.newContext({ viewport: SIZES[size], hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(`${size}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${size}: ${m.text()}`); });
  await page.goto(lab + "?new");
  await page.waitForFunction(() => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready"));
  await page.waitForTimeout(700); // (grown to the screen's size)
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const st = () => page.evaluate(() => MdBoard.state());
  const sleep = (ms) => page.waitForTimeout(ms);
  // fingers: each a list of points gone through together, step by step
  const fingers = async (paths, { rest = 0, steps = 8 } = {}) => {
    await touch("touchStart", paths.map((p) => p[0]));
    if (rest) await sleep(rest);
    for (let i = 1; i <= steps; i++) { await touch("touchMove", paths.map((p) => { const t = i / steps, k = Math.min(p.length - 2, Math.floor(t * (p.length - 1))), u = t * (p.length - 1) - k; return [p[k][0] + (p[k + 1][0] - p[k][0]) * u, p[k][1] + (p[k + 1][1] - p[k][1]) * u]; })); await sleep(12); }
    await touch("touchEnd", []);
    await sleep(80);
  };
  const at = async (bx, by) => { const v = (await st()).view; return [(bx - v.x) * v.z, (by - v.y) * v.z]; };
  return { page, context, st, fingers, at, sleep, w: SIZES[size].width, h: SIZES[size].height };
}

for (const size of ["tablet", "phone"]) {
  test(`${size}: the board's bars are on the screen, and large enough for a finger`, async () => {
    const { page, context, w, h } = await open(size);
    const bars = await page.evaluate(() => [...document.querySelectorAll("#board .bd-bar")].filter((b) => !b.hidden && b.offsetWidth).map((b) => { const r = b.getBoundingClientRect(); return { cls: b.className, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    assert.ok(bars.length >= 5, JSON.stringify(bars));
    for (const b of bars) assert.ok(b.l >= 0 && b.r <= w + 0.5 && b.t >= 0 && b.b <= h + 0.5, `${b.cls} off the screen: ${JSON.stringify(b)}`);
    // no two of them over each other
    for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) { const a = bars[i], b = bars[j]; assert.ok(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1, `${a.cls} lies over ${b.cls}`); }
    const small = await page.evaluate(() => [...document.querySelectorAll("#board .bd-bar .bd-btn, #board .bd-tool")].filter((b) => b.offsetWidth).map((b) => [b.dataset.do || b.dataset.tool || "tool", Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]).filter(([, bw, bh]) => bw < 38 || bh < 38));
    assert.deepEqual(small, [], "smaller than a finger");
    await context.close();
  });

  test(`${size}: one finger draws; two move the board and make it larger; with the pointer a finger takes, moves, pulls a box and two turn`, async () => {
    const { page, context, st, fingers, at, sleep, w, h } = await open(size);
    const cx = w / 2, cy = h / 2;
    // ---- drawing
    await fingers([[[cx - 80, cy - 140], [cx, cy - 170], [cx + 80, cy - 140]]]);
    assert.equal((await st()).items, 1, "a stroke drawn with a finger");
    let v0 = (await st()).view;
    await fingers([[[cx - 60, cy], [cx - 10, cy + 70]], [[cx + 60, cy], [cx + 110, cy + 70]]]);
    let s = await st();
    assert.equal(s.items, 1, "two fingers draw nothing");
    assert.ok(Math.abs(s.view.x - (v0.x - 50)) < 3 && Math.abs(s.view.y - (v0.y - 70)) < 3 && Math.abs(s.view.z - 1) < 0.02, `the board moved with them: ${JSON.stringify([v0, s.view])}`);
    await fingers([[[cx - 40, cy], [cx - 120, cy]], [[cx + 40, cy], [cx + 120, cy]]]);
    assert.ok((await st()).view.z > 2.2, "fingers spread: larger");
    await fingers([[[cx - 120, cy], [cx - 40, cy]], [[cx + 120, cy], [cx + 40, cy]]]);
    assert.ok(Math.abs((await st()).view.z - 1) < 0.25, "and back together: smaller again");
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true, cancelable: true })));
    // ---- the pointer
    await page.tap("#board .bd-tool[data-pointer]");
    assert.equal((await st()).mode, "select");
    await page.tap('#board [data-do="shapes"]');
    await sleep(300);
    await page.tap('#board .bd-spop [data-shape="rect"]');
    await sleep(200);
    s = await st();
    assert.equal(s.things.length, 1);
    let t = s.things[0], m = await at(t.x + t.w / 2, t.y + t.h / 2);
    await fingers([[m, [m[0] + 60, m[1] + 90]]]);
    s = await st();
    assert.deepEqual([Math.round(s.things[0].x - t.x), Math.round(s.things[0].y - t.y), s.picked.length], [60, 90, 1], "a finger on a thing takes it along");
    // on the bare board: the board goes with the finger, nothing is chosen
    v0 = s.view;
    await fingers([[[40, h - 260], [100, h - 320]]]);
    s = await st();
    assert.ok(Math.abs(s.view.x - (v0.x - 60)) < 3 && Math.abs(s.view.y - (v0.y + 60)) < 3 && s.picked.length === 0, `a finger on the bare board moves the board: ${JSON.stringify([v0, s.view, s.picked])}`);
    // held still first: a box
    t = s.things[0];
    const a = await at(t.x - 30, t.y - 30), b = await at(t.x + t.w / 2, t.y + t.h / 2);
    v0 = s.view;
    await fingers([[a, b]], { rest: 520 });
    s = await st();
    assert.deepEqual([s.picked.length, Math.round(s.view.x - v0.x)], [1, 0], "a finger that rested first pulls a box over what is to be chosen, and the board stays");
    // two fingers on it: it turns with them
    m = await at(t.x + t.w / 2, t.y + t.h / 2);
    await fingers([[[m[0] - 30, m[1]], [m[0] - 30, m[1]]], [[m[0] + 30, m[1]], [m[0] + 21, m[1] + 21], [m[0], m[1] + 30], [m[0] - 30 + 60 * Math.cos(1.6), m[1] + 60 * Math.sin(1.6)]]], { steps: 12 });
    s = await st();
    assert.equal(s.things[0].r, 90, "two fingers on a thing turn it: a quarter turn of the fingers, a quarter turn of the thing (it rests upright)");
    assert.ok(Math.abs(s.view.z - 1) < 0.02 && Math.abs(s.view.x - v0.x) < 1, "… and the board stays as it is");
    // kept
    await page.waitForFunction(() => !MdBoard.state().dirty, null, { timeout: 4000 });
    assert.ok(await page.evaluate(() => (localStorage.getItem("mdview-lab:board") || "").includes('"k":"shape"')));
    await context.close();
  });
}

test("nothing was thrown along the way", () => { assert.deepEqual(problems, []); });
