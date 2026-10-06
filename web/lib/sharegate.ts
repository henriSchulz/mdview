// Who may see a shared note: anyone with its link — and, where a password was set, only a
// browser that gave it (it carries a cookie for this link and this password then).
import { cookies } from "next/headers";
import { sharing } from "./app";
import { cookieName, pass, shared, type Shared } from "./share";

export type Gate = { shared: Shared; open: true } | { shared: Shared; open: false } | { shared: null; open: false; why: "off" | "gone" | "unreachable" };

export const address = (owner: string, repo: string, id: string) => `/s/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(id)}`;

export async function gate(owner: string, repo: string, id: string): Promise<Gate> {
  if (!sharing()) return { shared: null, open: false, why: "off" };
  let s: Shared | null;
  try { s = await shared(owner, repo, id, address(owner, repo, id) + "/file"); } catch { return { shared: null, open: false, why: "unreachable" }; }
  if (!s) return { shared: null, open: false, why: "gone" };
  if (!s.password) return { shared: s, open: true };
  const has = (await cookies()).get(cookieName(id))?.value;
  return { shared: s, open: !!has && has === pass(owner, repo, id, s.password) };
}
