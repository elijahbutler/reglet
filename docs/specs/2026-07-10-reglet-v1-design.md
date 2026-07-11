# Reglet — unified AI agent config manager with multi-device sync

## Context

Every AI coding tool keeps its global config in its own place and format (`~/.claude/CLAUDE.md` + `~/.claude/skills/`, `~/.codex/AGENTS.md` + `~/.codex/config.toml`, Cursor/Windsurf/Gemini dirs, etc.). The user wants one **master directory** on the machine that holds all system prompts/rules, skills, and MCP server configs in a canonical format, automatically converted and distributed to every installed provider — plus optional multi-device sync via a self-hostable server, with a hosted SaaS tier later.

Decisions made with the user during brainstorming:
- **New repo, not a fork.** The local `ruler` repo (intellectronica/ruler, MIT) is project-scoped throughout; we use it as a read-only **reference** for per-provider formats (its `src/agents/` has 33 adapters + a README table of paths).
- **Scope: machine-level (global) configs only** for v1. No per-project distribution.
- **Content types v1:** rules/system prompts, skills, MCP configs. Subagents deferred.
- **Client:** CLI + background daemon (file watcher, auto-convert, auto-sync). macOS + Windows.
- **Direction: one-way** — master dir is source of truth. Drift detection on provider files → prompt to import into master or unenroll that file. An **injected instruction block** in generated files tells agents to edit the master or unenroll instead of editing generated output.
- **Onboarding:** scan machine for installed providers + existing prompts/skills/MCPs, let user select what to import, **back up** each provider's state before first apply, warn before replacing.
- **Sync: custom REST API** with versioned snapshots (not git). Self-hostable single container.
- **v1 is OSS-only**; SaaS (billing, hosted dashboard) stays in the plan as roadmap.
- **Name: `reglet`** (a small flat ruler — typography term). npm `reglet` is free; no significant GitHub collision. Master dir `~/.reglet/`. Backup name: `homerule`.

## Architecture (Approach A — approved)

TypeScript monorepo, **bun workspaces**:

```
reglet/
  packages/core/     # provider registry, converters, manifest, backup, scan
  packages/cli/      # reglet CLI + daemon (same binary)
  packages/server/   # self-hostable sync server (Hono + SQLite, Docker)
  apps/web/          # (roadmap, SaaS) React/Tailwind dashboard
  docs/              # spec, provider format notes
```

### packages/core
- **Master dir schema** (`~/.reglet/`):
  - `rules/*.md` — markdown rule files, concatenated (ruler-style) into each provider's rules file.
  - `skills/<name>/SKILL.md` (+ assets) — canonical skill format (Claude-style frontmatter).
  - `mcp/servers.json` — canonical MCP server definitions.
  - `reglet.toml` — config: enabled providers, per-file/per-provider unenroll list, sync settings.
  - `.state/` — applied-output hash manifest (drift detection), backups, sync state. Never synced except manifest metadata.
