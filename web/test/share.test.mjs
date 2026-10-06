// A note that was shared: read by whoever has its link, without signing in — with a password
// where one was set — and nothing else of the repository with it. The built app, a GitHub of the
// test's own that knows the app as itself, and a real Chromium for the page.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { generateKeyPairSync, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), ".."), fixtures = join(web, "..", "dev", "tests", "tauri-check");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
let app, base, browser;
const OPEN = "aaaaaaaaaaaaaaaaaaaaaa", LOCKED = "bbbbbbbbbbbbbbbbbbbbbb", GONE = "cccccccccccccccccccccc";
const hashed = (password, iterations = 1000) => { const salt = randomBytes(16); return { salt: salt.toString("base64"), hash: pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64"), iterations }; };
const shares = (all) => gh.repo.files.set(".mdview/shares.json", Buffer.from(JSON.stringify({ version: 1, shares: all }, null, 2) + "\n"));
const both = () => ({ [OPEN]: { path: "docs/Shown.md", created: "2026-10-06T10:00:00Z", password: null }, [LOCKED]: { path: "Private.md", created: "2026-10-06T10:00:00Z", password: hashed("sesame") } });
const get = (path, headers = {}) => fetch(base + path, { redirect: "manual", headers });

before(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  gh.appKey = publicKey;
  const put = (p, t) => gh.repo.files.set(p, Buffer.from(t));
  put("docs/Shown.md", "# Shown\n\nA picture: ![one](img/pic.png)\n\n![[Inside]]\n\nSee [[Secret]] and [the other](../Private.md), and [[paper.pdf#page=1|a paper]].\n\n<script>window.__ran = 1</script>\n");
  put("docs/Inside.md", "Embedded text, with ![its own](img/inner.png).\n");
  put("docs/Secret.md", "# Secret\n\nnot for anyone\n");
  put("Private.md", "# Private\n\nbehind a password\n");
  for (const p of ["docs/img/pic.png", "docs/img/inner.png", "docs/img/unused.png"]) gh.repo.files.set(p, readFileSync(join(fixtures, "bild.png")));
  gh.repo.files.set("paper.pdf", readFileSync(join(fixtures, "paper.pdf")));
  put(".mdview/project.json", '{"id":"x","version":1}\n');
  shares(both());
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, stdio: "pipe", env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base, SHARE_KEEP_MS: "0", SHARE_LOOK_MS: "0",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).replace(/\n/g, "\\n") } }); // (as GitHub hands the key out, kept on one line as a secret is)
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(async () => { await browser?.close(); app?.kill(); gh.close(); });

