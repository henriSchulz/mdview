// A shared note under its long address: /s/<owner>/<repo>/<id>. (The link that is handed out is
// the short one, /s/<id>; this one names the repository itself and needs no looking up.)
import { givePassword, showShared } from "@/lib/sharepage";
import { address } from "@/lib/sharegate";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ owner: string; repo: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { owner, repo, id } = await params;
  return showShared(request, owner, repo, id, address(owner, repo, id));
}
export async function POST(request: Request, { params }: Params) {
  const { owner, repo, id } = await params;
  return givePassword(request, owner, repo, id, address(owner, repo, id));
}
