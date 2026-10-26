// Feedback: a bug or a feature sent by anyone, signed in or not, checked and kept by the server
// (lib/feedback.ts) — and the inbox, which is Henri's alone; each also an issue the app opens. The
// built app, a GitHub of the test's own (whose /user is Henri or someone else, as `gh.user` says,
// and which knows the app as itself), Chromium for the form.
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const browserPath = process.env.CHROMIUM || ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome"].map((n) => { try { return execSync(`command -v ${n}`, { encoding: "utf8" }).trim(); } catch { return ""; } }).find(Boolean);
const gh = fakeGitHub();
const HENRI = { login: "henriSchulz", name: "Henri", id: 4242 }, OCTO = { login: "octo", name: "Octo Cat", id: 42 };
let app, base, henri, octo;

/** Signed in as whoever GitHub says: → the session's cookie. */
async function signIn(who) {
  gh.user = who;
  const sent = await fetch(base + "/auth/login", { redirect: "manual" });
  const to = new URL(sent.headers.get("location")), pending = sent.headers.getSetCookie()[0].split(";")[0];
  gh.challenge = to.searchParams.get("code_challenge");
  const back = await fetch(`${base}/auth/callback?code=the-code&state=${to.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: pending } });
  return back.headers.getSetCookie().find((c) => c.startsWith("mdview=")).split(";")[0];
}
const good = (more = {}) => ({ kind: "bug", title: "Tables lose their width", body: "Open a note with a wide table; it is cut off at the right.", platform: "Web", version: "Firefox 140 on Linux", email: "", website: "", ...more });
let n = 0;
/** Sent from an address of its own (each test one, so that the counts per hour stay apart) unless named. */
const send = (data, { from = `10.1.0.${++n}`, cookie = "" } = {}) => fetch(base + "/feedback/send", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": from, ...(cookie ? { cookie } : {}) }, body: typeof data === "string" ? data : JSON.stringify(data) });
const inbox = (cookie) => fetch(base + "/feedback/inbox", { redirect: "manual", headers: cookie ? { cookie } : {} });

before(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  gh.appKey = publicKey;
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-tests-own-0123456789", STORE: "memory", FEEDBACK_OWNER_ID: String(HENRI.id), FEEDBACK_PER_HOUR: "3", FEEDBACK_REPO: "octo/notes",
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).replace(/\n/g, "\\n") }, stdio: "pipe" });
  let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    if (i > 150) throw new Error("the app did not start:\n" + log);
    await new Promise((r) => setTimeout(r, 100));
  }
  henri = await signIn(HENRI);
  octo = await signIn(OCTO);
});
after(() => { app?.kill(); gh.close(); });

test("the form is there without signing in; /bug and /feature come to it with their kind chosen", async () => {
  const page = await fetch(base + "/feedback", { redirect: "manual" });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Send Feedback/);
  assert.match(html, /No sign-in needed/);
  assert.match(html, /aria-checked="true"[^>]*>Bug</);
  for (const kind of ["bug", "feature"]) {
    const go = await fetch(`${base}/${kind}`, { redirect: "manual" });
    assert.ok([307, 308].includes(go.status), `/${kind}: ${go.status}`);
    assert.equal(new URL(go.headers.get("location"), base).pathname + new URL(go.headers.get("location"), base).search, `/feedback?kind=${kind}`);
  }
  assert.match(await (await fetch(base + "/feedback?kind=feature")).text(), /aria-checked="true"[^>]*>Feature</);
  assert.match(await (await fetch(base + "/feedback", { headers: { cookie: octo } })).text(), /Sent as @octo/);
});

test("what is sent is checked on the server, field by field", async () => {
  const wrong = async (data, field) => { const res = await send(data); assert.equal(res.status, 400, JSON.stringify(data).slice(0, 80)); if (field) assert.equal((await res.json()).field, field); };
  await wrong("not json");
  await wrong("[1]");
  await wrong(good({ kind: "praise" }), "kind");
  await wrong(good({ kind: undefined }), "kind");
  await wrong(good({ title: "  x " }), "title");
  await wrong(good({ title: "t".repeat(121) }), "title");
  await wrong(good({ body: "short" }), "body");
  await wrong(good({ body: "b".repeat(8001) }), "body");
  await wrong(good({ body: 12345678901 }), "body");
  await wrong(good({ email: "not an address" }), "email");
  await wrong(good({ email: `${"a".repeat(200)}@x.org` }), "email");
  await wrong(good({ platform: "Amiga" }), "platform");
  await wrong(good({ version: "v".repeat(121) }), "version");
  assert.equal((await send("x".repeat(20_001))).status, 413);
  assert.equal((await send(good({ title: "Checked and kept", email: "me@example.org", platform: "" }))).status, 200);
});

test("the field nobody sees, filled in: thanks all the same, and nothing is kept", async () => {
  const res = await send(good({ title: "Cheap watches here", website: "https://spam.example" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.doesNotMatch(await (await inbox(henri)).text(), /Cheap watches/);
});

test("a few an hour from one address, then no more — another address still may", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await send(good({ title: `Counted ${i}` }), { from: "10.9.9.9" })).status, 200);
  const over = await send(good({ title: "One too many" }), { from: "10.9.9.9" });
  assert.equal(over.status, 429);
  assert.match((await over.json()).error, /hour/);
  assert.equal((await send(good({ title: "From elsewhere" }), { from: "10.9.9.10" })).status, 200);
  assert.doesNotMatch(await (await inbox(henri)).text(), /One too many/);
});

test("the inbox is Henri's: anyone else finds nothing there — signed in or not, and not by its routes", async () => {
  await send(good({ title: "Signed in, it says who", kind: "feature" }), { cookie: octo });
  await send(good({ title: "<script>alert(1)</script> **bold**", body: "<img src=x onerror=alert(1)> and *markdown*" }));
  const nobody = await inbox("");
  assert.equal(nobody.status, 404); // (not sent to the sign-in page: there is nothing to sign in for)
  assert.equal((await inbox(octo)).status, 404);
  const mine = await inbox(henri);
  assert.equal(mine.status, 200);
  const html = await mine.text();
  assert.match(html, /Signed in, it says who/);
  assert.match(html, /@octo/);
  assert.match(html, /not signed in/);
  assert.ok(html.indexOf("&lt;script&gt;alert(1)&lt;/script&gt; **bold**") >= 0, "the title shown as text");
  assert.doesNotMatch(html, /<script>alert/);
  // newest first
  assert.ok(html.indexOf("&lt;script&gt;") < html.indexOf("Signed in, it says who") && html.indexOf("Signed in, it says who") < html.indexOf("From elsewhere"));
  const id = /\\"id\\":\\"([a-z0-9]+-[A-Za-z0-9_-]+)\\",\\"kind\\":\\"feature\\",\\"title\\":\\"Signed in, it says who/.exec(html)?.[1];
  assert.ok(id, "the row's id in the page's data");
  const item = (cookie, method, body) => fetch(`${base}/feedback/items/${id}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) });
  assert.equal((await item("", "PATCH", { status: "done" })).status, 404);
  assert.equal((await item(octo, "PATCH", { status: "done" })).status, 404);
  assert.equal((await item(octo, "DELETE")).status, 404);
  assert.equal((await item(henri, "PATCH", { status: "nonsense" })).status, 400);
  assert.equal((await item(henri, "PATCH", { status: "done" })).status, 200);
  assert.match(await (await inbox(henri)).text(), /\\"status\\":\\"done\\"/);
  assert.equal((await item(henri, "DELETE")).status, 200);
  assert.doesNotMatch(await (await inbox(henri)).text(), /Signed in, it says who/);
});

