/* mdview — a whiteboard's hands: the one place that listens to pointers. A mouse or a pen works
 * the tool (the middle button, or the left one with Space held, moves the board); one finger works
 * the tool too, two fingers move the board and pull it larger or smaller. Everything is pointer
 * events — pressure, tilt and the kind of pointer come with them, so a pen needs no second way in. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});

  /* on: { start(pt, e) → false to refuse, move(pts, e), end(e), cancel(), pan(dx, dy), zoom(factor, cx, cy), hover(pt, e), space() → held? }
   * A point is { x, y } in the stage's pixels plus pressure, tilt, azimuth, time, type. */
  function attach(stage, on) {
    const fingers = new Map(); // touches down: id → { x, y }
    let tool = null, drag = null, pinch = null;
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
      if (e.pointerType === "touch") {
        fingers.set(e.pointerId, at(e));
        if (fingers.size === 2) { // the second finger: what the first began is not a stroke
          if (tool) { tool = null; on.cancel(); }
          pinch = span();
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
      if (on.start(point(e), e) === false) return;
      tool = e.pointerId;
      capture(e); e.preventDefault();
    });
    stage.addEventListener("pointermove", (e) => {
      if (fingers.has(e.pointerId)) {
        fingers.set(e.pointerId, at(e));
        if (pinch && fingers.size === 2) {
          const now = span();
          on.pan(now.x - pinch.x, now.y - pinch.y);
          if (pinch.d > 0 && now.d > 0) on.zoom(now.d / pinch.d, now.x, now.y);
          pinch = now;
          return;
        }
      }
      if (drag && e.pointerId === drag.id) { const p = at(e); on.pan(p.x - drag.x, p.y - drag.y); drag.x = p.x; drag.y = p.y; return; }
      if (tool === e.pointerId) {
        // every sample since the last frame, where the browser hands them over whole
        let all = null;
        try { all = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null; } catch (x) { all = null; }
        if (!all || !all.length || !all.every((c) => Number.isFinite(c.clientX) && c.pointerId === e.pointerId)) all = [e];
        on.move(all.map(point), e);
        return;
      }
      if (!tool && !fingers.size) on.hover(point(e), e);
    });
    const up = (e, cancelled) => {
      if (fingers.delete(e.pointerId) && fingers.size < 2) pinch = null;
      if (drag && e.pointerId === drag.id) { drag = null; delete stage.dataset.panning; }
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
