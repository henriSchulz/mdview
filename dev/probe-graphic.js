/* Development probe (dev/rig.sh graphic): a figure drawn by Claude — the
 * dialog from the "/" menu, drawing, changing, a reference picture, inserting
 * it as a file beside the note. The model is replaced by a fixed figure
 * (MDVIEW_GRAPHIC_FAKE); `dev/rig.sh graphic real` asks Claude itself. */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const REAL = !!window.__graphicReal;
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm;
    const md = () => V.serialize(false);
    V.focus();
    // a new line at the end, and the "/" menu there
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.insert(end, A.schema.nodes.paragraph.create()).scrollIntoView());
    view.dispatch(view.state.tr.setSelection(PM.state.TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    for (const ch of "/graph") { view.dispatch(view.state.tr.insertText(ch)); await sleep(30); }
    await sleep(300);
    const items = [...A.menu.el.querySelectorAll(".menu-item")].map((b) => b.textContent.trim());
    ok("the / menu offers it", A.menu.isOpen && items.length === 1 && items[0].startsWith("Graphic by Claude"), items);
    view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const dlg = document.getElementById("dlg");
    ok("the dialog opens; nothing to insert yet", await until(() => dlg.hasAttribute("data-open") && dlg.dataset.kind === "graphic") && dlg.querySelector('[data-do="done"]').disabled && dlg.querySelector('[data-do="done"]').textContent === "Insert");
    ok("the typed /graph is gone from the note", !md().includes("/graph"), md().slice(-40));
    const text = dlg.querySelector(".gr-text"), draw = () => dlg.querySelector('[data-go="draw"]'), img = () => dlg.querySelector(".gr-img");
    const loaded = () => img() && img().complete && img().naturalWidth > 0;
    text.value = REAL ? "A half adder from an XOR and an AND gate, inputs A and B, outputs S and C." : "RC low pass";
    draw().click();
    await sleep(700);
    ok("Draw: it says that it is drawing, and can be stopped", !!dlg.querySelector(".gr-wait") && draw().textContent === "Stop" || loaded(), draw().textContent);
    ok("the figure shows", await until(loaded, REAL ? 120000 : 6000), dlg.querySelector(".gr-view").innerHTML.slice(0, 120));
    o.firstSize = img() ? [img().naturalWidth, img().naturalHeight] : null;
    ok("now it can be inserted, changed or drawn again", !dlg.querySelector('[data-do="done"]').disabled && !dlg.querySelector(".gr-change").hidden && draw().textContent === "Draw again");
    out("drawn", {}); await sleep(1500);
    if (!REAL) {
      const src1 = img().src;
      dlg.querySelector(".gr-change-in").value = "the capacitor in blue";
      dlg.querySelector('.gr-change [data-go="change"]').click();
      ok("a change gives a new figure", await until(() => loaded() && img().src !== src1) && A.graphic.shown.includes(">changed<"), img() && img().src);
      // a reference picture alone
      MdView.graphicImage("/tmp/ref.png", "data:image/gif;base64,R0lGODlhAQABAAAAACw=", null);
      await sleep(100);
      ok("a reference picture shows as chosen", !dlg.querySelector(".gr-thumb").hidden && !dlg.querySelector('[data-ref="remove"]').hidden);
      const src2 = img().src;
      text.value = "";
      draw().click();
      ok("a reference alone is enough to draw from", await until(() => loaded() && img().src !== src2) && A.graphic.shown.includes(">ref<"), img() && img().src);
      text.value = "RC low pass";
    }
    dlg.querySelector('[data-do="done"]').click();
    ok("Insert: the dialog closes, the figure stands in the note as a picture", await until(() => !dlg.hasAttribute("data-open") && /!\[\]\((RC-low-pass|A-half-adder[^)]*)\.svg\)/.test(md())), md().slice(-80));
    const pic = () => view.dom.querySelector('img[src$=".svg"]');
    ok("… and is shown there", await until(() => pic() && pic().complete && pic().naturalWidth > 0, 5000), pic() && pic().outerHTML.slice(0, 120));
    const centred = (root) => { const i = root.querySelector('img[src$=".svg"]'); if (!i) return [null]; const r = i.getBoundingClientRect(), c = root.getBoundingClientRect(), cs = getComputedStyle(root); const mid = c.left + parseFloat(cs.paddingLeft) + (c.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / 2; return [Math.round(r.left + r.width / 2 - mid), Math.round(r.width)]; };
    { const [off, w] = centred(view.dom); ok("the figure stands centred in the column", off !== null && Math.abs(off) <= 2 && w > 20, [off, w]); }
    out("inserted", {}); await sleep(1500);
    await sleep(900); // (saved)
    MdView.setMode("read");
    await until(() => (document.body.dataset.view || "read") === "read");
    await sleep(400);
    { const [off, w] = centred(document.getElementById("content")); ok("… in the reading view too", off !== null && Math.abs(off) <= 2 && w > 20, [off, w]); }
    // a double click on a picture shows it large
    {
      const zoom = document.getElementById("zoom"), small = document.querySelector('#content img[src$=".svg"]'), sr = small.getBoundingClientRect();
      small.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: sr.left + 5, clientY: sr.top + 5 }));
      await sleep(700);
      const br = zoom.firstChild.getBoundingClientRect();
      ok("reading view: a double click on the picture shows it large, in the middle of the window", zoom.hasAttribute("data-open") && br.width > sr.width * 1.5 && Math.abs(br.left + br.width / 2 - innerWidth / 2) < 3 && Math.abs(br.top + br.height / 2 - innerHeight / 2) < 3 && br.width <= innerWidth && br.height <= innerHeight, [sr.width, br.width, br.left, br.top]);
      out("zoomed", {}); await sleep(1300);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await sleep(500);
      ok("Esc puts it back", !zoom.hasAttribute("data-open") && getComputedStyle(small).visibility === "visible");
    }
    MdView.setMode("active");
    await until(() => document.body.dataset.view === "active");
    await sleep(300);
    {
      const zoom = document.getElementById("zoom"), small = view.dom.querySelector('img[src$=".svg"]');
      small.scrollIntoView({ block: "center" }); await sleep(250);
      const sr = small.getBoundingClientRect();
      const at = (kind, x, y) => window.MdHost.post(JSON.stringify({ type: "probe-pointer", kind, x, y }));
      const x = sr.left + sr.width / 2, y = sr.top + sr.height / 2;
      at("move", x, y); await sleep(80);
      for (let i = 0; i < 2; i++) { at("down", x, y); await sleep(40); at("up", x, y); await sleep(70); }
      await sleep(700);
      ok("active mode: a double click with the real pointer does the same (no edit popover)", zoom.hasAttribute("data-open") && !document.getElementById("dlg").hasAttribute("data-open") && !document.querySelector("#atompop[data-open], #linkpop[data-open]"), [zoom.hasAttribute("data-open")]);
      zoom.click(); await sleep(500);
      ok("a click puts it back", !zoom.hasAttribute("data-open"));
    }
    await sleep(900);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("graphic", o);
})();
