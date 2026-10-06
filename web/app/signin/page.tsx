// The only page there is without signing in.
const WHY: Record<string, string> = {
  denied: "GitHub was not allowed to sign you in here.",
  expired: "That took too long. Start again.",
  mismatch: "The answer did not belong to this sign-in. Start again.",
  github: "GitHub did not complete the sign-in. Try again.",
  over: "The sign-in has ended. Sign in again.",
  unreachable: "GitHub could not be reached. Try again in a moment.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ why?: string; next?: string }> }) {
  const { why, next } = await searchParams;
  const to = next && next.startsWith("/") && !next.startsWith("//") ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login";
  return (
    <main className="center">
      <div className="card signin">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="appicon" src="/welcome/icon.svg" alt="" width={64} height={64} />
        <h1>Markdown Notes</h1>
        <p className="muted">Your notes are read from a repository on GitHub. Sign in to choose one; only the repositories the app was given there are reached.</p>
        {why && WHY[why] ? <p className="why" role="status">{WHY[why]}</p> : null}
        <a className="button" href={to}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.4c-2.23.48-2.7-.95-2.7-.95-.36-.93-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" /></svg>
          Sign in with GitHub
        </a>
      </div>
    </main>
  );
}
