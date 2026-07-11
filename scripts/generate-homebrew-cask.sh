#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
CASK_DIR="$OUT_DIR/homebrew/Casks"
CASK_PATH="$CASK_DIR/reglet.rb"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"

ARM64_APP="$OUT_DIR/reglet-macos-arm64.app.zip"
X64_APP="$OUT_DIR/reglet-macos-x86_64.app.zip"

if [[ ! -f "$ARM64_APP" || ! -f "$X64_APP" ]]; then
  echo "Missing macOS app archives. Run the macOS installer build for arm64 and x86_64 first." >&2
  exit 1
fi

ARM64_SHA="$(shasum -a 256 "$ARM64_APP" | awk '{print $1}')"
X64_SHA="$(shasum -a 256 "$X64_APP" | awk '{print $1}')"

mkdir -p "$CASK_DIR"

cat > "$CASK_PATH" <<RUBY
cask "reglet" do
  version "$VERSION"

  on_arm do
    sha256 "$ARM64_SHA"
    url "https://github.com/elijahbutler/reglet/releases/download/v#{version}/reglet-macos-arm64.app.zip"
  end

  on_intel do
    sha256 "$X64_SHA"
    url "https://github.com/elijahbutler/reglet/releases/download/v#{version}/reglet-macos-x86_64.app.zip"
  end

  name "Reglet"
  desc "Local-first control plane for AI agent rules, skills, and MCP configs"
  homepage "https://github.com/elijahbutler/reglet"

  depends_on macos: :sonoma
  no_quarantine

  app "Reglet.app"
  binary "#{appdir}/Reglet.app/Contents/Resources/reglet"
end
RUBY

echo "Generated $CASK_PATH"