test("a link shows its note to anyone, and the app asked GitHub only to read that repository", async () => {
  const res = await get(`/s/octo/notes/${OPEN}`);
  assert.equal(res.status, 200); // (not sent to sign in)
  const html = await res.text();
  assert.match(html, /\/host\/share\.js/);
  assert.ok(!/host\/host\.js/.test(html));
  assert.equal(res.headers.get("referrer-policy"), "no-referrer"); // (the link is the secret: not told to where a link in the note leads)
  assert.match(res.headers.get("x-robots-tag"), /noindex/);
  const data = await (await get(`/s/octo/notes/${OPEN}/data`)).json();
  assert.equal(data.path, "/octo/notes/docs/Shown.md");
  assert.match(data.text, /^# Shown/);
  assert.equal(data.links.Inside.text, "Embedded text, with ![its own](img/inner.png).\n");
  assert.deepEqual([data.links.Inside.shared, data.links.Secret.shared, data.links.Secret.text], [true, false, undefined]); // (a link is told, what it leads to is not)
  assert.deepEqual(gh.appAsked.at(-1), { repositories: ["notes"], permissions: { contents: "read" } });
});

test("with the note go the files it shows, and no other file of the repository", async () => {
  const file = (p) => get(`/s/octo/notes/${OPEN}/file/${p}`).then((r) => r.status);
  assert.deepEqual(await Promise.all(["docs/img/pic.png", "docs/img/inner.png", "docs/Inside.md", "docs/Shown.md"].map(file)), [200, 200, 200, 200]);
  for (const p of ["docs/Secret.md", "Private.md", "docs/img/unused.png", "paper.pdf", ".mdview/shares.json", ".mdview/project.json", "docs/img/../Secret.md", "docs/img/%2e%2e/Secret.md", "nothing.md"]) assert.equal(await file(p), 404, p);
  const pic = await get(`/s/octo/notes/${OPEN}/file/docs/img/pic.png`);
  assert.match(pic.headers.get("content-security-policy"), /^sandbox/);
  // the app's own routes stay behind signing in
  assert.equal((await get("/api/r/octo/notes/state")).status, 307);
  assert.equal((await get("/file/octo/notes/docs/Secret.md")).status, 307);
});

test("a link that is not one, or not any more, shows nothing", async () => {
  for (const id of [GONE, "short", `${OPEN}!`]) assert.equal((await get(`/s/octo/notes/${id}`)).status, 404, id);
  assert.equal((await get(`/s/octo/other/${OPEN}`)).status, 404);
  assert.equal((await get(`/s/octo/notes/${GONE}/data`)).status, 404);
  const all = both();
  delete all[OPEN];
  shares(all); // (taken out of the file: the link has ended)
  assert.equal((await get(`/s/octo/notes/${OPEN}`)).status, 404);
  assert.equal((await get(`/s/octo/notes/${OPEN}/file/docs/img/pic.png`)).status, 404);
  shares({ ...both(), [OPEN]: { path: "docs/Not there.md", password: null } }); // (the note itself is gone)
  assert.equal((await get(`/s/octo/notes/${OPEN}`)).status, 404);
  gh.installed = false; // (the app was taken off the repository)
  shares(both());
  assert.equal((await get(`/s/octo/notes/${OPEN}`)).status, 200); // (the token it had still holds, as GitHub has it)
  gh.installed = true;
});

test("a password: asked for first, wrong ones refused, the right one opens — for this link only", async () => {
  const at = `/s/octo/notes/${LOCKED}`;
  const asked = await get(at);
  assert.equal(asked.status, 200);
  const form = await asked.text();
  assert.match(form, /type='password'/);
  assert.ok(!/behind a password|share\.js/.test(form)); // (nothing of the note yet)
  assert.equal((await get(at + "/data")).status, 401);
  assert.equal((await get(at + "/file/Private.md")).status, 401);
  const give = (password) => fetch(base + at, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) });
  const no = await give("open sesame");
  assert.equal(no.status, 401);
  assert.match(await no.text(), /not the password/);
  assert.equal(no.headers.get("set-cookie"), null);
  const yes = await give("sesame");
  assert.equal(yes.status, 303);
  const cookie = yes.headers.getSetCookie()[0];
  assert.match(cookie, new RegExp(`^mdshare-${LOCKED.slice(0, 16)}=[\\w-]+; Path=/s; Max-Age=\\d+; HttpOnly; SameSite=Lax`));
  const carried = { cookie: cookie.split(";")[0] };
  assert.match((await (await get(at + "/data", carried)).json()).text, /behind a password/);
  assert.equal((await get(at + "/file/Private.md", carried)).status, 200);
  assert.equal((await get(at + "/file/docs/Secret.md", carried)).status, 404);
  // a cookie made up, or one for a password that is another by now, opens nothing
  assert.equal((await get(at + "/data", { cookie: `mdshare-${LOCKED.slice(0, 16)}=guessed` })).status, 401);
  shares({ ...both(), [LOCKED]: { path: "Private.md", password: hashed("another") } });
  assert.equal((await get(at + "/data", carried)).status, 401);
  // a password that cannot be read keeps the note closed, not open
  shares({ ...both(), [LOCKED]: { path: "Private.md", password: { hash: "x" } } });
  assert.equal((await get(at)).status, 404);
});

