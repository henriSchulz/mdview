// A GitHub of the tests' own: signing in (the web flow and renewing), who a token is, the
// repositories the app was given, and one repository's files — whatever is in `repo.files`
// (path → Buffer) at the moment, as a commit that changes whenever the files do.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

export function fakeGitHub() {
  const gh = {
    seen: [], // what it was asked: [path, form or the Authorization header]
    lifetime: 28800, refreshes: 0, serial: 0, validAccess: "", validRefresh: "", challenge: "",
    repo: { owner: "octo", name: "notes", files: new Map(), private: true },
  };
  const blobSha = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  const stateSha = (salt) => createHash("sha1").update(salt + [...gh.repo.files].map(([p, b]) => p + blobSha(b)).sort().join("\n")).digest("hex");
  gh.head = () => stateSha("commit");
  gh.blobSha = blobSha;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x"), form = new URLSearchParams(body);
      const json = (data, status = 200, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(data)); };
      gh.seen.push([url.pathname, req.method === "POST" && url.pathname !== "/graphql" ? Object.fromEntries(form) : req.headers.authorization || ""]);
      if (url.pathname === "/login/oauth/access_token") {
        if (form.get("client_secret") !== "the-secret") return json({ error: "incorrect_client_credentials" });
        if (form.get("grant_type") === "refresh_token") {
          if (form.get("refresh_token") !== gh.validRefresh) return json({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." });
          gh.refreshes++; gh.serial++;
          [gh.validAccess, gh.validRefresh] = [`ghu_${gh.serial}`, `ghr_${gh.serial}`];
          return json({ access_token: gh.validAccess, expires_in: 28800, refresh_token: gh.validRefresh, refresh_token_expires_in: 15897600 });
        }
        // the code is only good with the verifier whose challenge the user was sent to GitHub with
        const ok = form.get("code") === "the-code" && createHash("sha256").update(form.get("code_verifier") || "").digest("base64url") === gh.challenge;
        if (!ok) return json({ error: "bad_verification_code" });
        gh.serial++;
        [gh.validAccess, gh.validRefresh] = [`ghu_${gh.serial}`, `ghr_${gh.serial}`];
        return json({ access_token: gh.validAccess, expires_in: gh.lifetime, refresh_token: gh.validRefresh, refresh_token_expires_in: 15897600 });
      }
      if ((req.headers.authorization || "").replace("Bearer ", "") !== gh.validAccess) return json({ message: "Bad credentials" }, 401);
      const { owner, name, files } = gh.repo, at = `/repos/${owner}/${name}`;
      if (url.pathname === "/user") return json({ login: "octo", name: "Octo Cat", id: 42 });
      if (url.pathname === "/user/installations") return json({ installations: [{ id: 7 }] });
      if (url.pathname === "/user/installations/7/repositories") return json({ repositories: [
        { full_name: "octo/Zeta", private: true, default_branch: "main" }, { full_name: "octo/alpha-notes", private: false, default_branch: "trunk" } ] });
      if (url.pathname === at) return json({ default_branch: "main", private: gh.repo.private });
      if (url.pathname === `${at}/commits/main`) return files.size ? json({ sha: gh.head(), commit: { tree: { sha: stateSha("tree") } } }) : json({ message: "Git Repository is empty." }, 409);
      if (url.pathname === `${at}/git/trees/${stateSha("tree")}`) {
        const tree = [...files].map(([path, buf]) => ({ path, type: "blob", sha: blobSha(buf), size: buf.length }));
        const dirs = new Set(tree.flatMap((e) => e.path.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
        return json({ tree: [...tree, ...[...dirs].map((path) => ({ path, type: "tree", sha: "0".repeat(40) }))], truncated: false });
      }
      if (url.pathname === "/graphql") {
        const q = JSON.parse(body).query, repository = {};
        for (const m of q.matchAll(/(b\d+): object\(oid: "([0-9a-f]+)"\)/g)) {
          const hit = [...files.values()].find((b) => blobSha(b) === m[2]);
          const binary = hit && hit.includes(0);
          repository[m[1]] = hit ? { text: binary ? null : hit.toString("utf8"), isBinary: !!binary, isTruncated: false } : null;
        }
        return json({ data: { repository } });
      }
      if (url.pathname.startsWith(`${at}/contents/`)) {
        const buf = files.get(decodeURIComponent(url.pathname.slice(`${at}/contents/`.length)));
        if (!buf) return json({ message: "Not Found" }, 404);
        const etag = `"${blobSha(buf)}"`;
        if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
        res.writeHead(200, { "Content-Type": "application/vnd.github.raw+json", ETag: etag });
        return res.end(buf);
      }
      json({ message: "Not Found" }, 404);
    });
  });
  gh.listen = () => new Promise((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
  gh.close = () => server.close();
  return gh;
}

/** A free port. */
export async function freePort() {
  const probe = createServer();
  const port = await new Promise((r) => probe.listen(0, "127.0.0.1", () => r(probe.address().port)));
  await new Promise((r) => probe.close(r));
  return port;
}
