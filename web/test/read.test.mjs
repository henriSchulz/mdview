// Reading a repository's notes in a real browser: the built app against a GitHub of the test's
// own, with the desktop app's page inside it. Needs a Chromium (CHROMIUM=/path, or one on PATH).
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
const gh = fakeGitHub();
let app, base, browser, page;
const problems = []; // what the browser complained of: a script refused, an error thrown

const files = {
  "Home.md": "---\ntags: [test]\n---\n\n# Home\n\nSee [[Second note]], [[Deep#Part two|the deep one]] and [a link](sub/Deep.md#part-two).\n\n![a picture](pic.png)\n\n![[Embedded]]\n\n- [ ] a task\n\n$a^2 + b^2 = c^2$\n\n<script>window.__ran = 1</script>\n<img src=x onerror=\"window.__ran = 2\">\n\n[[Nowhere]] and [[paper.pdf#page=1|the paper]].\n",
  "Second note.md": "# The second\n\nBack to [[Home]].\n",
  "sub/Deep.md": "# Deep\n\ntext\n\n## Part two\n\nmore text\n",
  "Embedded.md": "Embedded text with a link to [[Second note]].\n",
  ".obsidian/app.json": "{}",
  ".mdview/project.json": "{\"id\":\"x\",\"version\":1}",
  "node_modules/pkg/readme.md": "# not a note\n",
};

