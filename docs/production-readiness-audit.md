# Production-readiness audit

Date: 2026-07-16
Scope: Tauri desktop app, Manager RPC/CLI boundary, local transaction engine, encrypted sync preview, and sync server
Baseline: `origin/main` at `966830f`

> Historical audit: the desktop architecture described below was superseded by the shared Manager V2 workbench and persistent loopback runtime. The former per-request bridge and duplicate `apps/desktop/src/ui` implementation have been removed.

## Executive summary

The local transaction engine is the strongest part of Reglet: digest freshness, rollback, receipts, scoped detachment, typed MCP references, and redaction are well tested. The Tauri app has broad surface coverage and a restrained visual system, but feature depth, state coordination, and accessibility evidence are not yet at a production bar.

The plaintext sync implementation remains compatibility-test-only. The initial audit found that a malicious server could escape the Reglet home and that a clean pull could invoke provider apply. Those P0 paths remain remediated and regression-tested.

Protocol v2 now provides authenticated end-to-end encryption, opaque paths, OS credential storage on macOS/Windows, fingerprint pairing, signed devices and objects, checkpointed manual sync, conflict/tombstone handling, bounded single-node storage, verified backups, and a hardened homeserver container. Protocol v1 is disabled by default in the server process.

The remaining production sync blockers are epoch rotation after revocation, offline recovery, sync receipts/conflict UI, persistent hosted rate limits, total-storage quotas, operational telemetry/audit events, automated restore/retention drills, signed artifacts, and native acceptance.

No source-level public capability currently enables sync, so these are contained release blockers rather than known exposure in the shipped local-only interface.

### Original finding count

- P0: 3
- P1: 13
- P2: 10
- P3: 2

## Remediation status

| Area | Status | Evidence |
| --- | --- | --- |
| Remote path escape and symlink traversal | Resolved | Shared strict path contract, canonical containment, full-page validation before mutation, malicious-server tests. |
| Remote provider apply | Resolved | Pull no longer imports or calls `applyAll`; results explicitly require local provider review. |
| Plaintext server storage | Resolved for gated v2 preview | Protocol-v2 tables contain opaque identifiers and authenticated ciphertext; malicious-storage canaries pass. Protocol v1 remains disabled outside explicit compatibility testing. |
| Sync correctness/private state | Resolved for v2 preview | Tombstones, scoped content, owner-only atomic state/bases, persistent conflicts, checkpoint validation, and OS credential storage. |
| Server concurrency/device foundation | Partially resolved | Transactional encrypted writes/pair claims, pagination, closed registration, TLS, signed devices, list/rename/revoke/last-seen, bounded quotas, readiness, and verified backup. Hosted operations and epoch rotation remain. |
| Desktop interaction safety | Partially resolved | Unsupported cells disabled; one focus-trapped dialog primitive; onboarding nested confirmations hidden; responsive/reduced-transparency CSS. Native evidence remains. |
| Native bridge boundaries | Resolved for current surface | Request/response/stderr bounds, idle/update timeouts, fixed sidecar, one-line RPC, canonical Reveal allowlist. |
| Dependency advisories | Resolved | Vitest 3.2.7; `bun audit --production` reports no vulnerabilities and now gates CI/release workflows. |
| Oversized server coordinator | Partially resolved | `app.ts` remains a 468-line coordinator and protocol-v2 routes are separate. The encrypted storage module is 624 lines and should split by pairing/object/device lifecycle before public release. |

## Release-blocking findings

### P0 — Remote sync paths can escape the Master directory — remediated

- **Location:** `packages/core/src/sync/engine.ts`, `pullChanges`
- **Impact:** A malicious or compromised server can cause recursive deletion or writes outside `~/.reglet`. `rules/../../victim` passes the current prefix check and `path.join` resolves it outside the Master.
- **Recommendation:** Share one strict canonical path contract across client and server; validate the complete change list before mutation; resolve beneath a canonical root and fail closed; test traversal, encoded traversal, absolute paths, backslashes, empty segments, `.state`, symlinks, and conflict/backup suffixes.

### P0 — A sync pull automatically applies provider outputs — remediated

- **Location:** `packages/core/src/sync/engine.ts`, `syncOnce`
- **Impact:** Network-originated content can bypass the product's digest-backed Review & Apply trust boundary.
- **Recommendation:** A pull may update only a staged Master revision and sync receipt. Provider writes require a separate local structured preview and current digest.

