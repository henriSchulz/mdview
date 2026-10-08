/* Development probe (dev/rig.sh board-pictures): pictures on a whiteboard — a file dropped on the
 * board is kept beside the board's own and stands on it, in the board's picture too; the note's
 * attachment collector leaves it alone while the board shows it, and takes it once it does not.
 * (The rig runs with no grace time: a file not named goes with the second save after.) */
(async () => {
  const out = (name, o) => window.MdHost.post(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (f, ms = 6000) => { for (let t = 0; t < ms; t += 50) { try { if (f()) return true; } catch (_e) { /* not yet */ } await sleep(50); } return false; };
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const view = MdActive.view.pm, note = MdView.core.current.path, dir = note.slice(0, note.lastIndexOf("/"));
    MdActive.view.focus();
    MdActive.context.INSERT.board(view);
    const B = () => window.MdBoard, st = () => B() && B().state && B().state(), el = () => document.getElementById("board");
    ok("the board opens", await until(() => st() && el().hasAttribute("data-ready")), st());
    await sleep(600);
    const key = (k, more = {}) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...more }));
    // a picture file from elsewhere, dropped on the board
    const dt = new DataTransfer();
    dt.setData("text/uri-list", "file://" + encodeURI(dir + "/outside/photo one.png") + "\r\nfile://" + encodeURI(dir + "/outside/readme.txt"));
    const r = el().getBoundingClientRect();
    const over = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 300 });
    el().querySelector(".bd-stage").dispatchEvent(over);
    ok("the board takes files held over it", over.defaultPrevented, [...dt.types]);
    el().querySelector(".bd-stage").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 300, clientY: r.top + 300 }));
    ok("dropped: the picture stands on the board where it fell, chosen; the file that is no picture is left out", await until(() => st().things.length === 1) && st().things[0].k === "image" && st().things[0].src === "photo one.png" && st().mode === "select" && st().picked.length === 1, st().things);
    const t = st().things[0];
    ok("… in its own proportions, its middle where it was dropped", Math.abs(t.w / t.h - 2) < 0.05 && Math.abs(t.x + t.w / 2 - (st().view.x + 300)) <= 1, t);
    const img = () => el().querySelector(".bd-world .bd-img");
    ok("… and shows", await until(() => img() && img().complete && img().naturalWidth === 240, 4000), img() && [img().src, img().naturalWidth]);
    ok("its bar offers what a picture can take: no fill, no text", [...el().querySelectorAll(".bd-fbar .bd-btn")].map((b) => b.dataset.f).join() === "arrange,duplicate,remove", [...el().querySelectorAll(".bd-fbar .bd-btn")].map((b) => b.dataset.f));
    ok("kept by itself", await until(() => st() && !st().dirty, 3000), st().dirty);
    await sleep(400);
    out("dropped", {});
    key("Escape"); key("Escape");
    await until(() => el().hidden, 2000);
    const block = document.querySelector("#active .board-block img");
    const shown = await new Promise((res) => { const c = document.createElement("canvas"), i = new Image(); i.onload = () => { c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); const d = x.getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data; res([...d]); }; i.onerror = () => res(null); i.src = block.src; });
    ok("the board's picture in the note shows the picture itself (red, as the file is)", !!shown && shown[0] > 200 && shown[1] < 80 && shown[3] > 200, shown);
    // the note is written on and saved: the picture is named by the board, so it stays
    const type = async (text) => { view.dispatch(view.state.tr.insertText(text, view.state.doc.content.size - 1)); await sleep(1300); };
    view.dispatch(view.state.tr.insert(view.state.doc.content.size, MdActive.schema.nodes.paragraph.create()));
    await type("one"); await type(" two"); await type(" three");
    out("kept", {});
    await sleep(600);
    // taken off the board: no longer named by anything
    MdActive.islands.open(view, (() => { let p = -1; view.state.doc.descendants((n, pos) => { if (n.type.name === "island" && /board\.svg/.test(n.attrs.raw || "")) p = pos; }); return p; })());
    ok("opened again: the picture is there", await until(() => st() && el().hasAttribute("data-ready")) && st().things.length === 1, st() && st().things);
    B().pick([st().things[0].id]);
    key("Delete");
    ok("deleted from the board", st().things.length === 0, st().things);
    await until(() => st() && !st().dirty, 3000);
    key("Escape"); key("Escape");
    await until(() => el().hidden, 2000);
    await type(" four"); await type(" five"); await type(" six");
    out("gone", {});
    await sleep(600);
  } catch (e) {
    o.error = String(e && e.stack || e);
  }
  out("board-pictures", o);
})();
