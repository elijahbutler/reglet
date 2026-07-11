# Installation

Reglet can be installed with Homebrew, from a GitHub Release binary, or from source.

## Requirements

- Bun 1.1+
- Git
- macOS or Windows for daemon service installation

## Homebrew

Recommended macOS install:

```bash
brew tap elijahbutler/reglet
brew install --cask elijahbutler/reglet/reglet
```

The cask installs `Reglet.app` in `/Applications` and exposes the app's bundled CLI as `reglet`. It does **not** install, load, or start the Reglet daemon, configure sync, or write provider files until you confirm those actions in the app.

For a CLI-only installation:

```bash
brew trust --formula elijahbutler/reglet/reglet
brew install --formula elijahbutler/reglet/reglet
```

## GitHub Release Binaries

Raw binaries are available from GitHub Releases:

```text
https://github.com/elijahbutler/reglet/releases
```

The Homebrew cask uses an ad-hoc-signed app until Apple Developer ID signing and notarization are configured. Homebrew installs this build without quarantine; direct app downloads are not suitable for broad distribution yet.

## From Checkout

```bash
git clone https://github.com/elijahbutler/reglet.git
cd reglet
bun install
```

Run the CLI from source:

```bash
bun packages/cli/src/index.ts scan
```

## Initial Setup

Create the master directory:

```bash
bun packages/cli/src/index.ts init
```

Non-interactive test/script mode:

```bash
bun packages/cli/src/index.ts init --yes
```

`init --yes` enrolls detected providers and imports detected rules, skills, and MCP servers. Run `init` without flags for interactive selective onboarding, or use `--provider` and `--content` for scripted selective onboarding.

## Mac App

The app uses the same CLI engine through a machine-readable contract:

```bash
reglet scan --json
reglet plan --provider claude --content rules,mcp --json
```

These commands are read-only and are intended for the native onboarding app to show detected providers, exact file reads/writes, and safety defaults before the user confirms backup/apply.

## Background Daemon

The daemon is opt-in. It is not installed or started by `init`.

```bash
reglet daemon status
reglet daemon run
reglet daemon start
reglet daemon install --dry-run
```

Daemon run/start/install refuses to proceed until at least one provider is enrolled.
