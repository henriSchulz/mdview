// A link's id that is free: /share/free → { id }. Ids are as short as there is room for (one
// letter or digit while few notes are shared, then two, …), and one id means one note across
// every repository — so the one who shares asks here for it, the desktop app and the web's host
// alike, signed in or not. (Nothing is told that is not plain from trying the links.)
import { NextResponse } from "next/server";
import { sharing } from "@/lib/app";
import { freeId } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!sharing()) return NextResponse.json({ error: "off" }, { status: 404 });
  try {
    return NextResponse.json({ id: await freeId() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unreachable" }, { status: 502 });
  }
}
