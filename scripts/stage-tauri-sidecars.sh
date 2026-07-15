#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BIN_DIR="$ROOT_DIR/apps/desktop/src-tauri/bin"

mkdir -p "$BIN_DIR"

stage_sidecar() {
  local source="$1"
  local triple="$2"
  local extension="${3:-}"
  local input="$DIST_DIR/$source"
  local output="$BIN_DIR/reglet-${triple}${extension}"
  if [[ ! -f "$input" ]]; then
    echo "Missing $input. Run bun run build:binaries before staging sidecars." >&2
    exit 1
  fi
  cp "$input" "$output"
  chmod +x "$output" || true
  echo "Staged $output"
}

stage_triple() {
  case "$1" in
    aarch64-apple-darwin) stage_sidecar reglet-darwin-arm64 "$1" ;;
    x86_64-apple-darwin) stage_sidecar reglet-darwin-x64 "$1" ;;
    x86_64-pc-windows-msvc) stage_sidecar reglet-windows-x64.exe "$1" .exe ;;
    x86_64-unknown-linux-gnu)
      if [[ -f "$DIST_DIR/reglet-linux-x64" ]]; then
        stage_sidecar reglet-linux-x64 "$1"
      else
        echo "Linux sidecar staging is configured; dist/reglet-linux-x64 is not built by the current release gate."
      fi
      ;;
    *) echo "Unsupported Tauri sidecar target: $1" >&2; exit 2 ;;
  esac
}

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=(aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu)
fi
for target in "${targets[@]}"; do
  stage_triple "$target"
done
