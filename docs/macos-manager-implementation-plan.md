# macOS Manager remaining implementation plan (historical)

> Superseded by the cross-platform [production roadmap](../ROADMAP.md). Do not schedule new Swift feature rounds from this document; the retained Swift app is frozen pending Tauri acceptance and removal.

## Purpose

This is the execution plan for the future macOS Manager described in the [product and delivery roadmap](macos-manager-roadmap.md). It begins after Phase 0 Round 1, which added provider-scoped System Instructions and removed daemon language from newly generated ownership headers.

The public release remains CLI-only until every release gate in the product roadmap is complete. Intermediate rounds may merge as source and tests, but must not publish a Manager artifact.

## Delivery rules

- Keep provider rendering and mutations in `packages/core` and `packages/cli`. Swift consumes versioned JSON contracts and never writes provider files directly.
- Make each round independently reviewable and keep compatibility migrations in the same round as the new data model.
- Do not build UI on an unstable response assembled from several commands. Define and test the Manager contract first.
- Use structured digest-backed preview/apply for every provider mutation, including detach and restoration.
- Preserve the complete manual workflow. AI drafting cannot become a dependency of onboarding or editing.
- Treat redaction, accessibility, recovery, and network silence as testable behavior rather than release-documentation tasks.

## Dependency order

```text
0.2 versioned contracts and source/destination model
  -> 0.3 Master revision and applied composition
  -> 0.4 provider-scoped MCP core
  -> 0.5 contract hardening
  -> 1.x first-run System Instructions workflow
  -> 2.x everyday System Instructions lifecycle
  -> 3.x Skills lifecycle
  -> 4.x MCP lifecycle
  -> 5.x release hardening
```

Phase 3 and Phase 4 UI work can proceed in parallel only after Phase 2 establishes the shared inbox, preview, detach, and recovery components. Release hardening begins early as continuous validation, but Phase 5 owns the final evidence and distribution decision.

## Phase 0: remaining contracts and semantics

### Round 0.2: versioned Manager contract

Status: Complete.

Goal: give the Manager one stable, read-only representation of sources, destinations, capabilities, and effective scope.

Deliverables:

- Create TypeScript interfaces and checked JSON schemas for:
  - provider discovery and cell-level capability status;
  - source inventory independent from destination enrollment;
  - enrollment matrix;
  - Master summary and effective per-provider composition;
  - structured plan summary and entries;
  - drift inbox items;
  - receipt list and detail.
- Add an explicit contract version to `manager snapshot` and define compatibility behavior for the existing version 1 Swift decoder.
- Report provider presence separately from content capability. Each cell returns supported, unsupported with reason, or needs attention.
- Report persisted destination enrollment independently from readable source inventory.
- Include local-only safety capabilities in the top-level response rather than duplicating them across child payloads.
- Add schema fixture tests for all six providers, empty state, unreadable content, unsupported cells, and legacy state.

Migration and compatibility:

- Keep the existing version 1 response available until the retained Swift source consumes the new contract.
- Add fields additively where possible. Use a new version only when field meaning changes.
- Reject unknown mutation contract versions; never guess how to apply them.

Merge gate:

- Every checked-in fixture validates against its schema.
- Source-only providers are absent from destination summaries.
- Building a snapshot performs no mutation and resolves no MCP secret values.
- Existing CLI and Swift tests remain green.

### Round 0.3: Master revision and applied composition

Status: Complete.

Goal: make draft, applied, and drift states exact and reproducible.

Deliverables:

- Define a canonical Master revision digest over ordered shared and provider-scoped System Instructions, Skills trees, MCP definitions, and enrollment-relevant metadata.
- Record the Master revision and effective composition revision in operation receipts.
- Record the last applied composition revision per managed output.
- Expose `draftOnly`, `changesReady`, `upToDate`, `driftDetected`, and `blocked` as derived contract states with machine-readable reasons.
- Include relevant environment fingerprints in MCP plan freshness without storing resolved values.
- Add migration logic for version 1 manifests and receipts that lack revision metadata.

Merge gate:

- Reordering documents, editing content, changing scope, changing enrollment, and changing an MCP environment value invalidate the relevant plan.
- Unrelated provider changes do not mark an unaffected destination stale.
- Old manifests load without being silently rewritten during a read-only snapshot.
- State derivation uses hashes and receipts, not modification times.

### Round 0.4: provider-scoped MCP core

Status: Complete.

Goal: make MCP composition match the shared/provider-specific model before building its Manager UI.

Deliverables:

- Define a stable MCP server identifier distinct from editable display text.
- Store shared definitions and explicit provider-scoped definitions without reinterpreting existing `mcp/servers.json` data.
- Resolve effective provider output as shared definitions followed by matching provider overrides.
- Add scope-aware list, read, upsert, delete, import, and preview CLI contracts.
- Preserve unmanaged provider keys and existing process-environment reference validation.
- Include scope, override relationship, affected providers, and conflict status in Manager responses.

