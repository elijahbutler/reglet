# Reglet V1 launch-readiness audit — 2026-07-12

## Verdict

**Do not launch a public macOS V1 yet.** Reglet is a capable local-first release candidate with a good native-manager foundation, but several confirmed data-integrity, sync-security, privacy, and distribution failures violate its stated safety contract.

The fastest credible path is not a broad new feature program. It is:

1. Repair the trust boundary and make sync/recovery lossless.
2. Close a deliberately small set of manager workflow gaps.
3. Ship and certify a trusted Mac artifact.

A constrained, invite-only, local-only CLI technical alpha may continue while those gates are open. A public beta label must not be used to bypass them.

## Product intent and current capability

Reglet's purpose is strong and differentiated: a versionable, local-first control plane for rules, skills, and MCP configuration across local AI coding agents. The core promise is not feature novelty; it is reliable control over global configuration:

```text
inspect → choose scope → review exact effect → apply safely → detect change → recover
```

That capability is substantially present:

- Six provider adapters are implemented: Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode.
- The CLI supports scan, onboarding plans, managed writes, backup/manifest tracking, drift, recovery, scoped skills, MCP editing, sync, and daemon controls.
- The macOS app is already a persistent seven-section manager rather than only a first-run wizard.
- The core suite passed **80 tests / 294 assertions** on this audit run; `bun run typecheck` and `bun run lint` passed after the pinned dependencies were installed.
- The retained smoke evidence shows all seven native screens rendering cleanly in a live, read-only walkthrough.

The missing work is concentrated in the exact places where a power user needs the product to be most trustworthy: cross-device changes, destructive actions, lifecycle management, operational feedback, and public distribution.

## Native UI quality — provisional 15/20

This is a source-and-screenshot audit, not release certification. The app uses native SwiftUI controls, readable hierarchy, semantic labels, familiar sidebar/form/list patterns, restrained color, and no obvious generic-dashboard or AI-generated visual patterns.

| Dimension | Score | Evidence-backed assessment |
| --- | ---: | --- |
| Accessibility | 2/4 | Some explicit labels, semantic status text, and keyboard shortcuts exist; VoiceOver, keyboard-only, contrast, Reduce Motion, Reduce Transparency, and destructive paths have not been exercised. |
| Performance | 3/4 | Native controls and an out-of-process CLI boundary are sensible; the manager refresh currently invokes several CLI calls serially and lacks a measured cold-start/large-inventory budget. |
| Theming | 4/4 | System materials, semantic colors, SF Symbols, and normal macOS controls provide consistent light/dark behavior without custom-token drift. |
| Resize/adaptation | 2/4 | The app has sensible minimum sizes and split views, but resize, text-scale, and accessibility-display modes are not certified. |
| Interaction/anti-patterns | 4/4 | The visual language is intentionally native and quiet. The primary risks are safety and feedback consistency, not visual excess. |
| **Total** | **15/20** | **Good foundation; not a release certificate.** |

## Confirmed blockers

### P0 — Sync can write outside the master directory

`isSyncPath` accepts a prefix such as `rules/` without canonicalizing the path. A hostile or defective server can send `rules/../../…`, which reaches `path.join(home, change.path)` and escapes `~/.reglet/`.

- Location: `packages/core/src/sync/engine.ts` (`pullChanges`, `isSyncPath`)
- Impact: a remote sync service can write or remove arbitrary files reachable by the client process.
- Required V1 outcome: canonical, allowlisted, root-confined paths before every read/write/delete/conflict operation; negative tests for traversal and aliases.

### P0 — Sync deletion is neither propagated nor conflict-safe

The push path iterates current files only, so deleting a local synced file emits no tombstone. The pull path removes an incoming deleted file immediately, even when the local version has unsynced edits.

- Location: `packages/core/src/sync/engine.ts` (`pushChanges`, `pullChanges`)
- Impact: deletion does not replicate reliably; a remote deletion can silently discard an unsynced local change.
- Required V1 outcome: emit tombstones, model delete-vs-edit conflicts explicitly, retain conflict copies, and never auto-apply a remote deletion over local divergence.

### P0 — Tokens and MCP secrets do not have a complete public safety model

Single-user token rotation leaves earlier device records authorized. Separately, MCP editor `env` values are treated as plain strings in `mcp/servers.json`, which is included in sync; the file writers do not enforce owner-only permissions for that master file.

- Location: `packages/server/src/app.ts` (`ensureSingleUser`); `packages/core/src/mcp.ts`; `packages/core/src/sync/engine.ts`; `apps/macos/RegletSetup/Sources/RegletSetupApp.swift` (MCP editor)
- Impact: token rotation is not revocation; credentials may be stored and transmitted as ordinary configuration and may receive default file permissions.
- Required V1 outcome: revoke/rotate device tokens, support disconnect/revoke, make raw secret handling explicit, prefer per-device references, enforce sensitive-file permissions, redact all external views, and hold public Cloud sync for raw credentials until the security model is deliberate.

### P0 — Apply, sync, and recovery do not consistently preserve user changes

