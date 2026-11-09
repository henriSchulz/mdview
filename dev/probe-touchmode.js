/* Development probe (rig.sh touchmode): the window laid out for a finger in the desktop's tablet mode (docs/BUGS.md 116).
 * The rig starts the app with MDVIEW_TOUCH=1, as Velum's settings would say "tablet": true. Its sizes, the chosen tab's cross,
 * the mode switched off and on again through setTheme, the sidebar drawn in from the left edge, and two fingers drawn
 * sideways for back and forward. The touches are made up here (events with their touches put on them): that WebKitGTK hands a
 * real touch screen's touches to the page as such is `rig.sh gtktouch`'s. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = document.documentElement, body = document.body;
  const o = { steps: [] };
  const ok = (label, good, detail) => o.steps.push((good ? "ok   " : "FAIL ") + label + (good || detail === undefined ? "" : "  (" + JSON.stringify(detail) + ")"));
  let last = body;
  const touch = (type, pts, at) => {
    const el = at || (pts.length ? document.elementFromPoint(pts[0][0], pts[0][1]) : last) || body;
    last = el;
    const list = type === "touchend" ? [] : pts.map(([x, y], i) => ({ identifier: i, clientX: x, clientY: y, target: el }));
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "touches", { value: list });
    el.dispatchEvent(ev);
  };
  const box = (sel) => { const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0); if (!el) return null; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), shown: cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.5 }; };
  try {
    await document.fonts.ready; await sleep(1200);
    ok("the window is laid out for a finger (data-touch)", root.hasAttribute("data-touch"));
    window.MdHost.post(JSON.stringify({ type: "note", path: window.MdView.core.folder.root + "/a.md" }));
    await sleep(1500);
    window.MdHost.post(JSON.stringify({ type: "note", path: window.MdView.core.folder.root + "/b.md" }));
    await sleep(1500);
    const tb = box("#toolbar button"), row = box(".sb-row");
    ok("a toolbar button is 40 px high", !!tb && tb.h >= 40, tb);
    ok("a sidebar row is 44 px high", !row || row.h >= 44, row);
    const x = box('.tab[aria-selected="true"] .tab-x'), other = box('.tab[aria-selected="false"] .tab-x');
    ok("the chosen tab has its cross, as large as a finger", !!x && x.shown && x.w >= 40, x);
    ok("the other tabs' crosses are not there to be hit", !other || !other.shown, other);
    const css = document.getElementById("theme").textContent, mode = body.dataset.mode;
    window.MdView.setTheme(css, mode, false); await sleep(300);
    const tb2 = box("#toolbar button");
    ok("tablet mode off: no data-touch, the toolbar a mouse's again", !root.hasAttribute("data-touch") && !!tb2 && tb2.h < 40, tb2);
    window.MdView.setTheme(css, mode, true); await sleep(300);
    ok("tablet mode on again", root.hasAttribute("data-touch"));

    // the sidebar drawn in from the left edge, and back
    if (body.dataset.sidebar === "open") { window.MdPage.showSidebar(false, false); await sleep(400); }
    const y = Math.round(innerHeight / 2);
    touch("touchstart", [[4, y]]); touch("touchmove", [[30, y]]); touch("touchmove", [[70, y]]); touch("touchend", []);
    await sleep(500);
    ok("a finger drawn in from the left edge brings the sidebar out", body.dataset.sidebar === "peek", body.dataset.sidebar);
    out("peek", {}); await sleep(1500); // (rig.sh takes its picture)
    const sb = document.getElementById("sidebar");
    touch("touchstart", [[120, y]], sb); touch("touchmove", [[90, y]], sb); touch("touchmove", [[60, y]], sb); touch("touchend", [], sb);
    await sleep(500);
    ok("drawn back to the left it goes", body.dataset.sidebar === "closed", body.dataset.sidebar);
    touch("touchstart", [[200, y]]); touch("touchmove", [[260, y]]); touch("touchend", []);
    await sleep(300);
    ok("a finger drawn right away from the edge does not bring it", body.dataset.sidebar === "closed", body.dataset.sidebar);

    // two fingers sideways: back and forward
    const went = [], navGo = window.MdPage.navGo;
    window.MdPage.navGo = (d) => { went.push(d); return true; };
    const two = (dx) => { const cx = Math.round(innerWidth / 2); touch("touchstart", [[cx - 40, y], [cx + 40, y]]); for (let i = 1; i <= 6; i++) touch("touchmove", [[cx - 40 + dx * i / 6, y], [cx + 40 + dx * i / 6, y]]); };
    two(140); await sleep(50);
    const nav = document.getElementById("swipenav");
    out("chevron", {}); await sleep(1200);
    ok("the chevron is out, full, on the left", !!nav && nav.hasAttribute("data-on") && nav.hasAttribute("data-full") && nav.dataset.side === "left");
    touch("touchend", []); await sleep(300);
    two(-140); touch("touchend", []); await sleep(300);
    two(50); touch("touchend", []); await sleep(300);
    ok("drawn right goes back, left forward; a short way nothing", JSON.stringify(went) === "[-1,1]", went);
    ok("the chevron has gone", !nav.hasAttribute("data-on"));
    window.MdPage.navGo = navGo;
  } catch (e) { o.error = String(e && e.stack || e); }
  out("touchmode", o);
})();
