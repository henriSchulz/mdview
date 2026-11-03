/* mdview — signs of the hand's own, as Henri passed them in the Hand Lab (dev/hand-lab.html; #39): where the font's skeleton
 * was not how a hand writes a sign, Claude drew it anew and Henri passed it. Each: [path, o] in the font's units — the line
 * at y 21, a capital from y 1, the next sign o × 1.68 further on — as vendor/hershey.js and SIGNS (board/claude.js) have
 * them; looked up before both. By style: hand (print), script. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  B.glyphs = { hand: {}, script: {} };
})();
