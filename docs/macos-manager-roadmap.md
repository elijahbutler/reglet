# macOS Manager product and delivery roadmap

## Status and boundary

This document specifies a future native macOS Manager. It does not change the public V1 boundary: public V1 remains a local-only CLI release, and the Manager must not be distributed until its release gates are complete.

The Manager is a local interface over Reglet's existing CLI and transaction engine. It must not reimplement provider rendering, write provider files directly, expose dormant remote-sync capabilities, start a background daemon, or require an account.

## Product outcome

The Manager should make one model understandable:

> A private Master on this Mac produces reviewed copies for the local AI tools you choose.

Users can import existing provider configuration into the Master without enrolling that provider as a destination. Editing the Master saves a local draft. It does not change a provider until the user reviews a fresh plan and chooses **Review & Apply**.

Use **Local Sync** only as a discovery term for the relationship between the Master and local provider copies. Mutation controls and confirmations use **Review & Apply**. Every relevant surface states that Reglet is not sending configuration to another device or account.

## Product principles

1. **Source and destination are independent.** Importing from Claude Code does not imply that Reglet will manage Claude Code.
2. **Enrollment is explicit and granular.** A provider is managed independently for System Instructions, Skills, and MCP Servers. Nothing is preselected on first run.
3. **Drafting and applying are separate states.** Master edits are private local drafts until a reviewed transaction is applied.
4. **The shared base is the default.** Provider-specific content is an explicit, visible exception composed after shared content.
5. **Safety is concrete.** Show paths, diffs, expected hashes, snapshots, and receipts instead of relying on generic reassurance.
6. **Local changes require a decision.** Never silently overwrite, import, merge, or redistribute a changed provider copy.
7. **Progressive disclosure beats exhaustive screens.** Show the decision needed now, with exact technical detail available in the review.
8. **Network and background behavior stay absent.** Scans occur on launch or explicit refresh. Optional AI drafting and update checks are separate user-initiated actions.

## Corrections to the initial proposal

The initial proposal had the right trust model but combined too many product layers into one onboarding project. This roadmap makes the following corrections:

- **Sequence by complete workflows, not screens.** A safe System Instructions lifecycle is more valuable than partial onboarding screens for all three content types. Drift and recovery follow that vertical slice before Skills and MCP expand it.
- **Separate import permission from management permission.** The original source/destination distinction was stated but not represented as a durable model. It is now a first-class contract throughout discovery, onboarding, and review.
- **Use typed provider-specific behavior.** A generic "overlay" is understandable for appended instructions but misleading for directory-based Skills and keyed MCP Servers. Each content type now has explicit composition and override rules.
- **Reduce drift choices to real decisions.** "Review & Apply elsewhere" was presented alongside three mutually exclusive resolutions even though it can happen only after adoption. It is now a follow-up action.
- **Keep the final review scannable.** Exact hashes, paths, diffs, and snapshots remain available, but the first level answers what is saved, what will change, what is blocked, and how recovery works.
- **Distinguish two restore operations.** Restoring pre-operation snapshots from a receipt is different from rendering the current Master over drift. The workflows now use distinct labels and explanations.
- **Move AI drafting out of the critical path.** It adds consent, privacy, runner discovery, and failure states without being necessary to prove the product model. The manual workflow ships first.
- **Treat accessibility and network silence as release evidence.** They are cross-cutting requirements with recorded walkthroughs, not a checklist appended to onboarding implementation.

## Terminology

| Term | Meaning |
| --- | --- |
| Master | Private canonical configuration stored under `~/.reglet/`. |
| Shared base | Content intended for every enrolled, compatible destination unless explicitly scoped otherwise. |
| Provider-specific content | An explicit exception for one provider. For System Instructions it is appended after the shared base; for Skills and MCP it is a typed provider-scoped item. |
| Source | Existing provider content selected for import. Source selection grants read access for that import only. |
| Destination | A provider/content cell that Reglet is allowed to maintain. |
| Enrollment | Persisted permission for Reglet to maintain one content type for one provider. |
| Draft | Saved Master changes that have not been applied to all selected destinations. |
| Applied state | The exact Master composition and target hashes recorded by a completed receipt. |
| Drift | A managed provider copy that differs from the last applied state or is missing. |
| Plan | A redacted, digest-backed preview of one proposed transaction. |
| Receipt | Immutable record of a completed, failed, detached, or restored operation. |

