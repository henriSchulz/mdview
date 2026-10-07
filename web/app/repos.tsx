"use client";
// The notebooks, and the other repositories: searched as it is typed in — those whose name (or
// whose owner's) begins with what is typed first, then those that hold it.
import { useMemo, useState } from "react";

export type Row = { name: string; private: boolean; about: string; written: string; pushed: string; notes: boolean };

const BOOK = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="3.5" width="13.5" height="17" rx="2.5" /><path d="M9.5 3.5v17M3.5 8h3.5M3.5 12h3.5M3.5 16h3.5M12.5 8h3.5M12.5 11h2.5" /></svg>; // (a notebook, its rings at the left)
const REPO = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6l1 1a2 2 0 0 0 1.4.6H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /></svg>;
const GO = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>;
const OUT = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7h8v8M17 7 7 17" /></svg>;

export function Repos({ rows, failed, unknown, name, login, give, source }: { rows: Row[]; failed: boolean; unknown: boolean; name: string; login: string; give: string; source: string }) {
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const fits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return (list: Row[]) => list;
    const begins = (r: Row) => { const n = r.name.toLowerCase(); return n.startsWith(s) || n.split("/").some((p) => p.startsWith(s)); };
    return (list: Row[]) => [...list.filter(begins), ...list.filter((r) => !begins(r) && (r.name.toLowerCase().includes(s) || r.about.toLowerCase().includes(s)))];
  }, [q]);
  // the notebooks: what was written to last comes first; the others by name
  const books = useMemo(() => fits(rows.filter((r) => r.notes).sort((a, b) => b.pushed.localeCompare(a.pushed) || a.name.localeCompare(b.name))), [rows, fits]);
  const others = useMemo(() => fits(rows.filter((r) => !r.notes)), [rows, fits]);
  const any = rows.some((r) => r.notes), rest = rows.filter((r) => !r.notes).length;
  const open = more || (!!q.trim() && !books.length && others.length > 0) || unknown; // (searched for and only among the others: they show)
  const part = (r: Row) => { const i = r.name.indexOf("/"); return [r.name.slice(0, i), r.name.slice(i + 1)]; };

  return (
    <>
      <header className="home-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="home-icon" src="/welcome/icon.svg" alt="" width={44} height={44} />
        <div className="home-hello">
          <h1>Your notebooks</h1>
          <p>{`Signed in as ${name}${name.startsWith("@") ? "" : ` (@${login})`}`}</p>
        </div>
        <form action="/auth/logout" method="post"><button className="link" type="submit">Sign Out</button></form>
      </header>

      <div className="home-cols">
        <section className="home-main" aria-label="Notebooks">
          <input className="home-search" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search repositories" spellCheck={false} autoComplete="off" autoFocus />

          {failed ? (
            <p className="home-note" role="status">GitHub could not be reached. Reload to try again.</p>
          ) : books.length ? (
            <nav className="books" aria-label="Notebooks">
              {books.map((r) => { const [owner, repo] = part(r); return (
                <a className="book" key={r.name} href={`/r/${r.name}`}>
                  <span className="book-sign">{BOOK}</span>
                  <span className="book-what">
                    <span className="book-name">{repo}<small>{owner}</small></span>
                    {r.about ? <span className="book-about">{r.about}</span> : null}
                    <span className="book-meta">{`${r.private ? "Private" : "Public"}${r.written ? ` · Written to ${r.written}` : ""}`}</span>
                  </span>
                  <span className="book-go">{GO}</span>
                </a>
              ); })}
            </nav>
          ) : any ? (
            <p className="home-note" role="status">No notebook fits “{q.trim()}”.</p>
          ) : (
            <div className="home-first">
              <h2>{unknown ? "Which repositories hold notes could not be told" : rows.length ? "No notebook yet" : "The app was given no repository"}</h2>
              {unknown ? <p>GitHub did not answer that just now. Every repository the app was given is listed below, and can be opened.</p>
                : rows.length ? <p>A notebook is a repository with notes of the app in it. Open one of your repositories below and turn its history on (the clock in the sidebar): from then on it is listed here, and what you write is kept in it.</p>
                : <p>Say on GitHub which repositories the app may read and write. Give it only those you want to keep notes in.</p>}
              {rows.length ? null : <a className="button" href={give} target="_blank" rel="noreferrer">Choose repositories on GitHub</a>}
            </div>
          )}

          {!failed && rest > 0 ? (
            <details className="others" open={open} onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}>
              <summary><span className="others-go">{GO}</span>Open another repository<small>{q.trim() ? `${others.length} of ${rest}` : rest}</small></summary>
              <p className="others-hint">These hold no notes of the app yet. Opening one only reads it: nothing is written to it until you turn its history on, with the clock in the sidebar. After that it is one of your notebooks.</p>
              {others.length ? (
                <nav className="others-list" aria-label="Other repositories">
                  {others.map((r) => (
                    <a className="other" key={r.name} href={`/r/${r.name}`}>
                      <span className="other-sign">{REPO}</span>
                      <span className="other-name">{r.name}</span>
                      <small>{`${r.private ? "Private" : "Public"}${r.written ? ` · ${r.written}` : ""}`}</small>
                    </a>
                  ))}
                </nav>
              ) : <p className="home-note" role="status">No repository fits “{q.trim()}”.</p>}
            </details>
          ) : null}
        </section>

        <aside className="home-side" aria-label="Help">
          <section className="side-card">
            <h2>How it works</h2>
            <ol className="steps">
              <li><b>A notebook is a repository.</b> Your notes are Markdown files in it, and every change is a commit.</li>
              <li><b>Write anywhere.</b> Here in the browser, or in the desktop app on the same repository.</li>
              <li><b>Share one note.</b> A short link shows it to whoever has it, read only, with a password if you like.</li>
            </ol>
          </section>
          <nav className="side-card side-links" aria-label="More">
            <a href={give} target="_blank" rel="noreferrer"><span><b>Repositories on GitHub</b><small>Which ones the app may reach</small></span>{OUT}</a>
            <a href="/shares"><span><b>Shared notes</b><small>Every note that stands under a link</small></span>{GO}</a>
            <a href={`${source}#install`} target="_blank" rel="noreferrer"><span><b>Desktop app</b><small>The same notes, on your computer</small></span>{OUT}</a>
            <a href="/welcome"><span><b>What a note can hold</b><small>Formulas, code, diagrams, pages</small></span>{GO}</a>
          </nav>
        </aside>
      </div>
    </>
  );
}
