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
      await sleep(320); // (the handle comes when the pointer has rested on the block a moment)
      const dt = new DataTransfer();
      // taken at the handle: from there on, the pointer's way sideways says how deep
      const hr = h.getBoundingClientRect(), hx = hr.left + 9, dx = item(what).getBoundingClientRect().left - hx;
      h.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, clientX: hx, clientY: hr.top + 9, dataTransfer: dt }));
      const t = own(where).getBoundingClientRect(), left = item(where).getBoundingClientRect().left;
      const x = left + inX - dx, y = half === "upper" ? t.top + 3 : t.bottom - 3;
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
      const shown = line.hasAttribute("data-on"), lx = Math.round(line.getBoundingClientRect().left - left);
      (document.elementFromPoint(x, y) || document.body).dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
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
    EXPECT["A2 above A1 (own sub-list, straight up)"] = "- A\n  - A2\n  - A1\n- B\n  - B1\n  - B2\n- C";
    EXPECT["A1 below A2 (own sub-list, straight down)"] = "- A\n  - A2\n  - A1\n- B\n  - B1\n  - B2\n- C";
    EXPECT["A2 between B1 and B2, pointer on B2's upper half"] = "- A\n  - A1\n- B\n  - B1\n  - A2\n  - B2\n- C";
    EXPECT["C above B, straight up (stays an outer item)"] = "- A\n  - A1\n  - A2\n- C\n- B\n  - B1\n  - B2";
    EXPECT["A above C, straight down (stays an outer item)"] = "- B\n  - B1\n  - B2\n- A\n  - A1\n  - A2\n- C";
    const cases = [
      ["A2 above A1 (own sub-list, straight up)", async () => drag("A2", "A1", "upper", 0), 0],
      ["A1 below A2 (own sub-list, straight down)", async () => drag("A1", "A2", "lower", 0), 0],
      ["A2 between B1 and B2, pointer on B2's upper half", async () => drag("A2", "B2", "upper", 0), 0],
      ["C above B, straight up (stays an outer item)", async () => drag("C", "B", "upper", 0), 0],
      ["A above C, straight down (stays an outer item)", async () => drag("A", "C", "upper", 0), 0],
      ["A2 before B1", async () => drag("A2", "B1", "upper", 4), 0],
      ["A2 after B2", async () => drag("A2", "B2", "lower", 4), 0],
      ["A1 after B2, then A2 too (A's sub-list is gone)", async () => { await drag("A1", "B2", "lower", 4); return drag("A2", "A1", "lower", 4); }, 0],
      ["B1 out a level, after B", async () => drag("B1", "B2", "lower", -50), "out"],
      ["C under A (first sub-item)", async () => drag("C", "A", "lower", 40), null],
      ["A1 under C (a new sub-list)", async () => drag("A1", "C", "lower", 40), "in"],
      ["B (with its sub-items) before A", async () => drag("B", "A", "upper", 4), 0],
      ["C out of the list, below the paragraph", async () => drag("C", "Paragraph.", "lower", 4), 0],
      ["two into the bullet list, after B", async () => drag("two", "B2", "lower", -50), null],
      ["B2 under B1 (a third level)", async () => drag("B2", "B1", "lower", 40), "in"],
    ];
    for (const [name, run, lx] of cases) {
      const r = await run();
      const got = md();
      o.got[name] = got;
      const want = EXPECT[name];
      const body = (t) => t.replace(/^# Lists\n\n/, "").trimEnd();
      ok(name, r.shown && (want.includes("Paragraph") ? body(got) === want : body(got).startsWith(want + "\n\nParagraph.") || body(got).startsWith(want + "\n\n")) && (lx == null || (lx === "in" ? r.lx > 12 : lx === "out" ? r.lx < -12 : Math.abs(r.lx - lx) <= 3)), [r, body(got)]);
      await reset();
      ok("… undone", md() === original, md());
    }
    // --- the handle of a sub-item, with the real pointer: reached from its text, and from its bullet
    {
      const post = (type, data = {}) => window.webkit.messageHandlers.mdview.postMessage(JSON.stringify({ type, ...data }));
      const at = (kind, x, y) => post("probe-pointer", { kind, x, y });
      const t = own("B1").getBoundingClientRect(), li = item("B1");
      at("move", t.left + 10, t.top + t.height / 2); await sleep(250);
      ok("pointer on a sub-item's text: its handle", A.blocks.over() === li && h.hasAttribute("data-on"));
      const hr = h.getBoundingClientRect();
      let held = true;
      for (let x = t.left; x > hr.left + 9; x -= 6) { at("move", x, t.top + t.height / 2 + 5); await sleep(25); if (A.blocks.over() !== li || !h.hasAttribute("data-on")) held = false; }
      at("move", hr.left + 9, hr.top + 9); await sleep(500);
      ok("… it stays that item's all the way to the handle, and while the pointer rests on it", held && A.blocks.over() === li && h.hasAttribute("data-on") && h.matches(":hover"), [held, h.matches(":hover")]);
      at("move", 600, 40); await sleep(600);
      const b2 = own("B2").getBoundingClientRect(), li2 = item("B2");
      at("move", li2.getBoundingClientRect().left - 14, b2.top + b2.height / 2); await sleep(250);
      ok("pointer on a sub-item's bullet: that item's handle (not the list's)", A.blocks.over() === li2, A.blocks.over() && A.blocks.over().tagName + ":" + A.blocks.over().textContent.slice(0, 8));
      at("move", 600, 40); await sleep(500);
    }
    // nowhere to go: onto itself, into its own sub-items
    let r = await drag("B", "B1", "lower", 0);
    ok("an item cannot go into itself: no line, nothing moves", !r.shown && md() === original, [r, md()]);
    await sleep(900);
    o.saved = md();
  } catch (e) { o.error = String(e && (e.message + "\n" + e.stack) || e); }
  out("lists", o);
})();
