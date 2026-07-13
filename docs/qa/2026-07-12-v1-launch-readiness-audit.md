# Public V1 launch-readiness record

## Product boundary

Public V1 is a local-only macOS manager for the six current provider adapters. No account, device linking, hosted service, self-hosted deployment, remote configuration, or background configuration-network activity is part of the release.

## Implemented trust controls

- Typed MCP process-environment references; raw credential values are rejected and redacted from public views.
- Digest-backed structured plans with expected target hashes, drift state, snapshot behavior, and secret fingerprints.
- Durable journals, atomic sibling staging, cross-provider rollback, interruption recovery, receipts, and explicit restore.
- Owner-only state, journals, receipts, snapshots, and fail-closed permission enforcement.
- Scoped detachment that preserves provider content and removes Reglet ownership.
- Native Review & Apply, activity/recovery, search, unsaved-edit protection, and local manager snapshot contract.
- Manual update checks by default; automatic checks require an explicit preference.

## Remaining release-operator work

Code cannot supply Apple Developer ID credentials or real-machine accessibility evidence. The release is blocked until the signed artifact completes the matrix in [macOS V1 certification matrix](2026-07-11-macos-smoke-matrix.md) and the evidence is recorded against its checksum.

See [Release integrity and V1 certification](../release.md) for the required artifact checks and record format.
