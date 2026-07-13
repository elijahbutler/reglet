# Reglet

![Reglet engineering control plane banner](docs/assets/reglet-banner.svg)

Reglet is a local-only macOS manager and CLI for global AI-agent rules, skills, and MCP configurations. It keeps one versionable master directory, renders it to the six supported providers, makes every provider write reviewable, and retains recovery data indefinitely.

Public V1 has no account, device-linking, remote configuration, background network transfer, or network management commands. Its configuration path stays on the Mac. A manual software-update check is separately disclosed and off by default.

```text
~/.reglet/                 provider outputs
  rules/*.md        -+     ~/.claude/CLAUDE.md
  skills/*/          +-->  ~/.codex/AGENTS.md
  mcp/servers.json  -+     ~/.cursor/mcp.json
  reglet.toml              ~/.gemini/settings.json
  .state/                  recovery journals and receipts
```

## What V1 provides

- Rules, shared skills, provider-scoped skills, and managed MCP entries for Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode.
- A native macOS manager with Providers, Rules, Skills, MCP, Activity & Drift, and Recovery screens.
- Digest-backed Review & Apply plans with exact redacted diffs, drift checks, durable operation receipts, and explicit receipt restore.
- Typed local MCP environment references. Raw credential strings are invalid and are never copied into previews, logs, diagnostics, journals, or receipts.
- Owner-only Reglet state, journal, and snapshot permissions (`0700` directories and `0600` files).

## Install

Install only a signed and notarized V1 release:

```bash
brew tap elijahbutler/reglet
brew install --cask elijahbutler/reglet/reglet
```

The cask preserves macOS quarantine and Gatekeeper verification. It installs `Reglet.app` and exposes the bundled `reglet` CLI; it does not write provider files or start background services.

CLI-only installs use the matching formula:

```bash
brew install --formula elijahbutler/reglet/reglet
```

See [installation](docs/installation.md) for release verification and source setup.

## Safe workflow

```bash
# Inspect local providers without changing files.
reglet scan

# Create the master directory and select scopes to manage.
reglet init

# Produce the exact, redacted transaction plan.
reglet apply-structured preview --provider claude codex --content rules mcp

# Apply only the still-current reviewed plan.
reglet apply-structured apply --digest <digest> --provider claude codex --content rules mcp

# Inspect operation receipts and explicitly restore one if needed.
reglet operations list
reglet operations show <receipt-id>
reglet operations restore <receipt-id>
```

Plain `reglet apply` remains suitable for automation, but refuses to replace detected provider drift unless the caller explicitly supplies `--reviewed-replacement`.

## MCP environment references

Canonical MCP definitions contain named process-environment references rather than credential values:

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

Reglet resolves a reference only in memory while rendering a provider output. A missing variable blocks the plan. Resolved values are redacted from review output and persisted state.

## Recovery and lifecycle

Every changed file or directory is snapshotted before replacement. A journal is recovered before another mutation is allowed; an interrupted or failed multi-provider operation rolls its writes back together.

`reglet unenroll provider[:rules|skills|mcp]` stops managing the selected scope while preserving its current provider content. When detaching rules, Reglet removes its generated header. Destructive removal is available only through explicit recovery actions.

If an older installation left pre-V1 network state behind, it is inert and never read for credentials or network access. Inspect paths only with `reglet state legacy-network-status`, then explicitly remove it with `reglet state clear-legacy-network-state`.

## Documentation

- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Providers](docs/providers.md)
- [Recovery](docs/recovery.md)
- [Privacy and network behavior](docs/privacy.md)
- [Security reporting](SECURITY.md)
- [Release verification](docs/release.md)
- [Release notes](docs/release-notes.md)
- [Roadmap](ROADMAP.md)

## Development

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
swift test --package-path apps/macos/RegletSetup
```

## License

MIT
