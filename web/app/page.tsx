// After signing in: the notebooks — the repositories the app was given that hold notes of the
// app's (a .mdview folder in them) — to choose one. Any other repository the app was given can be
// opened too, from a list of its own: it is only read until its history is turned on there.
// Nothing is chosen beforehand.
import { GIVE, INSTALL, Refused, projects, repositories, type Place, type Repo } from "@/lib/github";
import { sessionOrRenew } from "@/lib/session";
import { REPOSITORY } from "@/lib/welcome";
import { redirect } from "next/navigation";
import { Suspense } from "react";
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

// The page is there at once, with the sign-in looked at (who is not signed in is sent on before anything is shown; a token that
// is about to end shows the ring while the route that renews it is on its way); the
// repositories are asked of GitHub behind it, and the window says so meanwhile: the ring a repository's own page begins
// with (lib/page.ts), after the wait that is no wait (motion.css: --loading-delay).
export default async function Home() {
  const session = await sessionOrRenew();
  // a token about to end is renewed by a route (a page cannot write the cookie): the ring stands there meanwhile, and the
  // browser is sent on without waiting for any script
  if (session === "renew") return (
    <main className="home">
      <meta httpEquiv="refresh" content="0;url=/auth/renew?next=%2F" />
      <div className="boot" role="status" aria-label="Loading"><span className="boot-ring" /></div>
    </main>
  );
  return (
    <main className="home">
      <Suspense fallback={<div className="boot" role="status" aria-label="Loading"><span className="boot-ring" /></div>}>
        <List access={session.access} name={session.name || `@${session.login}`} login={session.login} />
      </Suspense>
    </main>
  );
}

async function List({ access, name, login }: { access: string; name: string; login: string }) {
  let repos: Repo[] = [], failed = false, known: Set<string> | null = new Set();
  const places: Place[] = [];
  try {
    repos = await repositories(access, places);
    known = await projects(access, repos);
  } catch (e) {
    if (e instanceof Refused) redirect("/auth/renew?next=/");
    failed = true;
  }
  const now = Date.now();
  const rows: Row[] = repos.map((r) => ({ name: r.name, private: r.private, about: r.about || "", written: ago(r.pushed, now), pushed: r.pushed || "", notes: !!known && known.has(r.name) }));
  return <Repos rows={rows} failed={failed} unknown={!failed && !known} name={name} login={login} give={GIVE} install={INSTALL} places={places} source={REPOSITORY} />;
}
