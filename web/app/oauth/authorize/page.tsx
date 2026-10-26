// A client of the Model Context Protocol asks for the user's notes: who it is, where it goes back
// to, and what it may do — said before anything is given. Yes goes on to GitHub (allow/route.ts).
import { askedFor, resourceOf } from "@/lib/mcp/oauth";
import { origin } from "@/lib/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams, q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") q.set(k, v);
  const here = origin(new Request("http://x", { headers: await headers() }));
  const asked = await askedFor(q, resourceOf(here));
  if ("error" in asked && asked.redirect) {
    const u = new URL(asked.redirect);
    u.searchParams.set("error", asked.error);
    if (asked.state) u.searchParams.set("state", asked.state);
    redirect(u.href);
  }
  if ("error" in asked) {
    return (
      <main className="center">
        <div className="card signin">
          <h1>Not allowed</h1>
          <p className="muted">{asked.error}</p>
        </div>
      </main>
    );
  }
  const to = new URL(asked.grant.redirect);
  return (
    <main className="center">
      <form className="card signin" method="post" action="/oauth/authorize/allow">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="appicon" src="/welcome/icon.svg" alt="" width={64} height={64} />
        <h1>{asked.client.name} wants your notes</h1>
        <p className="muted">It may read, search and write the notes, whiteboards and PDFs in the repositories the app was given on GitHub. You are sent to GitHub to sign in for it.</p>
        <p className="muted">It goes back to <b>{to.host}</b>.</p>
        {Object.entries({ client_id: asked.grant.client, redirect_uri: asked.grant.redirect, state: asked.grant.state, code_challenge: asked.grant.challenge }).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="consent-actions">
          <button className="button" type="submit" name="answer" value="allow">Allow</button>
          <button className="link" type="submit" name="answer" value="deny">Deny</button>
        </div>
      </form>
    </main>
  );
}
