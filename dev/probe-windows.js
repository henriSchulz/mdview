/* Development probe for a system the rig does not run on (.github/workflows/system-probe.yml): what the
 * page is, on that system — where it is served from, whether its style sheets and colours are
 * there, whether a picture beside the note shows, whether a file handed over is put in, what the
 * sidebar holds. It asserts little and reports much: the report is read by a person. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(100); } return false; };
  const o = { errors: [], toasts: [] };
  addEventListener("error", (e) => o.errors.push(String(e.message || e.error || e).slice(0, 300) + " @" + String(e.filename || "").split("/").pop() + ":" + e.lineno), true);
  addEventListener("unhandledrejection", (e) => o.errors.push("rejected: " + String(e.reason).slice(0, 300)));
  addEventListener("securitypolicyviolation", (e) => o.errors.push(`csp: ${e.violatedDirective} ${String(e.blockedURI).slice(0, 120)}`));
  try {
    await sleep(2500);
    const css = (el, p) => getComputedStyle(el).getPropertyValue(p).trim();
    const root = document.documentElement, cur = (window.MdView && MdView.core && MdView.core.current) || {};
    const toast0 = MdView.core.toast; // (what the application says goes wrong is part of the report)
    o.where = { href: location.href.slice(0, 200), origin: location.origin, files: (window.MdHost || {}).files, tauri: !!window.__TAURI_INTERNALS__, agent: navigator.userAgent.slice(0, 160) };
    o.note = { path: cur.path, name: cur.name, readonly: cur.readonly, view: document.body.dataset.view, mode: document.body.dataset.mode, folder: document.body.dataset.folder ?? null, sidebar: document.body.dataset.sidebar ?? null };
    o.sheets = [...document.styleSheets].map((s) => { let n = -1; try { n = s.cssRules.length; } catch (e) { n = String(e).slice(0, 60); } return [String(s.href || "inline").split("/").slice(-2).join("/"), n]; });
    o.colours = Object.fromEntries(["--c-background", "--c-foreground", "--c-accent", "--c-red", "--bg", "--fg", "--accent", "--line"].map((k) => [k, css(root, k)]));
    o.looks = { body: css(document.body, "background-color"), text: css(document.body, "color"), font: css(document.body, "font-family").slice(0, 80), h1: document.querySelector("#content h1") && css(document.querySelector("#content h1"), "font-size"), theme: (document.getElementById("theme") || {}).textContent ? document.getElementById("theme").textContent.slice(0, 160) : null, scheme: css(root, "color-scheme") };
    o.toolbar = [...document.querySelectorAll("#toolbar .tb")].filter((b) => b.offsetParent).map((b) => b.dataset.act || b.dataset.mode || "?");
    o.pictures = [...document.querySelectorAll("#content img")].map((i) => ({ src: i.getAttribute("src").slice(0, 160), ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth }));
    o.sidebarRows = [...document.querySelectorAll("#sidebar .sb-row")].slice(0, 12).map((r) => [r.textContent.trim().slice(0, 40), (r.dataset.real || r.dataset.path || "").slice(0, 120)]);
    out("first", o);

    // ---- a file handed over, as a picture chosen in the system's window or dropped on the note is
    if (cur.path && window.__probePicture) {
      MdView.setMode("active");
      o.active = await until(() => document.body.dataset.view === "active" && window.MdActive && MdActive.view && MdActive.view.pm, 15000);
      await sleep(500);
      if (o.active) {
        const V = MdActive.view, before = V.serialize(false);
        V.focus();
        window.MdHost.post(JSON.stringify({ type: "dropfiles", uris: [window.__probePicture], path: cur.path }));
        o.inserted = await until(() => V.serialize(false) !== before, 8000);
        await sleep(1200);
        o.markdownEnd = V.serialize(false).slice(-200);
        o.activePictures = [...document.querySelectorAll("#active img")].map((i) => ({ src: String(i.getAttribute("src")).slice(0, 160), ok: i.complete && i.naturalWidth > 0 }));
        // the colours a block can be given (the "/" menu's, a right click's)
        o.deco = (MdView.core.DECO_COLORS || []).slice(0, 12);
        o.slashColour = (() => { try { const e = MdActive.slash.entries(V.pm).find((x) => x && x.key === "slash.color"); return e ? (e.items || []).filter(Boolean).length : "no entry"; } catch (e) { return String(e).slice(0, 120); } })();
      }
    }
    void toast0;
    out("windows", o);

    // ---- the system's own windows: a picture chosen for the note, then a folder opened. The probe asks; whoever runs it sees
    // the window (and types the path into it); what came of it is reported.
    if (cur.path && window.__probePicture && o.active) {
      const V = MdActive.view, before = V.serialize(false);
      MdActive.context.INSERT.image(V.pm);
      out("asked-picture", {});
      const got = await until(() => V.serialize(false) !== before, 30000);
      await sleep(1000);
      out("picture", { inserted: got, markdownStart: V.serialize(false).slice(0, 160), errors: o.errors });
    }
    const folderWas = document.body.dataset.folder ?? null, rowsWas = document.querySelectorAll("#sidebar .sb-row").length;
    window.MdHost.post(JSON.stringify({ type: "folder" }));
    out("asked-folder", {});
    const opened = await until(() => (document.body.dataset.folder ?? null) !== folderWas || document.querySelectorAll("#sidebar .sb-row").length !== rowsWas, 30000);
    await sleep(1000);
    out("folder", { opened, folder: document.body.dataset.folder ?? null, sidebar: document.body.dataset.sidebar ?? null, rows: [...document.querySelectorAll("#sidebar .sb-row")].slice(0, 12).map((r) => r.textContent.trim().slice(0, 40)), errors: o.errors });
    return;
  } catch (e) {
    o.error = String((e && e.stack) || e).slice(0, 600);
  }
  out("windows", o);
})();
