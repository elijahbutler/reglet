# Installation

## Requirements

Public releases include macOS arm64/x64, Windows x64, and Linux arm64/x64 CLI binaries, plus desktop artifacts for macOS, Windows, and Linux. Installed desktop builds can check for a signed update in **Settings → General**, download it with visible progress, install it, and relaunch Reglet. macOS is ad-hoc signed/unnotarized, Windows is unsigned, and Linux ships as `.deb` and AppImage.

## Homebrew

```bash
brew tap elijahbutler/reglet
brew install elijahbutler/reglet/reglet
```

The Homebrew formula installs the CLI on macOS and is updated for every public release before the GitHub Release is published.

To install the desktop app through Homebrew:

```bash
brew tap elijahbutler/reglet
brew install --cask elijahbutler/reglet/reglet
```

The cask installs the same current macOS desktop disk image published on the GitHub Release.

## Migrate from the 0.1.6 app cask

Reglet 0.1.6 was installed from a cask that was maintained manually in the tap. Current releases generate the cask from this repository and publish it to the tap automatically. To move an old cask install onto the generated cask:

```bash
brew update
brew uninstall --cask reglet
brew install --cask elijahbutler/reglet/reglet
```

Uninstalling the cask removes `Reglet.app` and its linked binary; it does not remove your `~/.reglet` configuration or provider files.

## Direct binaries

Download the matching CLI artifact from the GitHub Release:

- `reglet-darwin-arm64`
- `reglet-darwin-x64`
- `reglet-windows-x64.exe`
- `reglet-linux-arm64`
- `reglet-linux-x64`

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

Source work requires Bun. Tauri work also requires Rust and the native Tauri system dependencies for the host.

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

This builds the host Tauri desktop app with a freshly staged sidecar and installs it to `~/Applications/Reglet.app` for local development only. Use `bun run macos:local` instead to build and open the app from the Tauri build output. Public Tauri macOS artifacts are ad-hoc signed and are not notarized.