Avoid using "sync" as a synonym for a write, a daemon, remote transfer, or automatic reconciliation.

## Canonical state model

The UI must present four distinct layers:

1. **Master draft:** current local rules, skills, MCP definitions, and provider-specific content.
2. **Last applied state:** the composition and hashes captured by the latest relevant receipt.
3. **Current provider copy:** what is on disk now.
4. **Enrollment:** which provider/content destinations Reglet currently owns.

These layers produce the user-visible states below.

| State | Meaning | Primary action |
| --- | --- | --- |
| Not configured | No Master content and no enrollment. | Set Up Local Sync |
| Draft only | Master has content but no destination is enrolled. | Add a Provider |
| Changes ready | Master differs from the last applied composition. | Review & Apply |
| Up to date | Enrolled outputs match the last applied state and current Master. | Edit Master |
| Drift detected | A managed provider copy changed or is missing. | Review Change |
| Blocked | A plan is stale, a required environment variable is missing, or content is invalid. | Resolve Issue |

Priority on Overview is deterministic: blocked operation, unresolved drift, unapplied Master changes, incomplete setup, then up to date. There is only one primary action.

### Composition rules

Composition must be predictable and previewable:

- **System Instructions:** ordered shared documents, followed by an optional provider overlay. Every enrolled provider with rules support receives the shared base.
- **Skills:** shared skills plus provider-scoped skills. A provider-scoped skill with the same name overrides the shared skill for that provider.
- **MCP Servers:** shared server definitions plus provider-scoped definitions. A provider-scoped definition with the same stable server identifier overrides the shared definition for that provider.

Content-level enrollment controls whether a provider can receive a content type. Item-level scope controls whether a Skill or MCP Server is shared or provider-specific. Do not add arbitrary per-item destination checklists on top of provider scope; that creates a second enrollment system and makes effective output hard to explain.

The current core supports provider-scoped Skills. Provider overlays for System Instructions and provider-scoped MCP definitions require explicit core and CLI contracts before their UI ships.

## Information architecture

Use a compact native macOS sidebar with five destinations:

- **Overview:** current state, pending changes, most recent receipt, recovery health, and the single next action.
- **Master:** tabs for System Instructions, Skills, and MCP Servers. Edits save locally and expose an unsaved/unapplied state without writing providers.
- **Providers:** the enrollment matrix, provider capabilities, target paths, and scoped Stop Managing actions.
- **Activity:** unresolved local changes first, followed by receipt history. Recovery controls live in receipt details.
- **Settings:** local data location, manual update checks, redacted diagnostics export, and legacy-state removal.

Do not create separate Sync or Recovery sidebar destinations. Sync is a relationship, not a workspace. Recovery is an action on a receipt or drift item, not a competing mutation system.

## First-install workflow

Onboarding is resumable and uses one window. Back and Quit Setup preserve the draft and selections. No provider file is modified before the final apply.

### 1. Welcome

Headline: **One master, your selected local tools.**

Show four facts in plain language:

- no account or cloud/device sync;
- no background monitoring or daemon;
- provider files change only after Review & Apply;
- Master data, operation snapshots, and receipts stay under `~/.reglet/` with owner-only permissions.

"How recovery works" expands inline to explain snapshot-before-write, receipts, and retained recovery data. Keep paths visible but secondary to the core decision to continue.

### 2. Find providers

Scan all six adapters and report provider presence separately from content capability.

- **Installed:** at least one known provider path is present.
- **Not found:** no known provider path is present.
- **Needs attention:** content exists but cannot be safely parsed or contains unsupported secret values.

Unsupported content is a cell-level capability, not a provider-wide status. For example, Windsurf can be installed while Skills remains unavailable.

Nothing is selected by default. **Select All Detected** selects only supported cells and remains an explicit action. If no provider is found, allow **Create Master** or **Finish for Now**.

### 3. Choose destination scope

Present provider rows and columns for System Instructions, Skills, and MCP Servers. Each checked cell means:

> Reglet may maintain this content for this provider after you review each change.

Unsupported cells are disabled with a concise reason. A persistent summary translates the matrix into sentences, for example:

> - System Instructions -> Claude Code, Codex
> - Skills -> Claude Code
> - MCP Servers -> Codex, Cursor

The summary must never include providers selected only as import sources.

### 4. Build selected Master content

