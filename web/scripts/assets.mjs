// The page the web app shows is the desktop app's own: its scripts and styles are copied from the
// checkout into public/app when the app is built or started for development, never kept twice in
// the repository. (Run by npm's predev and prebuild.)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "..");
const out = join(web, "public", "app");
const files = ["velum.css", "motion.css", "overview.css", "pdfview.css", "board.css", "viewer.js", "overview.js", "pdfview.js", "board.js", "strings.js"];
const folders = ["active", "board", "vendor", "viewer"];

if (!existsSync(join(root, "viewer.js"))) {
  console.error("assets: the checkout's page (viewer.js) is not beside web/ — nothing copied");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of files) cpSync(join(root, f), join(out, f));
for (const d of folders) cpSync(join(root, d), join(out, d), { recursive: true });
mkdirSync(join(out, "docs"));
cpSync(join(root, "docs", "FEATURES.md"), join(out, "docs", "FEATURES.md")); // (the guide: what Help shows)
console.log(`assets: ${files.length} files, ${folders.join(", ")} and the guide copied to public/app`);

// The rules for writing a note, for a client of the Model Context Protocol (lib/mcp/tools.ts,
// notes_guide): the skill of the repository (skill/mdview-notes), without what only holds on the
// author's own computer (where a file is saved, Git, the pasteboard: SKILL.md's last part and
// history.md) — and with a head of its own. Written as a module of the server, so it is in the build wherever that runs.
const skill = readFileSync(join(root, "skill", "mdview-notes", "SKILL.md"), "utf8").replace(/^---\n[\s\S]*?\n---\n/, "");
const LOCAL = ["Where it goes"];
const guide = skill
  .split(/\n(?=## )/)
  .filter((part) => !LOCAL.some((name) => part.startsWith(`## ${name}`)))
  .join("\n")
  .replace(/^\s*# Notes for Markdown Notes \(mdview\)\n\n[\s\S]*?\n\n/, `# Notes for Markdown Notes (mdview)

How a note is written for Markdown Notes, the app the user reads their notes in. A note is plain
Markdown that reads well elsewhere too, and uses the app's extras where they make it better.
Written with write_note and edit_note: each is a commit of its own, nothing else to do — no Git,
no command. The skill was written for the app's author, Henri: where it says Henri, read the user.

`)
  .trim();
writeFileSync(join(web, "lib", "mcp", "guide.gen.ts"), `// Written by scripts/assets.mjs from skill/mdview-notes/SKILL.md — not to be changed here.\nexport const GUIDE = ${JSON.stringify(guide + "\n")};\n`);
console.log(`assets: the guide for notes (${guide.length} characters) written to lib/mcp/guide.gen.ts`);
