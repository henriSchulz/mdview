# Keeping what was written, in a project of Markdown Notes

Read when a note was written into a folder that is a project with its history on (SKILL.md, *Where it goes*). An agent may commit the notes it wrote, and push them, the way the app does — but only where the app itself would. The app's rules are in `docs/FEATURES.md` under *History*; the code is `src-tauri/src/history.rs` and `sync.rs`.

**When you may commit.** All three must hold; if one does not, do not commit — say so instead.

- The folder is a **project**: the nearest repository at or above the note has
  `.mdview/project.json` beside its `.git`. A repository without the marker is someone else's
  (source code, say) and is never written to.
- Its **history is on**: the marker file is there in the working folder. Switched off, the app
  takes the marker away (the last commit still has it) — then nothing is kept.
- Nothing is half done: no merge or rebase in progress (`git status` says so). That is Henri's or
  the app's to finish.

**How to commit.** One commit for what you wrote, as the app would have made it.

- Stage **only your own files** (`git add -- <paths>`). Other changes waiting in the folder are
  the app's to keep. Leave out what `.gitignore` leaves out and any file over 50 MB.
- **Subject**: one file → its file name (`Fourier Transform.md`, no folder). Several →
  `N files: a.md, b.md, c.md, …` — the first three names in path order, `, …` only when there are
  more than three.
- **Body**: the two lines the app reads, then nothing of your own in between:

  ```text
  14 files: A.md, B.md, C.md, …

  Device: omarchy-m1 (61cf07db-381b-4bee-ad76-3bec773b1f82)
  Client: claude-code
  ```

  `Device` is this computer as the app names it: `name (id)` from
  `~/.local/state/mdview/state.json` — the id is `device.id`, the name is `active.deviceName`
  where that is set, else `device.name`. `Client` names the program: `claude-code` (the app
  writes `desktop 0.1.0`, the browser `web`). An attribution line the session asks for
  (`Co-Authored-By: …`) goes after these, behind a blank line.
- **Author**: whatever Git is configured with in that repository; do not set one.
- Commit on the branch that is checked out. Never amend or rewrite a commit that has been sent.

**When you may push.** Only when the project is **linked**: the repository has a remote named
`origin`. Without one, the commit stays here and that is the end of it.

**How to push.** The repository on GitHub is what counts, and nothing is ever overwritten.

1. `git fetch origin`, then compare: `git rev-list --left-right --count <branch>...origin/<branch>`.
2. Nothing new there → `git push origin <branch>:<branch>`.
3. Another device kept something meanwhile → join first, as the app does, then push:
   `git merge --no-ff origin/<branch>` with the subject `Joined with what another device kept`
   and the same `Device:` / `Client:` lines.
4. The merge **conflicts** (both changed the same place) → `git merge --abort`, push nothing, and
   tell Henri: the app's clock turns red and Resolve Conflicts… is where it is settled.
5. Never `--force`, never a rebase of what is already there. A push that is refused or cannot
   reach GitHub is left for the app, which sends what waits the next time it reconciles.

Say afterwards what was kept and whether it went over (the commit, and "pushed" or why not).

## The pasteboard

A project linked to GitHub has a pasteboard (All Notes › Pasteboard): a small chat of blocks of text,
the same on every device that shows the project; each block names the device it came from and the
time. It is no note and in no version. Between Henri and you it is the
way to hand over what is awkward in the chat — a long log, several addresses, a piece of code,
text from his phone or another computer — in both directions. Use it without being asked to when
the work calls for it.

| Want | Run, in the project's folder (or with `--in FOLDER`) |
|---|---|
| what stands there (every block under a `## device · time` heading, the newest last) | `mdview paste` |
| wait for Henri to put something there | `mdview paste --wait` (300 s; `--wait 540` at most) |
| add a block at the end | `mdview paste TEXT…`, or `… \| mdview paste -` for many lines (`--append` is the same) |

- **Taking something from Henri.** When you need material from him — more than a line, or
  several things — ask for it in one sentence that names what you need and says "put it on the
  pasteboard", and run `mdview paste --wait` in the same turn. It returns the blocks once
  something new has stood still for a moment, so something typed arrives whole; what he put there
  is the last block (or the last ones). It ends with 3 when nothing came: wait once more, then say
  that you are waiting and stop. An empty answer means he cleared it; wait again. Take what you
  need out of it and go on with the work — do not repeat it back.
- **Giving something to Henri.** What he will copy elsewhere — a command, an address, a
  configuration, a list of results — goes on the pasteboard, and you tell him in one line that it
  is there and what it is. It is a block of its own, after
  his; nothing of his is replaced.
- While the app shows the pasteboard the same blocks are in `.mdview/pasteboard.md` — a copy for
  reading; writing to that file changes nothing.
- The command ends with 1 and says why where it cannot: no linked project, nobody signed in, no
  connection. Then ask for the material in the chat instead.
- Nothing secret goes there unasked: the text is kept on the web app's server for everyone who
  may write to the repository.

