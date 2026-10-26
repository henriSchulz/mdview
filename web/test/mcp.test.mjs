// The Model Context Protocol's endpoint (app/mcp) and its sign-in (lib/mcp/oauth.ts), against a
// GitHub of the test's own: a client registers, the user says yes and signs in with GitHub, the
// client gets its tokens — and with them lists, reads, searches and writes the notes.
// Run: npm run build && npm test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGitHub, freePort } from "./fake-github.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const gh = fakeGitHub();
const put = (p, t) => gh.repo.files.set(p, Buffer.from(t));
let app, base;

before(async () => {
  const at = await gh.listen(), port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the app did not start:\n" + log);
});

after(() => { app?.kill(); gh.close(); });

/** A PDF of one page per text, small but whole (its table of where each object begins included). */
function pdf(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  pages.forEach((t, i) => {
    const s = `BT /F1 18 Tf 72 720 Td (${t}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const at = objs.map((o, i) => { const here = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return here; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const REDIRECT = "http://127.0.0.1:33418/callback";
const form = (o) => new URLSearchParams(o).toString();

/** Through the sign-in as Claude Code would go: registered, sent to the page, yes, GitHub, back with a code, tokens. */
async function signIn() {
  const meta = await (await fetch(base + "/.well-known/oauth-authorization-server")).json();
  const reg = await fetch(meta.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1/callback"] }) });
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();
  const verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
  const asked = { response_type: "code", client_id, redirect_uri: REDIRECT, state: "s-1", code_challenge: challenge, code_challenge_method: "S256", resource: base + "/mcp" };
  const page = await fetch(`${meta.authorization_endpoint}?${form(asked)}`, { redirect: "manual" });
  assert.equal(page.status, 200); // (no session needed: the page is open)
  const html = await page.text();
  assert.match(html, /Claude Code<!-- -->? wants your notes|Claude Code wants your notes/);
  assert.match(html, /127\.0\.0\.1:33418/);
  const yes = await fetch(base + "/oauth/authorize/allow", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", origin: base }, body: form({ client_id, redirect_uri: REDIRECT, state: "s-1", code_challenge: challenge, answer: "allow" }) });
  assert.equal(yes.status, 303);
  const toGitHub = new URL(yes.headers.get("location"));
  assert.equal(toGitHub.pathname, "/login/oauth/authorize");
  assert.equal(toGitHub.searchParams.get("redirect_uri"), base + "/auth/callback");
  gh.challenge = toGitHub.searchParams.get("code_challenge");
  const cookie = yes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const cb = await fetch(`${base}/auth/callback?code=the-code&state=${toGitHub.searchParams.get("state")}`, { redirect: "manual", headers: { cookie } });
  const toClient = new URL(cb.headers.get("location"));
  assert.equal(toClient.origin + toClient.pathname, REDIRECT);
  assert.equal(toClient.searchParams.get("state"), "s-1");
  assert.ok(!cb.headers.getSetCookie().some((c) => c.startsWith("mdview=")), "no session is written for a client");
  const code = toClient.searchParams.get("code");
  const tok = await fetch(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, client_id, redirect_uri: REDIRECT, code_verifier: verifier, resource: base + "/mcp" }) });
  assert.equal(tok.status, 200);
  const tokens = await tok.json();
  // a code is good once
  const again = await fetch(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, client_id, redirect_uri: REDIRECT, code_verifier: verifier }) });
  assert.equal((await again.json()).error, "invalid_grant");
  return { client_id, tokens, meta };
}

let n = 0;
async function rpc(token, method, params) {
  const res = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
  return { status: res.status, headers: res.headers, body: res.status === 202 ? null : await res.json() };
}
const tool = async (token, name, args) => {
  const r = await rpc(token, "tools/call", { name, arguments: args });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { text: r.body.result.content.map((c) => c.text).join(""), error: !!r.body.result.isError };
};

test("without a token the endpoint says where to sign in", async () => {
  const r = await rpc(null, "tools/list");
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), new RegExp(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`));
  const pr = await (await fetch(base + "/.well-known/oauth-protected-resource/mcp")).json();
  assert.equal(pr.resource, base + "/mcp");
  assert.deepEqual(pr.authorization_servers, [base]);
  // a session cookie is no token, nor anything else sealed by the app
  assert.equal((await rpc("not-a-token", "tools/list")).status, 401);
});

