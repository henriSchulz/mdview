/* mdview — a whiteboard's view: which part of the endless board the window shows, and how large.
 * x, y: the board's point in the window's top left corner; z: screen pixels per board pixel. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const MIN = 0.1, MAX = 4, STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4];
  const clamp = (z) => Math.max(MIN, Math.min(MAX, z));

  function make(size, changed) {
    const v = {
      x: 0, y: 0, z: 1,
      toBoard: (cx, cy) => [v.x + cx / v.z, v.y + cy / v.z],
      set(x, y, z) { v.x = x; v.y = y; v.z = clamp(z); changed(); },
      panBy(dx, dy) { v.x -= dx / v.z; v.y -= dy / v.z; changed(); },
      // the point under (cx, cy) stays under it
      zoomAt(cx, cy, z) {
        z = clamp(z);
        const [bx, by] = v.toBoard(cx, cy);
        v.z = z; v.x = bx - cx / z; v.y = by - cy / z;
        changed();
      },
      step(dir) { // the next of the fixed sizes, around the window's middle
        const { w, h } = size(), i = dir > 0 ? STEPS.findIndex((s) => s > v.z + 0.001) : STEPS.length - 1 - [...STEPS].reverse().findIndex((s) => s < v.z - 0.001);
        v.zoomAt(w / 2, h / 2, STEPS[i < 0 || i >= STEPS.length ? (dir > 0 ? STEPS.length - 1 : 0) : i]);
      },
      // box: [x0, y0, x1, y1] of the board, shown whole with room around — never larger than life
      // (most: how large at most — a scene is shown as large as it was framed)
      fit(box, pad = 64, most = 1) {
        const { w, h } = size();
        if (!box) return v.set(-w / 2, -h / 2, 1);
        const bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
        const z = clamp(Math.min(most, (w - 2 * pad) / bw, (h - 2 * pad) / bh));
        v.set((box[0] + box[2]) / 2 - w / 2 / z, (box[1] + box[3]) / 2 - h / 2 / z, z);
      },
    };
    return v;
  }
  B.view = { make, MIN, MAX, STEPS };
})();
