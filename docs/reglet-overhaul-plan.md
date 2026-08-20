# Reglet overhaul delivery record

Date: 2026-08-19  
Status: core implementation and packaged macOS smoke complete

## Product objective

Reglet is the unified source of truth for agent instructions, skills, and MCP
server definitions across AI providers. The canonical library is authoritative.
Provider files are inspected sources or reviewed projections. Project files stay
read-only until the user deliberately promotes them.

The app must answer five questions without requiring users to understand its
internal storage model:

1. What is canonical?
2. What does each provider read?
3. What will Reglet change before it writes anything?
4. What changed outside Reglet?
5. Can the last operation be recovered?

## Audit verdict

The installed app had a sound transaction engine behind an incomplete product.
It opened in the wrong place, hid the primary trust boundary, exposed provider
internals instead of ownership, reduced sync conflicts to a count, and removed
the editor at compact widths.

The overhaul now connects the public Manager contract to the main workflows. It
does not rely on private paths, raw receipt data, or unverified Apply state. The
remaining work is release acceptance and secondary lifecycle depth, not a
missing core operating model.

## Implemented outcomes

| Area | Delivered behavior |
| --- | --- |
| Runtime | One lifecycle lock, bounded readiness, reconnect-safe clients, and revision-safe refresh. |
| Invalidation | Canonical, CLI, provider-source, sync, and runtime changes refresh the shared snapshot without internal watcher loops. |
| Overview | Opens first with canonical counts, provider coverage, pending review, drift, diagnostics, sync, and recent activity. |
| Library | Unified instructions, skills, and MCP artifacts with global or provider scope, search, editing, history, and projection state. |
| Review and Apply | One exact ledger for provider and content units, paths, operations, diffs, validation, drift, selection, and recovery behavior. |
| Provider ownership | Instructions, Skills, and MCP rows show managed, unmanaged, mixed, empty, unknown, or unsupported state with exact source evidence. |
| Adoption | Reads one unmanaged source, proposes canonical scope and targets, sanitizes MCP values, confirms executable skill revisions, and leaves the source unchanged. |
| Executable skill approval | Routes blocked skill reviews to a local admin screen with exact revisions, executable paths and hashes, risk findings, provider targets, and stale-review rejection. Reglet does not execute inspected files. |
| Detachment | Reviews exact targets before stopping management, preserves provider content, and routes reversal through Resume managing. |
| Drift | Durable manifests report modified and missing outputs. Drift confirmation remains inside Review and Apply. |
| Recovery | Activity lists public receipts, previews exact current and restored fingerprints, requires confirmation, and creates an undo receipt. |
| Sync | Shows durable failures, trusted devices, rename and guarded revoke actions, key rotation state, exact conflict paths, and local versus encrypted-remote comparisons. |
| Responsive behavior | Library uses state-preserving Library, Edit, and Details panels at compact widths. Review and conflict comparisons stack without removing controls. |
| Accessibility | Dialog focus is contained and restored, shortcuts are truthful, toggle controls use correct semantics, contrast clears AA, and consequential actions have explicit labels. |
| Package safety | Unsigned local builds have a valid disabled updater configuration, credential-like MCP arguments are redacted in previews, and unsafe provider adoption is blocked. |

## Authority model

| Zone | Authority | Main actions | Safety boundary |
| --- | --- | --- | --- |
| Library | Canonical and editable | Create, edit, scope, archive, restore, inspect history | Invalid structured content stays a local draft. |
| Providers | Installed source plus reviewed output | Inspect, adopt, review, apply, detach, resolve drift | Provider writes require an exact current review. |
| Project Inbox | Read-only discovery | Scan, preview, promote | Reglet never edits project guidance. |
| Devices | Encrypted copies of canonical content | Connect, sync, rename, revoke, resolve conflicts | Sync never writes provider outputs. |

Artifact lifecycle and projection state remain separate. An active artifact can
have provider projections that are pending, current, drifted, missing, blocked,
or failed.

## Permission and consent model

Reglet should ask at the moment a capability is used. It should not request
blanket system access during installation or first launch.

