# ADR 0002: Separate local manager runtime from encrypted sync

- Status: Accepted
- Date: 2026-07-31

## Context

The desktop and browser need a persistent local command endpoint, while Sync V2
is an optional self-hosted ciphertext service with separate trust and lifecycle
boundaries.

## Decision

`@reglet/manager-runtime` is a local runtime started by `reglet serve` or the
Tauri shell. It owns pairing, scoped sessions, filesystem invalidations,
readiness, diagnostics, and shared manager asset hosting. It defaults to a
random loopback port and refuses unsafe binding without explicit configuration.

`@reglet/server` remains the encrypted Sync V2 service and owner application.
It does not serve the local manager API or workbench. Sync never becomes a
prerequisite for local editing, provider preview, or Apply.

## Consequences

Runtime credentials cannot authenticate to the sync service and sync device
credentials cannot authenticate to the manager runtime. Either service can be
disabled without degrading the other's local guarantees.
