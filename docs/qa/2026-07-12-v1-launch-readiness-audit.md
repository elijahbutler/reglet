# Public V1 launch-readiness record

## Product boundary

Public V1 is a local-only CLI release for the six current provider adapters with ad-hoc-signed/unnotarized macOS and unsigned Windows desktop artifacts under Tauri parity. No account, device linking, hosted service, self-hosted deployment, remote configuration, or background configuration-network activity is part of the release. The retained Swift manager remains frozen during parity, and Linux GUI publishing is deferred.

## Implemented trust controls

- Typed MCP process-environment references; raw credential values are rejected and redacted from public views.
- Digest-backed structured plans with expected target hashes, drift state, snapshot behavior, and secret fingerprints.
- Durable journals, atomic sibling staging, cross-provider rollback, interruption recovery, receipts, and explicit restore.
- Owner-only state, journals, receipts, snapshots, and fail-closed permission enforcement.
- Scoped detachment that preserves provider content and removes Reglet ownership.
- Native Review & Apply, activity/recovery, search, unsaved-edit protection, and local manager snapshot contract retained in source.
- Manual update checks by default; automatic checks require an explicit preference.

## Remaining release-operator work

The release is blocked until the CLI artifact matrix in [CLI V1 certification matrix](2026-07-11-macos-smoke-matrix.md) and the mandatory Homebrew tap update are recorded against the exact checksums. Source-level macOS manager accessibility evidence remains tracked for a future app distribution decision, but it is not required to ship the CLI-only release.

See [Release integrity and V1 certification](../release.md) for the required artifact checks and record format.
