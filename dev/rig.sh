#!/bin/bash
# Development rig: runs this checkout's mdview (src-tauri, built with `cargo build`) inside a nested Hyprland, with
# its own D-Bus session and state, so the installed app and the desktop are
# left alone. The nested compositor is parked on the workspace "spare" (an
# off-screen output on Henri's machine; any workspace name works).
#
#   dev/rig.sh start                 nested compositor up
#   dev/rig.sh compare FILE…         reading view vs. active mode: layout report + screenshots per file
#   dev/rig.sh modes FILE            switching between the modes, find, outline, a task (on a copy of FILE)
#   dev/rig.sh edit                  typing in the active mode: rules, keys, lists, undo, saving (on a copy)
#   dev/rig.sh slashbar              the six buttons over the "/" menu: keys, a click, typing takes them away
#   dev/rig.sh islands               dialogs for code, formulas, properties, raw Markdown; popovers (on a copy)
#   dev/rig.sh m4                    tables, footnotes, paste and copy (on a copy)
#   dev/rig.sh m5                    context menu, formatting bar, undo and caret across modes, closing question, start mode
#   dev/rig.sh perf FILE…            the spec's performance figures, measured (on a copy)
#   dev/rig.sh graphic [real]        a figure drawn by Claude: dialog, draw, change, reference, insert
#   dev/rig.sh ghostmath             a continuation that closes a formula: taken, it is one
#   dev/rig.sh ghost [real]          the continuation offered while typing (a fixed answer; `real`: the model itself)
#   dev/rig.sh pdf                   PDFs: embeds in a note, the viewer, highlights from links, a link to a selection, outline, pages
#   dev/rig.sh wikiroot [DIR NOTE]   a note of a subfolder, its links to notes and PDFs of other folders (assets/…): found, PDF parts drawn — in a vault, in a repository; DIR: a copy of a real folder, NOTE in it
#   dev/rig.sh pdfink                a PDF drawn on: the whiteboard over its pages, a stroke kept in .mdview/pdf, the PDF untouched, there again after a restart, nothing kept once it is rubbed out
#   dev/rig.sh pdflag                how late what is drawn on a PDF shows (a pen's samples every 8 ms): a bare page, quick work, a page written full, far in
#   dev/rig.sh turn                  pictures turned by quarters: shown turned in both views, turned from the menu, written before the size
#   dev/rig.sh captions              a caption under a picture, a code block, a formula: a figure in both views; given and taken from the menu
#   dev/rig.sh mathtext              LaTeX Suite in the text, between dollars, with real keys
#   dev/rig.sh latex                 LaTeX Suite with real keys: mk / dm, snippets, tabstops, fraction, matrix, tabout
#   dev/rig.sh lists                 list items dragged between sub-lists, under an item, out a level, out of the list
#   dev/rig.sh blocks                blocks selected as wholes (handle click, then the keyboard); a click below the last block
#   dev/rig.sh backspace             Backspace sent as a key from outside (wtype -k BackSpace, a phone's screen mirror) takes a letter away: active mode and source
#   dev/rig.sh blockpaste            Ctrl+D puts a block's copy right below it; what is pasted while blocks are selected goes below them (real keys)
#   dev/rig.sh colsel                the rectangle over blocks in a column: the items, paragraphs and headings it reaches, not the list or the column
#   dev/rig.sh zoom                  a note larger and smaller: Ctrl or Super with + − 0, the settings' text size
#   dev/rig.sh adjust                a PDF embed's region adjusted in its dialog, with the real pointer
#   dev/rig.sh textmenu              the menu for text in the reading view and in a field
#   dev/rig.sh shots                 screenshots of the newer parts, for looking at
#   dev/rig.sh ovlook [FOLDER]       All Notes as it looks (tiles, list, subfolders) on a copy of FOLDER: screenshots only
#   dev/rig.sh paste                 a project's pasteboard: none without a sign-in, blocks made here and at the server (with their origin), written there and here, cleared; its copy in the project; mdview paste
#   dev/rig.sh pagestyles            a page's line as a sheet, a preview, a widget
#   dev/rig.sh board-hand            a whiteboard under a mouse: things met where they are drawn, arrows joined as drawn, joints, the right button's menu, the board moved with it (a real pointer)
#   dev/rig.sh explorer              the folder's list works with files: everything listed, hide, copy / cut / paste, duplicate, files pulled in, several rows; whiteboards as files and among All Notes
#   dev/rig.sh ground                a note with a ground of its own in a folder window: the strip of tabs is of that ground, the sheet begins under it
#   dev/rig.sh docstyle              the document's style (ground, width) beside the source and the source with its reading: the panel, written into the head, Ctrl+Z, both sheets
#   dev/rig.sh scrollperf [pdf]      frames while a long note on each ground is scrolled in each mode, and a PDF of sixty pages: median, p95, long ones; no ground held at the window
#   dev/rig.sh pdfscroll             a PDF full of words scrolled and zoomed: its text layer not drawn meanwhile, back to select after
#   dev/rig.sh switchlag             a long note from mode to mode: the thumb glides on, the page holds only when nothing moves
#   dev/rig.sh idle                  a window at rest costs next to nothing (CPU of the app and its web process over 5 s)
#   dev/rig.sh glass                 a menu over the note: what is behind it blurred or covered, never read through
#   dev/rig.sh split                 two things side by side: the note as it reads beside its source, another note, a PDF's pages, a link leading on in the sheet
#   dev/rig.sh sheets                the sidebar's sheets show the file: a note's beginning, a PDF's first page, a whiteboard, a picture
#   dev/rig.sh pastetab              All Notes opens on the folders; the pasteboard in a tab of its own, from its button; every whiteboard listed
#   dev/rig.sh colwidth              the line between two table columns pulled with a real pointer: the widths follow, the note says them
#   dev/rig.sh icons                 a folder's colour from the more and its sign from Lucide's many: searched in English and German, kept, there again after a restart
#   dev/rig.sh splitscroll           two notes side by side, each scrolled with a real wheel down and all the way up again
#   dev/rig.sh scrollup              a long note scrolled with a real wheel down and up again: what stands around it does not change meanwhile
#   dev/rig.sh ovswitch              All Notes from the folders to all notes in some hundred notes: at once, a skeleton, beginnings fading in
#   dev/rig.sh switching             from note to note with different grounds: one fades into the next, the sheet stays with one wheel on it
#   dev/rig.sh navigate              back and forward through notes and All Notes' folders: the arrows, Alt+← and Alt+→
#   dev/rig.sh railfav               a folder pulled onto the sidebar's rail with a real pointer: a favourite (builds dev/vptr as dragreal does)
#   dev/rig.sh sidebar               the sidebar's layouts, the search, a folder's colour and sign
#   dev/rig.sh more                  formula shape switch and picture copy, dialog size, editor search / brackets / completion, tick, tooltips
#   dev/rig.sh dnd                   moving a block by its handle, dropping picture files (on a copy)
#   dev/rig.sh prefs                 the settings and what follows them (put back afterwards)
#   dev/rig.sh edges                 edge cases: empty document, one island, file changed under a dialog, narrow window, keyboard only
#   dev/rig.sh clip                  plain-text paste, a pasted picture, a large paste (the nested session's clipboard)
#   dev/rig.sh assets                what is put into a note of a subfolder: in the base folder's assets, named assets/…, shown — also once the note is moved
#   dev/rig.sh link                  the link popover: show, edit, reference links, new link, remove (on a copy)
#   dev/rig.sh typing FILE…          time per keystroke and per save in the active mode (on a copy)
#   dev/rig.sh native                the browser's own typing path: spaces, deleting, hard break (on a copy)
#   dev/rig.sh folder                the active mode in a folder window (sidebar, other notes, back)
#   dev/rig.sh history               a folder made a project: commits after a quiet while, for a change from outside, at closing; the device named
#   dev/rig.sh sync                  a project linked to a repository elsewhere (a bare one here): pushed, pulled, both joined
#   dev/rig.sh share                  a note of a linked project shared from its window: the link, a password, shared no more
#   dev/rig.sh newnote                New Note asks for nothing: "Untitled" at once, the caret in its title; named after the title when left alone a moment and when left; an old note's title is only its title
#   dev/rig.sh fileundo               what was done to the files from All Notes taken back (Ctrl+Z) and done again (Ctrl+Shift+Z)
#   dev/rig.sh slides                 a presentation (.pptx): its tile, the PDF viewer, one that cannot be read (needs LibreOffice)
#   dev/rig.sh tiledrag               a tile of All Notes held by a real pointer: the picture at the pointer is the tile's, at its size (run dragreal once before) — TO=sidebar: held over the sidebar
#   dev/rig.sh move                   a note dragged into a folder, a folder into another
#   dev/rig.sh github                signing in with GitHub from the settings, against a GitHub of the rig's own
#   dev/rig.sh tabs                  the tabs of a folder window: a note in its own tab, an empty one, a PDF where it was left, keys, closing, pulling
#   dev/rig.sh regress FILE…         reading view and source editor: same as on the branch BASE (default main)?
#   dev/rig.sh open FILE…            just open the files (MDVIEW_DEBUG on)
#   dev/rig.sh shot NAME             screenshot of the nested compositor
#   dev/rig.sh stop
# A case says what fails, and in one line how many checks held (every line, the ones that held too: RIG_ALL=1).
if [[ -z ${RIG_ALL:-} && ! ${1:-} =~ ^(start|stop|open|shot|)$ ]]; then
  RIG_ALL=1 "$0" "$@" | awk '/^ok   /{ n++; next } /^FAIL /{ f++ } { print } END { if (n + f) printf "%d ok, %d FAIL\n", n, f }'; exit "${PIPESTATUS[0]}"
