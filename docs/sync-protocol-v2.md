# Sync protocol v2 security design

Status: implemented as a gated CLI homeserver preview; not enabled in public capabilities
Date: 2026-07-16
Replaces: plaintext protocol v1

## Decision

Reglet sync remains local-first and opt-in. Protocol v2 stores only authenticated ciphertext and minimal routing metadata on the service. Encryption keys are created and retained by devices; account passwords and server-issued tokens authenticate service access but never derive or recover Master encryption keys.

Protocol v1 remains an isolated compatibility-test source. The protocol-v2 server process disables `/v1` unless a developer explicitly sets `REGLET_ENABLE_LEGACY_V1=1`.

The preview implements encrypted objects, OS credential storage on macOS and Windows, authenticated fingerprint pairing, signed device certificates, manual sync, conflicts, tombstones, device management, and single-node deployment safeguards. Epoch rotation, offline recovery, hosted operations, desktop UI, and public release gates remain open.

## Security goals

- A service operator, database reader, backup reader, or network observer cannot read Master paths or content.
- A forged or modified object is rejected before its path is interpreted or local state is mutated.
- A revoked device cannot authenticate or decrypt objects written in a later key epoch.
- A pull changes only the local Master draft and conflict inbox. It never applies provider output.
- Resolved MCP environment values, provider outputs, receipts, recovery snapshots, merge bases, and machine-local preferences never enter a sync payload.
- Invalid protocol versions, paths, revisions, signatures, nonces, ciphertext, sizes, cursors, and key epochs fail closed.

## Threat model

### In scope

- Passive or active network attackers.
- A malicious or compromised sync service, database, backup system, log pipeline, or operator.
- Forged, replayed, reordered, truncated, malformed, and oversized responses.
- A stolen device credential or a device revoked after compromise.
- Concurrent edits, deletions, delayed clients, interrupted writes, and server restarts.
- Attempts to escape `~/.reglet`, synchronize excluded local state, or trigger provider writes.

### Limits

- A device that is currently authorized can read and modify the synchronized Master. End-to-end encryption does not protect against that device or malware running as its user.
- Revocation cannot erase plaintext or keys already obtained by a device. It protects future epochs after healthy devices rotate keys and re-encrypt current objects.
- The service observes account, vault and device identifiers; ciphertext and request sizes; sequence and timing information; IP-level network metadata; and revocation activity.
- A permanently malicious service can withhold new changes. Monotonic checkpoints detect rollback relative to state a device has already observed, but complete split-view detection requires devices to compare a checkpoint through an authenticated out-of-band channel.
- Reglet cannot recover an encryption key that the user has neither retained on an authorized device nor exported through the optional recovery flow.

## Cryptographic construction

Implementation must use an audited, maintained library with identical test vectors across TypeScript/Bun and Rust. No custom primitive implementations are permitted.

- Content encryption: XChaCha20-Poly1305 with a unique random 192-bit nonce for every envelope.
- Key derivation: HKDF-SHA-256 with distinct, versioned context strings.
- Opaque object identifiers: HMAC-SHA-256 over the canonical Master path with the current epoch's index key, encoded as base64url.
- Device agreement keys: X25519.
- Device authorization and commit signatures: Ed25519.
- Random keys and nonces: operating-system cryptographically secure random source only.

Before implementation, a security review must confirm library choice, nonce generation, envelope encoding, key zeroization constraints, and cross-runtime behavior. Algorithm or encoding changes require a new protocol suite identifier, not an in-place reinterpretation.

## Keys and storage

Each vault has a random root secret and numbered key epochs. HKDF derives separate content, object-index, and wrapping contexts. Domain separation includes the protocol version, suite, vault identifier, and epoch.

Each device generates an X25519 agreement key pair and Ed25519 signing key pair locally. Private keys, the current vault keys, recovery material, and server device token live in the platform credential store. `~/.reglet/.state` contains only non-secret identifiers, cursors, revisions, conflict state, and checkpoint digests, written atomically with owner-only permissions.

Account passwords are used only for rate-limited server authentication through a versioned asynchronous memory-hard password hash. They do not encrypt vault keys. A password reset therefore does not recover synchronized content.

## Authenticated pairing

1. The new device creates both key pairs locally and requests a short-lived, single-use pairing session.
2. The existing device retrieves the pending public keys and both devices display or scan an authenticated transcript containing the vault, session, and both device public keys.
3. The user compares a short authentication string or scans a QR code directly between the devices. The server-provided pair code alone is not proof of key identity.
4. After confirmation, the existing device signs a device authorization certificate and encrypts the current vault keys to the new X25519 public key. The envelope binds the new device identifier, both public keys, vault, epoch, expiry, and pairing-session identifier.
5. The new device verifies the transcript and signature before accepting keys. The server atomically consumes the session and cannot substitute a public key without changing the user-verified transcript.

Pair attempts are short-lived, single-use, rate-limited, and auditable without logging codes or key material. A pairing flow may be cancelled from either device.

## Object model

The service stores an envelope with these authenticated routing fields:

```text
protocolVersion, suite, vaultId, objectId, keyEpoch,
revision, sequence, authorDeviceId, nonce, ciphertext,
previousCheckpoint, idempotencyKey, signature
```