test("the link that is handed out is short: the id alone, the repository looked up", async () => {
  shares(both());
  const res = await get(`/s/${OPEN}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /\/host\/share\.js/);
  assert.match(html, new RegExp(`"owner":"octo","repo":"notes","share":"${OPEN}"`));
  assert.equal((await get(`/s/${GONE}`)).status, 404); // (an id no repository knows)
  assert.equal((await get("/s/short")).status, 404);
  // with a password: asked for at the short address, and good for the note's data and files then
  assert.match(await (await get(`/s/${LOCKED}`)).text(), new RegExp(`action='/s/${LOCKED}'`));
  const yes = await fetch(`${base}/s/${LOCKED}`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password: "sesame" }) });
  assert.deepEqual([yes.status, yes.headers.get("location")], [303, `${base}/s/${LOCKED}`]);
  const carried = { cookie: yes.headers.getSetCookie()[0].split(";")[0] };
  assert.match(await (await get(`/s/${LOCKED}`, carried)).text(), /\/host\/share\.js/);
  assert.equal((await get(`/s/octo/notes/${LOCKED}/data`, carried)).status, 200);
});

test("an id for a new link is as short as there is room for, and not handed out twice", async () => {
  shares(both());
  const free = async () => (await (await get("/share/free")).json()).id; // (asked without signing in: the desktop app does)
  const some = [];
  for (let i = 0; i < 20; i++) some.push(await free());
  assert.ok(some.every((id) => /^[A-Za-z0-9]$/.test(id)), String(some)); // (one letter or digit while few notes are shared)
  assert.equal(new Set(some).size, 20);
  // thirty notes shared and more: two
  const many = both();
  for (let i = 0; i < 12; i++) many["id" + i] = { path: "docs/Shown.md", password: null };
  shares(many);
  const longer = [await free(), await free()];
  assert.ok(longer.every((id) => /^[A-Za-z0-9]{2}$/.test(id) && !some.includes(id)), String(longer));
});

test("guessing is slowed: after a few wrong passwords none is looked at for a while", async () => {
  shares({ ...both(), [LOCKED]: { path: "Private.md", password: hashed("sesame") } });
  const at = `/s/octo/notes/${LOCKED}`;
  const give = (password) => fetch(base + at, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }) });
  for (let i = 0; i < 5; i++) assert.equal((await give("wrong " + i)).status, 401);
  const held = await give("sesame"); // (the right one too, for now)
  assert.equal(held.status, 401);
  assert.match(await held.text(), /Too many wrong passwords/);
});

test("in a browser: the note with its picture and what it embeds, read only, and what it links to stays shut", async () => {
  shares(both());
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage(), problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto(`${base}/s/octo/notes/${OPEN}`);
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name === "Shown.md" && document.querySelector("#content").innerText.length > 0, null, { timeout: 15000 });
  await page.waitForFunction(() => { const i = document.querySelector('#content img[src$="pic.png"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await page.waitForFunction(() => /Embedded text/.test(document.querySelector("#content").innerText), null, { timeout: 10000 });
  await page.waitForFunction(() => { const i = document.querySelector('#content img[src$="inner.png"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }); // (the embedded note's own picture)
  const seen = await page.evaluate(() => ({ readonly: MdView.core.current.readonly, ran: window.__ran, title: document.title, sidebar: document.body.dataset.sidebar || "", stored: Object.keys(localStorage).filter((k) => /drafts|tabs/.test(k)) }));
  assert.deepEqual([seen.readonly, seen.ran, seen.stored], ["a shared note", undefined, []]);
  assert.notEqual(seen.sidebar, "open"); // (no repository to look about in)
  // nothing but reading: no modes to switch between, by button or by key
  const vis = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; }, sel);
  assert.deepEqual([await vis("#toolbar .seg"), await vis('#toolbar [data-act="panel"]'), await vis('#toolbar [data-act="share"]'), await vis('#toolbar [data-act="find"]')], [false, false, false, true]);
  await page.keyboard.press("Control+e");
  await page.keyboard.press("Control+Alt+2");
  await page.evaluate(() => MdView.setMode("active"));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.body.dataset.view || "read"), "read");
  // a link to a note that was not shared: said, and nothing fetched
  const asked = [];
  page.on("request", (r) => asked.push(new URL(r.url()).pathname));
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "wikilink", target: "Secret" })));
  await page.waitForFunction(() => /not shared with the note/.test(document.body.innerText), null, { timeout: 8000 });
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "save", text: "overwritten" })));
  await page.waitForTimeout(500);
  assert.deepEqual(asked.filter((p) => /Secret|commit/.test(p)), []);
  assert.match(gh.repo.files.get("docs/Shown.md").toString(), /^# Shown/);
  await page.screenshot({ path: join(web, ".next", "share.png") });
  assert.deepEqual(problems.filter((p) => !/Content Security Policy|Refused to (execute|load)|Failed to load resource/i.test(p)), []);
});

test("shared from the app: the window makes the link, sets and takes away a password, and ends it — each a commit", async () => {
  gh.repo.files.delete(".mdview/shares.json");
  // signed in, as the one whose repository it is
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  const cookie = back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "mdview", value: cookie.slice("mdview=".length), url: base, httpOnly: true, sameSite: "Lax" }]);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage(), problems = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(String(e)));
  await page.goto(`${base}/r/octo/notes?n=${encodeURIComponent("docs/Shown.md")}`);
  await page.waitForFunction(() => window.MdView && MdView.core.current && MdView.core.current.name === "Shown.md" && document.querySelector("#content").innerText.length > 0, null, { timeout: 15000 });
  const listed = () => JSON.parse(gh.repo.files.get(".mdview/shares.json")?.toString() || '{"shares":{}}').shares;
  const until = async (f, what, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`not within ${ms} ms: ${what}`); };
  const shown = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!e && !e.hidden && e.offsetParent !== null; }, sel);

  // the button at the top, between the magnifier and the modes — not shared yet
  await page.click('#toolbar [data-act="share"]');
  await page.waitForFunction(() => { const r = document.querySelector("#share"); return r && r.hasAttribute("data-open") && !r.querySelector(".share-box").hasAttribute("aria-busy"); }, null, { timeout: 15000 });
  assert.equal(await page.textContent("#share-title"), "Share “Shown”");
  assert.deepEqual([await shown("#share .btn.primary"), await shown("#share .share-link"), await shown("#share .share-more"), await page.getAttribute("#share .share-more", "aria-expanded")], [true, false, true, "false"]); // (the password: folded away)
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(web, ".next", "share-window-new.png") });
  const before = gh.commits.length;
  await page.click("#share .btn.primary");
  await until(() => Object.keys(listed()).length === 1, "the share, as a commit");
  const [id, entry] = Object.entries(listed())[0];
  assert.match(id, /^[A-Za-z0-9]$/); // (one letter or digit: few notes are shared)
  assert.deepEqual([entry.path, entry.password, gh.commits.length, gh.commits.at(-1).added], ["docs/Shown.md", null, before + 1, [".mdview/shares.json"]]);
  await page.waitForFunction(() => { const b = document.querySelector(".share-box"); return !b.hasAttribute("aria-busy") && document.querySelector("#share .share-link").value.includes("/s/"); }, null, { timeout: 8000 });
  const link = await page.inputValue("#share .share-link");
  assert.equal(link, `${base}/s/${id}`); // (short: the id alone)
  assert.match(await (await fetch(link)).text(), /\/host\/share\.js/); // (read by someone who is not signed in)
  const long = `${base}/s/octo/notes/${id}`; // (where the note's data and files stand)
  assert.match((await (await fetch(long + "/data")).json()).text, /^# Shown/);
  await page.click("#share .share-copy");
  await until(async () => (await page.evaluate(() => navigator.clipboard.readText())) === link, "the link on the clipboard");
  // what is shared is marked: its row in the sidebar, and the button while it is shown
  const marked = () => page.evaluate(() => [[...document.querySelectorAll(".sb-row[data-real]")].filter((r) => r.querySelector(".sb-shared")).map((r) => r.dataset.real), document.querySelector('#toolbar [data-act="share"]').classList.contains("active")]);
  assert.deepEqual(await marked(), [["/octo/notes/docs/Shown.md"], true]);

  // a password: of it only what it hashes to is in the repository
  assert.equal(await page.evaluate(() => document.querySelector(".share-fold-in").inert), true); // (not to be typed in until unfolded)
  await page.click("#share .share-more");
  await page.waitForFunction(() => document.activeElement === document.querySelector('#share input[type="password"]'), null, { timeout: 8000 });
  await page.fill('#share input[type="password"]', "sesame");
  await page.keyboard.press("Enter");
  await until(() => !!listed()[id].password, "the password, as a commit");
  assert.deepEqual([Object.keys(listed()[id].password).sort(), listed()[id].password.iterations], [["hash", "iterations", "salt"], 600000]);
  assert.ok(!/sesame/.test(gh.repo.files.get(".mdview/shares.json").toString()));
  assert.equal((await fetch(long + "/data")).status, 401);
  const given = await fetch(link, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password: "sesame" }) });
  assert.equal(given.status, 303);
  await page.waitForFunction(() => /and the password/.test(document.querySelector(".share-text").textContent), null, { timeout: 8000 });
  assert.deepEqual([await page.textContent("#share .share-value"), await page.getAttribute("#share .share-more", "aria-expanded")], ["Set", "false"]); // (set: folded again, and said in its row)
  await page.click("#share .share-more");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(web, ".next", "share-window-open.png") });
  await page.click("#share .share-drop"); // Remove Password
  await until(() => listed()[id].password === null, "the password taken away");
  assert.equal((await fetch(long + "/data")).status, 200);

  // the note renamed: its link goes on showing it
  await page.keyboard.press("Escape");
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "rename", path: "/octo/notes/docs/Shown.md", name: "Shown, later" })));
  await page.waitForFunction(() => MdView.core.current.name === "Shown, later.md", null, { timeout: 8000 });
  await page.evaluate(() => MdHost.post(JSON.stringify({ type: "history-now" }))); // (Ctrl+S: kept now, not after the quiet while)
  await until(() => listed()[id].path === "docs/Shown, later.md" && gh.repo.files.has("docs/Shown, later.md"), "the share following the note");
  assert.equal((await (await fetch(long + "/data")).json()).path, "/octo/notes/docs/Shown, later.md");

  // stopped: the link shows nothing
  await page.waitForFunction(() => MdView.core.current.name === "Shown, later.md", null, { timeout: 8000 });
  await page.click('#toolbar [data-act="share"]');
  await page.waitForFunction(() => { const r = document.querySelector("#share"); return r.hasAttribute("data-open") && !r.querySelector(".share-box").hasAttribute("aria-busy") && document.querySelector("#share .share-link").value.includes("/s/"); }, null, { timeout: 8000 });
  await page.waitForTimeout(700); // (settled, for the picture)
  await page.screenshot({ path: join(web, ".next", "share-window.png") });
  await page.click("#share .share-foot .pf-link.danger");
  await until(() => Object.keys(listed()).length === 0, "the share taken out");
  assert.deepEqual(await marked(), [[], false]);
  assert.equal((await fetch(link)).status, 404);
  assert.deepEqual(problems.filter((p) => !/Content Security Policy|Refused to (execute|load)|Failed to load resource/i.test(p)), []);
});
