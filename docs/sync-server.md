# Encrypted sync preview and homeserver runbook

Protocol v2 is ready for a constrained two-device homeserver test. It is an opt-in CLI preview, not a production or multi-tenant service. The desktop UI and public release capability remain disabled.

## Product model

The server is an encrypted relay and device registry. It is not the canonical editor and cannot read or apply Reglet content.

Every paired Mac or Windows device is an equal Reglet manager:

1. The device imports, adopts, or edits local content into its own Reglet Master.
2. `reglet sync run` uploads authenticated ciphertext only.
3. Another device manually pulls the encrypted changes into its local Master.
4. That device reviews a fresh structured plan before applying anything to its local providers.

Any authorized device can approve a new device, list devices, rename them, and revoke a remote device. Content management does not have to happen on the server. The server has no content-editing API by design.

Operational administration—TLS, upgrades, backup, restore, and database checks—stays on the homeserver. Device-registry administration happens from any authorized client; there is intentionally no browser-based server control panel in this preview.

For example, a Windows PC can adopt a provider-local skill and push it; a Mac can then pull the skill, review it, and apply it to whichever Mac providers are enrolled. `AGENTS.md` follows the same path through Reglet rules: import it into the Windows Master, sync, then review and apply it on the Mac.

Machine-local enrollment and server settings in `reglet.toml` do not sync. Provider outputs, resolved environment values, receipts, snapshots, merge bases, conflicts, and credentials also remain local.

## What is implemented

- XChaCha20-Poly1305 object encryption with random 192-bit nonces.
- HKDF-separated content and opaque path-index keys.
- Ed25519 device certificates and object signatures.
- X25519 pairing-key transport with a fingerprint compared on both devices.
- OS credential storage: macOS Keychain and Windows Credential Manager.
- Opaque server object identifiers; plaintext Master paths and contents never enter protocol-v2 tables.
- Signed checkpoint chains, optimistic revisions, idempotency keys, nonce-reuse rejection, bounded requests, bounded pages, and object/device/history quotas.
- Manual rules, Skills, provider-scoped Skills, shared MCP, and provider-scoped MCP sync.
- Tombstones, three-way text merge, local conflict artifacts, and no provider apply during pull.
- Device listing, rename, server-access revocation, last-seen timestamps, and paginated device lists.
- Closed registration, legacy `/v1` disabled in the server process, forward-version refusal, readiness checks, verified SQLite backups, and a hardened single-node container.

## Preview limits

Use this only for personal testing with devices and a homeserver you control:

- Device revocation blocks server access immediately, but automatic epoch rotation and re-encryption are not implemented. A previously authorized device that retained the epoch key could decrypt later ciphertext if it obtained that ciphertext elsewhere.
- Offline recovery packages are not implemented. Losing every authorized device loses the encryption keys permanently.
- Rate limiting is process-local. There are no hosted-service metrics, persistent audit events, automated retention, restore rehearsals, or horizontal-store support.
- Sync is manual and CLI-only. There is no background sync or desktop device UI.
- Release binaries and the server image are not yet signed release artifacts.

Keep another copy of the Master and a verified database backup while testing.

## Build preview clients

The preview is source-gated and does not yet have signed release artifacts. From this checkout on the Mac, build the matching Mac client and the Windows x64 client, then transfer the Windows executable through a trusted channel:

```bash
bun install --frozen-lockfile
bun run build:binaries
shasum -a 256 dist/reglet-darwin-* dist/reglet-windows-x64.exe
```

Use the binary matching the Mac architecture as `reglet`. On Windows, confirm the transferred hash with `Get-FileHash .\reglet-windows-x64.exe -Algorithm SHA256`, then use it as `reglet.exe` in the examples below. These binaries are suitable for this controlled preview only; they are not signed or notarized release artifacts.

## Homeserver deployment

Requirements:

- Docker with Compose.
- A DNS name and HTTPS reverse proxy. Reglet clients reject non-loopback HTTP.
- The server port must remain bound to loopback; expose only the TLS proxy.

Prepare the preview:

```bash
cd deploy/homeserver
cp .env.example .env
chmod 600 .env
mkdir -p backups
chmod 700 backups
openssl rand -base64 36
```

Put the generated value in `REGLET_BOOTSTRAP_TOKEN` in `.env`, then start the service:

```bash
docker compose up -d --build
docker compose ps
```

The Compose file binds the service to `127.0.0.1:3100`, drops Linux capabilities, uses a read-only root filesystem, runs as the unprivileged `bun` user, disables registration and protocol v1, and persists SQLite in a named volume.