Only show content steps represented in the destination scope or explicitly chosen for Master-only setup. A System-Instructions-only setup never sees Skills or MCP screens.

#### System Instructions

Inventory every readable source with provider name, exact path, modification state, and preview. Selecting a source adds it to an ordered source stack; it does not enroll the source provider.

Start from a transparent concatenation draft with source boundaries. Do not silently summarize, deduplicate, or rewrite. The user can reorder sources, edit the shared base, exclude fragments, and move genuinely provider-specific material into a named provider overlay.

The final preview for each destination shows the composed shared base plus that destination's overlay. A manual path must always be complete without an AI tool.

#### Skills

Show a searchable inventory grouped by source provider. Nothing is selected by default. For each chosen skill, the user selects **Shared** or a single **Provider Only** scope. Show collisions before import and require an explicit replace, rename, or skip decision.

Do not ask users to choose both a provider overlay and an arbitrary destination list. The chosen scope plus destination enrollment determines where the skill renders.

#### MCP Servers

Show servers grouped by stable identifier with source providers, transport, duplicate status, and structural conflicts. Never import or display raw credential values.

For each selected server:

- choose Shared or one Provider Only scope;
- resolve conflicting command, URL, argument, or transport definitions;
- map every environment key to a named process environment variable;
- block review when a raw value is present or a required mapping is unresolved.

The source value must not be copied into the Master, preview, logs, diagnostics, or receipts.

### 5. Review & Apply

Use a decision summary first and exact details second.

The summary shows:

- Master changes already saved locally;
- provider/content destinations about to change;
- drift or blocking issues;
- number of files created, changed, removed, or skipped;
- snapshot and recovery behavior.

Expandable per-target detail shows target path, redacted rendered output or directory inventory, before/after diff, expected current hash, and snapshot location pattern.

The Apply button accepts only the digest shown in the current review. Any Master, provider, enrollment, environment, or relevant filesystem change invalidates the plan. The UI returns to review with **Review Updated Changes**; it never retries an old digest or writes opportunistically.

Completion shows the receipt identifier and three next actions: **Open Activity**, **Edit Master**, and **Add Provider**. The first is primary.

## Everyday workflows

### Edit Master

Editing and provider mutation remain separate:

1. Edit content in Master.
2. Save the local draft.
3. See "Changes ready" on Overview and affected providers in a summary.
4. Choose Review & Apply.
5. Select from eligible enrolled destinations, review a fresh plan, and apply.

Closing a dirty editor requires Save Draft, Discard Edits, or Cancel. Saving a draft does not require confirmation because it changes only private Master data. Destructive Master deletions require confirmation and are reviewed again before provider removal.

### Manage providers

Providers exposes the same enrollment matrix used during onboarding. Adding a checked cell may require an initial Review & Apply. Clearing a checked cell invokes **Stop Managing** for that provider/content scope.

Stop Managing:

- preserves the current provider content;
- removes Reglet ownership and future drift alerts for that scope;
- removes generated ownership headers where applicable;
- does not delete Master content;
- produces a receipt.

Stopping all cells for a provider is a convenience action that previews the included scopes. It is not a separate lifecycle model.

### Review local changes

Activity is an inbox, not an automatic merge queue. Each item shows the last applied version, current Master composition, and current provider copy. MCP values remain redacted.

A modified managed copy has three mutually exclusive resolutions:

1. **Adopt Change:** edit a proposed merge and place it in the shared base or provider-specific scope. This changes the Master only. The completion action is Review & Apply to other eligible providers.
2. **Keep Local & Stop Managing:** preserve the provider copy and detach only this provider/content scope.
3. **Restore Master:** build a new digest-backed plan to replace the provider copy after snapshotting its current state.

"Review & Apply elsewhere" is not a fourth resolution. It is the next step after adoption and remains optional.

For a missing managed output, offer Restore Master or Stop Managing. Do not interpret a missing provider file as a request to delete Master content.

When several providers contain incompatible edits, keep separate inbox items. Adoption uses an editable three-way merge. Never auto-merge across providers or let resolving one item silently clear another.

### Recover an operation

Activity lists successful, failed, detached, interrupted, and restored operations. Receipt detail shows affected paths, snapshot kinds and sources, diagnostics, and whether restoration is available.

