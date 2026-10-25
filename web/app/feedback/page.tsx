// Report a bug or ask for a feature: for anyone, signed in or not (lib/feedback.ts keeps it).
// /bug and /feature come here with their kind chosen.
import type { Metadata } from "next";
import { read } from "@/lib/session";
import { Form } from "./form";
import "./feedback.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Feedback · Markdown Notes" };

export default async function Feedback({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  let login = "";
  try { login = (await read())?.login || ""; } catch { /* (no session to be read) */ }
  return (
    <main className="center">
      <Form kind={kind === "feature" ? "feature" : "bug"} login={login} />
    </main>
  );
}
