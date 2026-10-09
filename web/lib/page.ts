// The document the desktop app's own page runs in, as the web app writes it: the page's styles,
// its one element, its scripts in their order (as the Rust shell does for a window: load_shell in
// src-tauri/src/shell.rs) — and after them whatever is the page's host here.
import { randomBytes } from "node:crypto";

// (the order the shell loads them in: SCRIPTS in shell.rs)
const SCRIPTS = [
  "vendor/markdown-it.min.js", "vendor/footnote.min.js", "vendor/deflist.min.js", "vendor/mark.min.js", "vendor/sub.min.js", "vendor/sup.min.js",
  "vendor/abbr.min.js", "vendor/emoji.min.js", "vendor/js-yaml.min.js", "vendor/highlight.min.js", "vendor/highlight-extra.min.js",
  "vendor/katex/katex.min.js", "strings.js", "viewer.js", "overview.js",
];

// The settings as they are when nothing is set (default_prefs in shell.rs), without what the web
// app does not have.
export const PREFS = {
  lang: "en", startMode: "last", bar: true, slash: true, syntax: false, quotes: false, wrap: 0, images: "assets", style: "auto",
  bullet: "-", emphasis: "*", strongMark: "**", ordered: ".", dialogWidth: 0, dialogHeight: 0,
  latexSnippets: true, latexFraction: true, latexMatrix: true, latexTabout: true, latexEnlarge: true, latexBrackets: true, latexText: true,
  pdfFormat: "callout", pdfAuto: false, sidebarPdf: true, sidebarImages: false, sidebarMedia: false, sidebarOther: false, sidebarSort: "opened",
  aiComplete: false, panel: false, panelTab: "insert", ovScope: "all", ovLayout: "tiles", ovPdf: false, ovImages: false, ovMedia: false, ovOther: false, measure: "normal", docZoom: 100, hinting: false, aiModel: "",
};

// The settings of this browser: the defaults, and over them what was chosen here ("mdview:set" —
// only that, so a default that changes later reaches a browser that never chose). Before, all
// settings were kept as they stood ("mdview:prefs"), the defaults of that day among them: of
// those, what differs from today's defaults is taken over once — but not pictures "beside" the
// note, which was the default then and nobody's choice.
const CHOSEN =
  `(function(d){var s=null;try{s=JSON.parse(localStorage.getItem("mdview:set"));if(!s||typeof s!=="object"){s={};var o=JSON.parse(localStorage.getItem("mdview:prefs"))||{};` +
  `for(var k in o)if(o[k]!==d[k]&&!(k==="images"&&o[k]==="beside"))s[k]=o[k];localStorage.setItem("mdview:set",JSON.stringify(s));localStorage.removeItem("mdview:prefs")}}catch(e){s=s||{}}return Object.assign(d,s)})`;

// The colours: the desktop's light theme, and a dark one of the same hues.
export const LIGHT = { background: "#f5f5f7", foreground: "#1d1d1f", accent: "#0071e3", muted: "#a1a1a6", selection: "#b4d5fe", red: "#d70015", green: "#248a3d", yellow: "#a05a00", orange: "#c93400", blue: "#0071e3", cyan: "#0071a4", magenta: "#8944ab", brown: "#7f6545", bright_red: "#ff3b30", bright_green: "#34c759", bright_yellow: "#d18b00", bright_blue: "#0a84ff", bright_magenta: "#af52de", bright_cyan: "#30b0c7" };
export const DARK = { background: "#1e1e20", foreground: "#f5f5f7", accent: "#0a84ff", muted: "#6e6e73", selection: "#3a5f8f", red: "#ff453a", green: "#32d74b", yellow: "#ffd60a", orange: "#ff9f0a", blue: "#0a84ff", cyan: "#64d2ff", magenta: "#bf5af2", brown: "#ac8e68", bright_red: "#ff6961", bright_green: "#4cd964", bright_yellow: "#ffe066", bright_blue: "#409cff", bright_magenta: "#da8fff", bright_cyan: "#70d7ff" };
export const css = (colors: Record<string, string>, mode: string) => `:root{${Object.entries(colors).map(([k, v]) => `--c-${k.replace(/_/g, "-")}:${v}`).join(";")};color-scheme:${mode}}`;

