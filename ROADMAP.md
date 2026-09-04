# Reglet production roadmap

## Status

Reglet is a local-first CLI and cross-platform manager for AI-agent rules, Skills, and MCP configurations across AI coding assistants.

Protocol v2 end-to-end encrypted sync (`v2-crypto`, `v2-engine`, SAS comparison, pairing codes, and homeserver relay) is now active and operational in the preview CLI.

### Active Milestones Matrix

- **Milestone 0: Sync Hardening (`v0.5.10` - `v0.5.11`)** — Shipped ✅ (2MB payloads, decoupled pairing, server-aware setup, MCP boolean normalization)
- **Milestone 1: Conflict Resolution CLI (`v0.5.12`)** — Shipped ✅ (Actionable conflict output, `reglet sync conflicts` interactive wizard, `reglet sync resolve` CLI command, path normalization)
- **Milestone 2: Vaulted Secrets Management & MCP Experience (`v0.5.13` - `v0.5.14`)** — Shipped ✅ (`reglet secret set/list/delete/status`, interactive in-flight prompts, automatic OS keychain + encrypted vault sync)
- **Milestone 3: Ephemeral Local Web Conflict GUI (`v0.5.14`)** — Shipped 🚀 (`reglet sync conflicts --web`, `reglet ui`, zero-knowledge loopback browser diff & one-click resolution)
- **Milestone 4: AI Smart Merging (`v0.6.0`)** — In Design 📐 (Semantic LLM reconciliation of Markdown instructions and JSON configurations)
- **Milestone 5: Server Resiliency & Operations (`v0.7.0`)** — Planned 💡 (Coolify zero-downtime persistence, automated SQLite snapshots, multi-vault support)

The target product is:

> One private, reviewable Master for local AI-agent configuration, with optional end-to-end encrypted synchronization between explicitly paired devices.

## Production definition

Reglet is production-ready only when all of the following are true:

- A user can install, onboard, edit, review, apply, detect drift, detach, and recover without terminal knowledge.
- Every provider mutation uses a fresh digest-backed plan, snapshots existing content, and creates a durable receipt.
- Network-originated changes can update only the local Master draft. They never write provider files without a separate local Review & Apply action.
- The sync service cannot read Master content or resolved MCP credential values.
- Lost or compromised devices can be listed and revoked without rotating every healthy device.
- Supported macOS and Windows artifacts are signed, reproducibly tested, and covered by keyboard and screen-reader evidence.
- The CLI remains a fully supported local automation surface.
- Release documentation describes actual shipped behavior and contains no stale product boundaries.

## Non-negotiable trust boundaries

1. **Local-first:** editing and applying work without an account or server.
2. **Explicit network consent:** no account creation, pairing, sync, telemetry, or update check runs without an explicit user choice.
3. **No remote apply:** pulls create a reviewable Master revision; provider output is always a separate local transaction.
4. **End-to-end encryption:** hosted storage contains ciphertext and minimal routing metadata, not plaintext rules, Skills, MCP definitions, or credentials.
5. **Typed secrets:** MCP credentials remain process-environment references. Resolved values never enter sync payloads.
6. **Recoverability:** sync conflicts, local provider drift, provider apply, and receipt restoration remain distinct operations.
7. **Fail closed:** unknown protocol versions, invalid paths, invalid ciphertext, stale revisions, missing variables, and insecure local permissions block mutation.

## Current foundation

- [x] Six provider adapters and a versionable local Master.
- [x] Digest-backed preview/apply with stale-plan rejection.
- [x] Durable journals, rollback, receipts, restoration, and scoped Stop Managing.
- [x] Provider-scoped rules, Skills, and MCP definitions.
- [x] Typed MCP environment references and redacted Manager contracts.
- [x] Tauri desktop shell with Providers, Rules, Skills, MCP, Activity & Drift, Recovery, onboarding, and update controls.
- [x] Cross-platform frontend, protocol, and Rust bridge tests in CI.
- [x] Dormant revision-based sync prototype with accounts, device pairing, conflicts, and SQLite persistence.

The sync prototype is evidence, not a production baseline. The containment pass now validates one shared path contract, prevents remote provider apply, preserves edit/delete conflicts, synchronizes tombstones and provider-scoped MCP files, stores private state atomically, and provides basic device lifecycle controls. Protocol v1 still stores plaintext and remains disabled pending the protocol-v2 cryptographic and recovery work.

## Phase 0 — contain risk and make the plan truthful

Goal: remove known release blockers and make repository documentation describe one product.

- [x] Validate every remote path on the client before any read, write, or delete; add malicious-server traversal tests.
- [x] Remove automatic provider apply after a sync pull.
- [x] Store sync state and merge bases atomically with owner-only permissions.
- [x] Propagate local deletions and provider-scoped MCP definitions correctly.
- [x] Upgrade vulnerable development dependencies and make dependency audits a CI gate.
- [x] Replace the stale native-macOS implementation plan with this roadmap and archive it as historical context.
- [x] Split server routing, persistence, security, validation, and rate limiting into reviewable modules.
- [x] Record the sync threat model and protocol-v2 decisions before exposing a command or UI.

