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
#   dev/rig.sh islands               dialogs for code, formulas, properties, raw Markdown; popovers (on a copy)
#   dev/rig.sh m4                    tables, footnotes, paste and copy (on a copy)
#   dev/rig.sh m5                    context menu, formatting bar, undo and caret across modes, closing question, start mode
#   dev/rig.sh perf FILE…            the spec's performance figures, measured (on a copy)
#   dev/rig.sh graphic [real]        a figure drawn by Claude: dialog, draw, change, reference, insert
#   dev/rig.sh ghostmath             a continuation that closes a formula: taken, it is one
#   dev/rig.sh ghost [real]          the continuation offered while typing (a fixed answer; `real`: the model itself)
#   dev/rig.sh pdf                   PDFs: embeds in a note, the viewer, highlights from links, a link to a selection, outline, pages
#   dev/rig.sh mathtext              LaTeX Suite in the text, between dollars, with real keys
#   dev/rig.sh latex                 LaTeX Suite with real keys: mk / dm, snippets, tabstops, fraction, matrix, tabout
#   dev/rig.sh lists                 list items dragged between sub-lists, under an item, out a level, out of the list
#   dev/rig.sh blocks                blocks selected as wholes (handle click, then the keyboard); a click below the last block
#   dev/rig.sh zoom                  a note larger and smaller: Ctrl or Super with + − 0, the settings' text size
#   dev/rig.sh adjust                a PDF embed's region adjusted in its dialog, with the real pointer
#   dev/rig.sh textmenu              the menu for text in the reading view and in a field
#   dev/rig.sh shots                 screenshots of the newer parts, for looking at
#   dev/rig.sh more                  formula shape switch and picture copy, dialog size, editor search / brackets / completion, tick, tooltips
#   dev/rig.sh dnd                   moving a block by its handle, dropping picture files (on a copy)
#   dev/rig.sh prefs                 the settings and what follows them (put back afterwards)
#   dev/rig.sh edges                 edge cases: empty document, one island, file changed under a dialog, narrow window, keyboard only
#   dev/rig.sh clip                  plain-text paste, a pasted picture, a large paste (the nested session's clipboard)
#   dev/rig.sh link                  the link popover: show, edit, reference links, new link, remove (on a copy)
#   dev/rig.sh typing FILE…          time per keystroke and per save in the active mode (on a copy)
#   dev/rig.sh native                the browser's own typing path: spaces, deleting, hard break (on a copy)
#   dev/rig.sh folder                the active mode in a folder window (sidebar, other notes, back)
#   dev/rig.sh history               a folder made a project: commits after a quiet while, for a change from outside, at closing; the device named
#   dev/rig.sh sync                  a project linked to a repository elsewhere (a bare one here): pushed, pulled, both joined
#   dev/rig.sh share                  a note of a linked project shared from its window: the link, a password, shared no more
#   dev/rig.sh move                   a note dragged into a folder, a folder into another
#   dev/rig.sh github                signing in with GitHub from the settings, against a GitHub of the rig's own
#   dev/rig.sh tabs                  the tabs of a folder window: a note in its own tab, an empty one, a PDF where it was left, keys, closing, pulling
#   dev/rig.sh regress FILE…         reading view and source editor: same as on the branch BASE (default main)?
#   dev/rig.sh open FILE…            just open the files (MDVIEW_DEBUG on)
#   dev/rig.sh shot NAME             screenshot of the nested compositor
#   dev/rig.sh stop
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
shot() { local id; id=$(hyprctl clients -j | jq -r '.[] | select(.class=="aquamarine") | .stableId' | head -1); grim -T "$id" "$1"; }
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
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{open,palette,drawn,closed,board}.json
    app 90 MDVIEW_PROBE="$D/probe-board.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in open palette drawn closed; do for _ in $(seq 600); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.board.json ]] && break; sleep 0.1; done; sleep 0.3; shot "$R/out/board-$v.png"; done
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
  panel)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 60 MDVIEW_PROBE="$D/probe-panel.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in insert format; do
      for _ in $(seq 300); do [[ -f $R/out/$name.shot-$v.json || -f $R/out/$name.panel.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/panel-$v.png"
    done
    for _ in $(seq 300); do [[ -f $R/out/$name.panel.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    [[ -f $R/out/$name.panel.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.panel.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.panel.json" | grep -qv '^ok' ;;
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
  callout)
    name=callout.md; rm -rf "$R/work"; mkdir -p "$R/work"; printf '# Callouts\n\n> [!info]\n> An info.\n\nPlain text.\n\nEnd.\n' > "$R/work/$name"; rm -f "$R/out/$name".*.json
    app 60 MDVIEW_PROBE="$D/probe-callout.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 300); do [[ -f $R/out/$name.callout.json ]] && break; sleep 0.1; done
    pkill -f "^$APP" 2>/dev/null
    [[ -f $R/out/$name.callout.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.callout.json"
    ! jq -r '.steps[], (.error // empty)' "$R/out/$name.callout.json" | grep -qv '^ok' ;;
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
    # The page as it is on BASE (viewer.js, viewer.css), shown by this checkout's shell (MDVIEW_ASSETS) for the probe hook.
    # (A BASE from before the move to Tauri posts to WebKit's message handler: pointed at MdHost here.)
    shift; base="${BASE:-main}"; B="$R/base"; rm -rf "$B"; mkdir -p "$B"; top=$(git -C "$D" rev-parse --show-toplevel); rel=$(git -C "$D" rev-parse --show-prefix)
    for f in viewer.js viewer.css; do git -C "$top" show "$base:${rel%dev/}$f" > "$B/$f"; done
    sed -i 's/window\.webkit?\.messageHandlers?\.mdview?\.postMessage(/window.MdHost?.post(/g' "$B/viewer.js"; ln -s "$D/../vendor" "$B/vendor"; echo 'window.MdStrings = { t: (k) => k };' > "$B/strings.js"
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
