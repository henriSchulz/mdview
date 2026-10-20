// The iPad's own layout (viewer/tablet.js, viewer/tablet.css): the built app in a browser that says it is an iPad —
// Safari's user agent (an iPad says it is a Mac), five touch points, a finger for a pointer. No sidebar and no tabs;
// a button of four parts at the top left goes to All Notes (the note shrinks into its tile) and back; the folders
// there are opened and left by their path; buttons float in the corners; the note's name goes into the bar when its
// title scrolls away; the menus and the bar over selected blocks are there. Where it is not an iPad, or the window
// is narrow (Split View), nothing of it shows.
// Run: npm run build && npm test          (SHOT_DIR=/dir keeps pictures of every state)
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
const IPAD_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of the long note, with enough words in it to fill a line and wrap onto the next one.`).join("\n\n");
const files = {
  "Home.md": "# Home\n\n## Orga\n\n- Probevortrag: KW37\n- Abschlussvortrag: KW39\n\n" + long + "\n",
  "Second note.md": "# The second\n\nBack to [[Home]].\n",
  "sub/Deep.md": "# Deep\n\ntext\n",
  ".mdview/project.json": "{\"id\":\"x\",\"version\":1}",
  "Formulas.md": "# Formulas\n\nA paragraph of text before the formulas, long enough to wrap onto a second line in the note's column on an iPad.\n\n$$a^2 + b^2 = c^2$$\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\nAfter them.\n\n" + long + "\n",
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

/* a browser: an iPad (Safari's agent, five touch points, a finger), or not; of that size */
async function device(name, { ipad = true, width = 1180, height = 820, touch = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, deviceScaleFactor: 2, ...(ipad ? { userAgent: IPAD_UA } : {}) });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  const page = await context.newPage();
  // (Chromium's touch emulation has one touch point; an iPad has five)
  if (touch) await (await context.newCDPSession(page)).send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${name}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`${name}: ${e}`));
  return { context, page, name };
}
const shot = async (d, what) => { if (SHOTS) await d.page.screenshot({ path: join(SHOTS, `tablet-${d.name}-${what}.png`) }); };
const untilNote = (page, name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
const open = async (d, note = "Home.md", q = "") => { await d.page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(note)}${q}`); await untilNote(d.page, note); await d.page.waitForTimeout(500); };
const rect = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; }, sel);
const shown = (page, sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e) return false; const s = getComputedStyle(e), r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0 && r.width > 0 && r.height > 0; }, sel);
const tap = async (d, sel) => { const r = await rect(d.page, sel); assert.ok(r, `${sel} is there`); await d.page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await d.page.waitForTimeout(700); };

test("an iPad: no sidebar and no tabs, buttons in the corners, the note's name into the bar when its title scrolls away", async () => {
  const d = await device("ipad"), p = d.page;
  await open(d);
  assert.equal(await p.evaluate(() => document.documentElement.hasAttribute("data-ipad")), true, "the boot script told the iPad by its touch points");
  assert.equal(await shown(p, "#sidebar"), false, "no sidebar");
  assert.equal(await shown(p, "#tabs"), false, "no tabs");
  assert.equal(await p.evaluate(() => document.body.dataset.sidebar), "closed");
  const all = await rect(p, "#ipad-nav .ip-all"), bar = await rect(p, "#toolbar"), tools = await rect(p, "#ipad-tools");
  assert.ok(all.x <= 24 && all.y <= 24 && all.w === 44 && all.h === 44, `the button of four parts at the top left: ${JSON.stringify(all)}`);
  assert.ok(1180 - bar.right <= 24 && bar.y <= 24 && bar.h === 44, `the toolbar at the top right: ${JSON.stringify(bar)}`);
  assert.ok(tools.x <= 24 && 820 - tools.bottom <= 30 && tools.h === 44, `the capsule at the bottom left: ${JSON.stringify(tools)}`);
  assert.equal(await shown(p, "#toolbar .seg"), false, "the modes' segments are the pencil's");
  assert.equal(await shown(p, "#settings-btn"), false, "no gear over the note's corner");
  assert.equal(await shown(p, ".ip-title"), false, "the name is not in the bar while the title shows");
  await shot(d, "note");
  await p.evaluate(() => scrollTo(0, 600));
  await p.waitForTimeout(500);
  assert.equal(await shown(p, ".ip-title"), true, "the name in the bar once the title scrolled away");
  assert.equal(await p.evaluate(() => document.querySelector(".ip-title b").textContent), "Home");
  await shot(d, "scrolled");
  await p.evaluate(() => scrollTo(0, 0));
  await p.waitForTimeout(400);
  assert.equal(await shown(p, ".ip-title"), false);
  await d.context.close();
});

