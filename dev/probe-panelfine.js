/* Development probe (dev/rig.sh panelfine): the panel at the right (Insert, Format, Style, Info) and where it stands
 * (Henri, 2026-10-25): a press anywhere outside it — the note, the toolbar, the sidebar — closes it; a press on it, on its
 * rail or in a menu it opened leaves it open. In All Notes there is no panel and no rail at all: not seen, not to be
 * pressed, not opened by Ctrl+Alt+P — and it comes back as it was when All Notes is left. Nor the sidebar's button at the
 * top left (Henri, 2026-10-25), which is back with the note. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] }; const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    const P = window.MdPage, body = document.body;
    await until(() => MdView.core.folder && MdView.core.folder.root);
    await sleep(600);
    window.MdHost.post(JSON.stringify({ type: "note", path: MdView.core.folder.root + "/Alpha.md" }));
    ok("a note of the folder is open", await until(() => MdView.core.current && MdView.core.current.text.includes("# Alpha"), 8000), MdView.core.current && MdView.core.current.path);
    await sleep(800);
    // (the rig's window can be narrower than a window is: the page is told it has room)
    if (innerWidth < 1200) Object.defineProperty(window, "innerWidth", { configurable: true, get: () => 1200 });
    if (window.MdOverview && MdOverview.isOpen) { MdOverview.close(); await sleep(400); }
    P.setMode("active");
    ok("the active mode", await until(() => body.dataset.view === "active" && window.MdActive && MdActive.panel && MdActive.view.pm), body.dataset.view);
    await sleep(500);
    const panel = MdActive.panel, el = panel.el, rail = panel.rail;
    const seen = (x) => { const s = getComputedStyle(x); return s.visibility === "visible" && +s.opacity > 0.5 && s.display !== "none"; };
    const gone = (x) => { const s = getComputedStyle(x); return s.visibility === "hidden" || s.display === "none"; };
    const press = (x, at) => {
      const r = x.getBoundingClientRect(), cx = at ? at[0] : r.left + Math.min(20, r.width / 2), cy = at ? at[1] : r.top + Math.min(10, r.height / 2);
      const opt = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
      x.dispatchEvent(new PointerEvent("pointerdown", opt)); x.dispatchEvent(new MouseEvent("mousedown", opt));
      x.dispatchEvent(new PointerEvent("pointerup", { ...opt, buttons: 0 })); x.dispatchEvent(new MouseEvent("mouseup", { ...opt, buttons: 0 })); x.dispatchEvent(new MouseEvent("click", { ...opt, buttons: 0 }));
    };
    const open = async () => { panel.show(true, false); await until(() => panel.isOpen); await sleep(350); return panel.isOpen; };

    // --- a press outside closes it
    ok("the panel opens beside the note, its rail with it", await open() && seen(el) && seen(rail), [panel.isOpen, getComputedStyle(el).visibility, getComputedStyle(rail).visibility]);
    press(el.querySelector(".rp-title") || el);
    await sleep(200);
    ok("a press on the panel leaves it open", panel.isOpen);
    const other = [...rail.querySelectorAll(".rp-tab")].find((b) => b.dataset.tab !== el.dataset.tab && !b.disabled);
    press(other);
    await sleep(200);
    ok("a press on another part's sign in the rail: open at that part", panel.isOpen && el.dataset.tab === other.dataset.tab, [panel.isOpen, el.dataset.tab, other.dataset.tab]);
    const para = MdActive.view.dom.querySelector("p");
    press(para);
    await sleep(350);
    ok("a press in the note closes it", !panel.isOpen && !body.hasAttribute("data-panel"), panel.isOpen);
    ok("… and the press still is the note's: the caret goes there", MdActive.view.pm.hasFocus() || document.activeElement === MdActive.view.pm.dom, document.activeElement && document.activeElement.className);
    ok("… closed, as the settings keep it", window.MdPrefs.panel === false, window.MdPrefs.panel);
    await open();
    press(document.getElementById("toolbar"));
    await sleep(300);
    ok("a press on the toolbar closes it", !panel.isOpen);
    await open();
    const tile = el.querySelector(".rp-tile");
    if (tile) { panel.setTab("insert"); await sleep(200); press(el.querySelector(".rp-tile")); await sleep(300); ok("a tile pressed: the panel stays (what it put in is beside it)", panel.isOpen); }
    await open();
    // a menu of the app over the note (a right click's menu): pressed in, the panel stays; pressed beside, the menu goes first
    const menu = document.querySelector(".actmenu");
    if (menu) { menu.dataset.open = ""; press(menu); delete menu.dataset.open; await sleep(200); ok("a press in one of the app's menus leaves it open", panel.isOpen); }

    // --- All Notes: no panel, no rail
    await open();
    document.querySelector('[data-act="overview"]').click();
    await until(() => MdOverview.isOpen);
    await sleep(700);
    o.inOverview = { panel: [getComputedStyle(el).visibility, getComputedStyle(el).opacity, getComputedStyle(el).display], rail: [getComputedStyle(rail).visibility, getComputedStyle(rail).opacity, getComputedStyle(rail).display], dataPanel: body.hasAttribute("data-panel"), dataRail: body.hasAttribute("data-rail") };
    out("look", {}); await sleep(600);
    ok("in All Notes the panel is not there", gone(el), o.inOverview.panel);
    ok("… nor its rail", gone(rail), o.inOverview.rail);
    const hit = document.elementFromPoint(innerWidth - 30, 200);
    ok("… nothing of it at the window's right to be pressed", !(hit && hit.closest("#rpanel, #rrail")), hit && (hit.id || hit.className));
    const side = document.querySelector("#tabs .tab-side");
    ok("… nor the sidebar's button at the top left", !!side && !side.getClientRects().length, side && getComputedStyle(side).display);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await sleep(400);
    ok("… Ctrl+Alt+P there opens nothing", gone(el) && gone(rail), [getComputedStyle(el).visibility, getComputedStyle(rail).visibility]);
    MdOverview.close();
    await until(() => !MdOverview.isOpen);
    await sleep(600);
    ok("All Notes left: the rail is back beside the note", seen(rail), getComputedStyle(rail).visibility);
    ok("… and the sidebar's button", side.getClientRects().length > 0, getComputedStyle(side).display);
  } catch (e) { o.error = String(e && e.stack || e); }
  o.errors = errs;
  out("panelfine", o);
})();
