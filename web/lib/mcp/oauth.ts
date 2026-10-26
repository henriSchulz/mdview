// Signing a client of the Model Context Protocol in — Claude, Claude Code, any other: OAuth 2.1 as
// the protocol asks for it (a client registers itself, then the user is sent here, says yes, and
// the client gets a code for its tokens, PKCE throughout). GitHub cannot be that server itself (no
// registration of clients), so the app is: the user signs in with GitHub once more, for tokens of
// the client's own — never the browser's, whose renewing token would be voided by the client's
// renewing and the browser signed out (lib/session.ts: it changes with every use).
//
// Nothing is kept on the server: a client's id, a code, the tokens are sealed (lib/session.ts),
// each with what it is for, so one is never taken for another or for a session.
import { createHash } from "node:crypto";
import { Refused, renew, type Tokens, type User } from "../github";
import { seal, unseal } from "../session";

export const SCOPE = "notes";
const CLIENT_LIFE = 10 * 365 * 24 * 3600; // a registration: as good as for ever
const CODE_LIFE = 120; // a code, from the user's yes to the client's question for its tokens
export const PENDING_LIFE = 600; // the user at GitHub

/** A client as it registered: its name and where it may be sent back to. */
export type Client = { name: string; redirects: string[] };
/** What the user said yes to, carried to GitHub and back. */
export type Grant = { client: string; redirect: string; state: string; challenge: string };
type Code = { use: "mcp-code"; client: string; redirect: string; challenge: string; gh: Tokens; who: User };
type Access = { use: "mcp-access"; client: string; aud: string; access: string; who: User };
type Refresh = { use: "mcp-refresh"; client: string; aud: string; refresh: string; who: User };

/** The address of the protocol's endpoint: what a token is for (RFC 8707's resource). */
export const resourceOf = (origin: string) => `${origin}/mcp`;

const isLoopback = (u: URL) => u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]");

/** A place a client may be sent back to: https, or a loopback address (a program on the user's own computer). */
export function goodRedirect(s: unknown): s is string {
  if (typeof s !== "string" || s.length > 2000) return false;
  try {
    const u = new URL(s);
    return !u.hash && (u.protocol === "https:" || isLoopback(u));
  } catch {
    return false;
  }
}

/** Whether `asked` is one of the client's places. A loopback address matches whatever its port (RFC 8252 §7.3:
 * a program on the computer takes the port it is given at the moment). */
export function redirectOf(client: Client, asked: string): boolean {
  let a: URL;
  try { a = new URL(asked); } catch { return false; }
  return client.redirects.some((r) => {
    if (r === asked) return true;
    const b = new URL(r);
    return isLoopback(a) && isLoopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  });
}

export const clientId = (c: Client) => seal({ use: "mcp-client", ...c }, CLIENT_LIFE);
export async function clientOf(id: string | null | undefined): Promise<Client | null> {
  const c = await unseal<Client & { use: string }>(id || undefined);
  return c && c.use === "mcp-client" && Array.isArray(c.redirects) ? { name: String(c.name || ""), redirects: c.redirects } : null;
}

// (a code is good once: those taken are remembered until they would have ended anyway — the app runs as one instance, apphosting.yaml)
const taken = new Map<string, number>();

export const codeFor = (grant: Grant, gh: Tokens, who: User) => seal({ use: "mcp-code", client: grant.client, redirect: grant.redirect, challenge: grant.challenge, gh, who } satisfies Code, CODE_LIFE);

/** The tokens for a code — only once, only for the client it was given to, sent back to the same place, with the verifier of its challenge. */
export async function redeem(code: string, client: string, redirect: string, verifier: string): Promise<{ gh: Tokens; who: User } | null> {
  const now = Date.now();
  for (const [k, until] of taken) if (until < now) taken.delete(k);
  const c = await unseal<Code>(code);
  if (!c || c.use !== "mcp-code" || taken.has(code)) return null;
  taken.set(code, now + CODE_LIFE * 1000);
  if (c.client !== client || c.redirect !== redirect) return null;
  if (createHash("sha256").update(verifier).digest("base64url") !== c.challenge) return null;
  return { gh: c.gh, who: c.who };
}

/** What a token endpoint answers: the access token for as long as GitHub's holds, the refresh token for as long as GitHub's renews. */
export async function tokensFor(client: string, aud: string, gh: Tokens, who: User) {
  const now = Math.floor(Date.now() / 1000), life = Math.max(60, gh.expires - now - 60);
  return {
    access_token: await seal({ use: "mcp-access", client, aud, access: gh.access, who } satisfies Access, life),
    token_type: "Bearer",
    expires_in: life,
    scope: SCOPE,
    ...(gh.refresh ? { refresh_token: await seal({ use: "mcp-refresh", client, aud, refresh: gh.refresh, who } satisfies Refresh, Math.max(60, gh.refreshExpires - now)) } : {}),
  };
}

/** Who an access token is, and GitHub's token in it — only one made for this endpoint. */
export async function bearer(header: string | null, aud: string): Promise<{ access: string; who: User } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header || "");
  const t = m ? await unseal<Access>(m[1]) : null;
  return t && t.use === "mcp-access" && t.aud === aud ? { access: t.access, who: t.who } : null;
}

// GitHub's renewing token changes with every use: two questions with one at once must not both renew (as lib/session.ts)
const renewing = new Map<string, Promise<Tokens>>();

/** New tokens for a refresh token, for the client it was given to. null: not one of ours, or GitHub takes it no more. */
export async function refreshed(token: string, client: string): Promise<{ aud: string; gh: Tokens; who: User } | null> {
  const r = await unseal<Refresh>(token);
  if (!r || r.use !== "mcp-refresh" || r.client !== client) return null;
  let going = renewing.get(r.refresh);
  if (!going) {
    going = renew(r.refresh).finally(() => setTimeout(() => renewing.delete(r.refresh), 10_000));
    renewing.set(r.refresh, going);
  }
  try {
    return { aud: r.aud, gh: await going, who: r.who };
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e; // (GitHub not reached: the client may try again with the same token)
  }
}

/** What a client asked for when it sent the user here — checked. A wrong client or place is shown
 * to the user, never gone to (`error` without `redirect`); anything else wrong is said to the client. */
export async function askedFor(q: URLSearchParams, aud: string): Promise<{ grant: Grant; client: Client } | { error: string; redirect?: string; state?: string }> {
  const client = await clientOf(q.get("client_id"));
  const redirect = q.get("redirect_uri") || "", state = q.get("state") || "";
  if (!client) return { error: "This application is not known here. Add it to Claude again." };
  if (!redirectOf(client, redirect)) return { error: "This application asked to be sent somewhere it did not register." };
  if (q.get("response_type") !== "code") return { error: "unsupported_response_type", redirect, state };
  const challenge = q.get("code_challenge") || "";
  if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return { error: "invalid_request", redirect, state };
  if (q.get("resource") && q.get("resource") !== aud) return { error: "invalid_target", redirect, state };
  return { grant: { client: q.get("client_id") as string, redirect, state, challenge }, client };
}

/** The client's place with what is said to it. */
export function back(redirect: string, said: Record<string, string>): string {
  const u = new URL(redirect);
  for (const [k, v] of Object.entries(said)) if (v) u.searchParams.set(k, v);
  return u.href;
}
