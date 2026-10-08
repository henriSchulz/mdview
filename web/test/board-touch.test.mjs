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
  await page.addInitScript(() => { if (!localStorage.getItem("mdview:board-tools:tray")) localStorage.setItem("mdview:board-tools:tray", JSON.stringify({ edge: "bottom", mini: null })); }); // (these begin with the tray at the foot)
  await page.goto(lab + "?new");
  await page.waitForFunction(() => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready"));
  await page.waitForTimeout(700); // (grown to the screen's size)
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const st = () => page.evaluate(() => MdBoard.state());
  const sleep = (ms) => page.waitForTimeout(ms);
  // fingers: each a list of points gone through together, step by step
  const fingers = async (paths, { rest = 0, steps = 8, fling = false } = {}) => {
    await touch("touchStart", paths.map((p) => p[0]));
    if (rest) await sleep(rest);
    for (let i = 1; i <= steps; i++) { await touch("touchMove", paths.map((p) => { const t = i / steps, k = Math.min(p.length - 2, Math.floor(t * (p.length - 1))), u = t * (p.length - 1) - k; return [p[k][0] + (p[k + 1][0] - p[k][0]) * u, p[k][1] + (p[k + 1][1] - p[k][1]) * u]; })); await sleep(12); }
    if (!fling) await sleep(110); // (the fingers come to rest before they leave: the board stays where they left it)
    await touch("touchEnd", []);
    await sleep(80);
  };
  const at = async (bx, by) => { const v = (await st()).view; return [(bx - v.x) * v.z, (by - v.y) * v.z]; };
  // what the hand does, chosen in the bar at the top (a board opens with the lasso in hand)
  const kind = async (k) => { await page.tap(`#board [data-kind="${k}"]`); await sleep(120); };
  return { page, context, st, fingers, at, sleep, kind, w: SIZES[size].width, h: SIZES[size].height };
}

