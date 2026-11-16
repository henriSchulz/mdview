#!/bin/sh
# Builds MdView.app next to this script (release). The page is read from the checkout at every start
# (MdViewRoot in Info.plist), as the Linux app does: a change to viewer/*.js needs no build.
set -e
cd "$(dirname "$0")"
swift build -c release
APP=MdView.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/MdView "$APP/Contents/MacOS/MdView"
ROOT=$(cd .. && pwd)
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Markdown Notes</string>
<key>CFBundleDisplayName</key><string>Markdown Notes</string>
<key>CFBundleIdentifier</key><string>com.henrischulz.mdview</string>
<key>CFBundleExecutable</key><string>MdView</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>MdViewRoot</key><string>$ROOT</string>
<key>CFBundleDocumentTypes</key><array><dict>
<key>CFBundleTypeName</key><string>Markdown</string>
<key>CFBundleTypeRole</key><string>Editor</string>
<key>LSItemContentTypes</key><array><string>net.daringfireball.markdown</string><string>public.plain-text</string></array>
<key>CFBundleTypeExtensions</key><array><string>md</string><string>markdown</string></array>
</dict></array>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "$APP built (page from $ROOT)"
