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
brew trust --formula elijahbutler/reglet/reglet
brew install reglet
```

This installs the `reglet` CLI only. It does **not** install, load, or start the Reglet daemon. It does **not** configure sync or write provider files.

## GitHub Release Binaries

Raw binaries are available from GitHub Releases:

```text
https://github.com/elijahbutler/reglet/releases
```

The native `.pkg` installer path is blocked until Reglet has Apple Developer ID signing and notarization. Unsigned packages trigger Gatekeeper malware-verification warnings and should not be used for broad distribution.

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

## Mac Setup App Target

The current install path is still CLI-first. The Mac-friendly path is now tracked in `docs/plans/2026-07-11-mac-onboarding-sprint.md`.

The setup app will use the same CLI engine through a machine-readable contract:

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
