// New Space, over the notebooks: a repository made on GitHub under the space's name as GitHub
// takes it (the same rule as the desktop app's), private, made a notebook with its first commit,
// and opened — or why not, said in the window. The built app, a real Chromium, a GitHub of the
// test's own (nothing is made on the real one).
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";
import { newName } from "../lib/reponame.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser, page, cookie;
const problems = [];

before(async () => {
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
  cookie = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  assert.ok(browserPath && existsSync(browserPath), "no Chromium found (set CHROMIUM)");
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: cookie.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(() => localStorage.setItem("mdview:device", JSON.stringify({ id: "11111111-2222-3333-4444-555555555555", name: "Chrome on Linux" })));
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const said = () => page.evaluate(() => document.querySelector(".ns-why")?.textContent || "");

test("a space's repository is named as the desktop app names it", () => {
  const list = JSON.parse(readFileSync(join(web, "..", "dev", "tests", "fixtures", "repo-names.json"), "utf8"));
  for (const [space, repo] of list.names) assert.equal(newName(space), repo, JSON.stringify(space));
});

test("New Space: the name, the repository it will be, why not where it was not made — and made, it opens as a notebook", async () => {
  await page.goto(base + "/");
  await page.waitForSelector(".new-space", { timeout: 15000 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".ns")).visibility), "hidden", "the window is not there before the button is pressed");
  await page.click(".new-space");
  await page.waitForTimeout(500);
  console.log("DBG", await page.evaluate(() => [document.activeElement?.outerHTML.slice(0, 200), document.querySelector(".ns").outerHTML.slice(0, 300)]));
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "ns-name");
  assert.equal(await page.isDisabled(".ns button[type=submit]"), true, "nothing to make without a name");
  await page.keyboard.type("Uni Notizen");
  assert.match(await page.textContent(".ns-repo"), /^On GitHub: octo\/mdview_Uni-NotizenPrivate repository$/);
  // taken: said, and the name there to be changed
  gh.taken = ["mdview_Uni-Notizen"];
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /named “mdview_Uni-Notizen” on your account already/.test(document.querySelector(".ns-why")?.textContent || ""), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => document.activeElement.id), "ns-name");
  assert.equal(await page.evaluate(() => document.querySelector(".ns").hasAttribute("data-open")), true);
  // the app may not make repositories (its permission not accepted): said, and where on GitHub
  gh.createDenied = true;
  await page.fill("#ns-name", "Uni");
  await page.click(".ns button[type=submit]");
  await page.waitForFunction(() => /accept the app's new permission/i.test(document.querySelector(".ns-why")?.textContent || ""), null, { timeout: 8000 });
  assert.equal(await page.getAttribute(".ns-why a", "href"), "https://github.com/settings/installations");
  gh.createDenied = false;
  // made, but not given to the app: said, with where repositories are chosen — and nothing written to it
  gh.createUnreached = true;
  const commits = gh.commits.length;
  await page.fill("#ns-name", "Hidden");
  await page.click(".ns button[type=submit]");
  await page.waitForFunction(() => /“octo\/mdview_Hidden” was created, but Markdown Notes can't reach it/.test(document.querySelector(".ns-why")?.textContent || ""), null, { timeout: 8000 });
  assert.equal(await page.getAttribute(".ns-why a", "href"), "https://github.com/settings/installations/7");
  assert.equal(gh.commits.length, commits);
  gh.createUnreached = false;
  // Esc closes it
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".ns").hasAttribute("data-open"));
  // made: private and empty, its first commit the app's marker, and it opens
  await page.click(".new-space");
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === "ns-name" && document.activeElement.value === "");
  await page.keyboard.type("Physik Übungen");
  await page.keyboard.press("Enter");
  await page.waitForURL(`${base}/r/octo/mdview_Physik-Uebungen`, { timeout: 15000 });
  assert.deepEqual(gh.created.at(-1), { name: "mdview_Physik-Uebungen", private: true, auto_init: false, description: "Notes, kept with Markdown Notes" });
  assert.equal(gh.repo.name, "mdview_Physik-Uebungen");
  assert.match(gh.repo.files.get(".mdview/project.json").toString(), /"version": 1/);
  const first = gh.commits.at(-1);
  assert.deepEqual([first.first, first.headline, first.added], [true, "History switched on", [".mdview/project.json"]]);
  assert.equal(first.body, "Device: Chrome on Linux (11111111-2222-3333-4444-555555555555)\nClient: web");
  await page.waitForFunction(() => window.MdView && document.body.dataset.folder != null, null, { timeout: 15000 });
});

test("a space is made only from the app's own pages, and only with a name", async () => {
  const ask = (body, origin = base) => fetch(base + "/api/new", { method: "POST", headers: { cookie, origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await ask({ space: "x" }, "https://elsewhere.example")).status, 403);
  assert.equal((await ask({ space: "  " })).status, 400);
  const made = gh.created.length;
  assert.deepEqual(await (await ask({ space: "日本" })).json(), { error: "invalid", name: "mdview" });
  assert.equal(gh.created.length, made, "nothing asked of GitHub");
});

test("nothing was refused or thrown along the way", () => {
  assert.deepEqual(problems.filter((p) => !/status of (403|404|409|422)/.test(p)), []);
});
