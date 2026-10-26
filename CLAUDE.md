# mdview — for whoever works on it

- **Read `docs/MAP.md` first**: where what is in the code, how to search it, which check goes with
  which change. Search with `rg -n --max-columns 200` in the folder the map names; read the part
  of a file that is needed, not the file.
- **Before changing the app, read the sections of `docs/BUGS.md` the change touches** — the rules
  that came out of bugs Henri reported, under the part of the app they are about. The bugs
  themselves are in `docs/BUGS-register.md`: looked up, not read through.
- **Every bug Henri reports**: reproduce it in a check (`dev/rig.sh <case>`, a node test, a web
  test), fix it, see the check fail without the fix and pass with it, and add a row to the
  register (`docs/BUGS-register.md`) — with the rule in `docs/BUGS.md`, if a new one follows from
  it. Say plainly when a bug could not be reproduced; it gets a row all the same.
- Never work in the installed checkout (`~/Projects/mdview`) — use a worktree. A merge into
  `main` needs Henri's yes each time; push only when asked.
- **Small bugs from the list go one after the other, in one worktree, without subagents**
  (Henri, 2026-10-26: seven agents, each building and testing everything, took far too long). Each
  bug gets only its own check (fails without the fix, passes with it) and its register row.
- Before saying a batch is done — once for the whole batch, not after each bug: `cd dev && npm
  test`, `cd web && npm test`, `cd src-tauri && cargo test`, and the rig cases the changes touch
  (`dev/README.md`). They say only what fails; do not ask for every line unless a failure needs it.
- What the app does is described in `docs/FEATURES.md`; keep it true. It is long: search it for
  the part in question.
