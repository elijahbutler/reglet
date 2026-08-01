# ADR 0001: Canonical manager layers

- Status: Accepted
- Date: 2026-07-31

## Context

The superseded manager branch coupled a large application service, local HTTP
runtime, browser UI, Electron shell, provider behavior, and sync behavior to an
architecture that predates the current Tauri desktop and typed manager
protocol. Merging that branch would create duplicate authorities.

## Decision

Domain and filesystem behavior remain in `@reglet/core`. Versioned transport
contracts live in `@reglet/manager-protocol`. Serialized use cases live in
`@reglet/manager-application` and cannot import UI, HTTP, Tauri, or sync-server
packages. `@reglet/manager-runtime` adapts the application to local HTTP and
WebSocket transports. `@reglet/manager-ui` depends only on its transport-neutral
`ManagerClient` and the protocol package.

The CLI and local runtime invoke the same application dispatcher. The Tauri and
browser entries mount the same React workbench. Provider adapters and encrypted
sync remain single implementations in core.

## Consequences

Transport code cannot become a second application service. Client-specific
behavior is limited to lifecycle, authentication bootstrap, and native actions.
Compatibility aliases route inward to the canonical dispatcher and can be
removed after the stated migration window.
