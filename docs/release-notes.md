# Public V1 release notes

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
- Public artifacts include CLI binaries plus ad-hoc-signed, unnotarized macOS app archives for Apple silicon and Intel Macs, with checksums, provenance, and mandatory Homebrew formula publication before release publishing.

See [Release integrity and V1 certification](release.md) before distributing a tagged build.
