// What was sent through the feedback form (lib/feedback.ts), newest first: for Henri alone,
// signed in with GitHub. Anyone else — signed in or not — finds nothing at this address.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isOwner, list, type Entry } from "@/lib/feedback";
import { read } from "@/lib/session";
import { Inbox } from "./inbox";
import "../feedback.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback · Markdown Notes" };

export default async function FeedbackInbox() {
  let session = null;
  try { session = await read(); } catch { /* (no session to be read) */ }
  if (!isOwner(session)) notFound();
  let rows: (Entry & { id: string })[] = [], failed = false;
  try { rows = (await list()).map(([id, e]) => ({ id, ...e })); } catch { failed = true; }
  return (
    <main className="center">
      <Inbox rows={rows} failed={failed} />
    </main>
  );
}
