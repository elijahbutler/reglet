# Manager contract

Reglet has one transport-neutral Manager application. The Tauri desktop and
browser entry use the local HTTP and WebSocket runtime. The CLI calls the same
application for canonical lifecycle commands and keeps protocol V1 adapters for
one release of compatibility.

## Current versions

- Manager RPC protocol: version 2.
- Manager read model: Snapshot V3.
- Canonical library schema: version 2.
- Encrypted sync protocol: version 2.

Snapshot V2 and Manager RPC protocol V1 remain read-only compatibility paths.
New clients must request Snapshot V3 and validate it with
`isManagerSnapshotV3` or `managerSnapshotV3DtoValidator` from
`packages/manager-protocol`.

## Authority boundaries

- `packages/core` owns canonical files, provider adapters, projection preview,
  provider writes, receipts, drift, recovery, security, and encrypted sync.
- `packages/manager-protocol` owns operation names, strict inputs, public DTOs,
  validators, and error codes.
- `packages/manager-application` owns serialized use cases, session scopes,
  optimistic revisions, activity context, and public response shaping.
- `packages/manager-runtime` owns local transport, pairing, events, readiness,
  and filesystem invalidation.
- `packages/manager-ui` consumes public Manager DTOs. It never reads or writes
  canonical or provider files directly.

## Revision and invalidation rules

Every mutation requires the current Manager revision. A stale command returns a
revision conflict before it changes local state. Read commands never carry an
optimistic revision.

The runtime emits invalidation events for Manager commands, canonical and exact
provider source changes, encrypted sync, and runtime replacement. Clients keep
their observed revision monotonic and refresh Snapshot V3 without allowing an
older response to replace a newer snapshot.

## Review and Apply

`provider.review` accepts one to 18 unique provider and content units. Each unit
is one of `rules`, `skills`, or `mcp` for one supported provider. The response is
a `ManagerProjectionReviewV3`:

- one batch digest;
- one digest and canonical revision per exact unit;
- ready or blocked state and validation issues;
- explicit write, remove, and skip entries;
- target path, redacted unified diff, drift state, and target hashes;
- snapshot and backup behavior without internal storage paths;
- affected canonical artifact IDs, titles, and kinds;
- an explicit drift-confirmation requirement.

The public review DTO omits internal `before` and `after` values. MCP diffs redact
resolved, process-environment, and legacy raw environment values before they
leave the core engine.

`provider.apply` must receive the same batch digest and every selected unit
digest. The application recomputes the exact review before writing. A changed
canonical revision, environment fingerprint, provider source, target hash, unit
selection, or validation issue makes the review stale. Successful units remain
applied if another unit is blocked or fails, and every successful unit receives
a recovery receipt. The public Apply result contains receipt IDs and outcomes,
not core preview objects, private snapshot locations, or receipt internals.

`provider.preview` remains the artifact-led convenience operation. It returns a
single-unit `ManagerProjectionReviewV3` plus compatibility digest fields. It no
longer returns the internal core preview object.

## Provider sources

Snapshot V3 reports each provider content source as empty, managed, unmanaged,
mixed, or unknown. It includes exact items and typed issues. Provider source
adoption follows a separate preview and digest flow:

1. `provider.source.preview` inspects one exact source item and proposes a
   canonical artifact.
2. The user chooses shared or provider-only scope and target providers.
3. Executable skills require confirmation for the exact inspected revision.
4. `provider.source.adopt` repeats the preview and rejects stale input.

Adoption never removes or rewrites the provider source. Raw provider MCP
environment values become required process-environment references and never
enter canonical files or responses.

`provider.source.stop-managing.preview` fingerprints every affected provider
output and shows the exact generated rules header removal. The matching
`provider.source.stop-managing` command requires that digest, disables future
projection for the selected content type, and detaches Reglet metadata without
deleting provider content.

Stop-managing receipts cannot be replayed through generic recovery because a
file-only replay would leave provider enrollment disabled. The inverse action is
`provider.source.start-managing`. It enables the provider content type and sends
the user to Review and Apply. It does not write provider files by itself.

Provider restoration and permanent backup deletion use separate exact reviews.
`provider.restore.preview` fingerprints current outputs and their original
private backups. `provider.purge-backups.preview` fingerprints the private backup
tree and names manifest entries that will lose their recovery path. Both apply
commands reject stale digests. Public responses never contain private backup
locations.

## Recovery contract

Recovery uses three admin-scoped operations:

1. `recovery.list` returns recent public receipt summaries and whether each one
   can be restored.
2. `recovery.preview` fingerprints the current target and the private receipt
   snapshot for one exact receipt. It returns paths, actions, kinds, sizes, and
   hashes without returning snapshot locations or file content.
3. `recovery.restore` requires the exact preview digest and explicit
   confirmation. Any target, receipt, or snapshot change makes the preview
   stale.

Only completed receipts with at least one target and an allowed restore policy
are restorable. Rolled-back, already-restored, and dedicated-inverse receipts
cannot be replayed. A successful restore creates a new completed receipt,
returned as `undoReceiptId`, so recovery is itself reversible.

## Sync contract

Snapshot V3 exposes disabled, pending, expired, idle, conflict, and error states.
Active conflicts include sorted canonical paths. A failed run remains visible
with its occurrence time and safe error message until a successful run clears
it.

`sync.snapshot` adds server compatibility, current device, device inventory,
pending connection details, last run, and key-rotation state. Sync changes only
canonical content. Provider output always returns to local Review and Apply.

`sync.conflict.preview` returns verified local and encrypted revisions for one
canonical path. It classifies text, binary, deleted, and oversized content.
Choosing the encrypted revision fails if its stored conflict copy changed after
the sync engine recorded the conflict.

## Session scopes

- Read sessions can inspect Snapshot V3, artifacts, providers, public reviews,
  activity, and search.
- Write sessions can change canonical content and perform reviewed provider
  operations.
- Admin sessions can manage roots, discovery, secrets, sync, remote access,
  sessions, migration, recovery, and setup.

Snapshot V3 omits project roots, discoveries, and session inventory outside an
admin session.

## Error contract

Manager failures use a strict response envelope with a stable code, a safe
message, and a recoverable flag. Public messages must not contain artifact
bodies, resolved secrets, raw provider credentials, command stderr, or
unredacted recovery details.

## Fixture and test rules

- Every protocol operation has a strict checked-in request fixture.
- Snapshot fixtures must pass both the JSON Schema validator and runtime guard.
- Public DTO validators reject partial objects and unknown fields.
- Secret canaries cover snapshots, public reviews, adoption, activity,
  diagnostics, errors, receipts, and sync.
- Contract tests cover malformed input, duplicate review units, stale digests,
  optimistic revisions, and out-of-order read responses.
