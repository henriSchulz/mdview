# Bugs that happened — the rules that came out of them

Every bug Henri reports is written down: what he saw, why it happened, the rule that follows from
it, and the check that guards it (`dev/rig.sh <case>`, a node test, a web test). The rules are
here, under the part of the app they are about — **read the sections a change touches before
making it** (a change to a dialog: "Anything that floats over the note"; to a drag: "What the
pointer does"; and so on). The bugs themselves are GitHub issues (label `bug`), each with what
Henri saw, why, what fixed it and its guard in a comment; those before 2026-10-26 are the
register, [`BUGS-register.md`](BUGS-register.md) — looked up when one of them comes back, not
read through.

**When a bug is reported: open it as an issue, reproduce it in a check first, fix it, see the
check fail without the fix and pass with it, then close the issue with the commit (`Fixes #n`)
and say on it why, what fixed it and the guard** — and its rule here, if a new one follows. A
bug without a guard says *no guard* there and keeps the label `no-guard`: a debt, not a state to
leave it in.

Running the checks: `dev/README.md`. In short: `cd dev && npm test`, `cd web && npm test`,
`cd src-tauri && cargo test`, and `MDVIEW_RIG=… dev/rig.sh start`, `dev/rig.sh <case>` for the
app itself. Where what is in the code: [`MAP.md`](MAP.md).

## The rules

### Anything that floats over the note

40. **The lower left corner of the sidebar is the settings' gear's** (`#settings-btn`, fixed to the
    window, not in the sidebar). Whatever is put at the sidebar's foot leaves its room.

1. **A new overlay is named in three places**, or the note under it reacts to what is done on it:
   `CHROME` in `active/blocks.js` (else a press on it starts the rectangle that selects blocks and
   its fields take no click), the list in `viewer/menus.js` that decides whose context menu a
   right click opens, and — if it has fields — its `keydown` must `stopPropagation` (else the note's
   keys fire while one types).
2. **The wheel over an overlay belongs to the overlay.** `overscroll-behavior: contain` only
   holds where there *is* something to scroll; where there is not, the wheel must be swallowed by
   hand (see `ai.js`), or the note behind scrolls.
3. **Styles of an overlay's own icons are written for the icons, not for `svg`.** `#x svg { … }`
   reaches every picture that is ever shown inside (a drawing in an answer became 17 px wide and
   lost its fill). Write `#x button > svg`.

46. **A dialog is never lower than what is on it.** `flex: 1` has a basis of nothing: in a box whose
    height is its content's (`fit-content`) such a child gets no height at all and scrolls. And a
    dialog pulled to a size grows to what it holds when that does not fit (`fitNow`, dialog.js).
47. **A size is kept only when it was chosen, and looked at when it is read.** A press that pulls
    nowhere keeps nothing; a kept value no hand could have made (lower than the least the corner
    pulls to) is no value. One wrong number in the settings is every dialog's.

54. **One menu for a thing, wherever it is met.** The file menu's entries say for *what* they are
    (`data-for`: a file, a folder, many, the empty room) — never *where* (a row, the rail, a tile).
    A place that opens the menu names the thing; what an entry does differently in a place is
    said where it is carried out (`runCtx`). `rig.sh sidebar` holds a folder's row, its sign in the
    rail and its tile, and a note's row and tile, to the same entries: an entry added for one is
    there for all.

69. **The sidebar lies over the note; showing it moves nothing but the card.** No room is made
    for it — no padding, no `left`, no width of the note, All Notes or a split's halves that
    depends on `data-sidebar` (and no `:root:has(…data-sidebar…)`: a change of it restyles every
    element). Opening and shutting it lays nothing out anew, and nothing is sent: the host does
    not scan or send the folder for a sidebar shown or hidden. `rig.sh sidebar` measures the
    note's left edge, All Notes' and its sheets', at two widths, and how long the click takes.

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
67. **What comes in later is drawn again everywhere it shows, not only where it was asked for.**
    Lucide's folder signs load when a folder first needs one (`folderGlyph`, `viewer/sidebar.js`);
    whoever asked, the sidebar *and* All Notes (`MdOverview.folderChanged`) are drawn again when
    they are there — else one place shows the folder's own sign and the other the plain folder.
52. **A control is there by what it is for, not by an answer that comes later.** Sync Now stands
    where the folder is linked (`history.linked`), not where the two sides have been reconciled
    (`history.sync`: nothing until the first answer, half a minute after a start or longer).

### Markdown that is rendered somewhere new

8. **Use the reading view's renderer** (`core.mdHtml` / `core.mdInto`) for anything that shows
   Markdown outside the note. The editor's island kit does not render formulas inside a table.
9. **A bare `<svg>` in Markdown is put into an `svg` fence before it is rendered or inserted**
   (`core.fenceSvg`): as plain HTML its empty lines end the HTML block and the picture falls
   apart.

### What the pointer does

68. **What goes with the pointer hangs in the window itself**, not inside the part it was taken
    from: a part of its own layer (All Notes, z-index 14) holds whatever is in it under the parts
    above it (the sidebar, 16), and a drag is pulled across them. `moving.start(…, { into:
    document.body })`, with what the copy needs of its part's styles said for `.drag-ghost` too.

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

35. **Never `preventDefault` an event in the capture phase that the editor must still see.**
    ProseMirror ignores every DOM event that arrives with its default prevented
    (`eventBelongsToView`). Prevent it in a bubble-phase listener on the document — the default
    is still held off — or the editor loses its clicks.
36. **A check of "it opens on a click" uses the real pointer and asserts that it opened.** The
    first real-pointer check only recorded whether the dialog was open and asserted nothing;
    the regression went out with a green run.
37. **The rig's pointer tool loses its bearings when the rig's output is resized** (another
    session's rig joining or leaving the hidden workspace): `rig.sh stop`, `start` before a
    real-pointer run that fails with "the pointer was not heard". Never `pkill -f` a pattern
    that matches the running command itself.

38. **Everything the editor lays over the note is `user-select: none`, and `selectstart` on it is
    refused.** A handle, a drop line, a rectangle, a grip: a press there must never begin a
    selection of the browser's — it anchors on whatever of the page is selectable (the last
    element in the body, as a rule) and reaches to the pointer.
39. **Focusing the editor never moves the note.** WebKitGTK scrolls to the page's last selection
    on `focus()` even with `preventScroll`: `view.focus` (active/view.js) restores the scroll
    position, and nothing calls the DOM's `focus()` on the editor directly.
40. **When a bug does not show in the rig after two honest tries, record it where it happens.**
    `dev/probe-trace.js` runs in Henri's own window (`MDVIEW_PROBE=…`) and writes down presses,
    drags, every selection-setting transaction with its caller, and the browser's own
    selection. One recording named the cause three fixes had guessed around: the fixes were for
    a pull on the picture, the bug was a drag by the handle.

41. **What is done to "the note" is done to the note's file text, not to the page on screen.** A
    note with pages is one text; the editor shows one page of it. Anything that reads the note
    for someone (Claude, an export, a search) reads `core.ai.fileText()`; anything that rewrites
    it goes through `setFileText` (one step of the note's history, the page on screen stays).
42. **A field that is being typed in is never rebuilt from under the hand.** Whatever redraws a
    bar or a panel keeps the focused field's text, caret and focus — and what is typed is taken
    while it is typed (debounced `input`), not only on `change`, which never comes when the
    field is replaced.

43. **The size a dialog was pulled to is kept for all dialogs, so a dialog that needs room has a
    floor of its own** (`#dlg[data-split].sized`): a size right for a formula is no size for code
    beside its picture. A dialog that is not to be pulled at all (Transform with AI) hides the
    corner and takes no kept size.

44. **What goes with the pointer in a drag is drawn by the page** (`moving.start`: a copy of the
    row or tile, moved on `dragover`), and the browser is handed an empty picture. WebKitGTK's
    own picture of an element comes out twice as large on a screen scaled by a fraction, and
    shows at full size, unclipped, whatever the element holds made small with `zoom`.
45. **The rig's screenshot is of the rig's own window** (`shot` asks for the nested compositor's
    pid): with several rigs side by side the first window found is another session's.

48. **What a pull or a click takes of a block follows the same rules wherever the block stands.**
    The document and a column both hold lists; a rule written into the code that walks the
    document's own blocks ("of a list the items it reaches, not the list") does not hold in a
    column, which is walked by other code. Such a rule is a function both call, and its check
    pulls over the same kind of block in each place (`rig.sh colsel`).
74. **A selected block's field is one look for every kind of block**, drawn in the layer over the
    note (`drawFields` in `active/blocks.js`), never painted on the block itself: there a block's
    own surface (code, a table's sheet, a picture) covers the tint, a rule has no room for it, and
    each kind ended up with a look of its own. The fields of blocks that follow each other leave
    the same gap whatever the blocks' margins. A web test measures it over all kinds at once.
51. **A thing on the whiteboard is met where it is drawn, never by the box around it.** Whatever
    asks "is this under the pointer, in the box, in the loop" asks `items.js` (`hit`, `crosses`,
    `outline`, `inside`) — `bounds` is for what must fit on the screen or in the picture, not for
    choosing. How far beside a thing still counts is said in screen pixels (divided by the zoom),
    not in the board's units.

57. **What a gesture makes larger is what lies under the pointer** — a pinch, a wheel, on a
    whiteboard and over a PDF. Where the host says only how much (a touchpad's pinch on the
    desktop), the page remembers where the pointer is. A step that comes in notches (a mouse's
    wheel) is a glide to where it leads, never a jump.
58. **A panel lies over the window; it does not push it.** Outline, pages and notes of a PDF, the
    panel at the right: nothing makes room, no page moves or is drawn anew, and what scrolls
    inside it never scrolls the window (`scrollIntoView` does — set the list's `scrollTop`).

59. **A view that comes over another of the same thing begins as that one stood.** The whiteboard
    over a PDF: the pages lie where they lay — both lay them out by one rule (the gap between
    pages grows with the size in both) —, they come up with the pictures the viewer had, never
    bare, and what belongs to the view below (its bar, its card) goes as the other comes.
    Going back is the same in every way it is left — Back, a tab, a note, the window closed: the
    view below is put where the upper one was, never where it stood before; and a window that only
    loses and gets its focus again (another window clicked, a tap outside) leaves nothing
    (`rig.sh pdfink`).

60. **A drag is checked with a real pointer.** Made-up drag events (a DataTransfer of the page's
    own, dispatched) are taken whatever they say; the browser's own drag takes a drop only where the
    page said, at the last dragover, it would take it in a way the drag allows (`dropEffect` within
    `effectAllowed`). Whatever is dropped on gets a check through `dev/vptr` (`rig.sh dragreal`,
    `tiledrag`, `railfav`).

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
69. **What is the note's as a whole is offered in every mode a note is shown in** — its ground and
    width (the panel's Style), its numbers — reading, active, the source, the source beside its
    reading. A mode that cannot do a part of the panel dims that part; it does not take the panel
    away. Written from the source, it is an edit of the source's text (`P.edReplace`: the editor's
    own undo), not a new text put in. A new mode, or a new part of the document's: `dev/tests/docmodes.test.mjs`, `rig.sh docstyle`.

### The shell (Rust)

15. **A `const` string is compared by content, never by pointer** — it may be copied wherever it
    is used.
16. **A setting the page uses must be in the shell's list of defaults** (`shell.rs`), or it is
    not kept.
17. **A message from the page that makes the shell read a file names only files the shell
    already knows** (the folder's notes, files picked in the system's own window).
50. **A file a note names is looked up by the one function that knows where such files are**
    (`scan::found`; in the web host `foundIn`, `where`): where the link says, else the base
    folder's `assets`. Whatever takes a path that came out of a note — the file server, a link,
    a whiteboard, a PDF, a copy, a share — asks it and never the disk directly; whatever puts a
    file into a note asks `attachment_dir` where and `way_to` how it is named. A note's place is
    not part of how it names its pictures: it is moved, and its blocks are pasted elsewhere.
69. **Where a `[[link]]` leads is worked out the same in the shell and in the web host**
    (`scan::Resolver`, `resolver` in `core.js`): beside the note, the root (the vault, else the
    folder's, project's or repository's top — never the note's folder alone), then by name below
    the root. A change to one is made in the other, with a test on each side. And "nowhere" is no
    answer for good: a miss on what may not have been all the files looks once more, and the page
    asks once more for a link it was told leads nowhere — once, never in a loop.
18. **A path from Windows is not a path from Linux**: `C:\…`, `/C:/…` in a URL. Whatever builds
    or parses a file address is checked by the Windows probe (`system-probe.yml`), not by eye.
61. **What flickers while nothing of the page changes is WebKit's, and is filmed, not probed.** A
    probe sees the page's state, not the frames the window gets: `rig.sh scrollup` records the
    nested screen (`wf-recorder`) and looks at each frame. The renderer is chosen in `main.rs`
    (`WEBKIT_DISABLE_DMABUF_RENDERER`): before it is changed, that case runs several times —
    the torn frame comes one to four times a film, not in each. Since 2026-10-24 the app draws
    with the GPU (the DMA-BUF renderer on: rule 76) and the rig without it — its nested compositor
    takes the GPU's frames too slowly for a film or a probe to end; the flicker is then looked for
    on Henri's screen.
62. **Without WebKit's DMA-BUF renderer there is no blur.** `backdrop-filter` is drawn on its way
    only: off (rule 61), glass is a pale film the text behind it is read through. What is glass
    takes `--glass` and `--glass-filter` — never a colour and a blur of its own — so that
    `body[data-flat]` makes all of it a ground that covers. `rig.sh glass` looks at the screen; the
    page's computed style says blur either way.
63. **Nothing moves out of sight.** An animation that turns for good (`infinite`) runs only while
    what it stands in is shown — `animation: none` otherwise, as `#busy` and `#history` have it.
    Without the DMA-BUF renderer (rule 61) each of its frames is the page drawn anew, whether it
    can be seen or not. `rig.sh idle` reads what a window at rest costs.
64. **A long hold of the page comes when nothing moves.** Without the DMA-BUF renderer an
    animation stands still while the page works, a spinner as much as a glide: what answers a
    click (a thumb, a fade) runs to its end first, and only then does the heavy work begin. No
    wheel that would turn through it, and nothing page-wide that changes meanwhile (dimming the
    note is the page drawn anew each frame). `rig.sh switchlag`.
65. **What a scroll draws anew at every step is little.** Without the DMA-BUF renderer the whole
    window is painted at each step; a layer of thousands of elements (a PDF's words to select) is
    then put out of sight while the pages move — `visibility`, not `display`, so that nothing is
    laid out again — and built only when the hand rests. Measured on Henri's screen, not only in
    the rig: there the page is drawn at twice its size (`rig.sh pdfscroll`).
69. **What a hand draws is drawn anew where it draws, not across the window.** A canvas cleared
    whole is the window painted anew whole — and, without the DMA-BUF renderer, all that lies under
    it, the PDF's pages too. The stroke under the pen clears and draws only around its end at each
    step (`live` in board.js); all of it only when it begins, ends or the view moves. `rig.sh
    pdflag` measures from the pen's sample to the frame and asks what is cleared;
    `web/test/ipad.test.mjs` asks the same of a pen in the browser.

69. **Nothing is held at the window with `background-attachment: fixed`, and what a scroll paints
    anew is cheap to paint.** A fixed background makes WebKit paint the whole window at every step
    of a scroll even where it could move what it drew (the DMA-BUF renderer): a ground that stays
    with the window is a layer of its own (`position: fixed`, `:root::before`, `viewer/page.css`),
    and what must show the same picture (the strip of tabs) draws it with the window's offset.
    Without the DMA-BUF renderer every step is painted anyway, so what lies in the window must be
    cheap: no blurred shadow and no rounded clip around a large canvas (a PDF's pages), no blend
    mode on an empty layer, no `backdrop-filter` under `data-flat`. Measured, not guessed, at twice
    the size: `rig.sh scrollperf` (frames and CPU while a note on each ground, and a PDF, scroll).
75. **No blurred shade on what stands beside a scroll.** A `box-shadow` with a blur is blurred
    anew in every frame the window is painted — without the DMA-BUF renderer every step of a
    scroll; the sidebar's shade, its whole height long, made a note scrolled beside it take half
    as long again per frame, and the sidebar slide in unevenly. What is shown while the page
    scrolls or glides takes its shade as a picture, blurred once and cut in nine (`border-image`,
    the sidebar's `body::before` and the sheets' `::before`); a ring without blur (`0 0 0 0.5px`)
    costs nothing. A rig of its own size and scale: the frames are read at twice the size
    (`MDVIEW_RIG_SCALE=2`, `rig.sh sblag`), where at scale 1 nothing showed.

76. **The window is drawn with the GPU, and what is measured for speed is measured on the desktop.**
    Without WebKit's DMA-BUF renderer every frame is the whole window painted by the processor:
    on Henri's laptop (i5-6200U, 2160×1440 at twice the size) a note on a ground scrolled at 40 to
    65 ms a frame, the sidebar's sheets at 70, a whiteboard moved at 50 — with it all at 17. The
    rig's nested compositor cannot say this (rule 61): its figures are the processor's, and the
    perf cases (`scrollperf`, `boardperf`, `blockperf`, `sbscroll`) are run once on the desktop
    too, on a hidden workspace (an output of its own) with the state of a rig, before a change to
    speed is called done. Rules 62–65, 69 and 75 hold all the same: whoever turns the renderer off
    (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) gets the processor's frames back.
80. **What is replaced is not in the middle of a glide.** An opacity or transform that glides on a
    container whose content is then put in anew (a dim while the next view is built) is cut off a
    few frames in; with the GPU renderer WebKit kept the cut layer's old picture on the screen, under
    what came (the tiles of All Notes, dimmed, behind an empty Whiteboards). Such a state is set at
    once, or the glide is let run to its end before the content changes. A probe sees no fault
    here — the page is right; `explorer.test.mjs` asks that `.ov-body` has no animation while it
    changes.
77. **What a pointer drives is done once a frame, at its last place.** A mouse moves several times
    a frame; work that measures the page (blocks under a rectangle, where a dragged block would
    go, the copy that goes with the pointer moved and measured) done at every move is done four
    times for one picture — a block's drag took 40 ms a frame. A move notes where the pointer is
    and asks for a frame; the frame does the work; a let-go before the frame came does it then,
    from where it was let go. And in the frame: measured first, written after — the rectangle
    drawn before the blocks were measured laid the page out at each measuring. What grows or
    moves over the text while a pointer pulls (the rectangle, the fields of selected blocks, a
    board's dots) is a layer of its own (`will-change: transform`), or each step paints the text
    under it anew. `rig.sh blockperf`, `boardperf`.
78. **What lies out of sight in a long list is not drawn.** The sidebar's sheets are thousands of
    elements (a note's beginning: formulas, code, tables); a sheet has its size of its own, so it
    takes `content-visibility: auto` with that size, and a scroll paints only the sheets in sight
    (70 → 16 ms a frame). Only where the size is fixed: a row whose height comes from what is
    in it would jump when it comes into sight. `rig.sh sbscroll`.
    `content-visibility` clips what the element holds to its box: a ring, a shade or a tab that
    stands outside it is drawn on the element itself, not on a child (the open note's ring showed
    only at the corners — `explorer.test.mjs`, "wears its ring all round").
79. **What must never scroll is `overflow: clip`, not `hidden`.** A box with `overflow: hidden` is still
    scrolled by a focus, `scrollIntoView` or a tap the browser brings into view, as soon as anything in it
    reaches past its edge — the whiteboard's dots' layer does by one step (rule 77): scrolled by that much,
    every place on the board was taken that far from the hand. `#board` is `clip`
    (`web/test/board-touch.test.mjs`).

66. **A key that comes from outside is no real key for WebKit.** `wtype` (a phone's screen mirror)
    sends every key with the hardware code of Escape (`e.code` is "Escape" for Backspace too); the
    letters arrive as text and work, but for Backspace, Delete, the arrows, Home and End WebKit does
    nothing. A key that is not text and that the page must act on cannot rest on the browser's
    default: `viewer/toolbar.js` (`OUTSIDE`) does these after the editor had its say, where `e.code`
    is not `e.key`. A new key of that kind — a probe with real keys (`rig.sh backspace`) says whether
    it is one.
69. **The note on screen may be renamed while it is written** (a new note named after its title,
    a rename from the sidebar): a save the page sent before it was told is under the old name.
    The host takes it as the note's (`renamed_from`, `messages.rs`: "save") — never drops it as a
    late save of another note, and never writes it as a new file under the old name. A note is
    named for the user only from what was saved; an old note's title is never its name
    (`settle_fresh`: only a note made by New Note, until it is left). And the watcher's news of
    the file under its new name (or of one just made) is the host's own (`own_write`): read anew,
    the page would take what is being typed as saved. `rig.sh newnote`.
70. **Nothing goes to the other side that is not on the disk here** (`sync::durable`, before
    every push): a crash after a push otherwise takes back here what is there already, and the
    next change is a conflict that holds back every later push. **A sync that is stuck says so
    wherever something waits on it** — the share window names the conflict (`sync::stuck`), never
    only "once this is sent". `held_back_by_a_conflict_the_window_says_where`, `share.test.mjs`.

### The page (`viewer.js`, `viewer/*.js`) and the hosts

19. **Desktop is `window.__TAURI_INTERNALS__`**, not the absence of something the web host sets
    later. What needs the `claude` command, a folder on disk, or a system dialog is desktop only
    and must not show in the web app.
20. **jsdom has no `matchMedia`, no layout, no clipboard** — guard such calls, and run
    `cd dev && npm test` after touching `viewer.js`, `viewer/*` or `active/*`.
21. **`web/test/contract.test.mjs` reads `window.MdView = { … }` up to the first `};`** — no
    function body with `};` inside that literal.
22. **Nothing but editor fixtures in `dev/tests/fixtures/`**: the typing test walks every file
    there with seeded random edits; one more file changes every edit of the run.
23. **A click made up by a key or a test has no target** — handlers that look at `event.target`
    check that it is an element.
49. **A settings row is there where the host does what it sets**: what only the desktop has (a
    window of the application, a folder on a disk) is in the web host's
    `hide` (`settings-info` in `web/public/host/host.js`), and a value the host was not told is a
    row not shown — never a nought or a placeholder in its place. A new row: decide it for both.
56. **In the browser the page comes first, and a file the repository has is never sent again.**
    What is done to a file — moved, renamed, copied, hidden, deleted — changes the host's own
    tree and is told to the page at once (`noteRenamed`, `setFolder`); the commit follows
    behind, and nothing waits for GitHub (only for a commit in flight that holds *that* file:
    `landed`). A file with a blob in the repository goes into a commit by that blob (`links` in
    `host.js`, `commitLinked` in `web/lib/github.ts`) — never fetched to be sent back, whatever
    its size. What is shown as done and then refused for good is put back and said by name
    (`putBack`); what only waits survives a reload (`moved`, beside the drafts).
55. **A feature of the page is built for both hosts, or its absence in the other is said at
    once.** The page is one, and Henri uses it in both places: what is made for the desktop and
    left `"none"` in `web/host/contract.ts` is, to him, a change that "is not active on the
    website". With a new message: either the web host answers it too (and a web test says so),
    or the commit says that the browser does not have it, and why. What the page offers only
    where the host works with files as files is behind one gate, `FILEWORK` (`viewer/base.js`:
    the desktop, or a host that says `MdHost.filework` before the page is there) — never behind
    `__TAURI_INTERNALS__` alone, which is for what a browser cannot do at all (rule 19).

70. **A default that changes reaches everyone who did not choose; a value kept from the old
    default is let go once.** The shell keeps only what differs from the defaults, the browser
    only what was chosen — but a value that was once a choice stays one. Where Henri says the new
    default is for everyone, the old value is taken out once, under a marker (`sheets_first` in
    `state.json`, `mdview:sheets-first` in the browser; `lists_all` before it) — never at every
    start, or a choice made after it could not be kept.

### Touch (iPad)

24. **Chromium hands a touch near a small target to that target**: decide by
    `document.elementFromPoint`, not `event.target`.
25. **Under a finger the note is focused only where the finger asked to type** — the keyboard
    comes with the focus and covers half the screen. A tap into the text focuses it by itself;
    the page asks for it (`view.focus({ keyboard: true })`) only for a new line of text put in
    (text, a heading, a list, a quote). Everything else that hands the focus back — a block
    chosen, moved, dropped, a block of another kind put in, a bar's or a menu's action, a dialog
    opened or left, undo — calls `view.focus()`, which under a finger does nothing unless the
    note has the focus already (`core.byFinger()`: what the hand last used — a finger, a mouse,
    the keys —, with no time limit: a drag held for long is still a finger's). A dialog's field
    is not focused as it opens under a finger. A web test goes through each case (`tablet.test.mjs`).
26. **No gliding after two fingers** on the whiteboard; only one finger throws.
27. Verified in Chromium's touch emulation only. Safari on the iPad is checked by Henri.
69. **The iPad's layout is the iPad's alone** (viewer/tablet.js, viewer/tablet.css): every rule of it stands
    under `:root[data-ipad]` inside `@media (min-width: 761px) and (min-height: 600px)` — the desktop, a phone, a
    touch screen that is no iPad and an iPad in Split View look as they did. It lays the page's own parts out
    otherwise (the toolbar, the rail, All Notes) and calls what they do; it adds no second way of doing a thing.
    Chromium's touch emulation has one touch point and its own user agent: a test of the iPad sets five
    (`Emulation.setTouchEmulationEnabled`) and Safari's agent, or the page is no iPad (`web/test/tablet.test.mjs`).
70. **On the iPad a held finger opens no menu** (Henri, 2026-10-20). What a menu offers there is in a bar of tiles
    (viewer/tablet.js), and the bar asks the menu itself for its entries (the file menu, the "/" menu's for blocks) —
    a new entry in the menu is in the bar without a word. A secondary click (a trackpad) still has its menu.
71. **A movement over a movement is one movement**: what stands over a view that zooms away goes with it (a fade as
    long as the zoom, `ease-in-out` — `ease-out` drops at the first frame), what is under it does not come in on its
    own meanwhile, and where the view stood is read when it is touched, before anything else is opened.
73. **A sideways gesture on the note is held from the first move.** Safari on the iPad makes a
    move it is not stopped from at once its own (the note scrolls, the text is selected) and the
    touches after it can no longer be held; Chromium's emulation holds them all the same, so a
    check passing there says nothing of it. What the page takes sideways has `touch-action:
    pan-y` where the finger lands, and the first clearly sideways `touchmove` is prevented while
    the direction is still being decided. A `touchcancel` after the gesture was clearly meant
    still counts.

### Touch on Linux (WebKitGTK)

76. **WebKitGTK is no Safari under a finger, and only a touch screen's touches show what it does** (Henri,
    2026-10-24: the tablet's fingers on the Mac's screen, over mac-cast). It tells of fingers as pointers
    of their own, but says the pointer is a fine one (`pointer: coarse` never holds: what is pressed is
    sized by `<html data-finger>` too, viewer/hand.js), makes up a mouse's pointer events after every tap
    (taken out by hand.js; the click stays), scrolls under a finger with wheels of its own and makes the
    whole window larger under two fingers where the page does not take them. Two fingers on the screen
    are never the host's: a gesture of the window that claims them (`GestureZoom`, host.rs) takes the
    second finger and every move away from the page — only a touchpad's pinch, which has no sequence, is
    claimed. Chromium's touch emulation shows none of this, and made-up DOM events neither: what WebKitGTK
    does is checked in WebKitGTK with a touch screen's touches (`rig.sh gtktouch`, dev/gtktouch); what the
    page does with it, in Chromium under WebKitGTK's name (`web/test/linux-touch.test.mjs`).
    The iPad's bars in the application are said by `<html data-tiles>` (viewer/touch.js: an iPad, or
    the application or WebKitGTK while the hand is a finger in a wide window), never by `data-finger`
    alone: a browser on a touch screen that is no iPad keeps the handle's menu and the held finger's
    (`web/test/ipad.test.mjs`).
    WebKitGTK sends no click after a tap whose pointerdown was prevented: what keeps the note's selection
    that way (the bars, their panels) takes the finger's lift as the click (viewer/touch.js `tapped`) —
    checked in WebKitGTK (`rig.sh gtktouch`, after `rig.sh start`), Chromium shows nothing of it.
    What a bar's tile does is asked of the selection when it is tapped, not when the bar came: blocks
    are added to a selection without the bar coming again (a swipe on one more). A check of it chooses
    by swipes, not by `MdActive.blocks.select` — that one hands the bar the whole selection at once.

### Releases and installs

28. **The Windows installer is tried before it is released** (`windows-tried` in `build.yml`).
29. **After `bin/mdview-install` the running app is still the old one** until every window is
    closed. Say so; never kill it.
