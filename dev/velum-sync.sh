#!/usr/bin/env bash
# Copies Velum's generated roles into the checkout (velum.css) and stamps the Velum commit, so the
# app ships them itself (no dependency on ~/.local/share/velum at run time).
#   dev/velum-sync.sh            from ~/Projects/velum (built first: python3 build/velum_build.py)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
velum=${VELUM_REPO:-$HOME/Projects/velum}
src="$velum/dist/css/velum.css"
[[ -f $src ]] || { echo "velum-sync: $src missing — build Velum first (python3 build/velum_build.py)"; exit 1; }
hash=$(git -C "$velum" rev-parse --short HEAD)
{
  printf '/* Velum roles for the page: a copy of ~/Projects/velum/dist/css/velum.css (velum %s), kept by dev/velum-sync.sh.\n' "$hash"
  printf ' * Do not edit here — change the tokens in the Velum repo, build, sync. The app stays self-contained: this copy\n'
  printf ' * ships with it. viewer/roles.css maps the app'"'"'s own variables onto these roles when <html> carries data-velum. */\n'
  cat "$src"
} > "$here/velum.css"
echo "velum.css ← velum $hash ($(wc -l < "$here/velum.css") lines)"
