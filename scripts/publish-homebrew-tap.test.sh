#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/reglet-homebrew-test.XXXXXX)"
BARE_TAP="$TEST_ROOT/tap.git"
SEED="$TEST_ROOT/seed"
DIST="$TEST_ROOT/dist"

git init --bare --initial-branch=main "$BARE_TAP" >/dev/null
git init --initial-branch=main "$SEED" >/dev/null
git -C "$SEED" config user.name "Reglet Test"
git -C "$SEED" config user.email "test@reglet.dev"
printf '# Reglet tap\n' > "$SEED/README.md"
git -C "$SEED" add README.md
git -C "$SEED" commit -m "Initialize tap" >/dev/null
git -C "$SEED" remote add origin "$BARE_TAP"
git -C "$SEED" push origin main >/dev/null

mkdir -p "$DIST/homebrew/Formula" "$DIST/homebrew/Casks"
printf 'class Reglet < Formula\n  version "1.2.3"\nend\n' > "$DIST/homebrew/Formula/reglet.rb"
printf 'cask "reglet" do\n  version "1.2.3"\nend\n' > "$DIST/homebrew/Casks/reglet.rb"

REGLET_VERSION=1.2.3 \
REGLET_DIST_DIR="$DIST" \
REGLET_HOMEBREW_TAP_CLONE_URL="$BARE_TAP" \
RUNNER_TEMP="$TEST_ROOT" \
bash "$ROOT_DIR/scripts/publish-homebrew-tap.sh" >/dev/null

FIRST_COUNT="$(git --git-dir="$BARE_TAP" rev-list --count main)"
test "$(git --git-dir="$BARE_TAP" show main:Formula/reglet.rb)" = "$(cat "$DIST/homebrew/Formula/reglet.rb")"
test "$(git --git-dir="$BARE_TAP" show main:Casks/reglet.rb)" = "$(cat "$DIST/homebrew/Casks/reglet.rb")"

REGLET_VERSION=1.2.3 \
REGLET_DIST_DIR="$DIST" \
REGLET_HOMEBREW_TAP_CLONE_URL="$BARE_TAP" \
RUNNER_TEMP="$TEST_ROOT" \
bash "$ROOT_DIR/scripts/publish-homebrew-tap.sh" >/dev/null

SECOND_COUNT="$(git --git-dir="$BARE_TAP" rev-list --count main)"
test "$FIRST_COUNT" = "$SECOND_COUNT"
echo "Homebrew tap publisher is idempotent."
