#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <target-triple> <bundle-list>" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$1"
BUNDLES="$2"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid desktop release version: $VERSION" >&2
  exit 1
fi

export REGLET_VERSION="$VERSION"
CONFIG_ARGS=(--config "{\"version\":\"$VERSION\"}")
if [[ "${REGLET_CREATE_UPDATER_ARTIFACTS:-0}" == "1" ]]; then
  if [[ -z "${REGLET_UPDATER_PUBLIC_KEY:-}" || -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    echo "Signed updater builds require REGLET_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY." >&2
    exit 1
  fi
  UPDATER_CONFIG="$(bun "$ROOT_DIR/scripts/generate-tauri-updater-config.ts")"
  CONFIG_ARGS+=(--config "$UPDATER_CONFIG")
fi

bun run --cwd "$ROOT_DIR/apps/desktop" tauri build \
  --target "$TARGET" \
  --bundles "$BUNDLES" \
  "${CONFIG_ARGS[@]}"
