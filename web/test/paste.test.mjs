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

test("in its tab: a block made in one window stands in the other, with where it came from — and what both made is both there", async () => {
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
  const blocks = (p) => p.$$eval(".ov-pm:not(.leaving) .ov-pm-text", (n) => n.map((x) => x.textContent));
  const stored = async () => JSON.parse((await now()).text).entries.map((e) => e.text);
  const a = await show(), b = await show();
  assert.deepEqual(await blocks(a), ["carried over"]); // (what the desktop wrote above, a text of an older pasteboard: one block)
  assert.equal(await a.evaluate(() => document.activeElement.className), "ov-paste-text"); // (ready to be typed or pasted into)
  // typed, and sent with Enter: a block, and the field is empty again; Shift+Enter is a new line
  await a.type(".ov-paste-text", "first line");
  await a.keyboard.press("Shift+Enter");
  await a.keyboard.type("last line");
  await a.keyboard.press("Enter");
  await until(async () => (await blocks(b)).length === 2 && (await blocks(b))[1] === "first line\nlast line", "the other window has it");
  assert.equal(await text(a), "");
  await until(async () => (await a.textContent(".ov-paste-said")) === "On every device", "said so");
  const made = await b.$$eval(".ov-pm:not(.leaving)", (n) => n.map((x) => [x.querySelector(".ov-pm-from").textContent, x.querySelector(".ov-pm-at").textContent]));
  assert.ok(made[1][0].length > 0 && made[1][1].length > 0, "it says where it came from, and when: " + made[1]);
  assert.equal(made[0][0], ""); // (the older text has no origin)
  // pasted into the field: a block of its own at once, the field stays as it was
  await a.fill(".ov-paste-text", "a draft");
  await a.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "pasted line");
    document.querySelector(".ov-paste-text").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await until(async () => (await blocks(b)).includes("pasted line"), "the pasted block in the other");
  assert.equal(await text(a), "a draft");
  await a.fill(".ov-paste-text", "");
  // both at once: both blocks are there, in the same order in both windows
  await Promise.all([a, b].map((p, i) => p.evaluate((t) => { const f = document.querySelector(".ov-paste-text"); f.value = t; f.dispatchEvent(new Event("input")); f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); }, i ? "from b" : "from a")));
  await until(async () => (await blocks(a)).length === 5 && JSON.stringify(await blocks(a)) === JSON.stringify(await blocks(b)), "joined in both");
  assert.deepEqual((await blocks(a)).slice(0, 3), ["carried over", "first line\nlast line", "pasted line"]);
  assert.deepEqual([...(await blocks(a)).slice(3)].sort(), ["from a", "from b"]);
  await until(async () => (await stored()).length === 5, "kept by the server");
  // each block has a Copy of its own
  await a.evaluate(() => { window.__copied = []; MdView.core.copy = (t) => window.__copied.push(t); });
  await a.hover(".ov-pm:nth-of-type(3)");
  await a.click(".ov-pm:nth-of-type(3) .ov-pm-copy");
  assert.deepEqual(await a.evaluate(() => window.__copied), ["pasted line"]);
  // Clear takes all of them away, everywhere; the desktop's writing shows in both
  await a.click('.ov-paste-bar [data-do="clear"]');
  await until(async () => (await blocks(b)).length === 0 && (await blocks(a)).length === 0, "cleared in both");
  await until(async () => (await stored()).length === 0, "cleared at the server");
  await put("from the desk", (await now()).rev);
  await until(async () => JSON.stringify(await blocks(a)) === '["from the desk"]' && JSON.stringify(await blocks(b)) === '["from the desk"]', "the desktop's text");
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
  await until(async () => JSON.stringify(await blocks(b)) === '["unseen"]', "read again when shown again");
  assert.deepEqual(problems, []);
});