### P0 — The server stores Master content in plaintext — remediated for protocol v2

- **Location:** `packages/server/src/app.ts`, `files` and `file_history`; protocol v1 payloads
- **Impact:** Protocol v1 database, backup, server, or operator compromise exposes private rules, Skills, and MCP definitions.
- **Remediation:** Protocol v2 encrypts paths and content before upload, authenticates routing metadata and authors, and stores keys only on devices. The server process disables `/v1` by default; the public capability remains off while remaining lifecycle gates are open.

## P1 findings

### Sync correctness and privacy

1. **Resolved:** local deletions now produce revision-checked tombstones.
2. **Resolved:** provider-scoped MCP files use the same shared path contract.
3. **Resolved:** downloaded and conflict content hashes are recomputed before persistence.
4. **Resolved for v2:** device tokens, vault roots, and private keys live in macOS Keychain or Windows Credential Manager; `.state/sync-v2.json` is non-secret.
5. **Resolved:** merge bases use owner-only private-file writes.
6. **Resolved:** sync state and bases use atomic staged replacement.

### Server security and reliability

7. **Resolved:** revision comparison, sequence allocation, head/history persistence, and tombstones commit together.
8. **Resolved:** pair-code consumption and device creation use one transaction.
9. **Partially resolved:** forwarded addresses are ignored unless explicitly trusted; hosted deployments still need persistent/distributed limiting.
10. **Partially resolved:** protocol-v2 list, rename, last-seen, server-access revoke, local logout, and expired-pair cleanup exist; token rotation, pairing cancellation, current-device remote revoke, epoch rotation, and full cleanup remain.
11. **Resolved:** clients require HTTPS except for loopback development.
12. **Resolved:** registration is closed by default and cannot coexist with single-user token mode.
13. **Partially resolved:** scrypt is asynchronous and account inputs are bounded/normalized; parameters still need versioning and production review.

## P2 findings

### Logic and contract design

1. Manager mutation results other than snapshot v2 are parsed through repeated ad-hoc guards rather than operation-specific response schemas.
2. **Resolved:** Tauri owns one persistent loopback runtime and the shared UI uses the same HTTP/WebSocket client contract as the browser.
3. **Resolved:** unsupported or attention-required provider/content cells are disabled with their reason.
4. Receipt restoration does not use the same preview-first interaction as provider apply.
5. Drift offers a direct destructive import, not a three-way review or the three distinct resolution paths.
6. **Resolved:** `open_file_location` canonicalizes and permits only Reglet/provider trees or exact managed files.
7. **Resolved:** the Rust bridge bounds requests, responses, stderr, sidecar idle time, and update requests.
8. **Resolved:** authentication reads the server's structured error envelope.

### Dependency hygiene

9. **Resolved:** Vitest was upgraded to 3.2.7, the vulnerable Vite/esbuild lineage was removed, and dependency audit gates CI and release jobs.
10. GitHub Actions use mutable major tags instead of pinned commit SHAs, weakening release supply-chain reproducibility.

## Code-size and complexity audit

| File | `origin/main` | Current | Finding | Recommended boundary |
| --- | ---: | ---: | --- | --- |
| `packages/cli/src/index.ts` | 2,654 | 2,659 | Commands, RPC dispatch, snapshot construction, onboarding, AI runner execution, parsing, and formatting are coupled. | `commands/`, `manager-rpc/`, `manager-snapshot/`, `onboarding/`, `ai-draft/` |
| `apps/desktop/src/ui/App.tsx` | 1,417 | Removed | Superseded by transport-neutral `packages/manager-ui`. | Shared feature packages |
| `apps/desktop/src/ui/OnboardingWizard.tsx` | 1,059 | Removed | Superseded by the shared manager workflow. | Shared onboarding feature |
| `packages/server/src/app.ts` | 445 | 468 | The coordinator stays below 500 lines and protocol-v2 routes are extracted; `v2-storage.ts` is now a 624-line review hotspot. | Split encrypted pairing, object, and device persistence before public release. |
| `apps/desktop/src/styles.css` | 633 | Removed | Shared tokens and workbench styling now live in `packages/manager-ui`. | Shared design system |

The target is not line count for its own sake. Each extracted module should own one reason to change, preserve type flow, and reduce the amount of code required to review a security-sensitive operation.

## Frontend technical audit

### Initial audit health score

This score records the baseline before the remediation pass. It is intentionally not raised without native keyboard, scaling, and screen-reader evidence.

