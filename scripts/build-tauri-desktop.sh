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
bun run --cwd "$ROOT_DIR/apps/desktop" tauri build \
  --target "$TARGET" \
  --bundles "$BUNDLES" \
  --config "{\"version\":\"$VERSION\"}"
