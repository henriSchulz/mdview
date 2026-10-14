/* Development probe (dev/rig.sh icons): a folder's sign chosen from many — the colour-and-icon window searches Lucide's
 * (vendor/icons.js), in English and in German; the sign chosen stands on the folder's row and in its file, and comes again
 * when the window is opened anew (the rig starts it twice). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  let phase = "chosen";
  try {
    await sleep(1400);
    const sb = document.getElementById("sidebar");
    if (document.body.dataset.sidebar !== "open") { document.querySelector('[data-act="sidebar"]').click(); await sleep(700); }
    window.MdPrefs = { ...(window.MdPrefs || {}), sidebarLayout: "source" }; MdView.prefsChanged(); await sleep(500);
    const row = () => [...sb.querySelectorAll(".sb-list .sb-row")].find((r) => r.querySelector(".sb-label").textContent === "Finanzen");
    const looks = () => (MdView.core.folder.looks || {}).Finanzen || {};
    if (looks().icon) {
      phase = "again";
      ok("opened anew: its colour of the more as it was", looks().color === "#7c3aed" && getComputedStyle(row().querySelector(".sb-icon")).color === "rgb(124, 58, 237)", looks());
      ok("opened anew: the folder has the sign it was given — Lucide's, loaded for it", await until(() => row() && row().dataset.icon === "piggy-bank" && /<path|<rect|<circle/.test(row().querySelector(".sb-icon").innerHTML) && !!window.MdIcons, 6000), row() && row().dataset.icon);
    } else {
      const r = row().getBoundingClientRect();
      row().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 8, button: 2 })); await sleep(350);
      document.querySelector('#ctxmenu [data-cmd="look"]').click();
      const look = document.getElementById("sblook"), find = () => look.querySelector(".sl-find"), signs = () => [...look.querySelectorAll(".sl-icon")].map((b) => b.dataset.icon);
      ok("the window has a search over the signs, and many to choose from at once", await until(() => look.hasAttribute("data-open") && find() && signs().length > 80), [signs().length]);
      ok("… the app's own among them, and the folder's own first", signs()[0] === "" && signs().includes("book") && signs().includes("graduation-cap"), signs().slice(0, 6));
      find().value = "geld"; find().dispatchEvent(new Event("input", { bubbles: true }));
      ok("searched in German — Geld: the money's signs", await until(() => signs().includes("wallet") && signs().includes("piggy-bank")), signs().slice(0, 12));
      find().value = "gamepad"; find().dispatchEvent(new Event("input", { bubbles: true }));
      ok("searched in English, by a sign's name", await until(() => signs().includes("gamepad-2")), signs().slice(0, 8));
      find().value = "xqzzq"; find().dispatchEvent(new Event("input", { bubbles: true }));
      ok("none called so: it says so", await until(() => !!look.querySelector(".sl-none")));
      find().value = "geld"; find().dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(100);
      look.querySelector('.sl-icon[data-icon="piggy-bank"]').click();
      ok("chosen: it stands on the folder's row, and the search stays", await until(() => row().dataset.icon === "piggy-bank") && find().value === "geld" && look.querySelector('.sl-icon[data-icon="piggy-bank"]').classList.contains("on"), [row().dataset.icon, find().value]);
      ok("… kept in the folder", looks().icon === "piggy-bank", looks());
      // more colours: behind the plus — 48 more, and any as #rrggbb
      ok("the colours: the theme's seven, none, and a button for more", look.querySelectorAll(".sl-colors .sl-color").length === 9 && !!look.querySelector("[data-more]") && !look.querySelector(".sl-more-colors"));
      look.querySelector("[data-more]").click();
      ok("… opened: 48 more and a field for any colour", await until(() => look.querySelectorAll(".sl-more-colors .sl-color").length === 48 && !!look.querySelector(".sl-hex-in")));
      look.querySelector('.sl-more-colors [data-color="#0d9488"]').click();
      ok("one chosen: the folder's row in it, the plus wearing it", await until(() => looks().color === "#0d9488") && getComputedStyle(row().querySelector(".sb-icon")).color === "rgb(13, 148, 136)" && look.querySelector("[data-more]").classList.contains("on"), [looks(), getComputedStyle(row().querySelector(".sb-icon")).color]);
      const hex = look.querySelector(".sl-hex-in"); hex.focus(); hex.value = "c0ffee";
      hex.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      ok("any colour written in the field, taken with Enter", await until(() => looks().color === "#c0ffee") && look.querySelector(".sl-hex-in").value === "#c0ffee", looks());
      look.querySelector('.sl-more-colors [data-color="#7c3aed"]').click();
      await until(() => looks().color === "#7c3aed");
      out("shown", {});
      await sleep(900);
    }
  } catch (e) { o.error = String(e && e.stack || e); }
  out(phase, o);
})();
