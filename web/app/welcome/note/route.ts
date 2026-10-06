// The welcome page's note as whoever has a shared note's link sees one: the app's page, the note,
// and nothing to switch or set.
import { pageDocument } from "@/lib/page";
import { origin } from "@/lib/session";
import { demo } from "@/lib/welcome";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const here = origin(request);
  return pageDocument({ here, title: "Welcome", files: "/welcome/file", base: "/welcome/file/", hosts: ["/host/core.js", "/host/demo.js"], reading: true, web: demo("note", here) });
}