test("an iPad: the button of four parts goes to All Notes, the note's tile is where it shrinks to; a folder is opened and left by its path; a tile opens its note", async () => {
  const d = await device("ipad-all"), p = d.page;
  await open(d);
  await tap(d, "#ipad-nav .ip-all");
  assert.equal(await p.evaluate(() => document.body.hasAttribute("data-overview")), true, "All Notes is open");
  assert.equal(await p.evaluate(() => document.querySelector("#ipad-nav .ip-all").getAttribute("aria-pressed")), "true");
  assert.equal(await p.evaluate(() => document.querySelector("#overview .ov-item[aria-current]")?.dataset.path.endsWith("Home.md")), true, "the note's tile is marked: the zoom's end");
  assert.equal(await shown(p, "#toolbar"), false, "the note's toolbar is not over All Notes");
  assert.equal(await shown(p, "#settings-btn"), true, "the gear in All Notes' corner");
  const head = await rect(p, ".ov-head"), btn = await rect(p, "#ipad-nav .ip-all");
  const title = await rect(p, ".ov-title");
  assert.ok(title.x >= btn.right, `the title beside the button, not under it: ${title.x} ${btn.right}`);
  assert.ok(head.y < 60);
  await shot(d, "all");
  // a folder: its path to go back by
  await tap(d, "#overview .ov-folder");
  assert.match(await p.evaluate(() => document.querySelector(".ov-title").textContent), /sub/);
  assert.equal(await p.evaluate(() => !!document.querySelector(".ov-title .ov-crumb")), true, "the way back in the title");
  await shot(d, "folder");
  await tap(d, ".ov-title .ov-crumb");
  assert.equal(await p.evaluate(() => !!document.querySelector(".ov-title .ov-crumb")), false, "back at the top");
  // the button again: back to the note
  await tap(d, "#ipad-nav .ip-all");
  assert.equal(await p.evaluate(() => document.body.hasAttribute("data-overview")), false, "back in the note");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#content")).opacity), "1", "the note grew back out of its tile");
  // All Notes shut by a key: the note comes back all the same, nothing holds it shrunk
  await tap(d, "#ipad-nav .ip-all");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(900);
  assert.equal(await p.evaluate(() => document.body.hasAttribute("data-overview")), false, "Esc shut All Notes");
  assert.equal(await p.evaluate(() => [getComputedStyle(document.querySelector("#content")).opacity, document.querySelector("#content").getAnimations().length].join()), "1,0", "the note is there again");
  // another note, from its tile
  await tap(d, "#ipad-nav .ip-all");
  const tile = await p.evaluate(() => [...document.querySelectorAll("#overview .ov-item")].findIndex((t) => t.dataset.path.endsWith("Second note.md")));
  assert.ok(tile >= 0);
  await tap(d, `#overview .ov-item:nth-child(${tile + 1})`);
  await untilNote(p, "Second note.md");
  await p.waitForTimeout(900);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#content")).opacity), "1", "the note came out of the tile");
  assert.equal(await p.evaluate(() => document.querySelector("#content").getAnimations().length), 0, "and nothing holds it");
  await shot(d, "second");
  await d.context.close();
});

