// One sending in the inbox (lib/feedback.ts), for Henri alone — anyone else finds nothing here.
//
//   PATCH  { status: "open" | "done" }
//   DELETE
import { NextResponse } from "next/server";
import { drop, isOwner, mark } from "@/lib/feedback";
import { read } from "@/lib/session";

export const dynamic = "force-dynamic";
const say = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const owner = async () => { try { return isOwner(await read()); } catch { return false; } };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await owner())) return say({ error: "missing" }, 404);
  const { id } = await params;
  const said = (await request.json().catch(() => null)) as { status?: unknown } | null;
  if (!said || (said.status !== "open" && said.status !== "done")) return say({ error: "status" }, 400);
  return (await mark(id, said.status)) ? say({ ok: true }) : say({ error: "missing" }, 404);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await owner())) return say({ error: "missing" }, 404);
  await drop((await params).id);
  return say({ ok: true });
}
