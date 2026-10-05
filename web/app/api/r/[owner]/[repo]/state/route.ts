// A repository as it is now, for the page's host in the browser: where its branch stands and
// every file in it. The notes' texts are asked for separately (../texts).
import { NextResponse } from "next/server";
import { Refused, state } from "@/lib/github";
import { fresh } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  try {
    const session = await fresh();
    if (!session) return NextResponse.json({ error: "signin" }, { status: 401 });
    const now = await state(session.access, owner, repo);
    if (!now) return NextResponse.json({ error: "missing" }, { status: 404 });
    return NextResponse.json({ ...now, user: { login: session.login, name: session.name } }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof Refused) return NextResponse.json({ error: "signin" }, { status: 401 });
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
