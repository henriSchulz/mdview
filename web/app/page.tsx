// After signing in: the notebooks — the repositories the app was given that hold notes of the
// app's (a .mdview folder in them) — to choose one. Any other repository the app was given can be
// opened too, from a list of its own: it is only read until its history is turned on there.
// Nothing is chosen beforehand.
import { GIVE, Refused, projects, repositories, type Repo } from "@/lib/github";
import { sessionFor } from "@/lib/session";
import { REPOSITORY } from "@/lib/welcome";
import { redirect } from "next/navigation";
import { Repos, type Row } from "./repos";

export const dynamic = "force-dynamic";

// when something was last written to a repository, in words (said here, on the server: the page says the same when it wakes up)
function ago(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now - t) / 86400000);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30) || 1} month${days < 60 ? "" : "s"} ago`;
  return `${Math.floor(days / 365)} year${days < 730 ? "" : "s"} ago`;
}

export default async function Home() {
  const session = await sessionFor("/");
  let repos: Repo[] = [], failed = false, known: Set<string> | null = new Set();
  try {
    repos = await repositories(session.access);
    known = await projects(session.access, repos);
  } catch (e) {
    if (e instanceof Refused) redirect("/auth/renew?next=/");
    failed = true;
  }
  const now = Date.now();
  const rows: Row[] = repos.map((r) => ({ name: r.name, private: r.private, about: r.about || "", written: ago(r.pushed, now), pushed: r.pushed || "", notes: !!known && known.has(r.name) }));
  return (
    <main className="home">
      <Repos rows={rows} failed={failed} unknown={!failed && !known} name={session.name || `@${session.login}`} login={session.login} give={GIVE} source={REPOSITORY} />
    </main>
  );
}
