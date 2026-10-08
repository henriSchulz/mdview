/* mdview — a whiteboard's items on the screen: one element each in a layer that is moved and
 * scaled with the view (the ink's canvas lies over it). Drawn from the same shapes as the board's
 * picture (items.js); text is the browser's own, so that it can be typed in place. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const NS = "http://www.w3.org/2000/svg";
  const els = new WeakMap(); // layer → Map(id → { el, sig })

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
    if (it.k !== "line") {
      const box = document.createElement("div"), t = document.createElement("div");
      box.className = "bd-text"; t.className = "bd-t";
      box.appendChild(t); el.appendChild(box);
    }
    return el;
  }
  function draw(el, it, order, editing) {
    const I = B.items, auto = "var(--fg)", ink = (c) => (c === "auto" ? auto : c);
    el.style.zIndex = String(order);
    el.toggleAttribute("data-lock", !!it.lock);
    if (it.k === "line") {
      const b = I.bounds(it), [x1, y1, x2, y2] = it.p, svg = el.firstChild, [line, h1, h2] = svg.children, c = ink(it.stroke.c === "none" ? "auto" : it.stroke.c);
      el.style.cssText += `;left:${b[0]}px;top:${b[1]}px;width:${b[2] - b[0]}px;height:${b[3] - b[1]}px;transform:none`;
      svg.setAttribute("viewBox", `${b[0]} ${b[1]} ${b[2] - b[0]} ${b[3] - b[1]}`);
      const back = (ax, ay, bx, by, on) => { const len = Math.hypot(bx - ax, by - ay) || 1, d = on ? Math.min(len / 2, 4 + it.stroke.w * 2) : 0; return [ax + ((bx - ax) * d) / len, ay + ((by - ay) * d) / len]; };
      const a = back(x1, y1, x2, y2, it.ends[0] === "arrow"), z = back(x2, y2, x1, y1, it.ends[1] === "arrow");
      line.setAttribute("d", `M${a[0]} ${a[1]}L${z[0]} ${z[1]}`);
      line.setAttribute("style", `fill:none;stroke:${c};stroke-width:${it.stroke.w};stroke-linecap:${it.ends.includes("arrow") ? "butt" : "round"}`);
      h1.setAttribute("d", it.ends[0] === "arrow" ? I.head(x1, y1, x2, y2, it.stroke.w) : ""); h1.setAttribute("style", `fill:${c}`);
      h2.setAttribute("d", it.ends[1] === "arrow" ? I.head(x2, y2, x1, y1, it.stroke.w) : ""); h2.setAttribute("style", `fill:${c}`);
      return;
    }
    el.style.cssText += `;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;transform:rotate(${it.r || 0}deg)`;
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
  function sync(layer, items, editing = null) {
    let map = els.get(layer);
    if (!map) els.set(layer, (map = new Map()));
    const seen = new Set();
    items.forEach((it, order) => {
      if (it.k === "ink" || !B.items.KINDS.has(it.k)) return;
      seen.add(it.id);
      let e = map.get(it.id);
      if (!e) { e = { el: make(it), sig: "" }; map.set(it.id, e); layer.appendChild(e.el); }
      const sig = order + JSON.stringify(it);
      if (sig !== e.sig) { draw(e.el, it, order, editing === it.id); e.sig = sig; }
    });
    for (const [id, e] of map) if (!seen.has(id)) { e.el.remove(); map.delete(id); }
  }
  const elOf = (layer, id) => (els.get(layer) && els.get(layer).get(id) ? els.get(layer).get(id).el : null);
  B.layer = { sync, elOf };
})();