for (const size of ["tablet", "phone"]) {
  test(`${size}: the board's bars are on the screen, and large enough for a finger`, async () => {
    const { page, context, kind, sleep, w, h } = await open(size);
    await kind("pen"); // (with the pens' tray on the screen)
    await sleep(500);
    const bars = await page.evaluate(() => [...document.querySelectorAll("#board .bd-bar")].filter((b) => !b.hidden && b.offsetWidth && getComputedStyle(b).visibility !== "hidden").map((b) => { const r = b.getBoundingClientRect(); return { cls: b.className, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    assert.ok(bars.length >= 5, JSON.stringify(bars));
    for (const b of bars) assert.ok(b.l >= 0 && b.r <= w + 0.5 && b.t >= 0 && b.b <= h + 0.5, `${b.cls} off the screen: ${JSON.stringify(b)}`);
    // no two of them over each other
    for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) { const a = bars[i], b = bars[j]; assert.ok(a.r <= b.l + 1 || b.r <= a.l + 1 || a.b <= b.t + 1 || b.b <= a.t + 1, `${a.cls} lies over ${b.cls}`); }
    const small = await page.evaluate(() => [...document.querySelectorAll("#board .bd-bar .bd-btn, #board .bd-tool")].filter((b) => b.offsetWidth && getComputedStyle(b).visibility !== "hidden").map((b) => [b.dataset.do || b.dataset.tool || "tool", Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]).filter(([, bw, bh]) => bw < 38 || bh < 38));
    assert.deepEqual(small, [], "smaller than a finger");
    await context.close();
  });

  test(`${size}: one finger draws; two move the board and make it larger; with the pointer a finger takes, moves, pulls a box and two turn`, async () => {
    const { page, context, st, fingers, at, sleep, kind, w, h } = await open(size);
    const cx = w / 2, cy = h / 2;
    assert.deepEqual([(await st()).kind, await page.evaluate(() => getComputedStyle(document.querySelector("#board .bd-palette")).pointerEvents)], ["lasso", "none"], "a board opens with the lasso in hand, which has no tray");
    // ---- drawing
    await kind("pen");
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
    // ---- a shape of the shape tool's tray: where the finger taps
    await sleep(700);
    await kind("shape");
    await page.tap('#board [data-form="rect"]');
    await sleep(700);
    await page.touchscreen.tap(cx, cy + 60);
    await sleep(200);
    s = await st();
    assert.deepEqual([s.things.length, s.picked.length, s.things[0].shape, s.things[0].fill], [1, 1, "rect", "none"], "the shape tool: a tap puts the shape of its tray there, chosen");
    assert.ok(Math.abs(s.things[0].x + s.things[0].w / 2 - (s.view.x + cx)) < 2, "… where the finger tapped");
    // ---- the lasso
    await sleep(700);
    await kind("lasso");
    assert.equal((await st()).mode, "select");
    let t = s.things[0], m = await at(t.x + t.w / 2, t.y + t.h / 2);
    await fingers([[m, [m[0] + 60, m[1] + 90]]]);
    s = await st();
    assert.deepEqual([Math.round(s.things[0].x - t.x), Math.round(s.things[0].y - t.y), s.picked.length], [60, 90, 1], "a finger on a thing takes it along");
    // on the bare board: the board goes with the finger, nothing is chosen
    v0 = s.view;
    await fingers([[[40, h - 260], [100, h - 320]]]);
    s = await st();
    assert.ok(Math.abs(s.view.x - (v0.x - 60)) < 3 && Math.abs(s.view.y - (v0.y + 60)) < 3 && s.picked.length === 1, `a finger on the bare board moves the board, and what is chosen stays so: ${JSON.stringify([v0, s.view, s.picked])}`);
    await sleep(700);
    await page.touchscreen.tap(40, h - 300);
    await sleep(150);
    assert.equal((await st()).picked.length, 0, "a tap on the bare board lets it go");
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

test("a pen: it draws wherever it comes down, with its pressure and how it is held; beside it a finger moves the board and the palm is nobody's", async () => {
  const { page, context, st, fingers, at, sleep, kind, w, h } = await open("tablet");
  const cdp = await context.newCDPSession(page), cx = w / 2, cy = h / 2;
  const pen = (type, x, y, more = {}) => cdp.send("Input.dispatchMouseEvent", { type, x, y, pointerType: "pen", button: type === "mouseMoved" && !more.down ? "none" : "left", buttons: type === "mouseReleased" || (type === "mouseMoved" && !more.down) ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1, force: more.force ?? 0.5, tiltX: more.tilt ?? 0, tiltY: 0 });
  const stroke = async (pts, how = () => ({})) => { await pen("mousePressed", ...pts[0], how(0)); for (let i = 1; i < pts.length; i++) { await pen("mouseMoved", ...pts[i], { down: true, ...how(i) }); await sleep(10); } await pen("mouseReleased", ...pts[pts.length - 1]); await sleep(80); };
  const line = (x, y, n = 16) => Array.from({ length: n }, (_v, i) => [x + i * 9, y + Math.sin(i / 2) * 14]);
  await kind("pen");
  await sleep(600);
  // before any pen: a finger draws
  await fingers([[[cx - 80, 200], [cx, 170], [cx + 80, 200]]]);
  assert.deepEqual([(await st()).items, (await st()).pens.seen], [1, false]);
  // held over the board: its tip shows
  await pen("mouseMoved", cx, cy);
  await sleep(60);
  assert.equal((await st()).tip, true, "a pen held over the board shows where its tip will come down");
  // it draws: pressure and tilt are the stroke's
  await stroke(line(cx - 100, 300), (i) => ({ force: 0.2 + (i % 8) / 10, tilt: 20 }));
  let s = await st();
  assert.deepEqual([s.items, s.channels[1], s.pens.seen, s.tip], [2, "xyptia", true, false], "a stroke with a pen keeps its tilt and where it leans; the tip is gone while it draws");
  // now a finger does not draw: it moves the board (once the moment after the pen has passed)
  await sleep(600);
  let v0 = s.view;
  await fingers([[[cx, cy + 200], [cx + 70, cy + 260]]]);
  s = await st();
  assert.ok(s.items === 2 && Math.abs(s.view.x - (v0.x - 70)) < 3 && Math.abs(s.view.y - (v0.y - 60)) < 3, `beside a pen a finger moves the board: ${JSON.stringify([s.items, v0, s.view])}`);
  // the palm: touches while the pen is down do nothing
  v0 = s.view;
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await pen("mousePressed", cx - 100, 420);
  await touch("touchStart", [[cx + 150, 520]]);
  for (let i = 1; i <= 10; i++) { await pen("mouseMoved", cx - 100 + i * 10, 420 + i, { down: true }); await touch("touchMove", [[cx + 150 + i * 4, 520 + i * 6]]); await sleep(10); }
  await touch("touchEnd", []);
  await pen("mouseReleased", cx, 430);
  await sleep(80);
  s = await st();
  assert.ok(s.items === 3 && Math.abs(s.view.x - v0.x) < 0.5 && Math.abs(s.view.y - v0.y) < 0.5, `a hand on the glass beside the pen neither draws nor moves the board: ${JSON.stringify([s.items, v0, s.view])}`);
  // a stroke, and the other hand moves the board at once: its first try counts (only the briefest moment after the pen is the palm's)
  await pen("mousePressed", cx - 100, 470); await pen("mouseMoved", cx - 40, 474, { down: true }); await pen("mouseReleased", cx - 40, 474);
  await sleep(200);
  await fingers([[[cx, cy + 200], [cx + 60, cy + 200]]], { steps: 3 });
  s = await st();
  assert.ok(s.items === 4 && Math.abs(s.view.x - (v0.x - 60)) < 3, `right after a stroke a finger moves the board at the first try: ${JSON.stringify([s.items, v0.x, s.view.x])}`);
  await sleep(600);
  // the lasso in hand: the pen draws its loop, and what lies in it is chosen — it draws no ink
  await kind("lasso");
  assert.equal((await st()).mode, "select");
  await stroke([[cx - 80, 395], [cx + 110, 395], [cx + 110, 500], [cx - 80, 500], [cx - 80, 397]].flatMap((c, i, a) => (i ? Array.from({ length: 6 }, (_v, k) => [a[i - 1][0] + ((c[0] - a[i - 1][0]) * (k + 1)) / 6, a[i - 1][1] + ((c[1] - a[i - 1][1]) * (k + 1)) / 6]) : [c])));
  s = await st();
  assert.deepEqual([s.items, s.kind, s.chosen], [4, "lasso", 2], "with the lasso in hand the pen draws a loop around what it wants, and no ink");
  // a pencil held flat draws broad
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true, cancelable: true })));
  await stroke(line(cx - 100, 640), () => ({ tilt: 65 }));
  await stroke(line(cx - 100, 700), () => ({ tilt: 5 }));
  await page.waitForFunction(() => !MdBoard.state().dirty, null, { timeout: 4000 });
  const paths = await page.evaluate(() => { const d = new DOMParser().parseFromString(localStorage.getItem("mdview-lab:board"), "image/svg+xml"), ids = [...d.querySelectorAll("metadata")][0].textContent.split("\n").filter((l) => l.includes('"k":"ink"')).map((l) => JSON.parse(l)); return ids.map((it) => { const e = d.getElementById(it.id); return [it.t, it.ch, e.tagName, e.getAttribute("fill") !== "none" && e.tagName === "path" ? "outline" : "line"]; }); });
  assert.deepEqual(paths.slice(1, 2), [["pen", "xyptia", "path", "outline"]], "a pen's stroke with changing pressure is an outline that follows it");
  assert.deepEqual(paths.slice(4), [["pencil", "xyptia", "path", "outline"], ["pencil", "xyptia", "g", "line"]], "a pencil held flat draws a broad faint band; held upright, its line");
  // the two settings
  await page.tap('#board [data-do="more"]');
  await sleep(300);
  assert.equal(await page.evaluate(() => !!document.querySelector('#board .bd-vpop [data-m="finger"]')), true, "where a pen was used, More has Draw with Finger");
  await page.tap('#board .bd-vpop [data-m="finger"]');
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  const n = (await st()).items;
  await fingers([[[cx - 80, 800], [cx, 770], [cx + 80, 800]]]);
  assert.equal((await st()).items, n + 1, "Draw with Finger: a finger draws again");
  await sleep(700); // (a tap in the moment after a finger's stroke is not a tap to the browser)
  await kind("lasso");
  const first = await at(...(await page.evaluate(() => { const it = MdBoard.format.parse(localStorage.getItem("mdview-lab:board")).items[1]; return [it.pts[4][0], it.pts[4][1]]; })));
  await pen("mousePressed", ...first); await pen("mouseReleased", ...first);
  await sleep(80);
  s = await st();
  assert.deepEqual([s.mode, s.picked.length, s.items], ["select", 1, n + 1], "with the lasso in hand the pen's tap on a stroke chooses it");
  await context.close();
});

test("pen and fingers together: a finger moves what the lasso holds, a finger's tap chooses a thing, the pen pulls it to size, and draws on beside it", async () => {
  const { page, context, st, fingers, at, sleep, kind, w, h } = await open("tablet");
  const cdp = await context.newCDPSession(page), cx = w / 2, cy = h / 2;
  const pen = (type, x, y, more = {}) => cdp.send("Input.dispatchMouseEvent", { type, x, y, pointerType: "pen", button: type === "mouseMoved" && !more.down ? "none" : "left", buttons: type === "mouseReleased" || (type === "mouseMoved" && !more.down) ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1, force: 0.5 });
  const stroke = async (pts) => { await pen("mousePressed", ...pts[0]); for (let i = 1; i < pts.length; i++) { await pen("mouseMoved", ...pts[i], { down: true }); await sleep(10); } await pen("mouseReleased", ...pts[pts.length - 1]); await sleep(80); };
  const keyDown = (key) => page.evaluate((k) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })), key);
  // something drawn, then held by the lasso
  await kind("pen");
  await stroke(Array.from({ length: 16 }, (_v, i) => [cx - 70 + i * 9, 300 + Math.sin(i / 2) * 14]));
  await keyDown("l");
  await stroke([[cx - 110, 260], [cx + 110, 260], [cx + 110, 340], [cx - 110, 340], [cx - 110, 262]].flatMap((c, i, a) => (i ? Array.from({ length: 6 }, (_v, k) => [a[i - 1][0] + ((c[0] - a[i - 1][0]) * (k + 1)) / 6, a[i - 1][1] + ((c[1] - a[i - 1][1]) * (k + 1)) / 6]) : [c])));
  let s = await st();
  assert.equal(s.chosen, 1, "the lasso holds the stroke");
  await sleep(300);
  // a finger laid on it moves it; the board stays where it is
  const box0 = s.chosenBox, v0 = s.view;
  await fingers([[[cx, 300], [cx + 80, 380]]]);
  s = await st();
  assert.deepEqual([s.chosenBox[0] - box0[0], s.chosenBox[1] - box0[1], Math.round(s.view.x - v0.x), s.chosen], [80, 80, 0, 1], "a finger on what the lasso holds moves it, not the board");
  // beside it, the finger moves the board as before
  await sleep(700);
  await fingers([[[cx - 250, 700], [cx - 190, 700]]]);
  s = await st();
  assert.ok(Math.abs(s.view.x - (v0.x - 60)) < 3 && s.chosenBox[0] === box0[0] + 80, `beside it a finger moves the board: ${JSON.stringify([v0.x, s.view.x])}`);
  await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true, cancelable: true })));
  // the pen at a corner of the strokes' frame pulls them larger
  s = await st();
  const boxA = s.chosenBox, cornerA = await at(boxA[2], boxA[3]);
  await stroke([cornerA, [cornerA[0] + 40, cornerA[1] + 20], [cornerA[0] + 80, cornerA[1] + 40]]);
  s = await st();
  assert.ok(s.items === 1 && s.chosen === 1 && s.chosenBox[2] - s.chosenBox[0] > (boxA[2] - boxA[0]) * 1.3 && s.chosenBox[0] === boxA[0], `the pen at a corner of the chosen strokes' frame pulls them larger: ${JSON.stringify([boxA, s.chosenBox])}`);
  // a shape of the shape tool's tray, pulled open with the pen; the pen at its corner then pulls it to size
  await kind("shape");
  await page.tap('#board [data-form="rect"]');
  await stroke([[cx - 60, 620], [cx, 660], [cx + 90, 720]]);
  s = await st();
  let t = s.things[0];
  assert.deepEqual([s.things.length, s.picked.length, t.w, t.h, s.items], [1, 1, 150, 100, 1], "the shape tool: the shape of its tray is pulled open where the pen goes, and is chosen");
  const inks = s.items, corner = await at(t.x + t.w, t.y + t.h);
  await stroke([corner, [corner[0] + 30, corner[1] + 20], [corner[0] + 60, corner[1] + 40]]);
  s = await st();
  assert.deepEqual([s.items, s.things.length, s.things[0].w - t.w, s.things[0].h - t.h, s.mode], [inks, 1, 60, 40, "select"], "the pen at the new shape's corner pulls it to size, and makes no other");
  // with a pen in hand: a finger's tap on the shape chooses it, and the pen stays in hand
  await kind("pen");
  await sleep(700);
  t = s.things[0];
  await page.touchscreen.tap(...(await at(t.x + t.w / 2, t.y + t.h / 2)));
  await sleep(150);
  s = await st();
  assert.deepEqual([s.kind, s.back, s.picked.length, await page.evaluate(() => document.getElementById("board").dataset.kind)], ["lasso", "pen", 1, "pen"], "a finger's tap on a thing chooses it, and the pens' tray stays");
  const corner2 = await at(t.x + t.w, t.y + t.h);
  await stroke([corner2, [corner2[0] - 15, corner2[1] - 10], [corner2[0] - 30, corner2[1] - 20]]);
  s = await st();
  assert.deepEqual([s.items, t.w - s.things[0].w, t.h - s.things[0].h], [inks, 30, 20], "… the pen at its corner pulls it to size, and draws nothing");
  // on the shape itself it moves it
  t = s.things[0];
  const mid = await at(t.x + t.w / 2, t.y + t.h / 2);
  await stroke([mid, [mid[0] + 20, mid[1] + 10], [mid[0] + 40, mid[1] + 20]]);
  s = await st();
  assert.deepEqual([s.items, s.things[0].x - t.x, s.things[0].y - t.y], [inks, 40, 20], "on the chosen shape the pen moves it");
  // on the bare board the pen draws on
  await stroke(Array.from({ length: 12 }, (_v, i) => [cx - 300 + i * 9, 900 + Math.sin(i / 2) * 10]));
  s = await st();
  assert.deepEqual([s.items, s.mode, s.kind, s.picked.length], [inks + 1, "draw", "pen", 0], "beside it the pen draws on");
  // a finger's tap on the shape chooses it again (a drawing tool in hand, the finger does not draw)
  await sleep(700);
  t = s.things[0];
  const again = await at(t.x + t.w / 2, t.y + t.h / 2);
  await page.touchscreen.tap(...again);
  await sleep(150);
  s = await st();
  assert.deepEqual([s.mode, s.picked.length, s.items], ["select", 1, inks + 1], "a finger's tap on a thing chooses it, whatever tool is in hand");
  // … and the finger moves it
  await sleep(700);
  await fingers([[again, [again[0] - 50, again[1] + 30]]]);
  s = await st();
  assert.deepEqual([Math.round(s.things[0].x - t.x), Math.round(s.things[0].y - t.y)], [-50, 30], "… and moves it");
  await context.close();
});

