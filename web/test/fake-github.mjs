// A GitHub of the tests' own: signing in (the web flow and renewing), who a token is, the
// repositories the app was given, and one repository's files — whatever is in `repo.files`
// (path → Buffer) at the moment, as a commit that changes whenever the files do.
import { createVerify, createHash } from "node:crypto";
import { createServer } from "node:http";

export function fakeGitHub() {
  const gh = {
    slow: 0, // how long every answer takes, in ms
    seen: [], // what it was asked: [path, form or the Authorization header]
    lifetime: 28800, refreshes: 0, serial: 0, validAccess: "", validRefresh: "", challenge: "",
    repo: { owner: "octo", name: "notes", files: new Map(), private: true },
    blobs: new Map(),
    past: [], // the repository as every commit seen had it: { oid, message, time, files }, oldest first
    projects: ["octo/alpha-notes"], projectsFail: false, // (which of the listed repositories hold the app's folder; whether that can be told at all)
    appKey: null, installed: true, appToken: "", appTokens: new Set(), appAsked: [], // the app as itself: its public key, whether it is installed on the repository, the token it was given, what it asked for
    commits: [], // the commits made here: { headline, body, added: [paths], deleted: [paths], by } — linked: [paths] where blobs it has were named, not sent
    stall: null, // a promise the next commit waits for before it answers (a GitHub that takes its time over one thing)
    refuse: 0, // the status the next commit is refused with
    trees: new Map(), made: new Map(), // the Git database: trees and commits built and not on the branch yet
  };
  const blobSha = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  const stateSha = (salt, files = gh.repo.files) => createHash("sha1").update(salt + [...files].map(([p, b]) => p + blobSha(b)).sort().join("\n")).digest("hex");
  gh.head = () => stateSha("commit");
  // (the files are also changed behind the app's back, as another device would: whenever the
  // repository is looked at, how it stands is written down as a commit, if it is not one yet)
  const note = (message, by) => { const oid = gh.head(); if (!gh.past.some((c) => c.oid === oid)) gh.past.push({ oid, message, by: by || "Other", time: 1790000000 + gh.past.length * 60, files: new Map(gh.repo.files) }); return gh.past.find((c) => c.oid === oid); };
  gh.note = note;
  const before = (c) => gh.past[gh.past.indexOf(c) - 1];
  // (as GitHub tells a commit's files: one that is gone under one name and there, the same, under another was renamed)
  const changed = (c) => {
    const was = before(c) ? before(c).files : new Map(), same = (a, b) => a && b && blobSha(a) === blobSha(b);
    const gone = [...was.keys()].filter((p) => !c.files.has(p));
    return [...c.files].filter(([p, b]) => !same(was.get(p), b)).map(([p, b]) => { const old = !was.has(p) && gone.find((g) => same(was.get(g), b)); return old ? { filename: p, status: "renamed", previous_filename: old } : { filename: p, status: was.has(p) ? "modified" : "added" }; });
  };
  const asCommit = (c) => ({ sha: c.oid, parents: before(c) ? [{ sha: before(c).oid }] : [], commit: { message: c.message, tree: { sha: stateSha("tree") }, author: { name: c.by, date: new Date(c.time * 1000).toISOString() } } });
  gh.blobSha = blobSha;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => answer().catch((e) => { console.error("fake GitHub:", req.method, req.url, e); if (!res.headersSent) res.writeHead(500); res.end(); })); // (a slip in here is said, not a request left hanging)
    const answer = async () => {
      if (gh.slow) await new Promise((r) => setTimeout(r, gh.slow)); // (a GitHub that takes its time)
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
      const bearer = (req.headers.authorization || "").replace("Bearer ", "");
      // the app as itself: it says who it is, signed with its key, and gets a token for one repository
      if (/^\/repos\/[^/]+\/[^/]+\/installation$/.test(url.pathname) || url.pathname === "/app/installations/7/access_tokens" || url.pathname === "/app/installations") {
        const [h, p, sig] = bearer.split("."), claims = (() => { try { return JSON.parse(Buffer.from(p, "base64url")); } catch { return {}; } })();
        const signed = !!gh.appKey && !!sig && createVerify("RSA-SHA256").update(`${h}.${p}`).verify(gh.appKey, Buffer.from(sig, "base64url"));
        if (!signed || claims.iss !== "Iv23liovowgVJASctV6s" || claims.exp < Date.now() / 1000 || claims.exp - claims.iat > 660) return json({ message: "A JSON web token could not be decoded" }, 401);
        if (!gh.installed || (url.pathname.startsWith("/repos/") && url.pathname !== `/repos/${gh.repo.owner}/${gh.repo.name}/installation`)) return json({ message: "Not Found" }, 404);
        if (url.pathname === "/app/installations") return json([{ id: 7 }]);
        if (url.pathname.startsWith("/repos/")) return json({ id: 7 });
        const asked = JSON.parse(body || "{}");
        gh.appAsked.push(asked);
        gh.appToken = `ghs_${++gh.serial}`;
        gh.appTokens.add(gh.appToken); // (each holds for its hour)
        return json({ token: gh.appToken, expires_at: new Date(Date.now() + 3600e3).toISOString() }, 201);
      }
      if (bearer !== gh.validAccess && !gh.appTokens.has(bearer)) return json({ message: "Bad credentials" }, 401);
      const { owner, name, files } = gh.repo, at = `/repos/${owner}/${name}`;
      if (url.pathname === "/installation/repositories") return json({ repositories: [{ name: name, owner: { login: owner } }, { name: "Zeta", owner: { login: owner } }] }); // (as the app itself: where it is installed)
      if (url.pathname === "/user") return json({ login: "octo", name: "Octo Cat", id: 42 });
      if (url.pathname === "/user/installations") return json({ installations: gh.installed === false ? [] : [{ id: 7, html_url: "https://github.com/settings/installations/7", repository_selection: gh.selection || "selected", account: { login: "octo" } }] });
      // (a repository nothing was pushed to: its first file, put there by itself, makes the branch)
      if (req.method === "PUT" && url.pathname.startsWith(`${at}/contents/`)) {
        if (files.size) return json({ message: "Invalid request: sha wasn't supplied" }, 422);
        const put = JSON.parse(body), path = decodeURIComponent(url.pathname.slice(`${at}/contents/`.length));
        files.set(path, Buffer.from(put.content, "base64"));
        note(put.message, "Octo Cat");
        gh.commits.push({ headline: put.message.split("\n")[0], body: put.message.split("\n").slice(2).join("\n"), added: [path], deleted: [], by: "octo", first: true });
        return json({ commit: { sha: gh.head() } }, 201);
      }
      if (url.pathname === "/user/installations/7/repositories" && gh.listed) return json({ repositories: gh.listed });
      if (url.pathname === "/user/installations/7/repositories") return json({ repositories: [
        { full_name: "octo/Zeta", private: true, default_branch: "main", description: null, pushed_at: "2020-01-01T00:00:00Z" },
        { full_name: "octo/alpha-notes", private: false, default_branch: "trunk", description: "Lecture notes", pushed_at: new Date(Date.now() - 3 * 86400000).toISOString() } ] });
      if (url.pathname === at) return json({ default_branch: "main", private: gh.repo.private });
      if (url.pathname === `${at}/commits/main`) return files.size ? json(asCommit(note("written elsewhere"))) : json({ message: "Git Repository is empty." }, 409);
      if (url.pathname === `${at}/commits`) { // (the commits in which a file is not what it was before)
        note("written elsewhere");
        if (!url.searchParams.has("path")) { // (all of them, a page at a time: the header names the last page)
          const per = Number(url.searchParams.get("per_page")) || 30, at = Number(url.searchParams.get("page")) || 1, pages = Math.ceil(gh.past.length / per);
          return json([...gh.past].reverse().slice((at - 1) * per, at * per).map(asCommit), 200, pages > 1 && at < pages ? { Link: `<http://x${url.pathname}?per_page=${per}&page=${at + 1}>; rel="next", <http://x${url.pathname}?per_page=${per}&page=${pages}>; rel="last"` } : {});
        }
        const path = url.searchParams.get("path"), id = (c) => { const b = c.files.get(path); return b ? blobSha(b) : null; };
        const from = url.searchParams.get("sha"), upTo = from ? gh.past.findIndex((c) => c.oid === from) + 1 : gh.past.length;
        return json(gh.past.slice(0, upTo).filter((c, i) => id(c) && id(c) !== (i ? id(gh.past[i - 1]) : null)).reverse().map(asCommit));
      }
      if (url.pathname.startsWith(`${at}/commits/`)) {
        const c = gh.past.find((c) => c.oid === url.pathname.slice(`${at}/commits/`.length));
        return c ? json({ ...asCommit(c), files: changed(c) }) : json({ message: "Not Found" }, 404);
      }
      if (url.pathname === `${at}/git/trees/${stateSha("tree")}`) {
        for (const buf of files.values()) gh.blobs.set(blobSha(buf), buf); // (a blob once in a commit stays to be had)
        const tree = [...files].map(([path, buf]) => ({ path, type: "blob", sha: blobSha(buf), size: buf.length }));
        const dirs = new Set(tree.flatMap((e) => e.path.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
        return json({ tree: [...tree, ...[...dirs].map((path) => ({ path, type: "tree", sha: "0".repeat(40) }))], truncated: false });
      }
      // the Git database: a blob kept, a tree on top of another, a commit of it, and the branch moved to that — if it is a step forward
      if (url.pathname.startsWith(`${at}/git/commits/`) && req.method === "GET") {
        const c = (note("written elsewhere"), gh.past.find((c) => c.oid === url.pathname.slice(`${at}/git/commits/`.length)));
        return c ? json({ sha: c.oid, tree: { sha: stateSha("tree", c.files) } }) : json({ message: "Not Found" }, 404);
      }
      if (url.pathname === `${at}/git/blobs` && req.method === "POST") {
        const buf = Buffer.from(JSON.parse(body).content, "base64"), sha = blobSha(buf);
        gh.blobs.set(sha, buf);
        return json({ sha }, 201);
      }
      if (url.pathname === `${at}/git/trees` && req.method === "POST") {
        const asked = JSON.parse(body), on = [...gh.past].reverse().find((c) => stateSha("tree", c.files) === asked.base_tree);
        if (!on) return json({ message: "base_tree is not a valid tree oid" }, 422);
        for (const buf of gh.repo.files.values()) gh.blobs.set(blobSha(buf), buf);
        const next = new Map(on.files), changed = { linked: [], deleted: [] };
        for (const e of asked.tree) {
          if (e.sha === null) { if (!next.delete(e.path)) return json({ message: "GitRPC::BadObjectState" }, 422); changed.deleted.push(e.path); continue; }
          if (!gh.blobs.has(e.sha)) return json({ message: "tree.sha " + e.sha + " is not a valid blob" }, 422);
          next.set(e.path, gh.blobs.get(e.sha));
          changed.linked.push(e.path);
        }
        const sha = stateSha("tree", next);
        gh.trees.set(sha, { files: next, ...changed });
        return json({ sha }, 201);
      }
      if (url.pathname === `${at}/git/commits` && req.method === "POST") {
        const asked = JSON.parse(body), tree = gh.trees.get(asked.tree);
        if (!tree) return json({ message: "Tree SHA is not a tree object" }, 422);
        const sha = stateSha("commit", tree.files);
        gh.made.set(sha, { ...tree, message: asked.message, parent: asked.parents[0] });
        return json({ sha }, 201);
      }
      if (url.pathname === `${at}/git/refs/heads/main` && req.method === "PATCH") {
        const asked = JSON.parse(body), c = gh.made.get(asked.sha);
        if (gh.stall) { const wait = gh.stall; gh.stall = null; await wait; }
        if (gh.refuse) { const status = gh.refuse; gh.refuse = 0; return json({ message: "refused" }, status); }
        if (!c) return json({ message: "Object does not exist" }, 422);
        if (c.parent !== gh.head()) return json({ message: "Update is not a fast forward" }, 422);
        files.clear();
        for (const [p, b] of c.files) files.set(p, b);
        note(c.message, "Octo Cat");
        gh.commits.push({ headline: c.message.split("\n")[0], body: c.message.split("\n").slice(2).join("\n"), added: c.linked, deleted: c.deleted, linked: c.linked, by: "octo" });
        return json({ ref: "refs/heads/main", object: { sha: asked.sha } });
      }
      if (url.pathname === "/graphql" && JSON.parse(body).query.includes("createCommitOnBranch")) {
        const { input } = JSON.parse(body).variables;
        if (gh.stall) { const wait = gh.stall; gh.stall = null; await wait; }
        if (gh.refuse) { const status = gh.refuse; gh.refuse = 0; return json({ message: "refused" }, status); }
        if (input.branch.repositoryNameWithOwner !== `${owner}/${name}` || input.branch.branchName !== "main") return json({ errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
        if (input.expectedHeadOid !== gh.head()) return json({ errors: [{ type: "STALE_DATA", message: `Expected branch to point to "${gh.head()}" but it did not. Pull and try again.` }] });
        for (const buf of files.values()) gh.blobs.set(blobSha(buf), buf);
        for (const a of input.fileChanges.additions || []) files.set(a.path, Buffer.from(a.contents, "base64"));
        for (const d of input.fileChanges.deletions || []) files.delete(d.path);
        note(input.message.headline + "\n\n" + input.message.body, "Octo Cat");
        gh.commits.push({ headline: input.message.headline, body: input.message.body, added: (input.fileChanges.additions || []).map((a) => a.path), deleted: (input.fileChanges.deletions || []).map((d) => d.path), by: "octo" });
        return json({ data: { createCommitOnBranch: { commit: { oid: gh.head() } } } });
      }
      if (url.pathname === "/graphql" && JSON.parse(body).query.includes("history(first: 1")) { // (when each path was last changed, up to a commit)
        const { query, variables } = JSON.parse(body), object = {};
        note("written elsewhere");
        const upTo = gh.past.findIndex((c) => c.oid === variables.oid), id = (c, p) => { const b = c && c.files.get(p); return b ? blobSha(b) : null; };
        for (const m of query.matchAll(/(p\d+): history\(first: 1, path: ("(?:[^"\\]|\\.)*")\)/g)) {
          const path = JSON.parse(m[2]);
          let i = upTo;
          while (i > 0 && id(gh.past[i], path) === id(gh.past[i - 1], path)) i--;
          object[m[1]] = { nodes: upTo >= 0 && id(gh.past[i], path) ? [{ committedDate: new Date(gh.past[i].time * 1000).toISOString() }] : [] };
        }
        return json({ data: { repository: { object: upTo >= 0 ? object : null } } });
      }
      if (url.pathname === "/graphql" && JSON.parse(body).query.includes(".mdview/project.json")) { // (which repositories are projects: those with the marker)
        const data = {};
        for (const m of JSON.parse(body).query.matchAll(/(r\d+): repository\(owner: "([^"]*)", name: "([^"]*)"\)/g)) {
          const full = `${m[2]}/${m[3]}`;
          data[m[1]] = { object: gh.projects.includes(full) || (full === `${owner}/${name}` && files.has(".mdview/project.json")) ? { __typename: "Blob" } : null };
        }
        return gh.projectsFail ? json({ message: "no" }, 502) : json({ data });
      }
      if (url.pathname === "/graphql") {
        const q = JSON.parse(body).query, repository = {};
        for (const m of q.matchAll(/(b\d+): object\(oid: "([0-9a-f]+)"\)/g)) {
          const hit = [...files.values()].find((b) => blobSha(b) === m[2]) || gh.blobs.get(m[2]);
          const binary = hit && hit.includes(0);
          repository[m[1]] = hit ? { text: binary ? null : hit.toString("utf8"), isBinary: !!binary, isTruncated: false } : null;
        }
        return json({ data: { repository } });
      }
      if (url.pathname.startsWith(`${at}/contents/`)) {
        const ref = url.searchParams.get("ref"), then = ref ? (gh.past.find((c) => c.oid === ref) || { files: new Map() }).files : files;
        const buf = then.get(decodeURIComponent(url.pathname.slice(`${at}/contents/`.length)));
        if (!buf) return json({ message: "Not Found" }, 404);
        const etag = `"${blobSha(buf)}"`;
        if (req.headers["if-none-match"] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
        res.writeHead(200, { "Content-Type": "application/vnd.github.raw+json", ETag: etag });
        return res.end(buf);
      }
      json({ message: "Not Found" }, 404);
    };
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
