// A project's pasteboard: one text for a repository, kept by the server and the same in every
// window that shows it — for the browser by its session, for the desktop app by its token. The
// built app, a real Chromium with two windows, a GitHub of the test's own.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, context, cookie;
const problems = [];
const until = async (f, what, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`not within ${ms} ms: ${what}`); };
const AT = "/paste/octo/notes";
const as = () => ({ authorization: `Bearer ${gh.validAccess}`, "content-type": "application/json" }); // (the desktop app: the token of its own sign-in)
const put = (text, rev, headers = as()) => fetch(base + AT, { method: "PUT", headers, body: JSON.stringify({ text, base: rev, by: "a desk" }) });
const now = async () => (await fetch(base + AT, { headers: as() })).json();

before(async () => {
  gh.repo.files.set("Alpha.md", Buffer.from("# Alpha\n\ntext\n"));
  gh.repo.files.set(".mdview/project.json", Buffer.from('{"id":"x","version":1}\n'));
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-tests-own-0123456789", STORE: "memory", PASTE_WAIT_MS: "4000" } });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  cookie = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: cookie.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
});
after(async () => { await browser?.close(); app?.kill(); gh.close(); });

test("not for anyone: without a sign-in nothing is read or written, and a token GitHub does not know is none", async () => {
  assert.equal((await fetch(base + AT, { redirect: "manual" })).status, 401); // (told so, not sent to a page: the desktop app asks here too)
  assert.equal((await fetch(base + AT, { headers: { authorization: "Bearer not-a-token" } })).status, 401);
  assert.equal((await put("x", 0, { "content-type": "application/json" })).status, 401);
});

test("written from what stands there, it is taken; from anything else, what stands there is told instead", async () => {
  assert.deepEqual(await now(), { text: "", rev: 0, at: "", by: "" });
  const first = await put("one", 0);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).rev, 1);
  const late = await put("two", 0); // (begun before "one" was there)
  assert.equal(late.status, 409);
  const stands = await late.json();
  assert.deepEqual([stands.text, stands.rev, stands.by], ["one", 1, "a desk"]);
  assert.equal((await put("two", 1)).status, 200);
  assert.equal((await now()).text, "two");
  // by the session as well: the same pasteboard, and the writing is signed with the account
  const mine = await fetch(base + AT, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ text: "three", base: 2, by: "a browser" }) });
  assert.equal(mine.status, 200);
  assert.equal((await now()).by, "octo · a browser");
  assert.equal((await put("x".repeat(200_001), 3)).status, 413);
  assert.equal((await put(7, 3)).status, 400);
});

test("who waits for the next text has it as it is written — and is answered after a while all the same", async () => {
  const { rev } = await now();
  let got = null;
  const t = Date.now(), waits = fetch(`${base}${AT}?rev=${rev}&wait=1`, { headers: as() }).then(async (r) => { got = await r.json(); });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(got, null); // (nothing new: no answer yet)
  await put("carried over", rev);
  await waits;
  assert.ok(Date.now() - t < 2000, "answered when it was written, not at the end of the wait");
  assert.deepEqual([got.text, got.rev], ["carried over", rev + 1]);
  const idle = await (await fetch(`${base}${AT}?rev=${rev + 1}&wait=1`, { headers: as() })).json(); // (PASTE_WAIT_MS)
  assert.equal(idle.rev, rev + 1);
});

test("in its tab: typed in one window, it stands in the other — and what both wrote is both there", async () => {
  const show = async () => {
    const page = await context.newPage();
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    await page.goto(`${base}/r/octo/notes?n=Alpha.md`);
    await page.waitForFunction(() => window.MdView && MdView.core.current && document.querySelector("#content").innerText.length > 0, null, { timeout: 15000 });
    await page.click('.tab-home[data-act="overview"]');
    await page.click("#overview .ov-pastebtn"); // (its own tab)
    await page.waitForSelector('.ov-paste[data-state="ok"]');
    return page;
  };
  const text = (p) => p.inputValue(".ov-paste-text");
  const a = await show(), b = await show();
  assert.equal(await text(a), "carried over"); // (what the desktop wrote above)
  assert.equal(await a.evaluate(() => document.activeElement.className), "ov-paste-text"); // (ready to be typed or pasted into)
  await a.fill(".ov-paste-text", "first line\nlast line\n");
  await until(async () => (await text(b)) === "first line\nlast line\n", "the other window has it");
  await until(async () => (await a.textContent(".ov-paste-said")) === "On every device", "said so");
  // both at once, in different places: the first writing is taken, the second joined with it
  await a.evaluate(() => { const t = document.querySelector(".ov-paste-text"); t.setRangeText("A ", 0, 0, "end"); t.dispatchEvent(new Event("input")); });
  await b.evaluate(() => { const t = document.querySelector(".ov-paste-text"); t.focus(); t.setRangeText("B\n", t.value.length, t.value.length, "end"); t.dispatchEvent(new Event("input")); });
  const both = "A first line\nlast line\nB\n";
  await until(async () => (await text(a)) === both && (await text(b)) === both, "joined in both");
  assert.equal((await now()).text, both);
  assert.equal(await b.evaluate(() => document.querySelector(".ov-paste-text").selectionStart), both.length); // (the caret stayed where it was typing)
  // Clear empties it, everywhere; the desktop's writing shows in both
  await a.click('.ov-paste-bar [data-do="clear"]');
  await until(async () => (await text(b)) === "", "cleared in the other");
  await put("from the desk", (await now()).rev);
  await until(async () => (await text(a)) === "from the desk" && (await text(b)) === "from the desk", "the desktop's text");
  // out of sight, it is not asked for: nothing waits at the server
  await a.click('#tabs .tab[data-path$="Alpha.md"]');
  await a.waitForFunction(() => !MdOverview.isOpen, null, { timeout: 4000 });
  await b.click('#tabs .tab[data-path$="Alpha.md"]'); // (out of sight: another tab — gone once the note is there)
  await b.waitForFunction(() => !MdOverview.isOpen, null, { timeout: 4000 });
  await new Promise((r) => setTimeout(r, 300));
  const asked = [];
  for (const p of [a, b]) p.on("request", (r) => { if (r.url().includes("/paste/")) asked.push(r.method()); });
  await put("unseen", (await now()).rev);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(asked, []); // (whoever waited when it went out of sight has its answer now, and does not ask again)
  assert.equal(await b.evaluate(() => MdOverview.isOpen), false); // (its tab is not the one shown)
  await b.click("#tabs .tab >> text=Pasteboard"); // (its tab again)
  await until(async () => (await text(b)) === "unseen", "read again when shown again");
  assert.deepEqual(problems, []);
});
