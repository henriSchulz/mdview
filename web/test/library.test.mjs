// The library, the sidebar's layout to begin with (Henri, 2026-11-04: "die soll apple getreuer aussehen … wir bauen den neuen
// Standard" — the Velum lab's sidebar, ~/Projects/velum/lab/web/app.html): the search at its head, a Library of rows, the
// folder's own folders and no note; a folder chosen is All Notes in it, beside the sidebar, which stays. The built app against
// a GitHub of the test's own. Needs a Chromium (CHROMIUM=/path, or one on PATH). Run: npm run build && npm test
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
const problems = [];

const files = {
  "Analysis/Uniform convergence.md": "# Uniform convergence\n\ntext\n",
  "Analysis/Lectures/Lecture 08.md": "# Lecture 08\n\ntext\n",
  "Velum/Opal tokens.md": "# Opal tokens\n\n- [ ] a task\n",
  "Inbox.md": "# Inbox\n\ntext\n",
  ".mdview/project.json": "{\"id\":\"x\",\"version\":1}",
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
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  const session = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  assert.ok(browserPath && existsSync(browserPath), "no Chromium found (set CHROMIUM)");
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: session.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const untilNote = (name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
const layout = () => page.evaluate(() => [window.MdPrefs.sidebarLayout, document.getElementById("sidebar").dataset.layout]);
const opened = async () => { await page.evaluate(() => { if (document.body.dataset.sidebar !== "open") document.querySelector('#tabs [data-act="sidebar"]').click(); }); await page.waitForTimeout(500); };
// what the sidebar shows: the Library's rows, the folders' and the notes' rows that can be seen, the one marked
const seen = () => page.evaluate(() => {
  const sb = document.getElementById("sidebar"), shown = (el) => el.getClientRects().length > 0, name = (el) => el.querySelector(".sb-label").textContent.trim();
  return {
    lib: [...sb.querySelectorAll(".sb-smart [data-smart]")].filter(shown).map((b) => b.dataset.smart),
    dirs: [...sb.querySelectorAll(".sb-list .sb-item.is-dir > .sb-in > .sb-row")].filter(shown).map(name),
    notes: [...sb.querySelectorAll(".sb-list .sb-row[data-real]")].filter(shown).map(name),
    on: [...sb.querySelectorAll(".sb-smart .on, .sb-list .sb-row.on")].map(name),
    search: shown(sb.querySelector(".qn-search")),
  };
});

test("the library is the sidebar's layout to begin with; sheets or a rail kept from before are let go once, chosen again they stay", async () => {
  await page.goto(`${base}/r/octo/notes?n=Inbox.md`);
  await untilNote("Inbox.md");
  assert.deepEqual(await layout(), ["library", "library"]);
  // a browser that kept the sheets while they were the default, before this
  await page.evaluate(() => { localStorage.setItem("mdview:set", JSON.stringify({ sidebarLayout: "sheets" })); localStorage.removeItem("mdview:library-first"); });
  await page.reload(); await untilNote("Inbox.md");
  assert.deepEqual(await layout(), ["library", "library"]);
  assert.equal(await page.evaluate(() => "sidebarLayout" in JSON.parse(localStorage.getItem("mdview:set") || "{}")), false);
  // chosen again: it stays
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "prefs", prefs: { sidebarLayout: "sheets" } })));
  await page.reload(); await untilNote("Inbox.md");
  assert.deepEqual(await layout(), ["sheets", "sheets"]);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("mdview:set") || "{}"); delete s.sidebarLayout; localStorage.setItem("mdview:set", JSON.stringify(s)); });
  await page.reload(); await untilNote("Inbox.md");
});

test("the library: search, the Library's rows, the folder's own folders and no note; a folder chosen is All Notes in it, and the sidebar stays", async () => {
  await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent("Analysis/Uniform convergence.md")}`);
  await untilNote("Uniform convergence.md");
  await opened();
  let now = await seen();
  assert.equal(now.search, true, "the search at its head");
  assert.deepEqual(now.lib, ["all", "recent", "today", "tasks", "shared", "boards"]);
  assert.deepEqual(now.dirs, ["Analysis", "Velum"], "the folder's own folders, no deeper");
  assert.deepEqual(now.notes, [], "no note in it");
  assert.deepEqual(now.on, ["Analysis"], "the folder of the note shown is marked");
  // a folder chosen: All Notes in it, beside the sidebar — which stays, with its button
  await page.click('#sidebar .sb-list .sb-row:has(.sb-label:text-is("Velum"))');
  await page.waitForFunction(() => window.MdOverview && MdOverview.isOpen && MdOverview.where().at.join("/") === "Velum", null, { timeout: 5000 });
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.body.dataset.sidebar), "open", "the sidebar stays over All Notes");
  assert.equal(await page.evaluate(() => document.querySelector(".tab-side").getClientRects().length > 0), true, "and so does its button");
  assert.deepEqual((await seen()).on, ["Velum"]);
  // All Notes and the whiteboards: All Notes, the whole folder
  await page.click('#sidebar [data-smart="all"]');
  await page.waitForFunction(() => MdOverview.where()?.scope === "all", null, { timeout: 5000 });
  assert.deepEqual((await seen()).on, ["All Notes"]);
  await page.click('#sidebar [data-smart="boards"]');
  await page.waitForFunction(() => MdOverview.where()?.scope === "boards", null, { timeout: 5000 });
  assert.deepEqual((await seen()).on, ["Whiteboards"]);
  // and they are asked for: the list comes, not "Looking for Whiteboards…" for ever (#55)
  await page.waitForFunction(() => !/Looking for Whiteboards/.test(document.querySelector("#overview .ov-body").textContent), null, { timeout: 5000 });
  // the gear at its lower right, New at its foot
  const foot = await page.evaluate(() => { const sb = document.getElementById("sidebar").getBoundingClientRect(), g = document.getElementById("settings-btn").getBoundingClientRect(), n = document.querySelector('#sidebar [data-act="newmenu"]').getBoundingClientRect(); return { gearRight: g.right > sb.right - 60 && g.right <= sb.right, gearLow: g.bottom > sb.bottom - 40, newLeft: n.left < sb.left + 40 && n.bottom > sb.bottom - 50 }; });
  assert.deepEqual(foot, { gearRight: true, gearLow: true, newLeft: true });
});

test("nothing was refused or thrown along the way", () => {
  assert.deepEqual(problems.filter((p) => !/favicon|404/.test(p)), []);
});