After a first managed write, a plain apply can overwrite later provider drift without creating a new backup; revert restores the original pre-Reglet content, not the overwritten edit. Writes are direct and manifest recording follows the write, so interruption safety is not established. Sync also applies provider changes after a remote pull without a manager review step.

- Location: `packages/core/src/engine/writer.ts`, `packages/core/src/engine/revert.ts`, `packages/core/src/sync/engine.ts`
- Impact: a user can lose a later direct provider edit or end up in a state where recovery is incomplete after an interrupted mutation.
- Required V1 outcome: drift-aware transactional writes, atomic replacement/journaling, durable recovery metadata, staged remote changes, and tested recovery from interruption.

### P0 — The public Mac distribution path is not trusted or fully tested

The packager permits ad-hoc signing and unsigned packages, the release uploads app archives, and the current cask removes Gatekeeper quarantine. The documented real-machine matrix remains a partial pass.

- Location: `scripts/build-macos-installer.sh`, `.github/workflows/release.yml`, `scripts/generate-homebrew-cask.sh`, `docs/qa/2026-07-11-macos-smoke-matrix.md`
- Impact: the project cannot honestly claim a trusted public macOS installer; fresh install, destructive recovery/uninstall, and accessibility behavior are not demonstrated.
- Required V1 outcome: Developer ID signing, notarization, stapling, fail-closed release automation, no quarantine bypass, and completed fresh-machine/VM certification.

## P1 — manager workflow gaps

| Finding | Why it matters | Required V1 outcome |
| --- | --- | --- |
| Rules uses raw diff/direct apply while Skills and MCP use digest-bound structured previews. Drift re-apply and Recovery also bypass the same review boundary. | The app presents different safety guarantees for similar writes and can apply state the user did not review. | One scoped Review & Apply transaction for all app-originated provider writes. |
| The app lacks Stop Managing / scoped Unenroll even though the CLI supports it. | A power user cannot fully control ownership from the primary app surface. | Lightweight provider/content enrollment controls and an explicit Stop Managing action. |
| Changing a Rules document can replace unsaved editor content without confirmation. | It creates silent local data loss in a configuration editor. | Unsaved-change guards in every editor and confirmation for destructive master mutations. |
| Restore/Revert are one-click actions; MCP deletion is not consistently confirmed. | Recovery needs to be safer than the mistake it is meant to undo. | Preview affected paths, backup source, explicit confirmation, and Open Backups. |
| Sync has no visible test-before-save, disconnect, or device-revocation path. | A user can leave a bad token/configuration persisted and cannot return cleanly to local-only mode. | Test connection, disconnect, revoke, explicit Cloud beta state, and safe local-only exit. |
| Startup silently calls the GitHub Releases API. | It conflicts with the background-off/local-first copy and surprises privacy-conscious users. | Manual check by default, or an explicit disclosed preference with accurate documentation. |
| Most action success state is stored but only rendered in onboarding; errors are raw command alerts. | Routine management feels opaque and makes recovery slower. | Persistent action receipts, contextual next actions, retry, and copyable diagnostics. |

## P2 — power-user polish after the safety loop

- Add a compact operations overview with managed-provider scope, pending drift/conflicts, last successful action, and next safe action.
- Add skills/MCP search and filtering; the current native list can become unwieldy with a real power-user inventory.
- Add standard keyboard shortcuts for save, review/apply, refresh, and safe navigation.
- Replace serial manager refresh subprocesses with a consolidated CLI snapshot and establish a large-inventory performance budget.
- Add a focused native UI test suite to CI; the current CI validates the Bun packages but does not run `swift test`.

## Positive findings to retain

- The app's native visual language is clean, calm, and appropriate for a macOS technical utility.
- The split between master edits and explicit provider application is the right foundation.
- Structured previews already solve much of the desired safety model for Skills and MCP; V1 should extend this existing primitive rather than create a parallel flow.
- Provider-scoped skill adoption and shadowing are unusually thoughtful power-user features and should remain visible in the manager.
- The test suite proves meaningful core behavior rather than only happy-path UI rendering.
- The existing smoke matrix correctly avoids claiming a destructive action was tested when it was not.

## Scope recommendation

### Must ship in public V1

1. Sync and write/recovery integrity fixes.
2. Consistent review/confirm/recover workflow in the Mac app.
3. Scoped provider/content lifecycle and sync connection lifecycle.
4. Secrets/privacy correctness and accurate network behavior.
5. Signed/notarized distribution, full native test coverage, real-machine certification, accessibility, and public operating documentation.

### Defer until after V1

- Public Cloud launch, billing, teams, shared packs, marketplace/browsing, new providers, project scope, full audit timeline, native merge tooling, and end-to-end encryption.

These are good later investments. They should not hide the smaller, more consequential work required to make the current product safe to trust.

## Verification record

Audit commands run in this workspace:

```text
bun install --frozen-lockfile
bun test                 # 80 pass, 0 fail, 294 assertions
bun run typecheck        # pass
bun run lint             # pass
```

The initial checks failed only because dependencies were absent from the workspace; the pinned installation restored them without changing tracked project files. The app screenshot and the prior live-walkthrough record were inspected, but no destructive app action, provider write, restore, revert, sync, daemon control, or installer uninstall was performed during this audit.
