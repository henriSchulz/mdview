/* Development probe (dev/rig.sh compare): is the active mode laid out exactly
 * like the reading view? Measures every word and every box in both and
 * reports where they differ. Evaluated by mdview.py (MDVIEW_PROBE). */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const BOXES = "hr, img, input, pre, blockquote, table, th, td, li, h1, h2, h3, h4, h5, h6, mark, .tag, code, .callout, " +
    ".callout-title, .callout-content, .code-block, .math-block, .mermaid-block, details, summary, .katex, .transclusion, dl, dt, dd, " +
    "video, audio, .footnotes, sup, sub, a, svg";
  const r1 = (n) => Math.round(n * 10) / 10;

  function measure(root) {
    const o = root.getBoundingClientRect();
    const rel = (r) => [r1(r.left - o.left), r1(r.top - o.top), r1(r.width), r1(r.height)];
    const words = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const range = new Range();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest(".katex-mathml, style, script, [hidden]")) continue;
      for (const m of n.data.matchAll(/\S+/g)) {
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        for (const r of range.getClientRects()) if (r.width > 0) words.push({ t: m[0].slice(0, 24), r: rel(r) });
      }
    }
    // join pieces of one word that sit in neighbouring text nodes
    const joined = [];
    for (const w of words) {
      const p = joined[joined.length - 1];
      if (p && Math.abs(p.r[1] - w.r[1]) < 0.3 && Math.abs(p.r[3] - w.r[3]) < 0.3 && Math.abs(p.r[0] + p.r[2] - w.r[0]) < 1.2) {
        p.r[2] = r1(w.r[0] + w.r[2] - p.r[0]);
        p.t += w.t;
      } else joined.push({ t: w.t, r: w.r.slice() });
    }
    const boxes = [...root.querySelectorAll(BOXES)].filter((e) => e.getClientRects().length && !e.closest(".katex-mathml") && !/^ProseMirror-/.test(e.className))
      .map((e) => ({ t: e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""), r: rel(e.getBoundingClientRect()) }));
    return { height: r1(o.height), words: joined, boxes };
  }
  function diff(a, b, what) {
    const res = { what, read: a.length, active: b.length, diffs: [] };
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n && res.diffs.length < 12; i++) {
      // across: up to a pixel (a run of text that is split differently is placed on other sub-pixels); down: none
      // (the box of a word at the end of a line is up to 2 px wider or narrower, depending on how its text node ends)
      // a box without area is not on screen; where an empty block "is" between collapsed margins says nothing
      const flat = (r) => r[2] === 0 || r[3] === 0;
      if (a[i].t === b[i].t && flat(a[i].r) && flat(b[i].r)) continue;
      const bad = a[i].t !== b[i].t || a[i].r.some((v, k) => Math.abs(v - b[i].r[k]) > [1, 0.6, what === "words" ? 2 : 1, 0.6][k]);
      if (bad) res.diffs.push({ i, read: a[i], active: b[i] });
    }
    res.same = a.length === b.length && !res.diffs.length;
    return res;
  }
  // pictures from the network arrive when they arrive; measure once they are all there (or failed)
  const settled = async (root) => {
    for (let i = 0; i < 60 && [...root.querySelectorAll("img")].some((im) => !im.complete); i++) await sleep(150);
    for (let i = 0; i < 40 && root.querySelector("pre.mermaid"); i++) await sleep(150);
    await sleep(600);
  };
  try {
    await document.fonts.ready;
    const content = document.getElementById("content");
    await settled(content);
    document.getElementById("toolbar").style.visibility = "hidden"; // the same picture in both modes
    window.scrollTo(0, 0);
    const read = measure(content);
    out("read", { height: read.height });
    await sleep(2500); // dev/rig.sh takes its screenshot of the reading view here
    const t0 = performance.now();
    MdView.setMode("active");
    for (let i = 0; i < 100 && document.body.dataset.view !== "active"; i++) await sleep(50);
    const switched = performance.now() - t0;
    if (document.body.dataset.view !== "active") throw new Error("active mode did not come up");
    const jump = Math.abs(MdActive.view.el.getBoundingClientRect().height - read.height); // right after the switch, before anything settles
    await settled(MdActive.view.dom);
    const active = measure(MdActive.view.el); // #active is the column, as #content is
    const cur = MdView.core.current;
    const t1 = performance.now();
    MdView.setMode("read");
    const back = performance.now() - t1;
    const t2 = performance.now();
    MdView.setMode("active");
    void MdActive.view.el.offsetHeight; // with layout
    const again = performance.now() - t2;
    out("compare", {
      file: cur.name, width: innerWidth, lines: cur.text.split("\n").length,
      firstSwitchMs: Math.round(switched), backMs: Math.round(back), againMs: Math.round(again), heightJump: r1(jump),
      scrollKept: window.scrollY === 0,
      roundtrip: MdActive.view.serialize() === cur.raw,
      height: { read: read.height, active: active.height },
      words: diff(read.words, active.words, "words"),
      boxes: diff(read.boxes, active.boxes, "boxes"),
    });
  } catch (e) {
    out("compare", { error: String(e && e.stack || e) });
  }
})();
