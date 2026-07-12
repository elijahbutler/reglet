# Roadmap

## V1 decision

Reglet already has credible local-control-plane breadth: six provider adapters, a versionable master directory, safe first writes and backups, drift handling, scoped skill adoption, a self-hosted sync service, a scriptable CLI, and a native macOS manager.

**It is not ready for a public V1 launch yet.** The remaining work is not broad feature expansion. It is a bounded release program that makes Reglet's safety promise true under failure, remote sync, and day-to-day manager use.

The V1 promise is:

> A local-first macOS manager for AI-agent configuration where people can inspect scope, make a deliberate change, review its exact effects, apply it safely, and recover without terminal memory.

The CLI remains the stable automation and CI interface. The app is the primary surface for routine management. Daemon activity, network access, and provider writes must remain explicit, visible, and reversible.

See the evidence and launch risks in [the V1 launch-readiness audit](docs/qa/2026-07-12-v1-launch-readiness-audit.md).

## What is already complete

- [x] Local master directory (`~/.reglet/`) with rule, skill, provider-scoped skill, MCP, config, and state layouts.
- [x] Provider adapters for Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode.
- [x] Selective onboarding, first-write backups, manifest tracking, drift detection/import, restore, and revert.
- [x] Shared and provider-scoped skill discovery, explicit adoption, override precedence, and cleanup.
- [x] Canonical MCP editing and provider-specific merging, including redacted structured previews.
- [x] CLI automation for scan, plan, apply, structured preview, enrollment, status, sync, daemon, and recovery.
- [x] Self-hosted sync server with device pairing, versioned files, text merge/conflict copies, and protocol compatibility checks.
- [x] Persistent native macOS manager with Providers, Rules, Skills, MCP, Sync, Activity & Drift, Recovery, and first-run onboarding.
- [x] Current automated baseline: `bun test` (80 pass / 294 assertions), typecheck, and lint pass after installing pinned dependencies.

## Public V1 — required launch gates

All gates below must be green before Reglet is described or distributed as a public macOS V1. A beta label does not waive a safety or distribution failure.

### 1. Trust boundary and data integrity

- [ ] **Make sync paths canonical and confined.** Reject traversal, absolute paths, aliases, and every path outside the declared sync allowlist before reading, writing, deleting, or creating a conflict copy.
- [ ] **Make deletion sync correct and lossless.** Propagate local tombstones, preserve an unsynced local edit when a remote deletion arrives, and surface delete-vs-edit as a resolvable conflict rather than silently removing data.
- [ ] **Add token and device lifecycle controls.** Rotation must revoke the old single-user token; device tokens need list/revoke semantics; reconnect and disconnect must be explicit and testable.
- [ ] **Protect MCP secrets by design.** Do not treat raw `env` values as ordinary syncable configuration. Adopt a clear V1 policy: environment-variable references or another device-local secret mechanism; owner-only permissions for sensitive local state; redaction in previews/logs; and no public Cloud sync of raw credentials until a protected model exists.
- [ ] **Make writes and recovery interruption-safe.** Use atomic replace/journaled manifest updates, detect provider drift before an overwrite, preserve a recoverable version of the changed output, and make directory writes just as safe as file writes.
- [ ] **Add regression coverage for every release-blocking failure.** Include hostile sync paths, local/remote deletion conflicts, token rotation/revocation, interrupted writes, drifted overwrite/recovery, and secret redaction/permissions.

### 2. Complete the macOS control loop

The app does not need a new control plane. It needs one consistent, fast, native loop for the operations it already claims to manage.