| Boundary | Consent model | Delivery state |
| --- | --- | --- |
| Provider writes | Review the exact paths, operations, diffs, drift, and current digest before Apply. | Complete |
| Executable skills | Approve one inspected canonical revision before provider sync. Any file change invalidates approval. | Complete |
| Project roots | Select a directory and grant read-only discovery access to that root. Do not imply access outside the selected tree. | Native directory selection and root removal pending |
| Native keychain | Explain local keychain use when binding an MCP secret or encrypted-sync credential. Never return the value through Manager APIs. | Secure storage complete; binding removal pending |
| Sync and devices | Confirm the server, vault fingerprint or short authentication string, and device scope before encrypted exchange. On macOS, request Local Network access only when the chosen server is on the LAN. | Complete |
| Remote access | Keep loopback as the default. Confirm the exact HTTPS or tailnet endpoint before exposing Manager access. | Backend boundary complete; enablement interface pending |
| Destructive actions | Confirm permanent deletion, provider-content replacement, recovery, device revocation, root removal, secret removal, and backup purge at the action. | Core recovery and revocation complete; secondary Settings actions pending |

Reglet does not need Accessibility, Screen Recording, camera, microphone,
location, Automation, or blanket Full Disk Access for its product workflows.
MCP definitions and executable skill files are synchronized as configuration;
Reglet does not start MCP servers or run skill scripts.

## Core workflows

### Adopt provider content

1. Inspect one exact provider source and its ownership.
2. Choose provider-specific or shared canonical scope.
3. Review the proposed artifact, targets, sanitized content, and source revision.
4. Confirm executable skill files when required.
5. Adopt without changing the provider source.
6. Review the resulting projection before any provider write.

### Review and apply

1. Open the queue from Overview, Library, or Providers.
2. Inspect exact units, operations, paths, diffs, validation, and drift.
3. Select only actionable units.
4. Confirm drift replacement when required.
5. Apply the same digest-checked selection.
6. Inspect per-unit outcomes and recovery receipts.

### Recover a provider write

1. Select a restorable receipt from Activity.
2. Compare current and captured fingerprints for every target.
3. Confirm replacement of current filesystem contents.
4. Restore the reviewed digest.
5. Keep the returned undo receipt available for reversal.

### Resolve a sync conflict

1. Select one canonical path in Sync and devices.
2. Compare this device with the encrypted remote version.
3. Choose one version explicitly.
4. Resolve only that path.
5. Leave provider outputs unchanged and pending local review where needed.

## Delivery status

| Phase | Outcome | Status |
| --- | --- | --- |
| 0A | Runtime startup, invalidation, and reconnect | Complete |
| 0B | Exact Review and Apply protocol and interface | Complete |
| 0C | Truthful projection, drift, diagnostics, and recovery | Complete |
| 1 | Activity context and provider source ownership | Complete |
| 2 | Overview-first information architecture and ledger-led visual direction | Complete |
| 3 | Overview, Library, Providers, drift, and recovery interface | Complete |
| 4 | Adoption, detachment, overrides, and executable trust | Complete |
| 5 | Encrypted sync status, devices, conflicts, and failure recovery | Complete |
| 6 | Automated accessibility, responsive, performance, and release hardening | Complete |
| 6A | Packaged macOS launch and critical-workflow smoke | Complete |
| 6B | Assistive technology, scaling, and Windows acceptance | Pending |

## Remaining release work

- Complete native keyboard and VoiceOver acceptance on macOS.
- Complete Narrator and display-scaling acceptance on Windows.
- Verify light and dark modes, 200% text, and the minimum supported window with
  the packaged desktop app.
- Extend Project Inbox with state filters, ignore recovery, merge destinations,
  selected hunks or files, and executable trust in one promotion review.
- Complete secondary Settings lifecycle actions for project roots, secret
  bindings, remote access, disconnect modes, and provider backup purge.
- Split the remaining shell orchestration when profiling shows a user-visible
  refresh cost.

The final version 0.3.3 bundle was built, ad-hoc signed, installed at
`~/Applications/Reglet.app`, restarted, and inspected with Computer Use. It
loaded the real canonical library, all six detected providers, command search,
Settings, and the Review and Apply ledger. MCP diffs were labeled as redacted
and did not expose credential-like command arguments. The package was not
notarized because Apple release credentials are not configured on this machine.

## Verification evidence

Checks completed on 2026-08-19:

- 285 package tests passed.
- 25 desktop React, bootstrap, updater, and deep-link tests passed.
- 3 Tauri Rust tests passed during the reliability phase.
- TypeScript typecheck passed.
- ESLint passed.
- The installed version 0.3.3 bundle passed strict deep code-signature
  verification and native launch smoke testing.
- The unsigned-build updater regression test passed.
- `git diff --check` passed.

See the [Manager UI technical audit](./qa/2026-08-19-manager-ui-audit.md) and
[Manager contract](./manager-contract.md) for the remaining acceptance gates and
public safety boundaries.
