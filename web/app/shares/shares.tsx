"use client";
// The list of what is shared: a row a note, with its link to copy, to open, and the note itself.
import { useState } from "react";

type Row = { id: string; repo: string; path: string; password: boolean; created: string; seen: string; opens: number };
const day = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); };
const ago = (iso: string) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "never opened";
  const min = Math.round((Date.now() - t) / 60000);
  return min < 1 ? "opened just now" : min < 60 ? `opened ${min} min ago` : min < 60 * 24 ? `opened ${Math.round(min / 60)} h ago` : `opened ${day(iso)}`;
};

export function Shares({ rows, failed, repos }: { rows: Row[]; failed: boolean; repos: string[] }) {
  const [copied, setCopied] = useState(""), [busy, setBusy] = useState(false);
  const link = (id: string) => `${location.origin}/s/${id}`;
  const copy = (id: string) => { navigator.clipboard?.writeText(link(id)).then(() => { setCopied(id); setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1400); }, () => {}); };
  // (the repositories' own lists are the truth: read again, each of them, then shown anew)
  const refresh = async () => {
    setBusy(true);
    await Promise.all(repos.slice(0, 60).map((r) => fetch(`/api/r/${r}/shares`, { method: "POST" }).catch(() => null)));
    location.reload();
  };
  return (
    <div className="card repos shares">
      <header>
        <h1>Shared Notes</h1>
        <span className="who">{rows.length === 1 ? "1 note" : `${rows.length} notes`}</span>
      </header>
      {rows.length ? (
        <div className="list" role="list" aria-label="Shared notes">
          {rows.map((r) => (
            <div className="row share" role="listitem" key={r.id}>
              <span className="share-what">
                <a href={`/r/${r.repo}?n=${encodeURIComponent(r.path)}`}>{r.path.replace(/\.(md|markdown)$/i, "")}</a>
                <small>{r.repo} · {r.password ? "with a password" : "for anyone with the link"} · {r.opens === 1 ? "1 opening" : `${r.opens} openings`} · {ago(r.seen)}{r.created ? ` · shared ${day(r.created)}` : ""}</small>
              </span>
              <a className="link" href={`/s/${r.id}`} target="_blank" rel="noreferrer">/s/{r.id}</a>
              <button className="link" type="button" onClick={() => copy(r.id)}>{copied === r.id ? "Copied" : "Copy Link"}</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty" role="status">{failed ? "GitHub could not be reached. Reload to try again." : "Nothing is shared. A note is shared from its window: the share button at the top."}</p>
      )}
      <footer>
        <a className="link" href="/" style={{ display: "inline-flex", alignItems: "center" }}>Repositories</a>
        <button className="link" type="button" onClick={refresh} disabled={busy}>{busy ? "Reading…" : "Read Again from the Repositories"}</button>
      </footer>
    </div>
  );
}