/** The issue opened for the sending whose title is this, once it is there. */
async function issued(title) {
  for (let i = 0; i < 100; i++) { const it = gh.issues.find((x) => x.title === title); if (it) return [it, gh.issues.indexOf(it) + 1]; await new Promise((r) => setTimeout(r, 50)); }
  return [null, 0];
}

test("each one is also an issue the app opens — with nothing of who sent it, the description shown as text", async () => {
  const body = "Steps:\n```js\nx()\n```\n@someone ![x](https://tracker.example/p.png) <img src=x>";
  const res = await send(good({ title: "Kept and filed", body, email: "me@example.org", version: "Firefox 140 @octo" }), { cookie: octo });
  assert.equal(res.status, 200);
  const [issue, number] = await issued("Kept and filed");
  assert.ok(issue, "an issue was opened");
  assert.ok(gh.appTokens.has(issue.by), "as the app");
  assert.deepEqual(gh.appAsked.at(-1), { repositories: ["notes"], permissions: { issues: "write" } }, "a token for this repository's issues, and only for them");
  assert.deepEqual(issue.labels, ["bug", "feedback"]);
  assert.ok(issue.body.includes("````text\n" + body + "\n````"), "the description in a fence longer than any in it");
  assert.match(issue.body, /^Bug · Web · Firefox 140 \\@octo/);
  for (const not of ["me@example.org", "Mozilla", "node", "@octo"]) assert.ok(!issue.body.replace("\\@octo", "").includes(not), `not in the issue: ${not}`);
  const html = await (await inbox(henri)).text();
  assert.ok(html.includes(`https://github.com/octo/notes/issues/${number}`), "the inbox links to it");
});

test("GitHub not letting the app open the issue: kept all the same, the sender told nothing of it", async () => {
  gh.issuesRefused = true;
  try {
    assert.equal((await send(good({ title: "Kept without an issue" }))).status, 200);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(gh.issues.find((x) => x.title === "Kept without an issue"), undefined);
    assert.match(await (await inbox(henri)).text(), /Kept without an issue/);
  } finally { gh.issuesRefused = false; }
});

test("in a browser: the platform filled in, the form sent, thanks", { skip: !browserPath && "no Chromium" }, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.2.0.1" } })).newPage();
    await page.goto(base + "/feature");
    await page.waitForFunction(() => document.querySelector("select[name=platform]")?.value === "Web");
    assert.equal(await page.getAttribute('button[role=radio]:has-text("Feature")', "aria-checked"), "true");
    assert.match(await page.inputValue("input[name=version]"), /Chrome/);
    await page.click('button[role=radio]:has-text("Bug")');
    assert.match(await page.getAttribute("textarea[name=body]", "placeholder"), /Steps to reproduce/);
    await page.click("button[type=submit]");
    await page.waitForSelector(".fb-wrong");
    assert.match(await page.textContent(".fb-wrong"), /title/);
    await page.fill("input[name=title]", "Sent from the browser");
    await page.fill("textarea[name=body]", "Steps:\n1. open\n2. see");
    await page.click("button[type=submit]");
    await page.waitForSelector("text=Thank you");
    assert.match(await page.textContent(".fb-done"), /bug report has arrived/);
  } finally {
    await browser.close();
  }
  assert.match(await (await inbox(henri)).text(), /Sent from the browser/);
});
