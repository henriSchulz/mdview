// Writing in the browser: what is typed is a draft at once and a commit after a while; what
// another device wrote meanwhile is joined in, and what both changed in the same place is asked
// about. The built app, a real Chromium, a GitHub of the test's own.
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
let app, base, browser, context, page, cookie;
const problems = [];
const MARKER = ".mdview/project.json";
const text = (p) => gh.repo.files.get(p)?.toString();
const put = (p, t) => gh.repo.files.set(p, Buffer.from(t));

before(async () => {
  put("Alpha.md", "# Alpha\n\nfirst paragraph\n\n- [ ] a task\n\nlast paragraph\n");
  put("Beta.md", "# Beta\n\ntext\n");
  put(MARKER, '{"id":"x","version":1}\n');
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
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: cookie.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.addInitScript(() => { if (!localStorage.getItem("mdview:prefs")) localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 1 })); }); // (a commit a second after the last change)
  page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("dialog", (d) => d.accept());
  if (process.env.DEBUG_WEB) { page.on("console", (m) => console.log("  [page]", m.text())); page.on("response", (r) => { if (/\/api\//.test(r.url())) console.log("  [api]", r.status(), r.url().replace(base, "")); }); }
});

after(async () => { await browser?.close(); app?.kill(); gh.close(); });

const untilNote = (name) => page.waitForFunction((n) => window.MdView && MdView.core.current && MdView.core.current.name === n && document.querySelector("#content").innerText.length > 0, name, { timeout: 15000 });
const post = (m) => page.evaluate((m) => MdHost.post(JSON.stringify(m)), m);
const until = async (f, what, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`not within ${ms} ms: ${what}`); };
const raw = () => page.evaluate(() => MdView.core.current.raw);
const open = async (note) => {
  if (page.url().startsWith(base)) await page.evaluate(() => localStorage.setItem("mdview:mode", '"read"')); // (whatever mode the test before left: a note opens in the one used last)
  await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent(note)}`);
  await untilNote(note);
};

test("typed in the active mode: a draft at once, a commit a little later, by this browser", async () => {
  await open("Alpha.md");
  assert.equal(await page.evaluate(() => MdView.core.current.readonly), null);
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForFunction(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, null, { timeout: 15000 });
  await page.click("#active p");
  await page.keyboard.press("End");
  await page.keyboard.type(", typed here");
  await until(() => /first paragraph, typed here/.test(text("Alpha.md")), "the commit");
  const made = gh.commits.at(-1);
  assert.equal(made.headline, "Alpha.md");
  assert.match(made.body, /^Device: Chrome on \w+ \([0-9a-f-]{36}\)\nClient: web$/);
  assert.deepEqual([made.added, made.deleted], [["Alpha.md"], []]);
  assert.equal(text("Alpha.md"), "# Alpha\n\nfirst paragraph, typed here\n\n- [ ] a task\n\nlast paragraph\n"); // (nothing else of the note touched)
  assert.equal(gh.commits.length, 1);
});

test("what is written and no commit yet survives the tab", async () => {
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 30 })));
  await open("Beta.md");
  const before = gh.commits.length;
  await post({ type: "save", text: "# Beta\n\ntext, not kept yet\n" });
  await page.waitForTimeout(400);
  await page.reload(); // (leaving the page tries to keep it; whether that got through or not, nothing is lost)
  await untilNote("Beta.md");
  assert.match(await raw(), /not kept yet/);
  await page.keyboard.press("Control+s"); // (and Ctrl+S keeps it now, whatever the quiet while)
  await until(() => /not kept yet/.test(text("Beta.md")), "the commit after Ctrl+S");
  assert.ok(gh.commits.length <= before + 1);
  await page.evaluate(() => localStorage.setItem("mdview:prefs", JSON.stringify({ historyQuiet: 1 })));
});

test("a task ticked, a note made, renamed and deleted", async () => {
  await open("Alpha.md");
  await page.click("#content input.task[data-line]");
  await until(() => /- \[x\] a task/.test(text("Alpha.md")), "the ticked task");
  await post({ type: "newnote", name: "Brand new" });
  await untilNote("Brand new.md");
  await until(() => text("Brand new.md") !== undefined, "the new note");
  assert.match(text("Brand new.md"), /^# Brand new\n/);
  await post({ type: "rename", path: "/octo/notes/Brand new.md", name: "Renamed" });
  await until(() => text("Renamed.md") !== undefined && text("Brand new.md") === undefined, "the renaming");
  assert.deepEqual([gh.commits.at(-1).added, gh.commits.at(-1).deleted], [["Renamed.md"], ["Brand new.md"]]);
  assert.equal(await page.evaluate(() => MdView.core.current.name), "Renamed.md"); // (the note on screen stays, under its new name)
  await post({ type: "trash", path: "/octo/notes/Renamed.md" });
  await until(() => text("Renamed.md") === undefined, "the deleting");
  assert.deepEqual(gh.commits.at(-1).deleted, ["Renamed.md"]);
  assert.ok(await page.evaluate(() => ![...document.querySelectorAll(".sb-row[data-real]")].some((r) => /Renamed/.test(r.textContent))));
});

test("another device wrote elsewhere in the note meanwhile: both are in the commit", async () => {
  await open("Alpha.md");
  const here = await raw();
  put("Alpha.md", here.replace("last paragraph", "last paragraph, from the other device"));
  await post({ type: "save", text: here.replace("# Alpha", "# Alpha, renamed here") });
  await until(() => /Alpha, renamed here/.test(text("Alpha.md") || ""), "the joined commit");
  assert.match(text("Alpha.md"), /^# Alpha, renamed here\n[\s\S]*last paragraph, from the other device\n$/);
  await page.waitForFunction(() => /from the other device/.test(MdView.core.current.raw), null, { timeout: 8000 }); // (and on the page)
});

test("both changed the same line: nothing is written until it is said how", async () => {
  await open("Beta.md");
  const here = await raw(), before = gh.commits.length;
  put("Beta.md", here.replace("# Beta", "# Beta, as they have it"));
  await post({ type: "save", text: here.replace("# Beta", "# Beta, as I have it") });
  const clock = () => page.evaluate(() => { const b = document.querySelector('[data-act="historymenu"]'); return [b.classList.contains("warn"), b.title || b.dataset.tip || ""]; });
  await until(async () => (await clock())[0], "the clock turning red");
  assert.match((await clock())[1], /conflicts to resolve/);
  assert.equal(gh.commits.length, before);
  assert.match(text("Beta.md"), /as they have it/); // (theirs is untouched)
  assert.match(await page.evaluate(() => localStorage.getItem("mdview:octo/notes:drafts")), /as I have it/); // (and mine is kept, in this browser)
  await page.click('[data-act="historymenu"]');
  await page.click('#ctxmenu [data-cmd="history:conflicts"]');
  await page.waitForFunction(() => { const w = document.querySelector("#conflict"); return w && w.hasAttribute("data-open") && w.querySelector(".cf-place"); }, null, { timeout: 10000 });
  const sides = await page.evaluate(() => [...document.querySelectorAll("#conflict .cf-side .cf-lines")].map((s) => s.textContent.trim()));
  assert.deepEqual(sides, ["# Beta, as I have it", "# Beta, as they have it"]);
  assert.ok(await page.evaluate(() => document.querySelector("#conflict .cf-join").disabled));
  await page.screenshot({ path: join(web, ".next", "write-conflict.png") });
  await page.click('#conflict .cf-pick[data-pick="both"]');
  await page.click("#conflict .cf-join");
  await until(() => /as I have it\n# Beta, as they have it/.test(text("Beta.md") || ""), "the joined commit");
  await page.waitForFunction(() => !document.querySelector("#conflict").hasAttribute("data-open") && !document.querySelector('[data-act="historymenu"]').classList.contains("warn"), null, { timeout: 8000 });
  assert.equal(gh.commits.length, before + 1);
});

test("a repository that is no project is not written to until that is said", async () => {
  gh.repo.files.delete(MARKER);
  await open("Beta.md");
  assert.match(await page.evaluate(() => MdView.core.current.readonly), /history on first/);
  const before = gh.commits.length, was = text("Beta.md");
  await post({ type: "save", text: "overwritten" });
  await post({ type: "newnote", name: "Nope" });
  await page.waitForTimeout(1600);
  assert.deepEqual([gh.commits.length, text("Beta.md"), text("Nope.md")], [before, was, undefined]);
  // the clock offers to use the repository; said yes (the browser's question), the marker is a commit
  await page.click('[data-act="historymenu"]');
  await page.click('#ctxmenu .menu-item:not([hidden])[data-cmd="history:on"]');
  await until(() => text(MARKER) !== undefined, "the marker");
  assert.equal(gh.commits.at(-1).headline, "project.json");
  assert.equal(JSON.parse(text(MARKER)).version, 1);
  await page.waitForFunction(() => MdView.core.current.readonly == null, null, { timeout: 8000 });
});

test("only the app's own pages can have a commit made, and only inside the repository", async () => {
  const send = (body, headers = {}) => fetch(`${base}/api/r/octo/notes/commit`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", cookie, origin: base, ...headers }, body: JSON.stringify(body) }).then((r) => r.status);
  const good = { branch: "main", expect: gh.head(), headline: "x", body: "", additions: [{ path: "x.md", text: "x" }], deletions: [] };
  const before = gh.commits.length;
  assert.equal(await send(good, { origin: "https://elsewhere.example" }), 403);
  assert.equal(await send(good, { origin: "" }), 403);
  assert.equal(await send(good, { cookie: "" }), 307); // (not signed in: to the sign-in page)
  for (const path of ["../x.md", "/etc/x", ".git/config", "a//b.md", "a/./b.md", ""]) assert.equal(await send({ ...good, additions: [{ path, text: "x" }] }), 400, path);
  assert.equal(await send({ ...good, deletions: ["a/../../x"] }), 400);
  assert.equal(await send({ ...good, expect: "0".repeat(40) }), 409); // (the branch stands elsewhere)
  assert.equal(gh.commits.length, before);
  assert.equal(await send(good), 200);
  assert.equal(text("x.md"), "x");
});

test("nothing was refused or thrown along the way", () => {
  assert.deepEqual(problems.filter((p) => !/Failed to load resource/i.test(p)), []);
});
