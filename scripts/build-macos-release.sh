#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
SWIFT_PACKAGE="$ROOT_DIR/apps/macos/RegletSetup"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"
BUILD_NUMBER="${REGLET_BUILD_NUMBER:-$(git -C "$ROOT_DIR" rev-list --count HEAD)}"
ARCH="${REGLET_ARCH:-$(uname -m)}"
WORK_DIR="$OUT_DIR/macos-release-$ARCH"
APP_BUNDLE="$WORK_DIR/Reglet.app"
ARCHIVE="$OUT_DIR/reglet-macos-$ARCH.app.zip"
DMG="$OUT_DIR/reglet-macos-$ARCH.dmg"
DMG_ROOT="$WORK_DIR/dmg-root"
DMG_BACKGROUND="$DMG_ROOT/.background/background.png"
ICON_PNG="$WORK_DIR/Reglet-1024.png"
ICONSET="$WORK_DIR/Reglet.iconset"
ICON_FILE="$APP_BUNDLE/Contents/Resources/Reglet.icns"
VOLUME_NAME="Reglet $VERSION"
MOUNTED=0

cleanup() {
  if [[ "$MOUNTED" == "1" ]]; then
    hdiutil detach -quiet -force "$MOUNT_DIR" || true
  fi
}

trap cleanup EXIT

case "$ARCH" in
  arm64) CLI_BINARY="$OUT_DIR/reglet-darwin-arm64" ;;
  x86_64) CLI_BINARY="$OUT_DIR/reglet-darwin-x64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS app packaging requires macOS." >&2
  exit 1
fi

if [[ ! -x "$CLI_BINARY" ]]; then
  echo "Missing CLI binary: $CLI_BINARY. Run bun run build:binaries first." >&2
  exit 1
fi

rm -rf "$WORK_DIR" "$ARCHIVE" "$DMG"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources"

swift build --package-path "$SWIFT_PACKAGE" -c release --arch "$ARCH"
SWIFT_BIN_DIR="$(swift build --package-path "$SWIFT_PACKAGE" -c release --arch "$ARCH" --show-bin-path)"

install -m 0755 "$SWIFT_BIN_DIR/RegletSetup" "$APP_BUNDLE/Contents/MacOS/RegletSetup"
install -m 0755 "$CLI_BINARY" "$APP_BUNDLE/Contents/Resources/reglet"
ditto "$SWIFT_BIN_DIR/RegletSetup_RegletSetup.bundle" "$APP_BUNDLE/Contents/Resources/RegletSetup_RegletSetup.bundle"

mkdir -p "$DMG_ROOT/.background" "$ICONSET"
swift "$ROOT_DIR/scripts/render-macos-release-assets.swift" "$DMG_BACKGROUND" "$ICON_PNG"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  sips -z "$double_size" "$double_size" "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ICON_FILE"

INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"
plutil -create xml1 "$INFO_PLIST"
plutil -insert CFBundleDevelopmentRegion -string en "$INFO_PLIST"
plutil -insert CFBundleDisplayName -string Reglet "$INFO_PLIST"
plutil -insert CFBundleExecutable -string RegletSetup "$INFO_PLIST"
plutil -insert CFBundleIdentifier -string com.elijahbutler.reglet "$INFO_PLIST"
plutil -insert CFBundleInfoDictionaryVersion -string 6.0 "$INFO_PLIST"
plutil -insert CFBundleIconFile -string Reglet "$INFO_PLIST"
plutil -insert CFBundleName -string Reglet "$INFO_PLIST"
plutil -insert CFBundlePackageType -string APPL "$INFO_PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$INFO_PLIST"
plutil -insert CFBundleVersion -string "$BUILD_NUMBER" "$INFO_PLIST"
plutil -insert LSMinimumSystemVersion -string 14.0 "$INFO_PLIST"
plutil -insert NSHighResolutionCapable -bool true "$INFO_PLIST"

# Ad-hoc signing makes the nested executables internally consistent but does not
# identify a developer, notarize the app, or satisfy Gatekeeper distribution.
codesign --force --sign - "$APP_BUNDLE/Contents/Resources/reglet"
codesign --force --sign - "$APP_BUNDLE/Contents/MacOS/RegletSetup"
codesign --force --sign - "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"

ditto -c -k --keepParent "$APP_BUNDLE" "$ARCHIVE"
ditto "$APP_BUNDLE" "$DMG_ROOT/Reglet.app"
ln -s /Applications "$DMG_ROOT/Applications"

RW_DMG="$WORK_DIR/reglet-rw.dmg"
MOUNT_DIR="$WORK_DIR/$VOLUME_NAME"
mkdir -p "$MOUNT_DIR"
hdiutil create -quiet -volname "$VOLUME_NAME" -srcfolder "$DMG_ROOT" -ov -format UDRW "$RW_DMG"
hdiutil attach -quiet -readwrite -noverify -noautoopen -mountpoint "$MOUNT_DIR" "$RW_DMG"
MOUNTED=1

osascript <<APPLESCRIPT
tell application "Finder"
  tell disk "$VOLUME_NAME"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {100, 100, 760, 520}
    set theViewOptions to the icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 104
    set text size of theViewOptions to 13
    set background picture of theViewOptions to file ".background:background.png"
    set position of item "Reglet.app" of container window to {190, 255}
    set position of item "Applications" of container window to {570, 255}
    close
    open
    update without registering applications
    delay 2
  end tell
end tell
APPLESCRIPT

sync
hdiutil detach -quiet "$MOUNT_DIR"
MOUNTED=0
hdiutil convert -quiet "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$DMG"

echo "Built unnotarized macOS app archive: $ARCHIVE"
echo "Built unnotarized macOS disk image: $DMG"
