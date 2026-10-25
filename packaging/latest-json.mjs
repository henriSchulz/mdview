#!/usr/bin/env node
// What the app's updater reads (src-tauri/src/update.rs, tauri-plugin-updater): latest.json, the
// static format of Tauri's updater — the version, a word about it, when it was released, and for
// each system and architecture the file to download and its signature. It is written from the
// signatures the release has (the .sig files its jobs uploaded beside the installers, named by
// packaging/release-name.sh), so it lists only what is released: an installer that was held back
// (the Windows one, when windows-tried did not hold) is not in it.
//
//   node packaging/latest-json.mjs v0.1.5 <folder with the .sig files> > latest.json
//
// Only what updates itself is listed: the AppImages (linux-x86_64, linux-aarch64) and the Windows
// installer (windows-x86_64). A .deb or an .rpm is never replaced by the app. With no signature
// at all it ends with 1: a latest.json that offers nothing is not released.
// .github/workflows/build.yml (the job "latest.json") runs it; dev/tests/latest-json.test.mjs feeds it fake ones.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const REPO = "henriSchulz/mdview";

// the file a signature belongs to → the updater's name for the system and architecture
const PLATFORMS = [
  [/-linux-x64\.AppImage$/, "linux-x86_64"],
  [/-linux-arm64\.AppImage$/, "linux-aarch64"],
  [/-windows-x64-setup\.exe$/, "windows-x86_64"],
];

/** latest.json for a tag, from the release's signatures: { "<file>.sig": "<its content>" }. */
export function latestJson(tag, sigs, date = new Date()) {
  const version = tag.replace(/^v/, "");
  const platforms = {};
  for (const [sigName, text] of Object.entries(sigs).sort(([a], [b]) => a.localeCompare(b))) {
    if (!sigName.endsWith(".sig")) continue;
    const file = sigName.slice(0, -4);
    if (!file.startsWith(`MarkdownNotes-${version}-`)) continue; // (a signature of another version, left in the folder)
    const hit = PLATFORMS.find(([re]) => re.test(file));
    if (!hit) continue;
    platforms[hit[1]] = { signature: text.trim(), url: `https://github.com/${REPO}/releases/download/${tag}/${file}` };
  }
  if (!Object.keys(platforms).length) throw new Error(`no signature of an installer of ${tag}`);
  return {
    version,
    notes: `Markdown Notes ${version}: https://github.com/${REPO}/releases/tag/${tag}`,
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tag, dir] = process.argv.slice(2);
  if (!tag || !dir) {
    console.error("usage: latest-json.mjs <tag> <folder with the .sig files>");
    process.exit(2);
  }
  const sigs = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".sig")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
  try {
    process.stdout.write(JSON.stringify(latestJson(tag, sigs), null, 2) + "\n");
  } catch (e) {
    console.error("latest-json.mjs: " + e.message);
    process.exit(1);
  }
}
