/* Development probe (dev/rig.sh wikiroot): a note of a subfolder whose links lead to notes and
 * PDFs of other folders (the PDFs in the top's assets/…) — every link found, every PDF embedded
 * drawn (a page, a region of one with rect). Says what it found. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = { steps: [] };
  const say = () => post({ type: "probe", name: "wikiroot", text: JSON.stringify(o) });
  try {
    await sleep(1500);
    const links = [...document.querySelectorAll("#content a.wikilink[data-wiki]")];
    const missing = links.filter((a) => a.classList.contains("unresolved")).map((a) => a.dataset.wiki);
    const embeds = [...document.querySelectorAll("#content .pdf-embed")];
    const isDrawn = (e) => e.classList.contains("ready") && e.querySelector("img");
    for (const e of embeds) { e.scrollIntoView({ block: "center" }); for (let i = 0; i < 100 && !isDrawn(e); i++) await sleep(100); }
    const drawn = embeds.filter(isDrawn);
    o.how = embeds.map((e) => e.className + ":" + e.textContent.slice(0, 80));
    const gone = [...document.querySelectorAll("#content .embed-missing")].map((e) => e.dataset.wiki);
    const ok = (good, what) => o.steps.push((good ? "ok   " : "FAIL ") + what);
    ok(links.length > 0 && !missing.length, `${links.length - missing.length} of ${links.length} links found` + (missing.length ? `; not: ${[...new Set(missing)].join(", ")}` : ""));
    ok(!gone.length, gone.length ? `embeds shown as a name only: ${gone.join(", ")}` : "no embed shown as a name only");
    ok(embeds.length > 0 && drawn.length === embeds.length, `${drawn.length} of ${embeds.length} PDF embeds drawn` + (embeds.length > drawn.length ? `; not: ${embeds.filter((e) => !drawn.includes(e)).map((e) => e.dataset.frag).join(", ")}` : ""));
    o.note = MdView.core.current && MdView.core.current.path;
    say();
    post({ type: "close" });
  } catch (e) { o.error = String(e && e.stack || e); say(); }
})();
