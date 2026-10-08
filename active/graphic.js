/* mdview active mode — a figure drawn by Claude: describe it, show a
 * reference picture, or both; the answer is an SVG in one house style
 * (clean line drawing: circuits, logic, block and RTL diagrams, schemes).
 * It can be changed by saying what to change, and is put into the note as a
 * file beside it. The application runs the `claude` command line tool; the
 * page only shows what comes back. */
"use strict";
(() => {
  const A = window.MdActive, T = window.MdStrings.t;
  const { esc, toast } = window.MdView.core;
  const post = (type, data = {}) => window.MdHost?.post(JSON.stringify({ type, ...data }));
  let live = null; // the open dialog: { id, onResult, onImage }
  let nextId = 1;

  /* A picture of the note (a whiteboard's) as a PNG's base64, on white, its longer side at most 1600: what Claude is shown. */
  async function shot(img) {
    if (!img.complete || !img.naturalWidth) await new Promise((res, rej) => { img.addEventListener("load", res, { once: true }); img.addEventListener("error", () => rej(new Error("no picture")), { once: true }); });
    const w = img.naturalWidth || 800, h = img.naturalHeight || 600, k = Math.min(3, 1600 / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png").split(",")[1];
  }
  /* from: { img, at } — a whiteboard's picture in the note is the reference, drawn at once; the figure goes into the note as its
   * SVG, a block of its own at `at` (under the board). */
  function open(view, from = null) {
    if (A.dialog.open) return false;
    const el = A.dialog.el;
    let svg = null, url = null, busy = 0, ref = null, timer = 0, started = 0;
    const me = (live = { id: 0 });
    const doneBtn = () => document.querySelector('#dlg [data-do="done"]');
    const tidy = () => { clearInterval(timer); if (busy) post("graphic-cancel"); if (url) URL.revokeObjectURL(url); const b = doneBtn(); if (b) b.disabled = false; if (live === me) live = null; };
    A.dialog.show({
      title: T("graphic.title"),
      kind: "graphic",
      anchor: () => null,
      build(body, _tools, info) {
        const text = el("textarea", { class: "gr-text lp-field", rows: "3", placeholder: T("graphic.describe"), "aria-label": T("graphic.describe"), spellcheck: "false" });
        const refRow = el("div", { class: "gr-ref" },
          `<span class="gr-label">${esc(T("graphic.reference"))}</span><span class="gr-thumb" hidden></span>` +
          `<button class="btn" type="button" data-ref="choose">${esc(T("graphic.choose"))}</button><button class="btn" type="button" data-ref="paste">${esc(T("graphic.paste"))}</button>` +
          `<button class="btn" type="button" data-ref="remove" hidden>${esc(T("graphic.remove"))}</button><span class="gr-space"></span>` +
          `<button class="btn primary" type="button" data-go="draw">${esc(T("graphic.draw"))}</button>`);
        const view = el("div", { class: "gr-view" }, `<div class="gr-empty">${esc(T("graphic.empty"))}</div>`);
        const changeRow = el("div", { class: "gr-change", hidden: "" },
          `<input class="lp-field gr-change-in" type="text" placeholder="${esc(T("graphic.change"))}" aria-label="${esc(T("graphic.change"))}" spellcheck="false"><button class="btn" type="button" data-go="change">${esc(T("graphic.apply"))}</button>`);
        body.append(text, refRow, view, changeRow);
        info.textContent = T("graphic.hint");
        const drawBtn = refRow.querySelector('[data-go="draw"]'), thumb = refRow.querySelector(".gr-thumb"), changeIn = changeRow.querySelector("input");
        const insert = doneBtn();
        insert.textContent = T("graphic.insert");
        insert.disabled = true;

        const show = () => {
          refRow.querySelector('[data-ref="remove"]').hidden = !ref;
          thumb.hidden = !ref;
          thumb.innerHTML = ref ? `<img src="${esc(ref.url)}" alt="">` : "";
          drawBtn.textContent = busy ? T("graphic.stop") : svg ? T("graphic.again") : T("graphic.draw");
          drawBtn.classList.toggle("primary", !busy && !svg);
          changeRow.hidden = !svg;
          changeRow.querySelector("button").disabled = !!busy;
          insert.disabled = !svg || !!busy;
          view.classList.toggle("busy", !!busy);
        };
        const stop = () => { if (!busy) return; post("graphic-cancel"); busy = 0; clearInterval(timer); view.querySelector(".gr-wait")?.remove(); show(); };
        const ask = (change) => {
          const desc = text.value.trim();
          if (!change && !desc && !ref) { text.focus(); return; }
          busy = me.id = nextId++;
          started = performance.now();
          let wait = view.querySelector(".gr-wait");
          if (!wait) { wait = el("div", { class: "gr-wait" }, `<span class="gr-spin"></span><span class="gr-secs"></span>`); view.appendChild(wait); }
          const tick = () => { const s = wait.querySelector(".gr-secs"); if (s) s.textContent = T("graphic.drawing", Math.round((performance.now() - started) / 1000)); };
          tick();
          clearInterval(timer);
          timer = setInterval(tick, 1000);
          post("graphic", { id: busy, text: desc, image: ref ? ref.path : null, previous: change ? svg : null, change: change || null });
          show();
        };
        me.onResult = (id, out, error) => {
          if (id !== busy) return;
          busy = 0;
          clearInterval(timer);
          view.querySelector(".gr-wait")?.remove();
          if (error || !out) { toast(error || T("graphic.failed")); show(); return; }
          svg = me.svg = out;
          if (url) URL.revokeObjectURL(url);
          url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          view.innerHTML = `<img class="gr-img" alt="" src="${url}">`;
          changeIn.value = "";
          show();
          changeIn.focus();
        };
        me.onImage = (path, fileUrl, error) => { if (error) { toast(error); return; } ref = path ? { path, url: fileUrl } : null; show(); if (me.auto && ref) { me.auto = false; ask(null); } };
        if (from) { // the board's picture, as it stands in the note: handed to the application, and drawn from as soon as it is there
          text.placeholder = T("graphic.describeBoard");
          me.auto = true;
          shot(from.img).then((data) => { if (live === me) post("graphic-image", { how: "data", data }); }).catch(() => { me.auto = false; toast(T("graphic.failed")); });
        }
        refRow.addEventListener("click", (e) => {
          const b = e.target.closest("button");
          if (!b) return;
          if (b.dataset.ref === "choose") post("graphic-image", { how: "choose" });
          else if (b.dataset.ref === "paste") post("graphic-image", { how: "paste" });
          else if (b.dataset.ref === "remove") { ref = null; show(); }
          else if (b.dataset.go === "draw") busy ? stop() : ask(null);
        });
        const change = () => { const c = changeIn.value.trim(); if (c && svg && !busy) ask(c); };
        changeRow.querySelector("button").addEventListener("click", change);
        changeIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); change(); } });
        // Ctrl+Enter in the description draws (once there is a figure, the dialog's own Ctrl+Enter inserts it)
        text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !svg && !busy) { e.preventDefault(); e.stopPropagation(); ask(null); } });
        // a picture pasted into the description is the reference
        text.addEventListener("paste", (e) => { if ([...(e.clipboardData?.items || [])].some((i) => i.type.startsWith("image/"))) { e.preventDefault(); post("graphic-image", { how: "paste" }); } });
        show();
        return { focus: () => text.focus(), result: () => (svg && !busy ? { svg, name: text.value.trim() } : undefined), text: () => text.value };
      },
      done(r) { tidy(); if (from) A.context.INSERT.svg(view, r.svg, from.at); else post("graphic-save", { svg: r.svg, name: r.name }); },
      cancel() { tidy(); },
    });
    return true;
  }
  A.graphic = {
    open,
    get shown() { return live ? live.svg || null : null; }, // (the figure in the open dialog)
    result: (id, svg, error) => { if (live && live.onResult) live.onResult(id, svg, error); },
    image: (path, url, error) => { if (live && live.onImage) live.onImage(path, url, error); },
  };
})();
