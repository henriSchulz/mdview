"use client";
// The list of repositories, searched as it is typed in: those whose name (or whose owner's)
// begins with what is typed first, then those that hold it.
import { useMemo, useState } from "react";
import type { Repo } from "@/lib/github";

export function Repos({ repos, failed, who, give }: { repos: Repo[]; failed: boolean; who: string; give: string }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return repos;
    const begins = (r: Repo) => { const n = r.name.toLowerCase(); return n.startsWith(s) || n.split("/").some((p) => p.startsWith(s)); };
    return [...repos.filter(begins), ...repos.filter((r) => !begins(r) && r.name.toLowerCase().includes(s))];
  }, [q, repos]);
  return (
    <div className="card repos">
      <header>
        <h1>Repositories</h1>
        <span className="who">{who}</span>
      </header>
      <input className="search" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search repositories" aria-label="Search repositories" spellCheck={false} autoComplete="off" autoFocus />
      {shown.length ? (
        <nav className="list" aria-label="Repositories">
          {shown.map((r) => (
            <a className="row" key={r.name} href={`/r/${r.name}`}>
              <span>{r.name}</span>
              <small>{r.private ? "Private" : "Public"}</small>
            </a>
          ))}
        </nav>
      ) : (
        <p className="empty" role="status">{failed ? "GitHub could not be reached. Reload to try again." : repos.length ? "No repository fits" : "The app was given no repository"}</p>
      )}
      <footer>
        <a className="link" href={give} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center" }}>Choose on GitHub</a>
        <form action="/auth/logout" method="post"><button className="link" type="submit">Sign Out</button></form>
      </footer>
    </div>
  );
}
