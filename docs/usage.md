# Usage

## Scan and enroll

```bash
reglet scan
reglet init
reglet enroll claude:rules
```

`scan` is read-only. `init` creates the local master directory and lets you choose what to manage. Enrollment can be scoped to a provider or one content type (`rules`, `skills`, or `mcp`).

## Review and apply

Use the structured flow whenever a person reviews an operation:

```bash
reglet apply-structured preview --provider claude codex --content rules mcp
reglet apply-structured apply --digest <digest> --provider claude codex --content rules mcp
```

The preview reports exact redacted diffs, expected target hashes, validation issues, drift, snapshot locations, and a digest. The apply command regenerates the plan and rejects a stale digest.

For unattended automation, `reglet apply` remains available. It refuses provider drift by default. A caller that has independently reviewed the replacement must pass `--reviewed-replacement`.

## Skills

```bash
reglet skills unmanaged
reglet skills adopt claude my-skill --scope shared
reglet skills adopt claude my-skill --scope provider
```

Adoption copies a provider-local skill into the master directory without deleting the source. Review the resulting structured apply before distributing it.

## Optional AI rules draft

List installed local AI tools without running them, then explicitly choose one to generate a reviewable draft:

```bash
reglet rules merge-runners --json
reglet rules merge-draft --provider claude,codex --runner codex --json
```

The merge command sends the selected rule-file contents to the chosen external CLI under that tool provider's privacy terms. It prints a proposal but does not write master or provider files. The macOS onboarding flow shows the executable and exact source paths and requires consent for every invocation.

## MCP environment references

MCP definitions are shared by default:

```bash
reglet mcp list --json
reglet mcp upsert stable-id --display-name provider-output-name --json < server.json
reglet mcp rename-display-name stable-id new-output-name --json
```

Provider-scoped definitions use the same stable id model and override shared definitions with the same id only for that provider:

```bash
reglet mcp list --scope provider --provider claude --json
reglet mcp upsert stable-id --scope provider --provider claude --display-name claude-output --json < server.json
reglet mcp list --effective-provider claude --json
reglet import claude:mcp --scope provider --json
```

Use a named local variable reference rather than a raw secret:

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "env": {
        "TOKEN": { "source": "process-env", "name": "LOCAL_TOKEN" }
      }
    }
  }
}
```

Export `LOCAL_TOKEN` in the environment that runs Reglet. A missing reference blocks preview/apply. Reglet never persists the resolved value in its master MCP file, review output, diagnostics, journal, or receipt.

## Drift and recovery

```bash
reglet status --check
reglet import claude:rules
reglet operations list
reglet operations show <receipt-id>
reglet operations restore <receipt-id>
```

Operation receipts show affected paths and the snapshot source for each. Restore is explicit. `reglet restore` and `reglet revert` are retained as compatibility shortcuts over the recovery model.

## Stop managing

```bash
reglet unenroll claude:rules
```

This retains the current provider file, removes Reglet ownership from the manifest, and strips the generated rules header. It does not erase provider content.

## Legacy state and manager snapshot

```bash
reglet state legacy-network-status --json
reglet state clear-legacy-network-state --json
reglet manager snapshot --json
```

Pre-V1 network state is inert and only reports file paths/counts; Reglet never reads or sends its credential values. Clearing it is an explicit action. The manager snapshot is a single redacted local JSON response used by the native manager refresh path.
