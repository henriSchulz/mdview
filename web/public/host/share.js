/* mdview on the web — the host of a note that was shared: one note, for whoever has its link, to
 * be read and nothing else. The page is the app's own (viewer.js and friends); this stands where
 * host.js does for a repository, and knows far less: the note's text, where its links lead, and
 * the addresses of the files that go with it (/s/<owner>/<repo>/<id>/data, …/file/…). Nothing of
 * the repository's other files is told to it, and nothing it is told to write is written. */
"use strict";
(() => {
  const C = window.MdWebCore, W = window.MdWeb; // { owner, repo, share }
  const AT = `/s/${encodeURIComponent(W.owner)}/${encodeURIComponent(W.repo)}/${encodeURIComponent(W.share)}`, FILES = location.origin + AT + "/file", BASE = `/${W.owner}/${W.repo}`;
  const tell = (name, ...args) => { const f = window.MdView && window.MdView[name]; if (f) return f(...args); };
  const toast = (text) => tell("toast", text);
  const fileUrl = (path) => FILES + path.slice(BASE.length).split("/").map(encodeURIComponent).join("/");
  const load = (key, or) => { try { return JSON.parse(localStorage.getItem(key)) ?? or; } catch { return or; } };
  const keep = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* (not kept) */ } };
  const NOT_SHARED = "This was not shared with the note";
  let prefs = { ...window.MdPrefs }, note = null; // note: { path, text, links, vault }
  // (the mark the page that waited put on the address — lib/sharepage.ts, waitFirst — is not the link's: taken off again)
  try { const u = new URL(location.href); if (u.searchParams.has("go")) { u.searchParams.delete("go"); history.replaceState(history.state, "", u.pathname + u.search + u.hash); } } catch { /* (it stays) */ }

  // (the note is there, or it is said why not: the window's ring has done its part)
  const shown = () => { const boot = document.getElementById("boot"); if (boot) { boot.dataset.done = ""; setTimeout(() => boot.remove(), 600); } };
  function render(more = {}) {
    tell("render", { name: C.nameOf(note.path), path: note.path, base: fileUrl(C.dirOf(note.path)) + "/", text: note.text, links: note.links, vault: note.vault,
      readonly: "a shared note", canBack: false, error: null, fragment: location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : null, startMode: "read", ...more });
    requestAnimationFrame(shown);
  }
  /* The note as it is now: asked for again when the tab is come back to, shown anew if it changed. */
  async function look() {
    const res = await fetch(AT + "/data", { cache: "no-store" });
    if (res.status === 401 || res.status === 404) { location.reload(); return false; } // (a password is asked for now, or the link shows nothing any more: the server's page says which)
    if (!res.ok) throw new Error("The note could not be read");
    const now = await res.json(), changed = !note || now.text !== note.text || JSON.stringify(now.links) !== JSON.stringify(note.links);
    note = now;
    return changed;
  }

  const on = {
    link({ href }) {
      const to = C.linkPath(href, FILES);
      if (!to) { if (/^(https?:|mailto:)/i.test(href) && !href.startsWith(location.origin + "/")) window.open(href, "_blank", "noopener,noreferrer"); return; }
      if (to.path === note.path) { if (to.fragment) tell("scrollToFragment", to.fragment, true); return; }
      // (a file that goes with the note — a file block's — is opened, or handed out)
      if ((note.files || []).includes(to.path.slice(BASE.length + 1)) && !C.isMd(to.path)) return void window.open(fileUrl(to.path), "_blank", "noopener,noreferrer");
      toast(NOT_SHARED);
    },
    wikilink({ target }) {
      const to = note.links[target];
      if (to && to.path === note.path && target.includes("#")) return tell("scrollToFragment", target.slice(target.indexOf("#") + 1), true);
      toast(to ? NOT_SHARED : `Note “${target.split("#")[0]}” doesn't exist`);
    },
    resolve({ target }) { tell("linkResolved", target, (target && note.links[target]) || null); },
    reload() { look().then(() => render({ keepScroll: true })).catch(() => {}); },
    async pdfdata({ path, id }) { // (a PDF the note embeds: its bytes, in pieces)
      try {
        const res = await fetch(fileUrl(path));
        if (!res.ok) throw new Error("Can't read file");
        const bytes = new Uint8Array(await res.arrayBuffer()), SIZE = 3000000, n = Math.max(1, Math.ceil(bytes.length / SIZE));
        for (let i = 0; i < n; i++) {
          let bin = "";
          const part = bytes.subarray(i * SIZE, (i + 1) * SIZE);
          for (let k = 0; k < part.length; k += 0x8000) bin += String.fromCharCode.apply(null, part.subarray(k, k + 0x8000));
          tell("pdfChunk", id, i, n, btoa(bin), null);
        }
      } catch (e) { tell("pdfChunk", id, 0, 1, "", String(e.message || e)); }
    },
    prefs({ prefs: changed }) { prefs = { ...prefs, ...(changed || {}) }; keep("mdview:set", { ...load("mdview:set", {}), ...(changed || {}) }); tell("setPrefs", prefs); },
    "settings-info"() {
      tell("settingsInfo", { version: "web", configDir: "", aiKey: { set: false, tail: "", env: false }, aiModel: "", deviceName: "", deviceId: "", home: "",
        hide: ["page:ai", "page:history", "githubAccount", "githubGet", "hinting", "configDir"], history: { state: "none" }, github: { user: null, repos: [] } });
    },
    copy({ text }) { navigator.clipboard?.writeText(text || "").catch(() => {}); },
    print() { window.print(); },
    editcmd({ cmd }) { try { document.execCommand(String(cmd || "").toLowerCase()); } catch { /* (not this browser's) */ } },
    // (everything that would write, open another note, or leave: there is one note here, to be read)
    save() { tell("saveFailed", "a shared note"); },
  };
  function hear(json) {
    let m;
    try { m = JSON.parse(json); } catch { return; }
    const f = on[m.type];
    if (f) Promise.resolve().then(() => f(m)).catch((e) => console.error("mdview share:", m.type, e));
  }

  async function start() {
    const waiting = window.MdHost.said || [];
    window.MdHost.post = hear;
    try { if (!(await look()) && !note) return; } catch (e) {
      shown();
      return void tell("render", { name: "Shared note", path: BASE, base: FILES + "/", text: "", links: {}, error: String(e.message || e), readonly: "a shared note", canBack: false });
    }
    render();
    for (const m of waiting) hear(m);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) look().then((changed) => { if (changed) render({ keepScroll: true }); }).catch(() => {}); });
  }
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", () => tell("setTheme", W.themes[dark.matches ? "dark" : "light"], dark.matches ? "dark" : "light"));
  start();
})();