fi
D="$(cd "$(dirname "$0")" && pwd)"; APP="${MDVIEW_BIN:-$D/../src-tauri/target/debug/mdview}"; [[ -x $APP ]] || APP="$D/../src-tauri/target/release/mdview"
R="${MDVIEW_RIG:-$HOME/.cache/mdview-rig}"; H="$XDG_RUNTIME_DIR/hypr"; WS="${MDVIEW_RIG_WS:-name:spare}"
mkdir -p "$R/out" "$R/state"
sig() { cat "$R/sig" 2>/dev/null; }
wl() { HYPRLAND_INSTANCE_SIGNATURE= hyprctl instances -j | jq -r --arg s "$(sig)" '.[] | select(.instance==$s) | .wl_socket'; }
app() { # app SECONDS ENV… -- FILE…
  local secs=$1; shift; local envs=(); while [[ $1 != -- ]]; do envs+=("$1"); shift; done; shift
  env -u HYPRLAND_INSTANCE_SIGNATURE WAYLAND_DISPLAY="$(wl)" HYPRLAND_INSTANCE_SIGNATURE="$(sig)" GDK_BACKEND=wayland \
    XDG_STATE_HOME="$R/state" XDG_DATA_HOME="$R/data" XDG_CACHE_HOME="$R/cache" MDVIEW_DEBUG=1 MDVIEW_NO_KEYRING=1 "${envs[@]}" \
    setsid -f timeout "$secs" dbus-run-session -- "$APP" "$@" >"$R/app.log" 2>&1
}
# (this rig's own window: several rigs stand side by side on the hidden workspace)
shot() { local id pid; pid=$(HYPRLAND_INSTANCE_SIGNATURE= hyprctl instances -j | jq -r --arg s "$(sig)" '.[] | select(.instance==$s) | .pid'); id=$(hyprctl clients -j | jq -r --argjson p "${pid:-0}" '[.[] | select(.class=="aquamarine")] | (map(select(.pid==$p)) + .)[0].stableId'); grim -T "$id" "$1"; }
case "${1:-}" in
  start)
    [[ -n $(sig) ]] && HYPRLAND_INSTANCE_SIGNATURE=$(sig) hyprctl version >/dev/null 2>&1 && { echo "already up: $(sig)"; exit 0; }
    printf '%s\n' 'hl.config({ misc = { disable_hyprland_logo = true, disable_splash_rendering = true, disable_autoreload = true }, animations = { enabled = false } })' \
      'hl.monitor({ output = "", mode = "preferred", position = "auto", scale = 1 })' > "$R/nested.lua"
    ls "$H" | sort > "$R/before"
    hyprctl dispatch "hl.dsp.exec_cmd('[workspace $WS silent] env HYPRLAND_NO_SD_VARS=1 HYPRLAND_NO_SD_NOTIFY=1 HYPRLAND_NO_CRASHREPORTER=1 Hyprland -c $R/nested.lua')" >/dev/null
    for _ in $(seq 50); do
      sleep 0.2; new=$(comm -13 "$R/before" <(ls "$H" | sort) | head -1)
      if [[ -n $new ]] && HYPRLAND_INSTANCE_SIGNATURE=$new hyprctl version >/dev/null 2>&1; then echo "$new" > "$R/sig"; break; fi
    done
    [[ -n $(sig) ]] || { echo "nested compositor did not come up"; exit 1; }
    echo "nested $(sig) on $(wl)" ;;
  open) shift; app "${MDVIEW_RIG_SECS:-600}" -- "$@" ;;
  compare)
    shift; fail=0
    for f in "$@"; do
      name=$(basename "$f"); rm -f "$R/out/$name".*.json
      app 60 MDVIEW_PROBE="$D/probe-compare.js" MDVIEW_PROBE_OUT="$R/out" -- "$f"
      for _ in $(seq 250); do [[ -f $R/out/$name.read.json ]] && break; sleep 0.1; done
      sleep 0.8; shot "$R/out/$name.read.png"
      for _ in $(seq 350); do [[ -f $R/out/$name.compare.json ]] && break; sleep 0.1; done
      sleep 0.5; shot "$R/out/$name.active.png"
      pkill -f "^$APP" 2>/dev/null; sleep 0.3
      if [[ -f $R/out/$name.compare.json ]]; then
        # without the window frame; pixels that differ by more than anti-aliasing does
        for v in read active; do magick "$R/out/$name.$v.png" -shave 40x40 +repage "$R/out/$name.$v.png"; done
        px=$(magick compare -metric AE -fuzz 20% "$R/out/$name.read.png" "$R/out/$name.active.png" "$R/out/$name.diff.png" 2>&1 | awk '{print int($1)}')
        jq -c --arg px "$px" '{file, lines, roundtrip, scrollKept, firstSwitchMs, backMs, againMs, heightJump, height, words: (.words | {read, active, same, diffs: (.diffs[:3])}), boxes: (.boxes | {read, active, same, diffs: (.diffs[:3])}), pixels: $px, error}' "$R/out/$name.compare.json"
        jq -e --arg px "$px" '.roundtrip and .scrollKept and .words.same and .boxes.same and (.height.read == .height.active) and (($px | tonumber) < 50)' "$R/out/$name.compare.json" >/dev/null || { fail=1; echo "\"^ differs\""; }
      else echo "{\"file\":\"$name\",\"error\":\"no report\"}"; tail -5 "$R/app.log"; fail=1; fi
    done
    exit $fail ;;
  modes)
    name=$(basename "$2"); rm -rf "$R/work"; mkdir -p "$R/work"; cp "$2" "$R/work/$name"; rm -f "$R/out/$name.modes.json"
    app 60 MDVIEW_PROBE="$D/probe-modes.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.modes.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.modes.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '(.results[] | (if .ok then "ok   " else "FAIL " end) + .name + (if .ok then "" else "  " + (.detail | tostring) end)), (.error // empty)' "$R/out/$name.modes.json"
    jq -e .pass "$R/out/$name.modes.json" >/dev/null ;;
  edit)
    name=editing.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name.edit.json"
    app 60 MDVIEW_PROBE="$D/probe-edit.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 400); do [[ -f $R/out/$name.edit.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.edit.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '(.results[] | (if .ok then "ok   " else "FAIL " end) + .name + (if .ok then "" else "  " + (.detail | tostring) end)), (.error // empty)' "$R/out/$name.edit.json"
    # the file on disk is what the editor said it saved
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.edit.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || { echo "FAIL the file on disk differs from the saved document"; exit 1; }
    jq -e .pass "$R/out/$name.edit.json" >/dev/null ;;
  islands)
    name=islands.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{code,math,atom,islands}.json
    app 60 MDVIEW_PROBE="$D/probe-islands.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in code math atom; do
      for _ in $(seq 200); do [[ -f $R/out/$name.$v.json ]] && break; sleep 0.1; done; sleep 0.8; shot "$R/out/island-$v.png"
    done
    for _ in $(seq 400); do [[ -f $R/out/$name.islands.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.islands.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.islands.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.islands.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.islands.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.islands.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  m4)
    name=m4.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{handles,menu,note,m4}.json
    app 80 MDVIEW_PROBE="$D/probe-m4.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in handles menu note; do
      for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.m4.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/m4-$v.png"
    done
    for _ in $(seq 500); do [[ -f $R/out/$name.m4.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.m4.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.m4.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.m4.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.m4.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.m4.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  m5)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{menu,bar,ask,m5,mode}.json
    printf '%s' '**menupaste**' | WAYLAND_DISPLAY="$(wl)" wl-copy
    app 90 MDVIEW_PROBE="$D/probe-m5.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in menu bar ask; do
      for _ in $(seq 400); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.m5.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/m5-$v.png"
    done
    for _ in $(seq 500); do [[ -f $R/out/$name.m5.json ]] && break; sleep 0.1; done
    [[ -f $R/out/$name.m5.json ]] || { pkill -f "^$APP" 2>/dev/null; echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.m5.json"
    # Apply in the closing question: the dialog's change is saved and the window closes by itself
    gone=FAIL; for _ in $(seq 60); do [[ $(HYPRLAND_INSTANCE_SIGNATURE=$(sig) hyprctl clients -j | jq length) == 0 ]] && { gone="ok  "; break; }; sleep 0.1; done
    echo "$gone the window closed after Apply"; pkill -f "^$APP" 2>/dev/null
    grep -q '^let a = 2;$' "$R/work/$name" && echo "ok   the dialog's change is in the file" || echo "FAIL the dialog's change is not in the file"
    # the next start opens in the mode last used
    app 30 MDVIEW_PROBE="$D/probe-mode.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_PROBE_MODE=1 -- "$R/work/$name"
    for _ in $(seq 200); do [[ -f $R/out/$name.mode.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ $(jq -r '.view' "$R/out/$name.mode.json" 2>/dev/null) == active ]] && echo "ok   the next window opens in the mode last used" || { echo "FAIL the next window opened in: $(cat "$R/out/$name.mode.json" 2>/dev/null || echo 'no report after 20 s')"; tail -3 "$R/app.log"; }
    WAYLAND_DISPLAY="$(wl)" wl-copy --clear 2>/dev/null
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.m5.json"; [[ $gone == "ok  " ]] || echo FAIL; grep -q '^let a = 2;$' "$R/work/$name" || echo FAIL; [[ $(jq -r '.view' "$R/out/$name.mode.json" 2>/dev/null) == active ]] || echo FAIL; } | grep -qv '^ok' ;;
  graphic)
    # a figure drawn by Claude; `dev/rig.sh graphic real` asks Claude itself (takes about half a minute)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{drawn,inserted,zoomed,graphic}.json
    if [[ ${2:-} == real ]]; then
      { echo 'window.__graphicReal = true;'; cat "$D/probe-graphic.js"; } > "$R/probe-graphic-real.js"
      app 200 MDVIEW_PROBE="$R/probe-graphic-real.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    else
      app 60 MDVIEW_PROBE="$D/probe-graphic.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_GRAPHIC_FAKE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" width="200" height="80"><script>alert(1)</script><rect x="8" y="8" width="184" height="64" rx="8" fill="none" stroke="#1d1d1f" stroke-width="1.6" onclick="x()"/><text x="100" y="46" text-anchor="middle" font-size="14">TAG</text></svg>' -- "$R/work/$name"
    fi
    for v in drawn inserted zoomed; do for _ in $(seq 1500); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.graphic.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/graphic-$v.png"; done
    for _ in $(seq 400); do [[ -f $R/out/$name.graphic.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.graphic.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.graphic.json"
    f=$(ls "$R/work"/*.svg 2>/dev/null | head -1)
    [[ -n $f ]] && ! grep -qi '<script\|onclick' "$f" && echo "ok   the figure is a file beside the note ($(basename "$f"), $(wc -c < "$f") bytes), with nothing in it that could run" || echo "FAIL no clean .svg beside the note: $f"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.graphic.json"; } | grep -qv '^ok' ;;
  board)
    # a whiteboard in a note: made from the / menu, drawn on, kept, opened again from both views
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{open,palette,drawn,closed,outside,board}.json
    app 90 MDVIEW_PROBE="$D/probe-board.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in open palette drawn closed; do for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-$v.png"; done
    # (the board's file written by someone else, as a sync does: whole, in the old one's place)
    for _ in $(seq 300); do [[ -f $R/out/$name.outside.json || -f $R/out/$name.board.json ]] && break; sleep 0.1; done
    f=$(ls "$R/work/assets/"*.board.svg 2>/dev/null | head -1); [[ -n $f ]] && { sed 's|</svg>|<circle cx="900" cy="900" r="40"/></svg>|' "$f" > "$f.new" && mv "$f.new" "$f"; }
    for _ in $(seq 400); do [[ -f $R/out/$name.board.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board.json"
    f=$(ls "$R/work/assets"/*.board.svg 2>/dev/null | head -1)
    n=$([[ -n $f ]] && grep -c '^{"id"' "$f")
    want=$(jq -r '.strokes // 0' "$R/out/$name.board.json")
    [[ -n $f && $n == "$want" && $want -gt 3 ]] && echo "ok   the board is a file where the note's pictures go ($(basename "$f"), $(wc -c < "$f") bytes), with a line for each of its $n strokes" || echo "FAIL the board's file: ${f:-none}, $n strokes, $want on the board"
    [[ -n $f ]] && grep -q "$(basename "$f")" "$R/work/$name" && echo "ok   the note on disk names it" || echo "FAIL the note on disk does not name the board"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board.json"; } | grep -qv '^ok' ;;
  board-items)
    # what stands on a whiteboard beside the ink: shapes, sticky notes, text boxes, lines — chosen, moved, sized, turned, typed in, arranged
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{shape,items,arranged,closed,board-items}.json
    app 90 MDVIEW_PROBE="$D/probe-board-items.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in shape items arranged closed; do for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-items.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-items-$v.png"; done
    for _ in $(seq 400); do [[ -f $R/out/$name.board-items.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-items.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-items.json"
    f=$(ls "$R/work/assets"/*.board.svg 2>/dev/null | head -1)
    [[ -n $f ]] && for k in shape sticky text line ink; do grep -q "\"k\":\"$k\"" "$f" && echo "ok   the file has a line for the $k" || echo "FAIL no $k in the file"; done
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-items.json"; } | grep -qv '^ok' ;;
  board-pictures)
    # a picture dropped on a whiteboard: kept beside the board, shown in its picture, left alone by the collector while the board shows it
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work/outside"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{dropped,kept,gone,board-pictures}.json
    magick -size 240x120 xc:'#e5372c' "$R/work/outside/photo one.png"; echo text > "$R/work/outside/readme.txt"
    app 90 MDVIEW_PROBE="$D/probe-board-pictures.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_ATTACH_GRACE=0 -- "$R/work/$name"
    pic="$R/work/assets/photo one.png"; said=()
    for v in dropped kept gone; do
      for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-pictures.json ]] && break; sleep 0.1; done
      [[ $v == dropped ]] && { shot "$R/out/board-pictures.png"; f=$(ls "$R/work/assets"/*.board.svg 2>/dev/null | head -1)
        [[ -f $pic ]] && said+=("ok   the picture's file is copied beside the board's") || said+=("FAIL no copy of the picture beside the board")
        [[ -n $f ]] && grep -q '"k":"image"' "$f" && grep -q '<image data-src="photo one.png"' "$f" && said+=("ok   the board's file names it and holds a small copy for its picture") || said+=("FAIL the board's file does not hold the picture"); }
      [[ $v == kept ]] && { [[ -f $pic ]] && cmp -s "$pic" "$R/work/outside/photo one.png" && said+=("ok   the note saved three times: the picture stays as it is, the board names it") || said+=("FAIL the collector took a picture the board shows"); }
      [[ $v == gone ]] && { [[ ! -f $pic ]] && said+=("ok   off the board and the note saved again: the picture's file goes to the trash") || said+=("FAIL a picture nothing names any more stayed"); }
    done
    for _ in $(seq 400); do [[ -f $R/out/$name.board-pictures.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-pictures.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-pictures.json"; printf '%s\n' "${said[@]}"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-pictures.json"; printf '%s\n' "${said[@]}"; } | grep -qv '^ok' ;;
  board-connect)
    # connectors on a whiteboard: lines pulled out of items, joined, following them, their way
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{arrows,joined,closed,board-connect}.json
    app 90 MDVIEW_PROBE="$D/probe-board-connect.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in arrows joined closed; do for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-connect.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-connect-$v.png"; done
    for _ in $(seq 400); do [[ -f $R/out/$name.board-connect.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-connect.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-connect.json"
    f=$(ls "$R/work/assets"/*.board.svg 2>/dev/null | head -1)
    [[ -n $f ]] && grep -q '"from":{"id"' "$f" && ! grep -q '"sides"' "$f" && echo "ok   the file says what each line is joined to, and nothing that is worked out" || echo "FAIL the file's lines"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-connect.json"; } | grep -qv '^ok' ;;
  board-hand)
    # what a mouse meets on a whiteboard (a thing where it is drawn, not the box around it), arrows joined as they are drawn, joints, the right button's menu, the board moved with it — the last with a real pointer (dev/vptr)
    V="$R/vptr"; [[ -x $V && $V -nt $D/vptr/vptr.c ]] || { (cd "$D/vptr" && wayland-scanner client-header wlr-virtual-pointer-unstable-v1.xml "$R/vp.h" && wayland-scanner private-code wlr-virtual-pointer-unstable-v1.xml "$R/vp.c" && cc -O1 -I"$R" -o "$V" vptr.c "$R/vp.c" $(pkg-config --cflags --libs wayland-client)) || { echo "vptr not built"; exit 1; }; }
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".plan*.json "$R/out/$name".{joints,menu,realmenu,board-hand}.json "$R/out"/board-hand-*.png
    app 120 MDVIEW_PROBE="$D/probe-board-hand.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1; shots=(joints menu realmenu)
    for _ in $(seq 1100); do
      [[ -f $R/out/$name.board-hand.json ]] && break
      for v in "${shots[@]}"; do [[ -f $R/out/$name.$v.json && ! -f $R/out/board-hand-$v.png ]] && { sleep 0.3; shot "$R/out/board-hand-$v.png"; }; done
      if [[ -f $R/out/$name.plan$n.json ]]; then sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$R/out/$name.plan$n.json"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; n=$((n + 1)); else sleep 0.1; fi
    done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-hand.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-hand.json"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-hand.json"; } | grep -qv '^ok' ;;
  board-scenes)
    # the whiteboard's small menus: size, scenes, the grid, spreading, printing
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{scenes,list,board-scenes}.json
    app 90 MDVIEW_PROBE="$D/probe-board-scenes.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in scenes list; do for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-scenes.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-scenes-$v.png"; done
    for _ in $(seq 500); do [[ -f $R/out/$name.board-scenes.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-scenes.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-scenes.json"
    f=$(ls "$R/work/assets"/*.board.svg 2>/dev/null | head -1)
    [[ -n $f && $(grep -c '"k":"scene"' "$f") == 2 ]] && echo "ok   the file has a line for each scene" || echo "FAIL the file's scenes"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-scenes.json"; } | grep -qv '^ok' ;;
  board-table)
    # a table on a whiteboard: typed in cell by cell, grown, sized
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{typed,closed,board-table}.json
    app 90 MDVIEW_PROBE="$D/probe-board-table.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in typed closed; do for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-table.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-table-$v.png"; done
    for _ in $(seq 500); do [[ -f $R/out/$name.board-table.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-table.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-table.json"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-table.json"; } | grep -qv '^ok' ;;
  cut)
    # text and a picture of svg, selected together, cut, and put in elsewhere
    name=cut.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Cut\n\nBefore the picture here.\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120"><rect width="120" height="60" fill="teal"/></svg>\n```\n\nAfter the picture here.\n\nLast.\n' > "$R/work/$name"; rm -f "$R/out/$name".cut.json
    app 60 MDVIEW_PROBE="$D/probe-cut.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.cut.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.cut.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    if jq -e '.steps' "$R/out/$name.cut.json" >/dev/null 2>&1; then ! jq -r '.steps[], (.error // empty)' "$R/out/$name.cut.json" | tee /dev/stderr | grep -q '^FAIL\|Error'; else jq . "$R/out/$name.cut.json"; fi ;;
  pagelook)
    # a page's line turned into a card from its menu
    name=look.md; rm -rf "$R/work"; mkdir -p "$R/work"; { printf '# Look\n\nText before.\n\n<!-- page: Alpha -->\n\nIn alpha.\n\n<!-- /page -->\n\nText after the first.\n\n<!-- page: Beta -->\n\nIn beta.\n\n<!-- /page -->\n\n![](pic.svg)\n\n'; for i in $(seq 40); do printf 'Filler paragraph %s with some words.\n\n' "$i"; done; printf '<!-- page: Gamma -->\n\nIn gamma.\n\n<!-- /page -->\n'; } > "$R/work/$name"; printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120"><rect width="120" height="60" fill="teal"/></svg>' > "$R/work/pic.svg"; rm -f "$R/out/$name".pagelook.json
    app 60 MDVIEW_PROBE="$D/probe-pagelook.js" MDVIEW_TALK_FAKE="$(cat "$D/tests/ai/fake-pages.txt")" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.pagelook.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/pagelook.png"
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.pagelook.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.pagelook.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  explorer)
    # the folder's list as a place to work with files, and whiteboards that are files of their own
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N/sub" "$N/empty" "$N/node_modules" "$R/work/outside/pack"
    printf '# Alpha\n\nSome text.\n' > "$N/Alpha.md"; printf '# Beta\n\nMore.\n' > "$N/Beta.md"; printf '# Inner\n' > "$N/sub/Inner.md"
    python3 "$D/gen-pdf.py" "$N/paper.pdf" 1; magick -size 8x8 xc:red "$N/photo.png"; printf 'a,b\n1,2\n' > "$N/data.csv"; echo s > "$N/.secret"; echo x > "$N/node_modules/x.js"
    echo ext > "$R/work/outside/ext.txt"; printf '# In\n' > "$R/work/outside/pack/in.md"
    rm -f "$R/out"/*.explorer.json "$R/out"/*.shot-boards.json
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st" # (what an earlier run set is not this one's)
    app 120 MDVIEW_PROBE="$D/probe-explorer.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 900); do [[ -n $(ls "$R/out"/*.shot-boards.json "$R/out"/*.explorer.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.8; shot "$R/out/explorer-boards.png"
    for _ in $(seq 400); do ls "$R/out"/*.explorer.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    ls "$R/out"/*.explorer.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    fail=0; ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -4 | tr '\n' ' '))}"; fail=1; fi; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.explorer.json
    ok "what is hidden stands in the folder (.mdview/hidden.json)" '[[ $(jq -c .hidden "$N/.mdview/hidden.json") == "[\"photo.png\"]" ]]' 'cat "$N/.mdview/hidden.json"'
    ok "the copies and what was brought in are files of the folder" '[[ -f $N/sub/Beta.md && -f $N/Beta.md && -f $N/empty/data.csv && ! -e $N/data.csv && -f $N/sub/ext.txt && -f $N/sub/pack/in.md && -f $R/work/outside/ext.txt ]]' 'find "$N" -not -path "*/node_modules*" | sort'
    ok "the whiteboard is a file of the folder, with what was put on it" 'grep -q "mdview-board" "$N/Skizze.board.svg" && grep -q "k.:.sticky" "$N/Skizze.board.svg"' 'head -c 600 "$N/Skizze.board.svg"'
    ok "the note shows it by its name" 'grep -q "!\[\](Skizze.board.svg)" "$N/Alpha.md"' 'cat "$N/Alpha.md"'
    ! { jq -r '.steps[], (.error // empty)' "$R/out"/*.explorer.json; (( fail )) && echo FAIL; } | grep -qv '^ok' ;;
  ground)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.ground.json "$R/out"/*.shown.json
    printf '%s\n' '---' 'background: cyan' '---' '' '# Ground' '' 'A note on a ground of its own.' > "$N/Ground.md"; printf '# Plain\n\nNo ground.\n' > "$N/Plain.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 60 MDVIEW_PROBE="$D/probe-ground.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 300); do [[ -n $(ls "$R/out"/*.shown.json "$R/out"/*.ground.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/ground.png"
    for _ in $(seq 300); do ls "$R/out"/*.ground.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.ground.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  docstyle)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/*.docstyle.json "$R/out"/*.shown.json; F="$R/work/Style.md"
    printf '%s\n' '---' 'title: Style' '---' '# Style' '' 'A paragraph.' '' 'Another, where the caret is.' > "$F"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 60 MDVIEW_PROBE="$D/probe-docstyle.js" MDVIEW_PROBE_OUT="$R/out" -- "$F"
    for _ in $(seq 400); do [[ -n $(ls "$R/out"/*.shown.json "$R/out"/*.docstyle.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/docstyle-split.png"
    for _ in $(seq 400); do ls "$R/out"/*.docstyle.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.docstyle.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    # (on disk: the head as chosen last, the rest of the file as it was)
    want=$(printf '%s\n' '---' 'title: Style' 'width: wide' 'background: dots' '---' '# Style' '' 'A paragraph.' '' 'Another, where the caret is.')
    if [[ "$(cat "$F")" == "$want" ]]; then echo "ok   the file: its head as chosen, the rest as it was"; else echo "FAIL the file: $(head -c 300 "$F" | tr '\n' '|')"; fi
    ! { jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"; [[ "$(cat "$F")" == "$want" ]] || echo FAIL; } | grep -q '^FAIL' ;;
  scrollperf)
    # (what a frame costs while a long note is scrolled — no ground, a run of two colours, dots, a grid — in each mode, and a PDF
    # of sixty pages: the gaps between frames, median / p95 / how many over 33 ms. No element holds its picture at the window)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.scrollperf.json
    body() { echo "# $1"; for i in $(seq 150); do echo; echo "Paragraph $i of a long note, long enough to wrap a little in the window, with **bold**, \`code\` and a [link](https://example.com)."; (( i % 15 == 0 )) && { echo; echo "## Section $i"; echo; echo '> [!note] A callout'; echo '> In it.'; }; done; }
    body Plain > "$N/Plain.md"
    for g in Run:cyan Dots:dots Grid:grid; do { printf -- '---\nbackground: %s\n---\n\n' "${g#*:}"; body "${g%%:*}"; } > "$N/${g%%:*}.md"; done
    python3 "$D/gen-pdf.py" "$N/Long.pdf" 60
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    rm -f "$R/out"/*.cpu[AB]*.json; : > "$R/cpu.log"
    # (`scrollperf pdf`: the PDF alone)
    { [[ ${2:-} == pdf ]] && echo 'window.__scrollperfPdf = true;'; cat "$D/probe-scrollperf.js"; } > "$R/probe-scrollperf.js"
    app 240 MDVIEW_PROBE="$R/probe-scrollperf.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    tree() { echo "$1"; local c; for c in $(pgrep -P "$1"); do tree "$c"; done; }
    tick() { local s=0 p f; for p in $(tree "$(pgrep -f "^$APP" | head -1)"); do read -r -a f < "/proc/$p/stat" 2>/dev/null && s=$((s + f[13] + f[14])); done; echo $s; }
    timeout 400 inotifywait -qm -e close_write --format %f "$R/out" | while read -r e; do [[ $e =~ \.(cpu[AB][0-9]+)\.json$ ]] && echo "${BASH_REMATCH[1]} $(tick)" >> "$R/cpu.log"; [[ $e == *.scrollperf.json ]] && break; done &
    watch=$!
    for _ in $(seq 2200); do ls "$R/out"/*.scrollperf.json >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.3; kill $watch 2>/dev/null; pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.scrollperf.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    # (each run's CPU, the app and its web process, in ms a frame — written into the report)
    jq --argjson hz "$(getconf CLK_TCK)" --rawfile log "$R/cpu.log" '($log | split("\n") | map(select(length > 0) | split(" ")) | map({ (.[0]): (.[1] | tonumber) }) | add // {}) as $t
      | .runs |= [to_entries[] | .value + { cpu: (if $t["cpuA\(.key + 1)"] and $t["cpuB\(.key + 1)"] then (($t["cpuB\(.key + 1)"] - $t["cpuA\(.key + 1)"]) * 1000 / $hz / .value.n * 10 | round / 10) else null end) }]' "$f" > "$f.new" && mv "$f.new" "$f"
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    jq -r '"  (frames while scrolling, ms: median / p95 / over 33 ms of \(.runs[0].n) / CPU a frame)", (.runs[] | "  \(.what): \(.median) / \(.p95) / \(.long) / \(.cpu)   (\(.box), \(.moved) px)"), "  (PDF: \(.pdf.canvases) canvases, \(.pdf.megapixels) Mpx, a page \(.pdf.page), dpr \(.pdf.dpr))"' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  pdfscroll)
    # (a PDF full of words: what lies over its pages to be selected is not drawn while they move, and is back when they rest)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/*.pdfscroll.json; python3 "$D/gen-pdf.py" "$R/work/dense.pdf" 8 dense
    app 60 MDVIEW_PROBE="$D/probe-pdfscroll.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/dense.pdf"
    for _ in $(seq 500); do ls "$R/out"/*.pdfscroll.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.pdfscroll.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '(.results[] | (if .ok then "ok   " else "FAIL " end) + .name + (if .ok then "" else "  " + (.detail | tostring) end)), (.error // empty), "  (a frame: scrolled \(.scroll) ms, zoomed \(.zoom) ms)"' "$f"
    jq -e .pass "$f" >/dev/null ;;
  switchlag)
    # (a long note, changed from mode to mode by the switch: the page's long hold comes when nothing on the screen moves)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/*.switchlag.json
    { printf '%s\n' '# Long' '' '> [!note] A callout' '> In it.'; for i in $(seq 120); do printf '\n## Part %s\n\nParagraph %s with $a_%s^2 + b^2 = c^2$ and **bold** and [[Link %s]]: A sentence long enough to wrap in half a window. A sentence long enough to wrap in half a window. A sentence long enough to wrap in half a window.\n\n| A | B |\n|---|---|\n| %s | %s |\n\n```python\ndef f(x):\n    return x * %s\n```\n\n- one\n- two\n' $i $i $i $i $i $((i * i)) $i; done; } > "$R/work/long.md"
    app 120 MDVIEW_PROBE="$D/probe-switchlag.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/long.md"
    for _ in $(seq 1100); do ls "$R/out"/*.switchlag.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.switchlag.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '(.results[] | (if .ok then "ok   " else "FAIL " end) + .name + (if .ok then "" else "  " + (.detail | tostring) end)), (.error // empty)' "$f"
    jq -e .pass "$f" >/dev/null ;;
  idle)
    # (a window that only stands there does next to nothing: what it costs is read off the processes, the app and its web
    # process, over five seconds of rest — an animation turning out of sight was a page drawn anew every frame, for good)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; printf '# Idle\n\nA note, and nothing happening.\n' > "$N/Idle.md"; printf '# Other\n' > "$N/Other.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 40 -- "$N"; sleep 12
    root=$(pgrep -f "^$APP" | head -1); [[ -n $root ]] || { echo "FAIL the app did not start"; tail -5 "$R/app.log"; exit 1; }
    tree() { echo "$1"; local c; for c in $(pgrep -P "$1"); do tree "$c"; done; }
    pids=$(tree "$root"); tick() { local s=0 p f; for p in $pids; do read -r -a f < "/proc/$p/stat" 2>/dev/null && s=$((s + f[13] + f[14])); done; echo $s; }
    a=$(tick); sleep 5; b=$(tick); pkill -f "^$APP" 2>/dev/null
    ms=$(( (b - a) * 1000 / $(getconf CLK_TCK) ))
    if (( ms <= 250 )); then echo "ok   a window at rest: $ms ms of CPU in 5 s (at most 250)"; else echo "FAIL a window at rest: $ms ms of CPU in 5 s (at most 250)"; exit 1; fi ;;
  glass)
    # (whether WebKit draws backdrop-filter is not to be seen from the page: the screen is taken, and the empty right part of the
    # outline — its rows are short — is looked at. Lines of text behind it, drawn through blur, leave hardly an edge; seen through
    # plain glass they are sharp)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/*.glass.json "$R/out/glass.png"
    { printf '%s\n' '---' 'width: full' '---' '# Glass'; for i in $(seq 40); do echo; echo "## Part $i"; echo; echo "Line $i: MMMM WWWW HHHH IIII MMMM WWWW HHHH IIII MMMM WWWW HHHH IIII MMMM WWWW HHHH IIII MMMM WWWW HHHH IIII."; done; } > "$R/work/glass.md"
    app 40 MDVIEW_PROBE="$D/probe-glass.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/glass.md"
    for _ in $(seq 200); do ls "$R/out"/*.glass.json >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.3; shot "$R/out/glass.png"; hyprctl -i "$(sig)" clients -j | jq -c '[.[] | select(.class != "")][0] | [.at[0], .at[1], .size[0], .size[1]]' > "$R/out/glass.at"; hyprctl -i "$(sig)" monitors -j | jq -c '.[0] | [.width, .scale]' >> "$R/out/glass.at"; pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.glass.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -e .open "$f" >/dev/null || { echo "FAIL the outline did not open  $(cat "$f")"; exit 1; }
    python3 - "$R/out/glass.png" "$f" "$R/out/glass.at" <<'PY'
import json, sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("L"); o = json.load(open(sys.argv[2])); at, mon = [json.loads(l) for l in open(sys.argv[3])]; ax, ay, aw, ah = at
x, y, w, h = o["menu"]
# the window where the nested compositor put it, the screen taken at its own scale; the page fills the window
k = im.width / (mon[0] / mon[1]); sx = k * aw / o["w"]; ox, oy = ax * k, ay * k + (ah * k - o["h"] * sx)
box = (int(ox + (x + w * 0.62) * sx), int(oy + (y + 50) * sx), int(ox + (x + w - 18) * sx), int(oy + (y + h - 12) * sx))
px = im.crop(box).load(); W, H = box[2] - box[0], box[3] - box[1]
edge = sum(abs(px[i + 1, j] - px[i, j]) for j in range(H) for i in range(W - 1)) / max(1, (W - 1) * H)
ok = edge < 0.25
print(("ok   " if ok else "FAIL ") + f"what is behind a menu is not read through: blurred, or covered (edges {edge:.2f}, at most 0.25 — plain glass: 0.5)")
sys.exit(0 if ok else 1)
PY
    ;;
  split)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N/sub"; rm -f "$R/out"/*.split.json "$R/out"/*.self.json "$R/out"/*.pdf.json
    printf '# Alpha\n\nSome text.\n' > "$N/Alpha.md"; printf '# Beta\n\nMore about it, and a link: [[Gamma]].\n' > "$N/sub/Beta.md"; printf '# Gamma\n\nThird.\n' > "$N/sub/Gamma.md"; printf '%s\n' '---' 'background: cyan' '---' '' '# Ground' '' 'On a ground.' > "$N/Ground.md"; python3 "$D/gen-pdf.py" "$N/paper.pdf" 3
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 90 MDVIEW_PROBE="$D/probe-split.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for v in self pdf; do for _ in $(seq 400); do [[ -n $(ls "$R/out"/*.$v.json "$R/out"/*.split.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/split-$v.png"; done
    for _ in $(seq 400); do ls "$R/out"/*.split.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.split.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  sheets)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.sheets.json "$R/out"/*.shown.json
    printf '# Alpha\n\nSome text here.\n\n## Part\n\n- one\n- two\n' > "$N/Alpha.md"; python3 "$D/gen-pdf.py" "$N/paper.pdf" 1; node "$D/make-board.mjs" > "$N/Skizze.board.svg"; magick -size 8x8 xc:red "$N/photo.png"; printf 'a,b\n1,2\n' > "$N/data.csv"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 90 MDVIEW_PROBE="$D/probe-sheets.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 400); do [[ -n $(ls "$R/out"/*.shown.json "$R/out"/*.sheets.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/sheets.png"
    for _ in $(seq 300); do ls "$R/out"/*.sheets.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.sheets.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  pastetab)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.pastetab.json "$R/out"/*.paste.json
    printf '# Alpha\n\nText.\n\n![](Skizze.board.svg)\n' > "$N/Alpha.md"; node "$D/make-board.mjs" > "$N/Skizze.board.svg"; node "$D/make-board.mjs" > "$N/Lose.board.svg"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 60 MDVIEW_PROBE="$D/probe-pastetab.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 300); do [[ -n $(ls "$R/out"/*.paste.json "$R/out"/*.pastetab.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/pastetab.png"
    for _ in $(seq 300); do ls "$R/out"/*.pastetab.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.pastetab.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  sidebar)
    # the sidebar's layouts over one folder, the search, a folder's colour and sign
    rm -rf "$R/work"; mkdir -p "$R/work/notes/Studium" "$R/work/notes/Projekte/Deep"
    printf '# Alpha\n\nSome text.\n' > "$R/work/notes/Alpha.md"; printf '# Beta\n\n- [x] done\n- [x] done too\n' > "$R/work/notes/Beta.md"; printf '# Gamma\n\nMore text here.\n\n![](p.png)\n' > "$R/work/notes/Gamma.md"
    printf '# Thermo\n\nStates and systems.\n' > "$R/work/notes/Studium/Thermo.md"; printf '# Blatt\n\n- [x] one\n- [ ] two\n- [ ] three\n' > "$R/work/notes/Studium/Blatt.md"
    printf '# Plan\n\nNext.\n' > "$R/work/notes/Projekte/Plan.md"; printf '# Inner\n\nDeep in.\n' > "$R/work/notes/Projekte/Deep/Inner.md"
    rm -f "$R/out"/*.json
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs)' "$st" > "$st.new" && mv "$st.new" "$st" # (what an earlier run opened is not this one's)
    app 150 MDVIEW_PROBE="$D/probe-sidebar.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/notes"
    for v in source rail sheets tiles; do for _ in $(seq 400); do ls "$R/out"/*."$v".json >/dev/null 2>&1 && break; ls "$R/out"/*.sidebar.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.4; shot "$R/out/sidebar-$v.png"; done
    for _ in $(seq 900); do ls "$R/out"/*.sidebar.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    ls "$R/out"/*.sidebar.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.sidebar.json
    looks=$(jq -c '.folders' "$R/work/notes/.mdview/folders.json" 2>/dev/null)
    [[ $looks == '{"Projekte":{"color":"blue","icon":"star","fav":true},"Uni":{"color":"green","icon":"book","fav":true}}' ]] && echo "ok   the looks stand in the folder — the favourites with them: the one chosen in the rail, and the other under its folder's new name" || echo "FAIL the look in the folder: $looks"
    ! { jq -r '.steps[], (.error // empty)' "$R/out"/*.sidebar.json; [[ $looks == '{"Uni":{"color":"green","icon":"book"}}' ]] || echo FAIL; } | grep -qv '^ok' ;;
  sbflicker)
    # a note chosen in the sidebar: its row stays marked, the last one's does not flicker back
    rm -rf "$R/work"; mkdir -p "$R/work/notes"; for n in Alpha Beta Gamma; do printf '# %s\n\nText.\n' "$n" > "$R/work/notes/$n.md"; done
    rm -f "$R/out"/*.sbflicker.json
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 40 MDVIEW_PROBE="$D/probe-sbflicker.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/notes"
    for _ in $(seq 300); do ls "$R/out"/*.sbflicker.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    ls "$R/out"/*.sbflicker.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out"/*.sbflicker.json | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  pagestyles)
    # a page's line as a sheet, a preview, a widget: what they show, side by side, alike in both views
    name=styles.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/pagestyles.md" "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 60 MDVIEW_PROBE="$D/probe-pagestyles.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.read.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/pagestyles-read.png"
    for _ in $(seq 300); do [[ -f $R/out/$name.pagestyles.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/pagestyles-active.png"
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.pagestyles.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.pagestyles.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  board-enter)
    # stepping into a whiteboard: its content is there at once, shown whole
    name=enter.md; rm -rf "$R/work"; mkdir -p "$R/work/assets"; node "$D/make-board.mjs" > "$R/work/assets/far.board.svg"; printf '# Enter\n\nA board:\n\n![Whiteboard](assets/far.board.svg)\n\nAfter.\n' > "$R/work/$name"; rm -f "$R/out/$name".{shown,enter}.json
    app 60 MDVIEW_PROBE="$D/probe-board-enter.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.shown.json || -f $R/out/$name.enter.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-enter.png"
    for _ in $(seq 300); do [[ -f $R/out/$name.enter.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.enter.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.enter.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  svgedit)
    # the code of a picture of svg, edited in its dialog
    name=svgedit.md; rm -rf "$R/work"; mkdir -p "$R/work"; { printf '# Svg\n\nText.\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400">\n'; for i in $(seq 0 24); do printf '  <rect x="20" y="%s" width="360" height="16" fill="teal" opacity="0.%s"/>\n' $((i*24)) $((30 + i*2)); done; printf '</svg>\n```\n\nBetween.\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300">'; for i in $(seq 0 30); do printf '<circle cx="%s" cy="60" r="4" fill="teal"/>' $((i*9+10)); done; printf '</svg>\n```\n\nEnd.\n'; } > "$R/work/$name"; rm -f "$R/out/$name".{dlg0,dlg1,svgedit}.json
    app 60 MDVIEW_PROBE="$D/probe-svgedit.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in dlg0 dlg1; do for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.svgedit.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/svgedit-$v.png"; done
    for _ in $(seq 300); do [[ -f $R/out/$name.svgedit.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.svgedit.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.svgedit.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  dropstay)
    # a block moved by its handle in a long note: the note stays where it is, only what was moved is selected
    name=drop.md; rm -rf "$R/work"; mkdir -p "$R/work"; { printf '# Drop\n\n'; for i in $(seq 40); do printf 'Filler paragraph %s with some words to make the page long enough to scroll.\n\n' "$i"; [[ $i == 30 ]] && printf '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120"><rect width="120" height="60" fill="teal"/></svg>\n```\n\n'; done; printf 'Last.\n'; } > "$R/work/$name"; rm -f "$R/out/$name".dropstay.json
    app 60 MDVIEW_PROBE="$D/probe-dropstay.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 400); do [[ -f $R/out/$name.dropstay.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.dropstay.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.dropstay.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  dragreal)
    # blocks moved with a real pointer (dev/vptr): what the browser does by itself with a held button is in this check
    V="$R/vptr"; [[ -x $V && $V -nt $D/vptr/vptr.c ]] || { (cd "$D/vptr" && wayland-scanner client-header wlr-virtual-pointer-unstable-v1.xml "$R/vp.h" && wayland-scanner private-code wlr-virtual-pointer-unstable-v1.xml "$R/vp.c" && cc -O1 -I"$R" -o "$V" vptr.c "$R/vp.c" $(pkg-config --cflags --libs wayland-client)) || { echo "vptr not built"; exit 1; }; }
    name=drop.md; rm -rf "$R/work"; mkdir -p "$R/work"; { printf '# Drop\n\n'; for i in $(seq 40); do printf 'Filler paragraph %s with some words to make the page long enough to scroll.\n\n' "$i"; [[ $i == 30 ]] && printf '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120"><rect width="120" height="60" fill="teal"/></svg>\n```\n\n'; done; printf 'Last.\n'; } > "$R/work/$name"; rm -f "$R/out/$name".plan*.json "$R/out/$name".dragreal.json
    app 90 MDVIEW_PROBE="$D/probe-dragreal.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1
    for _ in $(seq 900); do
      [[ -f $R/out/$name.dragreal.json ]] && break
      if [[ -f $R/out/$name.plan$n.json ]]; then sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$R/out/$name.plan$n.json"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; n=$((n + 1)); else sleep 0.1; fi
    done
    shot "$R/out/dragreal.png"
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.dragreal.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.dragreal.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  colwidth)
    V="$R/vptr"; [[ -x $V ]] || { echo "run rig.sh railfav or dragreal once (it builds vptr)"; exit 1; }
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/*.plan*.json "$R/out"/*.colwidth.json
    printf '%s\n' '# Table' '' 'Some text.' '' '| Name | Qty | Note |' '|------|-----|------|' '| apple | 3 | red and round |' '| pear | 5 | green |' '' 'End.' > "$R/work/t.md"
    app 60 MDVIEW_PROBE="$D/probe-colwidth.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/t.md"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1
    for _ in $(seq 600); do
      [[ -n $(ls "$R/out"/*.colwidth.json 2>/dev/null) ]] && break
      P=$(ls "$R/out"/*.plan$n.json 2>/dev/null | head -1)
      if [[ -n $P ]]; then sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$P"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; n=$((n + 1)); else sleep 0.1; fi
    done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.colwidth.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  icons)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N/Finanzen"; rm -f "$R/out"/*.chosen.json "$R/out"/*.again.json "$R/out"/*.shown.json
    printf '# Alpha\n' > "$N/Alpha.md"; printf '# Konto\n' > "$N/Finanzen/Konto.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    fail=0
    app 60 MDVIEW_PROBE="$D/probe-icons.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 300); do [[ -n $(ls "$R/out"/*.shown.json "$R/out"/*.chosen.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/icons.png"
    for _ in $(seq 300); do ls "$R/out"/*.chosen.json >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.3; pkill -f "^$APP" 2>/dev/null; sleep 1.5
    grep -q '"icon": "piggy-bank"' "$N/.mdview/folders.json" 2>/dev/null && echo "ok   the folder's file names the sign" || { echo "FAIL the folder's file names the sign"; fail=1; }
    app 60 MDVIEW_PROBE="$D/probe-icons.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 300); do ls "$R/out"/*.again.json >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.3; pkill -f "^$APP" 2>/dev/null
    for f in "$R/out"/*.chosen.json "$R/out"/*.again.json; do [[ -f $f ]] || { echo "FAIL no report ($f)"; fail=1; continue; }; jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"; jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' && fail=1; done
    exit $fail ;;
  splitscroll)
    V="$R/vptr"; [[ -x $V && $V -nt $D/vptr/vptr.c ]] || { (cd "$D/vptr" && wayland-scanner client-header wlr-virtual-pointer-unstable-v1.xml "$R/vp.h" && wayland-scanner private-code wlr-virtual-pointer-unstable-v1.xml "$R/vp.c" && cc -O1 -I"$R" -o "$V" vptr.c "$R/vp.c" -lwayland-client) || exit 1; }
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.plan*.json "$R/out"/*.splitscroll.json
    { echo '# Main'; for i in $(seq 80); do echo; echo "Paragraph $i of the note in the window, long enough to wrap a little in a half of the window."; done; } > "$N/Main.md"
    { echo '# Beside'; for i in $(seq 80); do echo; echo "Paragraph $i of the note beside it, long enough to wrap a little in a half of the window."; done; } > "$N/Beside.md"
    { printf '%s\n' '---' 'background: cyan' '---' '' '# Ground'; for i in $(seq 80); do echo; echo "Paragraph $i of a note on a ground, long enough to wrap a little in a half of the window."; done; } > "$N/Ground.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 90 MDVIEW_PROBE="$D/probe-splitscroll.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1
    for _ in $(seq 900); do
      [[ -n $(ls "$R/out"/*.splitscroll.json 2>/dev/null) ]] && break
      P=$(ls "$R/out"/*.plan$n.json 2>/dev/null | head -1)
      if [[ -n $P ]]; then sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$P"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; n=$((n + 1)); else sleep 0.1; fi
    done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.splitscroll.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  scrollup)
    # (the page cannot see this one: WebKit painted the controls a frame late. So the screen is filmed while the wheel turns up, and
    # each frame of a control's place is held to the same place at rest, after it)
    V="$R/vptr"; [[ -x $V && $V -nt $D/vptr/vptr.c ]] || { (cd "$D/vptr" && wayland-scanner client-header wlr-virtual-pointer-unstable-v1.xml "$R/vp.h" && wayland-scanner private-code wlr-virtual-pointer-unstable-v1.xml "$R/vp.c" && cc -O1 -I"$R" -o "$V" vptr.c "$R/vp.c" -lwayland-client) || exit 1; }
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.plan*.json "$R/out"/*.scrollup.json "$R"/film-*.mp4
    { echo '# Long'; for i in $(seq 200); do echo; echo "Paragraph $i of a long note, long enough to wrap a little in the window, with **bold** and a [link](https://example.com)."; [[ $((i % 20)) == 0 ]] && { echo; echo "## Section $i"; }; done; } > "$N/Long.md"
    { printf '%s\n' '---' 'background: cyan' '---' '' '# Ground'; for i in $(seq 200); do echo; echo "Paragraph $i of a long note on a ground, long enough to wrap a little in the window."; done; } > "$N/Ground.md"
    echo '# Other' > "$N/Other.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 150 MDVIEW_PROBE="$D/probe-scrollup.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1; films=()
    for _ in $(seq 1500); do
      [[ -n $(ls "$R/out"/*.scrollup.json 2>/dev/null) ]] && break
      P=$(ls "$R/out"/*.plan$n.json 2>/dev/null | head -1)
      if [[ -n $P ]]; then
        sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$P")
        if [[ $(jq -r '.film // empty' "$P") ]]; then
          F="$R/film-$n.mp4"; WAYLAND_DISPLAY="$(wl)" wf-recorder -f "$F" -r 60 >/dev/null 2>&1 & rec=$!; sleep 1.2
          WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; sleep 1; kill -INT $rec; wait $rec; films+=("$P|$F")
        else WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; fi
        n=$((n + 1))
      else sleep 0.1; fi
    done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.scrollup.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    fail=0
    for pf in "${films[@]}"; do
      P=${pf%%|*}; F=${pf#*|}; label=$(jq -r '.film' "$P"); bad=()
      IFS=, read -r FW FH < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$F")
      while read -r name x y w h; do
        (( w = x + w > FW ? FW - x : w, h = y + h > FH ? FH - y : h ))
        mapfile -t ys < <(ffmpeg -v error -i "$F" -vf "crop=$w:$h:$x:$y,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - | sed -n 's/.*YAVG=//p')
        (( ${#ys[@]} > 30 )) || { bad+=("$name: no film"); continue; }
        k=$(printf '%s\n' "${ys[@]}" | awk -v r="${ys[-1]}" '{ d = $1 - r; if (d < 0) d = -d; if (d > 3) n++ } END { print n + 0 }')
        (( k == 0 )) || bad+=("$name: $k of ${#ys[@]} frames not as at rest")
      done < <(jq -r '.regions[] | "\(.name) \(.box | map(tostring) | join(" "))"' "$P")
      if (( ${#bad[@]} )); then echo "FAIL $label, the wheel up: the controls stay in every frame  ${bad[*]}"; fail=1; else echo "ok   $label, the wheel up: the controls stay in every frame ($(jq '.regions | length' "$P") of them)"; fi
    done
    (( ${#films[@]} == 4 )) || { echo "FAIL four films, not ${#films[@]}"; fail=1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' && fail=1
    exit $fail ;;
  ovswitch)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.ovswitch.json "$R/out"/*.skel.json
    for d in $(seq 12); do mkdir -p "$N/Folder $d"; for i in $(seq 22); do { echo "# Note $d.$i"; echo; for k in $(seq 6); do echo "Some words of note $d.$i, paragraph $k, with **bold** and a [link](https://example.com)."; echo; done; echo '$$x^2 + y^2 = z^2$$'; } > "$N/Folder $d/Note $i.md"; done; done
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 90 MDVIEW_PROBE="$D/probe-ovswitch.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 300); do [[ -n $(ls "$R/out"/*.skel.json "$R/out"/*.ovswitch.json 2>/dev/null) ]] && break; sleep 0.05; done; ls "$R/out"/*.skel.json >/dev/null 2>&1 && shot "$R/out/ovswitch-skeleton.png"
    for _ in $(seq 600); do ls "$R/out"/*.ovswitch.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.ovswitch.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .), "times " + (.times | tostring)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  switching)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N"; rm -f "$R/out"/*.switching.json "$R/out"/*.fade?.json
    for c in Cyan Magenta; do { printf '%s\n' '---' "background: ${c,,}" '---' '' "# $c"; for i in $(seq 30); do echo; echo "Paragraph $i of a note on a ${c,,} ground."; done; } > "$N/$c.md"; done
    { echo '# Plain'; for i in $(seq 30); do echo; echo "Paragraph $i of a note without a ground."; done; } > "$N/Plain.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 90 MDVIEW_PROBE="$D/probe-switching.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for k in 1 2 3; do for _ in $(seq 300); do [[ -n $(ls "$R/out"/*.fade$k.json "$R/out"/*.switching.json 2>/dev/null) ]] && break; sleep 0.03; done; shot "$R/out/switching-$k.png"; done
    for _ in $(seq 300); do ls "$R/out"/*.switching.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.switching.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  navigate)
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N/Projects"; rm -f "$R/out"/*.navigate.json
    printf '# Inbox\n\nSome text.\n' > "$N/Inbox.md"; printf '# Plan\n\nThe plan.\n' > "$N/Projects/Plan.md"; printf '# Other\n\nMore.\n' > "$N/Projects/Other.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 90 MDVIEW_PROBE="$D/probe-navigate.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    for _ in $(seq 400); do ls "$R/out"/*.navigate.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.navigate.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  railfav)
    V="$R/vptr"; [[ -x $V && $V -nt $D/vptr/vptr.c ]] || { (cd "$D/vptr" && wayland-scanner client-header wlr-virtual-pointer-unstable-v1.xml "$R/vp.h" && wayland-scanner private-code wlr-virtual-pointer-unstable-v1.xml "$R/vp.c" && cc -O1 -I"$R" -o "$V" vptr.c "$R/vp.c" $(pkg-config --cflags --libs wayland-client)) || { echo "vptr not built"; exit 1; }; }
    rm -rf "$R/work"; N="$R/work/notes"; mkdir -p "$N/Studium" "$N/Projekte"; rm -f "$R/out"/*.plan*.json "$R/out"/*.railfav.json
    printf '# Alpha\n\nText.\n' > "$N/Alpha.md"; printf '# Thermo\n' > "$N/Studium/Thermo.md"; printf '# Plan\n' > "$N/Projekte/Plan.md"
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    app 60 MDVIEW_PROBE="$D/probe-railfav.js" MDVIEW_PROBE_OUT="$R/out" -- "$N"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1
    for _ in $(seq 600); do
      [[ -n $(ls "$R/out"/*.railfav.json 2>/dev/null) ]] && break
      P=$(ls "$R/out"/*.plan$n.json 2>/dev/null | head -1)
      if [[ -n $P ]]; then sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$P"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; n=$((n + 1)); else sleep 0.1; fi
    done
    shot "$R/out/railfav.png"
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.railfav.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$f" | grep -q '^FAIL' ;;
  newnote)
    # New Note without the window that asked for a name, on a copy of the overview's notes
    rm -rf "$R/work"; mkdir -p "$R/work"; cp -r "$D/tests/overview-notes" "$R/work/Notes"; rm -f "$R/out"/*.newnote.json
    app 90 MDVIEW_PROBE="$D/probe-newnote.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/Notes"
    for _ in $(seq 900); do ls "$R/out"/*.newnote.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    f=$(ls "$R/out"/*.newnote.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$f"
    for n in "Untitled.md" "Projektplan.md" "Idee zwei.md" "Workout routine.md"; do [[ -f "$R/work/Notes/$n" ]] && echo "ok   on disk: $n" || echo "FAIL not on disk: $n"; done
    { jq -r '.steps[], (.error // empty)' "$f"; for n in "Untitled.md" "Projektplan.md" "Idee zwei.md" "Workout routine.md"; do [[ -f "$R/work/Notes/$n" ]] || echo FAIL; done; } | grep -qv '^ok' && exit 1; exit 0 ;;
  fileundo)
    # what was done to the files from All Notes taken back (Ctrl+Z) and done again (Ctrl+Shift+Z), on a copy of the overview's notes
    rm -rf "$R/work" "$R/data/Trash"; mkdir -p "$R/work"; cp -r "$D/tests/overview-notes" "$R/work/Notes"; rm -f "$R/out"/*.fileundo.json
    app 90 MDVIEW_PROBE="$D/probe-fileundo.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/Notes"
    for _ in $(seq 900); do ls "$R/out"/*.fileundo.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    f=$(ls "$R/out"/*.fileundo.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$f"
    ! jq -r '.steps[], (.error // empty)' "$f" | grep -qv '^ok' ;;
  slides)
    # a presentation in a folder: its tile (the first slide), the PDF viewer (a page a slide), one that cannot be read — needs LibreOffice
    command -v soffice >/dev/null || { echo "FAIL LibreOffice (soffice) is not installed"; exit 1; }
    rm -rf "$R/work" "$R/cache/mdview/slides"; mkdir -p "$R/work/Slides"; rm -f "$R/out"/*.slides.json "$R/out"/*.shot-*.json "$R/out"/slides-*.png
    printf '# Note\n\nBeside a presentation.\n' > "$R/work/Slides/Note.md"; printf 'PK\x03\x04not a presentation' > "$R/work/Slides/Broken.pptx"
    python3 "$D/gen-slides.py" "$R/deck.fodp" 12 && soffice -env:UserInstallation=file://$R/lo --headless --convert-to pptx --outdir "$R" "$R/deck.fodp" >/dev/null 2>&1 && cp "$R/deck.pptx" "$R/work/Slides/Deck.pptx"
    [[ -f $R/work/Slides/Deck.pptx ]] || { echo "FAIL no presentation made"; exit 1; }
    app 180 MDVIEW_PROBE="$D/probe-slides.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/Slides"
    for v in tile viewer; do
      for _ in $(seq 900); do [[ -n $(ls "$R/out"/*.shot-$v.json "$R"/out/*.slides.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.5; shot "$R/out/slides-$v.png"
    done
    for _ in $(seq 900); do ls "$R/out"/*.slides.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.slides.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$f"
    ok=$(ls "$R/cache/mdview/slides"/*.pdf 2>/dev/null | wc -l); [[ $ok == 1 ]] && echo "ok   the PDF made of it is kept in the cache (one: the broken one has none)" || echo "FAIL PDFs in the cache: $ok"
    ! { jq -r '.steps[], (.error // empty)' "$f"; [[ $ok == 1 ]] || echo FAIL; } | grep -qv '^ok' ;;
  tiledrag)
    # a tile of All Notes held by a real pointer (dev/vptr): the picture that goes with the pointer is the tile's, at the tile's size
    V="$R/vptr"; [[ -x $V ]] || { echo "run rig.sh dragreal once (it builds vptr)"; exit 1; }
    rm -rf "$R/work"; mkdir -p "$R/work"; cp -r "$D/tests/overview-notes" "$R/work/Notes"; rm -f "$R/out"/*.plan?.json "$R/out"/*.tiledrag.json
    { echo "window.__to = '${TO:-room}';"; cat "$D/probe-tiledrag.js"; } > "$R/probe-tiledrag.js" # (TO=sidebar: held over the sidebar)
    app 60 MDVIEW_PROBE="$R/probe-tiledrag.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/Notes"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    for _ in $(seq 300); do P=$(ls "$R/out"/*.plan1.json 2>/dev/null | head -1); [[ -n $P ]] && break; sleep 0.1; done
    read -r -a cmd < <(jq -r '.cmd' "$P"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"
    for _ in $(seq 300); do P=$(ls "$R/out"/*.plan2.json 2>/dev/null | head -1); [[ -n $P ]] && break; sleep 0.1; done
    read -r -a cmd < <(jq -r '.cmd' "$P"); read -r AX AY TW TH HX HY < <(jq -r '"\(.at[0]) \(.at[1]) \(.tile[0]) \(.tile[1]) \(.hold[0]) \(.hold[1])"' "$P")
    WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" m "$HX" "$HY"; sleep 0.4; shot "$R/out/tiledrag-before.png"
    WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}" & sleep 2.2; shot "$R/out/tiledrag-held.png"; wait
    for _ in $(seq 100); do ls "$R/out"/*.tiledrag.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    # the picture held by the pointer (taken by the tile's middle) against the tile where it stood: the same picture, at the same size
    K=$(echo "$(magick identify -format '%w' "$R/out/tiledrag-held.png") / $MW" | bc -l)
    box() { printf '%.0fx%.0f+%.0f+%.0f' "$(echo "$TW * $K" | bc)" "$(echo "$TH * $K" | bc)" "$(echo "$1 * $K" | bc)" "$(echo "$2 * $K" | bc)"; }
    magick "$R/out/tiledrag-before.png" -crop "$(box "$AX" "$AY")" +repage "$R/out/tiledrag-tile.png"
    magick "$R/out/tiledrag-held.png" -crop "$(box "$(echo "$HX - $TW / 2" | bc -l)" "$(echo "$HY - $TH / 2" | bc -l)")" +repage "$R/out/tiledrag-ghost.png"
    apart=$(magick compare -metric RMSE "$R/out/tiledrag-tile.png" "$R/out/tiledrag-ghost.png" null: 2>&1 | sed 's/.*(\(.*\)).*/\1/')
    lim=0.08; [[ ${TO:-} == sidebar ]] && lim=0.10 # (over the sidebar the ground behind the picture is the sidebar's, not the page's)
    printf 'the picture at the pointer is %.3f apart from the tile (the same picture: under %s)\n' "$apart" "$lim"
    f=$(ls "$R/out"/*.tiledrag.json 2>/dev/null | head -1); [[ -n $f ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$f"
    ! jq -r '.steps[], (.error // empty)' "$f" | grep -q '^FAIL\|Error' && (( $(echo "$apart < $lim" | bc -l) )) ;;
  dragnote)
    # blocks moved with a real pointer in a copy of a real note (NOTE=… its file; pictures beside it go along): columns, svg, formulas, a board
    V="$R/vptr"; [[ -x $V ]] || { echo "run rig.sh dragreal once (it builds vptr)"; exit 1; }
    src="${NOTE:-$HOME/Documents/Notizen/Test Neu.md}"; name=note.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$src" "$R/work/$name"; for f in "$(dirname "$src")"/*.board.svg "$(dirname "$src")"/assets; do [[ -e $f ]] && cp -r "$f" "$R/work/" 2>/dev/null; done; rm -f "$R/out/$name".plan*.json "$R/out/$name".dragnote.json "$R/out/$name".shot-*.json
    { echo "window.__seed = ${SEED:-7}; window.__n = ${N:-14};"; cat "$D/probe-dragnote.js"; } > "$R/probe-dragnote.js"
    find "$(dirname "$src")" -maxdepth 3 -name "*.board.svg" -exec cp -n {} "$R/work/" \; 2>/dev/null # (the boards the note shows, wherever under its folder they are kept)
    sed -i -E 's/!\[\[([^]|]*\.board\.svg)\]\]/![Whiteboard](\1)/' "$R/work/$name" # (a note by itself resolves no [[embeds]]: the board as a picture beside it)
    app 240 MDVIEW_PROBE="$R/probe-dragnote.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    read -r MW MH < <(hyprctl -i "$(sig)" monitors -j | jq -r '.[0] | "\(.width) \(.height)"')
    n=1; rm -f "$R/out"/dragnote-*.png
    for _ in $(seq 2400); do
      [[ -f $R/out/$name.dragnote.json ]] && break
      for sf in "$R/out/$name".shot-*.json; do [[ -f $sf ]] && { b=$(basename "$sf" .json); shot "$R/out/dragnote-${b##*.shot-}.png"; rm -f "$sf"; }; done
      if [[ -f $R/out/$name.plan$n.json ]]; then sleep 0.15; read -r -a cmd < <(jq -r '.cmd' "$R/out/$name.plan$n.json"); WAYLAND_DISPLAY="$(wl)" "$V" "$MW" "$MH" "${cmd[@]}"; n=$((n + 1)); else sleep 0.1; fi
    done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.dragnote.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.dragnote.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  ai-subpage)
    # the real Claude writes into a subpage, asked from the note (the chat's Edit mode)
    name=look.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Look\n\nText before.\n\n<!-- page: Alpha -->\n\nIn alpha.\n\n<!-- /page -->\n\nText after the first.\n\n<!-- page: Beta -->\n\nIn beta.\n\n<!-- /page -->\n' > "$R/work/$name"; rm -f "$R/out/$name".{shot,ai-subpage}.json
    app 400 MDVIEW_PROBE="$D/probe-ai-subpage.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 3600); do [[ -f $R/out/$name.shot.json || -f $R/out/$name.ai-subpage.json ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/ai-subpage.png"
    for _ in $(seq 600); do [[ -f $R/out/$name.ai-subpage.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.ai-subpage.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.ai-subpage.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  pagenav)
    # back and forward among the pages of a note
    name=pages.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Pages\n\nText.\n\n<!-- page: Alpha -->\n\nIn alpha.\n\n<!-- page: Inner -->\n\nDeep.\n\n<!-- /page -->\n\n<!-- /page -->\n\n<!-- page: Beta -->\n\nIn beta.\n\n<!-- /page -->\n' > "$R/work/$name"; for i in $(seq 40); do printf '\nFiller paragraph %s with some words to make the note long.\n' "$i" >> "$R/work/$name"; done; printf '\n<!-- page: Far -->\n\nFar down.\n\n<!-- /page -->\n\nAfter it.\n' >> "$R/work/$name"; rm -f "$R/out/$name".{deep,root,pagenav}.json
    app 60 MDVIEW_PROBE="$D/probe-pagenav.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in deep root; do for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.pagenav.json ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/pagenav-$v.png"; done
    for _ in $(seq 300); do [[ -f $R/out/$name.pagenav.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.pagenav.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.pagenav.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  start-page)
    # the app started by itself (nothing opened before): a folder or a file, offered in the window; and a note by itself has the way to its folder
    name=m5.md; rm -rf "$R/work" "$R/state-fresh"; mkdir -p "$R/work/sub"; cp "$D/tests/fixtures/$name" "$R/work/$name"; echo '# Other' > "$R/work/Other.md"; echo '# Deep' > "$R/work/sub/Deep.md"; rm -f "$R/out/"{none,$name}.{bare,note,start}.json
    app 40 MDVIEW_PROBE="$D/probe-start.js" MDVIEW_PROBE_OUT="$R/out" XDG_STATE_HOME="$R/state-fresh" --
    for _ in $(seq 300); do [[ -f $R/out/none.start.json ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/start-bare.png"
    pkill -f "^$APP" 2>/dev/null; sleep 0.5
    app 40 MDVIEW_PROBE="$D/probe-start.js" MDVIEW_PROBE_OUT="$R/out" XDG_STATE_HOME="$R/state-fresh" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.start.json ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/start-note.png"
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/none.start.json && -f $R/out/$name.start.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/none.start.json" "$R/out/$name.start.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  ai)
    # AI in the app: Transform with AI, the chat, and all of it gone when turned off (Claude is a fixed answer)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; printf '# Other\n\nother note text\n' > "$R/work/other.md"; rm -f "$R/out/$name".{transform,chat,menu,edit,ai}.json
    if [[ ${2:-} == real || ${2:-} == draw || ${2:-} == edit ]]; then { echo 'window.__aiReal = true;'; [[ $2 == draw ]] && echo 'window.__aiDraw = true;'; [[ $2 == edit ]] && echo 'window.__aiEdit = true;'; cat "$D/probe-ai.js"; } > "$R/probe-ai-real.js"; app 400 MDVIEW_PROBE="$R/probe-ai-real.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"; else
    app 200 MDVIEW_PROBE="$D/probe-ai.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_TALK_FAKE="$(cat "$D/tests/ai/fake.txt")" -- "$R/work/$name"; fi
    for v in transform chat menu edit; do for _ in $(seq 3600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.ai.json ]] && break; sleep 0.1; done; sleep 0.5; shot "$R/out/ai-$v.png"; done
    for _ in $(seq 3600); do [[ -f $R/out/$name.ai.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.ai.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.ai.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  board-graphic)
    # a whiteboard drawn clean by Claude (the model is a fixed figure)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{drawn,inserted,board-graphic}.json
    if [[ ${2:-} == real ]]; then { echo 'window.__graphicReal = true;'; cat "$D/probe-board-graphic.js"; } > "$R/probe-board-graphic-real.js"; app 300 MDVIEW_PROBE="$R/probe-board-graphic-real.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"; else
    app 90 MDVIEW_PROBE="$D/probe-board-graphic.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_GRAPHIC_FAKE='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80" width="200" height="80"><script>alert(1)</script><rect x="8" y="8" width="184" height="64" rx="8" fill="none" stroke="#1d1d1f" stroke-width="1.6" onclick="x()"/><text x="100" y="46" text-anchor="middle" font-size="14">TAG</text></svg>' -- "$R/work/$name"; fi
    for v in drawn inserted; do for _ in $(seq 2600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-graphic.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/board-graphic-$v.png"; done
    for _ in $(seq 400); do [[ -f $R/out/$name.board-graphic.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-graphic.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.board-graphic.json" | tee /dev/stderr | grep -q '^FAIL\|Error' ;;
  board-more)
    # the rest of the whiteboard's tools: pencil, ruler, the palette at the other edge, cards, a picture cut, a look kept for new items
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work/outside"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{ruler,more,board-more}.json
    magick -size 240x120 xc:'#1f6fe5' "$R/work/outside/photo.png"; printf '%%PDF-1.4\n%%%%EOF\n' > "$R/work/outside/Lecture notes.pdf"; echo '# other' > "$R/work/outside/other.md"
    app 120 MDVIEW_PROBE="$D/probe-board-more.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in ruler more; do for _ in $(seq 800); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board-more.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-more-$v.png"; done
    for _ in $(seq 600); do [[ -f $R/out/$name.board-more.json ]] && break; sleep 0.1; done
    sleep 0.5; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.board-more.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.board-more.json"
    [[ -f "$R/work/assets/Lecture notes.pdf" && ! -e "$R/work/assets/other.md" ]] && echo "ok   the dropped PDF is kept beside the board, the note is not" || echo "FAIL the dropped files: $(ls "$R/work/assets" | tr '\n' ' ')"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.board-more.json"; } | grep -qv '^ok' ;;
  ghostmath)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".ghostmath.json
    app 60 MDVIEW_PROBE="$D/probe-ghostmath.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_AI_FAKE=" b\$ is known." -- "$R/work/$name"
    for _ in $(seq 400); do [[ -f $R/out/$name.ghostmath.json ]] && break; sleep 0.1; done; pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    [[ -f $R/out/$name.ghostmath.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.ghostmath.json"
    ! jq -r '.steps[], (.error // "ok")' "$R/out/$name.ghostmath.json" | grep -qv '^ok' ;;
  ghost)
    # the continuation offered while typing; `dev/rig.sh ghost real` asks the real model (the key in ~/.config/mdview/.env)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{shown,ghost}.json
    if [[ ${2:-} == real ]]; then
      { echo 'window.__ghostReal = true;'; cat "$D/probe-ghost.js"; } > "$R/probe-ghost-real.js"
      app 60 MDVIEW_PROBE="$R/probe-ghost-real.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    else
      app 60 MDVIEW_PROBE="$D/probe-ghost.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_AI_FAKE=" a good day for writing." -- "$R/work/$name"
    fi
    for _ in $(seq 300); do [[ -f $R/out/$name.shown.json || -f $R/out/$name.ghost.json ]] && break; sleep 0.1; done; sleep 0.5; shot "$R/out/ghost.png"
    for _ in $(seq 400); do [[ -f $R/out/$name.ghost.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.ghost.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty), (if .real then "the model said: \(.real.suggestion|tojson) after \(.real.ms) ms (incl. the 75 ms pause)" else empty end)' "$R/out/$name.ghost.json"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.ghost.json"; } | grep -qv '^ok' ;;
  captions)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/note.md.*.json
    magick -size 240x80 gradient:red-blue "$R/work/pic.png"
    printf '%s\n' '# Captions' '' 'A paragraph.' '' '![](pic.png)' ': A gradient' '' '```js' 'const a = 1;' '```' ': The first line' '' '$$' 'e^{i\pi} + 1 = 0' '$$' '' 'End' > "$R/work/note.md"
    app 60 MDVIEW_PROBE="$D/probe-captions.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/note.md"
    for v in read active; do for _ in $(seq 300); do [[ -f $R/out/note.md.$v.json || -f $R/out/note.md.captions.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/captions-$v.png"; done
    for _ in $(seq 300); do [[ -f $R/out/note.md.captions.json ]] && break; sleep 0.1; done
    sleep 0.3; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/note.md.captions.json ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/note.md.captions.json"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/note.md.captions.json" | grep -q '^FAIL' ;;
  turn)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/note.md.*.json
    magick -size 120x40 gradient:red-blue "$R/work/wide.png"
    printf '%s\n' '# Turned' '' 'A picture in the text ![wide](wide.png) here.' '' '![own|r90](wide.png)' '' '![sized|r180|240](wide.png)' '' '![[wide.png|r270]]' > "$R/work/note.md"
    app 90 MDVIEW_PROBE="$D/probe-turn.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/note.md"
    for v in read active; do for _ in $(seq 300); do [[ -f $R/out/note.md.$v.json || -f $R/out/note.md.turn.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/turn-$v.png"; done
    for _ in $(seq 400); do [[ -f $R/out/note.md.turn.json ]] && break; sleep 0.1; done
    sleep 0.3; pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/note.md.turn.json ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/note.md.turn.json"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/note.md.turn.json" | grep -q '^FAIL' ;;
  pdfink)
    # a PDF by itself, drawn on; then the app anew, and what was drawn rubbed out
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/paper.pdf.*.json
    python3 "$D/gen-pdf.py" "$R/work/paper.pdf" 6
    was=$(sha256sum < "$R/work/paper.pdf"); fail=0
    report() { # report NAME: the probe's steps, or that there are none
      for _ in $(seq 700); do [[ -f $R/out/paper.pdf.$1.json ]] && break; sleep 0.1; done
      sleep 0.3; pkill -f "^$APP" 2>/dev/null; sleep 1.5
      [[ -f $R/out/paper.pdf.$1.json ]] || { echo "FAIL no report ($1)"; tail -5 "$R/app.log"; fail=1; return; }
      jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/paper.pdf.$1.json"
    }
    check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
    app 90 MDVIEW_PROBE="$D/probe-pdfink.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/paper.pdf"
    for v in open far large; do for _ in $(seq 300); do [[ -f $R/out/paper.pdf.$v.json || -f $R/out/paper.pdf.drawn.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/pdfink-$v.png"; done
    report drawn
    f=$(ls "$R/work/.mdview/pdf/"*.board.svg 2>/dev/null | head -1)
    check "what was drawn is a whiteboard's file in the folder's .mdview/pdf" '[[ -n $f ]] && grep -q "mdview-board" "$f"'
    check "… named as Git names the PDF's bytes" '[[ $(basename "${f:-x}") == "$(git hash-object "$R/work/paper.pdf").board.svg" ]]'
    check "the PDF itself is as it was" '[[ $(sha256sum < "$R/work/paper.pdf") == "$was" ]]'
    app 90 MDVIEW_PROBE="$D/probe-pdfink.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/paper.pdf"
    for _ in $(seq 300); do [[ -f $R/out/paper.pdf.shown.json || -f $R/out/paper.pdf.again.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/pdfink-shown.png"
    report again
    check "rubbed out: no file is kept, and no folder for it" '[[ ! -e $R/work/.mdview ]]'
    check "the PDF itself is still as it was" '[[ $(sha256sum < "$R/work/paper.pdf") == "$was" ]]'
    grep -q '^FAIL' <(jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out"/paper.pdf.{drawn,again}.json 2>/dev/null) && fail=1
    exit $fail ;;
  pdflag)
    # how late what is drawn on a PDF shows: a bare page, quick work, a page written full, far in
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/paper.pdf.lag.json
    python3 "$D/gen-pdf.py" "$R/work/paper.pdf" 6
    app 120 MDVIEW_PROBE="$D/probe-pdflag.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/paper.pdf"
    for _ in $(seq 900); do [[ -f $R/out/paper.pdf.lag.json ]] && break; sleep 0.1; done
    sleep 0.3; pkill -f "^$APP" 2>/dev/null; sleep 1
    [[ -f $R/out/paper.pdf.lag.json ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/paper.pdf.lag.json"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/paper.pdf.lag.json" | grep -q '^FAIL' ;;
  pdf)
    # a note with links into a PDF and embeds of it, and the PDF itself in the window
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/note.md.*.json "$R/out"/paper.pdf.*.json
    python3 "$D/gen-pdf.py" "$R/work/paper.pdf" 6
    printf '%s\n' '# Notes on the paper' '' 'The page: ![[paper.pdf#page=1]]' '' 'A quote: ![[paper.pdf#page=2&selection=4,0,4,30&color=red]]' '' 'A region: ![[paper.pdf#page=3&rect=60,600,420,790]]' '' \
      'An important line: [[paper.pdf#page=2&selection=4,0,4,30&color=red|paper, page 2]] says it.' '' '> [!PDF|yellow] [[paper.pdf#page=2&selection=9,0,9,18|paper, page 2]]' '> Line 10 of page 2' '' 'Just the page: [[paper.pdf#page=5]].' > "$R/work/note.md"
    app 90 MDVIEW_PROBE="$D/probe-pdf.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/note.md"
    wait_for() { for _ in $(seq 400); do ls "$R/out"/*."$1".json >/dev/null 2>&1 && return 0; sleep 0.1; done; return 1; }
    wait_for note && { sleep 1.6; shot "$R/out/pdf-note.png"; }
    wait_for pdf && { sleep 0.15; shot "$R/out/pdf-view0.png"; sleep 0.4; shot "$R/out/pdf-view.png"; }
    copied=""
    wait_for select && { sleep 0.4; WAYLAND_DISPLAY="$(wl)" wtype -M ctrl -M shift -k c -m shift -m ctrl; sleep 0.8; copied=$(WAYLAND_DISPLAY="$(wl)" timeout 3 wl-paste -n 2>/dev/null); }
    wait_for noteagain && { sleep 0.6; shot "$R/out/pdf-note2.png"; }
    wait_for pdfdone
    pkill -f "^$APP" 2>/dev/null
    f=$(ls "$R/out"/*.pdfdone.json 2>/dev/null | head -1)
    [[ -n $f ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty), (.errs | join("; "))' "$f"
    want=$'> [!PDF|yellow] [[paper.pdf#page=2&selection=7,5,7,21|paper, page 2]]\n> '
    [[ $copied == "$want"* ]] && echo "ok   Ctrl+Shift+C: the quote with its link is on the clipboard" || echo "FAIL the clipboard after Ctrl+Shift+C: $copied"
    ! { jq -r '.steps[], (.error // "ok")' "$f"; } | grep -qv '^ok' ;;
  wikiroot)
    # (Henri's DreamChip notes: risc-v/tracing/06 E-Trace Spec.md, the PDFs in assets/risc-v/; above them a vault, or a repository's top)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/*.wikiroot.json; fails=0
    run() { # run DIR NOTE (relative to DIR)
      rm -f "$R/out"/*.wikiroot.json
      app 90 MDVIEW_PROBE="$D/probe-wikiroot.js" MDVIEW_PROBE_OUT="$R/out" -- "$1/$2"
      for _ in $(seq 600); do ls "$R/out"/*.wikiroot.json >/dev/null 2>&1 && break; sleep 0.1; done
      pkill -f "^$APP" 2>/dev/null
      local f; f=$(ls "$R/out"/*.wikiroot.json 2>/dev/null | head -1)
      [[ -n $f ]] || { echo "FAIL $3: no report"; tail -5 "$R/app.log"; fails=1; return; }
      jq -r --arg w "$3" '(.steps[] | sub("^(?<s>ok   |FAIL )"; "\(.s)\($w): ")), (.error // empty)' "$f"
      jq -r '.steps[], (.error // empty)' "$f" | grep -qv '^ok' && fails=1
    }
    if [[ -n ${2:-} ]]; then
      cp -r "$2" "$R/work/doc"; run "$R/work/doc" "$3" "$(basename "$2")"
    else
      doc="$R/work/vault/doc"; mkdir -p "$R/work/vault/.obsidian" "$doc/risc-v/tracing" "$doc/assets/risc-v" "$doc/other"; echo '{}' > "$R/work/vault/.obsidian/app.json"
      python3 "$D/gen-pdf.py" "$doc/assets/risc-v/risc-v-e-trace-spec.pdf" 40
      printf '%s\n' '# E-Trace' '' 'See [[risc-v-e-trace-spec.pdf#page=35|Spec, S. 25]] and [[00 Übersicht]], [[Elsewhere]].' '' \
        '![[risc-v-e-trace-spec.pdf#page=12&rect=76,65,557,363]]' '' '![[risc-v-e-trace-spec.pdf#page=3]]' > "$doc/risc-v/tracing/06 E-Trace Spec.md"
      printf '# Overview\n\n[[06 E-Trace Spec]]\n' > "$doc/risc-v/tracing/00 Übersicht.md"; printf '# Elsewhere\n' > "$doc/other/Elsewhere.md"
      run "$doc" "risc-v/tracing/06 E-Trace Spec.md" "in a vault"
      rm -rf "$R/work/vault/.obsidian"; mkdir -p "$doc/.git"
      run "$doc" "risc-v/tracing/06 E-Trace Spec.md" "in a repository"
    fi
    [[ $fails == 0 ]] ;;
  mathtext)
    # LaTeX Suite in the text, between dollars, with real keys (wtype); the probe is latex's (it reports the document per stage)
    name=latex.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Formulas\n\nStart.\n' > "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 90 MDVIEW_PROBE="$D/probe-latex.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    keys() { WAYLAND_DISPLAY="$(wl)" wtype -d 45 "$@"; }
    stage() { for _ in $(seq 300); do [[ -f $R/out/$name.ready-$1.json ]] && break; sleep 0.1; done; sleep 0.25; }
    stage s1; keys ' Then $xsr + @a'                                   # snippets while the formula is still open
    stage s2; keys '$'; sleep 0.3; keys ' and $(a/b'                    # closed by hand: a formula; the next one: a fraction in brackets
    stage s3; keys -k Tab; keys -k Tab; keys -k Tab; sleep 0.3; keys ' end.'   # out of the fraction, the brackets, the formula (its dollar is written)
    stage s4; keys ' It is *not* $a*b*c$ here.'                        # no italics inside a formula
    stage s5; keys ' Sum $\sum'; keys -k Tab; keys 'k'; keys -k Tab; keys '0'; keys -k Tab; keys 'n'; keys -k Tab; keys 'k'; keys -k Tab; sleep 0.3; keys '.'
    stage s6
    for _ in $(seq 400); do [[ -f $R/out/$name.latex.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.latex.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.stages | to_entries[] | "\(.key): \(.value.md | split("\n")[2])"' "$R/out/$name.latex.json"
    jq -r '(.error // empty), (.errs | join("; "))' "$R/out/$name.latex.json"
    want='Start. Then $x^{2} + \alpha$ and $\left( \frac{a}{b} \right)$ end. It is *not* $a*b*c$ here. Sum $\sum_{k=0}^{n}k$.'
    got=$(jq -r '.saved | split("\n")[2]' "$R/out/$name.latex.json")
    [[ $got == "$want" ]] && echo "ok   LaTeX Suite between dollars in the text: the line is as expected" || { echo "FAIL the line differs:"; echo "  got:  $got"; echo "  want: $want"; }
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.latex.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document" ;;
  latex)
    # real keys (wtype) into the formula editor; the probe reports after each stage
    name=latex.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Formulas\n\nStart.\n' > "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 90 MDVIEW_PROBE="$D/probe-latex.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    keys() { WAYLAND_DISPLAY="$(wl)" wtype -d 45 "$@"; }
    stage() { for _ in $(seq 300); do [[ -f $R/out/$name.ready-$1.json ]] && break; sleep 0.1; done; sleep 0.25; }
    stage s1; keys ' Energy mk'; sleep 0.5; keys 'E = mcsr'                      # a formula in the line; sr -> ^{2}
    stage s2; keys -k Tab; sleep 0.5; keys ' and dm'                               # Tab at the end leaves it; dm: a formula of its own
    stage s3; keys 'pmata'; keys -k Tab; keys 'b'; keys -k Return; keys 'c'; keys -k Tab; keys 'd'   # a matrix: Tab -> &, Enter -> \\
    stage s4; keys -M shift -k Return -m shift; keys ' = (x/y'; sleep 0.4; shot "$R/out/latex-dialog.png"   # out of the matrix; a fraction in brackets
    stage s5; keys -k Tab; keys -k Tab; keys ' + dint'                             # out of the fraction and the brackets; an integral with places to fill
    stage s6; keys -k Tab; keys '@a'; keys -k Tab; keys 'sin @t'; keys -k Tab; keys '@t'; keys -k Tab; keys -k Tab; sleep 0.5; keys 'After.'   # … and out of the formula: on in the line below
    for _ in $(seq 400); do [[ -f $R/out/$name.latex.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.latex.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -c '.stages | to_entries[] | {s: .key, open: .value.open, tex: .value.tex, w: .value.w, colours: .value.colours, stops: .value.stops}' "$R/out/$name.latex.json"
    jq -r '.saved, (.error // empty), (.errs | join("; "))' "$R/out/$name.latex.json"
    want=$'# Formulas\n\nStart. Energy $E = mc^{2}$ and\n\n$$\n\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix} = \\left( \\frac{x}{y} \\right) + \\int_{0}^{\\alpha} \\sin \\theta \\, d\\theta \n$$\n\nAfter.\n'
    [[ "$(jq -j '.saved' "$R/out/$name.latex.json")"$'\n' == "$want"$'\n' || "$(jq -j '.saved' "$R/out/$name.latex.json")" == "${want%$'\n'}" ]] && echo "ok   typed with snippets, tabstops, fraction, matrix keys and tabout: the document is as expected" || { echo "FAIL the document differs from what the keys should give"; printf '%s' "$want"; }
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.latex.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document" ;;
  lists)
    name=lists.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".lists.json
    app 90 MDVIEW_PROBE="$D/probe-lists.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 600); do [[ -f $R/out/$name.lists.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.lists.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.lists.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.lists.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.lists.json"; } | grep -qv '^ok' ;;
  blockpaste)
    rm -rf "$R/work"; mkdir -p "$R/work"; printf 'Alpha\n\nBravo\n\nCharlie\n\n- one\n- two\n' > "$R/work/t.md"; rm -f "$R/out"/t.md.*.json
    app 60 MDVIEW_PROBE="$D/probe-blockpaste.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/t.md"
    w() { for _ in $(seq 200); do [[ -f $R/out/t.md.$1.json || -f $R/out/t.md.blockpaste.json ]] && break; sleep 0.1; done; sleep 0.5; }; k() { WAYLAND_DISPLAY="$(wl)" wtype -d 45 "$@"; }
    w s1; k -M ctrl -k d -m ctrl; w s2; k -M ctrl -k d -m ctrl
    for _ in $(seq 300); do [[ -f $R/out/t.md.blockpaste.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/t.md.blockpaste.json ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/t.md.blockpaste.json"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/t.md.blockpaste.json" | grep -q '^FAIL' ;;
  backspace)
    # Backspace sent as a key from outside (the phone's screen mirror: `wtype -k BackSpace`) takes a letter away, in the active mode and in the source
    rm -rf "$R/work"; mkdir -p "$R/work"; printf 'abc\n\nsecond line\n' > "$R/work/t.md"; rm -f "$R/out"/t.md.*.json
    app 60 MDVIEW_PROBE="$D/probe-backspace.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/t.md"
    w() { for _ in $(seq 300); do [[ -f $R/out/t.md.$1.json || -f $R/out/t.md.backspace.json ]] && break; sleep 0.1; done; sleep 0.5; }; k() { WAYLAND_DISPLAY="$(wl)" wtype -d 45 "$@"; }
    w s1; k -k BackSpace; w s2; k -k BackSpace; w s3; k -k BackSpace; w s4; k -k Left; w s5; k -k Delete; w s6; k -k Home; w s7; k -M shift -k End -m shift
    for _ in $(seq 300); do [[ -f $R/out/t.md.backspace.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/t.md.backspace.json ]] || { echo "FAIL no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/t.md.backspace.json"
    ! jq -r '.steps[], (.error // empty | "FAIL " + .)' "$R/out/t.md.backspace.json" | grep -q '^FAIL' ;;
  blocks)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{selected,heading,blocks}.json
    app 90 MDVIEW_PROBE="$D/probe-blocks.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in selected heading; do for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.blocks.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/blocks-$v.png"; done
    for _ in $(seq 500); do [[ -f $R/out/$name.blocks.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.blocks.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.blocks.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.blocks.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.blocks.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.blocks.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  shots)
    name=shots.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 90 MDVIEW_PROBE="$D/probe-shots.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in form formula completion find blockhandle dropline rowdrag syntax; do
      for _ in $(seq 300); do [[ -f $R/out/$name.shot-$v.json || -f $R/out/$name.shots.json ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/shot-$v.png"; echo "$R/out/shot-$v.png"
    done
    for _ in $(seq 200); do [[ -f $R/out/$name.shots.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    jq -r '.error // "ok"' "$R/out/$name.shots.json" ;;
  more)
    name=more.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{picture,more}.json "$R/out/snapshot.png"
    app 90 MDVIEW_PROBE="$D/probe-more.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 500); do [[ -f $R/out/$name.more.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    [[ -f $R/out/$name.more.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.more.json"
    size=$(magick identify -format '%wx%h' "$R/out/snapshot.png" 2>/dev/null)
    [[ -n $size ]] && echo "ok   the formula's picture: $size" || echo "FAIL no picture of the formula"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.more.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.more.json"; [[ -n $size ]] || echo FAIL; } | grep -qv '^ok' ;;
  dnd)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".dnd.json
    magick -size 20x20 xc:'#e5484d' "$R/drop.png"; echo text > "$R/notes.txt"
    # (MDVIEW_ATTACH_GRACE=0: what was dropped and taken back goes at once here — else it stays for an hour, attach.rs)
    app 90 MDVIEW_PROBE="$D/probe-dnd.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_ATTACH_GRACE=0 -- "$R/work/$name"
    for _ in $(seq 500); do [[ -f $R/out/$name.dnd.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    [[ -f $R/out/$name.dnd.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.dnd.json"
    files=$(cd "$R/work" && find . -type f | sort | tr '\n' ' ')
    [[ $files == "./m5.md ./notes.txt " ]] && echo "ok   what the note still names is beside it; the pictures that were dropped and taken back are gone with them" || echo "FAIL files beside the note: $files"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.dnd.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.dnd.json"; [[ $files == "./m5.md ./notes.txt " ]] || echo FAIL; cmp -s <(jq -j '.saved // ""' "$R/out/$name.dnd.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  assets)
    # the real clipboard (the nested session's own) holds a picture; the folder is a window's, with a note in a subfolder
    rm -rf "$R/work"; A="$R/work/a"; mkdir -p "$A/Sub" "$A/shelf" "$A/Old/assets"; rm -f "$R/out"/*.assets.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -6 | tr '\n' ' '))}"; fail=1; fi; }
    printf '# Note\n\nPaste here.\n\nDrop here.\n' > "$A/Sub/Note.md"; echo '# Other' > "$A/shelf/Other.md"
    printf '# Legacy\n\n![](assets/kept.png)\n' > "$A/Old/Legacy.md"; magick -size 12x12 xc:'#30a46c' "$A/Old/assets/kept.png"
    magick -size 20x20 xc:'#e5484d' "$R/drop.png"; python3 "$D/gen-pdf.py" "$R/paper.pdf" 1
    magick -size 40x30 xc:'#3b82f6' "$R/out/clip.png" && WAYLAND_DISPLAY="$(wl)" wl-copy -t image/png < "$R/out/clip.png"
    mkdir -p "$R/state/mdview"; st="$R/state/mdview/state.json"; [[ -f $st ]] || echo '{}' > "$st"
    jq --arg f "$A" --arg n "$A/Sub/Note.md" 'del(.active, .opened, .tabs) | .folder = $f | .last_notes = {($f): $n}' "$st" > "$st.new" && mv "$st.new" "$st"
    app 80 MDVIEW_PROBE="$D/probe-assets.js" MDVIEW_PROBE_OUT="$R/out" -- "$A"
    for _ in $(seq 500); do ls "$R/out"/*.assets.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.5; pkill -f "^$APP" 2>/dev/null
    WAYLAND_DISPLAY="$(wl)" wl-copy --clear 2>/dev/null
    [[ -f $st ]] && jq 'del(.active, .opened, .tabs, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st"
    J=$(ls "$R/out"/*.assets.json 2>/dev/null | head -1); [[ -n $J ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$J"; jq -r '.steps[], (.error // "ok")' "$J" | grep -qv '^ok' && fail=1
    img=$(ls "$A"/assets/pasted-*.png 2>/dev/null | head -1)
    ok "the pasted picture is a file in the base folder's assets" '[[ -n $img ]] && cmp -s "$img" "$R/out/clip.png"' 'find "$A" -type f | sort'
    ok "… and so are the picture and the file that were dropped" '[[ -f $A/assets/drop.png && -f $A/assets/paper.pdf ]]' 'find "$A" -type f | sort'
    ok "no subfolder got an assets of its own" '[[ ! -e $A/Sub/assets && ! -e $A/shelf/assets ]]' 'find "$A" -type d | sort'
    ok "the note that was moved names its pictures with the same words" 'grep -q "](assets/pasted-" "$A/shelf/Note.md" && grep -q "](assets/drop.png)" "$A/shelf/Note.md" && ! grep -q "\.\./" "$A/shelf/Note.md"' 'cat "$A/shelf/Note.md"'
    ok "what lay beside a note before stays where it was" '[[ -f $A/Old/assets/kept.png && ! -e $A/assets/kept.png ]]' 'find "$A" -type f | sort'
    exit $fail ;;
  prefs)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{dialog,slash,prefs}.json
    # (the probe stores and removes a key for the model: in a settings folder of its own, never the user's)
    rm -rf "$R/config"; mkdir -p "$R/config"
    app 120 MDVIEW_PROBE="$D/probe-prefs.js" MDVIEW_PROBE_OUT="$R/out" XDG_CONFIG_HOME="$R/config" GEMINI_API_KEY= -- "$R/work/$name"
    for v in dialog slash; do
      for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.prefs.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/prefs-$v.png"
    done
    for _ in $(seq 500); do [[ -f $R/out/$name.prefs.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    [[ -f $R/out/$name.prefs.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.prefs.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.prefs.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.prefs.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.prefs.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  zoom)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".zoom.json
    app 60 MDVIEW_PROBE="$D/probe-zoom.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 400); do [[ -f $R/out/$name.zoom.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    [[ -f $R/out/$name.zoom.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.zoom.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.zoom.json" | grep -qv '^ok' ;;
  adjust)
    rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out"/note.md.*.json
    python3 "$D/gen-pdf.py" "$R/work/paper.pdf" 6
    magick -size 600x200 gradient:blue-white "$R/work/photo.png"
    printf '%s\n' '# Notes on the paper' '' '![[paper.pdf#page=3&rect=60,600,420,790]]' '' 'A picture ![a photo|240](photo.png) in a line.' '' '![[photo.png|full]]' '' 'End.' > "$R/work/note.md"
    app 90 MDVIEW_PROBE="$D/probe-adjust.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/note.md"
    for _ in $(seq 400); do [[ -f $R/out/note.md.shot-adjust.json || -f $R/out/note.md.adjust.json ]] && break; sleep 0.1; done; sleep 0.5; shot "$R/out/adjust.png"
    for _ in $(seq 400); do [[ -f $R/out/note.md.adjust.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/note.md.adjust.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/note.md.adjust.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/note.md.adjust.json" | grep -qv '^ok' ;;
  textmenu)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".textmenu.json
    app 60 MDVIEW_PROBE="$D/probe-textmenu.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.textmenu.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.textmenu.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.textmenu.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.textmenu.json" | grep -qv '^ok' ;;
  edges)
    rc=0
    for name in empty.md only-code.md m5.md; do
      rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{narrow,edges}.json
      app 90 MDVIEW_PROBE="$D/probe-edges.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
      if [[ $name == m5.md ]]; then for _ in $(seq 400); do [[ -f $R/out/$name.narrow.json || -f $R/out/$name.edges.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/edges-narrow.png"; fi
      for _ in $(seq 600); do [[ -f $R/out/$name.edges.json ]] && break; sleep 0.1; done
      pkill -f "^$APP" 2>/dev/null; sleep 0.3
      [[ -f $R/out/$name.edges.json ]] || { echo "FAIL $name: no report"; tail -5 "$R/app.log"; rc=1; continue; }
      jq -r --arg n "$name" '(.steps[] | sub("^(?<a>ok   |FAIL )"; "\(.a)\($n): ")), (.error // empty)' "$R/out/$name.edges.json"
      cmp -s <(jq -j '.saved // ""' "$R/out/$name.edges.json") "$R/work/$name" && echo "ok   $name: the file on disk is the saved document" || { echo "FAIL $name: the file on disk differs from the saved document"; rc=1; }
      jq -r '.steps[], (.error // "ok")' "$R/out/$name.edges.json" | grep -qv '^ok' && rc=1
    done
    exit $rc ;;
  clip)
    # the real clipboard (the nested session's own): plain-text paste and a pasted picture go through the application
    name=m4.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{wantimage,clip}.json
    printf '%s' '*plain* [text]' | WAYLAND_DISPLAY="$(wl)" wl-copy
    app 80 MDVIEW_PROBE="$D/probe-clip.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.wantimage.json || -f $R/out/$name.clip.json ]] && break; sleep 0.1; done
    magick -size 40x30 xc:'#3b82f6' "$R/out/clip.png" && WAYLAND_DISPLAY="$(wl)" wl-copy -t image/png < "$R/out/clip.png"
    for _ in $(seq 500); do [[ -f $R/out/$name.clip.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    WAYLAND_DISPLAY="$(wl)" wl-copy --clear 2>/dev/null
    [[ -f $R/out/$name.clip.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.clip.json"
    img=$(ls "$R/work"/assets/pasted-*.png 2>/dev/null | head -1)
    [[ -n $img ]] && cmp -s "$img" "$R/out/clip.png" && echo "ok   the picture is a file in ./assets beside the note" || echo "FAIL no picture file in ./assets beside the note"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.clip.json"; [[ -n $img ]] || echo FAIL; } | grep -qv '^ok' ;;
  link)
    name=editing.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{info,form,link}.json
    app 40 MDVIEW_PROBE="$D/probe-link.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in info form; do
      for _ in $(seq 150); do [[ -f $R/out/$name.$v.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/link-$v.png"
    done
    for _ in $(seq 200); do [[ -f $R/out/$name.link.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.link.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.link.json"
    ! jq -r '.steps[], (.error // "ok")' "$R/out/$name.link.json" | grep -qv '^ok' ;;
  perf)
    shift
    for f in "$@"; do
      name=$(basename "$f"); rm -rf "$R/work"; mkdir -p "$R/work"; cp "$f" "$R/work/$name"; rm -f "$R/out/$name.perf.json"
      app 240 MDVIEW_PROBE="$D/probe-perf.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
      for _ in $(seq 2300); do [[ -f $R/out/$name.perf.json ]] && break; sleep 0.1; done
      pkill -f "^$APP" 2>/dev/null; sleep 0.3
      [[ -f $R/out/$name.perf.json ]] && jq -c . "$R/out/$name.perf.json" || echo "{\"file\":\"$name\",\"error\":\"no report\"}"
      cmp -s "$f" "$R/work/$name" || echo "{\"file\":\"$name\",\"error\":\"the file on disk changed\"}"
    done ;;
  typing)
    shift
    for f in "$@"; do
      name=$(basename "$f"); rm -rf "$R/work"; mkdir -p "$R/work"; cp "$f" "$R/work/$name"; rm -f "$R/out/$name.typing.json"
      app 60 MDVIEW_PROBE="$D/probe-typing.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
      for _ in $(seq 400); do [[ -f $R/out/$name.typing.json ]] && break; sleep 0.1; done
      pkill -f "^$APP" 2>/dev/null; sleep 0.3
      [[ -f $R/out/$name.typing.json ]] && jq -c . "$R/out/$name.typing.json" || echo "{\"file\":\"$name\",\"error\":\"no report\"}"
    done ;;
  native)
    name=editing.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out"/*.native.json
    app 40 MDVIEW_PROBE="$D/probe-native.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 200); do ls "$R/out"/*.native.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    ls "$R/out"/*.native.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.native.json
    ! jq -r '.steps[], (.error // "ok")' "$R/out"/*.native.json | grep -qv '^ok' ;;
  folder)
    rm -rf "$R/work"; mkdir -p "$R/work/notes/sub"; cp "$D"/tests/fixtures/{basics,obsidian,math}.md "$R/work/notes/"; cp "$D/tests/fixtures/footnotes.md" "$R/work/notes/sub/"
    python3 "$D/gen-pdf.py" "$R/work/notes/paper.pdf" 3
    printf 'a,b\n1,2\n' > "$R/work/notes/data.csv"; magick -size 8x8 xc:red "$R/work/notes/photo.png"
    rm -f "$R/out"/*.folder.json
    app 90 MDVIEW_PROBE="$D/probe-folder.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/notes"
    for _ in $(seq 500); do ls "$R/out"/*.folder.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active, .opened, .tabs)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    ls "$R/out"/*.folder.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.folder.json
    ! jq -r '.steps[], (.error // empty)' "$R/out"/*.folder.json | grep -qv '^ok' ;;
  tabs)
    rm -rf "$R/work"; mkdir -p "$R/work/notes/sub"; cp "$D"/tests/fixtures/{basics,obsidian,math}.md "$R/work/notes/"; cp "$D/tests/fixtures/footnotes.md" "$R/work/notes/sub/"
    python3 "$D/gen-pdf.py" "$R/work/notes/paper.pdf" 3
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.tabs, .opened, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st" # (it starts with one tab, on a note)
    rm -f "$R/out"/*.tabs.json "$R/out"/*.shot-*.json
    app 120 MDVIEW_PROBE="$D/probe-tabs.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/notes"
    for v in empty pdf pull menu tabs; do
      for _ in $(seq 600); do [[ -n $(ls "$R/out"/*.shot-$v.json "$R/out"/*.tabs.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.5; shot "$R/out/tabs-$v.png"
    done
    for _ in $(seq 300); do ls "$R/out"/*.tabs.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    ls "$R/out"/*.tabs.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.tabs.json
    echo "kept: $(jq -c '.tabs | to_entries[-1].value | {tabs: (.paths | map(split("/")[-1])), active}' "$st")"
    jq 'del(.tabs, .active, .opened, .last_notes)' "$st" > "$st.new" && mv "$st.new" "$st" # (what the test left never stays)
    ! jq -r '.steps[], (.error // empty)' "$R/out"/*.tabs.json | grep -qv '^ok' ;;
  overview)
    rm -rf "$R/work"; mkdir -p "$R/work"; cp -r "$D/tests/overview-notes" "$R/work/Notes"; rm -f "$R/out"/*.ov.json "$R/out"/*.shot.json "$R/out"/*.shot-*.json
    app 90 MDVIEW_PROBE="$D/probe-overview.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/Notes"
    for _ in $(seq 200); do ls "$R/out"/*.shot.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.7; shot "$R/out/overview.png"
    for v in list folders menu; do
      for _ in $(seq 300); do [[ -n $(ls "$R/out"/*.shot-$v.json "$R/out"/*.ov.json 2>/dev/null) ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/overview-$v.png"
    done
    for _ in $(seq 200); do ls "$R/out"/*.ov.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    ls "$R/out"/*.ov.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.ov.json
    ! jq -r '.steps[], (.error // empty)' "$R/out"/*.ov.json | grep -qv '^ok' ;;
  ovlook)
    # All Notes as it looks, on a copy of FOLDER (default: the overview's notes): screenshots only, ovlook-*.png
    src="${2:-$D/tests/overview-notes}"; rm -rf "$R/work"; mkdir -p "$R/work"; rsync -a --exclude .git "$src/" "$R/work/Notes/"
    rm -f "$R/out"/*.ovlook.json "$R/out"/*.shot-*.json "$R/out"/ovlook-*.png; done_shots=" "
    app 180 MDVIEW_PROBE="$D/probe-ovlook.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/Notes"
    for _ in $(seq 1500); do
      for f in "$R/out"/*.shot-*.json; do
        [[ -f $f && $done_shots != *" $f "* ]] || continue
        v=${f##*.shot-}; v=${v%.json}; sleep 0.4; shot "$R/out/ovlook-$v.png"; echo "$R/out/ovlook-$v.png"; done_shots+="$f "
      done
      ls "$R/out"/*.ovlook.json >/dev/null 2>&1 && break; sleep 0.1
    done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    jq -r '.error // "ok"' "$R/out"/*.ovlook.json ;;
  panel)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 90 MDVIEW_PROBE="$D/probe-panel.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in document document-dark insert format; do
      for _ in $(seq 400); do [[ -f $R/out/$name.shot-$v.json || -f $R/out/$name.panel.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/panel-$v.png"
    done
    for _ in $(seq 400); do [[ -f $R/out/$name.panel.json ]] && break; sleep 0.1; done
    sleep 1; pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    [[ -f $R/out/$name.panel.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    # (what the Document tab chose last stands in the file itself)
    filed=$([[ $(head -4 "$R/work/$name" | tr '\n' '|') == '---|background: green|width: wide|---|' ]] && echo 'ok   ' || echo 'FAIL ')"the file on the disk has the properties the panel wrote  $(head -4 "$R/work/$name" | tr '\n' '|')"
    { jq -r '.steps[], (.error // empty)' "$R/out/$name.panel.json"; echo "$filed"; } | tee "$R/out/panel.txt"
    ! grep -qv '^ok' "$R/out/panel.txt" ;;
  columns)
    name=columns.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Columns\n\nAlpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.\n\nDelta paragraph.\n' > "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 90 MDVIEW_PROBE="$D/probe-columns.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 400); do [[ -f $R/out/$name.shot.json || -f $R/out/$name.columns.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/columns.png"
    for _ in $(seq 400); do [[ -f $R/out/$name.columns.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.columns.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.columns.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.columns.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.columns.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.columns.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  colsel)
    name=colsel.md; rm -rf "$R/work"; mkdir -p "$R/work"; rm -f "$R/out/$name".*.json
    printf '%s\n' '# Rectangle' '' 'Before the row.' '' '<!-- columns -->' '' '## Left' '' '- [ ] L one' '- [ ] L two' '- [ ] L three' '' 'Left paragraph.' '' '- outer A' '  - nested A1' '  - nested A2' '- outer B' '' '<!-- column -->' '' '## Right' '' '- [x] R one' '- [x] R two' '' '> [!info] Note' '> - C one' '> - C two' '' '<!-- /columns -->' '' 'After the row.' > "$R/work/$name"
    app 90 MDVIEW_PROBE="$D/probe-colsel.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 500); do [[ -f $R/out/$name.colsel.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.colsel.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.colsel.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.colsel.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.colsel.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.colsel.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  callout)
    name=callout.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Callouts\n\n> [!info]\n> An info.\n\nPlain text.\n\nEnd.\n' > "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 60 MDVIEW_PROBE="$D/probe-callout.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.callout.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.callout.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.callout.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.callout.json" | grep -qv '^ok' ;;
  slashbar)
    name=slashbar.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Bar\n\nPlain text.\n\nEnd.\n' > "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 60 MDVIEW_PROBE="$D/probe-slashbar.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.bar.json || -f $R/out/$name.slashbar.json ]] && break; sleep 0.1; done; sleep 1.5; shot "$R/out/slashbar.png"
    for _ in $(seq 300); do [[ -f $R/out/$name.slashbar.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.slashbar.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.slashbar.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.slashbar.json" | grep -qv '^ok' ;;
  history)
    rm -rf "$R/work"; mkdir -p "$R/work/notes/sub"; cp "$D"/tests/fixtures/{basics,obsidian}.md "$R/work/notes/"; cp "$D/tests/fixtures/footnotes.md" "$R/work/notes/sub/"
    W="$R/work/notes"; rm -f "$R/out"/*.history.json "$R/out"/*.history-ready.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -3 | tr '\n' ' '))}"; fail=1; fi; }
    app 60 MDVIEW_PROBE="$D/probe-history.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=1500 -- "$W"
    for _ in $(seq 150); do ls "$R/out"/*.history-ready.json >/dev/null 2>&1 && break; sleep 0.1; done
    ls "$R/out"/*.history-ready.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; pkill -f "^$APP" 2>/dev/null; exit 1; }
    ok "after switching on and one change: two commits" '[[ $(git -C "$W" rev-list --count HEAD) == 2 ]]' 'git -C "$W" log --oneline'
    printf '\nfrom outside\n' >> "$W/sub/footnotes.md"   # (another program writes into the folder)
    for _ in $(seq 100); do ls "$R/out"/*.history.json >/dev/null 2>&1 && break; sleep 0.1; done
    sleep 0.8                                             # (less than the quiet while: the last commit is the closing's)
    note=$(jq -r .note "$R/out"/*.history.json)
    rep=$(ls "$R/out"/*.history.json | head -1)
    ok "the sidebar's clock says the history is off, and offers it" '[[ $(jq -r "[.before.says, .before.quiet, .offered[0]] | join(\"|\")" "$rep") == "History: off|true|Turn On History" ]]' 'jq -c "[.before, .offered]" "$rep"'
    ok "switched on from its menu, it says so and offers the note's history" '[[ $(jq -r "[.after.says, .after.quiet, .then[1]] | join(\"|\")" "$rep") == "History: on|false|History Is On (off)" && $(jq -r ".then[0]" "$rep") == "Show History of This Note"* ]]' 'jq -c "[.after, .then]" "$rep"'
    ok "four commits: switched on, a change, one from outside, one at closing" '[[ $(git -C "$W" rev-list --count HEAD) == 4 ]]' 'git -C "$W" log --oneline'
    ok "their subjects name what changed" '[[ $(git -C "$W" log --reverse --format=%s | paste -sd"|") == "History switched on|$note|footnotes.md|$note" ]]' 'git -C "$W" log --reverse --format=%s'
    ok "the folder is as the last commit says" '[[ -z $(git -C "$W" status --porcelain) ]]' 'git -C "$W" status --porcelain'
    ok "marker and repository are both there" '[[ -f $W/.mdview/project.json && -d $W/.git ]]'
    dev=$(jq -r '.device | "\(.name) (\(.id))"' "$R/state/mdview/state.json")
    ok "every commit names this device" '[[ $(git -C "$W" log --format="%(trailers:key=Device,valueonly)" | grep -c -F "$dev") == 4 ]]' 'git -C "$W" log -1 --format=%B; echo "$dev"'
    ok "the device has an id of its own" '[[ $(jq -r .device.id "$R/state/mdview/state.json") =~ ^[0-9a-f-]{36}$ ]]'
    ok "and the program that made it" '[[ $(git -C "$W" log --format="%(trailers:key=Client,valueonly)" | grep -c "^desktop ") == 4 ]]'
    ok "the note on disk has both changes" 'grep -q "second change" "$W/$note" && grep -q "first change" "$W/$note"'
    pkill -f "^$APP" 2>/dev/null; sleep 0.5
    # the history's window, on the note that now has three versions
    rm -f "$R/out"/*.history-window.json
    app 60 MDVIEW_PROBE="$D/probe-history-window.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=700 -- "$W"
    for _ in $(seq 400); do ls "$R/out"/*.history-window.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    win=$(ls "$R/out"/*.history-window.json 2>/dev/null | head -1); [[ -n $win ]] || { echo "no report of the window"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$win"; jq -e .pass "$win" >/dev/null || fail=1
    ok "the file on disk is the restored version" 'cmp -s <(jq -j .restored "$win") "$W/$note"'
    ok "seven commits by now: the version restored, what was typed, the first version restored" '[[ $(git -C "$W" rev-list --count HEAD) == 7 ]]' 'git -C "$W" log --oneline'
    # a folder above that project becomes a project, and takes it in
    P="$R/work"; cp "$D/tests/fixtures/obsidian.md" "$P/top.md"; rm -f "$R/out"/*.history-nested.json
    app 60 MDVIEW_PROBE="$D/probe-history-nested.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=700 -- "$P"
    for _ in $(seq 150); do ls "$R/out"/*.history-nested.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    nest=$(ls "$R/out"/*.history-nested.json 2>/dev/null | head -1); [[ -n $nest ]] || { echo "no report of the taking in"; tail -5 "$R/app.log"; exit 1; }
    ok "the folder above was no project, and is one now" '[[ $(jq -r "[.before, .after] | join(\"|\")" "$nest") == "History: off|History: on" ]]' 'cat "$nest"'
    ok "the inner project's repository and marker are gone from its folder" '[[ ! -e $W/.git && ! -e $W/.mdview && -d $P/.git && -f $P/.mdview/project.json ]]'
    ok "its commits are the outer project's: seven, the folder as it was, and the one that joins them" '[[ $(git -C "$P" rev-list --count HEAD) == 9 && $(git -C "$P" rev-list --merges --count HEAD) == 1 ]]' 'git -C "$P" log --oneline --graph'
    ok "its notes are in the outer project, and nothing waits" '[[ -n $(git -C "$P" ls-files "notes/$note") && -z $(git -C "$P" status --porcelain) ]]' 'git -C "$P" status --porcelain'
    ok "its repository is put aside, not thrown away" '[[ $(ls "$P/.git/mdview-absorbed" | wc -l) == 1 ]]'
    # the history switched off and on again; and the program, ending by itself with a change not yet kept
    rm -f "$R/out"/*.history-off.json "$R/out"/*.history-now.json; before=$(git -C "$P" rev-list --count HEAD)
    app 60 MDVIEW_PROBE="$D/probe-history-off.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=60000 MDVIEW_RESIDENT_MS=300 -- "$P"
    for _ in $(seq 150); do ls "$R/out"/*.history-now.json >/dev/null 2>&1 && break; sleep 0.1; done
    ok "Ctrl+S keeps what was written at once, not after the quiet while" '[[ $(git -C "$P" rev-list --count HEAD) == $((before + 1)) && -z $(git -C "$P" status --porcelain) ]]' 'git -C "$P" log --oneline | head -3; git -C "$P" status --porcelain'
    for _ in $(seq 150); do ls "$R/out"/*.history-off.json >/dev/null 2>&1 && break; sleep 0.1; done
    off=$(ls "$R/out"/*.history-off.json 2>/dev/null | head -1); [[ -n $off ]] || { echo "no report of switching off"; tail -5 "$R/app.log"; pkill -f "^$APP" 2>/dev/null; exit 1; }
    jq -r '.steps[], (.error // empty)' "$off"; jq -e .pass "$off" >/dev/null || fail=1
    for _ in $(seq 50); do pgrep -f "^$APP" >/dev/null || break; sleep 0.1; done
    ok "with no window left, the program ends by itself" '! pgrep -f "^$APP" >/dev/null'
    ok "and what was written just before is kept: nothing waits" '[[ -z $(git -C "$P" status --porcelain) && $(git -C "$P" log -1 --format=%s) == top.md ]]' 'git -C "$P" status --porcelain; git -C "$P" log --oneline | head -3'
    ok "the project is the one it was: the same marker as before it was switched off" '[[ $(git -C "$P" log --format=%H -- .mdview/project.json | wc -l) == 1 ]]' 'git -C "$P" log --oneline -- .mdview/project.json'
    pkill -f "^$APP" 2>/dev/null
    exit $fail ;;
  move)
    rm -rf "$R/work"; mkdir -p "$R/work/a/box" "$R/work/a/shelf"; A="$R/work/a"; rm -f "$R/out"/*.move.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -4 | tr '\n' ' '))}"; fail=1; fi; }
    printf '# Loose\n\nto be moved\n' > "$A/Loose.md"; echo '# Inside' > "$A/box/Inside.md"; echo '# Other' > "$A/shelf/Other.md"
    jq -n --arg f "$A" --arg n "$A/Loose.md" '{folder: $f, last_notes: {($f): $n}}' > "$R/state/mdview/state.json" 2>/dev/null || true
    app 60 MDVIEW_PROBE="$D/probe-move.js" MDVIEW_PROBE_OUT="$R/out" -- "$A"
    for _ in $(seq 300); do ls "$R/out"/*.move.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.5; pkill -f "^$APP" 2>/dev/null
    J=$(ls "$R/out"/*.move.json 2>/dev/null | head -1); [[ -n $J ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    ok "nothing went wrong in the page" '[[ $(jq -r ".error // empty" "$J") == "" ]]' 'jq -r .error "$J"'
    ok "dragged over a folder, the folder is marked" '[[ $(jq -r .marked "$J") == true ]]'
    ok "the note is in the folder, and the page shows it under its new path" '[[ $(jq -r .after "$J") == "box/Loose.md" ]]' 'jq -c . "$J"'
    ok "the folder is in the other, with what was in it" '[[ -f $A/shelf/box/Loose.md && -f $A/shelf/box/Inside.md && ! -e $A/box && ! -e $A/Loose.md ]]' 'find "$A" -type f | sort'
    ok "… and the note on screen went with it" '[[ $(jq -r .then "$J") == "shelf/box/Loose.md" ]]' 'jq -c . "$J"'
    ok "a folder does not go into itself" '[[ -d $A/shelf && ! -e $A/shelf/box/shelf ]]'
    ok "the note is as it was" '[[ $(cat "$A/shelf/box/Loose.md") == "# Loose"$'"'"'\n\n'"'"'"to be moved" ]]' 'cat "$A/shelf/box/Loose.md"'
    exit $fail;;
  share)
    rm -rf "$R/work"; mkdir -p "$R/work/a/.mdview"; cp "$D"/tests/fixtures/basics.md "$R/work/a/Note.md"; A="$R/work/a"; rm -f "$R/out"/*.share*.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -4 | tr '\n' ' '))}"; fail=1; fi; }
    echo '{"id":"rig","version":1}' > "$A/.mdview/project.json"
    git -C "$A" init -q -b main; git -C "$A" -c user.name=Rig -c user.email=rig@example.invalid add -A; git -C "$A" -c user.name=Rig -c user.email=rig@example.invalid commit -q -m first
    git -C "$A" remote add origin https://github.com/henriSchulz/mdview-rig-not-there.git   # (linked to GitHub, as far as the shell can tell: nothing arrives there)
    app 60 MDVIEW_PROBE="$D/probe-share.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_WEB=https://notes.example -- "$A"
    wait_for() { for _ in $(seq "$2"); do ls "$R/out"/*."$1".json >/dev/null 2>&1 && return 0; sleep 0.1; done; echo "no report: $1"; tail -5 "$R/app.log"; pkill -f "^$APP" 2>/dev/null; exit 1; }
    sh() { jq -r "$1" "$A/.mdview/shares.json"; }
    wait_for share-shared 200; id=$(sh '.shares | keys[0]')
    ok "a button for it at the top, between the magnifier and the modes" '[[ $(jq -c .button "$R/out"/*.share-shared.json) == "[true,\"find\",\"seg\"]" ]]' 'jq -c .button "$R/out"/*.share-shared.json'
    ok "not shared yet: the window offers to" '[[ $(jq -c ".open | [.title, .link, .go, .stop, .folded]" "$R/out"/*.share-shared.json) == "[\"Share “Note”\",null,true,false,true]" ]]' 'jq -c .open "$R/out"/*.share-shared.json'
    ok "shared: the file names the note, without a password" '[[ $(sh ".shares[\"$id\"] | [.path, .password] | @json") == "[\"Note.md\",null]" && ${#id} == 10 ]]' 'cat "$A/.mdview/shares.json"'
    ok "the window shows the link, at the web app" '[[ $(jq -r .shared.link "$R/out"/*.share-shared.json) == "https://notes.example/$id" ]]' 'jq -c .shared "$R/out"/*.share-shared.json'
    ok "… and says that it is not at GitHub yet" 'jq -r .shared.text "$R/out"/*.share-shared.json | grep -q "once this is sent to GitHub"'
    ok "the note is marked in the sidebar, and the button while it is shown" '[[ $(jq -c .marked "$R/out"/*.share-shared.json) == "[[\"Note\"],true]" ]]' 'jq -c .marked "$R/out"/*.share-shared.json'
    ok "kept as a commit at once" 'git -C "$A" log --format=%s -1 -- .mdview/shares.json | grep -q "shares.json"' 'git -C "$A" log --oneline | head -3; git -C "$A" status --porcelain'
    wait_for share-locked 200
    ok "a password: of it only what it hashes to is in the file" '[[ $(sh ".shares[\"$id\"].password | keys | @json") == "[\"hash\",\"iterations\",\"salt\"]" ]] && ! grep -q sesame "$A/.mdview/shares.json"' 'cat "$A/.mdview/shares.json"'
    ok "the window says so" 'jq -r .locked.text "$R/out"/*.share-locked.json | grep -q "and the password"' 'jq -c .locked "$R/out"/*.share-locked.json'
    wait_for share 200; sleep 1; pkill -f "^$APP" 2>/dev/null
    ok "shared no more: nothing in the file, the window offers to share again" '[[ $(sh ".shares | length") == 0 && $(jq -c "[.stopped.link, .stopped.go]" "$R/out"/Note.md.share.json) == "[null,true]" ]]' 'cat "$A/.mdview/shares.json"; jq -c .stopped "$R/out"/Note.md.share.json'
    ok "… and nothing is marked any more" '[[ $(jq -c .unmarked "$R/out"/Note.md.share.json) == "[0,false]" ]]' 'jq -c .unmarked "$R/out"/Note.md.share.json'
    ok "nothing went wrong in the page" '[[ $(jq -r ".error // empty" "$R/out"/Note.md.share.json) == "" ]]' 'jq -r .error "$R/out"/Note.md.share.json'
    exit $fail;;
  sync)
    rm -rf "$R/work"; mkdir -p "$R/work/a"; cp "$D"/tests/fixtures/{basics,obsidian}.md "$R/work/a/"
    A="$R/work/a"; B="$R/work/b"; HUB="$R/work/hub.git"; rm -f "$R/out"/*.sync*.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -4 | tr '\n' ' '))}"; fail=1; fi; }
    other() { git -C "$B" -c user.name=Other -c user.email=other@example.invalid "$@"; }
    git init -q --bare -b main "$HUB"
    printf 'window.__hub = %s;\n' "$(jq -Rn --arg u "$HUB" '$u')" > "$R/work/probe-sync.js"; cat "$D/probe-sync.js" >> "$R/work/probe-sync.js"
    app 60 MDVIEW_PROBE="$R/work/probe-sync.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=600 MDVIEW_SYNC_MS=1200 -- "$A"
    wait_for() { for _ in $(seq "$2"); do ls "$R/out"/*."$1".json >/dev/null 2>&1 && return 0; sleep 0.1; done; echo "no report: $1"; tail -5 "$R/app.log"; pkill -f "^$APP" 2>/dev/null; exit 1; }
    wait_for sync-linked 120; note=$(jq -r .note "$R/out"/*.sync-linked.json)
    ok "linked, the project is on the other side" '[[ $(git -C "$HUB" rev-parse main 2>/dev/null) == $(git -C "$A" rev-parse HEAD) ]]' 'git -C "$HUB" branch -a; git -C "$A" log --oneline'
    git clone -q "$HUB" "$B"
    ok "another device that fetches it has the project, marker and all" '[[ -f $B/.mdview/project.json && -f $B/$note ]]'
    printf '\nfrom the other device\n' >> "$B/$note"; other commit -q -am "theirs"; other push -q
    wait_for sync-pulled 120
    ok "what the other device pushed is on the page here, without anything done" '[[ $(jq -r .pulled "$R/out"/*.sync-pulled.json) == true ]]'
    ok "and in the folder, which is as the other side has it" 'grep -q "from the other device" "$A/$note" && [[ $(git -C "$A" rev-parse HEAD) == $(git -C "$HUB" rev-parse main) ]]' 'git -C "$A" log --oneline | head -3'
    printf 'also theirs\n' >> "$B/obsidian.md"; [[ $note == obsidian.md ]] && printf 'also theirs\n' >> "$B/basics.md"; other commit -q -am "theirs, elsewhere"; other push -q
    wait_for sync 150; pkill -f "^$APP" 2>/dev/null
    ok "both changed at once: joined in one commit with two parents" '[[ $(git -C "$A" rev-list --merges --count HEAD) == 1 ]]' 'git -C "$A" log --oneline --graph | head -6'
    ok "the folder has both: what was written here, and theirs" 'grep -q "written here" "$A/$note" && grep -rq "also theirs" "$A" && [[ -z $(git -C "$A" status --porcelain) ]]' 'git -C "$A" status --porcelain'
    ok "and the other side has it all" '[[ $(git -C "$HUB" rev-parse main) == $(git -C "$A" rev-parse HEAD) ]]' 'git -C "$HUB" log --oneline main | head -4'
    ok "the page shows the note as it is on disk" 'cmp -s <(jq -j .raw "$R/out"/*.sync.json) "$A/$note"'
    ok "every commit made here names the device" '[[ $(git -C "$A" log --author="^(?!Other)" --perl-regexp --format="%(trailers:key=Device,valueonly)" | grep -c .) == $(git -C "$A" log --author="^(?!Other)" --perl-regexp --format=%h | wc -l) ]]' 'git -C "$A" log --format="%an | %s"'
    # both change the same line: nothing is joined until it is said how, in the conflicts' window
    other pull -q; sed -i '1s/written here/written there/' "$B/$note"; other commit -q -am "theirs, the same line"; other push -q
    sed -i '1s/written here/written right here/' "$A/$note"   # (written here while the app was not running)
    rm -f "$R/out"/*.sync-conflict*.json
    app 60 MDVIEW_PROBE="$D/probe-sync-conflict.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=600 MDVIEW_SYNC_MS=1200 -- "$A"
    wait_for sync-conflict-open 200; sleep 0.5; shot "$R/out/sync-conflict.png"
    ok "while it is to be said, the other side has not been touched" '[[ $(git -C "$HUB" log -1 --format=%s main) == "theirs, the same line" ]]' 'git -C "$HUB" log --oneline main | head -3'
    wait_for sync-conflict 250; pkill -f "^$APP" 2>/dev/null
    jq -r '.steps[], (.error // empty)' "$R/out"/*.sync-conflict.json; jq -e .pass "$R/out"/*.sync-conflict.json >/dev/null || fail=1
    ok "the folder is what was picked, and as its last commit says" 'cmp -s <(jq -j .raw "$R/out"/*.sync-conflict.json) "$A/$note" && [[ $(head -1 "$A/$note") == "written there" && -z $(git -C "$A" status --porcelain) ]]' 'head -2 "$A/$note"; git -C "$A" status --porcelain'
    ok "joined in a commit of its own, and the other side has it" '[[ $(git -C "$A" rev-list --merges --count HEAD) == 2 && $(git -C "$HUB" rev-parse main) == $(git -C "$A" rev-parse HEAD) ]]' 'git -C "$A" log --oneline --graph | head -6'
    # opened anew, linked already: Sync Now is there before the two sides were first looked at (a minute, as the app runs)
    rm -f "$R/out"/*.sync-button.json
    app 30 MDVIEW_PROBE="$D/probe-sync-button.js" MDVIEW_PROBE_OUT="$R/out" -- "$A"
    wait_for sync-button 150; pkill -f "^$APP" 2>/dev/null
    ok "a linked project opened anew: Sync Now is in the sidebar's head at once" '[[ $(jq -c "[.linked, .display]" "$R/out"/*.sync-button.json) == "[true,\"grid\"]" ]]' 'jq -c . "$R/out"/*.sync-button.json'
    exit $fail ;;
  paste)
    # A project's pasteboard in the application: none without a sign-in, then typed here and at the server, written there and here.
    rm -rf "$R/work"; mkdir -p "$R/work/a/.mdview"; cp "$D"/tests/fixtures/basics.md "$R/work/a/Note.md"; A="$R/work/a"; rm -f "$R/out"/*.paste*.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -4 | tr '\n' ' '))}"; fail=1; fi; }
    echo '{"id":"rig","version":1}' > "$A/.mdview/project.json"
    git -C "$A" init -q -b main; git -C "$A" -c user.name=Rig -c user.email=rig@example.invalid add -A; git -C "$A" -c user.name=Rig -c user.email=rig@example.invalid commit -q -m first
    git -C "$A" remote add origin https://github.com/octo/mdview-rig-not-there.git   # (linked to GitHub, as far as the shell can tell: nothing arrives there)
    port=$((20000 + RANDOM % 20000)); python3 "$D/fake-github.py" "$port" "$R/work/none.git" >"$R/fake-github.log" 2>&1 & hub=$!
    at="http://127.0.0.1:$port/paste/octo/mdview-rig-not-there"; as=(-s -H "Authorization: Bearer ghu_fake" -H "Content-Type: application/json")
    app 120 MDVIEW_PROBE="$D/probe-paste.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_GITHUB_WEB="http://127.0.0.1:$port" MDVIEW_GITHUB_API="http://127.0.0.1:$port" MDVIEW_WEB="http://127.0.0.1:$port" -- "$A"
    wait_for() { for _ in $(seq "$2"); do ls "$R/out"/*."$1".json >/dev/null 2>&1 && return 0; sleep 0.1; done; echo "no report: $1"; tail -5 "$R/app.log"; pkill -f "^$APP" 2>/dev/null; kill $hub 2>/dev/null; exit 1; }
    for _ in $(seq 400); do [[ -n $(compgen -G "$R/out/*.paste-typed.json" || compgen -G "$R/out/*.paste.json") ]] && break; sleep 0.1; done; sleep 0.4; shot "$R/out/paste.png"
    # (what the server keeps is the page's list of blocks: a block is { id, text, at, from })
    texts() { curl "${as[@]}" "$at" | jq -r '[.text | (try fromjson catch {entries: []}) | .entries[].text] | join("|")'; }
    laptop() { local cur rev; cur=$(curl "${as[@]}" "$at"); rev=$(jq .rev <<<"$cur"); jq -c --arg t "$1" --argjson base "$rev" '{base: $base, by: "laptop", text: (((.text | (try fromjson catch {entries: []}) | .entries) + [{id: ("l" + ($base | tostring)), text: $t, at: (now | todate), from: "laptop"}]) | {v: 1, entries: .} | tojson)}' <<<"$cur" | curl "${as[@]}" -X PUT -d @- "$at" >/dev/null; }
    ok "what was typed here is a block at the server, with this device as its origin, signed with this device" '[[ $(texts) == "typed at the desk" && -n $(curl "${as[@]}" "$at" | jq -r .by) && -n $(curl "${as[@]}" "$at" | jq -r ".text | fromjson | .entries[0].from") ]]' 'curl "${as[@]}" "$at"'
    ok "and in the project, as a copy for who reads the folder: under a heading with its origin" '[[ $(head -1 "$A/.mdview/pasteboard.md") == "## "* && $(sed -n 3p "$A/.mdview/pasteboard.md") == "typed at the desk" ]]' 'cat "$A/.mdview/pasteboard.md"'
    laptop "and on the laptop"
    wait_for paste 200
    ok "the copy followed: cleared, and no change of the project" '[[ -f "$A/.mdview/pasteboard.md" && ! -s "$A/.mdview/pasteboard.md" && -z $(git -C "$A" status --porcelain -- .mdview/pasteboard.md) ]]' 'cat "$A/.mdview/pasteboard.md"; git -C "$A" status --porcelain'
    # `mdview paste` from a command line, as an agent would: handed to the running application (in its session), which is signed in
    cli() { local pid; pid=$(pgrep -f "^$APP" | head -1); env $(tr '\0' '\n' <"/proc/$pid/environ" | grep -E '^(DBUS_SESSION_BUS_ADDRESS|WAYLAND_DISPLAY|GDK_BACKEND|XDG_STATE_HOME|XDG_DATA_HOME|XDG_CACHE_HOME|MDVIEW_[A-Z_]+)=') timeout 30 "$APP" paste "$@"; }
    said=$(cd "$A" && cli from an agent 2>&1); wrote=$?
    ok "mdview paste TEXT, run in the project: a new block on the pasteboard, from this device's command, and in the copy" '[[ $wrote == 0 && $(texts) == "from an agent" && $(curl "${as[@]}" "$at" | jq -r ".text | fromjson | .entries[0].from") == *"(mdview paste)" && $(tail -1 "$A/.mdview/pasteboard.md") == "from an agent" ]]' 'echo "$wrote $said"; curl "${as[@]}" "$at"'
    (cd / && cli --in "$A" --append "and more" 2>/dev/null); printf 'a third line' | (cd "$A" && cli -a - 2>/dev/null)
    ok "--append is the same, - reads the text from standard input, and bare it says the blocks that stand there" '[[ $(texts) == "from an agent|and more|a third line" && $(cd "$A" && cli | grep -c "^## ") == 3 && $(cd "$A" && cli | tail -1) == "a third line" ]]' '(cd "$A" && cli); curl "${as[@]}" "$at"'
    (cd "$A" && cli --wait 20 >"$R/out/paste-waited.txt" 2>/dev/null; echo $? >"$R/out/paste-waited.code") & waiter=$!
    sleep 1.5; laptop "put there"
    sleep 0.5; laptop "put there for the agent"; wait $waiter
    ok "--wait says what was put there by another device, once it stands still" '[[ $(cat "$R/out/paste-waited.code") == 0 && $(tail -1 "$R/out/paste-waited.txt") == "put there for the agent" && $(grep -c "^## laptop" "$R/out/paste-waited.txt") == 2 ]]' 'cat "$R/out/paste-waited.code" "$R/out/paste-waited.txt"'
    (cd "$A" && cli --wait 2 >/dev/null 2>&1); wrote=$?
    ok "--wait ends with 3 where nothing came" '[[ $wrote == 3 ]]' 'echo "$wrote"'
    said=$(cd "$R/out" && cli nowhere 2>&1); wrote=$?
    ok "outside a linked project it says so, and writes nothing" '[[ $wrote == 1 && $said == *"no project"* && $(texts) != *nowhere* ]]' 'echo "$wrote $said"'
    ok "the copy is no change of the project, whatever was written" '[[ -z $(git -C "$A" status --porcelain -- .mdview/pasteboard.md) ]]' 'git -C "$A" status --porcelain'
    pkill -f "^$APP" 2>/dev/null; kill $hub 2>/dev/null
    jq -r '.steps[], (.error // empty)' "$R/out"/*.paste.json; jq -e .pass "$R/out"/*.paste.json >/dev/null || fail=1
    ok "Clear emptied it at the server too" '[[ $(jq -r .cleared "$R/out"/*.paste.json) == true ]]' 'jq -c . "$R/out"/*.paste.json'
    exit $fail ;;
  github)
    rm -rf "$R/work"; mkdir -p "$R/work/notes"; cp "$D"/tests/fixtures/basics.md "$R/work/notes/"; W="$R/work/notes"; rm -f "$R/out"/*.github*.json; fail=0
    ok() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1  ${3:+($(eval "$3" 2>&1 | head -4 | tr '\n' ' '))}"; fi; }
    HUB="$R/work/hub.git"; git init -q --bare -b main "$HUB"
    port=$((20000 + RANDOM % 20000)); python3 "$D/fake-github.py" "$port" "$HUB" >"$R/fake-github.log" 2>&1 & hub=$!
    app 60 MDVIEW_PROBE="$D/probe-github.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_HISTORY_QUIET_MS=600 MDVIEW_GITHUB_WEB="http://127.0.0.1:$port" MDVIEW_GITHUB_API="http://127.0.0.1:$port" -- "$W"
    for _ in $(seq 100); do ls "$R/out"/*.github-code.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.3; shot "$R/out/github-code.png"
    for _ in $(seq 250); do ls "$R/out"/*.github-search.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.2; shot "$R/out/github-search.png"
    for _ in $(seq 250); do ls "$R/out"/*.github-linked.json >/dev/null 2>&1 && break; sleep 0.1; done; sleep 0.3; shot "$R/out/github-linked.png"
    sent=$(git -C "$HUB" log -1 --format="%an | %s" main 2>/dev/null)
    for _ in $(seq 250); do ls "$R/out"/*.github.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null; kill $hub 2>/dev/null
    rep=$(ls "$R/out"/*.github.json 2>/dev/null | head -1); [[ -n $rep ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$rep"; jq -e .pass "$rep" >/dev/null || fail=1
    ok "the commit made while signed in is by that user, and still names the device" '[[ $(git -C "$W" log -1 --format="%an <%ae>") == "Octo Cat <42+octo@users.noreply.github.com>" && -n $(git -C "$W" log -1 --format="%(trailers:key=Device,valueonly)") ]]' 'git -C "$W" log -2 --format="%an <%ae> | %s"' || fail=1
    ok "linked, what was kept went to the repository" '[[ $sent == "Octo Cat | basics.md" && $(git -C "$HUB" rev-list --count main) == 2 ]]' 'echo "$sent"; git -C "$HUB" log --oneline main' || fail=1
    ok "unlinked, the project has no other side, and its history is all there" '[[ -z $(git -C "$W" remote) && $(git -C "$W" rev-list --count HEAD) == 2 ]]' 'git -C "$W" remote -v' || fail=1
    exit $fail ;;
  regress)
    # The page as it is on BASE (viewer.js and viewer/ — its scripts and styles), shown by this checkout's shell (MDVIEW_ASSETS) for the probe hook.
    # (A BASE from before the move to Tauri posts to WebKit's message handler: pointed at MdHost here.)
    # (Its texts too — strings.js — or a text with a number in it differs; a BASE without that file gets one that says the keys.
    # A BASE from before the page was several files has no viewer/: a script that is not found does nothing, and its one sheet,
    # viewer.css, stands where the first of the sheets is linked.)
    shift; base="${BASE:-main}"; B="$R/base"; rm -rf "$B"; mkdir -p "$B/viewer"; top=$(git -C "$D" rev-parse --show-toplevel); rel=$(git -C "$D" rev-parse --show-prefix); rel=${rel%dev/}
    git -C "$top" show "$base:${rel}viewer.js" > "$B/viewer.js"
    git -C "$top" archive "$base" "${rel}viewer" 2>/dev/null | tar -x -C "$B" --strip-components="$(tr -cd / <<<"$rel" | wc -c)" 2>/dev/null
    git -C "$top" show "$base:${rel}viewer.css" > "$B/viewer/page.css.base" 2>/dev/null && mv "$B/viewer/page.css.base" "$B/viewer/page.css" || rm -f "$B/viewer/page.css.base"
    git -C "$top" show "$base:${rel}strings.js" > "$B/strings.js" 2>/dev/null || echo 'window.MdStrings = { t: (k) => k };' > "$B/strings.js"
    sed -i 's/window\.webkit?\.messageHandlers?\.mdview?\.postMessage(/window.MdHost?.post(/g' "$B/viewer.js"; ln -s "$D/../vendor" "$B/vendor"
    fail=0
    for f in "$@"; do
      name=$(basename "$f")
      for side in base new; do
        rm -rf "$R/work"; mkdir -p "$R/work"; cp "$f" "$R/work/$name"; rm -f "$R/out/$name".{read,edit,report}.json
        [[ $side == base ]] && assets="$B" || assets="$D/.."
        app 60 MDVIEW_ASSETS="$assets" MDVIEW_PROBE="$D/probe-baseline.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
        for _ in $(seq 250); do [[ -f $R/out/$name.read.json ]] && break; sleep 0.1; done; sleep 0.8; shot "$R/out/$name.$side.read.png"
        for _ in $(seq 250); do [[ -f $R/out/$name.edit.json ]] && break; sleep 0.1; done; sleep 0.8; shot "$R/out/$name.$side.edit.png"
        for _ in $(seq 300); do [[ -f $R/out/$name.report.json ]] && break; sleep 0.1; done
        pkill -f "^$APP" 2>/dev/null; sleep 0.3
        mv "$R/out/$name.report.json" "$R/out/$name.$side.report.json" 2>/dev/null; cp "$R/work/$name" "$R/out/$name.$side.saved"
      done
      same=yes
      cmp -s <(jq -S . "$R/out/$name.base.report.json") <(jq -S . "$R/out/$name.new.report.json") || same=no
      cmp -s "$R/out/$name.base.saved" "$R/out/$name.new.saved" || same="$same, saved file differs"
      for v in read edit; do
        for side in base new; do magick "$R/out/$name.$side.$v.png" -shave 40x40 +repage "$R/out/$name.$side.$v.png"; done
        px=$(magick compare -metric AE "$R/out/$name.base.$v.png" "$R/out/$name.new.$v.png" null: 2>&1 | awk '{print int($1)}'); [[ $px == 0 ]] || same="$same, $v screenshot differs in $px px"
      done
      echo "$name: report and screenshots the same as $base: $same"; [[ $same == yes ]] || { fail=1; diff <(jq -S . "$R/out/$name.base.report.json") <(jq -S . "$R/out/$name.new.report.json") | head -20; }
    done
    exit $fail ;;
  shot) shot "$R/$2.png" && echo "$R/$2.png" ;;
  stop) pkill -f "^$APP" 2>/dev/null; HYPRLAND_INSTANCE_SIGNATURE=$(sig) hyprctl dispatch "hl.dsp.exit()" >/dev/null 2>&1; rm -f "$R/sig"; echo stopped ;;
  *) sed -n '2,12p' "$0" ;;
esac
