// A link opened at once — before the share's commit is on GitHub, or while the server is still
// looking for it — works as soon as the repository names it. Henri (2026-10-26): "the bug that
// share links do not work is still there" — a share made in the web app was taken back half a
// minute later. The server as it runs: what it looked up is kept as long as it keeps it there
// (SHARE_KEEP_MS not set); only its pause between two looks through every repository is short.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const gh = fakeGitHub();
const LOOK = 300; // (ms between two looks through every repository; the server's own: 5 s)
let app, base;
const list = {};
const shares = () => gh.repo.files.set(".mdview/shares.json", Buffer.from(JSON.stringify({ version: 1, shares: list }, null, 2) + "\n"));
const share = (id) => { list[id] = { path: "Note.md", created: "2026-10-26T08:52:15Z", password: null }; shares(); }; // (the commit is on GitHub)
const get = (path) => fetch(base + path, { redirect: "manual" });
const free = async () => (await (await get("/share/free")).json()).id;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  gh.appKey = publicKey;
  gh.repo.files.set("Note.md", Buffer.from("# Note\n\nshared\n"));
  gh.repo.files.set(".mdview/project.json", Buffer.from('{"id":"x","version":1}\n'));
  shares();
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base, SHARE_LOOK_MS: String(LOOK),
    GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).replace(/\n/g, "\\n") };
  delete env.SHARE_KEEP_MS;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, stdio: "pipe", env });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) break; } catch { /* not up yet */ }
    await wait(100);
  }
});
after(() => { app?.kill(); gh.close(); });

test("a link opened before its commit is on GitHub works once it is, though the server was not told", async () => {
  const id = await free(); // (the window shows the link at once: the commit follows)
  assert.equal((await get(`/${id}/raw`)).status, 404); // (opened at once: not in the repository yet)
  share(id); // (the commit is on GitHub; the server is not told — the browser's word to it was lost)
  await wait(LOOK + 100);
  assert.equal((await get(`/${id}/raw`)).status, 200, "a link handed out for a share is looked for again, not given up on for a minute");
});

test("a look through every repository that began before the share was made does not take it away again", async () => {
  await wait(LOOK + 100);
  const id = await free();
  // opened at once: the server looks through every repository — and its answer for this one is on its way while the commit lands
  const held = new Promise((r) => { gh.readHeld = r; });
  let release;
  gh.holdRead = new Promise((r) => { release = r; });
  const early = get(`/${id}/raw`);
  await held;
  gh.readHeld = null;
  share(id);
  // … and the one who shared tells the server (as the browser and the desktop app do): it reads the list and has the link
  const told = await fetch(`${base}/share/sync/octo/notes`, { method: "POST" });
  assert.equal(told.status, 200);
  release();
  assert.equal((await early).status, 200); // (that one waited for the look: by its end the server had the link)
  assert.equal((await get(`/${id}/raw`)).status, 200, "what the older look did not see yet is not taken out of what the server knows");
  assert.equal(await (await get(`/${id}/raw`)).text(), "# Note\n\nshared\n");
});
