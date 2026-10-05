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

/** Where the user says which repositories the app is given. */
export const GIVE = "https://github.com/settings/installations";
