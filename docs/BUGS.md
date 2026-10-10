# Bugs that happened — and what keeps them from happening again

Every bug Henri reports goes in here: what he saw, why it happened, the rule that follows from it,
and the check that guards it (`dev/rig.sh <case>`, a node test, a web test). **Read the rules
before changing the app. When a bug is reported: reproduce it in a check first, fix it, see the
check fail without the fix and pass with it, then add it here.** A bug without a guard is marked
*no guard* — that is a debt, not a state to leave it in.

Running the checks: `dev/README.md`. In short: `cd dev && npm test`, `cd web && npm test`,
`cd src-tauri && cargo test`, and `MDVIEW_RIG=… dev/rig.sh start`, `dev/rig.sh <case>` for the
app itself.

## The rules

### Anything that floats over the note

1. **A new overlay is named in three places**, or the note under it reacts to what is done on it:
   `CHROME` in `active/blocks.js` (else a press on it starts the rectangle that selects blocks and
   its fields take no click), the list in `viewer.js` that decides whose context menu a right
   click opens, and — if it has fields — its `keydown` must `stopPropagation` (else the note's
   keys fire while one types).
2. **The wheel over an overlay belongs to the overlay.** `overscroll-behavior: contain` only
   holds where there *is* something to scroll; where there is not, the wheel must be swallowed by
   hand (see `ai.js`), or the note behind scrolls.
3. **Styles of an overlay's own icons are written for the icons, not for `svg`.** `#x svg { … }`
   reaches every picture that is ever shown inside (a drawing in an answer became 17 px wide and
   lost its fill). Write `#x button > svg`.

### What is drawn while something is coming in

4. **Never rebuild a whole container at every piece of a stream.** Redraw only the part that
   changes, a few times a second, and skip the redraw when the HTML is the same. An element that
   animates (a spinner) must be one that *stays* — recreated, its animation starts over each
   time and looks like stutter.
5. **What grows while it comes gets a place of fixed size**, so that nothing around it moves.
6. **A view that opens shows its content in the first frame.** Read first (with a short limit),
   then start the opening animation — not the other way round.
7. **A page is as wide with little on it as with much**, and as wide in one layout as in another:
   scroll containers that can be short or long reserve the scrollbar's room
   (`overflow-y: scroll`), and two layouts of the same page share one `max-width`.

### Markdown that is rendered somewhere new

8. **Use the reading view's renderer** (`core.mdHtml` / `core.mdInto`) for anything that shows
   Markdown outside the note. The editor's island kit does not render formulas inside a table.
9. **A bare `<svg>` in Markdown is put into an `svg` fence before it is rendered or inserted**
   (`core.fenceSvg`): as plain HTML its empty lines end the HTML block and the picture falls
   apart.

### What the pointer does

30. **A press-and-pull never falls through to the browser by accident.** On anything that is not
    text — a picture, a diagram, a formula, a file, a whiteboard's block — decide what the pull
    means (it moves the block); left alone, the browser starts selecting text. And
    `closest("[contenteditable='true']")` from inside the note always finds the note itself:
    check that what was found lies *inside* the block.

31. **`preventDefault` on `mousemove` stops nothing the browser does with a held button.** A
    text selection is held off by `selectstart` (prevented) and `user-select: none` for as long
    as the button is down — and both are let go on `mouseup`, `dragend`, `drop` and the window's
    `blur`, or the note stays unselectable.
32. **A check with made-up events proves the app's own handlers, not the browser's behaviour.**
    What the browser does by itself with a real pointer — selecting, scrolling after a
    selection, a native drag — is not in such a check. For anything a held button does, use the
    real pointer: `dev/vptr` moves and presses one in the rig's compositor (`rig.sh dragreal`
    shows how a probe hands it its way). A fix for such a bug is not verified without it.
33. **No style that makes the note unselectable, not even for a moment**: in WebKit
    `user-select: none` on a contenteditable takes the caret and the typing with it.
34. **The rig's window can be half as wide as usual** — another session's rig shares the hidden
    workspace. Probes that measure layout (`blocks`, `columns`, `m5`) then fail with or without
    a change: compare against the committed code before blaming the change.

### The clipboard

10. **HTML the editor puts on the clipboard is marked as its own** (`data-pm-slice` or
    `data-mdview`). Unmarked, it is read back as foreign HTML, and everything HTML cannot say —
    a picture of svg, a formula, a whiteboard — is dropped; only the text arrives.

### Pages inside a note

11. **A page's line carries the page's id** (`<!-- page: Name #p3 -->` as the editor sees it).
    Whatever rewrites such a line — a menu, Claude — must give the id back, or the page's content
    is orphaned. `carryOut` in `ai.js` restores a missing id by name, then by place.
