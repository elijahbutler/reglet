# Reglet public V1 roadmap

## V1 boundary

Public V1 is a local-only CLI release for the existing six provider adapters. It manages rules, skills, and MCP configuration on the current machine. It does not ship accounts, device lifecycle, remote configuration, hosted services, self-hosted services, network-management commands, or a public macOS app artifact.

The V1 promise is simple:

> Select a local scope, inspect a redacted exact plan, apply it safely, and recover it without relying on terminal memory.

Remote and team capabilities remain unsupported internal source for a later security redesign. They are not a public product capability, artifact, or documentation surface.

## Completed product work

- [x] Local master directory and six provider adapters.
- [x] Immutable public-release capability boundary; the CLI has no `login`, `register`, `pair`, or `sync` command and the macOS manager has no Sync destination.
- [x] Typed MCP process-environment references, missing-variable blocking, redacted review output, and non-reversible secret fingerprints in plan freshness checks.
- [x] Owner-only state, journals, receipts, and recovery snapshots, with fail-closed permission checks.
- [x] Digest-backed transaction plans, atomic sibling staging, durable journals, cross-provider rollback, automatic interruption recovery, and indefinitely retained receipts/snapshots.
- [x] Receipt list/show/restore interfaces and compatibility `restore`/`revert` commands.
- [x] Scoped Stop Managing that preserves provider content and removes the generated rules header when applicable.
- [x] Native macOS manager source for review/apply, Activity, recovery, scoped lifecycle, search, unsaved-edit confirmation, and one redacted manager snapshot response.
- [x] Manual update checks with automatic checks disabled by default.

## Release gates

The code and release automation enforce the following public CLI gates. Source-level macOS manager checks remain in CI, but the app is not a public release artifact.

- [x] Bun, lint, typecheck, and macOS-native Swift tests run in CI.
- [x] Release packaging produces CLI binaries for macOS arm64, macOS x64, and Windows x64 with checksums, provenance, and GitHub attestation.
- [x] Public release publishing is blocked unless `HOMEBREW_TAP_TOKEN` updates `Formula/reglet.rb` in `elijahbutler/homebrew-reglet`.
- [x] Privacy, recovery, security-reporting, release-integrity, and V1-limitations documentation is published with the source.
- [ ] Validate the CLI release on macOS and Windows: install/download → scan → preview → apply → drift → receipt recovery → detach.
- [ ] Record source-level keyboard-only, VoiceOver, contrast, motion, transparency, and text-size evidence before any future public app decision.

## Public V1 limitations

- Public artifacts are CLI-only for macOS arm64, macOS x64, and Windows x64.
- Global provider configuration only; project-scoped configuration is not yet managed.
- Rules are not supported for Cursor and skills are not supported for Windsurf.
- Provider rendering can preserve only the structures each provider format supports; see [Providers](docs/providers.md).
- Recovery snapshots are intentionally never auto-pruned in V1.

## Deferred after V1

- A separately released native macOS Manager following the phased [macOS Manager product and delivery roadmap](docs/macos-manager-roadmap.md).
- Remote collaboration, self-hosted deployment, hosted service, accounts, device lifecycle, and team features.
- Project scope, advanced history views, richer bulk workflows, and additional providers.
- Any future networked design will begin with a new public security and recovery model rather than re-enabling legacy code.