Merge gate:

- Shared, provider-only, override, rename, delete, detach, and restore pass for every compatible provider adapter.
- Raw secret strings are rejected before persistence and never appear in errors, previews, logs, journals, receipts, snapshots, or fixtures.
- Existing shared MCP files require no migration to retain their behavior.

### Round 0.5: contract and privacy hardening

Status: Complete.

Goal: freeze the boundary used by the first Manager vertical slice.

Deliverables:

- Return structured error codes and redacted user messages for invalid content, stale plans, missing environment variables, unreadable sources, and failed operations.
- Audit every Manager response and error path with secret-canary tests.
- Add contract fixtures for partial failures and interrupted-operation recovery.
- Remove remaining Manager-facing daemon, remote-sync, account, and automatic-apply language or capability flags.
- Document contract evolution and fixture update rules.

Merge gate:

- One command returns the complete redacted Manager read model.
- No Manager view needs to infer state by parsing prose messages.
- Contract fixtures are stable enough for Swift snapshot tests.
- Phase 0 exit criteria in the product roadmap are complete.

## Phase 1: first-run System Instructions vertical slice

### Round 1.1: Manager shell and state coordinator

Goal: establish navigation and deterministic application state without redesigning content editors.

Deliverables:

- Replace the current section list with Overview, Master, Providers, Activity, and Settings.
- Add one state coordinator that loads the versioned Manager snapshot and maps contract states to one primary action.
- Implement empty, loading, blocked, changes-ready, drift, and up-to-date states.
- Keep existing retained views reachable only where they fit the new information architecture.
- Add keyboard focus order, VoiceOver labels, and text-size layout tests with the shell rather than postponing them.

Merge gate:

- Overview action priority is blocked, drift, changes ready, incomplete setup, then up to date.
- Refresh and launch are the only automatic scans.
- Navigation works by keyboard and does not trigger provider writes.

### Round 1.2: resumable discovery and destination scope

Goal: let users choose exactly what Reglet may manage without importing or applying yet.

Deliverables:

- Implement Welcome and recovery disclosure.
- Render six provider rows with installed, not found, needs attention, and cell-level unsupported states.
- Implement the provider/content destination matrix with nothing preselected.
- Add explicit Select All Detected for supported cells only.
- Persist an onboarding draft outside provider configuration until final staging.
- Support Create Master and Finish for Now when no provider is detected.

Merge gate:

- Back, close, relaunch, and resume preserve the draft.
- Source inventory never changes destination selections.
- Unsupported cells cannot become enrolled through UI or CLI payload manipulation.
- No provider or Master file changes before an explicit staging action.

### Round 1.3: manual source stack and overlays

Goal: complete System Instructions composition without requiring AI.

Deliverables:

- Show all readable prompt sources with provider, exact path, modification state, and preview.
- Allow independent source selection, ordering, exclusion, and source-only import.
- Build a transparent editable shared-base draft with visible source boundaries.
- Allow moving selected content into a named provider overlay.
- Show final base-plus-overlay composition for every eligible destination.
- Add dirty-editor save, discard, and cancel handling.

Merge gate:

- A prompt-only setup never sees Skills or MCP screens.
- Selecting a source never enrolls its provider.
- Manual editing can complete onboarding when no AI runner is installed.
- Provider overlays never render to another provider.

### Round 1.4: onboarding Review & Apply

Goal: finish the first safe end-to-end workflow.

Deliverables:

- Stage Master and enrollment changes locally before provider review.
- Present a scannable summary followed by per-target paths, redacted diffs, hashes, snapshots, and backup behavior.
- Apply only the digest visible in the current review.
- Rebuild review after Master, enrollment, target, environment, or relevant filesystem changes.
- Show receipt identifier and Open Activity, Edit Master, and Add Provider completion actions.

Merge gate:

- Only checked provider/content cells are enrolled and written.
- Source-only providers remain unenrolled.
- Stale review never reaches a provider write.
- The complete clean-account walkthrough produces a restorable receipt.

## Phase 2: everyday System Instructions lifecycle

### Round 2.1: Master editing and Overview changes

Goal: make post-onboarding edits understandable before adding conflict resolution.

Deliverables:

- Build the Master System Instructions tab over shared documents and provider overlays.
- Save private drafts without applying provider output.
- Show exact affected destinations and the unapplied revision on Overview.
- Route Review & Apply through the same component used by onboarding.
- Confirm destructive Master deletion and review resulting provider removals separately.

Merge gate:

- Save Draft never invokes a provider mutation.
- Closing a dirty editor cannot silently discard content.
- Review selection includes only enrolled, compatible destinations.

