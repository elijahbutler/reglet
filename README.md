# Reglet

![Reglet: one source of truth for every local agent](docs/assets/reglet-banner.svg)

```text
agent config is infrastructure

~/.reglet/
  rules/          one rule system
  skills/         one skill library
  mcp/            one server registry
      |
      v
  claude  codex  cursor  gemini  windsurf  opencode
```

Reglet is a local-first control plane for AI coding agents. It gives engineers one canonical directory for prompts, rules, skills, and MCP server definitions, then compiles that source into every tool-specific format your workstation needs.

It is built for the moment when agent setup stops being a personal dotfile habit and starts becoming engineering infrastructure: auditable, reversible, portable, syncable, and eventually team-distributable.

| Surface | Status |
|---|---|
| Local master directory | implemented |
| Provider adapters | Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, OpenCode |
| Onboarding import | implemented |
| Safe apply + backups | implemented |
| Drift detection | implemented |
| Daemon watching | opt-in, implemented |
| Self-hosted sync | implemented |
| Hosted/team product | roadmap |

> **v0.1:** V1 foundations are in place. Sync merge semantics and broad real-machine smoke testing are still being hardened.

## The Problem

Every AI coding tool wants to own its own global configuration:

```text
Claude Code     ~/.claude/CLAUDE.md        ~/.claude/skills/        ~/.claude.json
Codex CLI       ~/.codex/AGENTS.md         ~/.agents/skills/        ~/.codex/config.toml
Cursor          ~/.cursor/skills/          ~/.cursor/mcp.json
Gemini CLI      ~/.gemini/GEMINI.md        ~/.gemini/skills/        ~/.gemini/settings.json
Windsurf        ~/.codeium/.../rules.md    ~/.codeium/.../mcp_config.json
OpenCode        ~/.config/opencode/...     ~/.config/opencode/opencode.json
```

Those files hold operational leverage: codebase rules, security boundaries, preferred tools, company workflows, and reusable skills. But without a source of truth, they become scattered, stale, hand-copied, and hard to recover.

Reglet treats those files like a build artifact.

## The Product Bet

Reglet starts as a developer tool and points toward a team product.

- **For individuals:** keep every local agent aligned without manually editing six config systems.
- **For founders:** establish the repo shape for hosted sync, shared skill packs, and team policy distribution.
- **For engineering teams:** move agent context from tribal knowledge into versionable, inspectable infrastructure.

The core architecture is intentionally local and open. The commercial path is not lock-in; it is managed distribution, hosted sync, policy, and visibility for teams that do not want to run the server themselves.

## Terminal First

```bash
git clone https://github.com/elijahbutler/reglet.git
cd reglet
bun install

# inspect installed providers
bun packages/cli/src/index.ts scan

# import selected rules, skills, and MCP servers
bun packages/cli/src/index.ts init

# compile ~/.reglet into provider outputs
bun packages/cli/src/index.ts apply

# detect direct edits to generated files
bun packages/cli/src/index.ts status --check
```

Installed binary form:

```bash
reglet scan
reglet init
reglet apply --provider claude
reglet diff
reglet status --check
```

## System Model

![Reglet lifecycle: onboard, master, apply, drift, sync](docs/assets/reglet-lifecycle.svg)

```text
             scan/import
provider dirs ---------> ~/.reglet/
                          |
                          | apply
                          v
                  provider-specific outputs
                          |
                drift detection + backups
                          |
                          v
                optional self-hosted sync
```

The master directory is small on purpose:

```text
~/.reglet/
├── rules/                 # canonical agent instructions
├── skills/                # canonical skill directories
├── mcp/servers.json       # canonical MCP definitions
├── reglet.toml            # enrollment and sync config
└── .state/                # manifest, backups, drift queue, sync cursor
```

The apply engine converts that source into provider-specific files. MCP adapters merge Reglet-owned server entries while preserving unmanaged provider settings.

## What Ships Today

```text
packages/core
  master dir loader
  provider registry
  rules / skills / MCP conversion
  safe apply, manifest, backups
  drift import and revert
  sync client and merge handling

packages/cli
  init / scan / apply / status / diff
  enroll / unenroll / import / restore / revert
  login / sync
  daemon run / start / stop / install

packages/server
  Bun + Hono API
  SQLite persistence
  single-user token mode
  account + device token mode
  Docker-ready self-hosting
```

## Provider Matrix

| Provider | Rules | Skills | MCP |
|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude.json` |
| Codex CLI | `~/.codex/AGENTS.md` | `~/.agents/skills/` | `~/.codex/config.toml` |
| Cursor | unsupported global rules | `~/.cursor/skills/` | `~/.cursor/mcp.json` |
| Gemini CLI | `~/.gemini/GEMINI.md` | `~/.gemini/skills/` | `~/.gemini/settings.json` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | unsupported | `~/.codeium/windsurf/mcp_config.json` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` | `~/.config/opencode/opencode.json` |

## Safety Contract

Reglet is conservative by default because global agent config is sensitive.

```text
no onboarding  -> no provider writes
no enrollment  -> no daemon
no opt-in      -> no sync
no .state/     -> no backup or cursor sync
```

- Onboarding is explicit and selective.
- Provider files are backed up before managed writes.
- Generated files include a header pointing back to `~/.reglet/`.
- Drift is reported instead of silently overwritten.
- Unmanaged MCP keys are preserved.
- Daemon execution and macOS notifications are opt-in.

## Self-Hosted Sync

Run the sync server yourself:

```bash
REGLET_TOKEN=dev-token REGLET_DB=./reglet.sqlite bun packages/server/src/index.ts
```

Connect a client:

```bash
reglet login http://localhost:3000 --token dev-token --device laptop
reglet sync
```

The server is Bun + Hono + SQLite, with a Dockerfile included. It syncs the master directory only: `rules/`, `skills/`, `mcp/servers.json`, and `reglet.toml`.

## Repository Layout

```text
reglet/
├── docs/                    # Installation, usage, architecture, providers, hosting
├── packages/core/           # Provider adapters and local state engine
├── packages/cli/            # Terminal UX and daemon
├── packages/server/         # Self-hosted sync service
├── scripts/                 # Binary build scripts
└── ROADMAP.md
```

## Development

```bash
bun run typecheck
bun test
bun run lint
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

The next product phases are hosted sync, team/shared skill packs, subagent content types, more provider adapters, optional end-to-end encryption, and project-scope mode.

## License

MIT