12. **Claude sees a page as its line only**, not what is in it. Say so wherever it matters.

### Changing the note for the user

13. **A change made for the user leaves the caret, the selection and the scroll position alone.**
    No `Selection.near` (it lands on whatever block is next, a picture gets selected), no
    `scrollIntoView` (the note jumps). Bring a change into sight only when it is out of sight,
    and gently.
14. **Several changes for one request are one transaction**: one step of Undo.

### The shell (Rust)

15. **A `const` string is compared by content, never by pointer** — it may be copied wherever it
    is used.
16. **A setting the page uses must be in the shell's list of defaults** (`shell.rs`), or it is
    not kept.
17. **A message from the page that makes the shell read a file names only files the shell
    already knows** (the folder's notes, files picked in the system's own window).
18. **A path from Windows is not a path from Linux**: `C:\…`, `/C:/…` in a URL. Whatever builds
    or parses a file address is checked by the Windows probe (`system-probe.yml`), not by eye.

### The page (`viewer.js`) and the hosts

19. **Desktop is `window.__TAURI_INTERNALS__`**, not the absence of something the web host sets
    later. What needs the `claude` command, a folder on disk, or a system dialog is desktop only
    and must not show in the web app.
20. **jsdom has no `matchMedia`, no layout, no clipboard** — guard such calls, and run
    `cd dev && npm test` after touching `viewer.js` or `active/*`.
21. **`web/test/contract.test.mjs` reads `window.MdView = { … }` up to the first `};`** — no
    function body with `};` inside that literal.
22. **Nothing but editor fixtures in `dev/tests/fixtures/`**: the typing test walks every file
    there with seeded random edits; one more file changes every edit of the run.
23. **A click made up by a key or a test has no target** — handlers that look at `event.target`
    check that it is an element.

### Touch (iPad)

24. **Chromium hands a touch near a small target to that target**: decide by
    `document.elementFromPoint`, not `event.target`.
25. **Never focus the note programmatically right after a touch** — the keyboard comes up.
26. **No gliding after two fingers** on the whiteboard; only one finger throws.
27. Verified in Chromium's touch emulation only. Safari on the iPad is checked by Henri.

### Releases and installs

28. **The Windows installer is tried before it is released** (`windows-tried` in `build.yml`).
29. **After `bin/mdview-install` the running app is still the old one** until every window is
    closed. Say so; never kill it.

## The register

Newest first. *Guard* names the check; *no guard* means there is none yet.

### 2026-10-10