### Round 2.2: drift inbox and three-way review

Goal: turn local provider edits into explicit Activity items.

Deliverables:

- Add last-applied, current-Master, and current-provider payloads to drift items.
- Render modified, missing, and incompatible concurrent changes.
- Implement editable adoption into shared base or provider overlay.
- Keep unresolved provider items independent when several providers changed.
- Preserve MCP redaction primitives in the generic inbox even before MCP UI ships.

Merge gate:

- Scanning never imports, overwrites, merges, or clears drift.
- Adopting changes modifies the Master only and leaves Review & Apply as a separate next action.
- Resolving one provider does not clear another provider's incompatible change.

### Round 2.3: detach, restore, and receipt recovery

Goal: complete all three drift resolutions and operation recovery.

Deliverables:

- Implement Keep Local & Stop Managing per provider/content scope.
- Implement Restore Master as a new digest-backed provider transaction.
- Add Activity receipt history and detail for completed, failed, detached, interrupted, and restored operations.
- Implement Restore This Operation using pre-operation snapshots and a new receipt.
- Distinguish missing-output restoration from destructive Master deletion.

Merge gate:

- Every apply, detach, restore, rollback, and recovered interruption has a receipt.
- Legacy and current generated headers detach cleanly.
- Recovery controls state exactly which paths and snapshot kinds are involved.
- Phase 2 lifecycle matrix passes for System Instructions.

## Phase 3: Skills lifecycle

### Round 3.1: inventory and adoption

Goal: map existing Skills functionality onto the shared Manager model.

Deliverables:

- Add searchable discovered inventory grouped by source provider.
- Require explicit selection and Shared or Provider Only scope.
- Resolve destination collisions with replace, rename, or skip.
- Show effective provider projections before staging.
- Reuse onboarding draft persistence and destination enrollment.

Merge gate:

- Nothing is redistributed by default.
- Provider-scoped override behavior is visible before apply.
- Unsupported provider cells remain unavailable.

### Round 3.2: editing and Review & Apply

Goal: make managed Skills fully editable without introducing a separate workflow.

Deliverables:

- Build Master Skills list, file tree, editor, create, rename, delete, and scope movement.
- Add concise directory-level review with expandable file diffs.
- Reuse digest freshness, transaction, receipt, and completion components.
- Show which providers a shared skill affects and which provider override shadows it.

Merge gate:

- Create, update, move scope, override, rename, delete, no-op, and stale-plan cases pass.
- File traversal, symlink, malformed frontmatter, and missing `SKILL.md` remain blocked.

### Round 3.3: Skills drift and recovery

Goal: complete the common lifecycle for directory-based content.

Deliverables:

- Add file-level three-way drift review for modified managed skills.
- Add shared/provider adoption, detach, Restore Master, and receipt restoration.
- Handle provider-local deletion without treating it as Master deletion.
- Keep unmanaged neighboring skills untouched.

Merge gate:

- The cross-phase lifecycle matrix passes for every compatible Skills adapter.
- Directory snapshots restore byte-identically.
- Phase 3 adds no Skills-specific mutation path outside the shared transaction layer.

## Phase 4: MCP lifecycle

### Round 4.1: inventory, duplicates, and conflicts

Goal: let users understand MCP topology without exposing credential values.

Deliverables:

- Group discovered servers by stable identifier and show source providers and transport.
- Distinguish identical duplicates from structural conflicts.
- Require Shared or Provider Only scope for adoption.
- Add explicit conflict choices for command, URL, arguments, transport, and identifier.
- Show effective output destinations without resolving environment values.

Merge gate:

- Inventory and conflict payloads contain no raw environment values.
- Identical duplicates do not create duplicate Master definitions.
- Structural conflicts cannot be staged without an explicit resolution.

### Round 4.2: environment mapping and apply

Goal: complete safe MCP creation and editing.

Deliverables:

- Build named process-environment mapping controls for every output key.
- Validate variable names and report missing process environment without revealing values.
- Add Master MCP create, edit, scope movement, override, rename, and delete.
- Reuse the shared Review & Apply experience with managed-key-aware redacted diffs.

Merge gate:

- Raw strings are rejected at every CLI and UI boundary.
- Missing required variables block apply while leaving the Master draft editable.
- Secret-canary tests cover UI models, stdout, stderr, diagnostics, journal, snapshot, preview, and receipt files.

### Round 4.3: MCP drift and recovery

Goal: complete local change handling without absorbing unmanaged provider keys.

Deliverables:

- Add managed-key-aware three-way review.
- Support shared/provider adoption, detach, Restore Master, and receipt restoration.
- Preserve provider-local unmanaged server definitions and unrelated configuration.
- Handle removal of a managed server as an explicit adoption decision.

