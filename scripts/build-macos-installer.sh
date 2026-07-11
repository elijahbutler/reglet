#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
APP_DIR="$ROOT_DIR/apps/macos/RegletSetup"
WORK_DIR="$OUT_DIR/macos-installer"
PAYLOAD_DIR="$WORK_DIR/payload"
APP_BUNDLE="$PAYLOAD_DIR/Applications/Reglet Setup.app"
VERSION="${REGLET_VERSION:-0.1.0}"
ARCH="$(uname -m)"

case "$ARCH" in
  arm64) CLI_BINARY="$OUT_DIR/reglet-darwin-arm64" ;;
  x86_64) CLI_BINARY="$OUT_DIR/reglet-darwin-x64" ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS installer packaging requires macOS." >&2
  exit 1
fi

if [[ ! -x "$CLI_BINARY" ]]; then
  echo "Missing CLI binary: $CLI_BINARY" >&2
  echo "Run: bun run build:binaries" >&2
  exit 1
fi

rm -rf "$WORK_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$PAYLOAD_DIR/usr/local/bin"

swift build \
  --package-path "$APP_DIR" \
  -c release \
  --arch "$ARCH"

SWIFT_BIN="$APP_DIR/.build/$ARCH-apple-macosx/release/RegletSetup"
if [[ ! -x "$SWIFT_BIN" ]]; then
  SWIFT_BIN="$APP_DIR/.build/release/RegletSetup"
fi
if [[ ! -x "$SWIFT_BIN" ]]; then
  echo "Missing RegletSetup build output." >&2
  exit 1
fi

install -m 0755 "$CLI_BINARY" "$PAYLOAD_DIR/usr/local/bin/reglet"
install -m 0755 "$SWIFT_BIN" "$APP_BUNDLE/Contents/MacOS/RegletSetup"

cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>RegletSetup</string>
  <key>CFBundleIdentifier</key>
  <string>com.reglet.setup</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Reglet Setup</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

pkgbuild \
  --root "$PAYLOAD_DIR" \
  --identifier "com.reglet.installer" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUT_DIR/reglet-macos-$ARCH.pkg"

ditto -c -k --keepParent "$APP_BUNDLE" "$OUT_DIR/reglet-setup-macos-$ARCH.app.zip"

echo "Built $OUT_DIR/reglet-macos-$ARCH.pkg"
echo "Built $OUT_DIR/reglet-setup-macos-$ARCH.app.zip"