Point an existing reverse proxy at `127.0.0.1:3100`. [Caddyfile.example](../deploy/homeserver/Caddyfile.example) shows the minimal Caddy configuration. Do not publish port 3100 directly.

Verify the TLS boundary:

```bash
curl --fail https://sync.example.com/readyz
curl --fail https://sync.example.com/v2/compatibility
```

The compatibility response must report protocol `2` and the `reglet-xchacha20poly1305-ed25519-x25519-hkdfsha256-v1` suite.

### Bootstrap the first Mac

Preview commands exist only when the explicit environment gate is set. Transfer the one-time bootstrap token to the first Mac through a secure channel, then run:

```bash
export REGLET_EXPERIMENTAL_SYNC=1
export REGLET_BOOTSTRAP_TOKEN='<the generated value>'
reglet sync bootstrap --server https://sync.example.com --device-name 'MacBook'
unset REGLET_BOOTSTRAP_TOKEN
```

Bootstrap is idempotent, so the same command and token can be retried after an interrupted response. The device token and vault keys are stored in macOS Keychain; `.state/sync-v2.json` contains only non-secret identifiers and cursors.

After bootstrap succeeds, clear `REGLET_BOOTSTRAP_TOKEN` in the homeserver `.env` and recreate the container:

```bash
docker compose up -d --force-recreate
```

The stored token hash continues to authorize the Mac; the plaintext bootstrap token no longer needs to exist on the server.

### Pair a Windows PC

On Windows PowerShell:

```powershell
$env:REGLET_EXPERIMENTAL_SYNC = "1"
reglet.exe sync pair --server https://sync.example.com --device-name "Windows PC"
```

On the already authorized Mac, approve the printed eight-character code:

```bash
reglet sync approve ABCD1234
```

The Mac prints a six-group fingerprint. On Windows:

```powershell
reglet.exe sync pair-status
reglet.exe sync pair-complete --sas "THE SIX GROUP FINGERPRINT"
```

Do not complete pairing unless the fingerprint shown on Windows exactly matches the Mac through a channel you trust. The server pair code alone is not proof of device identity.

Either device can now inspect the signed registry:

```bash
reglet sync devices
reglet sync rename-device <device-id> 'New name'
```

Revocation is available for a lost test device, but reports `key-rotation-required` because epoch rotation is a remaining production gate:

```bash
reglet sync revoke-device <device-id>
```

## Windows-to-Mac content flow

For a new provider-local Windows skill:

```powershell
reglet.exe skills unmanaged
reglet.exe skills adopt codex my-skill --scope shared
reglet.exe sync run
```

For a changed Windows Codex `AGENTS.md`:

```powershell
reglet.exe import codex:rules
reglet.exe sync run
```

On the Mac:

```bash
reglet sync run
reglet skills list
reglet apply-structured preview --provider claude codex --content rules skills
reglet apply-structured apply --digest <reviewed-digest> --provider claude codex --content rules skills
```

The pull changes only the Mac Master. Provider files do not change until the digest-backed apply command succeeds. If both devices edited the same content, Reglet retains the local choice and creates a named `.conflict-<device>` artifact for manual resolution. Merge the chosen content into the canonical Master file, delete the conflict artifact, review the result, and run sync again.

## Backup and integrity checks

Create an online SQLite backup and verify it before reporting success:

```bash
docker compose exec reglet-sync \
  bun packages/server/src/admin.ts backup /backups/reglet-$(date +%Y%m%d-%H%M%S).sqlite
```

Backups appear in `deploy/homeserver/backups`. Check either the live database or a backup:

```bash
docker compose exec reglet-sync bun packages/server/src/admin.ts check
docker compose run --rm -e REGLET_DB=/backups/<backup.sqlite> \
  reglet-sync bun packages/server/src/admin.ts check
```

A production release still requires a documented restore rehearsal. For the preview, stop the service before replacing the named-volume database, retain the old database and WAL files, start the service, and require `/readyz` plus a two-device round trip before deleting the old copy.

## Troubleshooting boundary

- `Encrypted sync request failed: 404`: verify the server process has protocol v2 and the reverse proxy is reaching this container.
- `requires HTTPS`: use the TLS hostname, not the homeserver LAN IP over HTTP.
- `pairing has not been approved`: approve the current code before its ten-minute expiry.
- Fingerprints differ: stop. Cancel/logout the pending device and create a new request.
- `changed on another device while uploading`: run sync again. Reglet retained local content and will pull the competing change first.
- A pull reports `provider-apply=required`: review the Master and use structured preview/apply; this is expected.
