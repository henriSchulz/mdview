// Builds the vendored bundles the active mode loads on demand. Run with
// `npm install && npm run build` in this folder; the output is committed, so
// the app itself never needs node. Versions are pinned in package.json.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const versions = JSON.parse(readFileSync(new URL("./package.json", import.meta.url))).devDependencies;
const banner = (names) => "/*! " + names.map((n) => `${n} ${versions[n]}`).join(", ") + " — MIT, bundled by dev/build-vendor.mjs */";

await build({
  entryPoints: [new URL("./pm-entry.mjs", import.meta.url).pathname],
  outfile: new URL("../vendor/prosemirror.min.js", import.meta.url).pathname,
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "PM",
  target: "safari16",
  legalComments: "none",
  banner: { js: banner(Object.keys(versions).filter((n) => n.startsWith("prosemirror-"))) },
});

// the history's differences between two versions of a note (active/history.js)
await build({
  stdin: { contents: 'export { diffLines, diffWordsWithSpace } from "diff";', resolveDir: new URL(".", import.meta.url).pathname },
  outfile: new URL("../vendor/diff.min.js", import.meta.url).pathname,
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "Diff",
  target: "safari16",
  legalComments: "none",
  banner: { js: banner(["diff"]).replace("MIT", "BSD-3-Clause") },
});
