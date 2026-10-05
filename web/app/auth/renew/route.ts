// A page found its token about to end: renewed here (a route can write the cookie, a page
// cannot), then back to the page. Where GitHub takes the sign-in no more: to the sign-in page.
import { NextResponse } from "next/server";
import { fresh, origin, safePath } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const next = safePath(new URL(request.url).searchParams.get("next"));
  try {
    const session = await fresh();
    return NextResponse.redirect(`${origin(request)}${session ? next : "/signin?why=over"}`);
  } catch {
    return NextResponse.redirect(`${origin(request)}/signin?why=unreachable`);
  }
}