Exit criteria:

- A malicious or compromised server cannot escape `~/.reglet`, trigger provider writes, or persist unsafe state.
- All existing checks pass and new security regression tests fail against the previous implementation.
- Public commands and screens still report sync as unavailable.

## Superseded or retired work

These items should not return as open roadmap tasks:

- Reintroducing the retired native Swift app.
- Shipping or incrementally polishing plaintext sync protocol v1. It is now only a disposable local development harness; production work starts at encrypted protocol v2.
- Applying provider outputs automatically after a pull. This contradicts the product trust boundary and is permanently excluded.
- Building separate modal behavior per screen. The desktop now has one shared accessible dialog boundary; remaining work is native acceptance evidence.
- Splitting the protocol-v1 server coordinator or adding its basic revision, tombstone, pairing-claim, and device controls. Those foundations are complete; further server work belongs to encryption, hosted operations, quotas, and recovery.
- Expanding provider count before the existing six-provider lifecycle matrix is complete.

## Phase 1 — complete and simplify the desktop app

Goal: make the Tauri app a complete, maintainable daily-use product.

### Architecture

- [ ] Reduce `App.tsx` to an application coordinator; move views, dialogs, parsing, and mutations into focused modules.
- [ ] Split onboarding state/commands from step presentation and keep each step independently testable.
- [ ] Split the CLI command registry, Manager RPC dispatch, snapshot construction, and AI drafting out of the monolithic CLI entry point.
- [ ] Generate or centrally validate Manager operation results instead of repeating ad-hoc JSON parsing in the UI.
- [ ] Replace repeated sidecar process launches with bounded batch operations where one user action currently launches several commands.

### Product lifecycle

- [ ] Persist and resume onboarding drafts without touching provider files.
- [x] Disable unsupported provider/content cells in every surface.
- [ ] Complete Rules, Skills, and MCP create, edit, rename, move-scope, delete, import, and conflict workflows.
- [ ] Add three-way drift review with Adopt to Master, Keep Local & Stop Managing, and Restore Master.
- [ ] Preview receipt restoration through the same fresh-plan boundary used by apply.
- [ ] Add redacted diagnostics export and a single Reveal Local Data action.
- [ ] Preserve one clear next action for blocked, drifted, changed, and healthy states.

### Interface quality

- [ ] Replace the four-card status strip with a quieter task-oriented summary.
- [ ] Remove repeated card nesting and decorative uppercase labels where they do not improve scanning.
- [x] Add a shared accessible dialog primitive; trap focus, restore focus, and make nested confirmations inert-safe.
- [ ] Verify layouts at the minimum window size, Windows scaling, large text, Increase Contrast, Reduce Motion, and Reduce Transparency.
- [ ] Record keyboard, VoiceOver, and Narrator walkthroughs for every primary workflow.

Exit criteria:

- The cross-content lifecycle matrix passes for every advertised provider/content capability.
- No production UI module combines global coordination, transport parsing, and full-screen presentation.
- Native acceptance is recorded for macOS arm64/x64 and Windows 10/11 x64.

## Phase 2 — secure multi-device sync protocol

Goal: replace the plaintext prototype with a versioned, end-to-end encrypted protocol.

### Client protocol

- [x] Define protocol v2 with authenticated encryption, opaque object identifiers, authenticated metadata, bounded payloads, idempotency keys, and explicit version negotiation.
- [x] Generate encryption keys on-device and transfer them only through an authenticated fingerprint pairing flow.
- [x] Keep device credentials in macOS Keychain or Windows Credential Manager; keep only non-secret sync metadata in `~/.reglet/.state`.
- [x] Encrypt Master objects before upload and decrypt only after integrity, identity, size, revision, checkpoint, and path validation.
- [x] Sync shared/provider-scoped rules, Skills, MCP definitions, and tombstones; exclude provider outputs, receipts, snapshots, merge bases, resolved secrets, enrollment, and machine-local settings.
- [x] Pull only into the local Master and named conflict artifacts; never invoke provider apply.
- [ ] Add a first-class sync receipt and conflict inbox UI over the existing conflict artifacts.
- [x] Support manual sync first behind an explicit preview gate. Any later background pull is separately opt-in and still cannot auto-apply.

### Account and device lifecycle

