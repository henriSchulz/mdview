// The download page (app/download, lib/download.ts): a release's files told apart by their names —
// the names of packaging/release-name.sh and Tauri's own, which v0.1.4 still has —, the visitor's
// system from their browser, and the page itself, for whoever comes, against a GitHub of the
// test's own that first cannot be reached and then has a release.
// Run: npm run build && npm test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort } from "./fake-github.mjs";
import { classify, releaseFrom, systemOf } from "../lib/download.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

const OLD = { // (what Tauri named the files of v0.1.4)
  "Markdown.Notes-0.1.4-1.aarch64.rpm": ["linux", "arm64", "rpm"],
  "Markdown.Notes-0.1.4-1.x86_64.rpm": ["linux", "x64", "rpm"],
  "Markdown.Notes_0.1.4_aarch64.AppImage": ["linux", "arm64", "appimage"],
  "Markdown.Notes_0.1.4_amd64.AppImage": ["linux", "x64", "appimage"],
  "Markdown.Notes_0.1.4_amd64.deb": ["linux", "x64", "deb"],
  "Markdown.Notes_0.1.4_arm64.deb": ["linux", "arm64", "deb"],
  "Markdown.Notes_0.1.4_x64-setup.exe": ["windows", "x64", "setup"],
};
const NEW = {
  "MarkdownNotes-0.2.0-linux-arm64.AppImage": ["linux", "arm64", "appimage"],
  "MarkdownNotes-0.2.0-linux-arm64.deb": ["linux", "arm64", "deb"],
  "MarkdownNotes-0.2.0-linux-arm64.rpm": ["linux", "arm64", "rpm"],
  "MarkdownNotes-0.2.0-linux-x64.AppImage": ["linux", "x64", "appimage"],
  "MarkdownNotes-0.2.0-linux-x64.deb": ["linux", "x64", "deb"],
  "MarkdownNotes-0.2.0-linux-x64.rpm": ["linux", "x64", "rpm"],
  "MarkdownNotes-0.2.0-windows-x64-setup.exe": ["windows", "x64", "setup"],
  "MarkdownNotes-0.2.0-macos-arm64.dmg": ["macos", "arm64", "dmg"],
};

test("a release's files are told apart by their names, old and new", () => {
  for (const [name, [system, arch, kind]] of Object.entries({ ...OLD, ...NEW })) assert.deepEqual(classify(name), { system, arch, kind }, name);
  for (const name of ["Markdown.Notes_0.1.4_amd64.AppImage.sig", "latest.json", "Source code.tar.gz", "MarkdownNotes-0.2.0-linux.deb"]) assert.equal(classify(name), null, name);
  const release = releaseFrom({ tag_name: "v0.1.4", published_at: "2026-10-16T11:42:15Z", html_url: "https://github.com/henriSchulz/mdview/releases/tag/v0.1.4",
    assets: [...Object.keys(OLD), "latest.json"].map((name) => ({ name, browser_download_url: `https://example.test/${name}`, size: 9e6 })) });
  assert.equal(release.version, "0.1.4");
  assert.equal(release.assets.length, 7);
  // (a release with updates: each AppImage and the Windows installer beside its signature, and latest.json — only the installers are offered)
  const sigs = ["MarkdownNotes-0.2.0-linux-x64.AppImage.sig", "MarkdownNotes-0.2.0-linux-arm64.AppImage.sig", "MarkdownNotes-0.2.0-windows-x64-setup.exe.sig"];
  for (const name of sigs) assert.equal(classify(name), null, name);
  const updating = releaseFrom({ tag_name: "v0.2.0", assets: [...Object.keys(NEW), ...sigs, "latest.json"].map((name) => ({ name, browser_download_url: `https://example.test/${name}` })) });
  assert.deepEqual(updating.assets.map((a) => a.name).sort(), Object.keys(NEW).sort());
});

test("the visitor's system is read from the browser", () => {
  const agents = {
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36": "windows",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36": "linux",
    "Mozilla/5.0 (X11; Ubuntu; Linux aarch64; rv:144.0) Gecko/20100101 Firefox/144.0": "linux",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15": "macos",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36": null,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1": null,
    "curl/8.10": null,
    "": null,
  };
  for (const [agent, system] of Object.entries(agents)) assert.equal(systemOf(agent), system, agent);
});

// ---- the page, from the built app

const gh = { up: false, asked: 0 };
const github = createServer((req, res) => {
  gh.asked++;
  if (!gh.up || req.url !== "/repos/henriSchulz/mdview/releases/latest") { res.writeHead(503); return res.end(); }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ tag_name: "v0.1.4", published_at: "2026-10-16T11:42:15Z", html_url: "https://github.com/henriSchulz/mdview/releases/tag/v0.1.4",
    assets: Object.keys(OLD).map((name) => ({ name, browser_download_url: `https://github.com/henriSchulz/mdview/releases/download/v0.1.4/${name}`, size: 9583528 })) }));
});
let app, base;
before(async () => {
  const at = await new Promise((r) => github.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${github.address().port}`)));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_API: at, GITHUB_WEB: at, SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the app did not start:\n" + log);
});
after(() => { app?.kill(); github.close(); });

const page = (path, agent = "") => fetch(base + path, { redirect: "manual", headers: { "user-agent": agent } }).then(async (r) => ({ status: r.status, to: r.headers.get("location"), text: await r.text() }));
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const order = (html) => [...html.matchAll(/data-system="(\w+)"/g)].map((m) => m[1]);

test("the page is there without signing in, and links to GitHub's releases while GitHub cannot be reached", async () => {
  const down = await page("/download", WIN);
  assert.equal(down.status, 200);
  assert.ok(gh.asked > 0);
  assert.match(down.text, /could not be read from GitHub/);
  assert.match(down.text, /href="https:\/\/github.com\/henriSchulz\/mdview\/releases\/latest"[^>]*>(<svg[^]*?<\/svg>)?Download for Windows/);
  const install = await page("/install");
  assert.equal(install.status, 307);
  assert.equal(new URL(install.to, base).pathname, "/download");
  assert.doesNotMatch((await page("/r/octo/notes")).to || "", /download/); // (the rest still asks for a sign-in)
});

test("the page offers the release's files, the visitor's system first, macOS not yet", async () => {
  gh.up = true; // (an answer that failed was not kept: this visit asks again)
  const win = await page("/download", WIN);
  assert.equal(win.status, 200);
  assert.match(win.text, /Version <!-- -->0\.1\.4|Version 0\.1\.4/);
  assert.match(win.text, /16 October 2026/);
  assert.deepEqual(order(win.text), ["windows", "linux", "macos"]);
  const file = (name) => `https://github.com/henriSchulz/mdview/releases/download/v0.1.4/${name}`;
  for (const name of Object.keys(OLD)) assert.ok(win.text.includes(`href="${file(name)}"`), name);
  assert.match(win.text, /not signed/);
  assert.match(win.text, /data-system="macos"[^]*Coming soon/);
  assert.doesNotMatch(win.text, /\.dmg"/);
  const linux = await page("/download", LINUX);
  assert.deepEqual(order(linux.text), ["linux", "windows", "macos"]);
  assert.match(linux.text, /Markdown Notes for <!-- -->Linux|Markdown Notes for Linux/);
});
