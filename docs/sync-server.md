# Encrypted sync preview homeserver

Reglet encrypted sync is an opt-in desktop preview for a personal, single-owner homeserver. The server relays authenticated ciphertext and tracks device access. Vault keys, plaintext Master content, provider configuration, and resolved MCP secrets remain device-only.

Sync remains manual. A pull changes the local Reglet Master, never provider files; use local Review & Apply before changing provider destinations.

## Security and recovery boundary

- The owner dashboard can claim the server, inspect health, create connection grants, rename or revoke device access, and create verified database backups.
- The dashboard cannot decrypt content, transfer vault keys, or approve a later device into the encrypted vault. A trusted Reglet device must approve every later device.
- Device revocation blocks future server access. Automatic epoch rotation and re-encryption are not implemented, so rotate-and-reencrypt remains a production gate.
- Losing every authorized device loses the vault keys. Backups preserve ciphertext and registry state, not offline key recovery.
- Live restore, Docker control, Coolify credentials, background sync, teams, OIDC, and hosted administration are not part of this preview.

Keep another copy of the Reglet Master and periodically rehearse an offline restore from a verified backup.

## Compose deployment

Requirements:

- Docker with Compose.
- A public DNS name behind an HTTPS reverse proxy. Clients reject non-loopback HTTP.
- A private loopback binding between the proxy and Reglet.

Prepare the deployment:

```bash
cd deploy/homeserver
cp .env.example .env
chmod 600 .env
mkdir -p backups
chmod 700 backups
```

Set the canonical public origin in `.env`:

```dotenv
REGLET_PUBLIC_URL=https://sync.example.com
REGLET_BIND_PORT=3100
REGLET_BOOTSTRAP_TOKEN=
```

`REGLET_PUBLIC_URL` must be the exact external HTTPS origin. It is used for secure same-origin owner sessions, CSRF checks, claim links, and connection invitations.

Start the service and inspect its logs once:

```bash
docker compose up -d --build
docker compose logs reglet-sync
```

The first startup prints one expiring `https://.../admin#claim=...` link. Open it directly, set the single owner email and password, then discard the link. It is single-use. If owner access is lost, generate a new one-time reset link inside the container:

```bash
docker compose exec reglet-sync bun packages/server/src/admin.ts owner-reset-link
```

The service runs without root capabilities, keeps its root filesystem read-only, persists SQLite in `reglet-data`, writes backups only under the mounted `/backups` directory, and serves the locally bundled dashboard at `/admin`.

Point the TLS proxy at `127.0.0.1:3100`; do not expose that port publicly. Verify:

```bash
curl --fail https://sync.example.com/readyz
curl --fail https://sync.example.com/v2/compatibility
```

## Connect the first device

1. Open `https://sync.example.com/admin` and choose **Add device**.
2. Open or paste the invitation in the desktop **Sync** section.
3. Reglet generates the vault, device keys, and an independent device credential locally.
4. Compare the fingerprint in the desktop and owner dashboard.
5. Approve in the dashboard, confirm the matching fingerprint in the desktop, and finish the connection.

An interrupted request can be retried with the same invitation. Reglet preserves the pending identity in the operating-system credential store so the fingerprint remains stable. Never approve when the fingerprints differ.

## Add later devices

Later devices have two supported paths. Both require approval from a trusted Reglet device, not the dashboard.

### Invitation link or QR

On a connected device, open **Sync**, choose **Add device**, and share the expiring link or QR code. Open it on the new device, compare the displayed fingerprint, then approve the request on a connected device.

### Eight-character request code

On the new device, select **Request a code**, enter the server URL and device name, and submit. On a connected device, enter that eight-character code in **Approve by code**. Complete only after both devices display the same fingerprint.

Connection grants and codes expire after ten minutes. Pending requests can be cancelled from the requesting device. The server binds an invitation to one request and rejects expiry, cancellation, replay, and identity substitution.

## Manual sync and local review

Use **Sync now** on each device. The result reports pulled, pushed, merged, deleted, and conflicted paths. When pulled content requires provider review, use **Review & Apply** to create a fresh digest-backed local plan.

No provider files are changed by sync, and no sync runs in the background. Closing the waiting connection screen stops its status polling.

## Devices and revocation

The desktop and owner dashboard show the same server device registry. A connected desktop can create invitations, approve codes, rename devices, revoke another device, and disconnect itself. The dashboard can list, rename, or revoke server access but cannot approve encrypted membership.

**Disconnect this device** revokes it remotely before deleting local credentials. **Remove locally only** is an explicit offline fallback and leaves the remote device authorized until it is revoked elsewhere.

After any revocation, Reglet keeps a visible key-rotation warning. Server access is blocked immediately, but a device may retain keys and ciphertext it already received.

## Backups and integrity

The dashboard **Host operations** section can:

- run `quick_check` against the live database;
- create a uniquely named SQLite snapshot in `REGLET_BACKUP_DIR`;
- list backup timestamp, size, and current verification state.

Backup jobs are serialized. The server chooses every filename, refuses symlinks and overwrites, and verifies each completed backup with `quick_check`. The routes accept no filesystem path, upload, or restore input.

The equivalent host commands remain available:

```bash
docker compose exec reglet-sync bun packages/server/src/admin.ts check
docker compose exec reglet-sync \
  bun packages/server/src/admin.ts backup /backups/reglet-$(date +%Y%m%d-%H%M%S).sqlite
```

Restore remains offline and operator-controlled:

1. Stop the service.
2. Preserve the current database plus any WAL/SHM files.
3. Replace the database from a verified backup without following symlinks.
4. Start the service and require `/readyz` to succeed.
5. Confirm the device registry and complete a two-device sync round trip before deleting the preserved copy.

## Upgrade an existing preview server

Before upgrading, create and verify a backup. Retain the existing data volume and public origin, update the checkout or image, then recreate the service:

```bash
docker compose build --pull reglet-sync
docker compose up -d --force-recreate reglet-sync
curl --fail https://sync.example.com/readyz
```

Migrations are additive and forward-version guarded. Existing encrypted objects, checkpoints, vault identity, device credentials, and token-bootstrapped devices remain valid without re-pairing.

`REGLET_BOOTSTRAP_TOKEN` is compatibility-only. An older server that was initialized with it may keep the value during the first upgrade. After an existing device successfully appears in the dashboard and completes a sync, clear the variable and recreate the container. New servers leave it empty and connect the first device through an owner-dashboard invitation.

## Coolify deployment

Use the repository Dockerfile `Dockerfile.sync` with persistent storage mounted at `/data` and `/backups`. Configure:

```dotenv
PORT=3000
REGLET_DB=/data/reglet.sqlite
REGLET_BACKUP_DIR=/backups
REGLET_PUBLIC_URL=https://sync.example.com
REGLET_ENABLE_LEGACY_V1=0
REGLET_ALLOW_REGISTRATION=0
REGLET_TRUST_PROXY=1
```

Expose port `3000` only through Coolify's HTTPS proxy. Mark both storage mounts persistent, enable the `/readyz` health check, and use Coolify's normal deploy/restart controls for upgrades.

Do not mount the Docker socket into Reglet and do not provide Coolify API credentials to the container. The dashboard intentionally provides health, access, integrity, and backup operations only. Read the first claim link from the application logs, then use `/admin` for ongoing owner access.

## Release status

The visible Preview label is intentional. macOS application artifacts are ad-hoc signed and unnotarized; Windows artifacts are unsigned and may trigger platform warnings. Validate release checksums before installation.
