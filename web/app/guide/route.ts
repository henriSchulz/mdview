// The guide — what the app does, docs/FEATURES.md (copied to public/app/docs by scripts/assets.mjs) —
// as a note of its own to be read: the app's page with this one note, nothing to write, no tabs and
// no repository around it. Help in the app opens it (public/host/host.js); for anyone, signed in or not.
import { pageDocument } from "@/lib/page";
import { origin } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const here = origin(request);
  const res = await fetch(here + "/app/docs/FEATURES.md", { cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return new Response("The guide could not be read.", { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return pageDocument({
    here, title: "Guide", files: "/welcome/file", base: "/welcome/file/", hosts: ["/host/core.js", "/host/demo.js"], reading: true,
    web: { id: "guide", notes: { "Guide.md": await res.text() }, first: "Guide.md", mode: "read", link: null, bare: true, readonly: "the guide" },
  });
}
