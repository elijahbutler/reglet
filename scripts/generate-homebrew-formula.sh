#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist"
FORMULA_DIR="$OUT_DIR/homebrew/Formula"
FORMULA_PATH="$FORMULA_DIR/reglet.rb"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-0.1.0}}"
VERSION="${VERSION#v}"

ARM64_BINARY="$OUT_DIR/reglet-darwin-arm64"
X64_BINARY="$OUT_DIR/reglet-darwin-x64"

if [[ ! -f "$ARM64_BINARY" || ! -f "$X64_BINARY" ]]; then
  echo "Missing macOS binaries. Run: bun run build:binaries" >&2
  exit 1
fi

ARM64_SHA="$(shasum -a 256 "$ARM64_BINARY" | awk '{print $1}')"
X64_SHA="$(shasum -a 256 "$X64_BINARY" | awk '{print $1}')"

mkdir -p "$FORMULA_DIR"

cat > "$FORMULA_PATH" <<RUBY
class Reglet < Formula
  desc "Local-first control plane for AI agent rules, skills, and MCP configs"
  homepage "https://github.com/elijahbutler/reglet"
  version "$VERSION"
  license "MIT"
  depends_on :macos

  if Hardware::CPU.arm?
    url "https://github.com/elijahbutler/reglet/releases/download/v#{version}/reglet-darwin-arm64"
    sha256 "$ARM64_SHA"
  else
    url "https://github.com/elijahbutler/reglet/releases/download/v#{version}/reglet-darwin-x64"
    sha256 "$X64_SHA"
  end

  def install
    if Hardware::CPU.arm?
      bin.install "reglet-darwin-arm64" => "reglet"
    else
      bin.install "reglet-darwin-x64" => "reglet"
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/reglet --version")
  end
end
RUBY

echo "Generated $FORMULA_PATH"
