// The page behind a shared note's link: the note, for whoever has the link — a password asked for
// first where one was set — or a card that says there is nothing. The link is short,
// /s/<id> (app/s/[owner]/route.ts finds the repository the id belongs to); the note's data and
// files stand under the long address, /s/<owner>/<repo>/<id>/…, which is a link too.
import { randomBytes } from "node:crypto";
import { attr, css, DARK, LIGHT, pageDocument, icons } from "./page";
import { origin } from "./session";
import { cookieName, matches, mayTry, pass, tried } from "./share";
import { address, gate } from "./sharegate";
import { opened } from "./store";

const HEAD = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

// A page with one card in its middle, as the app's sign-in page (app/globals.css): colours of
// the two themes, durations and corners from the page's motion.css.
function card(here: string, title: string, body: string, status: number, more: Record<string, string> = {}): Response {
  const nonce = randomBytes(16).toString("base64");
  const style =
    `${css(LIGHT, "light")}@media (prefers-color-scheme: dark){${css(DARK, "dark")}}` +
    `:root{--fg:var(--c-foreground);--fg2:color-mix(in srgb,var(--fg) 65%,transparent);--line:color-mix(in srgb,var(--fg) 18%,transparent);--ui:"SF Pro","Inter",system-ui,sans-serif;color-scheme:light dark}` +
    `html,body{height:100%}body{margin:0;background:var(--c-background);color:var(--fg);font:400 14px/1.45 var(--ui);-webkit-font-smoothing:antialiased}` +
    `main{min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box}` +
    `.card{width:min(400px,100%);box-sizing:border-box;padding:28px 28px 24px;display:grid;gap:14px;border-radius:calc(var(--radius-panel) + 2px);background:color-mix(in srgb,#fff 62%,var(--c-background));box-shadow:0 0 0 .5px var(--line),0 18px 50px rgb(0 0 0/.12)}` +
    `@media (prefers-color-scheme: dark){.card{background:color-mix(in srgb,var(--fg) 5%,var(--c-background))}}` +
    `h1{margin:0;font:600 17px/1.3 var(--ui)}p{margin:0;color:var(--fg2)}` +
    `form{display:flex;gap:8px}.shake{animation:shake var(--shake-duration) var(--ease-out)}` +
    `@keyframes shake{20%,60%{transform:translateX(calc(-1 * var(--shake-distance)))}40%,80%{transform:translateX(var(--shake-distance))}}` +
    `@media (prefers-reduced-motion: reduce){.shake{animation:none}}` +
    `input{flex:1;min-width:0;height:32px;padding:0 10px;box-sizing:border-box;border:0;border-radius:var(--radius-control);background:var(--c-background);color:var(--fg);font:400 14px var(--ui);box-shadow:0 0 0 .5px var(--line);transition:box-shadow var(--dur-fast) var(--ease-out)}` +
    `input.wrong{box-shadow:0 0 0 1px var(--c-red)}` +
    `button{height:32px;padding:0 14px;border:0;border-radius:var(--radius-control);background:var(--c-accent);color:#fff;font:500 14px var(--ui);transition:filter var(--dur-fast) var(--ease-out),transform var(--spring-snappy-dur) var(--spring-snappy)}` +
    `button:hover{filter:brightness(1.08);transition-duration:var(--dur-instant),var(--spring-snappy-dur)}button:active{transform:scale(var(--press-scale));transition-duration:var(--dur-instant)}` +
    `:focus-visible{outline:var(--focus-ring) solid var(--c-accent);outline-offset:2px}.why{color:var(--fg)}`;
  const page =
    `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><meta name='robots' content='noindex'>` +
    `<title>${attr(title)}</title>${icons(here)}<link rel='stylesheet' href='${here}/app/motion.css'><style nonce='${nonce}'>${style}</style></head><body><main><div class='card'>${body}</div></main></body></html>`;
  return new Response(page, { status, headers: { ...HEAD, "Content-Security-Policy": `default-src 'none'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, ...more } });
}

const NOTHING: Record<string, [number, string]> = {
  gone: [404, "This link shows nothing. The note is not shared any more, or the link is not whole."],
  off: [404, "Notes are not shared from this address."],
  unreachable: [502, "The note could not be read just now. Try again in a moment."],
};
const ask = (here: string, to: string, why = "") =>
  card(here, "A shared note", `<h1>This note has a password</h1><p${why ? " class='why' role='alert'" : ""}>${why || "Whoever sent you the link has it."}</p>` +
    `<form method='post' action='${attr(to)}'${why ? " class='shake'" : ""}><input type='password' name='password' aria-label='Password' placeholder='Password' autocomplete='off' autofocus required${why ? " class='wrong'" : ""}><button type='submit'>Open</button></form>`, why ? 401 : 200);


/** Nothing at this address: a shrug, and the number. (The same page the app has for an address of
 * its own that is none: app/not-found.tsx.) */
export function shrug(here: string): Response {
  const nonce = randomBytes(16).toString("base64");
  const style =
    `${css(LIGHT, "light")}@media (prefers-color-scheme: dark){${css(DARK, "dark")}}` +
    `:root{color-scheme:light dark}html,body{height:100%}body{margin:0;background:var(--c-background);color:var(--c-foreground);font:400 14px/1.45 "SF Pro","Inter",system-ui,sans-serif;-webkit-font-smoothing:antialiased}` +
    `main{min-height:100%;display:grid;place-content:center;justify-items:center;gap:6px;padding:24px;box-sizing:border-box}` +
    `.shrug{margin:0;font-size:clamp(40px,9vw,64px);line-height:1.1;white-space:nowrap}h1{margin:0;font-weight:400;font-size:clamp(18px,3vw,24px)}`;
  const page =
    `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><meta name='robots' content='noindex'>` +
    `<title>404</title>${icons(here)}<style nonce='${nonce}'>${style}</style></head><body><main><p class='shrug' aria-hidden='true'>¯\\_(ツ)_/¯</p><h1>404</h1></main></body></html>`;
  return new Response(page, { status: 404, headers: { ...HEAD, "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}
export const nothing = (here: string, why: string) => { const [status, text] = NOTHING[why] || NOTHING.gone; return status === 404 && why !== "off" ? shrug(here) : card(here, "Nothing here", `<h1>Nothing here</h1><p>${text}</p>`, status); };

/** Before anything is known of the link — which repository it belongs to, whether it is still
 * shared, its password: all asked of GitHub, which takes a moment — a browser that comes to the
 * address is answered at once with a page that only waits: a ring in its middle (after the wait
 * that is no wait), and the same address asked for again, marked (?go). The ring stands until the
 * note's own page is there, which has one too (lib/page.ts). Only a person's browser arriving gets
 * it (Sec-Fetch-*): whatever else asks — a program, a preview — has its answer as before. → the
 * page, or null where the real answer is to be given. */
export function waitFirst(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.searchParams.has("go") || request.headers.get("sec-fetch-mode") !== "navigate" || request.headers.get("sec-fetch-dest") !== "document") return null;
  const here = origin(request), nonce = randomBytes(16).toString("base64");
  const style =
    `${css(LIGHT, "light")}@media (prefers-color-scheme: dark){${css(DARK, "dark")}}` +
    `:root{color-scheme:light dark}html,body{height:100%}body{margin:0;display:grid;place-items:center;background:var(--c-background)}` +
    `.ring{width:28px;height:28px;border-radius:50%;border:2.5px solid color-mix(in srgb,var(--c-foreground) 14%,transparent);border-top-color:var(--c-accent);opacity:0;animation:in var(--dur-base) var(--ease-out) var(--loading-delay) forwards,turn .9s linear infinite}` +
    `@keyframes in{to{opacity:1}}@keyframes turn{to{transform:rotate(360deg)}}` +
    `@media (prefers-reduced-motion:reduce){.ring{animation:in var(--dur-base) var(--ease-out) var(--loading-delay) forwards;border-top-color:color-mix(in srgb,var(--c-foreground) 14%,transparent)}}`;
  // (the place in the note the link names — its #… — goes along; a browser without scripts follows the link)
  const next = `var u=new URL(location.href);u.searchParams.set("go","1");location.replace(u.href)`;
  const page =
    `<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'><meta name='robots' content='noindex'>` +
    `<title>A shared note</title>${icons(here)}<link rel='stylesheet' href='${here}/app/motion.css'><style nonce='${nonce}'>${style}</style></head>` +
    `<body><span class='ring' role='status' aria-label='Loading'></span><noscript><a href='?go=1'>Open the note</a></noscript><script nonce='${nonce}'>${next}</script></body></html>`;
  return new Response(page, { headers: { ...HEAD, "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}

/** The note, or the question for its password. self: the address the browser is at. */
export async function showShared(request: Request, owner: string, repo: string, id: string, self: string): Promise<Response> {
  const here = origin(request), at = address(owner, repo, id);
  const g = await gate(owner, repo, id);
  if (!g.shared) return nothing(here, g.why);
  if (!g.open) return ask(here, self);
  void opened(id).catch(() => {}); // (counted, and when: the one who shares it can see that it is read)
  const dir = g.shared.path.includes("/") ? g.shared.path.slice(0, g.shared.path.lastIndexOf("/") + 1) : "";
  return pageDocument({
    here, title: g.shared.path.split("/").pop()!.replace(/\.(md|markdown)$/i, ""), files: at + "/file", hosts: ["/host/core.js", "/host/share.js"], referrer: "no-referrer", reading: true,
    base: `${at}/file/${dir.split("/").map(encodeURIComponent).join("/")}`, prefs: { startMode: "read" },
    web: { owner, repo, share: id },
  });
}

/** The password, given: right, and the browser carries that from now on. */
export async function givePassword(request: Request, owner: string, repo: string, id: string, self: string): Promise<Response> {
  const here = origin(request);
  const g = await gate(owner, repo, id);
  if (!g.shared) return nothing(here, g.why);
  if (g.open || !g.shared.password) return new Response(null, { status: 303, headers: { Location: here + self } });
  const key = `${owner}/${repo}/${id}`.toLowerCase();
  if (!mayTry(key)) return ask(here, self, "Too many wrong passwords. Try again in a while.");
  const given = String((await request.formData().catch(() => null))?.get("password") || "").slice(0, 1000);
  const right = !!given && (await matches(given, g.shared.password));
  tried(key, right);
  if (!right) return ask(here, self, "That is not the password.");
  // (for every address of the app's shared notes: the short link and the long one are the same note)
  const cookie = `${cookieName(id)}=${pass(owner, repo, id, g.shared.password)}; Path=/; Max-Age=${7 * 24 * 3600}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
  return new Response(null, { status: 303, headers: { Location: here + self, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
