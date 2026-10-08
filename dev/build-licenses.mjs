// The license texts of what is bundled in vendor/, gathered from the packages themselves (the
// registry: `node build-licenses.mjs`) into ../vendor/LICENSES.md — MIT, BSD and ISC ask for
// their notice in every copy, and a minified file carries none. Run again after a version bump.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pm = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).devDependencies;
const pinned = (name) => `${name}@${pm[name]}`;
// [what it is bundled in, packages]
const GROUPS = [
  ["markdown-it.min.js", ["markdown-it@14.1.0", "linkify-it", "mdurl", "uc.micro", "entities", "punycode.js"]],
  ["abbr, deflist, emoji, footnote, mark, sub, sup (.min.js)", ["markdown-it-abbr", "markdown-it-deflist", "markdown-it-emoji", "markdown-it-footnote", "markdown-it-mark", "markdown-it-sub", "markdown-it-sup"]],
  ["js-yaml.min.js", ["js-yaml"]],
  ["highlight.min.js, highlight-extra.min.js", ["highlight.js@11.11.1"]],
  ["katex/", ["katex@0.16.25"]],
  ["mermaid.min.js", ["mermaid@11.12.0"]],
  ["prosemirror.min.js", [...Object.keys(pm).filter((n) => n.startsWith("prosemirror-")).map(pinned), "orderedmap", "rope-sequence", "w3c-keyname"]],
  ["diff.min.js", [pinned("diff")]],
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdview-licenses-"));
function licenseOf(spec) {
  const tgz = execFileSync("npm", ["pack", spec, "--silent"], { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
  const dir = path.join(tmp, tgz.replace(/\.tgz$/, ""));
  fs.mkdirSync(dir);
  execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", dir]);
  const root = path.join(dir, "package"), meta = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const file = fs.readdirSync(root).find((f) => /^(licen[sc]e|copying)/i.test(f));
  // (a package without a license file of its own: what its package.json says, and by whom)
  const author = typeof meta.author === "string" ? meta.author : meta.author ? [meta.author.name, meta.author.url].filter(Boolean).join(", ") : "";
  const text = file ? fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n?/g, "\n").trim() : `(The package carries no license file. Its package.json: license ${meta.license}${author ? ", author " + author : ""}.)`;
  return { name: meta.name, version: meta.version, license: meta.license, text };
}
let out = "# Licenses of the bundled libraries\n\nWhat `vendor/` holds is other people's work, bundled as its licenses allow. Their texts, as the\npackages carry them (gathered by `dev/build-licenses.mjs`). PDF.js: `pdfjs/LICENSE`.\n\n" +
  "`mermaid.min.js` is Mermaid's own bundle and holds the libraries Mermaid is built on as well\n(among them d3, dagre, cytoscape, DOMPurify, lodash, khroma, stylis, dayjs); KaTeX's fonts are under\nthe SIL Open Font License 1.1. Their notices: <https://github.com/mermaid-js/mermaid/blob/develop/package.json>\nand <https://github.com/KaTeX/KaTeX/tree/main/fonts>.\n";
for (const [where, specs] of GROUPS) {
  out += `\n## ${where}\n`;
  for (const spec of specs) {
    const l = licenseOf(spec);
    out += `\n### ${l.name} ${l.version} — ${l.license}\n\n\`\`\`text\n${l.text}\n\`\`\`\n`;
    console.log(`${l.name} ${l.version}: ${l.license}`);
  }
}
fs.writeFileSync(new URL("../vendor/LICENSES.md", import.meta.url), out);
fs.rmSync(tmp, { recursive: true, force: true });
