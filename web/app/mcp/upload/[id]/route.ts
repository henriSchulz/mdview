// A file sent to a link of the Model Context Protocol's upload_link (lib/mcp/files.ts): its bytes
// as the request's body, kept as one commit where the link was made for. The link is all that is
// asked for: made for who was signed in, for one path, once, for minutes.
import { Refused } from "@/lib/github";
import { redeemUpload, Said400, ticketOf, UPLOAD_MOST } from "@/lib/mcp/files";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const say = (status: number, text: string) => new Response(text + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const LARGE = `Too large: ${UPLOAD_MOST / 1024 / 1024} MB at most.`;

/** The body, up to what is taken: null where there is more. */
async function body(request: Request): Promise<Buffer | null> {
  if (Number(request.headers.get("content-length") || 0) > UPLOAD_MOST) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of (request.body ?? []) as AsyncIterable<Uint8Array>) {
    size += part.length;
    if (size > UPLOAD_MOST) return null;
    parts.push(part);
  }
  return Buffer.concat(parts);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gone = () => say(404, "This link does not hold (any more): ask upload_link for a new one.");
  if (!ticketOf(id)) return gone();
  const bytes = await body(request);
  if (!bytes) return say(413, LARGE);
  const ticket = ticketOf(id); // (asked again: another may have sent to it while this one was on its way)
  if (!ticket) return gone();
  try {
    return say(200, await redeemUpload(id, ticket, bytes));
  } catch (e) {
    if (e instanceof Said400) return say(409, e.message);
    if (e instanceof Refused) return say(401, "GitHub takes the sign-in no more: ask upload_link for a new link.");
    console.error("mdview mcp: upload", e);
    return say(502, "GitHub could not be reached: try again.");
  }
}
