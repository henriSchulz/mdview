/* mdview — a whiteboard's items on the screen: one element each in a layer that is moved and
 * scaled with the view (the ink's canvas lies over it). Drawn from the same shapes as the board's
 * picture (items.js); text is the browser's own, so that it can be typed in place. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const NS = "http://www.w3.org/2000/svg";
  const els = new WeakMap(); // layer → Map(id → { el, sig })

  /* A picture has loaded: a small copy of it for the board's own picture (items.js), once per file. */
  function small(img) {
    const src = img.dataset.src, I = B.items;
    if (!src || I.thumbs.has(src) || !img.naturalWidth) return;
    try {
      const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      // (a photograph as JPEG; what may be see-through — PNG, SVG, WebP, GIF — keeps that)
      I.thumbs.set(src, /\.jpe?g$/i.test(src) ? c.toDataURL("image/jpeg", 0.78) : c.toDataURL("image/png"));
      if (B.layer.onsmall) B.layer.onsmall(src);
    } catch (e) { /* (a picture the page may not read back: the board's picture shows a grey field for it) */ }
  }
  function make(it) {
    const el = document.createElement("div");
    el.className = "bd-item";
    el.dataset.id = it.id;
    el.dataset.k = it.k;
    if (it.k === "shape" || it.k === "line") {
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "bd-draw");
      svg.appendChild(document.createElementNS(NS, "path"));
      if (it.k === "line") { svg.appendChild(document.createElementNS(NS, "path")); svg.appendChild(document.createElementNS(NS, "path")); }
      el.appendChild(svg);
    }
    if (it.k === "image") {
      const img = document.createElement("img");
      img.className = "bd-img"; img.alt = ""; img.draggable = false;
      img.addEventListener("load", () => small(img));
      el.appendChild(img);
    }
    if (it.k === "table") { const grid = document.createElement("div"); grid.className = "bd-table"; el.appendChild(grid); }
    if (it.k === "link" || it.k === "file") { el.innerHTML = '<div class="bd-card"><span class="bd-badge"></span><span class="bd-card-text"><b></b><i></i></span></div>'; }
    if (B.items.texty(it)) {
      const box = document.createElement("div"), t = document.createElement("div");
      box.className = "bd-text"; t.className = "bd-t";
      box.appendChild(t); el.appendChild(box);
    }
    return el;
  }
  function draw(el, it, order, editing, cell) {
    const I = B.items, auto = "var(--fg)", ink = (c) => (c === "auto" ? auto : c);
    el.style.zIndex = String(order);
    el.toggleAttribute("data-lock", !!it.lock);
    if (it.k === "line") {
      const b = I.bounds(it), svg = el.firstChild, [line, h1, h2] = svg.children, c = ink(it.stroke.c === "none" ? "auto" : it.stroke.c);
      el.style.cssText += `;left:${b[0]}px;top:${b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px;transform:none`;
      svg.setAttribute("viewBox", `${b[0]} ${b[1]} ${b[2] - b[0]} ${b[3] - b[1]}`);
      const l = I.lineDraw(it);
      line.setAttribute("d", l.d);
      line.setAttribute("style", `fill:none;stroke:${c};stroke-width:${it.stroke.w};stroke-linejoin:round;stroke-linecap:${it.ends.includes("arrow") ? "butt" : "round"}`);
      h1.setAttribute("d", l.heads[0]); h1.setAttribute("style", `fill:${c}`);
      h2.setAttribute("d", l.heads[1]); h2.setAttribute("style", `fill:${c}`);
      return;
    }
    el.style.cssText += `;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;transform:rotate(${it.r || 0}deg)`;
    if (it.k === "table") {
      const grid = el.firstChild, count = it.rows.length * it.cols.length;
      grid.style.cssText = `grid-template-columns:${it.cols.map((c) => c + "px").join(" ")};grid-template-rows:${it.rows.map((r) => r + "px").join(" ")};font-size:${it.ts.size}px`;
      while (grid.children.length > count) grid.lastChild.remove();
      while (grid.children.length < count) { const c = document.createElement("div"), t = document.createElement("div"); c.className = "bd-cell"; t.className = "bd-t"; c.appendChild(t); grid.appendChild(c); }
      it.cells.forEach((row, i) => row.forEach((text, j) => {
        const c = grid.children[i * it.cols.length + j], t = c.firstChild, typing = editing && cell && cell[0] === i && cell[1] === j;
        c.toggleAttribute("data-head", it.head && i === 0);
        c.dataset.cell = i + "," + j;
        if (!typing && t.textContent !== text) t.textContent = text;
      }));
      return;
    }
    if (it.k === "image") {
      const img = el.firstChild, c = it.crop;
      if (img.dataset.src !== it.src) { img.dataset.src = it.src; img.src = B.layer.url ? B.layer.url(it.src) : ""; }
      // (cut: the whole picture, larger than its frame and shifted, the frame hiding what is cut off)
      el.style.overflow = c ? "hidden" : "";
      img.style.cssText = c ? `right:auto;bottom:auto;width:${100 / (1 - c[0] - c[2])}%;height:${100 / (1 - c[1] - c[3])}%;left:${(-c[0] * 100) / (1 - c[0] - c[2])}%;top:${(-c[1] * 100) / (1 - c[1] - c[3])}%` : "";
      return;
    }
    if (it.k === "link" || it.k === "file") {
      const c = I.card(it), box = el.firstChild;
      box.querySelector(".bd-badge").textContent = c.badge;
      box.querySelector("b").textContent = c.title;
      box.querySelector("i").textContent = c.sub;
      return;
    }
    if (it.k === "shape") {
      const svg = el.firstChild, path = svg.firstChild;
      svg.setAttribute("viewBox", `0 0 ${it.w} ${it.h}`);
      path.setAttribute("d", I.shapePath(it.shape, it.w, it.h));
      path.setAttribute("style", `fill:${it.fill};stroke:${it.stroke.c === "none" ? "none" : ink(it.stroke.c)};stroke-width:${it.stroke.w};stroke-linejoin:round`);
    }
    el.style.background = it.k === "sticky" ? (it.fill === "none" ? I.PAPERS.yellow : it.fill) : "";
    const t = el.querySelector(".bd-t"), color = I.textColor(it, "auto");
    t.style.cssText = `font-size:${it.ts.size}px;font-weight:${it.ts.bold ? 600 : 400};font-style:${it.ts.italic ? "italic" : "normal"};text-decoration:${it.ts.underline ? "underline" : "none"};text-align:${it.ts.align};color:${color === "auto" ? auto : color}`;
    if (!editing && t.textContent !== it.text) t.textContent = it.text;
    t.dataset.empty = it.text ? "" : "1";
  }
  /* The layer shows these items, in this order. editing: the id of the one whose text is being typed (left alone). */
  function sync(layer, items, editing = null, cell = null) {
    let map = els.get(layer);
    if (!map) els.set(layer, (map = new Map()));
    const seen = new Set();
    items.forEach((it, order) => {
      if (it.k === "ink" || !B.items.KINDS.has(it.k)) return;
      seen.add(it.id);
      let e = map.get(it.id);
      if (!e) { e = { el: make(it), sig: "" }; map.set(it.id, e); layer.appendChild(e.el); }
      const sig = order + JSON.stringify(it);
      if (sig !== e.sig) { draw(e.el, it, order, editing === it.id, cell); e.sig = sig; }
    });
    for (const [id, e] of map) if (!seen.has(id)) { e.el.remove(); map.delete(id); }
  }
  const elOf = (layer, id) => (els.get(layer) && els.get(layer).get(id) ? els.get(layer).get(id).el : null);
  B.layer = { sync, elOf };
})();
