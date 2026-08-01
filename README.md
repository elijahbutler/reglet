# Reglet

Reglet is a local-first manager for agent instructions, skills, and MCP server
definitions. It keeps a canonical global library, previews provider-specific
projections, and changes provider files only after an explicit Apply.

It supports Codex, Claude Code, Cursor, Gemini CLI, Windsurf, and OpenCode. A
*reglet* is a small flat ruler: the product is a reference point for keeping
agent configuration aligned without hiding ownership or scope.

## Product model

- **Library:** canonical, editable artifacts with stable IDs, lifecycle,
  machine-local invalid drafts, history, and recovery.
- **Providers:** readable and diffable projections. Reglet preserves unmanaged
  entries, reports drift and shadowing, backs up before destructive writes, and
  never edits arbitrary provider settings.
- **Projects:** read-only discovery roots. Promotion requires an explicit scope
  choice and records provenance locally.
- **Connections:** remote access and canonical-only sync are optional and off by
  default. Project state, drafts, secrets, and provider outputs never sync.

Reglet never executes skill scripts or starts MCP servers. Secret values live in
the OS keychain; canonical MCP definitions contain references only.

## Workspace

Canonical content defaults to `~/.reglet/`:

```text
rules/                 Markdown instructions
skills/<slug>/         SKILL.md plus reviewed assets
mcp/servers.json       MCP definitions and keychain references
library.json           Stable artifact metadata
.state/reglet.sqlite   Local projections, projects, sessions, trust, and sync state
```

## CLI

Use Bun for source development:

```sh
bun packages/cli/src/index.ts init
bun packages/cli/src/index.ts create instruction --slug general
bun packages/cli/src/index.ts project root add /path/to/repository
bun packages/cli/src/index.ts project scan
bun packages/cli/src/index.ts apply --dry-run
bun packages/cli/src/index.ts apply
bun packages/cli/src/index.ts serve
```

Consequential commands support `--json`; destructive commands require explicit
non-interactive confirmation such as `--yes`. Run `reglet help` for lifecycle,
promotion, secrets, sessions, diagnostics, remote access, and sync commands.

Exit codes are `0` success, `1` operation error, `2` drift or conflict, `3`
validation or blocked projection, and `4` authentication or permission failure.

## Manager and desktop

`reglet serve` exposes the shared Raycast-style manager and a Hono runtime.
Pairing credentials are one-use and expire after ten minutes. Read, write, and
admin sessions are scoped; development roots, secret binding, sessions, and
network settings require admin scope.

The Electron client starts the same loopback runtime in a sandboxed window.
macOS and Windows packaging, signing hooks, daily opt-in update checks, and
install-on-restart behavior live in `packages/desktop`.

## Sync and privacy

The included self-hosted sync service stores canonical content in plaintext
unless its operator encrypts storage. Sync conflicts are resolved per file and
do not block clean artifacts or local Apply. A hosted service is intentionally
deferred until client-side end-to-end encryption is available.

Reglet has no product analytics by default and no configured crash-upload
endpoint. Metadata-only diagnostics redact secrets, project paths, artifact
bodies, environment values, and authorization data.

## Development checks

```sh
bun test
bun run typecheck
bun run lint
```

See [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), and
[ACCEPTANCE.md](ACCEPTANCE.md) for the durable contracts and verification map.

## License

MIT