| What Henri saw | Why | Fixed by | Guard |
|---|---|---|---|
| **Again**, after the fix below was installed: drag and drop in the note still selected random things and scrolled to a random place | the first fix called `preventDefault` on `mousemove` — which does not stop a browser's text selection — and was only ever tested with made-up events, where no browser selection exists; it also scrolled twice (its own loop beside the drag's) | the press on a thing is taken from the browser (`preventDefault` on `mousedown`, `selectstart` refused while it is held); one scroll loop; no `scrollIntoView` after a drop (rules 30–32) | `rig.sh dragreal` — a **real pointer**; it fails on the old code (57 letters selected on the way) and passes on the new. Also `rig.sh dropstay`, `rig.sh cut` |
| The lasso took a thing only when the loop went all the way round it; of a group only a part | a stroke needed 60 % of its points inside, a thing its middle | a quarter of a stroke is enough, a thing's middle or two of its corners; a stroke merely crossed is not taken | `web/test/board-touch.test.mjs`, `dev/tests/board.test.mjs` |
| A shape drawn and held could not be sized while the hand was down (as GoodNotes does); the shape tool did not make it clean on a hold at all | only a line followed the hand after it was made clean; the shape tool waited for the lift | held still, any shape is made clean and then pulled larger or smaller from its middle — with a pen and with the shape tool | `web/test/board-touch.test.mjs` |
| Moving a block such as an svg picture selected random text on the way | pressed on the picture itself (not its handle), the pull was left to the browser, which began a text selection | a pull on a block that is a thing moves the block, with the handle's drag (rule 30) | `rig.sh cut` |
| The assistant showed the last conversation on whatever document it was opened | one conversation in hand for the whole window | a conversation for each document, a new one the first time | `rig.sh ai` |
| Scrolling in the AI chat scrolled the note behind it | the chat's log had nothing (more) to scroll; the wheel went on to the page | wheel swallowed where nothing of the chat can scroll (rule 2) | `rig.sh ai` |
| Editing an svg code block: only 2–3 lines of code in sight, hard to edit | the picture took the dialog's height; code written on one endless line ran out of the box | code and picture side by side in a larger dialog; one-line svg shown a line per element, left as written when nothing is typed | `rig.sh svgedit` |
| The whiteboard opened at the wrong place and filled in late | it opened at the view saved last (another screen, a far corner), and read its file while the opening animation ran | read first, then open; shown whole as the note's picture shows it (rule 6) | `rig.sh board-enter` |
| All Notes: the page's width jumped between list and tiles | the list capped head and body at 920 px, the tiles at 1400 px; a scrollbar that came and went took 11 px | one width, scrollbar's room always reserved (rule 7) | `rig.sh overview` |
| The New Note / New Folder menu of All Notes was too small | it used the size of menus with many entries | larger rows for `#ctxmenu[data-kind="ovnew"]` | *no guard* (looked at, not measured) |
| "Turn a page into a card": random things got selected, the note jumped | (through the chat's Edit mode) the edit set the caret with `Selection.near` and scrolled to it; a page's line could come back without its id | rules 11, 13 | `rig.sh pagelook` |
| The circle at "Writing change 1" stuttered | the live message was rebuilt at every piece of the stream, the spinner with it | one sign that stays; redraw only when the HTML changed (rule 4) | `rig.sh ai` |
| Blocks cut together with an svg picture: only the text arrived | the block clipboard's HTML was not marked as the editor's own (rule 10) | `data-mdview="blocks"` wrapper | `rig.sh cut` |
| Under a subpage's breadcrumb the page's own name was missing | the way ended at the parent | `.pb-here` after the last `›` | `rig.sh pagenav` |

### 2026-10-09 — AI in the app

| What Henri saw | Why | Fixed by | Guard |
|---|---|---|---|
| The chat's text field took no clicks | a press on the chat started the block rectangle (rule 1) | `#ai-chat, #ai-bubble` in `CHROME` | `rig.sh ai` |
| The app flickered while Claude wrote | the whole conversation was redrawn at every piece (rule 4) | only the live message, throttled | `rig.sh ai` (the spinner check) |
| One-press buttons put a long prompt into the field and sent it | a preset wrote its instruction into the textarea | a preset is a marked chip; the field is for one's own words | `rig.sh ai` |
| Formulas in a table did not render in the transform preview | preview used the editor's island kit (rule 8) | `core.mdHtml` | `rig.sh ai` |
| SVG graphics did not render right in preview and chat | bare `<svg>` torn by empty lines (rule 9); `#ai-chat svg` icon style hit content (rule 3) | `core.fenceSvg`, `button > svg` | `rig.sh ai`, `rig.sh ai draw` (real Claude) |
| The UI did not look like the app (not Craft-like) | first version was a plain dialog and a plain panel | chat rebuilt after Craft's assistant | screenshots of `rig.sh ai` — *taste, no guard* |
| "Larger / Smaller does not work" | *not reproduced* — `rig.sh ai real` presses Longer against the real Claude and it works | — | ask what he sees if it comes back |
| Graphic by Claude showed in the web app's "/" menu | desktop was detected by a property the web host sets later (rule 19) | `DESKTOP` | `web/test/write.test.mjs` |
| The islands probe died with an exception | `handleClickOn` read `event.target.closest` on a made-up click (rule 23) | guard | `rig.sh islands` |

### 2026-10-08/09 — Windows

| What Henri saw | Why | Fixed by | Guard |
|---|---|---|---|
| No folder could be opened; first start offered only a file dialog; a single file had no sidebar | the app started into a file dialog and closed on cancel; no way from a note to its folder | start page with "Open Folder", toolbar button for the note's folder | `rig.sh start-page`; **not** in the Windows gate yet |
| Inserting pictures failed, colours were missing | path handling and stylesheet loading on Windows (rule 18) | fixed in v0.1.1 | `system-probe.yml` (strict checks) |
| "The whiteboard cannot be opened on Windows" | *not reproduced*: v0.1.2 opens boards on GitHub's Windows; a first guess (`/C:/…`) was wrong; v0.1.0 has no whiteboard | `refOf` strips the slash before a drive letter all the same | `system-probe.yml` board steps — ask which version and what happens |
| The release had no Windows installer | it was never uploaded | `windows-tried` job uploads it after trying it (rule 28) | the release workflow itself |

### 2026-10-08 — web app on the iPad

| What Henri saw | Why | Fixed by | Guard |
|---|---|---|---|
| Blocks could not be dragged by touch | HTML5 drag needs a mouse | synthetic drag events from the handle | `web/test/ipad.test.mjs` |
| The keyboard kept opening; it opened on leaving the whiteboard | programmatic focus after a touch (rule 25) | `view.focus` wrapper skips it | `web/test/ipad.test.mjs`, `mobile.test.mjs` |
| The whiteboard glided off after two-finger pan or zoom | inertia was applied after two fingers (rule 26) | none after two fingers | `web/test/board-touch.test.mjs` |
| The page could be pinch-zoomed, text got selected at random; LaTeX got selected on long press | browser defaults on a touch screen | `touch-action`, `user-select: none` on chrome, `gesturestart` prevented | `web/test/ipad.test.mjs` |
| Selecting blocks was impossible by touch | no gesture for it | swipe right in the left margin selects; handle stays | `web/test/ipad.test.mjs` |
| The whiteboard lagged on pan and zoom | the ink canvas was redrawn at every move | canvas moved as a picture, redrawn after 140 ms | `web/test/board-touch.test.mjs` (behaviour, not speed) |
| A board changed on the iPad kept its old preview on Linux | the shell did not watch the boards' folder | `board-watch` | `rig.sh board` |
| No loading animation on the repositories page | the page waited on the server without a sign | `<Suspense>` with the boot ring (a root `loading.tsx` broke sign-in redirects) | web auth tests |
| A new GitHub repository did not show; the blue button led to a confusing GitHub page | the GitHub App had no access to it; nothing said so | the way is said and linked; an empty repository gets its first commit | web tests against a fake GitHub only |

### 2026-10-08 — whiteboard tools (corrections while building)

Tray at the side, not the bottom · shape colours in a submenu (no room) · pens as small signs,
not big drawn pens · three favourite colours per pen, each pen its own · eraser and text trays in
one column · the tray animates when switching and collapsing · bars are not greyed while drawing
(it read as flicker). Guard: `web/test/board-touch.test.mjs`, `rig.sh board`; the look itself is
taste.

### Earlier — from `Current Bugs.md` (all ticked there)

Only what was a fault is listed, not the wishes. Causes were not written down at the time. The
check named is the **nearest one by its subject — it has not been verified that it would catch
this very bug**. When one of these comes back: write the check that fails on it, and put the
cause in here.

| What Henri saw | Nearest check (unverified) |
|---|---|
| Block selection: could not leave a list with the arrows; from a picture, ↑ landed in the text; all list items got selected at once | `rig.sh blocks`, `rig.sh lists` |
| Nested blocks: pulling a code block out of a callout made the callout vanish | `rig.sh dnd`, `dev/tests/columns-fuzz.test.mjs` |
| A picture inserted in the active mode stayed in the repository after it was removed from the note | *no guard known* (attachments record: `~/.local/state/mdview/attachments.json`) |
| Enter before a heading's text made it no heading any more | `dev/tests/edit.test.mjs` |
| The hide title field of a code block showed the word "hide" and broke without it | `rig.sh islands` |
| Closing the last tab closed the whole app | `rig.sh tabs` |
| Indenting list items failed when the list was interrupted | `rig.sh lists` |
| Text clipped in the sidebar's note names; stray text at the sidebar's right | `rig.sh shots` (screenshots) — *weak* |
| Dragging in All Notes: the item jumped away from where it was grabbed | `rig.sh overview` |
| A formula block closed by the AI stayed as `$…$` | `rig.sh ghostmath` |
| The code editor in the dialog: selecting text did not work, text could not be removed | `rig.sh islands` |
| The web app made merge conflicts with itself | `rig.sh sync`, web sync tests |
| Share dialog: the password field was not focused; typing went into the note behind (rule 1) | `rig.sh share` |
| Switching tabs sometimes turned the edit mode read-only and did not save (not every time) | `rig.sh tabs` — *weak: it was intermittent* |
| Checkboxes of properties could not be changed | `rig.sh more` |
| The size of an embedded PDF was not kept though the source had it | `rig.sh pdf`, `rig.sh adjust` |
| Pasted files did not go to the assets folder in the web app | web write tests |
| Context menus of the sidebar offered "Show in Finder" on the web (rule 19) | `web/test/contract.test.mjs` |
| The link menu took one out of the text; links could not be opened in the active mode | `rig.sh link` |
| After an install, fixed bugs were "still there" | rule 29 |

### Known to fail, not fixed

- `rig.sh prefs`: three checks expect a "/" menu without the whiteboard entry.
- `rig.sh graphic`: two checks expect the file beside the note; the app saves under `assets/`.
- `rig.sh edges`, `rig.sh regress`: failing on main since before 2026-10-08.
- `web/test/board-touch.test.mjs` "the tray goes where a finger pulls it": fails now and then in
  a full run, passes alone.
- A latent one: `dev/tests/edit.test.mjs` found an edit after a hard break (two spaces at a
  line's end) in `basics.md` that changes more than its place, when the fixture list shifted
  the random edits. Not looked into.
