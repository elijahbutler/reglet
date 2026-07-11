# Installation

Reglet can be installed from a GitHub Release or from source.

## Requirements

- Bun 1.1+
- Git
- macOS or Windows for daemon service installation

## macOS GitHub Installer

Download the latest `reglet-macos-<arch>.pkg` from GitHub Releases:

```text
https://github.com/elijahbutler/reglet/releases
```

The package installs:

- `reglet` to `/usr/local/bin/reglet`
- `Reglet Setup.app` to `/Applications/Reglet Setup.app`

The installer does **not** install, load, or start the Reglet daemon. It does **not** configure sync. Open `Reglet Setup.app` after installation to scan providers, preview file reads/writes, and explicitly confirm backup/apply.

If macOS reports that it cannot verify the package is free of malware, the package was built without Developer ID signing and Apple notarization. Do not use unsigned installer packages for broad distribution; use the source install path below until a signed/notarized release is available.

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
