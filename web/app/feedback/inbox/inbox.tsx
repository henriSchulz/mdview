"use client";
// The inbox: a row a sending — its kind, its title, who and where — opened to read it; marked
// done or opened again, and deleted. Shown as text, whatever it holds: Markdown is not rendered.
import { useMemo, useState } from "react";
import type { Entry } from "@/lib/feedback";

type Row = Entry & { id: string };
type Kinds = "all" | "bug" | "feature";
type States = "open" | "done" | "all";
const when = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? "" : new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

function Seg<T extends string>({ label, value, set, options }: { label: string; value: T; set: (v: T) => void; options: [T, string][] }) {
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      <span className="seg-thumb" aria-hidden="true" style={{ width: `calc(${100 / options.length}% - ${4 / options.length}px)`, transform: `translateX(${i * 100}%)` }} />
      {options.map(([v, name]) => <button key={v} type="button" role="radio" aria-checked={v === value} onClick={() => set(v)}>{name}</button>)}
    </div>
  );
}

export function Inbox({ rows: first, failed }: { rows: Row[]; failed: boolean }) {
  const [rows, setRows] = useState(first);
  const [kind, setKind] = useState<Kinds>("all"), [state, setState] = useState<States>("open");
  const [open, setOpen] = useState(""), [asked, setAsked] = useState(""), [trouble, setTrouble] = useState("");
  const shown = useMemo(() => rows.filter((r) => (kind === "all" || r.kind === kind) && (state === "all" || r.status === state)), [rows, kind, state]);
  const count = (k: Kinds) => rows.filter((r) => (k === "all" || r.kind === k) && r.status === "open").length;

  const mark = async (r: Row) => {
    const status = r.status === "done" ? "open" : "done";
    setRows((all) => all.map((x) => (x.id === r.id ? { ...x, status } : x)));
    const res = await fetch(`/feedback/items/${encodeURIComponent(r.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }).catch(() => null);
    if (!res?.ok) { setRows((all) => all.map((x) => (x.id === r.id ? { ...x, status: r.status } : x))); setTrouble(`“${r.title}” could not be changed.`); }
  };
  const remove = async (r: Row) => {
    if (asked !== r.id) { setAsked(r.id); setTimeout(() => setAsked((a) => (a === r.id ? "" : a)), 3000); return; } // (a second click deletes)
    setAsked("");
    setRows((all) => all.filter((x) => x.id !== r.id));
    const res = await fetch(`/feedback/items/${encodeURIComponent(r.id)}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) { setRows((all) => [...all, r].sort((a, b) => b.created.localeCompare(a.created))); setTrouble(`“${r.title}” could not be deleted.`); }
  };

  return (
    <div className="card repos fb-inbox">
      <header>
        <h1>Feedback</h1>
        <span className="who">{`${count("bug")} open ${count("bug") === 1 ? "bug" : "bugs"} · ${count("feature")} open ${count("feature") === 1 ? "feature" : "features"}`}</span>
      </header>
      <div className="fb-bar">
        <Seg label="Kind" value={kind} set={setKind} options={[["all", "All"], ["bug", "Bugs"], ["feature", "Features"]]} />
        <Seg label="Status" value={state} set={setState} options={[["open", "Open"], ["done", "Done"], ["all", "All"]]} />
      </div>
      {trouble ? <p className="fb-error" role="alert" style={{ margin: "0 16px 8px" }}>{trouble}</p> : null}
      {shown.length ? (
        <div className="list" role="list" aria-label="Feedback">
          {shown.map((r) => (
            <div className="fb-row" role="listitem" key={r.id} data-done={r.status === "done" ? "" : undefined}>
              <div className="fb-line">
                <button className="fb-open" type="button" aria-expanded={open === r.id} onClick={() => setOpen((o) => (o === r.id ? "" : r.id))}>
                  <span className="fb-kind" data-kind={r.kind}>{r.kind === "bug" ? "Bug" : "Feature"}</span>
                  <span className="fb-title">{r.title}</span>
                </button>
                <button className="link" type="button" onClick={() => mark(r)}>{r.status === "done" ? "Reopen" : "Mark Done"}</button>
                <button className="link fb-danger" type="button" onClick={() => remove(r)}>{asked === r.id ? "Delete?" : "Delete"}</button>
              </div>
              <small>
                {[when(r.created), r.platform, r.version, r.login ? `@${r.login}` : "not signed in"].filter(Boolean).join(" · ")}
                {r.email ? <> · <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.title}`)}`}>{r.email}</a></> : null}
              </small>
              {open === r.id ? (
                <>
                  <div className="fb-body">{r.body}</div>
                  {r.agent ? <span className="fb-agent">{r.agent}</span> : null}
                </>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="empty" role="status">{failed ? "The feedback could not be read. Reload to try again." : rows.length ? "Nothing here." : "Nothing was sent yet."}</p>
      )}
      <footer>
        <a className="link" href="/" style={{ display: "inline-flex", alignItems: "center" }}>Repositories</a>
        <a className="link" href="/feedback" style={{ display: "inline-flex", alignItems: "center" }}>The Form</a>
      </footer>
    </div>
  );
}
