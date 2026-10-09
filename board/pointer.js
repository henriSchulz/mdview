/* mdview — a whiteboard's hands: the one place that listens to pointers. A mouse or a pen works
 * the tool (the middle button, or the left one with Space held, moves the board); one finger works
 * the tool too, two fingers move the board and pull it larger or smaller. Everything is pointer
 * events — pressure, tilt and the kind of pointer come with them, so a pen needs no second way in. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});

  /* on: { start(pt, e) → false to refuse, "pan": this pointer moves the board instead (and, held still first, hold(pt, e) is asked
   *       whether it begins something after all); move(pts, e), end(e), cancel(), pan(dx, dy), zoom(factor, cx, cy), hover(pt, e),
   *       tap(pt, e): such a pointer went up again without having moved;
   *       taps(n): n fingers (two, three) touched the board together and went up again at once;
   *       space() → held?; twist(points) → true: two fingers on one thing turn it — twisting(degrees), twisted() }
   * A point is { x, y } in the stage's pixels plus pressure, tilt, azimuth, time, type. */
  function attach(stage, on) {
    const fingers = new Map(); // touches down: id → { x, y }
    let tool = null, drag = null, pinch = null, twist = null, toolType = "";
    // A hand lying on the glass beside the pen: touches while the pen is down, and for a moment after, are nobody's. (The moment is
    // short: the other hand moves the board right after a stroke — at half a second its first try was lost every time.)
    const pen = { down: false, last: -1e9, press: null }, PALM = 120;
    const HOLD = 350, SLACK = 8; // a finger resting this long, within this many pixels: held
    // The board let go while it was moving under one finger goes on by itself, ever slower, as anything does that is pushed on a
    // tablet: how fast it went (pixels a millisecond, smoothed), and the run after the fingers left.
    const speed = { x: 0, y: 0, t: 0 };
    let glide = 0;
    const calm = matchMedia("(prefers-reduced-motion: reduce)");
    const pushed = (dx, dy, t) => { const dt = Math.max(1, t - speed.t); if (dt > 120) { speed.x = speed.y = 0; } else { speed.x += (dx / dt - speed.x) * 0.5; speed.y += (dy / dt - speed.y) * 0.5; } speed.t = t; };
    const halt = () => { cancelAnimationFrame(glide); glide = 0; };
    function coast(t) {
      halt();
      if (calm.matches || t - speed.t > 80 || Math.hypot(speed.x, speed.y) < 0.2) return; // (it stood still when it was let go)
      let vx = speed.x, vy = speed.y, last = performance.now();
      const frame = (now) => {
        const dt = Math.min(40, now - last), k = Math.pow(0.9965, dt);
        last = now;
        on.pan(vx * dt, vy * dt);
        vx *= k; vy *= k;
        glide = Math.hypot(vx, vy) > 0.03 ? requestAnimationFrame(frame) : 0;
      };
      glide = requestAnimationFrame(frame);
    }
    // fingers that only touched the board together: how many there were at most, when the first came down, whether any moved
    let touched = null;
    const at = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    /* How hard the pointer presses, as the stroke is to take it. A mouse says 0.5 while a button is down. A pen says what it
     * feels — but not with every sample (the samples a browser bundles may come without it, as 0), and what it says jumps:
     * taken as it comes, a line is a row of beads. So a sample without pressure has the pressure before it, and each follows
     * the one before only part of the way. */
    function pressure(e) {
      if (e.pointerType === "mouse") return 0.5;
      const said = e.pressure > 0 ? e.pressure : null;
      if (pen.press == null) pen.press = said == null ? 0.3 : said;
      else if (said != null) pen.press += (said - pen.press) * 0.35;
      return Math.round(pen.press * 100) / 100;
    }
    const point = (e) => {
      const tilt = Math.hypot(e.tiltX || 0, e.tiltY || 0);
      return { ...at(e), p: pressure(e), tilt, az: tilt ? (Math.atan2(e.tiltY || 0, e.tiltX || 0) * 180) / Math.PI : 0, t: e.timeStamp, type: e.pointerType };
    };
    // Touches and a pen on the stage are the board's alone: the browser is not to make its own of them — a selection, a callout,
    // handwriting taken for text, the wait to see whether a tap becomes two. (On an iPad strokes begun quickly were lost to that.)
    for (const type of ["touchstart", "touchmove", "touchend"]) stage.addEventListener(type, (e) => { if (!e.target.closest("[data-editing]") && e.cancelable) e.preventDefault(); }, { passive: false });
    const span = () => { const [a, b] = [...fingers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const capture = (e) => { try { stage.setPointerCapture(e.pointerId); } catch (x) { /* (a pointer made up by a test has none) */ } };

    stage.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".bd-bar, [data-editing]")) return; // (a bar's own; text being typed: the browser's)
      halt(); // (whatever comes down holds the board where it is)
      pen.press = null; // (a new stroke: its pressure begins anew)
      if (e.pointerType === "pen") { // the pen comes down: whatever fingers were doing is over (they are the hand that holds it)
        pen.down = true; pen.last = e.timeStamp;
        if (fingers.size) { fingers.clear(); pinch = null; if (twist) { twist = null; on.twisted(); } }
        if (drag) { clearTimeout(drag.hold); drag = null; delete stage.dataset.panning; }
        if (tool != null && toolType === "touch") { tool = null; on.cancel(); }
      }
      if (e.pointerType === "touch") {
        if (pen.down || e.timeStamp - pen.last < PALM) return;
        fingers.set(e.pointerId, at(e));
        if (fingers.size === 1) touched = { t: e.timeStamp, n: 1, moved: false, from: new Map() };
        if (touched) { touched.n = Math.max(touched.n, fingers.size); touched.from.set(e.pointerId, at(e)); }
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
        if (touched && !touched.moved) { const f = touched.from.get(e.pointerId), p = at(e); if (f && Math.hypot(p.x - f.x, p.y - f.y) > SLACK) touched.moved = true; }
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
        on.pan(p.x - drag.x, p.y - drag.y);
        if (e.pointerType === "touch") pushed(p.x - drag.x, p.y - drag.y, e.timeStamp);
        drag.x = p.x; drag.y = p.y;
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
      // (two fingers leave the board where they left it: they never lift together, and what the one left behind does last —
      // the middle between them jumping to it — is no direction to run on in)
      // two fingers, or three, that touched the board and left it at once without moving: a tap of so many fingers
      if (e.pointerType === "touch" && touched && !fingers.size) {
        const was = touched;
        touched = null;
        if (!cancelled && was.n >= 2 && was.n <= 3 && !was.moved && e.timeStamp - was.t < 320 && on.taps) on.taps(was.n);
      }
      if (drag && e.pointerId === drag.id) {
        const tapped = !cancelled && drag.hold && !drag.far, flung = !cancelled && drag.far && e.pointerType === "touch"; // (a finger that came down to move the board and went up again without having moved: a tap)
        clearTimeout(drag.hold); drag = null; delete stage.dataset.panning;
        if (tapped && on.tap) on.tap(point(e), e);
        if (flung) coast(e.timeStamp);
      }
      if (tool === e.pointerId) { tool = null; if (cancelled) on.cancel(); else on.end(e); }
    };
    stage.addEventListener("pointerup", (e) => up(e, false));
    stage.addEventListener("pointercancel", (e) => up(e, true));
    stage.addEventListener("pointerleave", (e) => { if (!tool) on.hover(null, e); });
    // two fingers on a touchpad, or a wheel: the board moves; with Ctrl (and a touchpad's pinch, where the browser passes it on so): larger and smaller
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      halt();
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
