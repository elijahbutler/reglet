# Installation

## Requirements

Public V1 is macOS-only and supports macOS Sonoma (14) or later. The graphical manager is distributed as a signed and notarized `Reglet.app` archive and installer package. The CLI is available through the matching Homebrew formula or release binary.

## Homebrew

```bash
brew tap elijahbutler/reglet
brew install --cask elijahbutler/reglet/reglet
```

The cask preserves macOS quarantine. Do not bypass Gatekeeper: use only the signed, notarized release it downloads. It installs `Reglet.app` in `/Applications` and makes its bundled `reglet` executable available.

For CLI automation only:

```bash
brew install --formula elijahbutler/reglet/reglet
```

## Verify a release

Each release contains `SHA256SUMS.txt`, `provenance.txt`, the app archives, installer packages, and CLI binaries. After downloading an artifact, verify its checksum:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

macOS verifies the notarization ticket when the app or package is opened. You can inspect it explicitly:

```bash
spctl --assess --type execute --verbose=4 /Applications/Reglet.app
pkgutil --check-signature reglet-macos-arm64.pkg
```

## Source checkout

Source work requires Bun and Xcode Command Line Tools:

```bash
git clone https://github.com/elijahbutler/reglet.git
cd reglet
bun install --frozen-lockfile
bun packages/cli/src/index.ts scan
```

Source builds are for development. The release scripts intentionally refuse to produce a public installer without Developer ID and notary credentials.
