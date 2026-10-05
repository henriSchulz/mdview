/* Development probe (dev/rig.sh github): signing in with GitHub from the settings, against the
 * rig's own GitHub — the code shown, signed in once it is confirmed there, the next commit by
 * that user, signed out. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (f, n = 80) => { for (let i = 0; i < n && !f(); i++) await sleep(100); return !!f(); };
  try {
    await until(() => window.MdActive && MdActive.prefs, 100);
    post({ type: "history-enable" }); await sleep(900);
    MdActive.prefs.open("history"); await sleep(900);
    const row = document.querySelector('.pf-row[data-key="githubAccount"]');
    const says = () => row.querySelector(".pf-value").textContent, code = () => row.querySelector(".pf-code");
    const shown = () => [...row.querySelectorAll("button")].filter((b) => !b.hidden).map((b) => b.textContent);
    ok("the settings say nobody is signed in, and offer it", says() === "Not signed in" && shown().join("|") === "Sign In…", [says(), shown()]);
    row.querySelector("button").click();
    ok("signing in shows the code to confirm, and where", await until(() => !code().hidden && code().textContent === "WDJB-MJHT") && /github\.com\/login\/device/.test(says()), [says(), code().textContent]);
    ok("with the browser and giving up to choose from", shown().join("|") === "Copy Code and Open GitHub|Cancel", shown());
    row.scrollIntoView({ block: "center" });
    post({ type: "probe", name: "github-code", text: "{}" }); await sleep(900);
    ok("confirmed there: signed in, by name", await until(() => /^Signed in as Octo Cat \(@octo\)/.test(says()), 120) && code().hidden && shown().join("|") === "Sign Out", [says(), shown()]);
    o.said = says();
    // the project linked to the repository the app was given, from the settings
    const link = document.querySelector('.pf-row[data-key="historyLink"]'), get = document.querySelector('.pf-row[data-key="githubGet"]');
    const text = (r) => r.querySelector(".pf-value").textContent, does = (r) => [...r.querySelectorAll(".pf-link")].filter((b) => !b.hidden).map((b) => b.textContent);
    ok("not linked, the settings say so and offer to link; and to get a repository", await until(() => does(link).join("|") === "Link…") && text(link) === "Not linked" && !get.hidden && does(get).join("|") === "Get…", [text(link), does(link), does(get)]);
    // the chooser: a window with a field to search and the list — nothing picked beforehand
    link.querySelector(".pf-link:not([hidden])").click();
    const box = () => document.querySelector("#repos");
    ok("Link… opens the chooser with the repositories the app was given", await until(() => box() && box().hasAttribute("data-open") && box().querySelectorAll(".rc-row").length === 1) && box().querySelector(".rc-row").textContent === "octo/notesPrivate", box() && box().textContent);
    const field = box().querySelector(".rc-search"), go = box().querySelector(".rc-go"), rows = () => [...box().querySelectorAll(".rc-row")];
    const typeIn = (v) => { field.value = v; field.dispatchEvent(new Event("input", { bubbles: true })); };
    ok("none is picked beforehand, not even the only one: nothing can be linked yet", rows().every((r) => r.getAttribute("aria-selected") === "false") && go.disabled && document.activeElement === field, [go.disabled]);
    typeIn("zzz"); await sleep(150);
    ok("what fits nothing lists nothing, and says so", rows().length === 0 && /No repository fits/.test(box().querySelector(".rc-empty").textContent) && go.disabled, box().textContent);
    typeIn("not"); await sleep(150);
    ok("typed in, the list is what fits — still nothing picked", rows().length === 1 && go.disabled, rows().length);
    post({ type: "probe", name: "github-search", text: "{}" }); await sleep(700);
    rows()[0].click(); await sleep(150);
    ok("clicked: picked, and ready to link", rows()[0].getAttribute("aria-selected") === "true" && !go.disabled && go.textContent === "Link", [go.disabled, go.textContent]);
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(300);
    ok("Esc closes the chooser, and nothing was linked", !box().hasAttribute("data-open") && text(link) === "Not linked" && document.querySelector("#settings").hasAttribute("data-open"), text(link));
    link.querySelector(".pf-link:not([hidden])").click(); await sleep(300);
    ok("opened again it has forgotten the pick", go.disabled && rows().every((r) => r.getAttribute("aria-selected") === "false"));
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); await sleep(100);
    ok("the arrow picks, Enter links", !go.disabled);
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    ok("linked: the settings name the repository and say both have the same", await until(() => /the same on both$/.test(text(link))) && does(link).join("|") === "Unlink", [text(link), does(link)]);
    o.linked = text(link);
    MdActive.prefs.close(); await sleep(300);
    const clock = document.querySelector('[data-act="historymenu"]');
    ok("the clock says so too", /GitHub: the same on both/.test(clock.title || clock.dataset.tip || ""), [clock.title, clock.dataset.tip]);
    post({ type: "save", text: MdView.core.current.raw + "\nwritten signed in\n" });
    await sleep(2200); // (quiet: kept — by the user who is signed in — and sent)
    MdActive.prefs.open("history"); await sleep(700);
    post({ type: "probe", name: "github-linked", text: "{}" }); await sleep(900);
    link.querySelector(".pf-link:not([hidden])").click();
    ok("unlinked again: there to link anew", await until(() => does(link).join("|") === "Link…" && text(link) === "Not linked"), [text(link), does(link)]);
    const out = [...row.querySelectorAll("button")].find((b) => !b.hidden && b.textContent === "Sign Out"); // (never the one that opens a browser)
    if (out) out.click();
    ok("signed out again", await until(() => says() === "Not signed in") && shown().join("|") === "Sign In…", [says(), shown()]);
  } catch (e) { o.error = String(e && e.stack || e); }
  o.pass = !o.error && o.steps.every((s) => s.startsWith("ok"));
  post({ type: "probe", name: "github", text: JSON.stringify(o) });
})();
