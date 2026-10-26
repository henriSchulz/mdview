// The page under a finger where WebKitGTK shows it — the application on Linux (Henri, 2026-10-24: a tablet's fingers on the
// Mac's screen, over mac-cast): the built app in Chromium that says it is WebKitGTK (its user agent), so that the page does
// what it does there (viewer/hand.js). What WebKitGTK itself does with fingers is checked in WebKitGTK: dev/rig.sh gtktouch.
// - a PDF's pages: one finger moves them and throws them on, two size them around the middle between them (not a whole
//   window made larger: the app's page is not to be pinched, user-scalable=no — without the PDF's own fingers nothing changes);
// - a finger in use makes the PDF's bar and a whiteboard's bars a finger's size, though the pointer is said to be a fine one;
//   a wheel turned makes them a mouse's again;
// - the note in the active mode as the iPad has it while the hand is a finger (Henri, 2026-10-25: viewer/touch.js) — chosen
//   blocks have the bar of tiles and its panels, no menu under a held finger, the handle held lifts its block, the rail lies
//   at the bottom right and a tile of Insert is put in by the finger; a mouse's press, and the menus are back;
// - All Notes under a finger: a tile held is chosen, a tap chooses more, the bar has what the file menu has for them.
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

// a window of Henri's tablet's size, in WebKitGTK's name; with fingers or without
async function device(touch, note = "paper.pdf") {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: touch, deviceScaleFactor: 2, userAgent: GTK });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(note)}`);
  if (note.endsWith(".pdf")) await page.waitForFunction(() => window.MdPdf && MdPdf.shown && MdPdf.shown.pages.length && MdPdf.shown.pages[0].state === "done", null, { timeout: 20000 });
  else await page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, note, { timeout: 15000 });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.MdHand && MdHand.GTK), "the page takes itself to be in WebKitGTK");
  return { context, page };
}

test("linux: a finger moves a PDF's pages and throws them on; two fingers size them, what lay between them staying there", async () => {
  const { context, page: p } = await device(true), cdp = await context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const fingers = async (from, to, { steps = 10, rest = 120, gap = 16 } = {}) => {
    await touch("touchStart", from);
    for (let i = 1; i <= steps; i++) { await touch("touchMove", from.map(([x, y], k) => [x + ((to[k][0] - x) * i) / steps, y + ((to[k][1] - y) * i) / steps])); if (gap) await p.waitForTimeout(gap); }
    if (rest) await p.waitForTimeout(rest);
    await touch("touchEnd", []);
  };
  // (pages enough to move through: the PDF made larger by the bar's button first)
  for (let i = 0; i < 6; i++) await p.click('.pdf-bar [data-do="in"]');
  await p.waitForTimeout(400);
  const y0 = await p.evaluate(() => scrollY);
  await fingers([[640, 600]], [[640, 300]]);
  await p.waitForTimeout(300);
  const y1 = await p.evaluate(() => scrollY);
  assert.ok(Math.abs(y1 - y0 - 300) <= 12, `the pages followed the finger, and stayed where it let go: ${y0} → ${y1}`);
  // thrown: let go while moving fast, they go on after it
  await fingers([[640, 600]], [[640, 450]], { steps: 4, rest: 0, gap: 0 });
  await p.waitForTimeout(900);
  const y2 = await p.evaluate(() => scrollY);
  assert.ok(y2 - y1 > 150 + 120, `thrown, the pages went on after the finger: ${y1} → ${y2}`);
  // two fingers brought together: half as far apart, half the size; the place under the middle between them stays under it
  const under = () => p.evaluate(() => { const v = MdPdf.shown, pg = v.pages.find((x) => x.div.getBoundingClientRect().bottom > 400), r = pg.div.getBoundingClientRect(); return { n: pg.n, fx: (640 - r.left) / r.width, fy: (400 - r.top) / r.height, scale: v.scale }; });
  const was = await under();
  await fingers([[480, 400], [800, 400]], [[560, 400], [720, 400]]);
  await p.waitForTimeout(400);
  const now = await p.evaluate((n) => { const v = MdPdf.shown, r = v.pages[n - 1].div.getBoundingClientRect(); return { fx: (640 - r.left) / r.width, fy: (400 - r.top) / r.height, scale: v.scale }; }, was.n);
  assert.ok(Math.abs(now.scale / was.scale - 0.5) < 0.05, `half as far apart, half the size: ${was.scale} → ${now.scale}`);
  assert.ok(Math.abs(now.fx - was.fx) < 0.03 && Math.abs(now.fy - was.fy) < 0.03, `what lay under the middle stays under it: ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
  // a tap on the bar is still a click
  const z = await p.evaluate(() => MdPdf.shown.scale);
  const b = await p.evaluate(() => { const r = document.querySelector('.pdf-bar [data-do="out"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.touchscreen.tap(b[0], b[1]);
  await p.waitForTimeout(300);
  assert.ok((await p.evaluate(() => MdPdf.shown.scale)) < z, "a tap on Zoom out zooms out");
  await context.close();
});

test("linux: a finger in use makes the PDF's bar and a whiteboard's a finger's size, a wheel a mouse's again", async () => {
  const { context, page: p } = await device(false);
  assert.ok(await p.evaluate(() => !matchMedia("(pointer: coarse)").matches), "a pointer said to be a fine one, as WebKitGTK says it");
  const sizes = (sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((b) => b.offsetWidth && getComputedStyle(b).visibility !== "hidden").map((b) => Math.min(b.offsetWidth, b.offsetHeight)), sel);
  // (a finger, as WebKitGTK tells of one: a pointer of a touch screen)
  const tap = (sel) => p.evaluate((q) => { const t = document.querySelector(q), r = t.getBoundingClientRect(), o = { bubbles: true, pointerType: "touch", pointerId: 9, isPrimary: true, clientX: r.left + 4, clientY: r.top + 4 }; t.dispatchEvent(new PointerEvent("pointerdown", o)); t.dispatchEvent(new PointerEvent("pointerup", o)); }, sel);
  const small = Math.min(...(await sizes(".pdf-bar .tb")));
  assert.ok(small < 40, `a mouse's size first: ${small}`);
  await tap(".pdf-pages .pdf-page");
  assert.ok(await p.evaluate(() => document.documentElement.hasAttribute("data-finger")), "the hand is a finger");
  const pdf = await sizes(".pdf-bar .tb");
  assert.ok(pdf.length >= 6 && Math.min(...pdf) >= 40, `the PDF's bar a finger's size: ${pdf}`);
  await p.click('.pdf-bar [data-do="draw"]');
  await p.waitForFunction(() => window.MdBoard && MdBoard.shown && document.querySelector("#board[data-open]") && MdBoard.state().pdf, null, { timeout: 15000 });
  await p.waitForTimeout(700);
  await tap("#board .bd-stage");
  const board = await sizes("#board .bd-bar .bd-btn, #board .bd-tool");
  assert.ok(board.length >= 6 && Math.min(...board) >= 40, `the whiteboard's bars a finger's size: ${board}`);
  // a wheel turned (no finger on the screen, none a moment before): a mouse's again
  await p.waitForTimeout(1600);
  await p.mouse.move(640, 500);
  await p.mouse.wheel(0, 40);
  await p.waitForTimeout(200);
  assert.ok(!(await p.evaluate(() => document.documentElement.hasAttribute("data-finger"))), "a wheel: the hand is no finger");
  assert.ok(Math.min(...(await sizes("#board .bd-bar .bd-btn"))) < 40, "the whiteboard's bars a mouse's size again");
  await context.close();
});

test("linux: under a finger the note has the iPad's bars — chosen blocks, no menu under a held finger, the handle, the rail, Insert; a mouse has the menus again", async () => {
  const { context, page: p } = await device(true, "Blocks.md"), cdp = await context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const rect = (sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
  const shown = (sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0 && r.width > 0 && r.height > 0; }, sel);
  const tap = async (sel) => { const r = await rect(sel); assert.ok(r, `${sel} is there`); await p.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await p.waitForTimeout(600); };
  const menuShown = () => p.evaluate(() => [document.getElementById("ctxmenu"), document.getElementById("textmenu"), document.getElementById("ctxsub")].some((m) => m && m.hasAttribute("data-open") && getComputedStyle(m).visibility !== "hidden") || !!(window.MdActive && MdActive.menu && MdActive.menu.isOpen));
  const labels = () => p.evaluate(() => [...document.querySelectorAll("#ipad-blockbar .ip-tile span")].map((s) => s.textContent));
  const tile = async (label) => { const t = await p.evaluate((l) => { const b = [...document.querySelectorAll("#ipad-blockbar .ip-tile")].find((x) => x.querySelector("span").textContent === l); return b ? b.dataset.t : null; }, label); assert.ok(t != null, `the tile ${label}`); await tap(`#ipad-blockbar [data-t="${t}"]`); };
  const choose = (re) => p.evaluate((src) => { const v = MdActive.view.pm, rx = new RegExp(src); let pos = -1; v.state.doc.descendants((n, off) => { if (pos < 0 && n.type.name === "paragraph" && rx.test(n.textContent)) { pos = off; return false; } }); MdActive.blocks.select(v, pos, false); }, re);
  const finger = () => p.evaluate(() => document.documentElement.hasAttribute("data-finger"));
  await p.evaluate(() => MdView.setMode("active"));
  await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await p.waitForTimeout(700);
  assert.equal(await p.evaluate(() => document.documentElement.hasAttribute("data-ipad")), false, "no iPad: the application's own layout");
  assert.equal(await shown("#tabs"), true, "the tabs stay");
  // a finger in the note: the rail goes to the bottom right, as a capsule
  const railBefore = await rect("#rrail");
  await tap("#active .pm > p:nth-of-type(2)");
  assert.ok(await finger(), "the hand is a finger");
  const rail = await rect("#rrail");
  assert.ok(rail.bottom > 800 - 40 && rail.right > 1280 - 40 && rail.w > rail.h, `the rail lies at the bottom right: ${JSON.stringify(railBefore)} → ${JSON.stringify(rail)}`);
  // the AI button (on in the application) beside it, not over it (#4)
  await p.evaluate(() => document.body.setAttribute("data-ai", ""));
  await p.waitForTimeout(400);
  const ai = await rect("#ai-bubble"), railAi = await rect("#rrail");
  assert.ok(ai.w > 0 && (ai.x >= railAi.right || ai.right <= railAi.x || ai.y >= railAi.bottom || ai.bottom <= railAi.y), `the AI button beside the rail: ${JSON.stringify(ai)} / ${JSON.stringify(railAi)}`);
  await p.evaluate(() => document.body.removeAttribute("data-ai"));
  // blocks chosen: the bar, and its panels do the work
  await choose("^Paragraph 1 ");
  await p.waitForTimeout(500);
  assert.equal(await shown("#ipad-blockbar"), true, "the bar over chosen blocks");
  assert.deepEqual(await labels(), ["Text Style", "Format", "Insert", "Copy", "Cut", "Duplicate", "Actions", "Delete Block"]);
  await tile("Text Style");
  assert.equal(await shown("#ipad-panel"), true, "its panel rises from the bar");
  const row = await p.evaluate(() => [...document.querySelectorAll("#ipad-panel [data-r]")].find((b) => b.textContent.trim() === "Heading 2").dataset.r);
  await tap(`#ipad-panel [data-r="${row}"]`);
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#active .pm > h2")].some((h) => /^Paragraph 1 /.test(h.textContent))), true, "turned into a heading by the bar");
  assert.equal(await menuShown(), false, "no menu of the old kind");
  // a finger held on the note's text: no menu
  await p.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, 1))); });
  await p.waitForTimeout(300);
  const t3 = await rect("#active .pm > p:nth-of-type(3)");
  await touch("touchStart", [[t3.x + 60, t3.y + 8]]);
  await p.waitForTimeout(800);
  await touch("touchEnd", []);
  await p.waitForTimeout(400);
  assert.equal(await menuShown(), false, "held on the text: no menu");
  // the handle: a tap chooses its block (no menu), held it lifts the block at once
  await p.keyboard.press("Escape"); await p.keyboard.press("Escape");
  await tap("#active .pm > p:nth-of-type(4)");
  const h = await p.evaluate(() => { const e = document.querySelector(".blk-h"), r = e.getBoundingClientRect(); return { on: e.hasAttribute("data-on"), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  assert.ok(h.on, "a tapped block has its handle");
  await touch("touchStart", [[h.x, h.y]]);
  await p.waitForTimeout(250);
  assert.equal(await p.evaluate(() => document.querySelector(".blk-h").hasAttribute("data-dragging")), true, "held, the block is lifted at once");
  await p.waitForTimeout(500);
  await touch("touchEnd", []);
  await p.waitForTimeout(500);
  assert.equal(await menuShown(), false, "the handle held: no menu");
  assert.equal(await p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).length), 1, "let go in place: the block chosen");
  assert.equal(await shown("#ipad-blockbar"), true, "… with its bar");
  // Insert: a tile held by the finger is put where it is let go
  await p.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, 1))); v.dom.blur(); });
  await p.waitForTimeout(400);
  await tap('#rrail .rp-tab[data-tab="insert"]');
  assert.equal(await p.evaluate(() => document.body.hasAttribute("data-panel")), true, "the Insert panel is open");
  const panel = await rect("#rpanel");
  assert.ok(panel.bottom <= rail.y - 8, `the panel above the rail: ${JSON.stringify(panel)}`);
  const from = await p.evaluate(() => { const t = [...document.querySelectorAll("#rpanel .rp-tile")].find((x) => x.querySelector(".rp-name").textContent === "Table"); const r = t.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const [gap, first] = await p.evaluate((left) => { const ps = [...document.querySelectorAll("#active .pm > p")]; for (let i = 0; i + 1 < ps.length; i++) { const r = ps[i].getBoundingClientRect(); if (r.bottom > 250 && r.bottom < innerHeight - 250 && r.left + 80 < left - 10) return [[r.left + 80, r.bottom - 3], ps[i].textContent.slice(0, 13)]; } return [null, null]; }, panel.x);
  assert.ok(gap, "two paragraphs in the middle of the window, clear of the panel");
  await touch("touchStart", [from]);
  await p.waitForFunction(() => document.body.hasAttribute("data-ip-dragging"), null, { timeout: 3000 });
  for (let i = 1; i <= 12; i++) { await touch("touchMove", [[from[0] + (gap[0] - from[0]) * i / 12, from[1] + (gap[1] - from[1]) * i / 12]]); await p.waitForTimeout(20); }
  assert.equal(await shown("#ip-ghost"), true, "the tile goes with the finger");
  await touch("touchEnd", []);
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate((f) => { const kids = [...document.querySelectorAll("#active .pm > *")]; const i = kids.findIndex((x) => x.textContent.startsWith(f)); return !!kids[i + 1] && /table/i.test(kids[i + 1].tagName + kids[i + 1].className); }, first), true, "the table put in after the paragraph");
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#rpanel .rp-tile[data-i]")].filter((t) => t.querySelector(".rp-grip")).every((t) => t.draggable)), true, "the tiles a mouse drags: still draggable");
  // a mouse: blocks chosen have no bar, a right click its menu, the rail stands where it stood
  await choose("^Paragraph 6 ");
  await p.waitForTimeout(400);
  assert.equal(await shown("#ipad-blockbar"), true, "under the finger still: the bar");
  await p.waitForTimeout(700); // (not the mouse WebKitGTK makes up after a tap)
  const b6 = await p.evaluate(() => { const e = [...document.querySelectorAll("#active .pm > p")].find((x) => /^Paragraph 6 /.test(x.textContent)); const r = e.getBoundingClientRect(); return [r.left + 60, r.top + 8]; });
  await p.mouse.click(b6[0], b6[1], { button: "right" });
  await p.waitForTimeout(500);
  assert.equal(await finger(), false, "a mouse's press: the hand is no finger");
  assert.equal(await shown("#ipad-blockbar"), false, "the bar is gone");
  assert.equal(await menuShown(), true, "a right click has its menu");
  const back = await rect("#rrail");
  assert.ok(Math.abs(back.y - railBefore.y) < 2 && Math.abs(back.right - railBefore.right) < 2, `the rail where it stood: ${JSON.stringify(back)}`);
  await context.close();
});

