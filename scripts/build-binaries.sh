#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
ENTRYPOINT="$ROOT_DIR/packages/cli/src/index.ts"

mkdir -p "$OUT_DIR"

build_target() {
  local target="$1"
  local output="$2"
  bun build "$ENTRYPOINT" --compile --target="$target" --outfile "$OUT_DIR/$output"
}

build_target bun-darwin-arm64 reglet-darwin-arm64
build_target bun-darwin-x64 reglet-darwin-x64
build_target bun-windows-x64 reglet-windows-x64.exe

echo "Built binaries in $OUT_DIR"
