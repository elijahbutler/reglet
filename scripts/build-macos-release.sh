#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"
ARCH="${REGLET_ARCH:-$(uname -m)}"

case "$ARCH" in
  arm64)
    BIN_TARGET="darwin-arm64"
    TAURI_TARGET="aarch64-apple-darwin"
    DESKTOP_NAME="arm64"
    ;;
  x86_64)
    BIN_TARGET="darwin-x64"
    TAURI_TARGET="x86_64-apple-darwin"
    DESKTOP_NAME="x86_64"
    ;;
  *)
    echo "Unsupported macOS architecture: $ARCH" >&2
    exit 1
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS desktop packaging requires macOS." >&2
  exit 1
fi

export REGLET_VERSION="$VERSION"
bash "$ROOT_DIR/scripts/build-binaries.sh" "$BIN_TARGET"
bash "$ROOT_DIR/scripts/stage-tauri-sidecars.sh" "$TAURI_TARGET"
bash "$ROOT_DIR/scripts/build-tauri-desktop.sh" "$TAURI_TARGET" app,dmg

APP_BUNDLE="$ROOT_DIR/apps/desktop/src-tauri/target/$TAURI_TARGET/release/bundle/macos/Reglet.app"
DMG="$(find "$ROOT_DIR/apps/desktop/src-tauri/target/$TAURI_TARGET/release/bundle/dmg" -name '*.dmg' | head -n 1)"
if [[ ! -d "$APP_BUNDLE" || -z "$DMG" || ! -f "$DMG" ]]; then
  echo "Tauri macOS build did not produce the expected app and dmg artifacts." >&2
  exit 1
fi

mkdir -p "$OUT_DIR/desktop"
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.app.zip"
cp "$DMG" "$OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.dmg"

if [[ "${REGLET_CREATE_UPDATER_ARTIFACTS:-0}" == "1" ]]; then
  UPDATER_ARCHIVE="$(find "$ROOT_DIR/apps/desktop/src-tauri/target/$TAURI_TARGET/release/bundle/macos" -maxdepth 1 -name '*.app.tar.gz' | head -n 1)"
  if [[ -z "$UPDATER_ARCHIVE" || ! -f "$UPDATER_ARCHIVE" || ! -f "$UPDATER_ARCHIVE.sig" ]]; then
    echo "Tauri macOS build did not produce signed updater artifacts." >&2
    exit 1
  fi
  cp "$UPDATER_ARCHIVE" "$OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.app.tar.gz"
  cp "$UPDATER_ARCHIVE.sig" "$OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.app.tar.gz.sig"
  echo "Built signed Tauri macOS updater: $OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.app.tar.gz"
fi

echo "Built unnotarized Tauri macOS app archive: $OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.app.zip"
echo "Built unnotarized Tauri macOS disk image: $OUT_DIR/desktop/reglet-desktop-macos-$DESKTOP_NAME.dmg"