test("the tray goes where a finger pulls it: upright at a side, shrunk in a corner, opened again by a tap", async () => {
  const { page, context, st, fingers, sleep, kind, w, h } = await open("tablet");
  await kind("pen");
  await sleep(600);
  const where = () => page.evaluate(() => { const p = document.querySelector("#board .bd-palette").getBoundingClientRect(), m = document.querySelector("#board .bd-shrunk").getBoundingClientRect(); return { p: [p.left, p.top, p.width, p.height], m: [m.left, m.top, m.width, m.height] }; });
  const grip = async () => page.evaluate(() => { const r = document.querySelector('#board .bd-tool[data-tool="marker"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await fingers([[await grip(), [w - 40, h / 2]]], { steps: 10 });
  await sleep(700);
  let s = await st(), r = await where();
  assert.deepEqual([s.palette, s.mini, s.tool], ["right", null, "pen"], "pulled by a tool to the right edge: it lies there, and the tool was not taken up");
  assert.ok(r.p[3] > r.p[2] * 2 && r.p[0] + r.p[2] <= w && r.p[1] >= 0 && r.p[1] + r.p[3] <= h, `upright and on the screen: ${JSON.stringify(r.p)}`);
  await fingers([[await grip(), [50, 70]]], { steps: 10 });
  await sleep(500);
  s = await st(); r = await where();
  assert.deepEqual([s.mini, r.m[2]], ["tl", 56], "pulled into a corner: a round sign");
  assert.ok(r.m[0] >= 0 && r.m[1] >= 0, JSON.stringify(r.m));
  await sleep(500);
  await page.tap("#board .bd-shrunk");
  await sleep(400);
  assert.deepEqual([(await st()).mini, (await st()).palette], [null, "right"], "a tap on it: the tray again, where it stood");
  await context.close();
});

test("the tools and their trays: a shape drawn by hand is made clean, a text is put where the pen taps and set from its tray, the eraser has its sizes", async () => {
  const { page, context, st, at, sleep, kind, w } = await open("tablet");
  const cdp = await context.newCDPSession(page), cx = w / 2;
  const pen = (type, x, y, more = {}) => cdp.send("Input.dispatchMouseEvent", { type, x, y, pointerType: "pen", button: type === "mouseMoved" && !more.down ? "none" : "left", buttons: type === "mouseReleased" || (type === "mouseMoved" && !more.down) ? 0 : 1, clickCount: type === "mouseMoved" ? 0 : 1, force: 0.5 });
  const stroke = async (pts) => { await pen("mousePressed", ...pts[0]); for (let i = 1; i < pts.length; i++) { await pen("mouseMoved", ...pts[i], { down: true }); await sleep(6); } await pen("mouseReleased", ...pts[pts.length - 1]); await sleep(80); };
  const shown = () => page.evaluate(() => [...document.querySelectorAll("#board .bd-palette > *")].filter((e) => e.offsetWidth).map((e) => e.className.replace("bd-set", "").trim() || e.dataset.for).join(" | "));
  // ---- each tool has its own tray
  await kind("pen");
  assert.match(await shown(), /bd-tools.*bd-size-now.*bd-wells/);
  assert.ok(await page.evaluate(() => { const p = document.querySelector("#board .bd-palette").getBoundingClientRect(); return Math.min(p.width, p.height) <= 64; }), "the pens' tray is a small one: signs, no taller than a button");
  await kind("eraser");
  assert.ok(!/bd-tools|bd-wells/.test(await shown()) && /bd-sizes/.test(await shown()), await shown());
  await page.tap('#board .bd-sizes [data-w="48"]');
  await page.tap('#board .bd-palette [data-mode="pixel"]');
  let s = await st();
  assert.deepEqual([s.tools.eraser.w, s.tools.eraser.mode], [48, "pixel"], "the eraser's tray: how large, and what it takes");
  // ---- the shape tool, nothing chosen in its tray: drawn by hand, made clean when let go
  await kind("shape");
  assert.match(await shown(), /bd-forms.*bd-sizes.*bd-hue/);
  assert.equal((await st()).form, "auto");
  await page.tap("#board .bd-hue"); await sleep(250);
  assert.equal(await page.evaluate(() => document.querySelector("#board .bd-pop").dataset.what + ":" + document.querySelectorAll("#board .bd-pop .bd-well").length + ":" + !!document.querySelector("#board .bd-wells").offsetWidth), "hues:7:false", "the shape tool's colours: one well in the tray, the colours in a small window beside it");
  await page.tap('#board .bd-pop [data-ink="#e5372c"]'); await sleep(250);
  await page.tap('#board .bd-sizes [data-w="4"]');
  const wobble = (i) => Math.sin(i * 1.7) * 2;
  const side = (a, b, n = 10) => Array.from({ length: n }, (_v, i) => [a[0] + ((b[0] - a[0]) * i) / n + wobble(i), a[1] + ((b[1] - a[1]) * i) / n + wobble(i + 3)]);
  await stroke([...side([cx - 150, 300], [cx + 50, 300]), ...side([cx + 50, 300], [cx + 50, 420]), ...side([cx + 50, 420], [cx - 150, 420]), ...side([cx - 150, 420], [cx - 150, 302]), [cx - 150, 301]]);
  s = await st();
  assert.deepEqual([s.things.length, s.items, s.things[0].shape, s.things[0].fill, s.things[0].stroke, s.picked.length], [1, 0, "rect", "none", { c: "#e5372c", w: 4 }, 1], "a rectangle drawn by hand is a rectangle of the board, in the tray's colour and width, and chosen");
  assert.ok(Math.abs(s.things[0].w - 200) < 8 && Math.abs(s.things[0].h - 120) < 8, JSON.stringify(s.things[0]));
  await stroke(Array.from({ length: 41 }, (_v, i) => [cx + 220 + 70 * Math.cos((i / 40) * 2 * Math.PI) + wobble(i), 520 + 70 * Math.sin((i / 40) * 2 * Math.PI) + wobble(i + 2)]));
  await stroke(Array.from({ length: 12 }, (_v, i) => [cx - 200 + i * 15 + wobble(i) / 2, 600 + i * 6]));
  s = await st();
  assert.deepEqual([s.things.map((t) => t.shape || t.k), s.items], [["rect", "ellipse", "line"], 0], "a circle and a straight line drawn by hand too");
  // ---- the text tool: a text where the pen taps, typed at once; its tray sets it while it is typed
  await kind("text");
  assert.match(await shown(), /bd-type.*bd-hue/);
  await pen("mousePressed", cx - 100, 760); await pen("mouseReleased", cx - 100, 760);
  await sleep(200);
  s = await st();
  assert.ok(s.editing && s.things.length === 4 && s.things[3].k === "text", "the text tool: a tap on the bare board begins a text there");
  await page.keyboard.type("Hello");
  await page.tap('#board .bd-type [data-size="1"]');
  await page.tap('#board .bd-type [data-style="bold"]');
  await page.tap("#board .bd-hue"); await sleep(250);
  await page.tap('#board .bd-pop [data-ink="#1f6fe5"]');
  await page.keyboard.type(" there");
  s = await st();
  assert.deepEqual([s.things[3].text, s.things[3].ts.size, !!s.things[3].ts.bold, s.things[3].ts.color, !!s.editing], ["Hello there", 20, true, "#1f6fe5", true], "its tray sets the text being typed, and the typing goes on");
  const [tx, ty] = await at(s.things[3].x, s.things[3].y);
  assert.ok(Math.abs(tx - (cx - 100)) < 14 && Math.abs(ty + (s.things[3].h * s.view.z) / 2 - 760) < 14, "… and it begins where the pen tapped");
  // a tap beside it ends the typing, and begins no other; the next tap begins one that looks the same
  await pen("mousePressed", cx + 150, 900); await pen("mouseReleased", cx + 150, 900);
  await sleep(200);
  s = await st();
  assert.deepEqual([!!s.editing, s.things.length], [false, 4], "a tap beside it ends the typing");
  await pen("mousePressed", cx + 150, 900); await pen("mouseReleased", cx + 150, 900);
  await sleep(200);
  await page.keyboard.type("x");
  s = await st();
  assert.deepEqual([s.things.length, s.things[4].ts.size, !!s.things[4].ts.bold], [5, 20, true], "the next text begins as the last was set");
  await context.close();
});

test("as a tablet has it: the board let go in mid-move runs on and comes to rest; two fingers' tap takes a step back, three fingers' brings it again", async () => {
  const { page, context, st, fingers, sleep, kind, w, h } = await open("tablet");
  const cdp = await context.newCDPSession(page), cx = w / 2, cy = h / 2;
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  // let go in mid-move: it runs on in the same direction, and stops
  let v0 = (await st()).view;
  await fingers([[[cx, cy], [cx + 160, cy]]], { fling: true, steps: 8 });
  const v1 = (await st()).view;
  await sleep(1500);
  const v2 = (await st()).view;
  assert.ok(v0.x - v2.x > 200 && v2.x <= v1.x && Math.abs(v2.y - v0.y) < 2, `the board runs on after the finger left: ${JSON.stringify([v0.x, v1.x, v2.x])}`);
  await sleep(300);
  assert.equal((await st()).view.x, v2.x, "… and comes to rest");
  // a finger put down stops it at once
  await fingers([[[cx, cy], [cx + 160, cy]]], { fling: true });
  await touch("touchStart", [[cx, cy + 100]]);
  const held = (await st()).view.x;
  await sleep(300);
  await touch("touchEnd", []);
  assert.equal((await st()).view.x, held, "a finger put down holds the board where it is");
  // two fingers' tap: undo; three: redo
  await kind("pen");
  await sleep(600);
  await fingers([[[cx - 80, 300], [cx, 270], [cx + 80, 300]]]);
  assert.equal((await st()).items, 1);
  await sleep(500);
  await touch("touchStart", [[cx - 40, 600], [cx + 40, 600]]); await sleep(60); await touch("touchEnd", []); await sleep(150);
  let s = await st();
  assert.deepEqual([s.items, s.redo, await page.evaluate(() => document.querySelector("#board .bd-said")?.textContent)], [0, 1, "Undo"], "two fingers tapped: the stroke is taken back, and the board says so");
  await sleep(400);
  await touch("touchStart", [[cx - 60, 600], [cx, 600], [cx + 60, 600]]); await sleep(60); await touch("touchEnd", []); await sleep(150);
  assert.equal((await st()).items, 1, "three fingers tapped: it is there again");
  // two fingers that move the board take nothing back
  await sleep(400);
  await fingers([[[cx - 60, 600], [cx - 10, 660]], [[cx + 60, 600], [cx + 110, 660]]]);
  assert.equal((await st()).items, 1, "two fingers that moved are no tap");
  await context.close();
});

test("nothing was thrown along the way", () => { assert.deepEqual(problems, []); });