test("an iPad: the menus — the outline from the top right, the pencil writes, the rail lies at the bottom right, selected blocks have their bar and its menu", async () => {
  const d = await device("ipad-menus"), p = d.page;
  await open(d);
  await tap(d, '#toolbar [data-act="outline"]');
  assert.equal(await p.evaluate(() => document.getElementById("outline").matches("[data-open], .open") || getComputedStyle(document.getElementById("outline")).visibility === "visible"), true, "the outline opens");
  const o = await rect(p, "#outline");
  assert.ok(1180 - o.right <= 30 && o.y >= 50, `under the toolbar at the right: ${JSON.stringify(o)}`);
  await shot(d, "outline");
  await p.keyboard.press("Escape");
  await p.mouse.click(600, 400);
  await p.waitForTimeout(400);
  // the pencil: the active mode
  await tap(d, '#ipad-tools [data-ip="write"]');
  await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await p.waitForTimeout(700);
  assert.equal(await p.evaluate(() => document.querySelector('#ipad-tools [data-ip="write"]').getAttribute("aria-pressed")), "true");
  const rail = await rect(p, "#rrail");
  assert.ok(1180 - rail.right <= 24 && 820 - rail.bottom <= 30 && rail.h === 44 && rail.w > 3 * 44, `the rail lies at the bottom right: ${JSON.stringify(rail)}`);
  // insert: the panel opens above the rail
  await tap(d, '#rrail .rp-tab[data-tab="insert"]');
  const panel = await rect(p, "#rpanel");
  assert.ok(await p.evaluate(() => document.body.hasAttribute("data-panel")), "the panel is open");
  assert.ok(panel.bottom <= rail.y, `above the rail: ${panel.bottom} ${rail.y}`);
  await shot(d, "insert");
  await tap(d, '#rrail .rp-tab[data-tab="insert"]');
  // a block selected: the bar of its actions, the menu behind More
  await p.evaluate(() => { const v = MdActive.view.pm; let pos = 0; v.state.doc.forEach((n, off, i) => { if (i === 1) pos = off; }); MdActive.blocks.select(v, pos, false); });
  await p.waitForTimeout(600);
  assert.equal(await shown(p, "#ipad-blockbar"), true, "the bar over selected blocks");
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#ipad-blockbar .ip-tile span")].map((s) => s.textContent)), ["Copy", "Cut", "Duplicate", "Delete", "More"]);
  assert.equal(await shown(p, "#ipad-tools"), false, "the capsule makes room for it");
  await tap(d, "#ipad-blockbar [data-more]");
  assert.equal(await p.evaluate(() => MdActive.menu.isOpen), true, "More: the block's menu");
  await shot(d, "blocks");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => MdActive.view.pm.state.doc.childCount);
  await tap(d, '#ipad-blockbar [data-key="slash.duplicate"]');
  assert.equal(await p.evaluate(() => MdActive.view.pm.state.doc.childCount), before + 1, "Duplicate did what the menu's does");
  await d.context.close();
});

