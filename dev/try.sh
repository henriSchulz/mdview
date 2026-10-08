#!/bin/bash
# Opens files with this checkout's mdview as a separate instance (own D-Bus
# session), next to the installed one: dev/try.sh FILE_OR_FOLDER…
# Without the session of its own the files would be handed to the mdview that
# is running already — the installed one — and shown by that.
D="$(cd "$(dirname "$0")" && pwd)"
APP="$D/../src-tauri/target/debug/mdview"; [[ -x $APP ]] || APP="$D/../src-tauri/target/release/mdview"
[[ -x $APP ]] || { echo "not built: cargo build in $D/../src-tauri"; exit 1; }
exec dbus-run-session -- "$APP" "$@"
