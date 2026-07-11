#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
APP_DIR="$ROOT_DIR/apps/macos/RegletSetup"
WORK_DIR="$OUT_DIR/macos-installer"
PAYLOAD_DIR="$WORK_DIR/payload"
APP_BUNDLE="$PAYLOAD_DIR/Applications/Reglet.app"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"
ARCH="${REGLET_ARCH:-$(uname -m)}"
PKG_PATH="$OUT_DIR/reglet-macos-$ARCH.pkg"
UNSIGNED_PKG_PATH="$WORK_DIR/reglet-macos-$ARCH-unsigned.pkg"
APP_ZIP_PATH="$OUT_DIR/reglet-macos-$ARCH.app.zip"

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
install -m 0755 "$CLI_BINARY" "$APP_BUNDLE/Contents/Resources/reglet"

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
  <string>com.reglet.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Reglet</string>
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

if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
  codesign --force --timestamp --options runtime --sign "$CODESIGN_IDENTITY" "$PAYLOAD_DIR/usr/local/bin/reglet"
  codesign --force --timestamp --options runtime --sign "$CODESIGN_IDENTITY" "$APP_BUNDLE/Contents/Resources/reglet"
  codesign --force --timestamp --options runtime --sign "$CODESIGN_IDENTITY" "$APP_BUNDLE/Contents/MacOS/RegletSetup"
  codesign --force --timestamp --options runtime --sign "$CODESIGN_IDENTITY" "$APP_BUNDLE"
  codesign --verify --strict --verbose=2 "$APP_BUNDLE"
else
  echo "CODESIGN_IDENTITY is not set; ad-hoc signing the completed app bundle." >&2
  codesign --force --sign - "$APP_BUNDLE/Contents/Resources/reglet"
  codesign --force --sign - "$APP_BUNDLE/Contents/MacOS/RegletSetup"
  codesign --force --sign - "$APP_BUNDLE"
  codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"
fi

pkgbuild \
  --root "$PAYLOAD_DIR" \
  --identifier "com.reglet.installer" \
  --version "$VERSION" \
  --install-location "/" \
  "$UNSIGNED_PKG_PATH"

if [[ -n "${PRODUCTSIGN_IDENTITY:-}" ]]; then
  productsign --sign "$PRODUCTSIGN_IDENTITY" "$UNSIGNED_PKG_PATH" "$PKG_PATH"
  pkgutil --check-signature "$PKG_PATH"
else
  echo "PRODUCTSIGN_IDENTITY is not set; publishing an unsigned package." >&2
  cp "$UNSIGNED_PKG_PATH" "$PKG_PATH"
fi

if [[ -n "${NOTARY_KEY_PATH:-}" && -n "${APPLE_NOTARY_KEY_ID:-}" && -n "${APPLE_NOTARY_ISSUER_ID:-}" ]]; then
  xcrun notarytool submit "$PKG_PATH" \
    --key "$NOTARY_KEY_PATH" \
    --key-id "$APPLE_NOTARY_KEY_ID" \
    --issuer "$APPLE_NOTARY_ISSUER_ID" \
    --wait
  xcrun stapler staple "$PKG_PATH"
  xcrun stapler validate "$PKG_PATH"
else
  echo "Notary credentials are not set; package is not notarized." >&2
fi

ditto -c -k --keepParent "$APP_BUNDLE" "$APP_ZIP_PATH"

echo "Built $PKG_PATH"
echo "Built $APP_ZIP_PATH"
