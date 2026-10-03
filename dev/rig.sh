#!/bin/bash
# Development rig: runs this checkout's mdview inside a nested Hyprland, with
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
#   dev/rig.sh blocks                blocks selected as wholes (handle click, then the keyboard); a click below the last block
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
#   dev/rig.sh regress FILE…         reading view and source editor: same as on the branch BASE (default main)?
#   dev/rig.sh open FILE…            just open the files (MDVIEW_DEBUG on)
#   dev/rig.sh shot NAME             screenshot of the nested compositor
#   dev/rig.sh stop
D="$(cd "$(dirname "$0")" && pwd)"; APP="$D/../mdview.py"
R="${MDVIEW_RIG:-$HOME/.cache/mdview-rig}"; H="$XDG_RUNTIME_DIR/hypr"; WS="${MDVIEW_RIG_WS:-name:spare}"
mkdir -p "$R/out" "$R/state"
sig() { cat "$R/sig" 2>/dev/null; }
wl() { HYPRLAND_INSTANCE_SIGNATURE= hyprctl instances -j | jq -r --arg s "$(sig)" '.[] | select(.instance==$s) | .wl_socket'; }
app() { # app SECONDS ENV… -- FILE…
  local secs=$1; shift; local envs=(); while [[ $1 != -- ]]; do envs+=("$1"); shift; done; shift
  env -u HYPRLAND_INSTANCE_SIGNATURE WAYLAND_DISPLAY="$(wl)" HYPRLAND_INSTANCE_SIGNATURE="$(sig)" GDK_BACKEND=wayland \
    XDG_STATE_HOME="$R/state" MDVIEW_DEBUG=1 "${envs[@]}" \
    setsid -f timeout "$secs" dbus-run-session -- python3 "$APP" "$@" >"$R/app.log" 2>&1
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
      pkill -f "python3 $APP" 2>/dev/null; sleep 0.3
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
    pkill -f "python3 $APP" 2>/dev/null
    [[ -f $R/out/$name.modes.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '(.results[] | (if .ok then "ok   " else "FAIL " end) + .name + (if .ok then "" else "  " + (.detail | tostring) end)), (.error // empty)' "$R/out/$name.modes.json"
    jq -e .pass "$R/out/$name.modes.json" >/dev/null ;;
  edit)
    name=editing.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name.edit.json"
    app 60 MDVIEW_PROBE="$D/probe-edit.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 400); do [[ -f $R/out/$name.edit.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
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
    pkill -f "python3 $APP" 2>/dev/null
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
    pkill -f "python3 $APP" 2>/dev/null
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
    [[ -f $R/out/$name.m5.json ]] || { pkill -f "python3 $APP" 2>/dev/null; echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.m5.json"
    # Apply in the closing question: the dialog's change is saved and the window closes by itself
    gone=FAIL; for _ in $(seq 60); do [[ $(HYPRLAND_INSTANCE_SIGNATURE=$(sig) hyprctl clients -j | jq length) == 0 ]] && { gone="ok  "; break; }; sleep 0.1; done
    echo "$gone the window closed after Apply"; pkill -f "python3 $APP" 2>/dev/null
    grep -q '^let a = 2;$' "$R/work/$name" && echo "ok   the dialog's change is in the file" || echo "FAIL the dialog's change is not in the file"
    # the next start opens in the mode last used
    app 30 MDVIEW_PROBE="$D/probe-mode.js" MDVIEW_PROBE_OUT="$R/out" MDVIEW_PROBE_MODE=1 -- "$R/work/$name"
    for _ in $(seq 100); do [[ -f $R/out/$name.mode.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
    [[ $(jq -r '.view' "$R/out/$name.mode.json" 2>/dev/null) == active ]] && echo "ok   the next window opens in the mode last used" || echo "FAIL the next window opened in: $(cat "$R/out/$name.mode.json" 2>/dev/null)"
    WAYLAND_DISPLAY="$(wl)" wl-copy --clear 2>/dev/null
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.m5.json"; [[ $gone == "ok  " ]] || echo FAIL; grep -q '^let a = 2;$' "$R/work/$name" || echo FAIL; [[ $(jq -r '.view' "$R/out/$name.mode.json" 2>/dev/null) == active ]] || echo FAIL; } | grep -qv '^ok' ;;
  blocks)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{selected,heading,blocks}.json
    app 90 MDVIEW_PROBE="$D/probe-blocks.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in selected heading; do for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.blocks.json ]] && break; sleep 0.1; done; sleep 0.6; shot "$R/out/blocks-$v.png"; done
    for _ in $(seq 500); do [[ -f $R/out/$name.blocks.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
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
    pkill -f "python3 $APP" 2>/dev/null
    jq -r '.error // "ok"' "$R/out/$name.shots.json" ;;
  more)
    name=more.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{picture,more}.json "$R/out/snapshot.png"
    app 90 MDVIEW_PROBE="$D/probe-more.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 500); do [[ -f $R/out/$name.more.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
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
    app 90 MDVIEW_PROBE="$D/probe-dnd.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 500); do [[ -f $R/out/$name.dnd.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st"
    [[ -f $R/out/$name.dnd.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.dnd.json"
    files=$(cd "$R/work" && find . -type f | sort | tr '\n' ' ')
    [[ $files == "./assets/drop.png ./drop.png ./m5.md " ]] && echo "ok   the pictures were copied where they belong" || echo "FAIL files beside the note: $files"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.dnd.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.dnd.json"; [[ $files == "./assets/drop.png ./drop.png ./m5.md " ]] || echo FAIL; cmp -s <(jq -j '.saved // ""' "$R/out/$name.dnd.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  prefs)
    name=m5.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{dialog,slash,prefs}.json
    app 90 MDVIEW_PROBE="$D/probe-prefs.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in dialog slash; do
      for _ in $(seq 300); do [[ -f $R/out/$name.$v.json || -f $R/out/$name.prefs.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/prefs-$v.png"
    done
    for _ in $(seq 500); do [[ -f $R/out/$name.prefs.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
    st="$R/state/mdview/state.json"; [[ -f $st ]] && jq 'del(.active)' "$st" > "$st.new" && mv "$st.new" "$st" # (the settings of the test never stay)
    [[ -f $R/out/$name.prefs.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.prefs.json"
    cmp -s <(jq -j '.saved // ""' "$R/out/$name.prefs.json") "$R/work/$name" && echo "ok   the file on disk is the saved document" || echo "FAIL the file on disk differs from the saved document"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.prefs.json"; cmp -s <(jq -j '.saved // ""' "$R/out/$name.prefs.json") "$R/work/$name" || echo FAIL; } | grep -qv '^ok' ;;
  edges)
    rc=0
    for name in empty.md only-code.md m5.md; do
      rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{narrow,edges}.json
      app 90 MDVIEW_PROBE="$D/probe-edges.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
      if [[ $name == m5.md ]]; then for _ in $(seq 400); do [[ -f $R/out/$name.narrow.json || -f $R/out/$name.edges.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/edges-narrow.png"; fi
      for _ in $(seq 600); do [[ -f $R/out/$name.edges.json ]] && break; sleep 0.1; done
      pkill -f "python3 $APP" 2>/dev/null; sleep 0.3
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
    pkill -f "python3 $APP" 2>/dev/null
    WAYLAND_DISPLAY="$(wl)" wl-copy --clear 2>/dev/null
    [[ -f $R/out/$name.clip.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.clip.json"
    img=$(ls "$R/work"/pasted-*.png 2>/dev/null | head -1)
    [[ -n $img ]] && cmp -s "$img" "$R/out/clip.png" && echo "ok   the picture is a file beside the note" || echo "FAIL no picture file beside the note"
    ! { jq -r '.steps[], (.error // "ok")' "$R/out/$name.clip.json"; [[ -n $img ]] || echo FAIL; } | grep -qv '^ok' ;;
  link)
    name=editing.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out/$name".{info,form,link}.json
    app 40 MDVIEW_PROBE="$D/probe-link.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for v in info form; do
      for _ in $(seq 150); do [[ -f $R/out/$name.$v.json ]] && break; sleep 0.1; done; sleep 0.7; shot "$R/out/link-$v.png"
    done
    for _ in $(seq 200); do [[ -f $R/out/$name.link.json ]] && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
    [[ -f $R/out/$name.link.json ]] || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out/$name.link.json"
    ! jq -r '.steps[], (.error // "ok")' "$R/out/$name.link.json" | grep -qv '^ok' ;;
  perf)
    shift
    for f in "$@"; do
      name=$(basename "$f"); rm -rf "$R/work"; mkdir -p "$R/work"; cp "$f" "$R/work/$name"; rm -f "$R/out/$name.perf.json"
      app 240 MDVIEW_PROBE="$D/probe-perf.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
      for _ in $(seq 2300); do [[ -f $R/out/$name.perf.json ]] && break; sleep 0.1; done
      pkill -f "python3 $APP" 2>/dev/null; sleep 0.3
      [[ -f $R/out/$name.perf.json ]] && jq -c . "$R/out/$name.perf.json" || echo "{\"file\":\"$name\",\"error\":\"no report\"}"
      cmp -s "$f" "$R/work/$name" || echo "{\"file\":\"$name\",\"error\":\"the file on disk changed\"}"
    done ;;
  typing)
    shift
    for f in "$@"; do
      name=$(basename "$f"); rm -rf "$R/work"; mkdir -p "$R/work"; cp "$f" "$R/work/$name"; rm -f "$R/out/$name.typing.json"
      app 60 MDVIEW_PROBE="$D/probe-typing.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
      for _ in $(seq 400); do [[ -f $R/out/$name.typing.json ]] && break; sleep 0.1; done
      pkill -f "python3 $APP" 2>/dev/null; sleep 0.3
      [[ -f $R/out/$name.typing.json ]] && jq -c . "$R/out/$name.typing.json" || echo "{\"file\":\"$name\",\"error\":\"no report\"}"
    done ;;
  native)
    name=editing.md; rm -rf "$R/work"; mkdir -p "$R/work"; cp "$D/tests/fixtures/$name" "$R/work/$name"; rm -f "$R/out"/*.native.json
    app 40 MDVIEW_PROBE="$D/probe-native.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
    for _ in $(seq 200); do ls "$R/out"/*.native.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
    ls "$R/out"/*.native.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.native.json
    ! jq -r '.steps[], (.error // "ok")' "$R/out"/*.native.json | grep -qv '^ok' ;;
  folder)
    rm -rf "$R/work"; mkdir -p "$R/work/notes/sub"; cp "$D"/tests/fixtures/{basics,obsidian,math}.md "$R/work/notes/"; cp "$D/tests/fixtures/footnotes.md" "$R/work/notes/sub/"
    rm -f "$R/out"/*.folder.json
    app 40 MDVIEW_PROBE="$D/probe-folder.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/notes"
    for _ in $(seq 200); do ls "$R/out"/*.folder.json >/dev/null 2>&1 && break; sleep 0.1; done
    pkill -f "python3 $APP" 2>/dev/null
    ls "$R/out"/*.folder.json >/dev/null 2>&1 || { echo "no report"; tail -5 "$R/app.log"; exit 1; }
    jq -r '.steps[], (.error // empty)' "$R/out"/*.folder.json
    ! jq -r '.steps[], (.error // empty)' "$R/out"/*.folder.json | grep -qv '^ok' ;;
  regress)
    # The page as it is on BASE (viewer.js, viewer.css), started by this checkout's mdview.py for the probe hook.
    shift; base="${BASE:-main}"; B="$R/base"; rm -rf "$B"; mkdir -p "$B"; top=$(git -C "$D" rev-parse --show-toplevel); rel=$(git -C "$D" rev-parse --show-prefix)
    for f in viewer.js viewer.css; do git -C "$top" show "$base:${rel%dev/}$f" > "$B/$f"; done
    cp "$D/../mdview.py" "$B/"; ln -s "$D/../vendor" "$B/vendor"; echo 'window.MdStrings = { t: (k) => k };' > "$B/strings.js"
    fail=0
    for f in "$@"; do
      name=$(basename "$f")
      for side in base new; do
        rm -rf "$R/work"; mkdir -p "$R/work"; cp "$f" "$R/work/$name"; rm -f "$R/out/$name".{read,edit,report}.json
        [[ $side == base ]] && APP="$B/mdview.py" || APP="$D/../mdview.py"
        app 60 MDVIEW_PROBE="$D/probe-baseline.js" MDVIEW_PROBE_OUT="$R/out" -- "$R/work/$name"
        for _ in $(seq 250); do [[ -f $R/out/$name.read.json ]] && break; sleep 0.1; done; sleep 0.8; shot "$R/out/$name.$side.read.png"
        for _ in $(seq 250); do [[ -f $R/out/$name.edit.json ]] && break; sleep 0.1; done; sleep 0.8; shot "$R/out/$name.$side.edit.png"
        for _ in $(seq 300); do [[ -f $R/out/$name.report.json ]] && break; sleep 0.1; done
        pkill -f "python3 $APP" 2>/dev/null; sleep 0.3
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
  stop) pkill -f "python3 $APP" 2>/dev/null; HYPRLAND_INSTANCE_SIGNATURE=$(sig) hyprctl dispatch "hl.dsp.exit()" >/dev/null 2>&1; rm -f "$R/sig"; echo stopped ;;
  *) sed -n '2,12p' "$0" ;;
esac
