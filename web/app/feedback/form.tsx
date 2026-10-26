"use client";
// The form: a bug or a feature, what it is, and — if one likes — how to answer and where it
// happened. Sent to app/feedback/send; after that, thanks.
import { useEffect, useRef, useState } from "react";

type Kind = "bug" | "feature";
const PLATFORMS = ["Web", "iPad", "Desktop Linux", "Desktop Windows", "Desktop macOS"];
const DONE = <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9.25" /><path d="m8 12.4 2.7 2.6L16 9.4" /></svg>;
const SAY: Record<Kind, { title: string; body: string; sent: string }> = {
  bug: { title: "What went wrong, in a line", body: "What happened, and what did you expect?\n\nSteps to reproduce:\n1. \n2. \n3. ", sent: "Your bug report has arrived." },
  feature: { title: "What you would like, in a line", body: "What would you like the app to do, and what for?", sent: "Your suggestion has arrived." },
};

/** Where this form is filled in, as far as the browser tells: the platform, and the browser and its system. */
function here(): { platform: string; version: string } {
  const ua = navigator.userAgent;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if ("__TAURI_INTERNALS__" in window) return { platform: /Windows/.test(ua) ? "Desktop Windows" : /Mac/.test(ua) ? "Desktop macOS" : "Desktop Linux", version: "" };
  const got = (re: RegExp, name: string) => { const m = re.exec(ua); return m ? `${name} ${m[1]}` : ""; };
  const browser = got(/Edg\/(\d+)/, "Edge") || got(/Firefox\/(\d+)/, "Firefox") || got(/(?:Chrome|CriOS)\/(\d+)/, "Chrome") || got(/Version\/([\d.]+).*Safari/, "Safari");
  const system = ipad ? "iPadOS" : /iPhone/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return { platform: ipad ? "iPad" : "Web", version: [browser, system].filter(Boolean).join(" on ") };
}

export function Form({ kind: first, login }: { kind: Kind; login: string }) {
  const [kind, setKind] = useState<Kind>(first);
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [email, setEmail] = useState("");
  const [platform, setPlatform] = useState(""), [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const [wrong, setWrong] = useState<{ field: string; error: string } | null>(null);
  const trap = useRef<HTMLInputElement>(null), titleField = useRef<HTMLInputElement>(null);
  useEffect(() => { const h = here(); setPlatform(h.platform); setVersion(h.version); }, []);

  const choose = (k: Kind) => {
    setKind(k);
    const u = new URL(location.href); u.searchParams.set("kind", k); history.replaceState(null, "", u); // (a reload keeps the choice)
  };
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setWrong(null);
    try {
      const res = await fetch("/feedback/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, title, body, email, platform, version, website: trap.current?.value || "" }) });
      const said = await res.json().catch(() => ({}));
      if (res.ok) { setSent(true); return; }
      setWrong({ field: said.field || "", error: said.error || "It could not be sent. Try again in a moment." });
    } catch {
      setWrong({ field: "", error: "The server could not be reached. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };
  const again = () => { setTitle(""); setBody(""); setSent(false); setTimeout(() => titleField.current?.focus(), 0); };
  const flag = (f: string) => (wrong?.field === f ? { "data-wrong": "" } : {});
  const said = (f: string) => (wrong?.field === f ? <span className="fb-wrong" role="alert">{wrong.error}</span> : null);

  return (
    <div className="card fb">
      <header className="fb-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/welcome/icon.svg" alt="" width={40} height={40} />
        <div>
          <h1>Send Feedback</h1>
          <p>Report a bug in Markdown Notes, or suggest a feature.</p>
        </div>
      </header>
      {sent ? (
        <div className="fb-done" role="status">
          {DONE}
          <h1>Thank you</h1>
          <p>{SAY[kind].sent} {email ? "If there is a question about it, you will get an e-mail." : "Every one is read."}</p>
          <div>
            <button className="link" type="button" onClick={again}>Send Another</button>
            <a className="button" href="/">Back to the App</a>
          </div>
        </div>
      ) : (
        <form onSubmit={send} noValidate>
          <div className="seg" role="radiogroup" aria-label="Kind">
            <span className="seg-thumb" aria-hidden="true" style={{ width: "calc(50% - 2px)", transform: kind === "feature" ? "translateX(100%)" : "none" }} />
            <button type="button" role="radio" aria-checked={kind === "bug"} onClick={() => choose("bug")}>Bug</button>
            <button type="button" role="radio" aria-checked={kind === "feature"} onClick={() => choose("feature")}>Feature</button>
          </div>
          <label className="fb-field" {...flag("title")}>
            <span>Title</span>
            <input ref={titleField} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={SAY[kind].title} autoComplete="off" required />
            {said("title")}
          </label>
          <label className="fb-field" {...flag("body")}>
            <span>Description</span>
            <textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} placeholder={SAY[kind].body} required />
            {said("body") || <span className="fb-hint">Markdown is fine. Title and description are posted publicly on GitHub.</span>}
          </label>
          <div className="fb-pair">
            <label className="fb-field" {...flag("platform")}>
              <span>Platform <small>optional</small></span>
              <select name="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="">Not said</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {said("platform")}
            </label>
            <label className="fb-field" {...flag("version")}>
              <span>App version or browser <small>optional</small></span>
              <input name="version" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={120} placeholder="e.g. 0.9.2, or Firefox 140" autoComplete="off" />
              {said("version")}
            </label>
          </div>
          <label className="fb-field" {...flag("email")}>
            <span>E-mail <small>optional</small></span>
            <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="you@example.com" autoComplete="email" />
            {said("email") || <span className="fb-hint">Only for questions about this. Nobody else sees it.</span>}
          </label>
          {/* (for a program that fills in every field: a person never sees this one) */}
          <div className="fb-trap" aria-hidden="true">
            <label>Website <input ref={trap} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
          </div>
          {wrong && !["title", "body", "platform", "version", "email"].includes(wrong.field) ? <p className="fb-error" role="alert">{wrong.error}</p> : null}
          <div className="fb-foot">
            <p>{login ? `Sent as @${login}` : "No sign-in needed."}</p>
            <button className="button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
