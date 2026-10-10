// A whiteboard's file for the probes (dev/rig.sh board-enter): two strokes around the origin, and — as if last looked at on
// another screen — a view far away from them. → stdout
import { readFileSync } from "node:fs";
import vm from "node:vm";
const root = new URL("../", import.meta.url), w = { Math, JSON, String, Number, Object, Array, Map, Set, Error, Infinity };
w.window = w;
vm.createContext(w);
for (const f of ["board/format.js", "board/render.js", "board/shape.js", "board/items.js"]) vm.runInContext(readFileSync(new URL(f, root), "utf8"), w, { filename: f });
const F = w.MdBoard.format, model = F.fresh();
const line = (id, x0, y0, x1, y1) => ({ id, k: "ink", t: "pen", c: "auto", o: 1, w: 4, ch: "xypt", pts: Array.from({ length: 30 }, (_v, i) => [x0 + ((x1 - x0) * i) / 29, y0 + ((y1 - y0) * i) / 29, 0.5, i * 8]) });
model.items.push(line("aaaaaaa1", 0, 0, 600, 300), line("aaaaaaa2", 0, 300, 600, 0));
model.board.view = { x: 6000, y: 4000, z: 2.5 };
process.stdout.write(F.write(model));
