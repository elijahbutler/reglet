# Installation

## Requirements

Public V1 is CLI-only. Public artifacts are macOS arm64, macOS x64, and Windows x64 binaries. The macOS manager source remains in the repository, but `Reglet.app`, installer packages, and Homebrew casks are not distributed public release artifacts.

## Homebrew

```bash
brew tap elijahbutler/reglet
brew install elijahbutler/reglet/reglet
```

The Homebrew formula installs the CLI on macOS and is updated for every public release before the GitHub Release is published.

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

On Windows, compare the PowerShell hash against the matching entry in `SHA256SUMS.txt`:

```powershell
Get-FileHash .\reglet-windows-x64.exe -Algorithm SHA256
```

## Source checkout

Source work requires Bun and Xcode Command Line Tools:

```bash
git clone https://github.com/elijahbutler/reglet.git
cd reglet
bun install --frozen-lockfile
bun packages/cli/src/index.ts scan
```

Source builds are for development. Public release automation builds only CLI artifacts and does not package or distribute the macOS app.
