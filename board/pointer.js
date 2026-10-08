/* mdview — a whiteboard's hands: the one place that listens to pointers. A mouse or a pen works
 * the tool (the middle button, or the left one with Space held, moves the board); one finger works
 * the tool too, two fingers move the board and pull it larger or smaller. Everything is pointer
 * events — pressure, tilt and the kind of pointer come with them, so a pen needs no second way in. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});

  /* on: { start(pt, e) → false to refuse, "pan": this pointer moves the board instead (and, held still first, hold(pt, e) is asked
   *       whether it begins something after all); move(pts, e), end(e), cancel(), pan(dx, dy), zoom(factor, cx, cy), hover(pt, e),
   *       space() → held?; twist(points) → true: two fingers on one thing turn it — twisting(degrees), twisted() }
   * A point is { x, y } in the stage's pixels plus pressure, tilt, azimuth, time, type. */
  function attach(stage, on) {
    const fingers = new Map(); // touches down: id → { x, y }
    let tool = null, drag = null, pinch = null, twist = null, toolType = "";
    const pen = { down: false, last: -1e9 }, PALM = 500; // a hand lying on the glass beside the pen: touches while the pen is down, and for this long after, are nobody's
    const HOLD = 350, SLACK = 8; // a finger resting this long, within this many pixels: held
    const at = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const point = (e) => {
      const tilt = Math.hypot(e.tiltX || 0, e.tiltY || 0);
      // a mouse says 0.5 while a button is down; a pen says what it feels
      return { ...at(e), p: e.pointerType === "mouse" ? 0.5 : e.pressure > 0 ? e.pressure : 0.5, tilt, az: tilt ? (Math.atan2(e.tiltY || 0, e.tiltX || 0) * 180) / Math.PI : 0, t: e.timeStamp, type: e.pointerType };
    };
    const span = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const capture = (e) => { try { stage.setPointerCapture(e.pointerId); } catch (x) { /* (a pointer made up by a test has none) */ } };

    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".bd-bar, [data-editing]")) return; // (a bar's own; text being typed: the browser's)
      if (e.pointerType === "pen") { // the pen comes down: whatever fingers were doing is over (they are the hand that holds it)
        pen.down = true; pen.last = e.timeStamp;
        if (fingers.size) { fingers.clear(); pinch = null; if (twist) { twist = null; on.twisted(); } }
        if (drag) { clearTimeout(drag.hold); drag = null; delete stage.dataset.panning; }
        if (tool != null && toolType === "touch") { tool = null; on.cancel(); }
      }
      if (e.pointerType === "touch") {
        if (pen.down || e.timeStamp - pen.last < PALM) return;
        fingers.set(e.pointerId, at(e));
        if (fingers.size === 2) { // the second finger: what the first began is not a stroke
          if (tool) { tool = null; on.cancel(); }
          if (drag) { clearTimeout(drag.hold); drag = null; delete stage.dataset.panning; }
          // both on one thing that can be turned: it turns with them; else the board moves and grows with them
          const [a, b] = [...fingers.values()];
          if (on.twist && on.twist([a, b])) twist = { from: Math.atan2(b.y - a.y, b.x - a.x) };
          else pinch = span();
          e.preventDefault();
          return;
        }
        if (fingers.size > 2) return;
      }
      if (e.pointerType === "mouse" && (e.button === 1 || (e.button === 0 && on.space()))) {
        drag = { id: e.pointerId, ...at(e) };
        capture(e); e.preventDefault();
        stage.dataset.panning = "";
        return;
      }
      if (e.button !== 0 || tool) return;
      const began = on.start(point(e), e);
      if (began === false) return;
      if (began === "pan") { // (a finger on the bare board with the pointer in hand: the board goes with it — unless it rests first)
        const first = point(e), id = e.pointerId;
        drag = { id, ...at(e), far: false, hold: setTimeout(() => { if (!drag || drag.id !== id || drag.far) return; drag = null; delete stage.dataset.panning; if (on.hold && on.hold(first, e) !== false) { tool = id; toolType = e.pointerType; } }, HOLD) };
        capture(e); e.preventDefault();
        return;
      }
      tool = e.pointerId; toolType = e.pointerType;
      capture(e); e.preventDefault();
    });
    stage.addEventListener("pointermove", (e) => {
      if (fingers.has(e.pointerId)) {
        fingers.set(e.pointerId, at(e));
        if (twist && fingers.size === 2) {
          const [a, b] = [...fingers.values()];
          let deg = ((Math.atan2(b.y - a.y, b.x - a.x) - twist.from) * 180) / Math.PI;
          deg = ((deg + 540) % 360) - 180;
          on.twisting(deg);
          return;
        }
        if (pinch && fingers.size === 2) {
          const now = span();
          on.pan(now.x - pinch.x, now.y - pinch.y);
          if (pinch.d > 0 && now.d > 0) on.zoom(now.d / pinch.d, now.x, now.y);
          pinch = now;
          return;
        }
      }
      if (drag && e.pointerId === drag.id) {
        const p = at(e);
        if (drag.hold && !drag.far && Math.hypot(p.x - drag.x, p.y - drag.y) < SLACK) return; // (still resting: not moved yet)
        drag.far = true; clearTimeout(drag.hold);
        on.pan(p.x - drag.x, p.y - drag.y); drag.x = p.x; drag.y = p.y;
        return;
      }
      if (tool === e.pointerId) {
        // every sample since the last frame, where the browser hands them over whole
        let all = null;
        try { all = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null; } catch (x) { all = null; }
        if (!all || !all.length || !all.every((c) => Number.isFinite(c.clientX) && c.pointerId === e.pointerId)) all = [e];
        // … and where the browser thinks the pointer is going: drawn ahead of the stroke, never kept
        let ahead = [];
        try { ahead = typeof e.getPredictedEvents === "function" ? e.getPredictedEvents().filter((c) => Number.isFinite(c.clientX)).map(point) : []; } catch (x) { ahead = []; }
        if (e.pointerType === "pen") pen.last = e.timeStamp;
        on.move(all.map(point), e, ahead);
        return;
      }
      if (!tool && !fingers.size) on.hover(point(e), e);
    });
    const up = (e, cancelled) => {
      if (e.pointerType === "pen") { pen.down = false; pen.last = e.timeStamp; }
      if (fingers.delete(e.pointerId) && fingers.size < 2) { pinch = null; if (twist) { twist = null; on.twisted(); } }
      if (drag && e.pointerId === drag.id) { clearTimeout(drag.hold); drag = null; delete stage.dataset.panning; }
      if (tool === e.pointerId) { tool = null; if (cancelled) on.cancel(); else on.end(e); }
    };
    stage.addEventListener("pointerup", (e) => up(e, false));
    stage.addEventListener("pointercancel", (e) => up(e, true));
    stage.addEventListener("pointerleave", (e) => { if (!tool) on.hover(null, e); });
    // two fingers on a touchpad, or a wheel: the board moves; with Ctrl (and a touchpad's pinch, where the browser passes it on so): larger and smaller
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = at(e), unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) on.zoom(Math.exp((-e.deltaY * unit) / 240), p.x, p.y);
      else if (e.shiftKey && !e.deltaX) on.pan(-e.deltaY * unit, 0);
      else on.pan(-e.deltaX * unit, -e.deltaY * unit);
    }, { passive: false });
    stage.addEventListener("contextmenu", (e) => e.preventDefault());
    return { busy: () => tool != null || drag != null || fingers.size > 0 };
  }
  B.pointer = { attach };
})();
