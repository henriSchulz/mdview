// One of the welcome page's windows: the app's own page (lib/page.ts) with sample notes that live
// in the window (public/host/demo.js). Shown in a frame of the welcome page, and by nothing else.
import { pageDocument } from "@/lib/page";
import { origin } from "@/lib/session";
import { demo } from "@/lib/welcome";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const here = origin(request), view = new URL(request.url).searchParams.get("view") || "write";
  return pageDocument({
    here, title: "Markdown Notes", files: "/welcome/file", base: "/welcome/file/", hosts: ["/host/core.js", "/host/demo.js"], framed: true,
    web: demo(["write", "share", "try"].includes(view) ? view : "write", here),
  });
}
