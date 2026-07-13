#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
ENTRYPOINT="$ROOT_DIR/packages/cli/src/index.ts"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"

mkdir -p "$OUT_DIR"

build_target() {
  local target="$1"
  local output="$2"
  bun build "$ENTRYPOINT" --compile --target="$target" --define "process.env.REGLET_VERSION='${VERSION}'" --outfile "$OUT_DIR/$output"
}

build_target bun-darwin-arm64 reglet-darwin-arm64
build_target bun-darwin-x64 reglet-darwin-x64

echo "Built binaries in $OUT_DIR"
