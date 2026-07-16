# Reglet

![Reglet engineering control plane banner](docs/assets/reglet-banner.svg)

Reglet is a local-only CLI, with retained Swift macOS manager source and a cross-platform Tauri desktop manager under parity development, for global AI-agent rules, skills, and MCP configurations. It keeps one versionable master directory, renders it to the six supported providers, makes every provider write reviewable, and retains recovery data indefinitely.

The default Public V1 CLI has no account, device-linking, remote configuration, background network transfer, or network management commands. Its configuration path stays on the current machine. Encrypted sync is separate, explicitly gated desktop preview functionality for personal self-hosted testing. Desktop update checks are manual unless a user explicitly opts into automatic checks. macOS desktop artifacts are ad-hoc signed and unnotarized; Windows artifacts are unsigned. Linux GUI artifacts are deferred.

```text
~/.reglet/                 provider outputs
  rules/*.md        -+     ~/.claude/CLAUDE.md
  skills/*/          +-->  ~/.codex/AGENTS.md
  mcp/servers.json  -+     ~/.cursor/mcp.json
  reglet.toml              ~/.gemini/settings.json
  .state/                  recovery journals and receipts
```

## What V1 provides

- Rules, shared skills, provider-scoped skills, and managed MCP entries for Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, and OpenCode.
- Retained native macOS manager source, frozen during Tauri parity, plus a Tauri desktop manager with Providers, Rules, Skills, MCP, Activity & Drift, and Recovery screens.
- A gated encrypted sync preview for personal self-hosted desktop testing, with a same-origin owner dashboard, first-device approval, trusted-device pairing, manual sync, device access controls, server health checks, and verified SQLite backups.
- Digest-backed Review & Apply plans with exact redacted diffs, drift checks, durable operation receipts, and explicit receipt restore.
- Typed local MCP environment references. Raw credential strings are invalid and are never copied into previews, logs, diagnostics, journals, or receipts.
- Owner-only Reglet state, journal, and snapshot permissions (`0700` directories and `0600` files).

## Install

Install the public CLI release with Homebrew on macOS:

```bash
brew tap elijahbutler/reglet
brew install elijahbutler/reglet/reglet
```

