# Architecture

Reglet has three packages:

- `packages/core`: master directory loading, provider adapters, safe apply, drift, revert, and sync engines.
- `packages/cli`: command-line interface and daemon.
- `packages/server`: self-hosted sync server.

## Master Directory

Default path: `~/.reglet/`.

```text
rules/
skills/
skills/<provider>/
mcp/servers.json
reglet.toml
.state/
```

`skills/<skill-name>/` entries are shared skills. `skills/<provider>/<skill-name>/` entries are provider-specific skills that are applied only to that provider, with provider-specific names overriding shared names during apply.

Tests use `REGLET_HOME` and `REGLET_PROVIDER_HOME` so they never touch the real home directory.

## Apply Engine

The apply engine reads the master directory, checks enrollment in `reglet.toml`, converts content for each provider, and writes through one safe writer. The writer creates a first backup and records the generated hash in `.state/manifest.json`.

## Drift

Drift detection compares current provider outputs to the manifest. For MCP files, it only compares managed server entries and ignores user-owned entries in the same config file.

## Daemon

The daemon watches the master directory for changes and provider outputs for drift. It is opt-in and refuses to run before onboarding has enrolled at least one provider. macOS notifications are opt-in with `REGLET_ENABLE_NOTIFICATIONS=1`.

## Sync

The sync server stores versioned per-file snapshots in SQLite. The client pulls changes, writes clean remote files into the master directory, pushes local changes, and creates conflict copies when unsynced local edits would be overwritten.

Sync walks the full master `skills/` tree, so provider-specific skill files under `skills/<provider>/` are synchronized between devices without a separate filter.