- [ ] **Use one digest-backed Review & Apply flow everywhere.** It must scope providers and Rules/Skills/MCP, show validation, exact diffs, backup behavior, and stale-preview protection. Route Rules, drift re-apply, sync-applied provider changes, and every app-originated apply through it.
- [ ] **Stage sync before provider writes.** Manual sync may update a local change set, but remote master changes must be reviewed before they update provider outputs. Background sync/daemon behavior stays separately opted in and visible.
- [ ] **Expose lightweight provider/content lifecycle controls.** Show what is managed for every detected provider; allow scoped enrollment and **Stop Managing…** without rerunning onboarding or silently deleting provider content.
- [ ] **Finish drift and recovery decisions.** Each drift item needs Import, Review & Re-apply, and Stop Managing. Restore/revert must preview affected paths and backup sources, require confirmation, and offer Open Backups.
- [ ] **Close editor safety gaps.** Never discard unsaved Rules edits on navigation; confirm destructive MCP/skill mutations; validate MCP definitions and secret references before save.
- [ ] **Make the status legible and actionable.** Add an operations summary and persistent result/error handoff: last reviewed/apply/sync outcome, pending drift/conflicts, next safe action, retry, and copyable diagnostics.
- [ ] **Add power-user navigation without feature sprawl.** Search/filter large skill and MCP lists, standard keyboard shortcuts for review/apply/save, and a consolidated manager snapshot so refresh does not serially spawn several CLI commands.
- [ ] **Honor privacy defaults.** Disable the automatic startup update request by default or make it an explicit, disclosed setting. Keep the manual “Check for Updates” action.

### 3. Release engineering and certification

- [ ] **Ship a trusted Mac artifact.** Acquire Developer ID credentials; sign, notarize, staple, and verify the exact public `.pkg`/app archive. Fail public-release automation when those credentials or checks are absent.
- [ ] **Remove the quarantine bypass before public release.** The Homebrew cask must consume the signed/notarized artifact rather than stripping Gatekeeper quarantine.
- [ ] **Test the native app in CI.** Run `swift test` alongside the existing Bun suite; add focused UI tests for Review & Apply, lifecycle controls, sync disconnect/conflict states, drift/recovery, unsaved edits, and error states.
- [ ] **Complete the real-machine matrix.** On a fresh macOS user or VM, test installation, onboarding with existing Claude/Codex configurations, preview/apply, backups, drift, recovery, uninstall, and verification that no daemon or sync is left behind.
- [ ] **Certify accessibility.** Exercise keyboard-only navigation, VoiceOver, Increase Contrast, Reduce Transparency, Reduce Motion, text scaling, and non-color status cues on every native surface and destructive flow.
- [ ] **Publish operating commitments.** Add concise privacy/network behavior, security reporting, support/feedback, release notes, checksums/SBOM/provenance, known limitations, and recovery documentation. Pin release-action dependencies to immutable revisions.
- [ ] **Run a release rehearsal.** From the shipped artifact—not a checkout—complete install → scan → review/apply → drift resolution → recovery → uninstall and record the evidence in the smoke matrix.

## V1 release criteria

Reglet may launch publicly only when all of the following are demonstrated in a release candidate:

1. No remote sync input can escape the master directory or silently destroy a local edit.
2. No raw MCP credential is unintentionally exposed through normal local storage, previews, logs, or public sync.
3. Every app-originated provider write is reviewable, digest-bound, recoverable, and visible in the result state.
4. A user can manage or stop managing a provider/content scope, recover a mistake, and disconnect sync without using the terminal.
5. The app's network behavior matches its local-first copy and is controllable by the user.
6. The exact distributed Mac artifact is signed, notarized, installed on a clean environment, and passes recovery/uninstall/accessibility testing.
7. The public support, security, privacy, and release-integrity path is documented.

Until then, the only acceptable external program is a tightly controlled, **CLI-first local-only technical alpha**: scan → structured preview → explicit apply → status → revert, with daemon and sync disabled by default and the known limitations disclosed. It is not the public Mac V1.

## Deferred until after V1

These are valuable, but they do not belong in the public-launch critical path.

### Post-V1 control-plane depth

- Native sync-conflict inspection and merge choices.
- Full provider inventory/lifecycle management, permissions, support-change notices, and migrations.
- Native history/audit timeline beyond V1 operation receipts and recovery context.
- Project-scope management alongside global configuration.
- Advanced command palette, bulk workflows, and richer multi-window editing after launch telemetry identifies the highest-frequency tasks.

### Product expansion

- Reglet Cloud public availability, billing, and a web account dashboard. Cloud remains private beta until the trust and operating gates above are complete.
- Team/shared skill packs, browsing, publishing, grouping, and import/export.
- Subagents as a managed content type.
- More providers (Aider, Goose, Zed, Kiro, Amazon Q, and others).
- Optional end-to-end encryption for synced content.

## Historical foundation milestones

The original local engine, onboarding, sync server, native-manager shell, documentation, and Homebrew distribution work are complete as listed above. The next milestone is deliberately not another feature tranche: it is the **Public V1 release program** defined by the launch gates in this document.
