// A shared note under its link: /<id> — the id right behind the address, nothing before it. The
// repository it belongs to is looked up (lib/share.ts: whereIs). Every name the app itself has
// at this place (/shares, /signin, …) is the app's: Next serves those first, and no id is ever
// one of them (lib/share.ts: freeId). The older /s/<id> shows the same note.
import { sharing } from "@/lib/app";
import { origin } from "@/lib/session";
import { ID, whereIs } from "@/lib/share";
import { givePassword, nothing, showShared } from "@/lib/sharepage";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function found(request: Request, id: string): Promise<{ owner: string; repo: string } | Response> {
  if (!sharing()) return nothing(origin(request), "off");
  if (!ID.test(id)) return nothing(origin(request), "gone");
  try { return (await whereIs(id)) || nothing(origin(request), "gone"); } catch { return nothing(origin(request), "unreachable"); }
}
export async function GET(request: Request, { params }: Params) {
  const { id } = await params, at = await found(request, id);
  return at instanceof Response ? at : showShared(request, at.owner, at.repo, id, `/${id}`);
}
export async function POST(request: Request, { params }: Params) {
  const { id } = await params, at = await found(request, id);
  return at instanceof Response ? at : givePassword(request, at.owner, at.repo, id, `/${id}`);
}