| # | Dimension | Score | Key finding |
| --- | --- | ---: | --- |
| 1 | Accessibility | 2/4 | Good labels and one focus-trapped dialog, but onboarding/nested confirmations lack complete focus and inert handling; no native screen-reader evidence. |
| 2 | Performance | 2/4 | No heavy visual effects, but the monolithic app rerenders large lists and one workflow can launch many sidecar processes. |
| 3 | Responsive design | 2/4 | Onboarding has breakpoints; the primary shell has fixed sidebar/column layouts and a 940px minimum with no text-scaling evidence. |
| 4 | Theming | 3/4 | Consistent dark tokens and strong contrast; several raw duplicate colors and Reduce Transparency behavior remain. |
| 5 | Anti-patterns | 2/4 | Restrained overall, but repeated nested cards, four metric cards, decorative uppercase labels, and a selected-nav side stripe make the shell feel scaffolded. |
| **Total** |  | **11/20** | **Acceptable; significant work needed before release.** |

### Anti-pattern verdict

The interface does not look like a generic colorful AI dashboard, and the palette is disciplined. It still shows recognizable generated-product scaffolding: a card around nearly every region, a card-grid status summary, repeated small uppercase tracked labels, and a decorative selected-navigation stripe. The primary opportunity is distillation, not additional decoration.

### Accessibility findings

- **Resolved in source:** `WizardConfirmation` and the main confirmation surface now share focus movement, trapping, restoration, and Escape behavior; the parent onboarding dialog is hidden while its nested confirmation is active.
- **Resolved in source:** onboarding uses the shared modal focus boundary instead of a separate incomplete keyboard handler.
- **P1:** Native keyboard, VoiceOver, Narrator, Windows scaling, and large-text acceptance records are still empty.
- **P2:** Busy operations generally change button text but do not consistently expose `aria-busy` or announce completion/error at the smallest relevant region.
- **Resolved in source:** the seven-step rail marks the current item with `aria-current="step"`.
- **Positive:** Body/muted/status colors exceed WCAG AA in the tested dark combinations; controls are semantic; labels are widespread; focus is visible; reduced motion and increased contrast have explicit CSS.

### Performance and responsive findings

- **P1:** One global state change rerenders the full shell and potentially every Skill/MCP disclosure; long inventories are not windowed or incrementally rendered.
- **Resolved in source:** the primary shell, metric summary, provider grid, onboarding rail, and content columns now adapt at 900px and 620px.
- **Resolved in source:** the translucent onboarding footer disables blur under Reduce Transparency.
- **Positive:** There are no large images, expensive page-load animations, layout-property animations, or unnecessary UI frameworks.

### Remaining design actions

The earlier task to build a shared accessible dialog primitive is complete and is no longer roadmap work.

1. **P1 `/impeccable adapt`**: validate the primary shell under minimum size, text scaling, and Windows display scaling.
2. **P2 `/impeccable distill`**: replace the metric-card strip and nested card hierarchy with a task-oriented status ledger.
3. **P2 `/impeccable optimize`**: isolate view state and reduce repeated sidecar calls and full-shell rerenders.
4. **P3 `/impeccable polish`**: complete native visual and screen-reader verification after functional fixes.

## Positive findings to preserve

- The local transaction/recovery engine has unusually strong failure and privacy coverage for this maturity level.
- The Tauri bridge fixes the sidecar executable and arguments, validates response envelopes, and suppresses stderr from the frontend.
- The design palette has excellent measured contrast and reserves coral for branding.
- Automatic update checks are off by default and AI drafting requires per-use consent.
- The sync server already bounds request bodies, validates base64/revisions, hashes tokens at rest, uses timing-safe password verification, rejects unsafe server-side paths, and provides protocol compatibility metadata.
- Tests cover all six providers, stale plans, redaction, rollback, receipt recovery, sync conflicts, path rejection, rate limits, and protocol mismatch.

## Validation run

- `bun test packages`: 168 passed
- `bun run desktop:test`: 17 passed
- `bun run typecheck`, `bun run lint`, desktop typecheck/lint: passed
- Tauri Rust tests: 7 passed; `cargo fmt --check` passed
- Retained Swift tests: 12 passed
- `bun audit --production`: no vulnerabilities found
- `git diff --check`: passed

Attach native keyboard, screen-reader, text-scaling, and Windows acceptance evidence to the release candidate before revising the baseline UI score.
