#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_INSTALL_DIR="${REGLET_APP_INSTALL_DIR:-$HOME/Applications}"
VERSION="${REGLET_VERSION:-$(git -C "$ROOT_DIR" describe --tags --abbrev=0 2>/dev/null || echo 0.1.0)}"
VERSION="${VERSION#v}"

usage() {
  echo "Usage: $0 <run|install>"
  echo "  run      Build the current Tauri desktop app and launch it from the build output."
  echo "  install  Build and install the current Tauri desktop app to ~/Applications."
}

detect_architecture() {
  case "$(uname -m)" in
    arm64)
      BIN_TARGET="darwin-arm64"
      TAURI_TARGET="aarch64-apple-darwin"
      ;;
    x86_64)
      BIN_TARGET="darwin-x64"
      TAURI_TARGET="x86_64-apple-darwin"
      ;;
    *)
      echo "Unsupported macOS architecture: $(uname -m)" >&2
      exit 1
      ;;
  esac
}

build_tauri_app() {
  export REGLET_VERSION="$VERSION"
  bash "$ROOT_DIR/scripts/build-binaries.sh" "$BIN_TARGET"
  bash "$ROOT_DIR/scripts/stage-tauri-sidecars.sh" "$TAURI_TARGET"
  bash "$ROOT_DIR/scripts/build-tauri-desktop.sh" "$TAURI_TARGET" app
  APP_BUNDLE="$ROOT_DIR/apps/desktop/src-tauri/target/$TAURI_TARGET/release/bundle/macos/Reglet.app"
  if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "Tauri did not produce $APP_BUNDLE" >&2
    exit 1
  fi
}

run_app() {
  echo "Launching Tauri app: $APP_BUNDLE"
  open "$APP_BUNDLE"
}

install_app() {
  local app_path="$APP_INSTALL_DIR/Reglet.app"
  mkdir -p "$APP_INSTALL_DIR"
  rm -rf "$app_path"
  ditto "$APP_BUNDLE" "$app_path"
  echo "Installed Tauri app: $app_path"

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
build_tauri_app

case "$1" in
  run) run_app ;;
  install) install_app ;;
  *) usage; exit 1 ;;
esac
