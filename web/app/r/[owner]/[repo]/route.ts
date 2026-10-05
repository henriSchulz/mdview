// A repository's notes: the document the desktop app's own page runs in. It is the same document
// the Rust shell writes for a window (src-tauri/src/shell.rs, load_shell) — the page's styles,
// its one element, its scripts in their order — with the web's host after them
// (public/host/host.js) in the shell's place. Not a React page: the page brings everything.
import { randomBytes } from "node:crypto";
import { fresh, origin } from "@/lib/session";

export const dynamic = "force-dynamic";

// (the order the shell loads them in: SCRIPTS in shell.rs)
const SCRIPTS = [
  "vendor/markdown-it.min.js", "vendor/footnote.min.js", "vendor/deflist.min.js", "vendor/mark.min.js", "vendor/sub.min.js", "vendor/sup.min.js",
  "vendor/abbr.min.js", "vendor/emoji.min.js", "vendor/js-yaml.min.js", "vendor/highlight.min.js", "vendor/highlight-extra.min.js",
  "vendor/katex/katex.min.js", "strings.js", "viewer.js", "overview.js",
];

// The settings as they are when nothing is set (default_prefs in shell.rs), without what the web
// app does not have.
const PREFS = {
  lang: "en", startMode: "last", bar: true, slash: true, syntax: false, quotes: false, wrap: 0, images: "beside", style: "auto",
  bullet: "-", emphasis: "*", strongMark: "**", ordered: ".", dialogWidth: 0, dialogHeight: 0,
  latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, latexBrackets: true, latexText: true,
  pdfFormat: "callout", pdfAuto: false, sidebarPdf: true, sidebarImages: false, sidebarMedia: false, sidebarOther: false, sidebarSort: "opened",
  aiComplete: false, panel: false, panelTab: "insert", ovScope: "all", ovLayout: "tiles", measure: "normal", docZoom: 100, hinting: false, aiModel: "",
};

// The colours: the desktop's light theme, and a dark one of the same hues.
const LIGHT = { background: "#f5f5f7", foreground: "#1d1d1f", accent: "#0071e3", muted: "#a1a1a6", selection: "#b4d5fe", red: "#d70015", green: "#248a3d", yellow: "#a05a00", orange: "#c93400", blue: "#0071e3", cyan: "#0071a4", magenta: "#8944ab", brown: "#7f6545", bright_red: "#ff3b30", bright_green: "#34c759", bright_yellow: "#d18b00", bright_blue: "#0a84ff", bright_magenta: "#af52de", bright_cyan: "#30b0c7" };
const DARK = { background: "#1e1e20", foreground: "#f5f5f7", accent: "#0a84ff", muted: "#6e6e73", selection: "#3a5f8f", red: "#ff453a", green: "#32d74b", yellow: "#ffd60a", orange: "#ff9f0a", blue: "#0a84ff", cyan: "#64d2ff", magenta: "#bf5af2", brown: "#ac8e68", bright_red: "#ff6961", bright_green: "#4cd964", bright_yellow: "#ffe066", bright_blue: "#409cff", bright_magenta: "#da8fff", bright_cyan: "#70d7ff" };
const css = (colors: Record<string, string>, mode: string) => `:root{${Object.entries(colors).map(([k, v]) => `--c-${k.replace(/_/g, "-")}:${v}`).join(";")};color-scheme:${mode}}`;

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const inline = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029"); // (never closes the script it stands in)

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const here = origin(request);
  const session = await fresh().catch(() => null);
  if (!session) return Response.redirect(`${here}/signin?next=${encodeURIComponent(`/r/${owner}/${repo}`)}`, 307);
  const nonce = randomBytes(16).toString("base64");
  const a = "/app";
  // Scripts only with this document's nonce — so nothing a note brings (HTML in Markdown, a file
  // of the repository) can run as one. Everything else from here or as data.
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' 'self' https:; img-src 'self' data: blob: https: http:; font-src 'self' data:; media-src 'self' blob: https: http:; connect-src 'self'; worker-src 'self' blob:; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`;
  const web = { owner, repo, user: { login: session.login, name: session.name }, themes: { light: css(LIGHT, "light"), dark: css(DARK, "dark") } };
  // before the page's scripts: where it reaches its host (what it says while the host is not there
  // yet is kept for it), the settings, and the theme the system has
  const before =
    `window.MdWeb=${inline(web)};` +
    `window.MdHost={said:[],post:function(m){this.said.push(m)},files:location.origin+"/file"};` +
    `window.MdPrefs=Object.assign(${inline(PREFS)},(function(){try{return JSON.parse(localStorage.getItem("mdview:prefs"))||{}}catch(e){return {}}})());` +
    `(function(){var d=matchMedia("(prefers-color-scheme: dark)").matches;document.getElementById("theme").textContent=MdWeb.themes[d?"dark":"light"];document.body.dataset.mode=d?"dark":"light"})();`;
  const scripts = [`<script nonce="${nonce}">${before}</script>`, ...SCRIPTS.map((src) => `<script nonce="${nonce}" src="${a}/${src}"></script>`), `<script nonce="${nonce}" src="/host/core.js"></script>`, `<script nonce="${nonce}" src="/host/host.js"></script>`].join("");
  const page =
    `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>` +
    `<meta name='robots' content='noindex'><title>${attr(repo)}</title>` +
    `<base href='${attr(`${here}/file/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`)}'>` +
    `<link rel='stylesheet' href='${here}${a}/motion.css'><style id='theme'>${css(LIGHT, "light")}</style>` +
    `<link rel='stylesheet' href='${here}${a}/vendor/katex/katex.min.css'><link rel='stylesheet' href='${here}${a}/viewer.css'><link rel='stylesheet' href='${here}${a}/overview.css'>` +
    `</head><body data-mode='light'><main id='content'></main>${scripts}</body></html>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" } });
}