test("linux: All Notes under a finger — a tile held is chosen, a tap chooses one more, the bar has the file menu's entries; a mouse, and the bar goes", async () => {
  const { context, page: p } = await device(true, "Blocks.md"), cdp = await context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const centre = (sel) => p.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [Math.round(r.left + Math.min(r.width / 2, 60)), Math.round(r.top + Math.min(r.height / 2, 60))]; }, sel);
  const shown = (sel) => p.evaluate((q) => { const e = document.querySelector(q); if (!e) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0 && r.width > 0 && r.height > 0; }, sel);
  const menuShown = () => p.evaluate(() => [document.getElementById("ctxmenu"), document.getElementById("ctxsub")].some((m) => m && m.hasAttribute("data-open") && getComputedStyle(m).visibility !== "hidden"));
  const picked = () => p.evaluate(() => MdOverview.picked.map((x) => x.replace(/^.*\//, "")).sort());
  await p.waitForFunction(() => !!window.MdOverview, null, { timeout: 10000 });
  await p.evaluate(() => MdOverview.open());
  await p.waitForSelector('#overview[data-open] .ov-item[data-path$="Home.md"]', { timeout: 10000 });
  await p.waitForTimeout(600);
  const at = await centre('#overview .ov-item[data-path$="Home.md"]');
  await touch("touchStart", [at]);
  await p.waitForTimeout(800);
  await touch("touchEnd", []);
  await p.waitForTimeout(500);
  assert.equal(await menuShown(), false, "a held tile: no menu");
  assert.deepEqual(await picked(), ["Home.md"], "the tile held is chosen");
  assert.equal(await shown("#ipad-pickbar"), true, "its bar");
  const labels = await p.evaluate(() => [...document.querySelectorAll("#ipad-pickbar .ip-tile span")].map((s) => s.textContent));
  for (const l of ["Done", "Copy", "Duplicate", "Rename"]) assert.ok(labels.includes(l), `${l} in the bar: ${labels}`);
  const b = await centre('#overview .ov-item[data-path$="paper.pdf"]');
  await p.touchscreen.tap(b[0], b[1]);
  await p.waitForTimeout(600);
  assert.deepEqual(await picked(), ["Home.md", "paper.pdf"], "a tap chooses one more, and opens nothing");
  assert.ok(await p.evaluate(() => document.body.hasAttribute("data-overview")), "All Notes still open");
  assert.equal(await p.evaluate(() => document.querySelector('#overview .ov-item[data-path$="Home.md"]').draggable), true, "a mouse still drags the tile");
  await p.waitForTimeout(700);
  await p.mouse.click(5, 400);
  await p.waitForTimeout(400);
  assert.equal(await shown("#ipad-pickbar"), false, "a mouse: the bar is gone");
  await context.close();
});

test("linux: blocks chosen together — Format › Bold from the bar makes all of them bold (Henri, 2026-10-25: only one was)", async () => {
  const { context, page: p } = await device(true, "Bold.md");
  const rect = (sel) => p.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
  const tap = async (sel) => { const r = await rect(sel); await p.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await p.waitForTimeout(600); };
  const posOf = (n) => p.evaluate((k) => { let at = -1; MdActive.view.pm.state.doc.descendants((x, off) => { if (at < 0 && x.type.name === "paragraph" && x.textContent.startsWith(`Paragraph ${k} `)) { at = off; return false; } }); return at; }, n);
  const bold = (ns) => p.evaluate((ks) => ks.map((k) => { let b = null; MdActive.view.pm.state.doc.descendants((x) => { if (b === null && x.type.name === "paragraph" && x.textContent.startsWith(`Paragraph ${k} `)) { let all = true; x.forEach((t) => { if (!t.marks.some((m) => m.type.name === "strong")) all = false; }); b = all; return false; } }); return b; }), ns);
  const boldFromBar = async () => {
    const t = await p.evaluate(() => [...document.querySelectorAll("#ipad-blockbar .ip-tile")].find((x) => x.querySelector("span").textContent === "Format").dataset.t);
    await tap(`#ipad-blockbar [data-t="${t}"]`);
    const r = await p.evaluate(() => [...document.querySelectorAll("#ipad-panel [data-r]")].find((b) => b.textContent.trim() === "Bold").dataset.r);
    await tap(`#ipad-panel [data-r="${r}"]`);
  };
  await p.evaluate(() => MdView.setMode("active"));
  await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await p.waitForTimeout(700);
  await tap("#active .pm > p:nth-of-type(2)"); // (the hand a finger)
  // three in a row
  await p.evaluate(async ([a, b]) => { const v = MdActive.view.pm; MdActive.blocks.select(v, a, false); MdActive.blocks.select(v, b, true); }, [await posOf(1), await posOf(3)]);
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).length), 3, "three chosen");
  await boldFromBar();
  assert.deepEqual(await bold([1, 2, 3]), [true, true, true], "all three in a row bold");
  // one here, one there (as a swipe adds them)
  await p.evaluate(async ([a, b]) => { const v = MdActive.view.pm; MdActive.blocks.select(v, a, false); MdActive.blocks.toggle(v, b); }, [await posOf(5), await posOf(8)]);
  await p.waitForTimeout(400);
  assert.equal(await p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).length), 2, "two chosen apart");
  await boldFromBar();
  assert.deepEqual(await bold([5, 8]), [true, true], "both apart bold");
  // chosen by the finger itself: a swipe to the right on each
  const cdp = await context.newCDPSession(p), touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y]) => ({ x, y })) });
  await p.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.TextSelection.create(v.state.doc, 1))); v.dom.blur(); });
  await p.waitForTimeout(400);
  for (const k of [10, 11, 13]) {
    const at = await p.evaluate((n) => { const e = [...document.querySelectorAll("#active .pm > p")].find((x) => x.textContent.startsWith(`Paragraph ${n} `)); e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return [r.left + 40, r.top + 10]; }, k);
    await p.waitForTimeout(200);
    await touch("touchStart", [at]);
    for (let i = 1; i <= 12; i++) { await touch("touchMove", [[at[0] + i * 14, at[1]]]); await p.waitForTimeout(16); }
    await touch("touchEnd", []);
    await p.waitForTimeout(700);
  }
  assert.equal(await p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).length), 3, "three chosen by swipes");
  await boldFromBar();
  assert.deepEqual(await bold([10, 11, 13]), [true, true, true], "all three swiped bold");
  await context.close();
});
