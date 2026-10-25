#!/usr/bin/env bash
# The name an installer has in a release: MarkdownNotes-<version>-<system>-<arch>.<ext>, so that
# the files sorted by name stand by system (Linux, then Windows; macOS one day). Tauri names them
# each its own way — Markdown.Notes-0.1.4-1.x86_64.rpm, Markdown.Notes_0.1.4_amd64.deb,
# Markdown.Notes_0.1.4_x64-setup.exe — and this says, for one of them, what it is called instead:
#
#   packaging/release-name.sh 0.1.4 src-tauri/target/release/bundle/deb/Markdown.Notes_0.1.4_amd64.deb
#   -> MarkdownNotes-0.1.4-linux-x64.deb
#
# x64 is Intel and AMD (Tauri: x86_64, amd64, x64), arm64 is ARM (aarch64, arm64). An installer's
# signature for the app's updates (Tauri: <installer>.sig, packaging/updates.md) is named after its
# installer: MarkdownNotes-0.1.4-linux-x64.AppImage.sig. A file it does not know is said, and it
# ends with 1: what cannot be named is not released under a wrong name.
# Both Release steps of .github/workflows/build.yml name their files with it; dev/tests/release-name.test.mjs
# feeds it the names Tauri gave the files of v0.1.4.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: release-name.sh <version> <file>" >&2; exit 2; }
version=$1
name=$(basename "$2")
sig=
if [[ $name == *.sig ]]; then sig=.sig name=${name%.sig}; fi

case "$name" in
  *-setup.exe) system=windows ext=-setup.exe ;;
  *.exe)       system=windows ext=.exe ;;
  *.msi)       system=windows ext=.msi ;;
  *.AppImage)  system=linux ext=.AppImage ;;
  *.deb)       system=linux ext=.deb ;;
  *.rpm)       system=linux ext=.rpm ;;
  *.dmg)       system=macos ext=.dmg ;;
  *) echo "release-name.sh: not an installer: $name" >&2; exit 1 ;;
esac

# the architecture: a word of its own in the name, between dots, dashes and underscores
if [[ $name =~ (^|[._-])(x86_64|amd64|x64)([._-]|$) ]]; then arch=x64
elif [[ $name =~ (^|[._-])(aarch64|arm64)([._-]|$) ]]; then arch=arm64
else echo "release-name.sh: no architecture in $name" >&2; exit 1
fi

echo "MarkdownNotes-$version-$system-$arch$ext$sig"
