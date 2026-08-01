# Repositioning Acceptance Evidence

This file maps the rounded-out manager repositioning to source and automated
verification. Production signing credentials, notarization, and update-feed
publication remain release operations rather than repository code.

## Product boundaries and lifecycle

- Canonical schema and lifecycle: `packages/core/src/artifacts/`.
- Stable duplicate, atomic rename, archive, tombstone deletion, 30-day/50-item
  history retention, drafts, and undo: `packages/core/test/library-v2.test.ts`.
- Explicit provider Apply, preserved unmanaged entries, pre-write backups,
  restore, purge, drift, and isolated provider failures:
  `packages/core/test/apply.test.ts`.
- Three-hash projection derivation and typed issues:
  `packages/core/test/projection.test.ts`.

## Providers, projects, and promotion

- Data-owned discovery registry, documentation metadata, schema versions, and
  compatibility fixtures: `packages/core/src/providers/`.
- Deduplicated multi-provider discoveries, hierarchical skills, Codex fallback
  names, changed ignored revisions, and non-following scans:
  `packages/core/test/discovery.test.ts`.
- Scope recommendations, selected instruction hunks, selected skill files,
  executable trust, normalized MCP comparison, Codex TOML, machine overrides,
  and credential extraction: `packages/core/test/application.test.ts` and
  `packages/core/test/promotion.test.ts`.
- Debounced non-blocking project watching: `packages/server/src/project-watcher.ts`
  and `packages/server/test/runtime.test.ts`.

## Security and privacy

- Safe skill inventory and copying, escaping-symlink refusal, executable trust
  invalidation, and no execution: `packages/core/src/security/skills.ts`.
- OS keychain bindings expose status only: `packages/core/src/security/secrets.ts`
  and `packages/core/test/secrets.test.ts`.
- Literal MCP secrets are rejected; likely project credentials become unbound
  keychain references; security- or behavior-changing unsupported MCP options
  block promotion; harmless options remain visible warnings:
  `packages/core/test/application.test.ts`.
- Structured logs rotate five 10 MB files by default and redact secret-shaped
  values and user paths: `packages/server/src/logging.ts`.
- Metadata-only diagnostics exclude artifact bodies, project paths, secrets,
  environment values, and authorization data.

## Runtime, remote access, sync, and operations

- Serialized commands, optimistic revisions, Hono API, scoped authorization,
  one-use pairing, hashed tokens, one-use WebSocket tickets, restrictive browser
  headers, `/healthz`, and `/readyz`: `packages/server/test/runtime.test.ts`.
- Canonical-only sync, artifact-ID metadata merge, text three-way merge,
  rename/delete conflicts, preserved binary variants, per-file limits, and
  independent clean artifacts: `packages/core/test/sync.test.ts` and
  `packages/server/test/sync.test.ts`.
- Hardened Electron bootstrap, sandboxed navigation, signed packaging hooks,
  approved daily updates, and install-on-restart: `packages/desktop/`.

## Manager and CLI

- The shared manager implements onboarding, Library workbench, lifecycle
  filters, structured editors, projection inspection, Apply, effective provider
  pages, Project Inbox, promotion review, Activity, Settings, search, command
  palette, scoped-session controls, compact layouts, co-primary themes, visible
  focus, and reduced motion: `packages/manager/`.
- SQLite FTS5 search stays below 100 ms for 10,000 cached discoveries in the
  automated performance scenario: `packages/core/test/state.test.ts`.
- The initial unbundled manager shell is below the 350 KB gzip budget.
- CLI lifecycle, project, promotion, secret, remote, session, history, undo,
  diagnostics, sync, open, and serve operations route through the same
  application layer: `packages/cli/src/index.ts`.

## Verification command

```sh
bun test
bun run typecheck
bun run lint
git diff --check
node --check packages/manager/src/app.js
node --check packages/manager/src/runtime.js
```
