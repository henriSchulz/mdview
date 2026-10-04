// Random sequences of what can be done with columns — made, changed, blocks
// moved in and out, dragged beside others — after each of which the file must
// say what the editor shows.
import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, ACTIVE } from "./harness.mjs";

const w = await loadPage(ACTIVE);
const A = w.MdActive, PM = w.PM;
const { EditorState, TextSelection } = PM.state;
const N = A.schema.nodes, C = A.columns;

const SRC = "# Title\n\nText above.\n\n<!-- columns 2:1 -->\n\n## Wide\n\nA paragraph.\n\n- a list\n- of two\n\n> [!info]\n> A callout.\n\n<!-- column -->\n\n## Narrow\n\n- [ ] task\n- [x] done\n\n<!-- /columns -->\n\nBetween.\n\n<!-- columns -->\n\n**One**\n\n<!-- column -->\n\n<!-- wide -->\n| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- column -->\n\n```js\nlet x = 1;\n```\n\n<!-- /columns -->\n\nText below.\n";

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const tops = (doc) => { const out = []; doc.forEach((n) => { if (!(n.type === N.paragraph && !n.content.size) && !(n.type === N.island && n.attrs.virtual)) out.push(n); }); return out; };

function run(seed, steps) {
  const rand = rng(seed), pick = (a) => a[Math.floor(rand() * a.length)];
  const d = A.document.open({ text: SRC, raw: SRC, links: {}, vault: false });
  const v = { state: EditorState.create({ doc: d.doc, plugins: A.edit.plugins(d) }), editable: true, dispatch(tr) { v.state = v.state.apply(tr); }, focus() {}, hasFocus: () => true };
  const log = [];
  const textblocks = () => { const out = []; v.state.doc.descendants((n, p) => { if (n.isTextblock) out.push(p + 1); return true; }); return out; };
  // blocks as the handle takes them: of the document, of a column
  const blocks = () => { const out = []; v.state.doc.forEach((n, p) => { out.push({ pos: p, node: n }); if (n.type === N.columns) { let cp = p + 1; n.forEach((col) => { let bp = cp + 1; col.forEach((b) => { out.push({ pos: bp, node: b, inCol: true }); bp += b.nodeSize; }); cp += col.nodeSize; }); } }); return out.filter((x) => !(x.node.type === N.island && x.node.attrs.virtual)); };
  const columns = () => { const out = []; v.state.doc.forEach((n, p) => { if (n.type === N.columns) { let cp = p + 1; n.forEach((col) => { out.push(cp); cp += col.nodeSize; }); } }); return out; };
  const cmd = (c) => c(v.state, (tr) => v.dispatch(tr));
  for (let i = 0; i < steps; i++) {
    const op = pick(["caret", "caret", "type", "make", "add", "remove", "unwrap", "equal", "move", "widths", "drag", "drag", "side", "side", "dup", "del", "deco", "pick", "pick", "pick", "key", "key", "pdrag"]);
    log.push(op);
    try {
      if (op === "caret") v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, pick(textblocks()))));
      else if (op === "type") v.dispatch(v.state.tr.insertText(pick(["x", " word", "!"])));
      else if (op === "make") cmd(C.make(pick([2, 3, 4])));
      else if (op === "add") cmd(C.add(pick([-1, 1])));
      else if (op === "remove") cmd(C.remove);
      else if (op === "unwrap") cmd(C.unwrap);
      else if (op === "equal") cmd(C.equal);
      else if (op === "move") cmd(C.move(pick([-1, 1])));
      else if (op === "widths") { const c = C.at(v.state); if (c) { const tr = v.state.tr; let pos = c.colsPos + 1; c.cols.forEach((col) => { tr.setNodeMarkup(pos, null, { ...col.attrs, width: pick([1, 2, 33.3, 61.8]) }); pos += col.nodeSize; }); v.dispatch(tr); } }
      else if (op === "dup" && !v.state.selection.$from.parent.content.size) continue; // (an empty line twice is still nothing in the file)
      else if (op === "dup") A.slash.BLOCK.duplicate(v);
      else if (op === "del") A.slash.BLOCK.remove(v);
      else if (op === "deco" && (!v.state.selection.empty || !v.state.selection.$from.parent.isTextblock || !v.state.selection.$from.parent.content.size)) continue; // (a quote with nothing in it is no block Markdown holds as such)
      else if (op === "deco") A.context.run(v, pick([A.context.setDeco("block"), A.context.setCallout("tip"), A.context.PARAGRAPH.quote]));
      else if (op === "pick") A.blocks.toggle(v, pick(blocks()).pos); // Ctrl+click
      else if (op === "key") { // the keyboard on what is selected as blocks
        const [key, mods] = pick([["ArrowUp", { altKey: true }], ["ArrowDown", { altKey: true }], ["ArrowUp", { altKey: true, shiftKey: true }], ["ArrowDown", { altKey: true, shiftKey: true }], ["Backspace", {}], ["d", { ctrlKey: true }], [" ", {}], ["ArrowDown", {}], ["ArrowUp", { shiftKey: true }], ["Escape", {}]]);
        A.blocks.selPlugin.props.handleKeyDown(v, { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, ...mods });
      } else if (op === "pdrag") { // what is selected, dragged: every stretch of it goes, and lands together
        const P = A.blocks.picked(v.state);
        if (!P.length) continue;
        const ranges = [];
        for (const x of P) { const last = ranges[ranges.length - 1]; if (last && last.to === x.pos) last.to = x.pos + x.node.nodeSize; else ranges.push({ from: x.pos, to: x.pos + x.node.nodeSize }); }
        let content = PM.model.Fragment.empty;
        for (const x of P) content = content.addToEnd(x.node);
        const inside = (p) => ranges.some((r) => p > r.from && p < r.to);
        const cand = blocks().flatMap((x) => [x.pos, x.pos + x.node.nodeSize]).filter((p) => !inside(p) && (() => { const $p = v.state.doc.resolve(p); return $p.parent.canReplace($p.index(), $p.index(), content); })());
        if (!cand.length) continue;
        const t = pick(cand), tr = v.state.tr;
        for (const r of ranges.slice().reverse()) tr.deleteRange(r.from, r.to);
        tr.insert(tr.mapping.map(t, t <= ranges[0].from ? -1 : 1), content);
        for (const r of ranges.slice().reverse()) C.tidy(tr, tr.mapping.map(r.from));
        v.dispatch(tr);
      }
      else if (op === "drag" || op === "side") { // as the handle's drop does it (blocks.js)
        const all = blocks(), src = pick(all);
        const from = src.pos, to = src.pos + src.node.nodeSize, content = PM.model.Fragment.from(src.node);
        if (op === "drag") {
          const cand = all.filter((x) => !(x.pos >= from && x.pos < to)).flatMap((x) => [x.pos, x.pos + x.node.nodeSize]).filter((p) => { const $p = v.state.doc.resolve(p); return $p.parent.canReplace($p.index(), $p.index(), content); });
          if (cand.length) {
            const t = pick(cand), tr = v.state.tr.deleteRange(from, to);
            tr.insert(tr.mapping.map(t, t <= from ? -1 : 1), content);
            C.tidy(tr, tr.mapping.map(from));
            v.dispatch(tr);
          }
        } else if (src.node.type !== N.columns) {
          const cand = [...all.filter((x) => !x.inCol && x.node.type !== N.columns && x.pos !== from).map((x) => x.pos), ...columns().filter((p) => !(p + 1 === from && p + v.state.doc.nodeAt(p).nodeSize - 1 === to))];
          if (cand.length) {
            const t = pick(cand), tr = v.state.tr.deleteRange(from, to);
            C.beside(tr, tr.mapping.map(t, t <= from ? -1 : 1), pick([-1, 1]), content);
            C.tidy(tr, tr.mapping.map(from));
            v.dispatch(tr);
          }
        }
      }
      v.state.doc.check();
    } catch (err) {
      return `seed ${seed}: ${op} threw ${err.message}\n  steps: ${log.join(" ")}`;
    }
    const out = A.document.serialize(d, v.state.doc, false);
    const again = tops(A.document.open({ text: out, raw: out, links: {}, vault: false }).doc), now = tops(v.state.doc);
    const bad = again.length !== now.length ? -2 : now.findIndex((n, k) => !A.markdown.same(n, again[k]));
    if (bad === -1) continue;
    return `seed ${seed}: after ${op} the file does not say what the editor shows (block ${bad})\n  steps: ${log.join(" ")}\n  editor: ${now.map((n) => n.type.name).join(" ")}\n  file:   ${again.map((n) => n.type.name).join(" ")}\n  ed: ${bad >= 0 ? JSON.stringify(A.markdown.shape(now[bad])).slice(0, 500) : ""}\n  fi: ${bad >= 0 ? JSON.stringify(A.markdown.shape(again[bad])).slice(0, 500) : ""}`;
  }
  return null;
}

test("random column edits: the file says what the editor shows", () => {
  const rounds = Number(process.env.MDVIEW_FUZZ || 60), failures = [];
  for (let seed = 1; seed <= rounds && failures.length < 3; seed++) { const f = run(seed, 40); if (f) failures.push(f); }
  assert.equal(failures.length, 0, "\n" + failures.join("\n\n"));
});
