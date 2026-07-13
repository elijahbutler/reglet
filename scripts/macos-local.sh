#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SWIFT_PACKAGE="$ROOT_DIR/apps/macos/RegletSetup"
CLI_INSTALL_DIR="${REGLET_CLI_INSTALL_DIR:-$HOME/.local/bin}"
APP_INSTALL_DIR="${REGLET_APP_INSTALL_DIR:-$HOME/Applications}"
VERSION="${REGLET_VERSION:-$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null || echo 0.1.0)}"
VERSION="${VERSION#v}"
BUILD_NUMBER="${REGLET_BUILD_NUMBER:-$(git -C "$ROOT_DIR" rev-list --count HEAD 2>/dev/null || echo 1)}"
STAGING_DIR=""

cleanup() {
  if [[ -n "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
}

trap cleanup EXIT

usage() {
  echo "Usage: $0 <run|install>"
  echo "  run      Build and install the current CLI, then run the Swift app from source."
  echo "  install  Build and install the CLI plus an ad-hoc-signed Reglet.app."
}

detect_architecture() {
  case "$(uname -m)" in
    arm64)
      CLI_TARGET="bun-darwin-arm64"
      CLI_ARTIFACT="reglet-darwin-arm64"
      ;;
    x86_64)
      CLI_TARGET="bun-darwin-x64"
      CLI_ARTIFACT="reglet-darwin-x64"
      ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

build_and_install_cli() {
  local cli_output="$ROOT_DIR/dist/$CLI_ARTIFACT"
  mkdir -p "$ROOT_DIR/dist" "$CLI_INSTALL_DIR"
  bun build "$ROOT_DIR/packages/cli/src/index.ts" \
    --compile \
    --target="$CLI_TARGET" \
    --define "process.env.REGLET_VERSION='$VERSION'" \
    --outfile "$cli_output"
  install -m 755 "$cli_output" "$CLI_INSTALL_DIR/reglet"
  CLI_PATH="$CLI_INSTALL_DIR/reglet"
  echo "Installed CLI: $CLI_PATH"
}

run_from_source() {
  echo "Launching Reglet from source..."
  exec env REGLET_BINARY="$CLI_PATH" swift run --package-path "$SWIFT_PACKAGE" RegletSetup
}

install_app() {
  swift build -c release --package-path "$SWIFT_PACKAGE"

  local bin_dir
  bin_dir="$(swift build -c release --show-bin-path --package-path "$SWIFT_PACKAGE")"
  local app_path="$APP_INSTALL_DIR/Reglet.app"
  STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/reglet-app.XXXXXX")"

  local staged_app="$STAGING_DIR/Reglet.app"
  mkdir -p "$staged_app/Contents/MacOS" "$staged_app/Contents/Resources"
  install -m 755 "$bin_dir/RegletSetup" "$staged_app/Contents/MacOS/RegletSetup"
  install -m 755 "$CLI_PATH" "$staged_app/Contents/Resources/reglet"
  ditto "$bin_dir/RegletSetup_RegletSetup.bundle" "$staged_app/Contents/Resources/RegletSetup_RegletSetup.bundle"

  local info_plist="$staged_app/Contents/Info.plist"
  plutil -create xml1 "$info_plist"
  plutil -insert CFBundleDevelopmentRegion -string en "$info_plist"
  plutil -insert CFBundleDisplayName -string Reglet "$info_plist"
  plutil -insert CFBundleExecutable -string RegletSetup "$info_plist"
  plutil -insert CFBundleIdentifier -string com.elijahbutler.reglet "$info_plist"
  plutil -insert CFBundleInfoDictionaryVersion -string 6.0 "$info_plist"
  plutil -insert CFBundleName -string Reglet "$info_plist"
  plutil -insert CFBundlePackageType -string APPL "$info_plist"
  plutil -insert CFBundleShortVersionString -string "$VERSION" "$info_plist"
  plutil -insert CFBundleVersion -string "$BUILD_NUMBER" "$info_plist"
  plutil -insert LSMinimumSystemVersion -string 14.0 "$info_plist"
  plutil -insert NSHighResolutionCapable -bool true "$info_plist"

  codesign --force --deep --sign - "$staged_app"
  mkdir -p "$APP_INSTALL_DIR"
  rm -rf "$app_path"
  ditto "$staged_app" "$app_path"
  echo "Installed app: $app_path"

  if [[ "${REGLET_NO_OPEN:-0}" != "1" ]]; then
    open "$app_path"
  fi
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This command only supports macOS." >&2
  exit 1
fi

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

detect_architecture
build_and_install_cli

case "$1" in
  run) run_from_source ;;
  install) install_app ;;
  *) usage; exit 1 ;;
esac
