// Writes the list of files in docs/MAP.md (between its two marks) from the files themselves: each
// one with the first sentence of its head comment — so the map says what the code says.
//   node dev/map.mjs           write it        node dev/map.mjs --check    exit 1 if it is not up to date
// (tests/map.test.mjs runs the check with the other tests.)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GROUPS = [
  ["The page — reading, the source editor, the window around the note", ["viewer/*.js", "viewer.js", "strings.js"]],
  ["The page's styles", ["motion.css", "viewer/*.css", "overview.css", "pdfview.css", "board.css", "ai.css"]],
  ["The active mode (loaded when first used)", ["active/*.js", "active/*.css"]],
  ["All Notes, PDFs, AI, whiteboards (each loaded when first used)", ["overview.js", "pdfview.js", "ai.js", "board.js", "board/*.js"]],
  ["The shell (Rust)", ["src-tauri/src/main.rs", "src-tauri/src/shell.rs", "src-tauri/src/shell/*.rs", "src-tauri/src/*.rs"]],
  ["The web app (the same page in a browser)", ["web/lib/*.ts", "web/host/*.ts", "web/public/host/*.js", "web/proxy.ts"]],
];
const files = (pattern) => {
  if (!pattern.includes("*")) return [pattern];
  const dir = dirname(pattern), ext = pattern.slice(pattern.lastIndexOf("*") + 1);
  return readdirSync(join(root, dir)).filter((f) => f.endsWith(ext)).sort().map((f) => `${dir}/${f}`);
};
// the head comment's first sentences, as one line
function about(text, file) {
  let head = "";
  if (file.endsWith(".rs")) head = text.split("\n").filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith("//!"))).map((l) => l.slice(3).trim()).join(" ");
  else if (file.endsWith(".ts")) head = (/^(?:\/\/.*\n)+/.exec(text) || [""])[0].replace(/^\/\/ ?/gm, "").replace(/\n/g, " ");
  else head = (/^\s*\/\*([\s\S]*?)\*\//.exec(text) || ["", ""])[1].replace(/^\s*\* ?/gm, "").replace(/-{5,}/g, "").replace(/\n/g, " ");
  head = head.replace(/\s+/g, " ").trim().replace(/^mdview(,? (the page|styles|active mode|active mode, styles|on the web))? ?(—|-|:) ?/i, "").replace(/ \(One of several sheets[^)]*\)/, "");
  if (head.length <= 110) return head;
  const cut = head.slice(0, 110), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (end > 50 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + " …").trim();
}
function list() {
  const seen = new Set(), out = [];
  for (const [title, patterns] of GROUPS) {
    out.push(`### ${title}`, "", "| File | What is in it |", "|---|---|");
    for (const f of patterns.flatMap(files)) {
      if (seen.has(f)) continue; seen.add(f);
      const text = readFileSync(join(root, f), "utf8");
      out.push(`| \`${f}\` | ${about(text, f).replace(/\|/g, "\\|")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}
const START = "<!-- files: written by dev/map.mjs -->", END = "<!-- /files -->";
export function fresh(doc) { return doc.slice(0, doc.indexOf(START) + START.length) + "\n\n" + list() + "\n" + doc.slice(doc.indexOf(END)); }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(root, "docs", "MAP.md"), doc = readFileSync(file, "utf8"), now = fresh(doc);
  if (process.argv.includes("--check")) { if (now !== doc) { console.error("docs/MAP.md is not up to date: node dev/map.mjs"); process.exit(1); } }
  else if (now !== doc) { writeFileSync(file, now); console.log("docs/MAP.md written"); }
}
