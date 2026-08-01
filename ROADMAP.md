# Roadmap

## Implemented product foundation

- Canonical schema-v2 library with lifecycle, drafts, history, tombstones, and
  recovery.
- Six provider adapters with explicit projection, drift, backups, effective
  configuration, discovery declarations, and compatibility issues.
- SQLite-backed project intake, FTS5 search, scoped promotion, provenance,
  ignored revisions, trust decisions, and bounded filesystem watching.
- Shared serialized application layer used by the CLI, Hono runtime, manager,
  and Electron client.
- Keychain-backed MCP secret references, redacted diagnostics/logging, and
  non-executing validation.
- Scoped remote sessions, secure pairing, optional HTTPS/LAN operation, and
  canonical-only self-hosted sync with structured conflict handling.

## Release operations

- Exercise signed and notarized macOS release jobs with production Apple
  credentials.
- Exercise signed Windows installer jobs with the production certificate.
- Publish and validate the HTTPS update feeds used by packaged clients.
- Complete supported-hardware performance runs and cross-platform recovery
  drills for each release candidate.

## Future work

- Hosted sync only after client-side end-to-end encryption is complete.
- Team-owned and publishable instruction or skill collections.
- Additional providers through verified registry adapters and fixtures.
- Additional canonical artifact types only after their ownership, execution,
  security, and projection contracts are defined.
