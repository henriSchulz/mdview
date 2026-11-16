#!/bin/sh
# Builds MdView.app next to this script (release): ./build.sh [--install]
#   --install   also copies it to ~/Applications (the launcher bin/mdview-mac then finds it)
# The page is read from the checkout at every start (MdViewRoot in Info.plist), as the Linux app does:
# a change to viewer/*.js needs no build. Move or delete the checkout and the app shows nothing.
set -e
cd "$(dirname "$0")"
swift build -c release
APP=MdView.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/MdView "$APP/Contents/MacOS/MdView"
ROOT=$(cd .. && pwd)

# the icon: the Linux app's, as an .icns
ICON=../src-tauri/icons/icon.png
SET=$(mktemp -d)/MdView.iconset
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICON" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$ICON" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/MdView.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Markdown Notes</string>
<key>CFBundleDisplayName</key><string>Markdown Notes</string>
<key>CFBundleIdentifier</key><string>com.henrischulz.mdview</string>
<key>CFBundleExecutable</key><string>MdView</string>
<key>CFBundleIconFile</key><string>MdView</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSSupportsAutomaticTermination</key><false/>
<key>MdViewRoot</key><string>$ROOT</string>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>Markdown Notes</string>
<key>CFBundleURLSchemes</key><array><string>mdview</string><string>mdnotes</string></array>
</dict></array>
<key>CFBundleDocumentTypes</key><array>
<dict>
<key>CFBundleTypeName</key><string>Markdown</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string></array>
<key>CFBundleTypeExtensions</key><array><string>md</string><string>markdown</string><string>mdown</string><string>mkd</string><string>mkdn</string><string>mdx</string></array>
</dict>
<dict>
<key>CFBundleTypeName</key><string>Plain Text</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSHandlerRank</key><string>Alternate</string>
<key>LSItemContentTypes</key><array><string>public.plain-text</string></array>
</dict>
<dict>
<key>CFBundleTypeName</key><string>Folder</string>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>LSHandlerRank</key><string>None</string>
<key>LSItemContentTypes</key><array><string>public.folder</string></array>
</dict>
<dict>
<key>CFBundleTypeName</key><string>PDF</string>
<key>CFBundleTypeRole</key><string>Viewer</string>
<key>LSHandlerRank</key><string>None</string>
<key>LSItemContentTypes</key><array><string>com.adobe.pdf</string></array>
</dict>
</array>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "$APP built (page from $ROOT)"

if [ "$1" = "--install" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/$APP"
  cp -R "$APP" "$HOME/Applications/$APP"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$HOME/Applications/$APP" >/dev/null 2>&1 || true
  echo "installed: $HOME/Applications/$APP"
fi
