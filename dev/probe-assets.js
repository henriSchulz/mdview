/* Development probe (dev/rig.sh assets): what is put into a note of a subfolder goes to the base
 * folder's assets (not to an assets of the subfolder's own), is named `assets/…` there, and shows
 * — also after the note was moved to another folder. The rig lays the folder out, fills the
 * nested session's clipboard with a picture and reads the folder afterwards. */
(async () => {
  if (window.__probed) return; window.__probed = true;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const post = (o) => window.MdHost.post(JSON.stringify(o));
  const o = { steps: [] };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  const until = async (cond, ms = 5000) => { for (let t = 0; t < ms && !cond(); t += 50) await sleep(50); return cond(); };
  try {
    await document.fonts.ready;
    await sleep(1500);
    const root = MdView.core.folder.root, here = () => MdView.core.current.path.slice(root.length + 1);
    ok("the note of the subfolder is on screen", here() === "Sub/Note.md", here());
    MdView.setMode("active");
    await until(() => window.MdActive && MdActive.view && document.body.dataset.view === "active");
    await sleep(300);
    const V = MdActive.view, view = () => V.pm, md = () => V.serialize(false), { TextSelection } = PM.state;
    const after = (text) => { let f = -1; view().state.doc.descendants((n, p) => { if (f < 0 && n.isText && n.text.includes(text)) f = p + n.text.indexOf(text) + text.length; }); if (f < 0) throw new Error("not in the document: " + text); return f; };
    const caret = (pos) => view().dispatch(view().state.tr.setSelection(TextSelection.create(view().state.doc, pos)));
    const shows = (part, w) => until(() => { const im = document.querySelector(`#active img[src*="${part}"], #content img[src*="${part}"]`); return !!im && im.complete && im.naturalWidth === w; });
    const html = (part) => document.querySelector(`img[src*="${part}"]`)?.outerHTML;
    V.focus();

    // a picture pasted, a file dropped, a whiteboard made: named as what lies in the base folder's assets
    caret(after("Paste here."));
    view().dom.dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
    ok("a picture pasted into a note of a subfolder is named assets/…", await until(() => /Paste here\.!\[\]\(assets\/pasted-\d{8}-\d{6}\.png\)/.test(md())), md());
    ok("… and shows", await shows("pasted-", 40), html("pasted-"));
    caret(after("Drop here."));
    post({ type: "dropfiles", uris: ["file://" + root.replace(/\/work\/[^/]+$/, "/drop.png"), "file://" + root.replace(/\/work\/[^/]+$/, "/paper.pdf")], path: MdView.core.current.path });
    ok("a picture and a file dropped are named assets/… too", await until(() => md().includes("![](assets/drop.png)") && md().includes("](assets/paper.pdf)")), md());
    ok("… and the picture shows", await shows("drop.png", 20), html("drop.png"));
    V.flush ? V.flush() : null;
    await sleep(1200); // (saved)

    // moved to another folder (the sidebar's row dragged there): the same words, the same pictures
    post({ type: "move", path: root + "/Sub/Note.md", dir: root + "/shelf" });
    ok("the note is moved to another folder", await until(() => here() === "shelf/Note.md"), here());
    MdView.setMode("read");
    await until(() => document.body.dataset.view !== "active");
    post({ type: "note", path: root + "/shelf/Other.md" });
    await until(() => here() === "shelf/Other.md");
    post({ type: "note", path: root + "/shelf/Note.md" });
    await until(() => here() === "shelf/Note.md");
    ok("moved, the note shows its pictures as before", (await shows("pasted-", 40)) && (await shows("drop.png", 20)), [html("pasted-"), html("drop.png")]);
    o.moved = MdView.core.current.text;

    // pictures kept beside a note before there was one place for them: shown where they are, and after the note is moved away from them
    post({ type: "note", path: root + "/Old/Legacy.md" });
    await until(() => here() === "Old/Legacy.md");
    ok("a subfolder's own assets go on being used", await shows("kept.png", 12), html("kept.png"));
    post({ type: "move", path: root + "/Old/Legacy.md", dir: root + "/shelf" });
    await until(() => here() === "shelf/Legacy.md");
    post({ type: "note", path: root + "/shelf/Other.md" });
    await until(() => here() === "shelf/Other.md");
    post({ type: "note", path: root + "/shelf/Legacy.md" });
    await until(() => here() === "shelf/Legacy.md");
    ok("… and a note moved away from them finds them where they stayed", await shows("kept.png", 12), html("kept.png"));
  } catch (e) { o.error = String(e && e.stack || e); }
  post({ type: "probe", name: "assets", text: JSON.stringify(o) });
  post({ type: "close" });
})();