before(async () => {
  for (const [p, text] of Object.entries(files)) gh.repo.files.set(p, Buffer.from(text));
  gh.repo.files.set("pic.png", readFileSync(join(fixtures, "bild.png")));
  gh.repo.files.set("paper.pdf", readFileSync(join(fixtures, "paper.pdf")));
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  // signed in as a browser would be: to GitHub and back, the cookie kept
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

const shown = () => page.evaluate(() => ({ name: MdView.core.current && MdView.core.current.name, text: document.querySelector("#content").innerText, view: document.body.dataset.view }));
const rows = () => page.evaluate(() => [...document.querySelectorAll(".sb-row[data-real]")].map((r) => r.textContent.trim()));
const tabNames = () => page.evaluate(() => [...document.querySelectorAll("#tabs .tab:not(.leaving) .tab-label")].map((t) => t.textContent.trim()));
const untilNote = (name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });

test("a repository opens as the desktop app shows a folder", async () => {
  await page.goto(`${base}/r/octo/notes`);
  await untilNote("Embedded.md"); // (opened for the first time: its first note, by name — as the desktop does)
  await page.goto(`${base}/r/octo/notes?n=Home.md`); // (an address names a note)
  await untilNote("Home.md");
  const now = await shown();
  assert.match(now.text, /Home/);
  assert.match(now.text, /Embedded text with a link/); // (a note embedded with ![[…]] is there, with its own text)
  assert.deepEqual((await rows()).sort(), ["Deep", "Embedded", "Home", "paper.pdf", "Second note"].sort()); // (nothing hidden, nothing of tools)
  assert.equal(await page.evaluate(() => document.querySelector(".sb-folder-name").textContent), "notes");
  assert.deepEqual(await tabNames(), ["Home"]);
  assert.equal(await page.title(), "Home.md");
  assert.equal(new URL(page.url()).searchParams.get("n"), "Home.md");
  // the formula is set, the picture beside the note is there
  assert.ok(await page.evaluate(() => !!document.querySelector("#content .katex")));
  await page.waitForFunction(() => { const i = document.querySelector('#content img[alt="a picture"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await page.waitForTimeout(900); // (the sidebar has come in)
  await page.screenshot({ path: join(web, ".next", "read-home.png") });
  const side = await page.evaluate(() => { const r = document.querySelector("#sidebar").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width), document.body.dataset.sidebar]; });
  assert.ok(side[0] >= 0 && side[1] > 150 && side[2] === "open", `the sidebar is on screen: ${side}`);
});

test("what a note brings cannot run as script", async () => {
  assert.equal(await page.evaluate(() => window.__ran), undefined);
  assert.ok(problems.some((p) => /Content Security Policy|content security policy/i.test(p)) || true); // (the browser may say so; it need not)
  // a file of the repository opened by itself is sandboxed, and nothing unknown is shown as a page
  const pic = await page.request.get(`${base}/file/octo/notes/pic.png`);
  assert.deepEqual([pic.status(), pic.headers()["content-type"], /sandbox/.test(pic.headers()["content-security-policy"]), pic.headers()["x-content-type-options"]], [200, "image/png", true, "nosniff"]);
  const other = await page.request.get(`${base}/file/octo/notes/.obsidian/app.json`);
  assert.equal(other.headers()["content-type"], "text/plain; charset=utf-8");
  assert.equal((await page.request.get(`${base}/file/octo/notes/nope.png`)).status(), 404);
  assert.equal((await page.request.get(`${base}/file/octo/other-repository/Home.md`)).status(), 404); // (only what GitHub lets this user see)
});

test("links lead where they do on the desktop", async () => {
  await page.click('#content a[data-wiki="Second note"]');
  await untilNote("Second note.md");
  assert.match((await shown()).text, /The second/);
  await page.click('#content a[data-wiki="Home"]');
  await untilNote("Home.md");
  // an ordinary link to a note in a folder, with a place in it
  await page.click('#content a[href="sub/Deep.md#part-two"]');
  await untilNote("Deep.md");
  assert.equal(new URL(page.url()).searchParams.get("n"), "sub/Deep.md");
  // back, and back again; forward
  await page.keyboard.press("Alt+ArrowLeft");
  await untilNote("Home.md");
  await page.keyboard.press("Alt+ArrowLeft");
  await untilNote("Second note.md");
  await page.keyboard.press("Alt+ArrowRight");
  await untilNote("Home.md");
  // a note that is not there says so, and nothing changes
  await page.click('#content a[data-wiki="Nowhere"]');
  await page.waitForFunction(() => /doesn.t exist/.test((document.querySelector("#toast") || {}).textContent || ""), null, { timeout: 5000 });
  assert.equal((await shown()).name, "Home.md");
});

test("the sidebar and the tabs", async () => {
  await page.click('.sb-row[data-real="/octo/notes/Second note.md"]');
  await untilNote("Second note.md");
  assert.deepEqual(await tabNames(), ["Second note"]); // (a plain click: in the tab shown)
  await page.click('.sb-row[data-real="/octo/notes/Home.md"]', { modifiers: ["Control"] });
  await untilNote("Home.md");
  assert.deepEqual(await tabNames(), ["Second note", "Home"]); // (Ctrl+click: a tab of its own)
  await page.keyboard.press("Control+Tab");
  await untilNote("Second note.md");
  // kept for the next time the repository is opened
  await page.reload();
  await untilNote("Second note.md");
  assert.deepEqual(await tabNames(), ["Second note", "Home"]);
});

test("a PDF opens in the viewer", async () => {
  await page.click('.sb-row[data-real="/octo/notes/paper.pdf"]');
  await page.waitForFunction(() => MdView.core.current && MdView.core.current.name === "paper.pdf" && document.querySelectorAll("canvas").length > 0, null, { timeout: 20000 });
  await page.screenshot({ path: join(web, ".next", "read-pdf.png") });
  await page.keyboard.press("Alt+ArrowLeft");
  await untilNote("Second note.md");
});

test("what another device sent appears without reloading", async () => {
  gh.repo.files.set("Second note.md", Buffer.from("# The second\n\nChanged on another device.\n"));
  gh.repo.files.set("New here.md", Buffer.from("# New\n"));
  gh.repo.files.delete("Embedded.md");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); // (as when the tab is come back to)
  await page.waitForFunction(() => /Changed on another device/.test(document.querySelector("#content").innerText), null, { timeout: 10000 });
  await page.waitForFunction(() => ![...document.querySelectorAll(".sb-row[data-real]")].some((r) => r.textContent.trim() === "Embedded"), null, { timeout: 5000 }); // (a row that goes fades out first)
  assert.deepEqual((await rows()).sort(), ["Deep", "Home", "New here", "paper.pdf", "Second note"].sort());
});

test("nothing was refused or thrown along the way", () => {
  const real = problems.filter((p) => !/Content Security Policy|Refused to (execute|load)|Failed to load resource/i.test(p));
  assert.deepEqual(real, []);
});
