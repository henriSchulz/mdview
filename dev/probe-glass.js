/* Development probe (dev/rig.sh glass): a menu over the note is glass — what is behind it is blurred, not to be read through.
 * The page cannot see that (the computed style says blur either way, WebKit draws it or not): the probe opens the outline over
 * lines of text and says where it stands; the rig takes the screen and looks at what shows through its empty right part.
 * Henri, 2026-10-14: "some menus are far too see-through, the glass does not work". Evaluated by the shell (MDVIEW_PROBE). */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = (o) => window.MdHost.post(JSON.stringify({ type: "probe", name: "glass", text: JSON.stringify(o) }));
  try {
    await document.fonts.ready;
    await sleep(1200);
    window.scrollTo(0, 400);
    await sleep(200);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "O", code: "KeyO", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await sleep(900);
    const r = document.getElementById("outline").getBoundingClientRect();
    out({ open: r.height > 100, menu: [r.left, r.top, r.width, r.height].map(Math.round), w: innerWidth, h: innerHeight, dpr: devicePixelRatio });
  } catch (e) { out({ error: String(e && e.stack || e) }); }
})();
