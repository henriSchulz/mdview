/* Development probe (dev/rig.sh update): a newer version of the app, in the app itself. The rig
 * runs it three times (window.__updateRun, put ahead of this file):
 *   package   an install that is told (MDVIEW_UPDATE_TEST=package), a latest.json of the rig's own
 *             says 9.9.9: the notice comes by itself, Later takes it away, the settings say it,
 *             Check Now brings it back
 *   offline   the same install, nothing at the address: the look of its own says nothing, Check
 *             Now says why
 *   checkout  the program as bin/mdview runs it, with the rig's 9.9.9 waiting at the address: no
 *             notice, no rows in the settings, Check Now does nothing */
(async () => {
  const run = window.__updateRun || "package";
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const post = (type, data = {}) => window.MdHost.post(JSON.stringify({ type, ...data }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + `[${run}] ` + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const notice = () => document.getElementById("update");
  const open = () => !!notice() && notice().hasAttribute("data-open");
  const until = async (f, ms) => { for (let t = 0; t < ms && !f(); t += 100) await sleep(100); return f(); };
  const row = (key) => document.querySelector(`#settings .pf-row[data-key="${key}"]`);
  const settings = async () => {
    MdView.setMode("active"); // (the settings are the active mode's: loaded with it)
    await until(() => window.MdActive && MdActive.prefs, 8000);
    MdActive.prefs.open("about");
    await until(() => row("updateCheck"), 3000);
    await sleep(800); // (what the application knows has come)
  };
  try {
    await document.fonts.ready;
    if (run === "package") {
      ok("the notice comes by itself, a few seconds after the start", await until(open, 20000), notice() && notice().outerHTML);
      ok("it names the version", /Markdown Notes 9\.9\.9 is available/.test(notice().textContent), notice().textContent);
      ok("a .deb is told where to download it, not restarted", JSON.stringify([...notice().querySelectorAll("button")].map((b) => b.dataset.act)) === '["notes","later","download"]', notice().innerHTML);
      out("shown", {});
      await sleep(900);
      notice().querySelector('[data-act="later"]').click();
      ok("Later takes it away", await until(() => !open(), 2000));
      await settings();
      ok("the settings show the rows for updates", !row("updateCheck").hidden && !row("updateAuto").hidden);
      ok("… the version and what the look found", /Version \d+\.\d+\.\d+ — 9\.9\.9 is on the download page/.test(row("updateCheck").textContent), row("updateCheck").textContent);
      ok("… and checking by itself is on", row("updateAuto").querySelector("input").checked);
      out("settings", {});
      await sleep(900);
      post("update-check"); // (what Check Now says when nothing has been found yet)
      ok("Check Now brings the notice back, Later or not", await until(open, 8000));
    } else if (run === "offline") {
      await sleep(9000);
      ok("the look of its own that cannot reach the address says nothing", !open());
      await settings();
      ok("the settings show the rows", !row("updateCheck").hidden);
      row("updateCheck").querySelector("button").click();
      ok("Check Now says why it could not", await until(() => /Couldn't check for updates: .+/.test(row("updateCheck").textContent), 15000), row("updateCheck").textContent);
      out("settings", {});
      await sleep(900);
      ok("… and shows no notice", !open());
    } else {
      await sleep(10000);
      ok("a checkout's build shows no notice, with a newer version at the address", !open());
      await settings();
      ok("… and no rows for updates in the settings", row("updateCheck").hidden && row("updateAuto").hidden);
      out("settings", {});
      post("update-check");
      await sleep(3000);
      ok("… and Check Now, said all the same, does nothing", !open());
    }
  } catch (e) {
    o.error = "FAIL " + String(e && e.stack || e);
  }
  out("update", o);
})();
