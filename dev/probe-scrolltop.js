/* Development probe (screenshot, no checks): a note in the active mode scrolled so that its text runs under the tabs — what shows
 * beside and under them; the computed z-index of a block's handle is reported. */
(async () => {
  const out = (name, x) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(x) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { shots: [] };
  try {
    await document.fonts.ready; await sleep(1500);
    const root = window.MdView.core.folder.root;
    window.MdHost.post(JSON.stringify({ type: "note", path: root + "/Uni/Analysis II/Fourier Series.md" }));
    await sleep(1500);
    scrollTo(0, 230); await sleep(800); out("shot-read", {}); await sleep(1500);
    window.MdView.setMode("active"); await sleep(2500);
    scrollTo(0, 230); await sleep(800);
    const h = document.querySelector(".blk-h");
    if (h) { h.setAttribute("data-on", ""); h.style.top = (scrollY + 40) + "px"; h.style.left = "40%"; }
    o.handleZ = h && getComputedStyle(h).zIndex;
    const b = getComputedStyle(document.body, "::before");
    o.band = { content: b.content, height: b.height, z: b.zIndex, bg: b.backgroundImage.slice(0, 120), pos: b.position };
    const chain = (el) => { const out = []; for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.zIndex !== "auto" || s.position !== "static" || s.transform !== "none" || s.isolation !== "auto") out.push(`${e.id || e.className || e.tagName}:${s.position}/${s.zIndex}/${s.transform !== "none" ? "T" : ""}`); } return out; };
    const hit = document.elementFromPoint(innerWidth * 0.3, 30);
    o.hit = hit && (hit.id || hit.className || hit.tagName); o.chain = chain(hit);
    const bs = getComputedStyle(document.body), hs = getComputedStyle(document.documentElement);
    o.body = { transform: bs.transform, filter: bs.filter, contain: bs.contain, willChange: bs.willChange, backdrop: bs.backdropFilter, overflow: bs.overflow, position: bs.position, zoom: bs.zoom };
    o.html = { transform: hs.transform, contain: hs.contain, overflow: hs.overflow, scrollY };
    const act = document.getElementById("active"), as = act && getComputedStyle(act);
    o.active = as && { position: as.position, z: as.zIndex, transform: as.transform, contain: as.contain, willChange: as.willChange };
    out("shot-scrolled", {}); await sleep(1500);
  } catch (e) { o.error = String(e && e.stack || e); }
  out("refined", o);
})();
