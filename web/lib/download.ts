// The download page's ground (app/download): the latest release of the desktop app, read from
// GitHub, its files told apart by system, architecture and kind, and the visitor's system read
// from their browser. A release's files are named MarkdownNotes-<version>-<system>-<arch>.<ext>
// (packaging/release-name.sh); the releases before that have Tauri's own names
// (Markdown.Notes_0.1.4_amd64.deb, Markdown.Notes-0.1.4-1.x86_64.rpm …) — both are understood.
// No imports: web/test/download.test.mjs loads this file as it is.

export type System = "windows" | "linux" | "macos";
export type Arch = "x64" | "arm64";
export type Kind = "setup" | "appimage" | "deb" | "rpm" | "dmg";
export type Asset = { name: string; url: string; size: number; system: System; arch: Arch; kind: Kind };
export type Release = { version: string; tag: string; published: string; page: string; assets: Asset[] };

export const REPO = "henriSchulz/mdview";
export const RELEASES = `https://github.com/${REPO}/releases/latest`; // (where the page sends whoever it cannot serve itself)
const API = process.env.GITHUB_API || "https://api.github.com";
const FRESH = 60 * 60 * 1000; // a release read is good for an hour

const KINDS: [RegExp, System, Kind][] = [
  [/setup\.exe$/i, "windows", "setup"],
  [/\.exe$/i, "windows", "setup"],
  [/\.appimage$/i, "linux", "appimage"],
  [/\.deb$/i, "linux", "deb"],
  [/\.rpm$/i, "linux", "rpm"],
  [/\.dmg$/i, "macos", "dmg"],
];

/** What a release's file is, by its name — or null for what is not an installer (a signature, a checksum). */
export function classify(name: string): { system: System; arch: Arch; kind: Kind } | null {
  const k = KINDS.find(([re]) => re.test(name));
  if (!k) return null;
  const arch: Arch | null = /(^|[._-])(x86_64|amd64|x64)([._-]|$)/i.test(name) ? "x64" : /(^|[._-])(aarch64|arm64)([._-]|$)/i.test(name) ? "arm64" : null;
  return arch ? { system: k[1], arch, kind: k[2] } : null;
}

/** The visitor's system, from the browser's user agent — null where it is none of the three (a phone, a bot). */
export function systemOf(agent: string | null | undefined): System | null {
  const ua = agent || "";
  if (/iphone|ipad|ipod|android/i.test(ua)) return null; // (the app is for a computer; an iPad says "Macintosh", but is told apart by the browser only)
  if (/windows/i.test(ua)) return "windows";
  if (/mac os x|macintosh/i.test(ua)) return "macos";
  if (/linux|x11|cros/i.test(ua)) return "linux";
  return null;
}

/** GitHub's answer for a release, as the page needs it. */
export function releaseFrom(data: { tag_name?: string; published_at?: string; html_url?: string; assets?: { name: string; browser_download_url: string; size?: number }[] }): Release {
  const tag = data.tag_name || "";
  const assets: Asset[] = [];
  for (const a of data.assets || []) {
    const what = classify(a.name);
    if (what) assets.push({ name: a.name, url: a.browser_download_url, size: a.size || 0, ...what });
  }
  return { version: tag.replace(/^v/, ""), tag, published: data.published_at || "", page: data.html_url || RELEASES, assets };
}

/** The file of a release for a system, an architecture and a kind, if it has one. */
export function pick(release: Release | null, system: System, arch: Arch, kind: Kind): Asset | undefined {
  return release?.assets.find((a) => a.system === system && a.arch === arch && a.kind === kind);
}

// The latest release, asked of GitHub at most once an hour (without a token GitHub answers sixty
// times an hour per address). An answer that fails is not kept: the next visitor asks again, and
// meanwhile the release read before is shown, or — with none — the link to the releases on GitHub.
let kept: { at: number; release: Release } | null = null;
export async function latestRelease(): Promise<Release | null> {
  if (kept && Date.now() - kept.at < FRESH) return kept.release;
  try {
    const res = await fetch(`${API}/repos/${REPO}/releases/latest`, { headers: { accept: "application/vnd.github+json", "user-agent": "mdview-web" }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const release = releaseFrom(await res.json());
    kept = { at: Date.now(), release };
    return release;
  } catch {
    return kept ? kept.release : null;
  }
}
