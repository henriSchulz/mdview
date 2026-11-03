// Much chosen at once on a whiteboard (#43, Henri: „wenn man viel text auswählt z.B. eine halbe seite handschrift im
// notebook laggt dies extremst“): a notebook's page half written full, the lasso drawn around it with a pen that sends
// its samples one by one (WebKitGTK bundles none), a box pulled over it with a mouse, and what is chosen moved. What is
// chosen, and where it is moved, is worked out once a frame, never at every sample; the ink is not drawn anew while the
// choice grows (it does not change the ink); each stroke's outline is made once, not again for each stroke that joins the
// choice nor at each step of a move.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const lab = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dev", "board-lab.html")).href;
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
let browser;
const problems = [];
before(async () => { browser = await chromium.launch({ executablePath: browserPath, headless: true }); });
after(async () => { await browser?.close(); });

test("half a page of handwriting chosen with the lasso and with a box, and moved: worked out once a frame, the ink not drawn anew while chosen, each outline made once", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(lab + "?new");
  await page.waitForFunction(() => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready"));
  // a notebook of one A4 page, its upper half written in: 15 lines of 40 strokes, each of 30 points of changing pressure
  const strokes = await page.evaluate(() => {
    const F = MdBoard.format, model = F.fresh();
    model.board.paper = { bg: "wide", color: "white", size: "a4", n: 1 };
    model.board.view = { x: -20, y: -20, z: 1.4 };
    for (let line = 0; line < 15; line++) for (let s = 0; s < 40; s++) {
      const x0 = 40 + s * 13, y0 = 60 + line * 24;
      model.items.push({ id: F.id(), k: "ink", t: "pen", c: "auto", o: 1, w: 2, ch: "xypt", pts: Array.from({ length: 30 }, (_v, i) => [Math.round((x0 + Math.cos(i / 3) * 4 + i * 0.3) * 10) / 10, Math.round((y0 + Math.sin(i / 2) * 7) * 10) / 10, Math.round((0.3 + (i % 7) / 10) * 100) / 100, i * 8]) });
    }
    localStorage.setItem("mdview-lab:board", F.write(model));
    return model.items.length;
  });
  await page.goto(lab);
  await page.waitForFunction(() => window.MdBoard && MdBoard.shown && document.getElementById("board").hasAttribute("data-ready"));
  await page.waitForTimeout(500);
  assert.equal((await page.evaluate(() => MdBoard.state())).items, strokes);
  // what the board does while the hand goes: counted
  await page.evaluate(() => {
    const B = MdBoard, n = (window.counted = { draw: 0, outline: 0, circled: 0, frames: 0 });
    for (const [o, f, k] of [[B.ink, "draw", "draw"], [B.render, "outline", "outline"], [B.ink, "circled", "circled"]]) { const was = o[f]; o[f] = (...a) => { n[k]++; return was(...a); }; }
    const tick = () => { n.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const on = async (bx, by) => { const v = (await page.evaluate(() => MdBoard.state())).view, r = await page.evaluate(() => { const b = document.querySelector("#board .bd-stage").getBoundingClientRect(); return [b.left, b.top]; }); return [r[0] + (bx - v.x) * v.z, r[1] + (by - v.y) * v.z]; };
  // a hand's pull: down, its samples four to a frame, each an event of its own (a pen of 240 Hz, a window of 60), up — what
  // the board did meanwhile, how long it all took, and the longest frame
  const pull = (pointerType, pts) => page.evaluate(async ([pointerType, pts]) => {
    const stage = document.querySelector("#board .bd-stage"), n = window.counted, frame = () => new Promise((r) => requestAnimationFrame(r));
    const ev = (type, [x, y]) => stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType, isPrimary: true, clientX: x, clientY: y, pressure: type === "pointerup" ? 0 : 0.5, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true }));
    ev("pointerdown", pts[0]);
    await frame();
    for (const k in n) n[k] = 0;
    const t0 = performance.now();
    let last = await frame(), longest = 0;
    for (let i = 1; i < pts.length; i += 4) {
      for (const p of pts.slice(i, i + 4)) ev("pointermove", p);
      const t = await frame();
      longest = Math.max(longest, t - last); last = t;
    }
    const during = { ...n, ms: Math.round(performance.now() - t0), longest: Math.round(longest) };
    ev("pointerup", pts[pts.length - 1]);
    await frame(); await frame();
    return during;
  }, [pointerType, pts]);

  // ---- the lasso: a pen's loop around the written half
  await page.click('#board [data-kind="lasso"]');
  const loop = [];
  for (let i = 0; i <= 360; i++) { const a = (i / 360) * Math.PI * 2 * 0.97 - Math.PI / 2; loop.push(await on(300 + Math.cos(a) * 400, 230 + Math.sin(a) * 300)); }
  let during = await pull("pen", loop), s = await page.evaluate(() => MdBoard.state());
  console.log(`  lasso: ${loop.length - 1} samples in ${during.ms} ms, ${during.frames} frames (the longest ${during.longest} ms); worked out ${during.circled} times, ink drawn ${during.draw} times, ${during.outline} outlines made`);
  assert.equal(s.picked.length, strokes, "the lasso takes every stroke of the written half");
  assert.ok(during.circled <= during.frames + 1, `what the loop holds is worked out once a frame, not at each sample: ${during.circled} times in ${during.frames} frames`);
  assert.equal(during.draw, 0, "the ink is not drawn anew while the choice grows");
  assert.ok(during.outline <= strokes, `each stroke's mark is made once: ${during.outline} outlines for ${strokes} strokes`);

  // ---- the box: a mouse pulls it over the same half, from its top left corner to its lower right
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  const from = await on(-10, 30), to = await on(620, 440), box = Array.from({ length: 241 }, (_v, i) => [from[0] + ((to[0] - from[0]) * i) / 240, from[1] + ((to[1] - from[1]) * i) / 240]);
  during = await pull("mouse", box); s = await page.evaluate(() => MdBoard.state());
  console.log(`  box: ${box.length - 1} moves in ${during.ms} ms, ${during.frames} frames (the longest ${during.longest} ms); ink drawn ${during.draw} times, ${during.outline} outlines made`);
  assert.equal(s.picked.length, strokes, "the box takes every stroke of the written half");
  assert.equal(during.draw, 0, "the ink is not drawn anew while the box grows");
  assert.ok(during.outline <= strokes, `each stroke's mark is made once: ${during.outline} outlines for ${strokes} strokes`);
  // ---- what is chosen, moved: a mouse pulls it along — once a frame, every stroke drawn with the outline it has
  const a = await on(300, 200), mv = Array.from({ length: 241 }, (_v, i) => [a[0] + i, a[1] + i / 2]);
  during = await pull("mouse", mv); s = await page.evaluate(() => MdBoard.state());
  console.log(`  move: ${mv.length - 1} moves in ${during.ms} ms, ${during.frames} frames (the longest ${during.longest} ms); ink drawn ${during.draw} times, ${during.outline} outlines made`);
  assert.ok(during.draw <= during.frames + 1, `what is moved is drawn once a frame, not at each move: ${during.draw} times in ${during.frames} frames`);
  assert.ok(during.outline <= strokes, `a stroke moved keeps its outline: ${during.outline} outlines for ${strokes} strokes`);
  assert.deepEqual(problems, []);
  await context.close();
});