/** The app's icon, for a document's head: the desktop app's own (packaging/mdview.svg), as public/welcome has it. */
export const icons = (here: string) =>
  `<link rel='icon' type='image/svg+xml' href='${here}/welcome/icon.svg'><link rel='icon' sizes='48x48' href='${here}/favicon.ico'><link rel='apple-touch-icon' href='${here}/welcome/icon-180.png'><link rel='manifest' href='${here}/welcome/app.webmanifest'>`;

export const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
export const inline = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").split(LS).join("\\u2028").split(PS).join("\\u2029"); // (never closes the script it stands in)


// What the page offers and a browser cannot do (commands of its menus), and what is called
// otherwise here: a file deleted in a repository goes to no Trash, its versions stay.
const LACKS = ["default", "openwith", "reveal"];
const LABELS = { trash: "Delete" };

// While the page is on its way — its scripts, then the repository or the shared note itself — the
// whole window says so: a ring that turns, in the middle of it. Not at once (what comes within a
// moment needs no waiting shown: motion.css, --loading-delay), and it fades when something is
// there: the note, or the word that there is none (below: the first thing in #content, or All Notes).
// Later waits — a note whose text is fetched, the way back to the repositories — show a small ring
// over the page, which stays as it is (#wait, body[data-wait]: host.js).
const BOOT = `<div id='boot' role='status' aria-label='Loading'><span class='boot-ring'></span></div>`;
const BOOT_CSS =
  `#boot{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:var(--c-background);transition:opacity var(--dur-base) var(--ease-out),visibility 0s linear var(--dur-base)}` +
  `#boot[data-done]{opacity:0;visibility:hidden;pointer-events:none}` +
  `.boot-ring{width:28px;height:28px;border-radius:50%;border:2.5px solid color-mix(in srgb,var(--c-foreground) 14%,transparent);border-top-color:var(--c-accent);opacity:0;animation:boot-in var(--dur-base) var(--ease-out) var(--loading-delay) forwards,boot-turn .9s linear infinite}` +
  `@keyframes boot-in{to{opacity:1}}@keyframes boot-turn{to{transform:rotate(360deg)}}` +
  `@media (prefers-reduced-motion:reduce){.boot-ring{animation:boot-in var(--dur-base) var(--ease-out) var(--loading-delay) forwards;border-top-color:color-mix(in srgb,var(--c-foreground) 14%,transparent);box-shadow:0 0 0 0 transparent}}` +
  `#wait{position:fixed;left:50%;top:50%;z-index:95;width:44px;height:44px;margin:-22px 0 0 -22px;display:grid;place-items:center;border-radius:50%;background:var(--c-background);box-shadow:0 0 0 .5px color-mix(in srgb,var(--c-foreground) 14%,transparent),0 8px 24px rgb(0 0 0/.18);pointer-events:none;opacity:0;visibility:hidden;transition:opacity calc(var(--dur-base)*.7) var(--ease-exit),visibility 0s linear calc(var(--dur-base)*.7)}body[data-wait] #wait{opacity:1;visibility:visible;transition:opacity var(--dur-base) var(--ease-out) var(--loading-delay),visibility 0s linear var(--loading-delay)}#wait span{width:20px;height:20px;box-sizing:border-box;border-radius:50%;border:2.5px solid color-mix(in srgb,var(--c-foreground) 14%,transparent);border-top-color:var(--c-accent)}body[data-wait] #wait span{animation:wait-turn .9s linear infinite}@keyframes wait-turn{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){body[data-wait] #wait span{animation:none}}`;
// (leaving for another page of the app: what is left goes out of focus behind the ring — a veil that blurs it, at once)
const VEIL_CSS = `body::before{content:"";position:fixed;inset:0;z-index:94;pointer-events:none;background:color-mix(in srgb,var(--c-background) 40%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);opacity:0;visibility:hidden;transition:opacity calc(var(--dur-slow)*.7) var(--ease-exit),visibility 0s linear calc(var(--dur-slow)*.7)}body[data-wait="leave"]::before{opacity:1;visibility:visible;pointer-events:auto;transition:opacity var(--dur-slow) var(--ease-out),visibility 0s}`;
const WAIT = `<div id='wait' role='status' aria-label='Loading'><span></span></div>`;
// (the ring goes when the page shows something, whoever its host is)
const BOOTED = `(function(){var b=document.getElementById("boot"),c=document.getElementById("content");if(!b)return;var done=function(){if(b.dataset.done!=null)return;b.dataset.done="";o.disconnect();setTimeout(function(){b.remove()},600)};var o=new MutationObserver(function(){if(c.firstChild||document.body.hasAttribute("data-overview"))done()});o.observe(c,{childList:true});o.observe(document.body,{attributes:true,attributeFilter:["data-overview"]});window.MdBooted=done})();`;