- [x] Normalize and validate account identifiers and enforce a documented password policy.
- [x] Move password verification to asynchronous memory-hard scrypt.
- [ ] Version password-hash parameters and complete a production parameter review.
- [x] Add device list, rename, last-seen, and server-access revoke.
- [ ] Add protocol-v2 device-token rotation and current-device remote revocation.
- [x] Add local logout and expired pairing cleanup.
- [ ] Add epoch rotation/re-encryption and encrypted offline device recovery.
- [x] Make development pairing codes short-lived, rate-limited, and single-use through an atomic claim.
- [x] Replace code-only pairing with an authenticated flow bound to pending X25519/Ed25519 device keys and an out-of-band fingerprint.
- [x] Require TLS for non-loopback clients and document reverse-proxy trust configuration.
- [x] Keep self-hosted single-user mode closed by default; do not expose public registration in that mode.

Exit criteria:

- Server/database compromise does not reveal Master plaintext.
- Revoked devices cannot read new ciphertext or upload new revisions.
- Replay, concurrent-write, malicious-path, malformed-ciphertext, oversized-payload, and downgrade tests pass.
- Two clean devices can pair, exchange changes, surface conflicts, and recover without provider writes.

## Phase 3 — production sync service

Goal: make the server deployable, observable, recoverable, and safe under concurrency.

- [x] Separate routing, authentication, sync storage, validation, and rate limiting behind typed interfaces.
- [x] Make revision comparison, sequence allocation, write/tombstone persistence, history, and pairing claims transactional.
- [x] Add bounded pagination and stable cursors for changes.
- [x] Add bounded pagination and stable cursors for device lists.
- [x] Ignore forwarded client addresses unless proxy trust is explicitly configured.
- [ ] Add persistent/distributed rate limiting for hosted deployments.
- [x] Add transactional schema migrations, indexes, foreign keys, and WAL/busy-timeout policy for SQLite.
- [x] Refuse forward-incompatible schema versions at startup.
- [ ] Add migration rollback rehearsals and a hosted-store path before horizontal scaling.
- [x] Bound devices, pending pairs, object count, object size, history, request bodies, and response pages for the single-node preview.
- [ ] Add user/total-storage quotas and persistent request-rate quotas for hosted operation.
- [x] Add health and database-backed readiness endpoints.
- [ ] Add structured secret-free logs, request IDs, metrics, and audit events for authentication and device lifecycle.
- [x] Add verified online SQLite backup and corruption checks.
- [ ] Automate restore, retention, and disaster-recovery rehearsals.
- [x] Publish a hardened container and single-node homeserver runbook with TLS requirements and protocol v1 disabled.

Exit criteria:

- Fault-injection covers concurrent writes, process interruption, database lock/contention, migration rollback, partial storage failure, and restore from backup.
- Load tests meet documented latency and storage targets without unbounded memory or database growth.
- Operational logs and metrics contain no plaintext Master content, credentials, tokens, ciphertext keys, or password material.

## Phase 4 — signed release candidate

Goal: produce release artifacts that can be trusted without bypassing platform protections.

- [ ] Sign and notarize macOS app archives and disk images.
- [ ] Sign Windows installers and application binaries.
- [ ] Verify update metadata and downloads cryptographically; keep automatic checks opt-in.
- [x] Self-updating CLI: implement `reglet update` command to query GitHub releases, verify SHA256 checksums, and safely replace the current executable in-place across macOS and Linux.
- [ ] Publish SBOMs, checksums, provenance, privacy documentation, recovery documentation, sync protocol documentation, and a support policy.
- [ ] Run clean-install and upgrade matrices across supported operating systems and provider versions.
- [ ] Run dependency, static analysis, secret scanning, malicious-server, and release-binary smoke tests in CI.
- [ ] Rehearse rollback of both a failed provider transaction and a bad application/server release.

Exit criteria:

- All desktop, CLI, server, security, accessibility, and recovery gates have evidence tied to release checksums.
- No known P0/P1 finding remains open.
- The retired Swift app source is no longer part of the tracked build surface.

## Phase 5 — general availability

- [ ] Enable sync commands and desktop controls only for protocol-v2-capable builds.
- [ ] Roll out through an opt-in preview, then a limited beta, then general availability with rollback controls.
- [ ] Publish service status, incident response, data deletion, account recovery, and deprecation policies.
- [ ] Review security, privacy, dependency, accessibility, and recovery evidence for every release.

## Deferred

- Teams, shared organization policy, and collaborative editing.
- Project-scoped provider configuration.
- Automatic semantic merging or automatic conflict resolution.
- Automatic provider apply, background provider watchers, or silent drift adoption.
- Additional providers until the existing capability matrix is complete.
- Linux desktop publishing until macOS and Windows acceptance is stable.

## Measures

- Zero provider writes without a locally reviewed current digest.
- Zero plaintext Master content or resolved credentials in server storage and operational telemetry.
- Zero open P0/P1 findings at a release candidate.
- 100% pass rate for supported lifecycle, malicious-server, recovery, keyboard, and screen-reader matrices.
- Bounded sync request size, storage, history, and latency with published targets.
- Core coordinators stay small enough to review: application/command entry points under 500 lines unless an explicit design note justifies otherwise.
