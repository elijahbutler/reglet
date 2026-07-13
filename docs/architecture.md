# Architecture

Public V1 consists of three local components:

- `packages/core`: master-directory model, provider adapters, transaction engine, drift detection, and recovery.
- `packages/cli`: local automation and the JSON contracts used by the manager.
- `apps/macos/RegletSetup`: the native manager.

There is no public service dependency. The configuration workflow does not make network requests.

## Master directory

The default master directory is `~/.reglet/`:

```text
rules/
rules/<provider>/
skills/
skills/<provider>/
mcp/servers.json
reglet.toml
.state/
  manifest.json
  backups/
  operations/
    journals/
    receipts/
    snapshots/
```

Rule documents directly under `rules/` are the ordered shared base. Reglet-created rule directories under `rules/<provider>/` contain an internal overlay marker; their documents are appended only to that provider's rendered output. An unmarked provider-named directory retains the legacy shared behavior. The provider directory remains part of each document's source path so previews and generated files preserve provenance.

Shared skills in `skills/<skill-name>/` apply to every enrolled provider that supports skills. Provider-scoped skills in `skills/<provider>/<skill-name>/` apply only to that provider and override an equally named shared skill.

Reglet makes state directories owner-only (`0700`) and state files owner-only (`0600`). It fails a mutation rather than continuing when those permissions cannot be enforced.

## Review and transaction engine

`apply-structured preview` renders every selected provider output, reports expected target hashes and drift, redacts sensitive values, and produces a digest. The digest incorporates non-reversible fingerprints of resolved MCP environment values without storing the values themselves.

`apply-structured apply` re-renders the scope and accepts only the still-current digest. Before its first replacement it creates a durable operation journal and snapshots every changed file or directory. Replacements use sibling staging and atomic rename. If a mutation fails, the engine restores all targets from the operation; after interruption, it recovers the journal before any new mutation.

Each completed operation has an immutable receipt with affected paths, snapshot sources, lifecycle, and plan digest. Receipts and snapshots are retained indefinitely in V1.

## MCP data contract

Shared MCP definitions live in `mcp/servers.json`. Provider-scoped definitions live in `mcp/providers/<provider>/servers.json`, matching the existing provider directory pattern used by scoped skills. Existing `mcp/servers.json` entries keep loading unchanged: the map key is the stable server id and also the default display/output name.

A new definition may use an envelope when the editable display name differs from the stable id:

```json
{
  "mcpServers": {
    "stable-id": {
      "displayName": "provider-output-name",
      "server": { "command": "node" }
    }
  }
}
```

Effective provider output is resolved as shared definitions in stable-id order, with matching provider-scoped ids overriding those definitions, followed by provider-only definitions. If two distinct stable ids resolve to the same display/output name, preview and apply report a machine-readable conflict and do not write that provider output.

MCP environment values use only process-environment references:

```json
{ "TOKEN": { "source": "process-env", "name": "LOCAL_TOKEN" } }
```

Raw values are invalid. Resolution happens only in memory while generating the provider-specific output. The manager, CLI previews, logs, diagnostics, operation journal, and receipt use redacted representations.

## Drift, recovery, and detaching

The manifest records the generated hash and managed MCP keys for each provider output. Drift detection compares the current output to that state and avoids treating user-owned MCP keys as managed changes. Plain automation refuses unreviewed drift replacement.

`operations list`, `operations show`, and `operations restore` expose receipt-backed recovery. `restore` and `revert` remain compatibility shorthands. `unenroll` detaches Reglet ownership while leaving current provider content in place; rules headers are removed during that detach.

## Manager contract

The retained macOS manager requests `reglet manager snapshot --json`, which remains the version 1 compatibility response. New Manager work requests `reglet manager snapshot --json --contract-version 2` and validates the response against `packages/core/schemas/manager-snapshot-v2.schema.json`. Version 2 separates discovered sources from persisted destination enrollment and is read-only; unknown versions fail closed. Apply actions use structured previews, scoped provider/content selection, and receipt results. Automatic update checks are off by default; a manual check is a separate user action.