/** The document. web: what the host is told (window.MdWeb, with the themes added). files: where
 * the page finds files beside a note. base: what relative addresses in the page start from.
 * reading: the note is only read here (no modes to switch between). hosts: the scripts that are the host, after the page's own. referrer: what other sites are told
 * of this address when a link is followed. framed: this server's own pages may show it in a frame
 * (the welcome page's sample notes); nothing else ever may. */
export function pageDocument(o: { here: string; title: string; web: object; files: string; base: string; hosts: string[]; prefs?: object; referrer?: string; reading?: boolean; framed?: boolean }): Response {
  const nonce = randomBytes(16).toString("base64"), a = "/app", here = o.here;
  // Scripts only with this document's nonce — so nothing a note brings (HTML in Markdown, a file
  // of the repository) can run as one. Everything else from here or as data.
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' 'self' https:; img-src 'self' data: blob: https: http:; font-src 'self' data:; media-src 'self' blob: https: http:; connect-src 'self'; worker-src 'self' blob:; base-uri 'self'; manifest-src 'self'; form-action 'none'; frame-ancestors ${o.framed ? "'self'" : "'none'"}`;
  const web = { ...o.web, themes: { light: css(LIGHT, "light"), dark: css(DARK, "dark") } };
  // before the page's scripts: where it reaches its host (what it says while the host is not there
  // yet is kept for it), the settings, and the theme the system has
  const before =
    `window.MdWeb=${inline(web)};` +
    `window.MdHost={said:[],post:function(m){this.said.push(m)},files:location.origin+${inline(o.files)}${o.reading ? ",reading:true" : ""},lacks:${inline(LACKS)},labels:${inline(LABELS)}${o.reading ? "" : ",download:true"}};` +
    `window.MdPrefs=${CHOSEN}(${inline({ ...PREFS, ...(o.prefs || {}) })});` +
    `(function(){var d=matchMedia("(prefers-color-scheme: dark)").matches;document.getElementById("theme").textContent=MdWeb.themes[d?"dark":"light"];document.body.dataset.mode=d?"dark":"light"})();` + BOOTED;
  const scripts = [`<script nonce="${nonce}">${before}</script>`, ...SCRIPTS.map((src) => `<script nonce="${nonce}" src="${a}/${src}"></script>`), ...o.hosts.map((src) => `<script nonce="${nonce}" src="${src}"></script>`)].join("");
  const page =
    `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'>` +
    // (on a phone's home screen: an app of its own, its bars in the page's colour — light and dark)
    `<meta name='mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-capable' content='yes'><meta name='apple-mobile-web-app-title' content='Notes'><meta name='apple-mobile-web-app-status-bar-style' content='default'>` +
    `<meta name='theme-color' content='${LIGHT.background}' media='(prefers-color-scheme: light)'><meta name='theme-color' content='${DARK.background}' media='(prefers-color-scheme: dark)'>` +
    `<meta name='robots' content='noindex'><title>${attr(o.title)}</title>${icons(here)}` +
    `<base href='${attr(here + o.base)}'>` +
    `<link rel='stylesheet' href='${here}${a}/motion.css'><style id='theme'>${css(LIGHT, "light")}</style>` +
    `<link rel='stylesheet' href='${here}${a}/vendor/katex/katex.min.css'><link rel='stylesheet' href='${here}${a}/viewer.css'><link rel='stylesheet' href='${here}${a}/overview.css'>` +
    `<style>${BOOT_CSS}${VEIL_CSS}</style></head><body data-mode='light'>${BOOT}${WAIT}<main id='content'></main>${scripts}</body></html>`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": o.referrer || "same-origin", "X-Robots-Tag": "noindex" } });
}
