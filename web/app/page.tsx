// After signing in: the repositories the app was given, to choose one. Nothing is chosen
// beforehand.
import { GIVE, Refused, repositories, type Repo } from "@/lib/github";
import { sessionFor } from "@/lib/session";
import { redirect } from "next/navigation";
import { Repos } from "./repos";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await sessionFor("/");
  let repos: Repo[] = [], failed = false;
  try {
    repos = await repositories(session.access);
  } catch (e) {
    if (e instanceof Refused) redirect("/auth/renew?next=/");
    failed = true;
  }
  return (
    <main className="center">
      <Repos repos={repos} failed={failed} who={session.name ? `${session.name} (@${session.login})` : `@${session.login}`} give={GIVE} />
    </main>
  );
}
