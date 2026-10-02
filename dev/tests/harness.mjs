// Loads the page's own scripts (vendor libraries + viewer.js) into jsdom, so
// tests run against the parser exactly as the app configures it.
import { JSDOM, VirtualConsole } from "jsdom";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPTS = [
  "vendor/markdown-it.min.js", "vendor/footnote.min.js", "vendor/deflist.min.js", "vendor/mark.min.js",
  "vendor/sub.min.js", "vendor/sup.min.js", "vendor/abbr.min.js", "vendor/emoji.min.js", "vendor/js-yaml.min.js",
  "vendor/highlight.min.js", "vendor/katex/katex.min.js", "strings.js", "viewer.js",
];

export const ACTIVE = ["vendor/prosemirror.min.js", "active/store.js", "active/schema.js", "active/tables.js", "active/markdown.js", "active/document.js", "active/link.js", "active/dialog.js", "active/islands.js", "active/menu.js", "active/edit.js", "active/tableui.js", "active/notes.js", "active/clip.js", "active/view.js"];

export async function loadPage(extra = []) {
  const base = pathToFileURL(ROOT + "/").href;
  const tags = [...SCRIPTS, ...extra].map((s) => `<script nonce="t" src="${base}${s}"></script>`).join("");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => { if (!/Not implemented/.test(e.message)) errors.push(e); });
  virtualConsole.on("error", (e) => errors.push(e));
  const dom = new JSDOM(
    `<!doctype html><html><head><base href="${base}"><style id="henri-ui"></style><style id="theme"></style></head>` +
    `<body data-mode="light"><main id="content"></main>${tags}</body></html>`,
    { url: base, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole });
  await new Promise((resolve) => dom.window.addEventListener("load", resolve));
  if (errors.length) throw errors[0].detail || errors[0];
  if (!dom.window.MdView) throw new Error("viewer.js did not load");
  return dom.window;
}
