// GitHub, as the web app speaks to it: signing in (the GitHub App's web flow — the user is sent
// to GitHub and comes back with a code, which the server exchanges for a token, with the app's
// secret), and what a token can read. Server only: the secret and the tokens never reach the page.

export const CLIENT_ID = "Iv23liovowgVJASctV6s"; // (the GitHub App "mdview" of @henriSchulz; not a secret)

// (the tests have a GitHub of their own)
const WEB = process.env.GITHUB_WEB || "https://github.com";
const API = process.env.GITHUB_API || "https://api.github.com";

export type Tokens = { access: string; expires: number; refresh: string; refreshExpires: number };
export type User = { login: string; name: string; id: number };
export type Repo = { name: string; private: boolean; branch: string };

const now = () => Math.floor(Date.now() / 1000);

function secret(): string {
  const s = process.env.GITHUB_CLIENT_SECRET;
  if (!s) throw new Error("GITHUB_CLIENT_SECRET is not set");
  return s;
}

/** Where the user is sent to sign in. state comes back unchanged; challenge is PKCE's (S256). */
export function authorizeUrl(redirect: string, state: string, challenge: string): string {
  const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirect, state, code_challenge: challenge, code_challenge_method: "S256" });
  return `${WEB}/login/oauth/authorize?${q}`;
}

async function token(fields: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${WEB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: secret(), ...fields }),
    cache: "no-store",
  });
  const said = (await res.json()) as Record<string, unknown>;
  if (typeof said.access_token !== "string") throw new Refused(String(said.error_description || said.error || "GitHub said no"));
  return {
    access: said.access_token,
    expires: now() + (Number(said.expires_in) || 8 * 3600),
    refresh: typeof said.refresh_token === "string" ? said.refresh_token : "",
    refreshExpires: now() + (Number(said.refresh_token_expires_in) || 180 * 24 * 3600),
  };
}

/** GitHub answered, and the answer was no (a code or token it does not take): signing in anew is the way on. */
export class Refused extends Error {}

/** The code GitHub sent the user back with, for tokens. */
export const exchange = (code: string, redirect: string, verifier: string) => token({ code, redirect_uri: redirect, code_verifier: verifier });

/** New tokens for the one that renews. It changes with every use: the old one is void afterwards. */
export const renew = (refresh: string) => token({ grant_type: "refresh_token", refresh_token: refresh });

async function get<T>(access: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${access}`, "User-Agent": "mdview-web", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (res.status === 401) throw new Refused("GitHub does not take the token any more");
  if (!res.ok) throw new Error(`GitHub: ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Who a token is. */
export async function user(access: string): Promise<User> {
  const who = await get<{ login: string; name: string | null; id: number }>(access, "/user");
  return { login: who.login, name: who.name || "", id: who.id };
}

const PAGE = 100; // repositories asked for at a time
const PAGES = 5; // … and how often, at most, for one installation

/** The repositories the user can reach through the app: those the app was given on every account
 * it is installed on. By name. */
export async function repositories(access: string): Promise<Repo[]> {
  const installed = await get<{ installations: { id: number }[] }>(access, `/user/installations?per_page=${PAGE}`);
  const all: Repo[] = [];
  for (const { id } of installed.installations || []) {
    for (let page = 1; page <= PAGES; page++) {
      const got = await get<{ repositories: { full_name: string; private: boolean; default_branch: string }[] }>(access, `/user/installations/${id}/repositories?per_page=${PAGE}&page=${page}`);
      const repos = got.repositories || [];
      for (const r of repos) all.push({ name: r.full_name, private: !!r.private, branch: r.default_branch || "main" });
      if (repos.length < PAGE) break;
    }
  }
  return all.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

export type Entry = { path: string; sha: string; size: number };
export type Tip = { device: string; time: number }; // who made the commit the branch stands at (the device it names, else its author), and when
export type State = { empty: true } | { empty: false; branch: string; head: string; private: boolean; tree: Entry[]; truncated: boolean; tip: Tip };
export type Version = { id: string; time: number; device: string; subject: string; path: string };

type CommitJson = { sha: string; commit: { message: string; tree: { sha: string }; author: { name: string; date: string } | null } };
/** The device a commit's message names (its "Device:" trailer), else its author. */
const deviceOf = (c: CommitJson) => /^Device: (.+)$/m.exec(c.commit.message || "")?.[1].trim() || c.commit.author?.name || "";
const timeOf = (c: CommitJson) => Math.floor(Date.parse(c.commit.author?.date || "") / 1000) || 0;

const part = (s: string) => encodeURIComponent(s);
const repoPath = (owner: string, repo: string) => `/repos/${part(owner)}/${part(repo)}`;

/** A request that may be answered with "not there" or "nothing in it yet" without that being an error. */
async function ask(access: string, path: string, accept = "application/vnd.github+json", more: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: accept, Authorization: `Bearer ${access}`, "User-Agent": "mdview-web", "X-GitHub-Api-Version": "2022-11-28", ...more }, cache: "no-store" });
  if (res.status === 401) throw new Refused("GitHub does not take the token any more");
  return res;
}

/** A repository as it is now: the commit its branch stands at, and every file in it (path, the
 * blob's id, size). empty: nothing was ever pushed. null: not there, or not the app's to see. */
