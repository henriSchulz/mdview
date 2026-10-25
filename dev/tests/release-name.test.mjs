// The names of a release's files (packaging/release-name.sh): what Tauri called the installers of
// v0.1.4, and what they are called in a release from now on.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "../../packaging/release-name.sh");
const named = (file) => execFileSync("bash", [script, "0.1.4", file], { encoding: "utf8" }).trim();

test("every installer Tauri builds gets a name that sorts by system", () => {
  const tauri = {
    "Markdown.Notes-0.1.4-1.aarch64.rpm": "MarkdownNotes-0.1.4-linux-arm64.rpm",
    "Markdown.Notes-0.1.4-1.x86_64.rpm": "MarkdownNotes-0.1.4-linux-x64.rpm",
    "Markdown.Notes_0.1.4_aarch64.AppImage": "MarkdownNotes-0.1.4-linux-arm64.AppImage",
    "Markdown.Notes_0.1.4_amd64.AppImage": "MarkdownNotes-0.1.4-linux-x64.AppImage",
    "Markdown.Notes_0.1.4_amd64.deb": "MarkdownNotes-0.1.4-linux-x64.deb",
    "Markdown.Notes_0.1.4_arm64.deb": "MarkdownNotes-0.1.4-linux-arm64.deb",
    "Markdown.Notes_0.1.4_x64-setup.exe": "MarkdownNotes-0.1.4-windows-x64-setup.exe",
  };
  for (const [from, to] of Object.entries(tauri)) assert.equal(named(`src-tauri/target/release/bundle/x/${from}`), to, from);
  // sorted, they stand by system and then by architecture
  assert.deepEqual(Object.values(tauri).sort(), [
    "MarkdownNotes-0.1.4-linux-arm64.AppImage", "MarkdownNotes-0.1.4-linux-arm64.deb", "MarkdownNotes-0.1.4-linux-arm64.rpm",
    "MarkdownNotes-0.1.4-linux-x64.AppImage", "MarkdownNotes-0.1.4-linux-x64.deb", "MarkdownNotes-0.1.4-linux-x64.rpm",
    "MarkdownNotes-0.1.4-windows-x64-setup.exe",
  ]);
  assert.equal(named("Markdown.Notes_0.1.4_aarch64.dmg"), "MarkdownNotes-0.1.4-macos-arm64.dmg"); // (macOS, one day)
});

test("an installer's signature (for the app's updates) is named after its installer", () => {
  assert.equal(named("src-tauri/target/release/bundle/appimage/Markdown.Notes_0.1.4_amd64.AppImage.sig"), "MarkdownNotes-0.1.4-linux-x64.AppImage.sig");
  assert.equal(named("Markdown.Notes_0.1.4_aarch64.AppImage.sig"), "MarkdownNotes-0.1.4-linux-arm64.AppImage.sig");
  assert.equal(named("installer/nsis/Markdown.Notes_0.1.4_x64-setup.exe.sig"), "MarkdownNotes-0.1.4-windows-x64-setup.exe.sig");
});

test("a file that is no installer, or names no architecture, is refused", () => {
  for (const file of ["Markdown.Notes_0.1.4_amd64.AppImage.tar.gz", "Markdown.Notes_0.1.4.deb", "Markdown.Notes_0.1.4.deb.sig", "notes.sig", "notes.txt"]) {
    const run = spawnSync("bash", [script, "0.1.4", file], { encoding: "utf8" });
    assert.equal(run.status, 1, file);
    assert.equal(run.stdout, "", file);
  }
});
