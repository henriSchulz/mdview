// A shared note under its link: /s/<id>. The id alone says which note: the repository it belongs
// to is looked up among those the app is installed on (lib/share.ts: whereIs). (The folder is
// named [owner] because the long address, /s/<owner>/<repo>/<id>, begins in the same place.)
import { sharing } from "@/lib/app";
import { origin } from "@/lib/session";
import { ID, whereIs } from "@/lib/share";
import { givePassword, nothing, showShared, waitFirst } from "@/lib/sharepage";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ owner: string }> };

async function found(request: Request, id: string): Promise<{ owner: string; repo: string } | Response> {
  if (!sharing()) return nothing(origin(request), "off");
  if (!ID.test(id)) return nothing(origin(request), "gone");
  try { return (await whereIs(id)) || nothing(origin(request), "gone"); } catch { return nothing(origin(request), "unreachable"); }
}
export async function GET(request: Request, { params }: Params) {
  const wait = waitFirst(request);
  if (wait) return wait;
  const id = (await params).owner, at = await found(request, id);
  return at instanceof Response ? at : showShared(request, at.owner, at.repo, id, `/s/${id}`);
}
export async function POST(request: Request, { params }: Params) {
  const id = (await params).owner, at = await found(request, id);
  return at instanceof Response ? at : givePassword(request, at.owner, at.repo, id, `/s/${id}`);
}
