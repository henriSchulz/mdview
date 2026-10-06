// The welcome page's note as its Markdown: what /raw behind a shared note's link gives.
import { WELCOME } from "@/lib/welcome";

export async function GET() {
  return new Response(WELCOME, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