Merge gate:

- The cross-phase lifecycle matrix passes for every compatible MCP adapter and format.
- No resolution copies a raw provider credential into the Master.
- Phase 4 adds no MCP-specific mutation path outside the shared transaction layer.

## Phase 5: release hardening

### Round 5.1: optional AI drafting

Goal: add AI assistance only after manual composition is complete.

Deliverables:

- Detect supported external tools without invoking them.
- Show executable, exact source paths, privacy disclosure, and per-run consent.
- Keep the original source stack and compare it with the returned proposal.
- Treat cancellation, timeout, missing executable, nonzero exit, and empty output as recoverable draft states.

Merge gate:

- No detection, resume, or multi-source selection invokes an AI tool.
- Declining consent returns to the complete manual workflow.
- AI output is never saved or applied without user review.

### Round 5.2: accessibility validation

Goal: prove the entire product works with macOS accessibility features.

Deliverables:

- Complete keyboard traversal, shortcuts for clear commands, visible focus, and modal focus restoration.
- Audit VoiceOver names, values, hints, order, announcements, and destructive confirmations.
- Validate supported text sizes, Increase Contrast, Reduce Motion, and Reduce Transparency.
- Fix layouts that truncate paths, status text, buttons, or diff controls.
- Record reproducible walkthrough evidence for every primary workflow.

Merge gate:

- Source inspection is not accepted as evidence; keyboard and VoiceOver walkthroughs are recorded.
- No workflow requires pointer input or color-only interpretation.
- Text and controls remain usable at the supported maximum size.

### Round 5.3: privacy, diagnostics, and network evidence

Goal: close the operational trust model.

Deliverables:

- Add redacted diagnostics export with a pre-export category summary.
- Add Reveal Local Data, manual update check, and explicit legacy-state removal.
- Observe clean and legacy installations during install, launch, idle, scan, edit, preview, apply, drift, detach, and restore.
- Document manual update check and consented AI drafting as the only intentional network-capable exceptions.
- Add release regression tests for absent account, device, server, daemon, and remote-sync controls.

Merge gate:

- Secret canaries never appear in diagnostics.
- Network capture shows no implicit request in any core workflow or idle period.
- Automatic update checks are off on a clean installation.

### Round 5.4: packaging and release candidate

Goal: produce a reversible, supportable public Manager release candidate.

Deliverables:

- Complete signing, notarization, packaging, installation, and uninstall behavior.
- Define update metadata and rollback policy without enabling automatic checks by default.
- Publish privacy, recovery, compatibility, diagnostics, and known-limitations documentation.
- Run the clean-account end-to-end release matrix across every advertised provider/content cell.
- Rehearse rollback from a failed apply and rollback from the Manager application version.

Merge gate:

- All product-roadmap release gates have recorded evidence.
- CLI-only installation and automation remain supported.
- No Manager artifact is published until the release candidate is explicitly approved.

## Continuous verification

Run the cheapest relevant checks in every round and the complete set at phase boundaries:

```bash
bun run typecheck
bun run lint
bun test
(cd apps/macos/RegletSetup && swift test)
```

Phase boundaries also require:

- schema fixture validation;
- stale-plan and rollback fault injection;
- secret-canary scan of all persisted state and process output;
- clean and legacy local-state walkthroughs;
- keyboard and VoiceOver evidence for changed workflows;
- `git diff origin/main...` review for dormant remote or daemon capability exposure.

Do not use a successful compile as a substitute for transaction, recovery, privacy, or accessibility evidence.

## Decision checkpoints

Resolve these before the named round starts:

| Decision | Deadline | Default |
| --- | --- | --- |
| Contract version negotiation | Round 0.2 | Keep v1 available; add explicit v2 request. |
| System Instructions overlay storage marker lifecycle | Round 0.2 | Reglet owns the marker; detach leaves Master overlays intact. |
| Stable MCP identifier format | Round 0.4 | Immutable local identifier plus editable display name. |
| Onboarding draft storage and retention | Round 1.2 | Owner-only state under `~/.reglet/.state/manager-drafts/`. |
| System Instructions document provenance after editing | Round 1.3 | Preserve source references until the user explicitly removes them. |
| Receipt filters and failed-operation presentation | Round 2.3 | One chronological Activity list with status filters. |
| Supported text-size range | Round 5.2 | Define from actual layout validation, not a hard-coded visual target. |
| Manager distribution channel | Round 5.4 | Decide only after signing and update-policy rehearsal. |

## Recommended next work

Start with Round 0.2. It unblocks reliable Swift development and prevents the existing Manager from inferring source, destination, and capability state from several loosely related version 1 payloads. Do not begin the new onboarding shell until its schema fixtures and compatibility path are merged.
