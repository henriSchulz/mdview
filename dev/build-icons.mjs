// The folders' signs to choose from (viewer/sidebar.js: the colour-and-icon window) — Lucide (https://lucide.dev, ISC), every
// icon as the inner markup of a 24×24 picture drawn in lines, with the words it is found by. → vendor/icons.js
//
//   node dev/build-icons.mjs [path to the lucide-static package]   (default: node_modules/lucide-static; or
//   `npm pack lucide-static@1.57.0` and its package/ unpacked) — its license: build-licenses.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const from = process.argv[2] || new URL("node_modules/lucide-static", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(from, "package.json"), "utf8"));
const nodes = JSON.parse(readFileSync(join(from, "icon-nodes.json"), "utf8")), tags = JSON.parse(readFileSync(join(from, "tags.json"), "utf8"));
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const names = {}, words = {};
for (const name of Object.keys(nodes).sort()) {
  names[name] = nodes[name].map(([tag, a]) => `<${tag}${Object.entries(a).filter(([k]) => k !== "key").map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}/>`).join("");
  words[name] = (tags[name] || []).join(" ");
}
const head = `/* mdview — the folders' signs to choose from: Lucide ${pkg.version} (https://lucide.dev), ISC License — see vendor/LICENSES.md.
 * Written by dev/build-icons.mjs; loaded when the choice is first opened, or a folder's sign is one of these (viewer/modes.js: loadIcons). */\n`;
writeFileSync(new URL("../vendor/icons.js", import.meta.url), head + "window.MdIcons = " + JSON.stringify({ version: pkg.version, names, words }) + ";\n");
console.log(`vendor/icons.js: ${Object.keys(names).length} icons of Lucide ${pkg.version}`);
