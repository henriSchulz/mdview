/* Development probe (rig.sh fingerstill): a finger's press on a button of the window moves nothing. WebKitGTK says "a finger" only
 * with the press itself (viewer/hand.js), so what follows from that happens under the finger, before the lift that makes the click.
 * The hand's change is made here by a pointer event of type touch: that a real tap sets data-finger is `rig.sh gtktouch`'s. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const root = document.documentElement;
  const o = { steps: [] };
  const ok = (label, good, detail) => o.steps.push((good ? "ok   " : "FAIL ") + label + (good || detail === undefined ? "" : "  (" + JSON.stringify(detail) + ")"));
  const snap = () => {
    const rows = {};
    for (const el of document.querySelectorAll("#tabs, #toolbar, #tabs button, #toolbar button, #rrail, #rrail button, #settings-btn, #ai-bubble")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top >= innerHeight) continue;
      rows[(el.id ? "#" + el.id : "") + (el.dataset.act ? "[" + el.dataset.act + "]" : "") + (el.dataset.mode ? "{" + el.dataset.mode + "}" : "") + (el.dataset.tab ? "<" + el.dataset.tab + ">" : "")] = [r.x, r.y, r.width, r.height].map(Math.round).join(",");
    }
    return rows;
  };
  const moved = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
  const say = () => ({ look: root.dataset.look, refined: root.dataset.velumLook || "", modes: [...document.querySelectorAll("[data-mode]")].map((e) => e.dataset.mode).join(" ") });
  const press = (el, type) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", pointerId: 7, isPrimary: true }));
  try {
    await document.fonts.ready; await sleep(1200);
    window.MdHost.post(JSON.stringify({ type: "note", path: window.MdView.core.folder.root + "/a.md" }));
    await sleep(1500);
    window.MdView.setMode("active");
    for (let i = 0; i < 400 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(1200); // (what comes in has come; the rail is there)
    ok("the rail is there to be pressed", !!document.querySelector("#rrail button") && document.body.hasAttribute("data-rail"));
    const before = snap(), lookBefore = say();
    const target = document.querySelector('#rrail button[data-tab]') || document.querySelector("#toolbar button");
    press(target, "pointerdown");
    ok("the press makes the hand a finger, and the bars the application's", root.hasAttribute("data-finger"));
    await new Promise(requestAnimationFrame); await sleep(50);
    ok("the bars are the finger's", root.hasAttribute("data-tiles"));
    const atPress = snap();
    ok("under the press: nothing has moved", moved(before, atPress).length === 0, moved(before, atPress));
    press(target, "pointerup");
    await sleep(700);
    const after = snap();
    ok("after it: nothing has moved", moved(before, after).length === 0, moved(before, after));
    ok("the look and the order of the modes are the same", JSON.stringify(say()) === JSON.stringify(lookBefore), [lookBefore, say()]);
    // the rail pressed by that finger answers where it stands: its panel opens in the window, beside it
    target.click(); await sleep(700);
    const panel = document.getElementById("rpanel"), pr = panel && panel.getBoundingClientRect();
    ok("the rail's panel opens under a finger, in the window", !!pr && pr.width > 100 && pr.height > 100 && pr.top >= 0 && pr.bottom <= innerHeight && pr.right <= innerWidth, pr && [pr.x, pr.y, pr.width, pr.height]);
    target.click(); await sleep(500);
    await sleep(1600); // (a wheel only takes the finger away a moment after it)
    dispatchEvent(new WheelEvent("wheel", { deltaY: 1, bubbles: true }));
    await sleep(700);
    ok("a wheel takes the finger away", !root.hasAttribute("data-finger") && !root.hasAttribute("data-tiles"));
    ok("and moves nothing either", moved(before, snap()).length === 0, moved(before, snap()));
  } catch (e) { o.error = String(e && e.stack || e); }
  out("fingerstill", o);
})();
