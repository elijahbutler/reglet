# Sync server development notes

The server in `packages/server` exercises the dormant plaintext protocol-v1 client. It is not a production service and must not be exposed to the internet or enabled in a public Reglet command or desktop control. Production sync requires the [protocol-v2 security design](sync-protocol-v2.md).

## Development modes

Single-user mode is the smallest local test configuration:

```bash
REGLET_TOKEN='replace-with-a-random-20-plus-character-token' \
REGLET_DB='./reglet.sqlite' \
bun packages/server/src/index.ts
```

`REGLET_TOKEN` must be at least 20 non-whitespace characters with basic diversity. Single-user mode cannot enable account registration.

Account registration is closed by default. `REGLET_ALLOW_REGISTRATION=1` opens the protocol-v1 registration endpoint only when single-user mode is off; this is for isolated development testing, not hosted use.

## Network boundary

Clients reject non-loopback HTTP. Any non-loopback development deployment must sit behind TLS. The application does not terminate TLS itself.

The in-process limiter ignores `X-Forwarded-For` by default. Set `REGLET_TRUST_PROXY=1` only when the server is reachable exclusively through a reverse proxy that removes inbound forwarding headers and writes the verified client address. This limiter is process-local and is not suitable for a multi-process or hosted deployment.

## Current safeguards

- Shared strict allowlist for Master paths on client and server.
- Bounded request bodies and paginated change responses.
- Transactional revision/sequence/history writes and atomic pair-code claims.
- Hashed bearer credentials, asynchronous password hashing, closed registration, device list/rename/token rotation/revoke, and last-seen timestamps.
- SQLite foreign keys, WAL, busy timeout, and indexed change/session lookups.
- No remote provider apply; pulls affect only the local Master draft and conflict artifacts.

## Known non-production limits

- Master paths and content are plaintext in SQLite and history.
- Device tokens are not yet stored in the platform credential store by clients.
- Pairing is not cryptographically bound to device identity.
- Rate limiting is in-memory; quotas, structured audit logs, readiness, backup/restore drills, history retention, and hosted-store support are absent.
- Device-list pagination, logout, recovery keys, key epochs, and end-to-end encryption are absent.

Treat any protocol-v1 database as disposable sensitive test data. Do not migrate it server-side into protocol v2; re-encrypt from a trusted client and explicitly destroy the v1 data after verification.
