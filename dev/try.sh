#!/bin/bash
# Opens files with this checkout's mdview as a separate instance (own D-Bus
# session), next to the installed one: dev/try.sh FILE_OR_FOLDER…
exec dbus-run-session -- python3 "$(cd "$(dirname "$0")" && pwd)/../mdview.py" "$@"
