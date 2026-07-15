# Installation

## Requirements

Public releases include macOS arm64, macOS x64, and Windows x64 CLI binaries plus ad-hoc-signed/unnotarized macOS and unsigned Windows desktop artifacts. The retained Swift app remains frozen during Tauri parity. Linux GUI artifacts are deferred. Updated Homebrew casks are not distributed.

## Homebrew

```bash
brew tap elijahbutler/reglet
brew install elijahbutler/reglet/reglet
```

The Homebrew formula installs the CLI on macOS and is updated for every public release before the GitHub Release is published.

## Migrate from the 0.1.6 app cask

Reglet 0.1.6 was installed as a Homebrew cask. Casks cannot be upgraded in place to a formula, and that legacy app cask receives no later releases. After the first CLI-only release is published, switch once:

```bash
brew update
brew uninstall --cask reglet
brew install elijahbutler/reglet/reglet
reglet --version
```

Uninstalling the cask removes `Reglet.app` and its linked binary; it does not remove your `~/.reglet` configuration or provider files.

## Direct binaries

Download the matching CLI artifact from the GitHub Release:

- `reglet-darwin-arm64`
- `reglet-darwin-x64`
- `reglet-windows-x64.exe`

On macOS, make the downloaded architecture-specific binary executable before running it:

```bash
chmod +x reglet-darwin-arm64
./reglet-darwin-arm64 --version
```

On Windows PowerShell, run the executable directly:

```powershell
.\reglet-windows-x64.exe --version
```

## Verify a release

Each release contains `SHA256SUMS.txt`, `provenance.txt`, and the three CLI binaries. After downloading an artifact, verify its checksum:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

GitHub also publishes build provenance attestation for the release artifacts.

For the macOS desktop app, download the `.dmg` matching your Mac, open it, and drag Reglet into Applications. The app is ad-hoc signed rather than Developer ID signed and is not notarized. If Gatekeeper blocks it, open System Settings → Privacy & Security and approve Reglet after confirming the downloaded checksum.

On Windows, download `reglet-desktop-windows-x64-setup.exe`. Because the installer is not Authenticode-signed, Microsoft Defender SmartScreen may show an “unrecognized app” warning. Verify the SHA-256 checksum first, then choose **More info → Run anyway** only when it matches the release checksum. The installer bootstraps WebView2 when the compatible runtime is absent.

On Windows, compare the PowerShell hash against the matching entry in `SHA256SUMS.txt`:

```powershell
Get-FileHash .\reglet-windows-x64.exe -Algorithm SHA256
```

## Source checkout

Source work requires Bun. Tauri work also requires Rust and the native Tauri system dependencies for the host; retained Swift app work requires Xcode Command Line Tools on macOS.

```bash
git clone https://github.com/elijahbutler/reglet.git
cd reglet
bun install --frozen-lockfile
bun packages/cli/src/index.ts scan
```

On macOS, install a local build of both the current-architecture CLI and app from the checkout:

```bash
bun run macos:install
```

This installs the CLI to `~/.local/bin/reglet` and an ad-hoc-signed Swift app to `~/Applications/Reglet.app` for local development only. Use `bun run macos:local` instead to install the CLI and run the Swift app directly from source. Public Tauri macOS artifacts are also ad-hoc signed and are not notarized.
