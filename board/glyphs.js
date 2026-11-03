/* mdview — signs of the hand's own, as Henri passed them in the Hand Lab (dev/hand-lab.html; #39): where the font's skeleton
 * was not how a hand writes a sign, Claude drew it anew and Henri passed it. Each: [path, o] in the font's units — the line
 * at y 21, a capital from y 1, the next sign o × 1.68 further on — as vendor/hershey.js and SIGNS (board/claude.js) have
 * them; looked up before both. By style: hand (print), script. */
"use strict";
(() => {
  const B = (window.MdBoard = window.MdBoard || {});
  B.glyphs = {
    hand: {
      // (Hershey joins the upper ring to the stroke — Henri: „das es verbunden ist“; two rings and the stroke, each its own)
      "%": ["M7,1 C5,1 3.5,2.6 3.5,4.6 C3.5,6.6 5,8.2 7,8.2 C9,8.2 10.5,6.6 10.5,4.6 C10.5,2.6 9,1 7,1 M19,1 L4.5,22 M16.5,14.8 C14.5,14.8 13,16.4 13,18.4 C13,20.4 14.5,22 16.5,22 C18.5,22 20,20.4 20,18.4 C20,16.4 18.5,14.8 16.5,14.8", 12.5],
    },
    script: {},
  };
})();
