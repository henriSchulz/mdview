/* The frame meter (MDVIEW_METER=1: the shell puts data-meter on the body; nothing of it is there otherwise): how long the
 * window's frames take while one works, on the machine where it lags — the rig cannot make a touch screen's or a touchpad's
 * stream of moves (#8). A small panel at the lower left, through which the pointer goes: the frames of the last two seconds
 * (median, p95, how many over 33 ms, the longest), the longest of the last ten, the moves the page heard a second (pointer,
 * touch, drag), and the last frames as bars. It is drawn four times a second, not at each frame, so that it costs little of
 * what it measures. */
(() => {
  "use strict";
  if (!document.body || !document.body.hasAttribute("data-meter")) return;
  const SHORT = 2000, LONG = 10000, SLOW = 33, BARS = 120, EVERY = 250; // ms of the figures; ms a frame may take; bars; ms between drawings
  const frames = []; // [time, length] of each frame of the last ten seconds
  const moves = []; // times of the moves heard in the last two seconds
  let last = 0;
  const panel = document.createElement("div");
  panel.id = "meter";
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = '<div class="mt-row"><b class="mt-fps"></b><span class="mt-text"></span></div><div class="mt-row mt-more"></div><canvas class="mt-bars"></canvas>';
  document.body.appendChild(panel);
  const fps = panel.querySelector(".mt-fps"), text = panel.querySelector(".mt-text"), more = panel.querySelector(".mt-more"), canvas = panel.querySelector(".mt-bars");

  function tick(t) {
    if (last) frames.push([t, t - last]);
    last = t;
    while (frames.length && frames[0][0] < t - LONG) frames.shift();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  const heard = () => { moves.push(performance.now()); };
  for (const type of ["pointermove", "touchmove", "dragover"]) addEventListener(type, heard, { capture: true, passive: true });

  const q = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] || 0;
  const ms = (x) => (Math.round(x * 10) / 10).toFixed(1);
  function draw() {
    const now = performance.now();
    while (moves.length && moves[0] < now - SHORT) moves.shift();
    const recent = frames.filter(([t]) => t >= now - SHORT).map(([, d]) => d), sorted = [...recent].sort((a, b) => a - b);
    const worst10 = frames.reduce((m, [, d]) => Math.max(m, d), 0);
    fps.textContent = recent.length ? Math.round(recent.length / (SHORT / 1000)) + " fps" : "–";
    text.textContent = `frame ${ms(q(sorted, 0.5))} ms · p95 ${ms(q(sorted, 0.95))} · over ${SLOW}: ${recent.filter((d) => d > SLOW).length}`;
    more.textContent = `longest ${ms(sorted[sorted.length - 1] || 0)} · in 10 s ${ms(worst10)} · moves ${Math.round(moves.length / (SHORT / 1000))}/s`;
    panel.toggleAttribute("data-slow", recent.some((d) => d > SLOW));
    // the last frames as bars: the height their length (the line at 16.7 ms, the top at 50), red above 33 ms
    const cs = getComputedStyle(panel), dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const top = 50, bw = w / BARS, y = (d) => h - (Math.min(d, top) / top) * h;
    g.fillStyle = cs.getPropertyValue("--mt-line").trim();
    g.fillRect(0, Math.round(y(1000 / 60)), w, 1);
    const shown = frames.slice(-BARS);
    shown.forEach(([, d], i) => {
      g.fillStyle = cs.getPropertyValue(d > SLOW ? "--mt-slow" : "--mt-bar").trim();
      const top = y(d);
      g.fillRect((BARS - shown.length + i) * bw, top, Math.max(1, bw - 1), h - top);
    });
  }
  setInterval(draw, EVERY);
})();
