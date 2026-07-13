# Manager Contract

The macOS Manager consumes a single read-only JSON response:

```text
reglet manager snapshot --json --contract-version 2
```

Version 1 remains the compatibility response for retained Swift code. New Manager work must request version 2 explicitly and validate the response against `packages/core/schemas/manager-snapshot-v2.schema.json`.

## Evolution Rules

- Prefer additive version-2 fields. Bump the contract version only when an existing field changes meaning or a client could misread old data as new behavior.
- Keep provider writes in `packages/core` and `packages/cli`. Swift clients read snapshots and submit reviewed mutation contracts; they do not write provider files directly.
- Keep snapshots complete and read-only. Recoverable local read failures belong in `problems`, `providerDiscovery`, `sourceInventory`, `structuredPlan.entries`, or `driftInbox`, not as opaque Manager-facing crashes.
- Manager-visible failures use the `manager-error` envelope with a stable `error.code` and redacted user-safe `error.message`.
- Do not expose daemon, account, remote-sync, or automatic-apply capability flags in the Manager contract. Legacy network state may appear only as inert cleanup metadata.
- Do not include raw secrets, resolved MCP environment values, raw provider credential values, command stderr that may contain secrets, or unredacted recovery messages.

## Fixture Rules

Fixtures live in `packages/core/test/fixtures/manager-contract/` and are part of the Swift-facing contract evidence.

- Every fixture must validate against both the runtime guard and `manager-snapshot-v2.schema.json`.
- Update fixtures only for intentional contract changes, and keep scenario names stable.
- Include fixtures for normal, empty, legacy-state, needs-attention, partial-failure, and interrupted-operation recovery states.
- Fixture messages must use the same safe text emitted by contract helpers; do not copy raw exception text into fixtures.
- Secret canaries must never appear in fixtures. Tests should check snapshot and error paths by searching serialized JSON for the canary string.
