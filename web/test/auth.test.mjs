// Signing in, against a GitHub of the test's own: the built app is started with its addresses
// pointed there, and a browser's part is played with fetch and a cookie jar.
// Run: npm run build && npm test
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const seen = []; // what the fake GitHub was asked: [path, form or header]
let github, app, base, lifetime = 28800, refreshes = 0;
let serial = 0, validAccess = "", validRefresh = ""; // the tokens GitHub takes just now: every one it hands out is new

function fakeGitHub() {
  return createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x"), form = new URLSearchParams(body);
      const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
      seen.push([url.pathname, req.method === "POST" ? Object.fromEntries(form) : req.headers.authorization || ""]);
      if (url.pathname === "/login/oauth/access_token") {
        if (form.get("client_secret") !== "the-secret") return json({ error: "incorrect_client_credentials" });
        if (form.get("grant_type") === "refresh_token") {
          if (form.get("refresh_token") !== validRefresh) return json({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." });
          refreshes++; serial++;
          [validAccess, validRefresh] = [`ghu_${serial}`, `ghr_${serial}`];
          return json({ access_token: validAccess, expires_in: 28800, refresh_token: validRefresh, refresh_token_expires_in: 15897600 });
        }
        // the code is only good with the verifier whose challenge the user was sent to GitHub with
        const ok = form.get("code") === "the-code" && createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") === fakeGitHub.challenge;
        if (!ok) return json({ error: "bad_verification_code" });
        serial++;
        [validAccess, validRefresh] = [`ghu_${serial}`, `ghr_${serial}`];
        return json({ access_token: validAccess, expires_in: lifetime, refresh_token: validRefresh, refresh_token_expires_in: 15897600 });
      }
      const token = (req.headers.authorization || "").replace("Bearer ", "");
      if (token !== validAccess) return json({ message: "Bad credentials" }, 401);
      if (url.pathname === "/user") return json({ login: "octo", name: "Octo Cat", id: 42 });
      if (url.pathname === "/user/installations") return json({ installations: [{ id: 7 }] });
      if (url.pathname === "/user/installations/7/repositories") return json({ repositories: [
        { full_name: "octo/Zeta", private: true, default_branch: "main" }, { full_name: "octo/alpha-notes", private: false, default_branch: "trunk" } ] });
      json({ message: "Not Found" }, 404);
    });
  });
}

const listen = (server) => new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

/** A browser, as far as it matters here: it keeps cookies and is told where it is sent. */
function browser() {
  const jar = new Map();
  return {
    jar,
    async go(path, init = {}) {
      const res = await fetch(path.startsWith("http") ? path : base + path, { ...init, redirect: "manual", headers: { ...(init.headers || {}), cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split(";"), i = pair.indexOf("="), name = pair.slice(0, i), value = pair.slice(i + 1);
        const gone = !value || attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a));
        if (gone) jar.delete(name); else jar.set(name, value);
      }
      const location = res.headers.get("location"); // (the app may name a place of its own without its address)
      return { status: res.status, to: location && new URL(location, base).href, text: await res.text(), cookies: res.headers.getSetCookie() };
    },
  };
}

