// A shared note as it is written: /<id>/raw — its Markdown, as text. For a script, another
// program, a look at the source. Where the note has a password it is given as one is given to a
// program — `curl -u :password …/raw` — or carried by a browser that gave it on the note's page.
import { sharing } from "@/lib/app";
import { ID, matches, mayTry, tried, whereIs } from "@/lib/share";
import { gate } from "@/lib/sharegate";

export const dynamic = "force-dynamic";
const said = (status: number, text: string, more: Record<string, string> = {}) =>
  new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", ...more } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sharing() || !ID.test(id)) return said(404, "Nothing here\n");
  let at: { owner: string; repo: string } | null;
  try { at = await whereIs(id); } catch { return said(502, "The note could not be read just now\n"); }
  if (!at) return said(404, "Nothing here\n");
  const g = await gate(at.owner, at.repo, id);
  if (!g.shared) return said(g.why === "unreachable" ? 502 : 404, g.why === "unreachable" ? "The note could not be read just now\n" : "Nothing here\n");
  if (!g.open) {
    // (the password, as a program gives one: Basic, whatever the name before the colon)
    const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") || ""), key = `${at.owner}/${at.repo}/${id}`.toLowerCase();
    let given = "";
    try { given = basic ? Buffer.from(basic[1], "base64").toString("utf8").replace(/^[^:]*:/, "") : ""; } catch { /* (not to be read: none) */ }
    if (!given || !g.shared.password) return said(401, "This note has a password\n", { "WWW-Authenticate": 'Basic realm="shared note", charset="UTF-8"' });
    if (!mayTry(key)) return said(429, "Too many wrong passwords. Try again in a while\n");
    const right = await matches(given.slice(0, 1000), g.shared.password);
    tried(key, right);
    if (!right) return said(401, "That is not the password\n", { "WWW-Authenticate": 'Basic realm="shared note", charset="UTF-8"' });
  }
  return said(200, g.shared.text, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(g.shared.path.split("/").pop() || "note.md")}` });
}