test("an iPad: the handle has no menu — held, it lifts the block at once and moves it; tapped, it selects the block; the bar has the actions", async () => {
  const d = await device("ipad-handle"), p = d.page, cdp = await d.context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await open(d);
  await tap(d, '#ipad-tools [data-ip="write"]');
  await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await p.waitForTimeout(700);
  const order = () => p.evaluate(() => [...document.querySelectorAll("#active .pm > *")].map((e) => e.textContent.slice(0, 14)));
  const menuOpen = () => p.evaluate(() => MdActive.menu.isOpen || !!document.querySelector(".actmenu[data-open], #ctxmenu[data-open], #ctxmenu.open"));
  const picked = () => p.evaluate(() => MdActive.blocks.picked(MdActive.view.pm.state).map((x) => x.node.textContent.slice(0, 14)));
  // the handle of a paragraph: a tap on its text shows it
  const showHandle = async (i) => {
    await p.evaluate(() => { const v = MdActive.view.pm; v.dispatch(v.state.tr.setSelection(PM.state.Selection.atStart(v.state.doc))); document.activeElement.blur(); });
    await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); await p.waitForTimeout(250);
    const at = await p.evaluate((i) => { const e = [...document.querySelectorAll("#active .pm > p")][i]; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return [r.left + 60, r.top + 10]; }, i);
    await p.waitForTimeout(200);
    await p.touchscreen.tap(at[0], at[1]);
    await p.waitForTimeout(400);
    const h = await p.evaluate(() => { const e = document.querySelector(".blk-h"), r = e.getBoundingClientRect(); return { on: e.hasAttribute("data-on"), x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    assert.ok(h.on, "a tapped block has its handle");
    return h;
  };
  // tapped: the block is selected, no menu — its actions are the bar's
  let h = await showHandle(0);
  await p.touchscreen.tap(h.x, h.y);
  await p.waitForTimeout(500);
  assert.equal(await menuOpen(), false, "a tap on the handle opens no menu");
  assert.equal((await picked()).length, 1, "… it selects the block");
  assert.equal(await shown(p, "#ipad-blockbar"), true, "… and the bar of its actions shows");
  // held still: no menu (neither the page's long press nor the browser's), the block is lifted at once; let go, it stays
  h = await showHandle(1);
  const before = await order();
  await touch("touchStart", [[h.x, h.y]]);
  await p.waitForTimeout(250);
  assert.equal(await p.evaluate(() => document.querySelector(".blk-h").hasAttribute("data-dragging")), true, "held, the block is lifted at once");
  await p.waitForTimeout(700);
  assert.equal(await menuOpen(), false, "held past a long press: no menu");
  // … and moved by the same finger, without letting go
  const to = await p.evaluate(() => { const e = [...document.querySelectorAll("#active .pm > p")][4]; const r = e.getBoundingClientRect(); return [r.left + 60, r.bottom - 3]; });
  for (let i = 1; i <= 10; i++) { await touch("touchMove", [[h.x + ((to[0] - h.x) * i) / 10, h.y + ((to[1] - h.y) * i) / 10]]); await p.waitForTimeout(20); }
  await p.waitForTimeout(120);
  await touch("touchEnd", []);
  await p.waitForTimeout(500);
  const after2 = await order();
  assert.notDeepEqual(after2, before, "the held handle moved its block");
  assert.equal(after2.length, before.length);
  assert.equal(await menuOpen(), false, "no menu after the move");
  // held and let go where it was: nothing moves, no menu
  h = await showHandle(1);
  const still = await order();
  await touch("touchStart", [[h.x, h.y]]);
  await p.waitForTimeout(900);
  await touch("touchEnd", []);
  await p.waitForTimeout(500);
  assert.deepEqual(await order(), still, "held and let go in place: nothing moves");
  assert.equal(await menuOpen(), false, "… and no menu");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".blk-h")).webkitTouchCallout || "none"), "none", "no callout of the browser's on the handle");
  await d.context.close();
});

