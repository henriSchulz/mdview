// The name a new space's repository gets on GitHub, from the space's name: the same rule as the
// desktop app's (src-tauri/src/github.rs: repo_name, new_name) — both tests read one list
// (dev/tests/fixtures/repo-names.json). Used by the page, to show it while it is typed, and by
// the server, which makes it.

const SPELLED: Record<string, string> = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
const ends = /^[-.]+|[-.]+$/g;

/** A repository's name as GitHub takes it, from any text: ASCII letters and digits, "-", "_" and
 * "." stay; ä, ö, ü and ß are written ae, oe, ue and ss; anything else — a space too — becomes
 * "-", one for a run of them; none of "-" and "." at either end; 100 characters at most. */
export function repoName(text: string): string {
  let out = "", gap = false;
  for (const c of text) {
    const said = SPELLED[c] ?? (/^[A-Za-z0-9._-]$/.test(c) ? c : null);
    if (said === null) { gap = true; continue; }
    if (gap && out) out += "-";
    gap = false;
    out += said;
  }
  return out.replace(ends, "").slice(0, 100).replace(ends, "");
}

/** The name a space's repository is made under: mdview_ and the space's name (mdview alone, where
 * nothing of the name is left). */
export function newName(space: string): string {
  const name = repoName(space);
  return name ? repoName(`mdview_${name}`) : "mdview";
}
