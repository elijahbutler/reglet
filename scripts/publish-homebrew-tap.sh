#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${REGLET_DIST_DIR:-$ROOT_DIR/dist}"
FORMULA_PATH="$DIST_DIR/homebrew/Formula/reglet.rb"
CASK_PATH="$DIST_DIR/homebrew/Casks/reglet.rb"
VERSION="${REGLET_VERSION:-${GITHUB_REF_NAME:-}}"
VERSION="${VERSION#v}"
TAP_REPOSITORY="${REGLET_HOMEBREW_TAP_REPOSITORY:-elijahbutler/homebrew-reglet}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
  echo "A valid REGLET_VERSION or GITHUB_REF_NAME is required to publish Homebrew." >&2
  exit 1
fi
if [[ ! -f "$FORMULA_PATH" || ! -f "$CASK_PATH" ]]; then
  echo "Generate the Homebrew formula and cask before publishing the tap." >&2
  exit 1
fi
if ! grep -Fq "version \"$VERSION\"" "$FORMULA_PATH" || ! grep -Fq "version \"$VERSION\"" "$CASK_PATH"; then
  echo "The generated Homebrew files do not match Reglet $VERSION." >&2
  exit 1
fi

if [[ -n "${REGLET_HOMEBREW_TAP_CLONE_URL:-}" ]]; then
  TAP_CLONE_URL="$REGLET_HOMEBREW_TAP_CLONE_URL"
  clone_tap() { git clone --depth 1 "$TAP_CLONE_URL" "$1"; }
  push_tap() { git -C "$1" push origin HEAD:main; }
else
  if [[ -z "${HOMEBREW_TAP_TOKEN:-}" ]]; then
    echo "HOMEBREW_TAP_TOKEN is required to push Formula/reglet.rb and Casks/reglet.rb to $TAP_REPOSITORY." >&2
    exit 1
  fi
  TAP_CLONE_URL="https://github.com/${TAP_REPOSITORY}.git"
  CREDENTIAL_HELPER='!f() { echo username=x-access-token; echo "password=$HOMEBREW_TAP_TOKEN"; }; f'
  clone_tap() { git -c credential.helper="$CREDENTIAL_HELPER" clone --depth 1 "$TAP_CLONE_URL" "$1"; }
  push_tap() { git -C "$1" -c credential.helper="$CREDENTIAL_HELPER" push origin HEAD:main; }
fi

TEMP_ROOT="${RUNNER_TEMP:-/tmp}"
TAP_DIR="$(mktemp -d "$TEMP_ROOT/reglet-homebrew.XXXXXX")"
clone_tap "$TAP_DIR"
mkdir -p "$TAP_DIR/Formula" "$TAP_DIR/Casks"
cp "$FORMULA_PATH" "$TAP_DIR/Formula/reglet.rb"
cp "$CASK_PATH" "$TAP_DIR/Casks/reglet.rb"

git -C "$TAP_DIR" config user.name "github-actions[bot]"
git -C "$TAP_DIR" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git -C "$TAP_DIR" add Formula/reglet.rb Casks/reglet.rb
if git -C "$TAP_DIR" diff --cached --quiet; then
  echo "Homebrew tap already contains Reglet $VERSION."
  exit 0
fi

git -C "$TAP_DIR" commit -m "reglet v$VERSION"
push_tap "$TAP_DIR"
echo "Published Reglet $VERSION to $TAP_REPOSITORY."