export async function state(access: string, owner: string, repo: string): Promise<State | null> {
  const about = await ask(access, repoPath(owner, repo));
  if (!about.ok) return null;
  const info = (await about.json()) as { default_branch: string; private: boolean };
  const tip = await ask(access, `${repoPath(owner, repo)}/commits/${part(info.default_branch)}`);
  if (tip.status === 409 || tip.status === 404) return { empty: true }; // (GitHub: "Git Repository is empty")
  if (!tip.ok) throw new Error(`GitHub: ${tip.status} for the branch`);
  const commit = (await tip.json()) as CommitJson;
  const listed = await ask(access, `${repoPath(owner, repo)}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (!listed.ok) throw new Error(`GitHub: ${listed.status} for the tree`);
  const all = (await listed.json()) as { tree: { path: string; type: string; sha: string; size?: number }[]; truncated: boolean };
  const tree = all.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, sha: e.sha, size: e.size || 0 }));
  return { empty: false, branch: info.default_branch, head: commit.sha, private: !!info.private, tree, truncated: !!all.truncated, tip: { device: deviceOf(commit), time: timeOf(commit) } };
}

const BATCH = 80; // blobs asked for in one question

/** The text of blobs, by their ids: many in one question (GraphQL). null for one that is not
 * text, is too large to be handed out this way, or is not there. */
export async function texts(access: string, owner: string, repo: string, shas: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const ids = [...new Set(shas)].filter((s) => /^[0-9a-f]{40,64}$/.test(s));
  for (let i = 0; i < ids.length; i += BATCH) {
    const some = ids.slice(i, i + BATCH);
    const fields = some.map((sha, n) => `b${n}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`).join(" ");
    const res = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "User-Agent": "mdview-web" },
      body: JSON.stringify({ query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`, variables: { owner, name: repo } }),
      cache: "no-store",
    });
    if (res.status === 401) throw new Refused("GitHub does not take the token any more");
    if (!res.ok) throw new Error(`GitHub: ${res.status} for the texts`);
    const said = (await res.json()) as { data?: { repository?: Record<string, { text: string | null; isBinary: boolean | null; isTruncated: boolean } | null> } };
    const got = said.data?.repository || {};
    some.forEach((sha, n) => {
      const b = got[`b${n}`];
      out[sha] = b && !b.isBinary && !b.isTruncated && typeof b.text === "string" ? b.text : null;
    });
  }
  return out;
}

/** A file of the repository as it is on its branch now, as bytes (pictures, PDFs, and a note too
 * large for texts). The answer is GitHub's own: its status, its ETag. */
export function raw(access: string, owner: string, repo: string, path: string, etag?: string | null, ref?: string): Promise<Response> {
  const at = path.split("/").map(part).join("/");
  return ask(access, `${repoPath(owner, repo)}/contents/${at}${ref ? `?ref=${part(ref)}` : ""}`, "application/vnd.github.raw+json", etag ? { "If-None-Match": etag } : {});
}

/** The versions of a file: the commits that changed it, newest first. (GitHub does not follow a
 * file through a renaming: they end where it got its name.) */
export async function versions(access: string, owner: string, repo: string, path: string): Promise<Version[]> {
  const res = await ask(access, `${repoPath(owner, repo)}/commits?path=${part(path)}&per_page=100`);
  if (!res.ok) return [];
  return ((await res.json()) as CommitJson[]).map((c) => ({ id: c.sha, time: timeOf(c), device: deviceOf(c), subject: (c.commit.message || "").split("\n")[0], path }));
}

/** The branch stands elsewhere than the commit was made for: someone wrote meanwhile. */
export class Moved extends Error {}

export type Change = { additions: { path: string; contents: string }[]; deletions: string[] }; // (contents: base64)

/** One commit on a branch, with files added (or replaced) and deleted — only if the branch still
 * stands at `expect`. The author is whom the token belongs to; GitHub signs it. → the new commit. */
export async function commit(access: string, owner: string, repo: string, branch: string, expect: string, headline: string, body: string, change: Change): Promise<string> {
  const input = {
    branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: branch },
    expectedHeadOid: expect,
    message: { headline, body },
    fileChanges: { additions: change.additions, deletions: change.deletions.map((path) => ({ path })) },
  };
  const res = await fetch(`${API}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "User-Agent": "mdview-web" },
    body: JSON.stringify({ query: "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }", variables: { input } }),
    cache: "no-store",
  });
  if (res.status === 401) throw new Refused("GitHub does not take the token any more");
  if (!res.ok) throw new Error(`GitHub: ${res.status} for the commit`);
  const said = (await res.json()) as { data?: { createCommitOnBranch?: { commit?: { oid?: string } } }; errors?: { type?: string; message?: string }[] };
  const oid = said.data?.createCommitOnBranch?.commit?.oid;
  if (oid) return oid;
  const why = said.errors?.[0];
  if (why?.type === "STALE_DATA" || /expected (branch|head)|did not match|but it did not/i.test(why?.message || "")) throw new Moved(why?.message || "the branch moved");
  throw new Error(why?.message || "GitHub did not make the commit");
}

/** Where the user says which repositories the app is given. */
export const GIVE = "https://github.com/settings/installations";
