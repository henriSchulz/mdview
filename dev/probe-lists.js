/* Development probe (dev/rig.sh lists): list items dragged by their handle —
 * between sub-lists, under another item, out a level, out of the list —
 * and the line that shows where and how deep. Works on a copy of
 * tests/fixtures/lists.md. EXPECT is filled in below; without it the probe
 * only reports what came out. */
(async () => {
  const out = (name, o) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type: "probe", name, text: JSON.stringify(o) }));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = { steps: [], got: {} };
  const ok = (name, cond, detail) => o.steps.push((cond ? "ok   " : "FAIL ") + name + (cond ? "" : "  " + JSON.stringify(detail)));
  try {
    await document.fonts.ready;
    await sleep(700);
    const original = MdView.core.current.raw;
    MdView.setMode("active");
    for (let i = 0; i < 300 && !(window.MdActive && MdActive.view && MdActive.view.pm && document.body.dataset.view === "active"); i++) await sleep(10);
    await sleep(300);
    const A = MdActive, V = A.view, view = V.pm;
    const md = () => V.serialize(false);
    const h = document.querySelector(".blk-h"), line = document.querySelector(".blk-line");
    // the element of the item (or block) whose own text is `text`
    const own = (text) => [...view.dom.querySelectorAll("li > p, li > .li-body > p, .pm > p")].find((p) => p.textContent === text);
    const item = (text) => own(text).closest("li") || own(text);
    /* drag `what` to `where`: half = "upper" | "lower" of the target's own line; inX = pixels right of the target item's left edge */
    const drag = async (what, where, half, inX) => {
      own(what).dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      await sleep(120);
      const dt = new DataTransfer();
      h.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const t = own(where).getBoundingClientRect(), left = item(where).getBoundingClientRect().left;
      const x = left + inX, y = half === "upper" ? t.top + 3 : t.bottom - 3;
      document.body.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      const shown = line.hasAttribute("data-on"), lx = Math.round(line.getBoundingClientRect().left - left);
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      h.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
      await sleep(200);
      return { shown, lx };
    };
    const reset = async () => { for (let i = 0; i < 12 && md() !== original; i++) PM.history.undo(view.state, view.dispatch); await sleep(60); };
    const EXPECT = {
      "A2 before B1": "- A\n  - A1\n- B\n  - A2\n  - B1\n  - B2\n- C",
      "A2 after B2": "- A\n  - A1\n- B\n  - B1\n  - B2\n  - A2\n- C",
      "A1 after B2, then A2 too (A's sub-list is gone)": "- A\n- B\n  - B1\n  - B2\n  - A1\n  - A2\n- C",
      "B1 out a level, after B": "- A\n  - A1\n  - A2\n- B\n  - B2\n- B1\n- C",
      "C under A (first sub-item)": "- A\n  - C\n  - A1\n  - A2\n- B\n  - B1\n  - B2",
      "A1 under C (a new sub-list)": "- A\n  - A2\n- B\n  - B1\n  - B2\n- C\n  - A1",
      "B (with its sub-items) before A": "- B\n  - B1\n  - B2\n- A\n  - A1\n  - A2\n- C",
      "C out of the list, below the paragraph": "- A\n  - A1\n  - A2\n- B\n  - B1\n  - B2\n\nParagraph.\n\n- C\n\n1. one\n2. two",
      "two into the bullet list, after B": "- A\n  - A1\n  - A2\n- B\n  - B1\n  - B2\n- two\n- C\n\nParagraph.\n\n1. one",
      "B2 under B1 (a third level)": "- A\n  - A1\n  - A2\n- B\n  - B1\n    - B2\n- C",
    };
    const cases = [
      ["A2 before B1", async () => drag("A2", "B1", "upper", 4), 0],
      ["A2 after B2", async () => drag("A2", "B2", "lower", 4), 0],
      ["A1 after B2, then A2 too (A's sub-list is gone)", async () => { await drag("A1", "B2", "lower", 4); return drag("A2", "A1", "lower", 4); }, 0],
      ["B1 out a level, after B", async () => drag("B1", "B2", "lower", -50), null],
      ["C under A (first sub-item)", async () => drag("C", "A", "lower", 40), null],
      ["A1 under C (a new sub-list)", async () => drag("A1", "C", "lower", 40), 28],
      ["B (with its sub-items) before A", async () => drag("B", "A", "upper", 4), 0],
      ["C out of the list, below the paragraph", async () => drag("C", "Paragraph.", "lower", 4), 0],
      ["two into the bullet list, after B", async () => drag("two", "B2", "lower", -50), null],
      ["B2 under B1 (a third level)", async () => drag("B2", "B1", "lower", 40), 28],
    ];
    for (const [name, run, lx] of cases) {
      const r = await run();
      const got = md();
      o.got[name] = got;
      const want = EXPECT[name];
      const body = (t) => t.replace(/^# Lists\n\n/, "").trimEnd();
      ok(name, r.shown && (want.includes("Paragraph") ? body(got) === want : body(got).startsWith(want + "\n\nParagraph.") || body(got).startsWith(want + "\n\n")) && (lx == null || Math.abs(r.lx - lx) <= 3), [r, body(got)]);
      await reset();
      ok("… undone", md() === original, md());
    }
    // nowhere to go: onto itself, into its own sub-items
    let r = await drag("B", "B1", "lower", 4);
    ok("an item cannot go into itself: no line, nothing moves", !r.shown && md() === original, [r, md()]);
    await sleep(900);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("lists", o);
})();
