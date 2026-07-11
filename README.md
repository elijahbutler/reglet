# Reglet

![Reglet: one source of truth for every local agent](docs/assets/reglet-banner.svg)

Reglet is a local control plane for AI coding agents. It gives engineers one canonical directory for prompts, rules, skills, and MCP server definitions, then compiles that source of truth into the formats expected by Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode.

The premise is simple: agent configuration is becoming infrastructure. It should be inspectable, portable, reversible, and syncable without handing control of your machine to a black box.

> **Status:** experimental v0.1. The V1 foundation is implemented: provider adapters, onboarding import, safe apply, backup/restore, drift detection, opt-in daemon watching, self-hosted sync, binary packaging, and documentation. Sync merge semantics and broad real-machine smoke testing are still being hardened.

## Why Reglet Exists

AI engineering teams are accumulating operational knowledge in scattered global config files:

- `~/.claude/CLAUDE.md`
- `~/.codex/AGENTS.md`
- Cursor and Windsurf skill directories
- Gemini and OpenCode agent rules
- MCP JSON/TOML files with subtly different schemas

That configuration often contains the highest-leverage context a team has: coding standards, security constraints, preferred tools, internal workflows, and specialized skills. Today it is usually copied by hand, edited in-place, and impossible to audit across machines.

Reglet turns that sprawl into a controlled pipeline:

1. Import existing provider config into `~/.reglet/`.
2. Edit one master directory.
3. Generate provider-specific outputs with backups.
4. Detect drift when generated files are changed by hand.
5. Optionally sync the master directory through infrastructure you control.

No daemon is installed, no sync loop starts, and no provider file is modified until you explicitly onboard and apply.

## Product Shape

Reglet is built for individual power users now, with a clear path toward team-grade agent operations:

- **Local-first by default:** the master directory lives on your machine.
- **Provider-neutral:** canonical rules, skills, and MCP definitions compile outward.
- **Reversible writes:** provider outputs are backed up before managed changes.
- **Drift-aware:** hand edits are detected instead of silently overwritten.
- **Self-hostable sync:** a small Bun + Hono + SQLite server is included.
- **SaaS-ready architecture:** hosted sync, shared skill packs, and team workflows can sit on the same core model later.

## How It Works

![Reglet lifecycle: onboard, master, apply, drift, sync](docs/assets/reglet-lifecycle.svg)

Reglet separates authoring from distribution.

```text
~/.reglet/
├── rules/                 # canonical agent instructions
├── skills/                # canonical skill directories
├── mcp/servers.json       # canonical MCP server definitions
├── reglet.toml            # enrollment and sync configuration
└── .state/                # manifest, backups, drift queue, sync cursor
```

The apply engine reads the master directory, checks enrollment, converts each content type for each provider, and writes only managed outputs. MCP adapters merge Reglet-owned server entries while preserving unmanaged provider config.

## Quick Start

Requirements:

- Bun 1.1+
- One or more supported AI coding tools
- macOS or Windows only if you want service installation for the daemon

Install from source:

```bash
git clone https://github.com/elijahbutler/reglet.git
cd reglet
bun install
```

Run interactive onboarding:

```bash
bun packages/cli/src/index.ts init
```

Or run the scripted path used by tests and automation:

```bash
bun packages/cli/src/index.ts init --yes
bun packages/cli/src/index.ts scan
bun packages/cli/src/index.ts apply
```

When installed as a binary, use `reglet` in place of `bun packages/cli/src/index.ts`.

## Command Surface

```bash
reglet init
reglet scan
reglet apply
reglet apply --provider claude
reglet status --check
reglet diff
reglet import claude:rules
reglet enroll codex:mcp
reglet unenroll codex:mcp
reglet restore claude
reglet revert
```

Sync is explicit:

```bash
reglet login http://localhost:3000 --token "$REGLET_TOKEN" --device laptop
reglet sync
```

The daemon is also explicit:

```bash
reglet daemon status
reglet daemon run
reglet daemon start
reglet daemon install --dry-run
```

`reglet daemon run`, `start`, and `install` refuse to run until onboarding has enrolled at least one provider. macOS notifications are opt-in with `REGLET_ENABLE_NOTIFICATIONS=1`.

## Provider Matrix

| Provider | Rules | Skills | MCP |
|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude.json` |
| Codex CLI | `~/.codex/AGENTS.md` | `~/.agents/skills/` | `~/.codex/config.toml` |
| Cursor | unsupported global rules | `~/.cursor/skills/` | `~/.cursor/mcp.json` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `~/.gemini/skills/` | `~/.gemini/settings.json` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | unsupported | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` | `~/.config/opencode/opencode.json` |

## Safety Model

Reglet is intentionally conservative because global agent config is sensitive:

- onboarding is explicit and selective;
- generated files include an instruction header pointing back to `~/.reglet/`;
- backups are created before managed provider writes;
- unmanaged MCP keys are preserved;
- `.state/` is never synced;
- sync stores the master directory only, not provider outputs;
- daemon execution and notification delivery are opt-in.

## Self-Hosted Sync

The sync server is a small deployable service:

- Bun runtime
- Hono HTTP API
- SQLite storage
- single-user token mode for simple self-hosting
- email/password + device-token flow for multi-user mode
- Dockerfile included

Start locally:

```bash
REGLET_TOKEN=dev-token REGLET_DB=./reglet.sqlite bun packages/server/src/index.ts
```

Then connect a client:

```bash
reglet login http://localhost:3000 --token dev-token --device laptop
reglet sync
```

See [Self-hosting](docs/self-hosting.md) for Docker usage and environment variables.

## Repository Layout

```text
reglet/
├── docs/                    # Product, architecture, provider, and self-hosting docs
├── packages/core/           # Master dir, provider adapters, apply/drift/sync engines
├── packages/cli/            # CLI, onboarding flow, and daemon
├── packages/server/         # Self-hosted sync service
├── scripts/                 # Binary build scripts
└── ROADMAP.md
```

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

## Docs

- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Providers](docs/providers.md)
- [Self-hosting](docs/self-hosting.md)
- [Development](docs/development.md)
- [Roadmap](ROADMAP.md)

## Roadmap

The current V1 is the local-first foundation. The next product phases are hosted sync, team/shared skill packs, subagent content types, more provider adapters, optional end-to-end encryption, and project-scope mode.

## License

MIT