Authenticated plaintext inside `ciphertext` contains:

```text
schemaVersion, canonicalPath, contentKind, deleted,
contentBytes, contentHash, createdAt
```

The routing fields through `idempotencyKey` are canonical additional authenticated data. The author signs the canonical envelope digest. Decryption, AEAD verification, device authorization, signature verification, size checks, revision checks, and canonical path validation all complete before a path is resolved locally.

Allowed content is limited to shared and provider-scoped rules, Skills, MCP definitions, and tombstones. Enrollment and machine-local configuration do not sync. The shared path contract rejects absolute paths, traversal, backslashes, empty or dot segments, control characters, unknown provider scopes, `.state`, provider output, and local conflict/backup artifacts.

## Revisions, checkpoints, and concurrency

- A write supplies the last observed object revision and vault checkpoint. Revision comparison, sequence allocation, envelope persistence, checkpoint update, and history insertion are one transaction.
- Each mutation has a random idempotency key scoped to its author device. Retrying the same mutation returns its existing result.
- Concurrent writes to the same base yield one winner and one conflict; the service never selects content or performs a merge.
- Change feeds use stable, bounded cursors. Clients validate strictly increasing sequences and loop over bounded pages.
- Devices persist the latest verified checkpoint atomically. A response older than that checkpoint is a rollback error.
- Checkpoints form an author-signed hash chain. This exposes later accidental forks when devices exchange history, but does not by itself defeat a service that maintains permanent isolated views.

## Pull and conflict behavior

After validating and decrypting a page, the client compares each object with its private merge base:

- Remote-only change: update the Master draft and report it in the preview result. A durable first-class sync receipt remains a public-release gate.
- Non-overlapping text changes: produce a merged Master draft and require local review.
- Overlapping edits, edit/delete, or delete/edit: preserve the local choice, write the remote choice to a local-only conflict artifact, and mark the path blocked.
- Malformed or inconsistent data: stop before mutation and retain the prior cursor.

A blocked path is never automatically uploaded or deleted. Removing the conflict artifact explicitly selects the retained local side; replacing the local file with the conflict artifact selects the remote side. The desktop must present these as named resolution actions before sync is public.

Every successful pull reports that provider review is required when it changes or conflicts with the Master. Review & Apply remains a separate digest-backed local transaction.

## Device revocation and key rotation

Revocation immediately invalidates the server device token and rejects future reads and writes from that device. A healthy device then creates a new vault epoch, new content and index keys, wraps them only to remaining devices, and re-encrypts current objects and tombstones under new opaque identifiers.

History from old epochs is retained only according to the published recovery policy and remains readable to a device that already possessed those epoch keys. The UI must state this limitation rather than implying retroactive erasure.

Device lifecycle must include list, name, created/last-seen time, rename, token rotation, revoke, local logout, pairing cancellation, and expired-session cleanup. Revoking the current device requires an explicit destructive confirmation and removes its local credentials after the server acknowledges the request.

## Recovery

Reglet offers an optional offline recovery package containing the vault root material, protocol/suite identifiers, and a checksum, encrypted by a high-entropy recovery code. It is never uploaded with the synchronized vault. Creation and verification require an explicit user action and a restore drill.

Without a healthy authorized device or valid recovery package, encrypted content is unrecoverable. Account support and password reset cannot bypass that boundary.

## Service requirements

TLS remains mandatory outside loopback even though content is encrypted. The service also requires:

- closed registration by default and no registration in single-user-token mode;
- hashed, rotatable, revocable device credentials;
- bounded request bodies, response pages, object count, object size, total storage, history, devices, and request rate;
- persistent/distributed rate limiting for hosted deployments and explicit trusted-proxy configuration;
- transactional storage, compatible migrations, backups, restore tests, corruption detection, and retention;
- secret-free structured logs, request IDs, audit events, health/readiness checks, and metrics;
- no plaintext paths, content, credentials, tokens, keys, decrypted errors, or recovery material in telemetry.

## Version negotiation and migration

Clients advertise supported protocol versions and suites. The server selects an exact mutually supported pair. Unknown fields in signed or encrypted canonical structures are rejected unless the selected schema explicitly permits them. Downgrade from a vault initialized on v2 is never allowed.

There is no server-side in-place conversion from plaintext protocol v1. A user must update a trusted device, create or unlock a v2 vault locally, upload newly encrypted objects, verify a second-device round trip, and then explicitly destroy v1 server data. Public builds ship with v1 account and sync entry points disabled.

## Implementation gates

- Independent cryptographic design review and published cross-runtime test vectors.
- Malicious-server tests for traversal, replay, rollback, fork discovery, bad signatures, modified AAD, nonce misuse detection, malformed ciphertext, oversized data, pagination, and downgrade.
- Device tests for authenticated pairing, cancellation, token rotation, revoke, epoch rotation, recovery import, and unrecoverable-key messaging.
- Two clean devices exchange edits and tombstones, preserve conflicts, and never write provider output during pull.
- Database and logs contain no recognizable Master path, content, environment value, password, bearer token, or key material.
