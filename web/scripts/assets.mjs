// The page the web app shows is the desktop app's own: its scripts and styles are copied from the
// checkout into public/app when the app is built or started for development, never kept twice in
// the repository. (Run by npm's predev and prebuild.)
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "..");
const out = join(web, "public", "app");
const files = ["motion.css", "viewer.css", "active.css", "overview.css", "pdfview.css", "board.css", "viewer.js", "overview.js", "pdfview.js", "board.js", "strings.js"];
const folders = ["active", "board", "vendor"];

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
