# Reglet public V1 roadmap

## V1 boundary

Public V1 is a local-only macOS manager for the existing six provider adapters. It manages rules, skills, and MCP configuration on one Mac. It does not ship accounts, device lifecycle, remote configuration, hosted services, self-hosted services, or network-management commands.

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
- [x] Native review/apply, Activity, recovery, scoped lifecycle, search, unsaved-edit confirmation, and one redacted manager snapshot response.
- [x] Manual update checks with automatic checks disabled by default.

## Release gates

The code and release automation enforce the following gates. The physical credentials and real-machine evidence are release-operator work and must be recorded for every public release candidate.

- [x] Bun, lint, typecheck, and macOS-native Swift tests run in CI.
- [x] Release packaging fails without Developer ID signing, notarization, stapling, verification, checksums, and build provenance.
- [x] Public binaries and installers are macOS-only; no quarantine bypass or unsigned/ad-hoc fallback exists.
- [x] Privacy, recovery, security-reporting, release-integrity, and V1-limitations documentation is published with the source.
- [ ] Validate a signed artifact on a fresh Mac: install → onboarding → review/apply → drift → receipt recovery → detach → uninstall.
- [ ] Record keyboard-only, VoiceOver, contrast, motion, transparency, and text-size certification against that signed artifact.

## Public V1 limitations

- macOS only.
- Global provider configuration only; project-scoped configuration is not yet managed.
- Rules are not supported for Cursor and skills are not supported for Windsurf.
- Provider rendering can preserve only the structures each provider format supports; see [Providers](docs/providers.md).
- Recovery snapshots are intentionally never auto-pruned in V1.

## Deferred after V1

- Remote collaboration, self-hosted deployment, hosted service, accounts, device lifecycle, and team features.
- Project scope, advanced history views, richer bulk workflows, and additional providers.
- Any future networked design will begin with a new public security and recovery model rather than re-enabling legacy code.
