/* Development probe (dev/rig.sh move): a note dragged into a folder, and a folder into another —
 * the rig reads the folder itself; this drags (as the sidebar's rows are dragged) and says when. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const say = (name, o) => post({ type: "probe", name, text: JSON.stringify(o) });
  const o = {};
  try {
    await sleep(1500);
    const root = MdView.core.folder.root, row = (p) => document.querySelector(`.sb-item[data-key="${root}/${p}"] > .sb-in > .sb-row`);
    const drag = (from, to) => {
      const dt = new DataTransfer(), ev = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      ev("dragstart", from); ev("dragover", to); o.marked = !!document.querySelector(".drop-into"); ev("drop", to); ev("dragend", from);
    };
    o.rows = [...document.querySelectorAll(".sb-item")].map((e) => e.dataset.key.slice(root.length + 1));
    o.before = MdView.core.current.path.slice(root.length + 1);
    drag(row("Loose.md"), row("box")); await sleep(1500);
    o.after = MdView.core.current.path.slice(root.length + 1);
    post({ type: "move", path: root + "/box", dir: root + "/shelf" }); await sleep(1500);
    o.then = MdView.core.current.path.slice(root.length + 1);
    post({ type: "move", path: root + "/shelf", dir: root + "/shelf/box" }); await sleep(600); // (into itself: nothing)
    say("move", o);
    post({ type: "close" });
  } catch (e) { o.error = String(e && e.stack || e); say("move", o); }
})();
