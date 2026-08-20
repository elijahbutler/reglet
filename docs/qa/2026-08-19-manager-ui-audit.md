# Manager UI technical audit

Date: 2026-08-19  
Scope: `packages/manager-ui` and desktop integration  
Status: post-overhaul code audit; packaged macOS smoke accepted

## Method and evidence boundary

The audit used source inspection, public-contract comparison, measured token
contrast, React interaction tests, TypeScript, ESLint, package integration
tests, Tauri checks, and Computer Use against the installed macOS bundle.

The packaged version 0.3.3 app launched from `~/Applications/Reglet.app` and
loaded the real local library. Overview, Library, command search, Settings, and
the Review and Apply ledger were inspected without applying provider changes.
VoiceOver, text scaling, full keyboard traversal, and Windows display scaling
remain missing evidence. They are not counted as passes.

## Verdict

The four release-blocking interface defects found in the first pass are fixed:

- Review and Apply shows the exact output before writing.
- Provider source ownership and adoption are primary interactions.
- Sync conflicts can be compared and resolved one path at a time.
- Compact Library layouts preserve access to the list, editor, and inspector.

The product now has one coherent authority model. The neutral and coral system
supports a dense developer tool without turning status into decoration. Some
repeated uppercase labels and nested borders still flatten the hierarchy, but
they no longer hide or misrepresent core work.

Verdict: pass for automated workflows and packaged macOS smoke; full native
release acceptance is still required.

## Health score

| Dimension | Score | Current finding |
| --- | ---: | --- |
| Accessibility | 3/4 | Focus containment, restoration, semantics, contrast, and workflow labels are covered. Native assistive-technology acceptance remains open. |
| Performance | 3/4 | CodeMirror and diff code load lazily, artifact rows are virtualized, and provider work is scoped. Snapshot refresh still rerenders the shell. |
| Responsive design | 3/4 | Library drill-in and stacked review flows preserve primary tasks. Native minimum-window and 200% text checks remain open. |
| Theming | 4/4 | Supported light and dark text tokens clear 4.5:1 on their intended backgrounds. |
| Anti-patterns | 3/4 | Dead controls and raw provider-first views are gone. Repeated compact labels and boxed detail regions remain. |
| **Total** | **16/20** | **Core workflows repaired; native acceptance and secondary depth remain.** |

## Resolved P0 findings

| Original finding | Resolution | Evidence |
| --- | --- | --- |
| Apply hid the reviewed output. | A full-screen ledger renders every exact unit, operation, path, redacted diff, validation issue, drift state, affected artifact, and recovery behavior. Apply refreshes the selected units immediately before writing and rejects a changed digest or result. | Review contract test and desktop exact-review interaction. |
| Provider ownership had no interface. | Provider pages now center Instructions, Skills, and MCP ownership rows. Unmanaged items can be adopted into provider-specific or shared scope. Managed content can be reviewed or detached through an exact fingerprinted flow. | Desktop adoption interaction and protocol lifecycle tests. |
| Sync conflicts were only a count. | Settings lists canonical conflict paths and compares local and encrypted-remote text, deleted, binary, or oversized states before one explicit choice. Resolution refreshes canonical state without applying providers. | Desktop conflict interaction and sync engine tests. |
| Compact widths removed editing. | Library now exposes Library, Edit, and Details panels below 720px. Switching changes visibility without unmounting editor state. | Desktop panel-state interaction and responsive CSS inspection. |

## Resolved P1 findings

- Dead controls that implied unavailable behavior were removed.
- Shortcut labels now match implemented commands and platform conventions.
- Dialogs contain focus, block background focus, handle Escape when safe, and
  return focus to their trigger.
- Recovery is receipt-backed and actionable. It previews exact fingerprints,
  requires confirmation, verifies the restore result, and exposes the undo
  receipt.
- Device inventory, rename, guarded revoke, durable sync errors, and key
  rotation state are visible in Settings.
- Light muted and faint text now clear WCAG AA on supported surfaces.

## Remaining P1 findings

### Project Inbox needs a complete triage review

The current inbox scans, selects, previews, and promotes discoveries without
editing project files. It still needs state filters, an Ignore action with
reappearance behavior, explicit instruction mode and target selection, merge
destination choices, selected hunks or files, and executable revision
confirmation in one workflow.

### Secondary Settings lifecycle is incomplete

Device rename and revoke are implemented, but project-root removal, secret
binding removal, remote enablement, local versus server disconnect, and provider
backup purge are not yet represented as complete reviewed lifecycle actions.

## Remaining P2 findings

### Busy feedback is not fully standardized

Review, adoption, recovery, and sync use scoped live regions and explicit
outcomes. Some lower-risk collection and settings actions still mix plain text,
spinners, and local button labels without one shared async-region primitive.

### Coarse-pointer targets need native acceptance

The dense desktop controls suit a precise pointer. Compact kind filters, copy
controls, and icon buttons still need 44px effective hit-area verification for
coarse-pointer environments.

### The shell still owns broad orchestration

Feature workbenches now own Review, Providers, Overview, Activity, and sync
state. `ManagerApp` still coordinates library editing, dialogs, refresh, and
navigation, so one snapshot invalidation rerenders more of the shell than an
ideal route-level architecture would.

## Remaining P3 findings

- Uppercase micro-labels repeat across pane headers, collection labels, and
  inspector sections.
- Some detail documents and settings regions use nested borders where alignment
  and separators could provide a quieter hierarchy.

## Positive findings

- Body, muted, and faint text pass AA in light and dark themes.
- Coral is reserved for focus, selection, consequential action, and attention.
- Overview opens with real snapshot-derived health, coverage, review, drift,
  sync, and activity state.
- Review and Apply is one visible trust boundary, not a hidden preview step.
- Provider output writes, adoption, detachment, recovery, and sync resolution
  use public DTOs and explicit scopes.
- Resolved MCP environment values stay out of canonical files, reviews,
  activity, diagnostics, errors, receipts, and sync payloads. Credential-like
  command arguments are hidden in provider diffs and block provider adoption
  instead of entering canonical content.
- CodeMirror and text diffs load lazily. Artifact rows are virtualized.
- Reduced motion, increased contrast, light mode, and dark mode have explicit
  CSS behavior.
- Autosaves are serialized, unsettled edits block Review, and out-of-order read
  responses cannot regress the observed revision.

## Release acceptance checklist

- [x] Launch the ad-hoc-signed version 0.3.3 bundle from
  `~/Applications/Reglet.app` and load the real local library.
- [x] Verify Overview, Library, command search, Settings, and the exact Review
  and Apply ledger in the packaged macOS app without writing provider files.
- [x] Verify MCP provider diffs disclose no credential-like command argument.
- [ ] Complete keyboard-only navigation in the packaged macOS app.
- [ ] Complete VoiceOver checks for Overview, Library, Review, Providers,
  Activity, Settings, and every dialog.
- [ ] Complete Narrator checks on Windows.
- [ ] Verify 200% text at the minimum supported window.
- [ ] Verify Windows 125%, 150%, and 200% display scaling.
- [ ] Verify all core states in light and dark modes.
- [ ] Verify coarse-pointer hit areas.
- [ ] Capture screenshots for Overview, Review, Provider adoption, Recovery, and
  Sync conflict resolution after a preview becomes available.

## Next order of work

1. Complete the remaining assistive-technology, scaling, and platform checks.
2. Complete the Project Inbox promotion review.
3. Complete secondary Settings lifecycle actions.
4. Standardize remaining async feedback and touch targets.
5. Profile snapshot refresh before splitting more shell state.
6. Reduce repeated micro-labels and nested borders during final visual polish.
