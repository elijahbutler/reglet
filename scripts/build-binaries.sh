#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
ENTRYPOINT="$ROOT_DIR/packages/cli/src/index.ts"
if [[ -n "${REGLET_VERSION:-}" ]]; then
  VERSION="${REGLET_VERSION}"
elif [[ -n "${GITHUB_REF_NAME:-}" ]]; then
  VERSION="${GITHUB_REF_NAME}"
else
  VERSION="$(git describe --tags --abbrev=0 2>/dev/null || echo "0.5.2")"
fi
VERSION="${VERSION#v}"

mkdir -p "$OUT_DIR"

build_target() {
  local target="$1"
  local output="$2"
  bun build "$ENTRYPOINT" --compile --target="$target" --define "process.env.REGLET_VERSION='${VERSION}'" --outfile "$OUT_DIR/$output"
}

targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=(darwin-arm64 darwin-x64 windows-x64 linux-arm64 linux-x64)
fi

for target in "${targets[@]}"; do
  case "$target" in
    darwin-arm64) build_target bun-darwin-arm64 reglet-darwin-arm64 ;;
    darwin-x64) build_target bun-darwin-x64 reglet-darwin-x64 ;;
    windows-x64) build_target bun-windows-x64 reglet-windows-x64.exe ;;
    linux-arm64) build_target bun-linux-arm64 reglet-linux-arm64 ;;
    linux-x64) build_target bun-linux-x64 reglet-linux-x64 ;;
    *) echo "Unsupported binary target: $target" >&2; exit 2 ;;
  esac
done

echo "Built binaries in $OUT_DIR"
