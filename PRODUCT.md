# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Reglet is for developers who use more than one coding agent and want one durable,
auditable place for their instructions, skills, and MCP server definitions. It is
also for developers who work across several machines and teams that need to
understand which local configuration is canonical, projected, or merely
discovered.

## Product Purpose

Reglet is a local-first manager for agent configuration. Its core loop is to
maintain a canonical global library, preview provider-specific projections,
apply them explicitly, discover useful project artifacts, and deliberately
promote or merge those artifacts. Optional sync moves only canonical library
content between machines.

Success means a user can tell what Reglet owns, what each provider currently
observes, what remains project-local, and what will change before any write.

## Positioning

Reglet manages configuration as artifacts with lifecycle, validation, history,
provider compatibility, and explicit projection state. It does not treat
provider directories as a folder-mirroring target and it never turns discovered
project guidance into global guidance without a scope decision.

## Operating Context

- The canonical library lives under `~/.reglet/` by default.
- Provider projections live in provider-owned locations and may contain
  unmanaged entries that Reglet must preserve.
- Project roots are read-only discovery sources.
- The same consequential operations are available through the manager UI and
  the `reglet` CLI.
- Remote access, sync, analytics, and crash uploads are disabled by default.

## Capabilities and Constraints

- Canonical artifacts are instructions, skills, and MCP server definitions.
- Artifacts support stable IDs, draft recovery, rename, duplicate, archive,
  permanent delete, history, and recovery.
- Invalid structured edits remain machine-local drafts and are neither synced
  nor projected.
- Provider output changes only through an explicit Apply operation.
- Reglet never executes a skill or starts an MCP server during discovery,
  validation, promotion, or apply.
- Secret values remain in the operating-system credential store or process
  environment and must never enter canonical content, sync payloads,
  diagnostics, activity, logs, or API responses.
- Project content and provenance remain local unless content is deliberately
  promoted into the canonical library.
- Sync is optional, canonical-only, and cannot block local editing or apply.
- Hosted sync remains deferred until client-side end-to-end encryption exists.
- The first supported desktop packages are macOS and Windows; the shared manager
  must also remain usable through a local web endpoint.

## Brand Commitments

The product name is Reglet, a small flat ruler used as a reference for alignment.
The voice is precise, calm, and candid about ownership, risk, compatibility, and
irreversible actions. Light and dark themes are co-primary.

## Evidence on Hand

The `main` baseline contains the strict TypeScript/Bun core, six provider
adapters, provider-scoped content, safe provider writes and durable operation
receipts, a typed manager protocol with Snapshot V2 compatibility, a Tauri
desktop, a headless Commander CLI, and encrypted Sync V2 with its self-hosted
server and owner application. These surfaces are covered by unit and
integration tests.

Production signing, notarization, and update-feed publication remain release
operations that require platform credentials and infrastructure. Hosted sync is
not a shipped capability; the included sync server is self-hosted and stores
authenticated encrypted envelopes rather than canonical plaintext.

## Product Principles

1. Make ownership and scope unmistakable.
2. Preview first; apply explicitly.
3. Preserve local work, invalid drafts, unmanaged entries, and recoverable
   history.
4. Block only the affected artifact or provider.
5. Keep project data and secrets local by default.

## Accessibility & Inclusion

Manager workflows must be fully keyboard operable, expose visible focus, honor
reduced motion, remain understandable without color alone, and support both
light and dark system preferences. Destructive operations use contextual inline
confirmation whenever leaving the current surface is not itself dangerous.
