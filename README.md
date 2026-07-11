# Reglet

![Reglet: one source of truth for every local agent](docs/assets/reglet-banner.svg)

Reglet keeps global AI agent rules, skills, and MCP server configs in one local master directory, then converts them into the right format for each installed coding tool.

> **Status:** experimental v0.1. Core master-dir loading, provider adapters, safe apply, drift detection, interactive onboarding, daemon watching, self-hosted sync server, basic sync client, release packaging, and BranchForge-style docs are implemented. Deeper sync merge semantics and manual real-machine smoke testing remain in progress.

## Why

AI coding tools keep global configuration in different places and formats. That makes shared prompts, skills, and MCP servers hard to audit, back up, and move between machines.

Reglet gives those files a single source of truth:

- edit rules, skills, and MCP servers under `~/.reglet/`;
- convert into Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode formats;
- back up provider files before replacing them;
- detect hand edits to generated provider outputs;
- optionally sync the master directory through a self-hosted server.

Reglet does not install a daemon, start syncing, or modify provider files until you explicitly run onboarding/apply commands.

## How It Works

![Reglet lifecycle: onboard, master, apply, drift, sync](docs/assets/reglet-lifecycle.svg)

1. Scan local provider config directories.
2. Import selected rules, skills, and MCP servers into `~/.reglet/`.
3. Apply provider-specific conversions with backups and a manifest.
4. Detect drift when generated provider files are edited directly.
5. Optionally sync the master directory between devices.

## Quick Start

Requirements:

- Bun 1.1+
- macOS or Windows for daemon service installation
- One or more supported AI coding tools

Install from the checkout:

```bash
bun install
bun packages/cli/src/index.ts init --yes
bun packages/cli/src/index.ts scan
bun packages/cli/src/index.ts apply
```

The `--yes` mode is non-interactive and intended for tests/scripts. Run `reglet init` without flags for interactive provider/content selection.

## CLI

```bash
reglet init --yes
reglet scan
reglet apply --provider claude
reglet status --check
reglet import claude:rules
reglet enroll codex:mcp
reglet unenroll codex:mcp
reglet restore claude
reglet daemon status
reglet login http://localhost:3000 --token "$REGLET_TOKEN" --device laptop
reglet sync
```

Daemon and sync are opt-in. `reglet daemon run/start/install` refuses to run until at least one provider is enrolled.

## Provider Support

| Provider | Rules | Skills | MCP |
|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude.json` |
| Codex CLI | `~/.codex/AGENTS.md` | `~/.agents/skills/` | `~/.codex/config.toml` |
| Cursor | unsupported global rules | `~/.cursor/skills/` | `~/.cursor/mcp.json` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `~/.gemini/skills/` | `~/.gemini/settings.json` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | unsupported | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` | `~/.config/opencode/opencode.json` |

## Repository Layout

```text
reglet/
├── docs/                    # User, maintainer, provider, and self-hosting docs
├── packages/core/           # Master dir, provider adapters, apply/drift/sync engines
├── packages/cli/            # reglet CLI and daemon
├── packages/server/         # Self-hosted sync server
├── scripts/                 # Binary build scripts
└── ROADMAP.md
```

## Docs

- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Providers](docs/providers.md)
- [Self-hosting](docs/self-hosting.md)
- [Development](docs/development.md)
- [Roadmap](ROADMAP.md)

## Development

```bash
bun run typecheck
bun test
bun run lint
```

Build local binaries:

```bash
bun run build:binaries
```

## License

MIT
