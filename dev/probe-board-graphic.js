/* Development probe (dev/rig.sh board-graphic): a whiteboard drawn clean by Claude — the entry in
 * the block's menu, the dialog with the board's picture as its reference, drawn at once, and the
 * figure put under the board as its SVG. The model is a fixed figure (MDVIEW_GRAPHIC_FAKE). */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const REAL = !!window.__graphicReal; // (dev/rig.sh board-graphic real: Claude itself is asked)
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm, md = () => V.serialize(false);
    V.focus();
    A.context.INSERT.board(view);
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board");
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(700);
    const stage = el().querySelector(".bd-stage");
    const ev = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0, buttons: type === "pointerup" ? 0 : 1, pressure: type === "pointerup" ? 0 : 0.5 }));
    const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    key("p");
    // a battery's two plates, a wobbly wire around, and a zigzag for a resistor: a circuit as a hand scribbles it
    const line = async (pts) => { ev("pointerdown", ...pts[0]); for (const p of pts.slice(1)) { ev("pointermove", ...p); await sleep(5); } ev("pointerup", ...pts[pts.length - 1]); await sleep(40); };
    const seg = (a, b, n = 12) => Array.from({ length: n + 1 }, (_v, i) => [a[0] + ((b[0] - a[0]) * i) / n + Math.sin(i * 1.9) * 2, a[1] + ((b[1] - a[1]) * i) / n + Math.cos(i * 1.3) * 2]);
    await line(seg([300, 330], [300, 390])); await line(seg([316, 345], [316, 375]));
    await line([...seg([300, 330], [300, 260]), ...seg([300, 260], [420, 260])]);
    await line([[420, 260], [430, 244], [446, 276], [462, 244], [478, 276], [494, 244], [504, 260]]);
    await line([...seg([504, 260], [600, 260]), ...seg([600, 260], [600, 460]), ...seg([600, 460], [300, 460]), ...seg([300, 460], [300, 390])]);
    ok("something is drawn on it", st().items === 5, st().items);
    await until(() => !st().dirty, 3000);
    key("Escape");
    await until(() => !B().shown && el().hidden, 3000);
    await sleep(300);
    // the board's block, and its menu
    let pos = -1, node = null;
    view.state.doc.descendants((n, p) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) { pos = p; node = n; } });
    const items = A.context.nodeItems(view, pos, node).filter(Boolean), entry = items.find((i) => /Claude/.test(i.label || ""));
    ok("the board's menu offers to have it drawn clean by Claude", !!entry && entry.label === "Draw Clean with Claude…", items.map((i) => i.label));
    entry.run();
    const dlg = document.getElementById("dlg"), img = () => dlg.querySelector(".gr-img"), loaded = () => img() && img().complete && img().naturalWidth > 0;
    ok("the figure's dialog opens", await until(() => dlg.hasAttribute("data-open") && dlg.dataset.kind === "graphic"), dlg.dataset.kind);
    ok("the board's picture is its reference, and it is drawn from at once", await until(() => !!dlg.querySelector(".gr-from img") && (!!dlg.querySelector(".gr-wait") || loaded()), 6000), dlg.innerHTML.slice(0, 300));
    ok("the dialog is the board's own: no field to describe in, no picture to choose — the scribble beside the figure", !dlg.querySelector(".gr-text") && !dlg.querySelector('[data-ref="choose"]') && dlg.querySelector(".gr-from").getBoundingClientRect().right <= dlg.querySelector(".gr-to").getBoundingClientRect().left, dlg.querySelector(".dlg-body, .gr-board")?.className);
    const thumb = dlg.querySelector(".gr-from img");
    ok("… a picture of what was drawn", await until(() => thumb.complete && thumb.naturalWidth > 100, 4000), [thumb.naturalWidth, thumb.naturalHeight]);
    ok("the figure shows (drawn from a reference)", await until(loaded, REAL ? 240000 : 8000) && (REAL || (A.graphic.shown || "").includes(">ref<")), (A.graphic.shown || "").slice(0, 160));
    o.figure = A.graphic.shown;
    const changeIn = dlg.querySelector(".gr-change-in");
    ok("once it is drawn: what to change, and Draw again", !changeIn.hidden && changeIn.offsetWidth > 100 && dlg.querySelector('[data-go="draw"]').textContent === "Draw again", [changeIn.hidden, dlg.querySelector('[data-go="draw"]').textContent]);
    changeIn.value = "thicker lines"; changeIn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    ok("a change asked for: drawn anew", await until(() => (A.graphic.shown || "").includes(">changed<"), 8000) || REAL, (A.graphic.shown || "").slice(0, 160));
    if (REAL) await until(() => !dlg.querySelector(".gr-wait"), 240000);
    out("drawn", {});
    await sleep(500);
    const before = md();
    dlg.querySelector('[data-do="done"]').click();
    await sleep(500);
    const now = md(), at = now.indexOf(".board.svg)"), under = now.slice(at).split("\n").filter((l) => l.trim());
    ok("Insert: the figure stands under the board, as its SVG in the note", !dlg.hasAttribute("data-open") && under[1] === "```svg" && under[2].startsWith("<svg") && now.includes("</svg>\n```") && !before.includes("```svg"), under.slice(0, 3));
    ok("… without anything that could run", !/<script|onclick/.test(now), now.slice(at, at + 300));
    const shown = document.querySelector("#active .svg-block svg, #active .svg-block img");
    ok("… and it shows there as a picture", await until(() => !!document.querySelector("#active .svg-block"), 3000), document.querySelector("#active").innerHTML.slice(-300));
    void shown;
    out("inserted", {});
    await sleep(400);
    view.dispatch(view.state.tr); // (nothing: the note is as it is)
    key("z", { ctrlKey: true });
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-graphic", o);
})();
