# mdview — for whoever works on it

- **Read `docs/BUGS.md` first.** It holds the rules that came out of bugs Henri reported, and
  the register of those bugs with the check that guards each.
- **Every bug Henri reports**: reproduce it in a check (`dev/rig.sh <case>`, a node test, a web
  test), fix it, see the check fail without the fix and pass with it, and add a row to the
  register in `docs/BUGS.md` — with the rule, if a new one follows from it. Say plainly when a
  bug could not be reproduced; it gets a row all the same.
- Never work in the installed checkout (`~/Projects/mdview`) — use a worktree. A merge into
  `main` needs Henri's yes each time; push only when asked.
- Before saying something is done: `cd dev && npm test`, `cd web && npm test`,
  `cd src-tauri && cargo test`, and the rig cases the change touches (`dev/README.md`).
- What the app does is described in `docs/FEATURES.md`; keep it true.
