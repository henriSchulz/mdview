/* mdview — the hand that writes for Claude on a whiteboard: a line of a letter (or a sign, or a stroke Claude drew) is not
 * traced, it is written. What is kept of the line is where the hand means to go — a few points, its skeleton — and the hand
 * moves there as a hand moves (Plamondon's kinematic theory of handwriting: each movement from one point to the next speeds
 * up and slows down along a lognormal, and the next one starts before it has ended). So the curves come by themselves, a
 * corner is rounded where the hand goes on and stays a point where it turns back, a long stroke goes faster than a short one,
 * and the pressure follows the speed: heavy where it is slow, light where it flies, rising as the pen comes down and easing
 * off as it leaves. That no two letters are alike comes from the movement too — where it aims, how long it takes — not from
 * trembling laid over a font's line. Letters, signs of a formula and strokes Claude drew itself all go through this one hand
 * (board/claude.js: hand), so that they belong together (Henri, 2026-11-03: „ein fließendes Zusammenspiel“).
 * No DOM here: the tests load this file as it is. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  const shake = (a) => (Math.random() * 2 - 1) * a;
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5; // (about −1…1, most near 0)
  const len = (pts) => pts.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
  // erf, to within a few millionths (Abramowitz and Stegun 7.1.26)
  const erf = (x) => { const s = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)); };
  // how far a movement begun at t0 (median duration m, spread s) has come at t: 0 … 1
  const done = (t, t0, m, s) => (t <= t0 ? 0 : 0.5 * (1 + erf((Math.log(t - t0) - Math.log(m)) / (s * Math.SQRT2))));

  /* A style of writing: what a hand does, as numbers — the same for every letter and sign, so that a style chosen (in
   * dev/hand-lab.html) is the style of all of them.
   *   aim     how near the hand keeps to the font's line (the points it aims at, px per px of size)
   *   miss    how far beside them it lands (per px of size, at mess 1)
   *   flow    how far one movement runs into the next where the hand goes on the same way (0 … 0.8)
   *   bow     how much a movement bends with the line (0 straight … 1)
   *   press   its pressure, about 0.5;  heavy: how much heavier where it is slow (0 … 0.4)
   *   slant, slantVar   the lean of its letters (a share of their height) and how much it varies from text to text
   *   wide, apart       how wide its letters, and how far apart (shares of the font's)
   *   wobble  how unlike each other its letters are (size, width, lean, turn; 1 as most write)
   *   drift   how much its line wanders up and down and its letters bend (1 as most write) */
  const styles = {
    hand: { aim: 0.014, miss: 0.012, flow: 0.68, bow: 1, press: 0.48, heavy: 0.2, slant: 0.095, slantVar: 0.065, wide: 0.86, apart: 0.95, wobble: 1, drift: 1 },
    script: { aim: 0.014, miss: 0.012, flow: 0.68, bow: 1, press: 0.48, heavy: 0.2, slant: 0.05, slantVar: 0.03, wide: 0.98, apart: 0.95, wobble: 1, drift: 1 },
  };
  const styleOf = (name) => styles[name] || styles.hand;

  /* Where the hand means to go along a line: its points thinned to those that make its shape (Douglas–Peucker, eps px). */
  function aims(run, eps) {
    if (run.length < 3) return run.slice();
    const keep = new Uint8Array(run.length);
    keep[0] = keep[run.length - 1] = 1;
    const stack = [[0, run.length - 1]];
    while (stack.length) {
      const [a, z] = stack.pop(), ax = run[a][0], ay = run[a][1], dx = run[z][0] - ax, dy = run[z][1] - ay, d = Math.hypot(dx, dy);
      let far = -1, at = -1;
      for (let i = a + 1; i < z; i++) {
        const e = d < 1e-9 ? Math.hypot(run[i][0] - ax, run[i][1] - ay) : Math.abs((run[i][0] - ax) * dy - (run[i][1] - ay) * dx) / d;
        if (e > far) { far = e; at = i; }
      }
      if (far > eps) { keep[at] = 1; stack.push([a, at], [at, z]); }
    }
    return run.filter((_p, i) => keep[i]);
  }

  /* A line written: run [[x, y], …] in px → [[x, y, pressure, ms], …], a point about every `step` px.
   * o: size (a capital's height, px: the hand's scale), mess (0.5 careful … 1 as most write … 1.4 hurried),
   *    ends (true: the pen may overshoot or lift early at the end — words; false: it ends where it was asked to, as an arrow
   *    must meet its point), round (1: as a hand writes; less: a drawing's corners stay nearer to corners),
   *    press (the hand's pressure, about 0.5), wander (a slow change of it along the line: s → −1…1). */
  function write(run, o = {}) {
    const size = o.size || 28, mess = o.mess == null ? 1 : o.mess, round = o.round == null ? 1 : o.round, ends = o.ends !== false, st = typeof o.style === "object" && o.style ? o.style : styleOf(o.style);
    const step = Math.max(0.8, size / 28);
    if (run.length < 2 || len(run) < 0.5) return run.map((p) => [p[0], p[1], 0.5]);
    // the points aimed at: a little beside the line's own (never its ends where they must stay)
    const eps = Math.max(0.3, size * st.aim);
    const goal = aims(run, eps).map((p, i, all) => {
      const fixed = !ends && (i === 0 || i === all.length - 1);
      return fixed ? [p[0], p[1]] : [p[0] + gauss() * size * st.miss * mess, p[1] + gauss() * size * st.miss * mess];
    });
    if (ends && goal.length > 1) { // (the pen overshoots a touch, or lifts a touch early)
      const z = goal[goal.length - 1], y = goal[goal.length - 2], d = Math.hypot(z[0] - y[0], z[1] - y[1]) || 1, by = Math.max(-d * 0.3, shake(size * 0.04 * mess));
      goal[goal.length - 1] = [z[0] + ((z[0] - y[0]) / d) * by, z[1] + ((z[1] - y[1]) / d) * by];
    }
    // the movements: one from each point aimed at to the next, longer ones taking longer but going faster; each begins before
    // the one before has ended — far before it where the hand goes on the same way, hardly where it turns back. Each is a bow,
    // not a straight line (sigma-lognormal): its way turns as the line turns about its two ends, so that a round letter is
    // round and not a polygon whose corners were cut; where the hand turns back (a cusp) it is straight.
    const segs = [];
    for (let i = 1; i < goal.length; i++) {
      const dx = goal[i][0] - goal[i - 1][0], dy = goal[i][1] - goal[i - 1][1], L = Math.hypot(dx, dy);
      if (L > 1e-6) segs.push({ dx, dy, L, phi: Math.atan2(dy, dx) });
    }
    if (!segs.length) return run.map((p) => [p[0], p[1], 0.5]);
    const turn = (i) => { if (i < 0 || i >= segs.length - 1) return 0; let d = segs[i + 1].phi - segs[i].phi; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
    const bend = (d) => (Math.abs(d) < Math.PI * 0.55 ? d : 0); // (a turn of more than about 100°: a cusp, no bow across it)
    const moves = [];
    let t0 = 0;
    segs.forEach((g, i) => {
      const T = (0.35 + 0.65 * Math.sqrt(g.L / size)) * (1 + shake(0.12 * mess));
      const dth = Math.max(-2.5, Math.min(2.5, (bend(turn(i - 1)) + bend(turn(i))) / 2 * round * st.bow));
      const D = Math.abs(dth) < 1e-4 ? g.L : (g.L * dth) / (2 * Math.sin(dth / 2)); // (the bow's length, its chord the segment)
      moves.push({ D, th0: g.phi - dth / 2, dth, t0, m: T * 0.55, s: 0.3 + Math.random() * 0.06 * mess, T });
      const c = Math.cos(turn(i)), lap = i < segs.length - 1 ? (0.1 + st.flow * ((1 + c) / 2) ** 2) * round * (1 + shake(0.12 * mess)) : 0;
      t0 += T * (1 - Math.max(0, Math.min(0.8, lap)));
    });
    const last = moves[moves.length - 1], end = last.t0 + last.T * 1.9;
    const along = (v, f) => (Math.abs(v.dth) < 1e-4 ? [v.D * f * Math.cos(v.th0), v.D * f * Math.sin(v.th0)]
      : [(v.D / v.dth) * (Math.sin(v.th0 + v.dth * f) - Math.sin(v.th0)), -(v.D / v.dth) * (Math.cos(v.th0 + v.dth * f) - Math.cos(v.th0))]);
    const at = (t) => { let x = goal[0][0], y = goal[0][1]; for (const v of moves) { const [ax, ay] = along(v, done(t, v.t0, v.m, v.s)); x += ax; y += ay; } return [x, y]; };
    // the way, finely in time, and then a point every `step` px along it, each with the speed the hand had there
    const n = Math.min(4000, Math.max(40, Math.ceil((len(goal) / step) * 4)));
    const path = [];
    for (let k = 0; k <= n; k++) path.push(at((end * k) / n));
    path[n] = goal[goal.length - 1];
    const dt = end / n, out = [[path[0][0], path[0][1], 0]];
    let s = 0, want = step;
    for (let k = 1; k <= n; k++) {
      const a = path[k - 1], b = path[k], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      s += d;
      if (s >= want || k === n) { out.push([b[0], b[1], d / dt, k * dt]); want = s + step; }
    }
    out[0][2] = out.length > 1 ? out[1][2] : 0;
    out[0][3] = 0;
    // (its time, in ms: as fast on the whole as a hand writes, about 1.2 board pixels a millisecond, its pace its own)
    const ms = len(out) / 1.2 / (out[out.length - 1][3] || 1);
    // the pressure: the hand's own, slow where it is heavy, coming down and lifting off
    const speeds = out.map((p) => p[2]).sort((a, b) => a - b), mid = speeds[Math.floor(speeds.length / 2)] || 1, all = len(out), wand = o.wander || (() => 0), press = o.press || st.press;
    let run2 = 0;
    return out.map((p, i) => {
      if (i) run2 += Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]);
      const slow = Math.max(1 - st.heavy * 1.1, Math.min(1 + st.heavy * 1.1, 1 + st.heavy - st.heavy * (p[2] / mid)));
      const down = Math.min(1, run2 / Math.max(2, size * 0.12)), up = Math.min(1, (all - run2) / Math.max(2, size * 0.18));
      const pr = (press + 0.1 * wand(run2)) * slow * (0.45 + 0.55 * down) * (0.35 + 0.65 * up);
      return [p[0], p[1], Math.max(0.08, Math.min(1, pr)), p[3] * ms];
    });
  }

  B.hand = { write, aims, styles, styleOf };
})();
