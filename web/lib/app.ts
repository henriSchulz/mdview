// The GitHub App acting as itself, not as a user: for a note that was shared, read by someone who
// is not signed in. The app signs a short-lived statement of who it is with its private key and
// gets, for one repository it is installed on, a token that can only read what is in it.
// Server only. Without the key (GITHUB_APP_PRIVATE_KEY) nothing is shared from here.
import { createPrivateKey, type KeyObject } from "node:crypto";
import { SignJWT } from "jose";
import { CLIENT_ID } from "./github";

const API = process.env.GITHUB_API || "https://api.github.com";

let key: KeyObject | null | undefined;
function privateKey(): KeyObject | null {
  if (key !== undefined) return key;
  const pem = (process.env.GITHUB_APP_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(); // (a secret kept on one line has its line ends written out)
  try { key = pem ? createPrivateKey(pem) : null; } catch { key = null; }
  return key;
}

/** Whether notes can be shared from this server at all. */
export const sharing = () => !!privateKey();

const tokens = new Map<string, { token: string; until: number }>(); // "owner/repo" → a token that still holds

/** A token that reads one repository, as the app. null: sharing is not set up, or the app is not
 * installed on that repository (any more). */
export async function repoToken(owner: string, repo: string): Promise<string | null> {
  const k = privateKey();
  if (!k) return null;
  const name = `${owner}/${repo}`.toLowerCase(), now = Math.floor(Date.now() / 1000), had = tokens.get(name);
  if (had && had.until - now > 300) return had.token;
  // (the client id is who the app is; a little in the past, for a clock that runs ahead of GitHub's)
  const jwt = await new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setIssuer(CLIENT_ID).setIssuedAt(now - 60).setExpirationTime(now + 540).sign(k);
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "User-Agent": "mdview-web", "X-GitHub-Api-Version": "2022-11-28" };
  const where = await fetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`, { headers, cache: "no-store" });
  if (where.status === 404) return null;
  if (!where.ok) throw new Error(`GitHub: ${where.status} for the installation`);
  const { id } = (await where.json()) as { id: number };
  const made = await fetch(`${API}/app/installations/${id}/access_tokens`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ repositories: [repo], permissions: { contents: "read" } }), cache: "no-store" });
  if (!made.ok) throw new Error(`GitHub: ${made.status} for the token`);
  const said = (await made.json()) as { token: string; expires_at: string };
  tokens.set(name, { token: said.token, until: Math.floor(Date.parse(said.expires_at) / 1000) || now + 3000 });
  return said.token;
}