test("an iPad: blocks dragged by the handle — the picture under the finger is exactly as large as the blocks, and leaves the handle under the finger free", async () => {
  const d = await device("ipad-ghost"), p = d.page, cdp = await d.context.newCDPSession(p);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await open(d, "Formulas.md");
  await tap(d, '#ipad-tools [data-ip="write"]');
  await p.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await p.waitForTimeout(900);
  // the paragraph and the two formulas selected
  await p.evaluate(() => { const v = MdActive.view.pm, kids = []; v.state.doc.forEach((n, pos) => kids.push(pos)); MdActive.blocks.select(v, kids[1], false); MdActive.blocks.select(v, kids[3], true); document.activeElement.blur(); scrollTo(0, 0); });
  await p.waitForTimeout(600);
  const sel = await p.evaluate(() => { const els = MdActive.blocks.picked(MdActive.view.pm.state).map((x) => MdActive.view.pm.nodeDOM(x.pos).getBoundingClientRect()); return { n: els.length, left: Math.min(...els.map((r) => r.left)), right: Math.max(...els.map((r) => r.right)), top: els[0].top, bottom: els[els.length - 1].bottom }; });
  assert.equal(sel.n, 3, "three blocks selected");
  const h = await p.evaluate(() => { const e = document.querySelector(".blk-h"), r = e.getBoundingClientRect(); return { on: e.hasAttribute("data-on"), x: r.left + r.width / 2, y: r.top + 14 }; });
  assert.ok(h.on, "their handle shows");
  await touch("touchStart", [[h.x, h.y]]);
  await p.waitForTimeout(200);
  for (let i = 1; i <= 6; i++) { await touch("touchMove", [[h.x + i, h.y + i * 10]]); await p.waitForTimeout(30); }
  await p.waitForTimeout(150);
  const g = await p.evaluate(() => { const e = document.querySelector(".drag-ghost"); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; });
  if (process.env.SHOT_DIR) await shot(d, "ghost");
  const finger = [h.x + 6, h.y + 60];
  await touch("touchEnd", []);
  await p.waitForTimeout(500);
  assert.ok(g, "a picture goes with the finger");
  const bw = sel.right - sel.left, bh = sel.bottom - sel.top;
  assert.ok(Math.abs(g.w - bw) / bw <= 0.02 && Math.abs(g.h - bh) / bh <= 0.02, `the picture as large as the blocks: ${Math.round(g.w)}×${Math.round(g.h)} for ${Math.round(bw)}×${Math.round(bh)}`);
  assert.ok(g.left > finger[0] + 4, `the picture leaves the handle under the finger free: picture from ${Math.round(g.left)}, finger at ${finger[0]}`);
  assert.ok(Math.abs(g.top - (sel.top + 60)) < 6, `… and stands where the blocks stood, moved as far as the finger: ${Math.round(g.top)} for ${Math.round(sel.top + 60)}`);
  await d.context.close();
});

test("not an iPad, or a narrow window: nothing of the iPad's layout", async () => {
  // a browser with a mouse: the sidebar and the tabs as ever
  const desk = await device("desktop", { ipad: false, touch: false });
  await open(desk);
  assert.equal(await desk.page.evaluate(() => document.documentElement.hasAttribute("data-ipad")), false);
  assert.equal(await shown(desk.page, "#ipad-nav"), false);
  assert.equal(await shown(desk.page, "#tabs"), true);
  assert.equal(await desk.page.evaluate(() => document.body.dataset.sidebar), "open", "the sidebar as it was");
  // … made one by hand (?ipad=1), and back (?ipad=0)
  await open(desk, "Home.md", "&ipad=1");
  assert.equal(await desk.page.evaluate(() => document.documentElement.hasAttribute("data-ipad")), true, "?ipad=1 makes any browser an iPad");
  await open(desk);
  assert.equal(await desk.page.evaluate(() => document.documentElement.hasAttribute("data-ipad")), true, "and it is kept");
  await open(desk, "Home.md", "&ipad=0");
  assert.equal(await desk.page.evaluate(() => document.documentElement.hasAttribute("data-ipad")), false, "?ipad=0 takes it back");
  await desk.context.close();
  // a touch screen that is no iPad (Chromium's own agent): as before
  const other = await device("touch", { ipad: false });
  await open(other);
  assert.equal(await other.page.evaluate(() => document.documentElement.hasAttribute("data-ipad")), false);
  assert.equal(await shown(other.page, "#tabs"), true);
  await other.context.close();
  // an iPad in Split View: the narrow layout, the toolbar at the foot
  const split = await device("split", { width: 700, height: 820 });
  await open(split);
  assert.equal(await split.page.evaluate(() => document.documentElement.hasAttribute("data-ipad")), true);
  assert.equal(await shown(split.page, "#ipad-nav"), false, "no button of four parts");
  assert.equal(await shown(split.page, "#ipad-tools"), false);
  const tb = await rect(split.page, "#toolbar");
  assert.ok(tb.bottom > 700, `the toolbar at the foot, as a phone has it: ${JSON.stringify(tb)}`);
  assert.equal(await shown(split.page, "#tabs"), true, "the tabs as a phone has them");
  await shot(split, "split");
  await split.context.close();
});

test("nothing was refused or thrown along the way", () => { assert.deepEqual(problems.filter((p) => !/favicon|Failed to load resource/.test(p)), []); });
