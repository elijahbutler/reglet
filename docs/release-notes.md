# Public V1 release notes

## v0.1.18 - Encrypted sync homeserver preview

This release promotes the protocol-v2 encrypted sync preview into the desktop and self-hosted server workflow while keeping it explicitly gated and owner-operated.

### Server and dashboard

- Adds the same-origin owner dashboard for single-owner server claiming, owner sign-in/reset, first-device invitations, pending connection approval, device rename/revoke, server health, schema status, live database integrity checks, and verified SQLite backups.
- Hardens the bundled homeserver Compose deployment with loopback-only binding, disabled registration and legacy protocol v1, an unprivileged container, a read-only root filesystem, and a dedicated mounted backup directory.
- Keeps `REGLET_BOOTSTRAP_TOKEN` as compatibility-only for older preview servers. New servers use the dashboard claim link and first-device invitation flow.

### Desktop sync

- Adds the desktop **Encrypted Sync** preview flow with explicit local opt-in, first-device invitation handling, deep links, trusted-device invitations, eight-character request codes, manual sync summaries, device management, and guarded disconnect actions.
- Preserves the core security boundary: the server stores authenticated ciphertext and device registry state, while vault keys, plaintext Master content, provider outputs, resolved MCP secrets, credentials, receipts, and machine-local settings stay on devices.
- Keeps sync manual and non-applying. Pulled changes update only the receiving Reglet Master and still require local Review & Apply before provider files change.

### Reliability

- Hardened Windows sync test cleanup around SQLite WAL/SHM files to avoid `EBUSY` poisoning later test cleanup.

## Local-only CLI V1

This release establishes Reglet as a local-only CLI for rules, skills, and MCP configuration across Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode.

### Trust and recovery

- Review & Apply uses digest-backed structured plans with redacted diffs, target hashes, drift status, and snapshot behavior.
- Provider writes use durable journals, sibling staging, cross-provider rollback, interruption recovery, and persistent receipts.
- Recovery is receipt-based: inspect affected paths/snapshot sources, then explicitly restore a chosen receipt.
- Stop Managing preserves provider content and removes Reglet ownership rather than deleting the provider file.

### MCP credentials

- MCP environment entries now require `{ "source": "process-env", "name": "LOCAL_VARIABLE" }` references.
- Raw environment values are rejected; resolved values stay in memory and are redacted from Reglet's own previews, diagnostics, journals, and receipts.

### Product boundary

- The CLI and retained manager source are local-only. Legacy network state is inert until explicitly cleared.
- Automatic update checks in the retained macOS manager source are disabled by default; manual update checks remain available in source builds.
- Public artifacts include CLI binaries, ad-hoc-signed/unnotarized macOS desktop artifacts, and unsigned Windows desktop artifacts, with checksums, provenance, and mandatory Homebrew formula publication before release publishing. The Swift app remains frozen during parity, and Linux GUI publishing is deferred.

### Desktop manager

- The Tauri Rules tab now opens the unified Reglet markdown by default, exposes provider-scoped markdown files only when they exist, and focuses editing on content with refresh, save, and open-file-location actions.
- **Encrypted Sync (Preview)** adds explicit machine-local opt-in, owner-invitation bootstrap, trusted-device invitations and request codes, manual sync summaries, device management, deep links, and guarded disconnect flows.
- The same-origin owner dashboard adds claim/login recovery, health and schema status, first-device fingerprint approval, device access management, live integrity checks, and verified server-native backups without exposing vault content or keys.
- Revocation still requires vault-key rotation and re-encryption before encrypted sync can leave Preview. macOS artifacts remain ad-hoc signed and unnotarized; Windows artifacts remain unsigned.

See [Release integrity and V1 certification](release.md) before distributing a tagged build.
