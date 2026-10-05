// Who is signed in, kept in a cookie the page's scripts cannot read: the tokens and the user,
// sealed (encrypted and signed) with a key only the server has. Nothing is kept on the server.
import { createHash, randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { renew, Refused, type Tokens, type User } from "./github";

export const COOKIE = "mdview"; // the session
export const PENDING = "mdview-signin"; // a sign-in under way: what must come back from GitHub, and where to go then
const SOON = 300; // seconds before a token ends from which it is renewed

export type Session = Tokens & User;

function key(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET is not set (32 characters or more)");
  return createHash("sha256").update(s).digest();
}

export async function seal(data: object, seconds: number): Promise<string> {
  return new EncryptJWT({ d: data }).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + seconds).encrypt(key());
}

export async function unseal<T>(sealed: string | undefined): Promise<T | null> {
  if (!sealed) return null;
  try {
    return ((await jwtDecrypt(sealed, key())).payload.d as T) ?? null;
  } catch {
    return null; // (not ours, tampered with, or past its time)
  }
}

export const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

/** The cookie's settings: only sent to this app, never to scripts; over HTTPS wherever the app is. */
export function cookieOptions(seconds: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: seconds };
}

/** The session as the cookie has it, or null. Does not renew. */
export async function read(): Promise<Session | null> {
  return unseal<Session>((await cookies()).get(COOKIE)?.value);
}

/** The session written into the cookie (only where cookies can be set: a route, not a page). */
export async function write(session: Session): Promise<void> {
  const left = Math.max(60, session.refreshExpires - Math.floor(Date.now() / 1000));
  (await cookies()).set(COOKIE, await seal(session, left), cookieOptions(left));
}

export async function clear(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

const due = (s: Session) => s.expires - Math.floor(Date.now() / 1000) < SOON;

/** For a page: the session, with a token that still holds. Not signed in → the sign-in page; a
 * token about to end → the route that renews it, and back here (a page cannot set the cookie). */
export async function sessionFor(path: string): Promise<Session> {
  const s = await read();
  if (!s) redirect("/signin");
  if (due(s)) redirect(`/auth/renew?next=${encodeURIComponent(path)}`);
  return s;
}

// The token that renews changes with every use, and the one before is void then: two requests at
// once must not both renew. One renewal per token at a time; the others wait for it.
const renewing = new Map<string, Promise<Session | null>>();

/** For a route: the session with a token that holds — renewed and written back if it was about
 * to end. null: not signed in (any more). */
export async function fresh(): Promise<Session | null> {
  const s = await read();
  if (!s) return null;
  if (!due(s)) return s;
  if (!s.refresh) return null;
  let going = renewing.get(s.refresh);
  if (!going) {
    going = renew(s.refresh)
      .then((t) => ({ ...s, ...t }))
      .catch((e) => {
        if (e instanceof Refused) return null; // (GitHub takes it no more: signed out)
        throw e; // (not reached: the session stays, and this request fails)
      })
      .finally(() => setTimeout(() => renewing.delete(s.refresh), 10_000)); // (kept a moment: a request that still carries the old cookie gets the same answer)
    renewing.set(s.refresh, going);
  }
  const next = await going;
  if (next) await write(next);
  else await clear();
  return next;
}

/** The address the app is reached at, as the browser sees it (behind the host's proxy the request's own is not it). */
export function origin(request: Request): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const h = request.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

/** Only a path of this app is gone to after signing in — never an address someone put in a link. */
export const safePath = (p: string | null | undefined) => (p && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\") ? p : "/");
