// What is shared: every note of the repositories the signed-in user reaches through the app that
// stands under a link — where it is, whether it has a password, and whether anyone opens it. The
// server's own record (lib/store.ts), brought up to date from the repositories when asked.
import { Refused, repositories, type Repo } from "@/lib/github";
import { sessionFor } from "@/lib/session";
import { sharesOf, type Share } from "@/lib/store";
import { redirect } from "next/navigation";
import { Shares } from "./shares";

export const dynamic = "force-dynamic";

export default async function Shared() {
  const session = await sessionFor("/shares");
  let repos: Repo[] = [], shares: [string, Share][] = [], failed = false;
  try {
    repos = await repositories(session.access);
    shares = await sharesOf(repos.map((r) => r.name));
  } catch (e) {
    if (e instanceof Refused) redirect("/auth/renew?next=/shares");
    failed = true;
  }
  const rows = shares.map(([id, s]) => ({ id, repo: `${s.owner}/${s.name}`, path: s.path, password: s.password, created: s.created, seen: s.seen, opens: s.opens }))
    .sort((a, b) => (b.seen || b.created).localeCompare(a.seen || a.created));
  return (
    <main className="center">
      <Shares rows={rows} failed={failed} repos={repos.map((r) => r.name)} />
    </main>
  );
}
