/* Development probe (dev/rig.sh share): a note of a project linked to GitHub is shared from its
 * window — the link, a password, shared no more. The rig reads the project's file and its
 * commits; this acts, and says what the window showed. Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const say = (name, o) => post({ type: "probe", name, text: JSON.stringify(o) });
  const o = {};
  try {
    await sleep(1200);
    const q = (s) => document.querySelector(s), shown = (s) => { const e = q(s); return !!e && !e.hidden && e.offsetParent !== null; };
    const settled = async () => { for (let i = 0; i < 80 && (!q("#share") || q(".share-box").hasAttribute("aria-busy")); i++) await sleep(100); await sleep(300); };
    const state = () => ({ title: q("#share-title").textContent, text: q(".share-text").textContent, link: shown("#share .share-link") ? q("#share .share-link").value : null, go: shown("#share .btn.primary"), stop: shown("#share .share-foot .pf-link.danger"), folded: q("#share .share-more").getAttribute("aria-expanded") === "false" });
    const btn = q('#toolbar [data-act="share"]'), before = btn.previousElementSibling, after = btn.nextElementSibling;
    o.button = [shown('#toolbar [data-act="share"]'), before.dataset.act, after.className]; // (between the magnifier and the modes)
    btn.click();
    await sleep(800); await settled();
    o.open = state();
    q("#share .btn.primary").click(); await settled();
    o.shared = state();
    o.marked = [[...document.querySelectorAll(".sb-row[data-real]")].filter((r) => r.querySelector(".sb-shared")).map((r) => r.querySelector(".sb-label").textContent.trim()), q('#toolbar [data-act="share"]').classList.contains("active")];
    say("share-shared", o); await sleep(1500);        // (the rig looks at the file and the commit)
    q("#share .share-more").click(); await sleep(700);   // the password: unfolded first
    const pass = q('#share input[type="password"]');
    pass.value = "sesame"; pass.dispatchEvent(new Event("input", { bubbles: true }));
    q("#share .share-set").click(); await settled();
    o.locked = state();
    say("share-locked", o); await sleep(1500);
    q("#share .share-foot .pf-link.danger").click(); await settled();
    o.stopped = state();
    o.unmarked = [document.querySelectorAll(".sb-shared").length, q('#toolbar [data-act="share"]').classList.contains("active")];
    say("share", o);
    post({ type: "close" });
  } catch (e) { o.error = String(e && e.stack || e); say("share", o); }
})();
