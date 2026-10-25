// The desktop app to download: the files of its latest release on GitHub, for Windows and Linux
// (macOS shown, not there yet), the visitor's own system first. Open to everyone (proxy.ts); /install
// comes here too (next.config.ts). What the release is, is asked of GitHub (lib/download.ts) — where
// GitHub cannot be reached, every button goes to the releases there instead.
import { RELEASES, latestRelease, pick, systemOf, type Arch, type Asset, type Kind, type Release, type System } from "@/lib/download";
import type { Metadata } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic"; // (the visitor's system decides the order; the release itself is kept for an hour)
export const metadata: Metadata = { title: "Download Markdown Notes", description: "Markdown Notes for Windows and Linux.", robots: { index: true, follow: true } };

const SIGN: Record<System, React.ReactNode> = {
  windows: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9h17M12 9v10.5" /></svg>,
  linux: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="m7.5 10 3 2.5-3 2.5M12.5 15.5h4" /></svg>,
  macos: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="10" rx="2" /><path d="M3 18.5h18" /></svg>,
};
const DOWN = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.75v8.5m0 0L4.75 7M8 10.25 11.25 7M2.75 13.25h10.5" /></svg>;
const NAME: Record<System, string> = { windows: "Windows", linux: "Linux", macos: "macOS" };

const mb = (a?: Asset) => (a && a.size ? `${Math.max(1, Math.round(a.size / 1e6))} MB` : "");
const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : ""; };

/** A file to download: its own link, or — where the release has no such file, or was not read — the releases on GitHub. */
function Get({ release, system, arch, kind, main, children }: { release: Release | null; system: System; arch: Arch; kind: Kind; main?: boolean; children: React.ReactNode }) {
  const a = pick(release, system, arch, kind);
  return (
    <a className={main ? "button dl-main" : "dl-file"} href={a ? a.url : release?.page || RELEASES} data-file={a?.name || ""} title={a?.name}>
      {main ? DOWN : null}{children}{!main && a ? <small>{mb(a)}</small> : null}
    </a>
  );
}

function Windows({ release, mine }: { release: Release | null; mine: boolean }) {
  const a = pick(release, "windows", "x64", "setup");
  return (
    <section className="dl-card" data-system="windows" aria-labelledby="dl-windows">
      <header className="dl-head"><span className="book-sign">{SIGN.windows}</span><h2 id="dl-windows">Windows</h2>{mine ? <span className="dl-mine">Your system</span> : null}</header>
      <p className="dl-about">Windows 10 and 11, Intel or AMD (x64).</p>
      <div className="dl-go"><Get release={release} system="windows" arch="x64" kind="setup" main>Download for Windows</Get>{a ? <small className="dl-size">{mb(a)}</small> : null}</div>
      <p className="dl-note">The installer is not signed yet, so Windows warns before it runs it: choose <b>More info</b>, then <b>Run anyway</b>.</p>
    </section>
  );
}

const LINUX: [Kind, string, string][] = [
  ["appimage", "AppImage", "Any distribution. Make it executable, then start it."],
  ["deb", ".deb", "Debian, Ubuntu, Mint."],
  ["rpm", ".rpm", "Fedora, openSUSE."],
];
function Linux({ release, mine }: { release: Release | null; mine: boolean }) {
  return (
    <section className="dl-card" data-system="linux" aria-labelledby="dl-linux">
      <header className="dl-head"><span className="book-sign">{SIGN.linux}</span><h2 id="dl-linux">Linux</h2>{mine ? <span className="dl-mine">Your system</span> : null}</header>
      <p className="dl-about">x64 is for Intel and AMD processors, arm64 for ARM.</p>
      <div className="dl-rows">
        {LINUX.map(([kind, name, about]) => (
          <div className="dl-row" key={kind}>
            <span className="dl-what"><b>{name}</b><small>{about}</small></span>
            <Get release={release} system="linux" arch="x64" kind={kind}>x64</Get>
            <Get release={release} system="linux" arch="arm64" kind={kind}>arm64</Get>
          </div>
        ))}
      </div>
    </section>
  );
}

function Mac({ mine }: { mine: boolean }) {
  return (
    <section className="dl-card dl-later" data-system="macos" aria-labelledby="dl-macos">
      <header className="dl-head"><span className="book-sign">{SIGN.macos}</span><h2 id="dl-macos">macOS</h2>{mine ? <span className="dl-mine">Your system</span> : null}</header>
      <p className="dl-about">For Macs with Apple silicon.</p>
      <div className="dl-go"><span className="button dl-main" aria-disabled="true">{DOWN}Coming soon</span></div>
      <p className="dl-note">Not released yet. Meanwhile, the app works in the browser.</p>
    </section>
  );
}

export default async function Download() {
  const [agent, release] = [(await headers()).get("user-agent"), await latestRelease()];
  const mine = systemOf(agent);
  const order: System[] = ["windows", "linux", "macos"];
  if (mine) order.sort((a, b) => Number(b === mine) - Number(a === mine));
  const card = (s: System) => s === "windows" ? <Windows key={s} release={release} mine={s === mine} /> : s === "linux" ? <Linux key={s} release={release} mine={s === mine} /> : <Mac key={s} mine={s === mine} />;
  const date = release ? when(release.published) : "";
  return (
    <main className="dl" data-mine={mine || ""}>
      <header className="dl-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="home-icon" src="/welcome/icon.svg" alt="" width={44} height={44} />
        <div className="home-hello">
          <h1>Markdown Notes for {mine && mine !== "macos" ? NAME[mine] : "your computer"}</h1>
          {release
            ? <p>Version {release.version}{date ? <> · released {date}</> : null} · <a className="dl-link" href={release.page}>What is new</a></p>
            : <p role="status">The latest release could not be read from GitHub just now. <a className="dl-link" href={RELEASES}>Find it on GitHub</a></p>}
        </div>
      </header>
      <div className="dl-cards">{order.map(card)}</div>
      <footer className="dl-foot">
        <a className="dl-link" href={RELEASES}>All releases on GitHub</a>
        <a className="dl-link" href="/">Use it in the browser</a>
      </footer>
    </main>
  );
}
