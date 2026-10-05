// A repository's notes: the document the desktop app's own page runs in (lib/page.ts), with the
// web's host (public/host/host.js) in the shell's place. Not a React page: the page brings
// everything.
import { sharing } from "@/lib/app";
import { pageDocument } from "@/lib/page";
import { fresh, origin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const here = origin(request);
  const session = await fresh().catch(() => null);
  if (!session) return Response.redirect(`${here}/signin?next=${encodeURIComponent(`/r/${owner}/${repo}`)}`, 307);
  return pageDocument({
    here, title: repo, files: "/file", base: `/file/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/`, hosts: ["/host/core.js", "/host/host.js"],
    web: { owner, repo, user: { login: session.login, name: session.name }, sharing: sharing() }, // (sharing: whether notes can be shared from this server)
  });
}