**Restore This Operation** means returning affected targets to their pre-operation snapshots through a new reviewed operation. **Restore Master** on a drift item means re-rendering the current Master into that provider. Keep these labels and explanations distinct.

Restoration uses a fresh preview and creates its own receipt. Recovery data is retained until the user adopts a future explicit retention policy; the Manager must not silently prune it.

### Settings and diagnostics

Settings contains:

- Reveal Local Data in Finder;
- Check for Updates, manual only by default;
- Export Redacted Diagnostics, with a preview of included categories;
- Remove Legacy Network State, with explicit confirmation and no implication that it is active;
- accessibility-sensitive appearance options only when they add behavior beyond system settings.

There are no account, device, server, daemon, automatic sync, or background monitoring controls.

## Optional AI drafting

AI drafting is an enhancement, not an onboarding dependency. Ship it only after the complete manual System Instructions workflow is validated.

The action is **Generate Draft with AI Tool**. Before execution, show:

- the executable/tool that will run;
- the exact selected file paths;
- that their contents will be sent to that external tool under its privacy terms;
- that Reglet will receive a proposed draft but will not apply it.

Require consent for each invocation. Never run because a tool was detected, because the user selected multiple sources, or because onboarding resumed. Treat output as an editable proposal and preserve the original source stack for comparison.

## Phased delivery

Phases are dependency ordered. A phase can merge behind an internal build flag, but no public Manager artifact ships merely because one phase is complete.

The PR-sized work breakdown, dependencies, and merge gates are maintained in the [remaining implementation plan](macos-manager-implementation-plan.md).

### Phase 0: Contracts and product semantics

Goal: make the CLI the complete, stable boundary required by the Manager.

- [x] Define versioned JSON schemas for capability scan, source inventory, enrollment matrix, Master draft summary, effective composition, structured plan, drift item, and receipt detail.
- [x] Add provider-scoped System Instructions with deterministic shared-base-plus-overlay composition.
- [x] Add provider-scoped MCP definitions with deterministic override rules.
- [ ] Represent source selection independently from enrollment.
- [x] Represent saved Master revision and last-applied composition so "changes ready" is exact rather than inferred from timestamps.
- [x] Remove daemon language from newly generated ownership headers while retaining cleanup compatibility for existing headers.
- [ ] Guarantee all snapshot payloads and errors are redacted and local-only.

Exit criteria:

- Contract tests cover all six providers and every supported/unsupported content cell.
- Core tests prove shared-plus-provider composition for all three content types.
- Existing public CLI commands and local-only capability gates remain backward compatible.

### Phase 1: Manager shell and System Instructions vertical slice

Goal: deliver one complete manual workflow from discovery through receipt without AI drafting.

- Build the five-destination sidebar and deterministic Overview state.
- Implement resumable Welcome, provider discovery, and destination matrix.
- Implement source-only System Instructions import, ordered source stack, shared-base editing, provider overlays, composed previews, and fresh Review & Apply.
- Implement receipt completion and basic Activity history.

Exit criteria:

- A new user can complete a prompt-only setup without seeing Skills or MCP steps.
- Only checked destination cells are enrolled or written.
- Source-only providers remain unenrolled.
- Quitting and resuming loses neither draft nor scope.
- A changed target or Master revision invalidates the reviewed plan before any write.

### Phase 2: Rules drift, detach, and recovery

Goal: make the System Instructions slice safe for daily use, not just first run.

- Add explicit refresh and launch-time scan.
- Add the three-way change review and three resolution paths.
- Add scoped Stop Managing and generated-header removal.
- Add receipt detail, restore preview, interrupted-operation recovery, and failure diagnostics.
- Complete Master editing and unapplied-change navigation.

Exit criteria:

- Modified, missing, concurrent, detached, restored, stale, failed, and interrupted cases have automated coverage.
- No drift is imported, overwritten, or cleared without an explicit resolution.
- Every mutation and detach produces a receipt.

### Phase 3: Skills

Goal: add searchable, scoped skill management using the proven transaction workflow.

- Add discovered inventory, search, shared/provider scope, collision resolution, editing, deletion, and effective-output previews.
- Reuse the same enrollment, draft, review, drift, detach, and receipt concepts.
- Show directory-level diffs without turning the main review into a file browser.

Exit criteria:

- Shared, provider-only, override, rename, replace, skip, delete, drift adoption, detach, and restore cases pass across every compatible provider.
- Unsupported Skills cells never become selectable or writable.

