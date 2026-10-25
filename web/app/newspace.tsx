"use client";
// New Space: a button over the notebooks, and the small window it opens — the space's name, the
// repository it will be on GitHub (as it is typed: lib/reponame.ts), made there, private, as a
// notebook (app/api/new), and opened. Where it was not made, why stands under the name.
import { useEffect, useRef, useState } from "react";
import { newName, repoName } from "@/lib/reponame";
import type { Place } from "./repos";

type Said = { error: "taken" | "denied" | "unreached" | "failed" | "invalid"; name: string; why?: string } | null;

const PLUS = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;

// the browser as a commit names it (public/host/host.js keeps it: mdview:device), for the space's first commit
function device(): string {
  try {
    const d = JSON.parse(localStorage.getItem("mdview:device") || "null"), set = JSON.parse(localStorage.getItem("mdview:set") || "null");
    const name = String(set?.deviceName || "").trim() || d?.name;
    return d?.id && name ? `${name} (${d.id})` : "";
  } catch { return ""; }
}

export function NewSpace({ login, give, places, onAway }: { login: string; give: string; places: Place[]; onAway: () => void }) {
  const [open, setOpen] = useState(false), [space, setSpace] = useState(""), [busy, setBusy] = useState(false), [said, setSaid] = useState<Said>(null);
  const field = useRef<HTMLInputElement>(null), button = useRef<HTMLButtonElement>(null);
  const repo = newName(space), can = !!repoName(space) && !busy;
  const show = () => { setSpace(""); setSaid(null); setBusy(false); setOpen(true); };
  const hide = () => { if (busy) return; setOpen(false); button.current?.focus({ preventScroll: true }); };
  useEffect(() => { if (open) field.current?.focus({ preventScroll: true }); }, [open]);
  // (not made: the name is there to be changed — the button pressed was off while it was asked, and the focus with it)
  useEffect(() => { if (said && field.current) { field.current.focus({ preventScroll: true }); if (said.error === "taken") field.current.select(); } }, [said]);
  // Esc closes it, wherever the focus is
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); hide(); } };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  async function make(e: React.FormEvent) {
    e.preventDefault();
    if (!can) return;
    setBusy(true); setSaid(null);
    try {
      const res = await fetch("/api/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ space, device: device() }) });
      if (res.status === 401) { location.href = "/signin?next=/"; return; }
      const got = (await res.json().catch(() => ({}))) as { name?: string; error?: string; why?: string };
      if (res.ok && got.name && !got.error) { location.assign(`/r/${got.name}`); return; } // (opened: the page that begins is the space's)
      setSaid({ error: (got.error as NonNullable<Said>["error"]) || "failed", name: got.name || repo, why: got.why || "" });
    } catch {
      setSaid({ error: "failed", name: repo, why: "GitHub could not be reached" });
    }
    setBusy(false);
  }

  // where the app is given repositories, for one it made and does not reach
  const chosen = places.filter((p) => !p.all), where = chosen.length ? chosen[0].url : give;
  const why = !said ? null
    : said.error === "taken" ? <>There is a repository named “{said.name}” on your account already. Choose another name.</>
    : said.error === "invalid" ? <>A space&apos;s name needs a letter or a digit GitHub takes in a name.</>
    : said.error === "denied" ? <>GitHub doesn&apos;t let Markdown Notes create repositories yet. Accept the app&apos;s new permission on GitHub, then try again. <a href={give} target="_blank" rel="noreferrer" onClick={onAway}>Review on GitHub</a></>
    : said.error === "unreached" ? <>“{said.name}” was created, but Markdown Notes can&apos;t reach it. Give the app access to it on GitHub; it is listed here then. <a href={where} target="_blank" rel="noreferrer" onClick={onAway}>Choose repositories</a></>
    : <>Couldn&apos;t create the space{said.why ? `: ${said.why}` : "."}</>;

  return (
    <>
      <button ref={button} className="button new-space" type="button" onClick={show}>{PLUS}New Space</button>
      <div className="ns-scrim" data-open={open ? "" : undefined} onMouseDown={(e) => { e.preventDefault(); hide(); }} />
      <form className="ns" role="dialog" aria-modal="true" aria-labelledby="ns-title" data-open={open ? "" : undefined} inert={!open} onSubmit={make}>
        <h2 id="ns-title">New Space</h2>
        <label className="ns-label" htmlFor="ns-name">Name</label>
        <input ref={field} id="ns-name" className="home-search ns-field" type="text" value={space} disabled={busy} placeholder="Lecture notes" spellCheck={false} autoComplete="off" maxLength={200}
          onChange={(e) => { setSpace(e.target.value); setSaid(null); }} />
        <p className="ns-repo">{`On GitHub: ${login}/${repo}`}<small>Private repository</small></p>
        {why ? <p className="ns-why" role="alert">{why}</p> : null}
        <footer className="ns-foot">
          <button className="link" type="button" onClick={hide} disabled={busy}>Cancel</button>
          <button className="button" type="submit" disabled={!can}>{busy ? "Creating…" : "Create"}</button>
        </footer>
      </form>
    </>
  );
}
