# Reglet

![Reglet engineering control plane banner](docs/assets/reglet-banner.svg)

Reglet is a local-only CLI, with retained Swift macOS manager source and a cross-platform Tauri desktop manager under parity development, for global AI-agent rules, skills, and MCP configurations. It keeps one versionable master directory, renders it to the six supported providers, makes every provider write reviewable, and retains recovery data indefinitely.

Public V1 has no account, device-linking, remote configuration, background network transfer, or network management commands. Its configuration path stays on the current machine. Desktop update checks are manual unless a user explicitly opts into automatic checks. macOS desktop artifacts are ad-hoc signed and unnotarized; Windows artifacts are unsigned. Linux GUI artifacts are deferred.

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

Protocol v2 is available as an explicitly gated, CLI-only preview for a personal homeserver and devices you control. It is not ready for production or multi-tenant use: automatic key rotation after device revocation and offline key recovery are not implemented yet. Keep an independent copy of your Reglet Master and verified server backups while testing.

The homeserver is an encrypted relay and device registry, not a central editor. It stores authenticated ciphertext and cannot read or apply your rules, skills, or MCP definitions. Each authorized Mac or Windows device remains an equal Reglet manager:

1. Import, adopt, or edit content in that device's local Reglet Master.
2. Run `reglet sync run` to exchange encrypted changes with the server.
3. On another device, run sync, review a new structured plan, and apply it to that device's enrolled providers.

Authorized clients can approve, list, rename, and revoke devices. TLS, upgrades, SQLite backups, and restore checks are administered on the homeserver. There is intentionally no browser-based server control panel in this preview.

### Requirements

- Docker with Compose on the homeserver.
- A DNS name with an HTTPS reverse proxy. Clients reject non-loopback HTTP.
- Preview clients built from the same checkout. The commands are hidden unless `REGLET_EXPERIMENTAL_SYNC=1` is set.

The included Compose deployment binds Reglet to `127.0.0.1:3100`, disables registration and legacy protocol v1, runs as an unprivileged user with a read-only root filesystem, and persists SQLite in a named Docker volume. Only the HTTPS reverse proxy should be exposed to the network.

### Start the server

From a Reglet checkout on the homeserver:

```bash
cd deploy/homeserver
cp .env.example .env
chmod 600 .env
mkdir -p backups
chmod 700 backups
openssl rand -base64 36
```

Paste the generated random value into `REGLET_BOOTSTRAP_TOKEN` in `.env`. Keep `REGLET_BIND_PORT=3100` unless it conflicts with another loopback service, then build and start the container:

```bash
docker compose up -d --build
docker compose ps
```

Point an HTTPS reverse proxy at `127.0.0.1:3100`. Replace `sync.example.com` in [Caddyfile.example](deploy/homeserver/Caddyfile.example) with your DNS name and add it to your Caddy configuration. Do not publish port 3100 directly.

Verify the public TLS endpoint:

```bash
curl --fail https://sync.example.com/readyz
curl --fail https://sync.example.com/v2/compatibility
```

The compatibility response must report protocol `2` and suite `reglet-xchacha20poly1305-ed25519-x25519-hkdfsha256-v1`.

### Connect the first device

Build preview clients from the repository root with `bun install --frozen-lockfile && bun run build:binaries`, then use the binary matching each device. Transfer the bootstrap token to the first Mac through a secure channel:

```bash
export REGLET_EXPERIMENTAL_SYNC=1
export REGLET_BOOTSTRAP_TOKEN='<random value from the server .env>'
reglet sync bootstrap --server https://sync.example.com --device-name 'MacBook'
unset REGLET_BOOTSTRAP_TOKEN
```

After bootstrap succeeds, remove the `REGLET_BOOTSTRAP_TOKEN` value from the homeserver `.env` and recreate the container. The stored token hash continues to authorize the first device; the plaintext bootstrap secret is no longer needed.

```bash
docker compose up -d --force-recreate
```

To add another Mac or Windows PC, create a pairing request on the new device, approve its short code on an authorized device, and compare the complete fingerprint before accepting it. See the [homeserver runbook](docs/sync-server.md#pair-a-windows-pc) for the exact pairing commands and security checks.

### Sync skills and agent instructions

A change is imported on whichever device owns it, encrypted to the server, then reviewed locally on every receiving device. For example, on Windows:

```powershell
$env:REGLET_EXPERIMENTAL_SYNC = "1"
reglet.exe skills unmanaged
reglet.exe skills adopt codex my-skill --scope shared
reglet.exe import codex:rules
reglet.exe sync run
```

On the Mac:

```bash
export REGLET_EXPERIMENTAL_SYNC=1
reglet sync run
reglet apply-structured preview --provider claude codex --content rules skills
reglet apply-structured apply --digest <reviewed-digest> --provider claude codex --content rules skills
```

This flow can move a newly adopted skill or imported Codex `AGENTS.md` from Windows to the Mac without giving the server plaintext access. Sync changes only the receiving Master; provider files remain untouched until Review & Apply succeeds. Enrollment, provider outputs, resolved MCP secrets, credentials, receipts, conflicts, and machine-local `reglet.toml` settings do not sync.

### Back up and upgrade

SQLite data lives in the `reglet-data` Docker volume. Verified online backups are written to `deploy/homeserver/backups`:

```bash
docker compose exec reglet-sync \
  bun packages/server/src/admin.ts backup /backups/reglet-$(date +%Y%m%d-%H%M%S).sqlite
docker compose exec reglet-sync bun packages/server/src/admin.ts check
```

Create and verify a backup before upgrading, update the checkout, then rebuild the service and recheck readiness:

```bash
docker compose up -d --build
curl --fail https://sync.example.com/readyz
```

The detailed [encrypted sync preview and homeserver runbook](docs/sync-server.md) covers pairing, device management, conflicts, backup verification, restore boundaries, and troubleshooting. The [protocol v2 security design](docs/sync-protocol-v2.md) documents the threat model and remaining release gates.

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
