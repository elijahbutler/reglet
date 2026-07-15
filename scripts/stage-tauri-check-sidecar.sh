#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
EXTENSION=""
if [[ "$TRIPLE" == *windows* ]]; then
  EXTENSION=".exe"
fi

BIN_DIR="$ROOT_DIR/apps/desktop/src-tauri/bin"
TARGET="$BIN_DIR/reglet-${TRIPLE}${EXTENSION}"
mkdir -p "$BIN_DIR"
RUSTC_BIN="$(rustup which rustc 2>/dev/null || command -v rustc)"
cp "$RUSTC_BIN" "$TARGET"
chmod +x "$TARGET" || true
echo "Staged non-release cargo-check sidecar at $TARGET"
