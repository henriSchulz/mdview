// The desktop app to download: the files of its latest release on GitHub, for Windows and Linux
// (macOS shown, not there yet). Three tall cards side by side, always in the same order; the card
// of the visitor's own system stands raised and carries the strong button, the others stay flat
// (Henri chose it from dev/download-lab.html, approach 2). Open to everyone (proxy.ts); /install
// comes here too (next.config.ts). What the release is, is asked of GitHub (lib/download.ts) —
// where GitHub cannot be reached, every button goes to the releases there instead.
import { RELEASES, latestRelease, pick, systemOf, type Arch, type Asset, type Kind, type Release, type System } from "@/lib/download";
import type { Metadata } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic"; // (the visitor's system decides which card is raised; the release itself is kept for an hour)
export const metadata: Metadata = { title: "Download Markdown Notes", description: "Markdown Notes for Windows and Linux.", robots: { index: true, follow: true } };

const icon = (d: React.ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true">{d}</svg>;
const SIGN: Record<System, React.ReactNode> = {
  windows: icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9h17M12 9v10.5" /></>),
  linux: icon(<><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="m7.5 10 3 2.5-3 2.5M12.5 15.5h4" /></>),
  macos: icon(<><rect x="5" y="5" width="14" height="10" rx="2" /><path d="M3 18.5h18" /></>),
};
const DOWN = icon(<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />);
const REFRESH = icon(<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4" />);
const GLOBE = icon(<><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" /></>);
const VERSION = icon(<path d="M6 4v16M6 8h8a4 4 0 0 1 0 8H6" />);

const mb = (a?: Asset) => (a && a.size ? `${Math.max(1, Math.round(a.size / 1e6))} MB` : "");
const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : ""; };
/** Where a file is: its own link, or — where the release has no such file, or was not read — the releases on GitHub. */
const href = (release: Release | null, a?: Asset) => (a ? a.url : release?.page || RELEASES);

/** A card: its sign, name and what it runs on; raised, with the badge and the strong button, where it is the visitor's. */
function Card({ system, mine, later, children }: { system: System; mine: boolean; later?: boolean; children: React.ReactNode }) {
  const name = system === "windows" ? "Windows" : system === "linux" ? "Linux" : "macOS";
  return (
    <section className={`dl-card${mine ? " dl-mine" : ""}${later ? " dl-later" : ""}`} data-system={system} aria-labelledby={`dl-${system}`}>
      {mine ? <span className="dl-badge">Your system</span> : null}
      <div className="dl-glyph">{SIGN[system]}</div>
      <h2 id={`dl-${system}`}>{name}</h2>
      {children}
    </section>
  );
}

function Windows({ release, mine }: { release: Release | null; mine: boolean }) {
  const a = pick(release, "windows", "x64", "setup");
  return (
    <Card system="windows" mine={mine}>
      <p className="dl-req">Windows 10 and 11<br />Intel or AMD</p>
      <a className={mine ? "dl-btn" : "dl-btn dl-soft"} href={href(release, a)} data-file={a?.name || ""} title={a?.name}>{DOWN}Download</a>
      <p className="dl-size">Installer{a ? ` · ${mb(a)}` : ""}</p>
      <p className="dl-tip">Not signed yet: Windows asks first — <b>More info</b>, then <b>Run anyway</b>.</p>
    </Card>
  );
}

const CHIPS: [Arch, Kind, string][] = [["arm64", "appimage", "AppImage arm64"], ["x64", "deb", ".deb"], ["arm64", "deb", ".deb arm64"], ["x64", "rpm", ".rpm"], ["arm64", "rpm", ".rpm arm64"]];
function Linux({ release, mine }: { release: Release | null; mine: boolean }) {
  const a = pick(release, "linux", "x64", "appimage");
  return (
    <Card system="linux" mine={mine}>
      <p className="dl-req">Any distribution<br />x64 and arm64</p>
      <a className={mine ? "dl-btn" : "dl-btn dl-soft"} href={href(release, a)} data-file={a?.name || ""} title={a?.name}>{DOWN}Download AppImage</a>
      <p className="dl-size">x64{a ? ` · ${mb(a)}` : ""}</p>
      <div className="dl-chips">
        {CHIPS.map(([arch, kind, label]) => {
          const f = pick(release, "linux", arch, kind);
          return <a key={label} className="dl-chip" href={href(release, f)} data-file={f?.name || ""} title={f?.name}>{label}{f ? <small> {mb(f)}</small> : null}</a>;
        })}
      </div>
    </Card>
  );
}

function Mac({ mine }: { mine: boolean }) {
  return (
    <Card system="macos" mine={mine} later>
      <p className="dl-req">Apple silicon<br />&nbsp;</p>
      <span className="dl-btn dl-soft" aria-disabled="true">Coming soon</span>
      <p className="dl-size">&nbsp;</p>
      <p className="dl-tip">Meanwhile: <a className="dl-link" href="/">use it in the browser</a>.</p>
    </Card>
  );
}

export default async function Download() {
  const [agent, release] = [(await headers()).get("user-agent"), await latestRelease()];
  const mine = systemOf(agent);
  const date = release ? when(release.published) : "";
  return (
    <main className="dl" data-mine={mine || ""}>
      <header className="dl-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/welcome/icon.svg" alt="" width={56} height={56} />
        <h1>Get Markdown Notes</h1>
        {release
          ? <p>Version {release.version}{date ? <> · {date}</> : null} · <a className="dl-link" href={release.page}>What’s new</a></p>
          : <p role="status">The latest release could not be read from GitHub just now. <a className="dl-link" href={RELEASES}>Find it on GitHub</a></p>}
      </header>
      <div className="dl-trio">
        <Windows release={release} mine={mine === "windows"} />
        <Linux release={release} mine={mine === "linux"} />
        <Mac mine={mine === "macos"} />
      </div>
      <div className="dl-strip">
        <div>{REFRESH}<span><b>Stays up to date</b>The AppImage and the Windows app update themselves.</span></div>
        <div>{GLOBE}<span><b>Or in the browser</b>The same notes, signed in with GitHub. <a className="dl-link" href="/">Open</a></span></div>
        <div>{VERSION}<span><b>Every version</b>Older releases and their notes are on <a className="dl-link" href={RELEASES}>GitHub</a>.</span></div>
      </div>
    </main>
  );
}
