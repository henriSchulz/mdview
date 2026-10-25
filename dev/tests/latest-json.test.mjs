// What the app's updater reads (packaging/latest-json.mjs): latest.json written from the signatures a
// release has — fake ones here, in a folder of the test's own, as the job "latest.json" of
// .github/workflows/build.yml finds them.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latestJson } from "../../packaging/latest-json.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../packaging/latest-json.mjs");
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function folder(files) {
  const dir = mkdtempSync(join(tmpdir(), "latest-json-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}
const run = (tag, dir) => spawnSync("node", [script, tag, dir], { encoding: "utf8" });
const URL = "https://github.com/henriSchulz/mdview/releases/download/v0.1.5/";

test("every installer that updates itself, by the updater's name for its system — with its signature and where it is", () => {
  const dir = folder({
    "MarkdownNotes-0.1.5-linux-x64.AppImage.sig": "c2lnLXg2NA==\n",
    "MarkdownNotes-0.1.5-linux-arm64.AppImage.sig": "c2lnLWFybQ==\n",
    "MarkdownNotes-0.1.5-windows-x64-setup.exe.sig": "c2lnLXdpbg==",
    "MarkdownNotes-0.1.5-linux-x64.AppImage": "the installer itself: not read",
  });
  const out = run("v0.1.5", dir);
  assert.equal(out.status, 0, out.stderr);
  const json = JSON.parse(out.stdout);
  assert.equal(json.version, "0.1.5");
  assert.match(json.notes, /releases\/tag\/v0\.1\.5/);
  assert.match(json.pub_date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual(json.platforms, {
    "linux-aarch64": { signature: "c2lnLWFybQ==", url: URL + "MarkdownNotes-0.1.5-linux-arm64.AppImage" },
    "linux-x86_64": { signature: "c2lnLXg2NA==", url: URL + "MarkdownNotes-0.1.5-linux-x64.AppImage" },
    "windows-x86_64": { signature: "c2lnLXdpbg==", url: URL + "MarkdownNotes-0.1.5-windows-x64-setup.exe" },
  });
});

test("only what was released: the Windows installer held back is not offered, a .deb's signature never", () => {
  const json = latestJson("v0.1.5", {
    "MarkdownNotes-0.1.5-linux-x64.AppImage.sig": "a",
    "MarkdownNotes-0.1.5-linux-x64.deb.sig": "b",
    "MarkdownNotes-0.1.4-windows-x64-setup.exe.sig": "an older release's",
  }, new Date("2026-10-25T12:00:00.123Z"));
  assert.deepEqual(Object.keys(json.platforms), ["linux-x86_64"]);
  assert.equal(json.pub_date, "2026-10-25T12:00:00Z");
});

test("no signature at all: nothing is written, and it ends with 1", () => {
  const out = run("v0.1.5", folder({ "MarkdownNotes-0.1.5-linux-x64.deb": "x" }));
  assert.equal(out.status, 1);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /no signature/);
});
