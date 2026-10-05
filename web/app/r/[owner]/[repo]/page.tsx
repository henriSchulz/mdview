// A repository's notes. Reading them is the next step of the plan (docs/Git-Phase-3.md): until
// then this says so.
import { sessionFor } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Repository({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  await sessionFor(`/r/${owner}/${repo}`);
  return (
    <main className="center">
      <div className="card signin">
        <h1>{owner}/{repo}</h1>
        <p className="muted">Reading a repository&apos;s notes here is not built yet.</p>
        <a className="link" href="/" style={{ display: "inline-flex", alignItems: "center", marginLeft: -8 }}>All repositories</a>
      </div>
    </main>
  );
}
