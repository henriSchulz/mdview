// A file that goes with a shared note — a picture in it, a note or PDF it embeds — and no other
// file of the repository: /s/<owner>/<repo>/<id>/file/<path in the repository>. Sent sandboxed,
// as every file of a repository is (app/file).
import { raw } from "@/lib/github";
import { TYPES } from "@/lib/types";
import { gate } from "@/lib/sharegate";

export const dynamic = "force-dynamic";
const said = (status: number, text: string) => new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string; id: string; path: string[] }> }) {
  const { owner, repo, id, path } = await params;
  const g = await gate(owner, repo, id);
  if (!g.shared) return said(g.why === "unreachable" ? 502 : 404, "Not found");
  if (!g.open) return said(401, "A password is needed");
  const rel = path.join("/");
  if (!g.shared.files.has(rel)) return said(404, "Not found"); // (not what was shared)
  const res = await raw(g.shared.token, owner, repo, rel, request.headers.get("if-none-match")).catch(() => null);
  const headers: Record<string, string> = { "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:", "X-Robots-Tag": "noindex" };
  if (!res) return said(502, "GitHub could not be reached");
  const etag = res.headers.get("etag");
  if (etag) headers.ETag = etag;
  if (res.status === 304) return new Response(null, { status: 304, headers });
  if (!res.ok) return said(res.status === 404 ? 404 : 502, res.status === 404 ? "Not found" : "GitHub could not be reached");
  const ext = (rel.split(".").pop() || "").toLowerCase();
  headers["Content-Type"] = TYPES[ext] || "application/octet-stream";
  if (!TYPES[ext]) headers["Content-Disposition"] = "attachment";
  return new Response(res.body, { status: 200, headers });
}