If you installed 0.1.6 as `brew install --cask reglet`, it is a legacy app cask and cannot upgrade itself into the formula. Follow the [cask migration steps](docs/installation.md#migrate-from-the-016-app-cask) after the first CLI-only release is published.

Or download the matching CLI binary from the GitHub Release. Use `reglet-darwin-arm64` on Apple silicon, `reglet-darwin-x64` on Intel Macs, or `reglet-windows-x64.exe` on Windows x64. Ad-hoc-signed/unnotarized macOS and unsigned Windows desktop artifacts are also published; expect Gatekeeper or SmartScreen warnings. Linux GUI packaging is prepared but not published yet.

```bash
# macOS: choose the matching architecture
chmod +x reglet-darwin-arm64
./reglet-darwin-arm64 --version

# Windows PowerShell
.\reglet-windows-x64.exe --version
```

See [installation](docs/installation.md) for release verification and source setup.

## Safe workflow

```bash
# Inspect local providers without changing files.
reglet scan

# Create the master directory and select scopes to manage.
reglet init

# Produce the exact, redacted transaction plan.
reglet apply-structured preview --provider claude codex --content rules mcp

# Apply only the still-current reviewed plan.
reglet apply-structured apply --digest <digest> --provider claude codex --content rules mcp

# Inspect operation receipts and explicitly restore one if needed.
reglet operations list
reglet operations show <receipt-id>
reglet operations restore <receipt-id>
```

Plain `reglet apply` remains suitable for automation, but refuses to replace detected provider drift unless the caller explicitly supplies `--reviewed-replacement`.

## MCP environment references

Canonical MCP definitions contain named process-environment references rather than credential values:

```json
{
  "mcpServers": {
    "example": {
      "command": "node",
      "env": {
        "TOKEN": { "source": "process-env", "name": "LOCAL_TOKEN" }
      }
    }
  }
}
```

Reglet resolves a reference only in memory while rendering a provider output. A missing variable blocks the plan. Resolved values are redacted from review output and persisted state.

## Recovery and lifecycle

Every changed file or directory is snapshotted before replacement. A journal is recovered before another mutation is allowed; an interrupted or failed multi-provider operation rolls its writes back together.

`reglet unenroll provider[:rules|skills|mcp]` stops managing the selected scope while preserving its current provider content. When detaching rules, Reglet removes its generated header. Destructive removal is available only through explicit recovery actions.

If an older installation left pre-V1 network state behind, it is inert and never read for credentials or network access. Inspect paths only with `reglet state legacy-network-status`, then explicitly remove it with `reglet state clear-legacy-network-state`.

## Self-host the encrypted sync preview

Protocol v2 is an explicitly gated desktop preview for a personal homeserver and devices you control. It is not ready for production, teams, hosted administration, or multi-tenant use: automatic key rotation after revocation and offline key recovery are not implemented. Keep an independent copy of the Reglet Master and verified server backups while testing.

The homeserver is an encrypted relay and device registry, not a central editor. It stores authenticated ciphertext and cannot read or apply your rules, skills, or MCP definitions. Each authorized Mac or Windows device remains an equal Reglet manager:

1. Import, adopt, or edit content in that device's local Reglet Master.
2. Use **Sync now** to exchange encrypted changes with the server.
3. On another device, sync, review a new structured plan, and apply it to that device's enrolled providers.

The same-origin owner dashboard handles first-device approval, device access, host health, and verified SQLite backups. It cannot read content, transfer vault keys, or approve later-device encryption membership; a trusted Reglet device must approve every later device.

### Requirements

- Docker with Compose on the homeserver.
- A DNS name with an HTTPS reverse proxy. Clients reject non-loopback HTTP.
- Matching Preview desktop builds on macOS or Windows.

The included Compose deployment binds Reglet to `127.0.0.1:3100`, disables registration and legacy protocol v1, runs as an unprivileged user with a read-only root filesystem, and persists SQLite in a named Docker volume. Only the HTTPS reverse proxy should be exposed to the network.

### Start the server

Deploy from a tagged Reglet release or a checkout you trust. When deploying from source, pin the checkout to the release you intend to run before building the container:

```bash
git fetch --tags
git checkout v0.1.18
```

Then prepare the homeserver environment:

```bash
cd deploy/homeserver
cp .env.example .env
chmod 600 .env
mkdir -p backups
chmod 700 backups
```

Set `REGLET_PUBLIC_URL=https://sync.example.com` in `.env`. It must be the exact public HTTPS origin that clients and the dashboard use. Keep `REGLET_BOOTSTRAP_TOKEN` empty on new servers; it remains compatibility-only for servers bootstrapped by an older preview client. Then build and start the container:

```bash
docker compose up -d --build
docker compose ps
docker compose logs reglet-sync
```

Point an HTTPS reverse proxy at `127.0.0.1:3100`. Replace `sync.example.com` in [Caddyfile.example](deploy/homeserver/Caddyfile.example) with your DNS name and add it to your Caddy configuration. Do not publish port 3100 directly; the Compose file intentionally binds the service to loopback.

Verify the public TLS endpoint:

```bash
curl --fail https://sync.example.com/readyz
curl --fail https://sync.example.com/v2/compatibility
```

The first startup log contains one expiring owner claim link. Open it directly and set the single owner account. After claiming, use `/admin` for sign-in, device access, health, integrity, and backups. The compatibility response must report protocol `2` and suite `reglet-xchacha20poly1305-ed25519-x25519-hkdfsha256-v1`.

### Connect the first device

Open `/admin`, create a device invitation, and open or paste it in the desktop **Sync** section. Compare the desktop and dashboard fingerprints before approving. Reglet generates and stores the vault keys and independent device credential locally. Do not approve the request if the fingerprints differ.

Later devices can join with a link/QR invitation from an authorized desktop or request an eight-character code from the server. In both cases, a trusted Reglet device must inspect and approve the request, and the new device must confirm the matching fingerprint.

Sync can move a newly adopted skill or imported Codex `AGENTS.md` from Windows to a Mac without giving the server plaintext access. Sync changes only the receiving Master; provider files remain untouched until Review & Apply succeeds. Enrollment, provider outputs, resolved MCP secrets, credentials, receipts, conflicts, and machine-local `reglet.toml` settings do not sync.

### Back up and upgrade

SQLite data lives in the `reglet-data` Docker volume. The dashboard serializes backup jobs, writes server-chosen files to `deploy/homeserver/backups`, verifies them with `quick_check`, lists verification status, and can check the live database. Equivalent host commands are:

```bash
docker compose exec reglet-sync \
  bun packages/server/src/admin.ts backup /backups/reglet-$(date +%Y%m%d-%H%M%S).sqlite
docker compose exec reglet-sync bun packages/server/src/admin.ts check
```

Create and verify a backup before upgrading. Then move the checkout to the new release tag, recreate the service, and recheck readiness:

```bash
git fetch --tags
git checkout v0.1.18
docker compose build --pull reglet-sync
docker compose up -d --force-recreate reglet-sync
curl --fail https://sync.example.com/readyz
```

The detailed [encrypted sync preview and homeserver runbook](docs/sync-server.md) covers Compose and Coolify deployment, owner claiming, both pairing paths, revocation limits, backup verification, existing-server upgrades, and offline restore. The [protocol v2 security design](docs/sync-protocol-v2.md) documents the threat model and remaining release gates.

## Documentation

- [Installation](docs/installation.md)
- [Usage](docs/usage.md)
- [Architecture](docs/architecture.md)
- [Providers](docs/providers.md)
- [Recovery](docs/recovery.md)
- [Privacy and network behavior](docs/privacy.md)
- [Security reporting](SECURITY.md)
- [Release verification](docs/release.md)
- [Release notes](docs/release-notes.md)
- [Roadmap](ROADMAP.md)
- [Proposed end-to-end encrypted sync protocol](docs/sync-protocol-v2.md)
- [Encrypted sync preview and homeserver runbook](docs/sync-server.md)

## Development

```bash
bun install --frozen-lockfile
bun run test
bun run typecheck
bun run lint
swift test --package-path apps/macos/RegletSetup
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## License

MIT
