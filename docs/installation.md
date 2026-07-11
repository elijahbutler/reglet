# Installation

Reglet is currently installed from source.

## Requirements

- Bun 1.1+
- Git
- macOS or Windows for daemon service installation

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

`init --yes` enrolls detected providers and imports detected rules, skills, and MCP servers. Interactive selective onboarding remains in progress.

## Background Daemon

The daemon is opt-in. It is not installed or started by `init`.

```bash
reglet daemon status
reglet daemon run
reglet daemon start
reglet daemon install --dry-run
```

Daemon run/start/install refuses to proceed until at least one provider is enrolled.
