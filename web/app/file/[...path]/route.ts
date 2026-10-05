// A file of a repository, as it is on its branch now: /file/<owner>/<repo>/<path in it> — the
// pictures and PDFs beside a note, and what a relative address in a note leads to. The addresses
// mirror the repository, so that relative ones resolve as they do on a disk.
//
// What comes from a repository is someone's content, served from the app's own address. It is
// therefore sent sandboxed: a page or picture opened from here can run no script, and so cannot
// act as the signed-in user.
import { Refused, raw } from "@/lib/github";
import { fresh } from "@/lib/session";
import { TYPES } from "@/lib/types";

export const dynamic = "force-dynamic";

const said = (status: number, text: string) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const [owner, repo, ...rest] = (await params).path;
  if (!owner || !repo || !rest.length || rest.some((p) => p === ".." || p === ".")) return said(404, "Not found");
  try {
    const session = await fresh();
    if (!session) return said(401, "Not signed in");
    const res = await raw(session.access, owner, repo, rest.join("/"), request.headers.get("if-none-match"));
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-cache", // (asked again each time, answered "as it was" where it is)
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    };
    const etag = res.headers.get("etag");
    if (etag) headers.ETag = etag;
    if (res.status === 304) return new Response(null, { status: 304, headers });
    if (!res.ok) return said(res.status === 404 ? 404 : 502, res.status === 404 ? "Not found" : "GitHub could not be reached");
    const ext = (rest[rest.length - 1].split(".").pop() || "").toLowerCase();
    // (anything not known to be a picture, a film, a PDF or plain text is handed out as a download, never shown)
    headers["Content-Type"] = TYPES[ext] || "application/octet-stream";
    if (!TYPES[ext]) headers["Content-Disposition"] = "attachment";
    return new Response(res.body, { status: 200, headers });
  } catch (e) {
    return e instanceof Refused ? said(401, "Not signed in") : said(502, "GitHub could not be reached");
  }
}
