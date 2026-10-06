// The welcome page: what the address shows to whoever is not signed in (proxy.ts sends "/" here).
import { origin } from "@/lib/session";
import { welcomeDocument } from "@/lib/welcome";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return welcomeDocument(origin(request), null);
}