- **Provider registry**: one adapter per provider declaring global-scope output paths + converter for each content type. Port format knowledge from ruler's `src/agents/*.ts`, but paths must be re-researched for **global** scope (ruler's are project-relative; e.g. Claude → `~/.claude/CLAUDE.md`, Codex → `~/.codex/AGENTS.md` + `config.toml`, Gemini → `~/.gemini/`). Start with ~6 launch providers: Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, OpenCode; registry designed so adding one = one file.
- **Converter engine**: rules → concatenated md with injected header block (generation notice + agent instructions: "edit `~/.reglet/rules/`, or run `reglet unenroll <file>`"); skills → copy/transform into provider skill dirs; MCP → emit provider-specific config (`.mcp.json` merge, TOML for codex, etc.), merging non-managed keys rather than clobbering (ruler's MCP merge logic in `src/mcp/` is the reference).
- **Hash manifest**: record hash of every generated file at apply time → detect hand-edits (drift) and enable clean revert (ruler's `src/core/hash.ts` + revert-engine are the reference).
- **Scanner**: detect installed providers (well-known dirs/binaries), inventory existing rules/skills/MCPs for import.
- **Backup/restore**: timestamped snapshot of each provider's managed files before first apply and before every destructive change; `reglet restore` undoes.

### packages/cli (`reglet`)
- Commands: `init`, `scan`, `import`, `apply`, `status` (drift + sync state), `diff`, `unenroll <path>`, `restore`, `sync [push|pull]`, `login`, `daemon start|stop|status`, `revert`.
- Onboarding flow (`reglet init`): scan → interactive multi-select of providers + content to import → backup → build master dir → confirm → first apply.
- **Daemon**: same binary in watch mode. Watches master dir (→ auto-apply + auto-sync push) and provider output paths (→ drift prompt via CLI notification on next interaction; queue drift events in `.state/`). Debounced. Install as launchd agent (mac) / Scheduled Task or NSSM-style service (Windows) via `reglet daemon install`.
- Distribution: npm package + `bun build --compile` binaries for macOS (arm64/x64) and Windows.

### packages/server (self-hosted sync)
- **Stack**: Bun + Hono + SQLite (Drizzle), one Docker container, single `docker run` self-host.
- **Auth**: account (email+password or single-user token for self-host) + per-device tokens via short pairing code (`reglet login` shows code, confirm on another device or server UI).
- **Sync protocol** (versioned snapshots, per-file):
  - Every synced file has `(path, revision, hash, content)`; server holds head revision + history.
  - Client push: `PUT /files/:path {baseRevision, content}` → 409 if base ≠ head → client 3-way merges markdown (base from local history) or writes conflict copy (`file.conflict-<device>.md`) and surfaces it.
  - Client pull: `GET /changes?since=<cursor>` → apply, then local `apply` to providers.
  - Only the master dir syncs — never provider outputs or `.state/` backups.
- Minimal server web page: device list, pairing approval (fancier UI is roadmap).

## Build order (v1 milestones)

1. **Repo bootstrap**: `gh repo create` (user's account) `reglet`, MIT, bun workspaces, TS strict, eslint/prettier, vitest (or bun test), CI (GitHub Actions: lint/typecheck/test). Commit the design spec into `docs/`.
2. **M1 — core + apply**: master dir schema, provider registry (6 providers), converter engine, hash manifest, `reglet init/apply/status/diff/revert`. Golden-file tests per adapter.
3. **M2 — scan/import/backup onboarding**: scanner, interactive import, backups, `restore`, injected instruction block, `unenroll`.
4. **M3 — daemon**: watcher, debounced auto-apply, drift detection/prompt queue, `daemon install` for launchd + Windows.
5. **M4 — sync**: server package (auth, pairing, snapshot API), CLI sync client, conflict handling, Docker image + self-host docs.
6. **Roadmap (post-v1, documented in `ROADMAP.md`, not built now)**: SaaS — same server on Postgres, Stripe subscription for multi-device sync, `apps/web` dashboard (React/Tailwind), team sharing of skill packs, subagents content type, more providers, optional E2E encryption of synced content.

## Key references (in this local ruler checkout, read-only)
- `src/agents/*.ts` — per-provider formats/paths (project-scoped; translate to global).
- `src/core/hash.ts`, `src/core/revert-engine.ts` — manifest + revert patterns.
- `src/mcp/` — MCP config merge logic per provider.
- README agent table — full provider/paths matrix.

## Verification
- Unit + golden-file tests: each adapter's output for a fixture master dir (rules/skills/MCP) matches expected provider files.
- E2E (temp `$HOME` sandbox): `init` → `apply` → hand-edit a generated file → `status` reports drift → `import`/`unenroll` paths both work → `revert`/`restore` round-trip restores backups byte-identical.
- Sync E2E: run server in Docker, two client sandboxes, push/pull, forced conflict → verify 3-way merge and conflict-copy fallback.
- Daemon: touch a master rule file, confirm provider files regenerate; confirm launchd install on this Mac.
- Manual smoke on the real machine (with backups) against Claude Code + Codex CLI once tests pass.