before(async () => {
  github = fakeGitHub();
  const at = `http://127.0.0.1:${await listen(github)}`;
  const probe = createServer(); const port = await listen(probe); await new Promise((r) => probe.close(r));
  base = `http://127.0.0.1:${port}`;
  app = spawn("npx", ["next", "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: web, env: { ...process.env, GITHUB_WEB: at, GITHUB_API: at, GITHUB_CLIENT_SECRET: "the-secret", SESSION_SECRET: "a-session-secret-of-the-test-that-is-long-enough", APP_ORIGIN: base }, stdio: "pipe" });
  let log = ""; app.stdout.on("data", (d) => (log += d)); app.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + "/signin")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the app did not start:\n" + log);
});

after(() => { app?.kill(); github?.close(); });

/** Up to GitHub and back with its code. -> where the app sends the browser then */
async function signIn(b, next) {
  const sent = await b.go("/auth/login" + (next ? `?next=${encodeURIComponent(next)}` : ""));
  const to = new URL(sent.to);
  fakeGitHub.challenge = to.searchParams.get("code_challenge");
  return { sent, to, back: await b.go(`/auth/callback?code=the-code&state=${to.searchParams.get("state")}`) };
}

test("nothing of the app without signing in", async () => {
  const b = browser();
  assert.deepEqual([(await b.go("/")).status, (await b.go("/")).to], [307, base + "/signin"]);
  assert.equal((await b.go("/r/octo/Zeta")).to, base + "/signin?next=%2Fr%2Focto%2FZeta");
  assert.equal((await b.go("/auth/renew")).to, base + "/signin?next=%2Fauth%2Frenew");
  const page = await b.go("/signin");
  assert.equal(page.status, 200);
  assert.match(page.text, /Sign in with GitHub/);
  assert.match(page.text, /href="\/auth\/login"/);
  assert.equal(seen.length, 0); // (GitHub was not asked anything)
});

test("the button sends the user to GitHub, and what comes back signs them in", async () => {
  const b = browser();
  const { sent, to, back } = await signIn(b);
  assert.equal(sent.status, 307);
  assert.equal(to.pathname, "/login/oauth/authorize");
  assert.equal(to.searchParams.get("client_id"), "Iv23liovowgVJASctV6s");
  assert.equal(to.searchParams.get("redirect_uri"), base + "/auth/callback");
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  assert.ok(to.searchParams.get("state").length >= 16 && to.searchParams.get("code_challenge").length === 43);
  assert.ok(!sent.to.includes("the-secret") && !sent.to.includes("secret="));
  // the cookies: not for scripts, and not sent along from other sites' forms
  assert.ok(sent.cookies.every((c) => /HttpOnly/i.test(c) && /SameSite=lax/i.test(c)));
  assert.equal(back.to, base + "/");
  assert.ok(b.jar.has("mdview") && !b.jar.has("mdview-signin"));
  assert.ok(back.cookies.find((c) => c.startsWith("mdview=")).match(/HttpOnly/i));
  assert.ok(!b.jar.get("mdview").includes("ghu_") && !b.jar.get("mdview").includes("octo")); // (sealed: nothing to read in it)
  const exchange = seen.find(([p, f]) => p === "/login/oauth/access_token" && f.code);
  assert.equal(exchange[1].client_secret, "the-secret");
  assert.equal(exchange[1].redirect_uri, base + "/auth/callback");
  // signed in: the repositories the app was given, by name, none chosen; and who is signed in
  const home = await b.go("/");
  assert.equal(home.status, 200);
  assert.ok(home.text.indexOf("octo/alpha-notes") > 0 && home.text.indexOf("octo/alpha-notes") < home.text.indexOf("octo/Zeta"));
  assert.match(home.text, /Octo Cat \(@octo\)/);
  assert.match(home.text, /href="\/r\/octo\/Zeta"/);
  assert.ok(!home.text.includes("ghu_") && !home.text.includes("ghr_")); // (no token in the page)
  assert.equal((await b.go("/r/octo/Zeta")).status, 200);
});

test("an answer that does not belong to the sign-in is not taken", async () => {
  const b = browser();
  // no sign-in under way
  assert.equal((await b.go("/auth/callback?code=the-code&state=x")).to, base + "/signin?why=expired");
  // another state
  await b.go("/auth/login");
  assert.equal((await b.go("/auth/callback?code=the-code&state=someone-elses")).to, base + "/signin?why=mismatch");
  assert.ok(!b.jar.has("mdview"));
  // the user said no at GitHub
  const sent = await b.go("/auth/login");
  assert.equal((await b.go(`/auth/callback?error=access_denied&state=${new URL(sent.to).searchParams.get("state")}`)).to, base + "/signin?why=denied");
  // a code GitHub does not take
  const again = await b.go("/auth/login");
  fakeGitHub.challenge = "another-challenge";
  assert.equal((await b.go(`/auth/callback?code=the-code&state=${new URL(again.to).searchParams.get("state")}`)).to, base + "/signin?why=github");
  assert.ok(!b.jar.has("mdview"));
  assert.match((await b.go("/signin?why=denied")).text, /was not allowed/);
});

test("after signing in the user is where they wanted to go — but never somewhere else", async () => {
  const b = browser();
  assert.equal((await signIn(b, "/r/octo/Zeta")).back.to, base + "/r/octo/Zeta");
  const c = browser();
  assert.equal((await signIn(c, "https://elsewhere.example/")).back.to, base + "/");
  const d = browser();
  assert.equal((await signIn(d, "//elsewhere.example/")).back.to, base + "/");
});

test("a token about to end is renewed, and the sign-in goes on", async () => {
  lifetime = 60; // (the next sign-in gets a token that is about to end)
  refreshes = 0;
  const b = browser();
  await signIn(b);
  lifetime = 28800;
  const was = b.jar.get("mdview"), first = validRefresh;
  const home = await b.go("/");
  assert.equal(home.to, base + "/auth/renew?next=%2F"); // (a page cannot write the cookie: the route does)
  const renewed = await b.go(home.to);
  assert.equal(renewed.to, base + "/");
  assert.notEqual(b.jar.get("mdview"), was);
  assert.equal(refreshes, 1);
  const renewal = seen.findLast(([p, f]) => p === "/login/oauth/access_token" && f.grant_type === "refresh_token");
  assert.deepEqual([renewal[1].refresh_token, renewal[1].client_secret], [first, "the-secret"]);
  assert.match((await b.go("/")).text, /octo\/Zeta/); // (with the new token)
  // two requests at once that still carry the old cookie renew once, not twice
  lifetime = 60; refreshes = 0;
  const e = browser();
  await signIn(e);
  lifetime = 28800;
  const [one, two] = await Promise.all([e.go("/auth/renew?next=/"), e.go("/auth/renew?next=/")]);
  assert.deepEqual([one.to, two.to, refreshes], [base + "/", base + "/", 1]);
});

test("a sign-in GitHub takes no more ends at the sign-in page; signing out forgets it", async () => {
  lifetime = 60; refreshes = 0;
  const b = browser();
  await signIn(b);
  lifetime = 28800;
  validRefresh = "none"; // (the token that renews is not GitHub's any more)
  const over = await b.go("/auth/renew?next=/");
  assert.equal(over.to, base + "/signin?why=over");
  assert.ok(!b.jar.has("mdview"));
  const c = browser();
  await signIn(c);
  assert.equal((await c.go("/auth/logout")).status, 405); // (not by a link)
  const out = await c.go("/auth/logout", { method: "POST" });
  assert.deepEqual([out.status, out.to], [303, base + "/signin"]);
  assert.ok(!c.jar.has("mdview"));
  assert.equal((await c.go("/")).to, base + "/signin");
});

test("a cookie that is not the app's own is no session", async () => {
  const b = browser();
  b.jar.set("mdview", "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..made.up.cookie");
  assert.equal((await b.go("/")).to, base + "/signin"); // (past the gate, which only sees that there is one — and no further)
  assert.equal((await b.go("/auth/renew?next=/")).to, base + "/signin?why=over");
});
