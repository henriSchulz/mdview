// Signed out: the cookie goes. (A form's POST, so that no link someone sends can do it.)
import { NextResponse } from "next/server";
import { COOKIE, origin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const res = NextResponse.redirect(`${origin(request)}/signin`, 303);
  res.cookies.delete(COOKIE);
  return res;
}