### Phase 4: MCP Servers

Goal: add MCP management without weakening the secret boundary.

- Add duplicate grouping, structural conflict resolution, shared/provider scope, and process-environment mappings.
- Add effective provider rendering and managed-key-aware diffs.
- Block raw secrets and missing required environment variables before a plan can become applicable.

Exit criteria:

- Tests prove raw values never enter the Master, UI models, logs, diagnostics, journals, snapshots, previews, or receipts.
- Shared, provider-only, override, conflict, removal, unmanaged-key preservation, drift adoption, detach, and restore pass for every compatible provider format.

### Phase 5: Release hardening and optional AI drafting

Goal: finish trust, accessibility, and distribution work after core workflows stabilize.

- Add consented external AI drafting with source/output comparison.
- Complete keyboard-only navigation, VoiceOver names and order, visible focus, text scaling, contrast, Reduce Motion, Increase Contrast, and Reduce Transparency behavior.
- Add redacted diagnostics export and explicit legacy-state removal.
- Validate clean-install and legacy-state network silence.
- Complete signing, notarization, packaging, update policy, release documentation, and rollback rehearsal.

Exit criteria:

- The release validation matrix below is recorded with reproducible evidence.
- Network observation confirms no request during install, launch, scan, edit, preview, apply, drift review, detach, restore, or idle time. Manual update check and consented AI drafting are tested as clearly separate exceptions.
- Accessibility validation includes keyboard and VoiceOver walkthroughs, not source inspection alone.

## Cross-phase acceptance matrix

Each content type must eventually pass the same lifecycle matrix where supported:

| Lifecycle | Required cases |
| --- | --- |
| Discover | installed, not found, unsupported capability, unreadable content |
| Import | source-only, empty source, duplicate, conflict, invalid source |
| Compose | shared, provider-specific, override, deterministic preview |
| Enroll | one cell, several cells, unsupported cell, no destination |
| Apply | create, update, remove, no-op, partial scope, stale digest, missing environment |
| Drift | modified, missing, simultaneous incompatible changes, unmanaged change |
| Resolve | adopt shared, adopt provider-specific, detach, restore Master |
| Recover | success receipt, failed operation, interrupted operation, rollback, receipt restore |
| Privacy | redacted UI, diagnostics, logs, journal, receipt, and no implicit network |
| Accessibility | keyboard, VoiceOver, focus, scaling, contrast, reduced effects, confirmations |

## Release gates

The future Manager is ready for public distribution only when all of the following are true:

- Phases 0 through 4 are complete for every advertised provider/content capability.
- The manual workflow is complete without an AI runner.
- Existing CLI-only installation and automation remain supported.
- All provider mutations use the structured digest-backed transaction boundary.
- Clean and legacy installations make no implicit network request and expose no remote-sync or daemon controls.
- A full install -> onboard -> edit -> review -> apply -> drift -> adopt/detach/restore -> receipt recovery walkthrough is recorded on a clean macOS account.
- Keyboard-only and VoiceOver walkthroughs are recorded at supported text sizes and accessibility appearances.
- Signing, notarization, distribution, update behavior, privacy documentation, and recovery documentation are complete.

## Explicit deferrals

The following are not part of this roadmap:

- accounts, teams, device pairing, cloud sync, hosted or self-hosted services;
- background file watchers, launch agents, scheduled scans, or automatic apply;
- project-scoped configuration;
- arbitrary per-item destination expressions beyond shared or one provider-specific scope;
- automatic semantic prompt merging;
- automatic conflict resolution across providers;
- automatic receipt or snapshot pruning;
- additional providers.

These require separate product and security designs rather than being added as onboarding options.

## Product decisions still required

Resolve these before Phase 0 contracts freeze:

1. Whether System Instructions provider overlays are stored as one document per provider or as an ordered provider-specific document set. Prefer the ordered document set because it matches the shared source model and preserves provenance.
2. Whether MCP server identity is a user-controlled stable identifier or derived from its display name. Prefer an explicit stable identifier with a separately editable display name to make overrides and renames safe.
3. Whether onboarding may create a Master-only draft for content with no destination selected. Prefer yes, but make it an explicit "Add to Master only" choice rather than inferring it from source selection.
4. Whether failed and interrupted operations appear in one Activity timeline or a separate filter. Prefer one timeline with status filters so recovery history remains chronological.