test("a wrong place to go back to is shown, never gone to", async () => {
  const reg = await (await fetch(base + "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "X", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) })).json();
  const page = await fetch(`${base}/oauth/authorize?${form({ response_type: "code", client_id: reg.client_id, redirect_uri: "https://evil.example/cb", state: "s", code_challenge: "a".repeat(43), code_challenge_method: "S256" })}`, { redirect: "manual" });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /did not register/);
  assert.equal((await fetch(base + "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) })).status, 400);
  // a yes from another site's form is not taken
  const forged = await fetch(base + "/oauth/authorize/allow", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", origin: "https://evil.example" }, body: form({ client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "s", code_challenge: "a".repeat(43), answer: "allow" }) });
  assert.equal(forged.status, 403);
});

test("no: the client is told so", async () => {
  const reg = await (await fetch(base + "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] }) })).json();
  const no = await fetch(base + "/oauth/authorize/allow", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", origin: base }, body: form({ client_id: reg.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "s-9", code_challenge: "a".repeat(43), answer: "deny" }) });
  assert.equal(no.headers.get("location"), "https://claude.ai/api/mcp/auth_callback?error=access_denied&state=s-9");
});

test("signed in, a client lists, reads, searches and writes the notes", async () => {
  gh.repo.files.clear();
  put("Welcome.md", "# Welcome\n\nThe first note.\n");
  put("Uni/Analysis.md", "# Analysis\n\nThe mean value theorem.\nCauchy sequences.\n");
  put("Uni/Plan.board.svg", '<svg xmlns="http://www.w3.org/2000/svg">\n<metadata id="mdview-board"><![CDATA[\n{"board":1,"bg":"auto","grid":true}\n{"id":"a1","k":"sticky","x":10,"y":20,"w":100,"h":100,"r":0,"text":"Exam on Friday","ts":{"size":16}}\n{"id":"a2","k":"ink","t":"pen","c":"auto","o":1,"w":3,"ch":"xypt","p":""}\n]]></metadata>\n</svg>\n');
  gh.repo.files.set("Uni/Script.pdf", pdf(["Riemann integral", "Lebesgue measure"]));
  put("Secret/hidden.md", "# out of sight\n");
  put(".mdview/hidden.json", JSON.stringify({ version: 1, hidden: ["Secret"] }));
  const { tokens, client_id, meta } = await signIn();
  const t = tokens.access_token;

  const init = await rpc(t, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  const note = await fetch(base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(note.status, 202);
  const listed = (await rpc(t, "tools/list")).body.result.tools.map((x) => x.name);
  assert.deepEqual(listed, ["list_repositories", "list_files", "read_file", "search_notes", "write_note", "edit_note", "move_note"]);

  assert.match((await tool(t, "list_repositories", {})).text, /octo\/Zeta/);
  const files = (await tool(t, "list_files", { repo: "octo/notes" })).text;
  assert.match(files, /Uni\/Analysis\.md\tnote/);
  assert.match(files, /Uni\/Plan\.board\.svg\twhiteboard/);
  assert.match(files, /Uni\/Script\.pdf\tpdf/);
  assert.doesNotMatch(files, /Secret|\.mdview/);

  assert.match((await tool(t, "read_file", { repo: "octo/notes", path: "Uni/Analysis.md" })).text, /mean value theorem/);
  const board = (await tool(t, "read_file", { repo: "octo/notes", path: "Uni/Plan.board.svg" })).text;
  assert.match(board, /sticky \(10, 20\): Exam on Friday/);
  assert.match(board, /1 strokes of ink/);
  const both = (await tool(t, "read_file", { repo: "octo/notes", path: "Uni/Script.pdf" })).text;
  assert.match(both, /2 pages/);
  assert.match(both, /page 1 ---\nRiemann integral/);
  const second = (await tool(t, "read_file", { repo: "octo/notes", path: "Uni/Script.pdf", pages: "2" })).text;
  assert.match(second, /Lebesgue/);
  assert.doesNotMatch(second, /Riemann/);
  assert.ok((await tool(t, "read_file", { repo: "octo/notes", path: "../etc/passwd" })).error);

  const found = (await tool(t, "search_notes", { repo: "octo/notes", query: "cauchy" })).text;
  assert.match(found, /Uni\/Analysis\.md:4: Cauchy sequences\./);
  assert.match((await tool(t, "search_notes", { repo: "octo/notes", query: "friday" })).text, /Plan\.board\.svg/);
  assert.doesNotMatch((await tool(t, "search_notes", { repo: "octo/notes", query: "out of sight" })).text, /Secret/);

  // writing: one commit each, said to be Claude's
  assert.match((await tool(t, "write_note", { repo: "octo/notes", path: "Uni/New.md", content: "# New\n" })).text, /Made Uni\/New\.md/);
  assert.equal(gh.repo.files.get("Uni/New.md").toString(), "# New\n");
  assert.match(gh.commits.at(-1).body, /Device: Claude \(MCP\)/);
  assert.equal(gh.commits.at(-1).headline, "New.md");
  assert.ok((await tool(t, "write_note", { repo: "octo/notes", path: "Uni/New.md", content: "x" })).error, "not replaced unasked");
  assert.ok((await tool(t, "write_note", { repo: "octo/notes", path: "Uni/New.txt", content: "x" })).error, "only notes");
  assert.match((await tool(t, "edit_note", { repo: "octo/notes", path: "Uni/Analysis.md", old_text: "Cauchy sequences.", new_text: "Cauchy sequences converge in R." })).text, /Changed/);
  assert.match(gh.repo.files.get("Uni/Analysis.md").toString(), /converge in R\.\n$/);
  assert.match((await tool(t, "edit_note", { repo: "octo/notes", path: "Uni/Analysis.md", old_text: "nowhere", new_text: "x" })).text, /not in the note/);
  assert.match((await tool(t, "move_note", { repo: "octo/notes", from: "Uni/New.md", to: "Archive/New.md" })).text, /Moved/);
  assert.ok(!gh.repo.files.has("Uni/New.md"));
  assert.equal(gh.repo.files.get("Archive/New.md").toString(), "# New\n");
  assert.ok((await tool(t, "move_note", { repo: "octo/notes", from: "Archive/New.md", to: "Welcome.md" })).error, "never onto a file that is there");

  // renewed: new tokens for the refresh token; the old refresh token is spent at GitHub
  const renewed = await (await fetch(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id }) })).json();
  assert.ok(renewed.access_token && renewed.refresh_token);
  assert.match((await tool(renewed.access_token, "read_file", { repo: "octo/notes", path: "Welcome.md" })).text, /first note/);
  const other = await fetch(meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: renewed.refresh_token, client_id: "someone-else" }) });
  assert.equal((await other.json()).error, "invalid_grant", "a refresh token is its client's only");
});
