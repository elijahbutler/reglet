# Mac onboarding sprint

Goal: make the first Reglet install feel safe and native on macOS while preserving the CLI as the auditable engine.

## Product stance

- First-run setup is product UI, not a marketing surface.
- The setup app should feel like a modern macOS 26/27 utility: native controls, SF Symbols, clear hierarchy, restrained color, and accessibility-respecting materials.
- No background behavior starts during install or onboarding. Daemon, sync, and notifications remain explicit opt-ins after the user understands the local file model.

## Sprint slices

### 1. CLI setup contract

Status: implemented.

- `reglet scan --json` reports provider detection, enrollment, inventory, and safety defaults.
- `reglet plan --json` reports selected onboarding reads/writes without touching provider files or `~/.reglet/`.
- JSON output is stable enough for a SwiftUI setup app to consume without scraping terminal text.

Acceptance:

- The commands work with `REGLET_HOME` and `REGLET_PROVIDER_HOME` sandbox overrides.
- Plan output includes exact provider paths, exact master paths, and safety defaults.
- Tests prove plan mode does not create import files.

### 2. Native setup app shell

Status: initial SwiftUI shell implemented in `apps/macos/RegletSetup`.

Build a small SwiftUI app that shells out to the installed `reglet` binary.

Screens:

- Welcome and safety contract.
- Provider scan with detected/missing states.
- Content selection for rules, skills, and MCP per provider.
- Individual skill selection before transferring provider skills into the unified directory.
- File preview grouped by read and write operations.
- Confirmation that creates backups and applies changes.
- Completion/status view with restore and revert actions.

Implementation notes:

- Keep provider logic in the CLI/core packages.
- Use `scan --json` and `plan --json` for read-only screens.
- Use explicit CLI commands for mutating actions.
- Treat command failures as first-class UI states with stderr and suggested recovery.

### 3. Installer packaging

Status: Homebrew CLI distribution is the active install path. The native `.pkg` path is blocked until Reglet has Apple Developer ID signing and notarization.

Create a trusted distribution path for macOS.

Requirements:

- Install the `reglet` binary.
- Install `Reglet Setup.app`.
- Do not install, load, or start `com.reglet.daemon`.
- Do not configure sync.
- Open the setup app after install only if the installer mechanism supports that without background persistence.

GitHub Release artifacts:

- `reglet-darwin-arm64`
- `reglet-darwin-x64`
- `reglet-windows-x64.exe`

Homebrew install:

```bash
brew tap elijahbutler/reglet
brew trust --formula elijahbutler/reglet/reglet
brew install reglet
```

Remaining production hardening:

- Developer ID signing and Apple notarization.
- Re-enable downloadable `.pkg` or `.dmg`.
- Optional `.dmg` presentation wrapper.

Required GitHub secrets for verified downloads:

- `HOMEBREW_TAP_TOKEN`: token with write access to `elijahbutler/homebrew-reglet` so releases can update `Formula/reglet.rb`.
- `APPLE_DEVELOPER_ID_APPLICATION_CERT_BASE64`: base64-encoded `.p12` for `Developer ID Application`.
- `APPLE_DEVELOPER_ID_APPLICATION_CERT_PASSWORD`: password for that `.p12`.
- `APPLE_DEVELOPER_ID_INSTALLER_CERT_BASE64`: base64-encoded `.p12` for `Developer ID Installer`.
- `APPLE_DEVELOPER_ID_INSTALLER_CERT_PASSWORD`: password for that `.p12`.
- `APPLE_BUILD_KEYCHAIN_PASSWORD`: temporary CI keychain password.
- `APPLE_NOTARY_KEY_BASE64`: base64-encoded App Store Connect API key `.p8`.
- `APPLE_NOTARY_KEY_ID`: App Store Connect API key ID.
- `APPLE_NOTARY_ISSUER_ID`: App Store Connect issuer UUID.

### 4. Restore and recovery

The Mac app must expose recovery without requiring command memory.

Actions:

- Show current enrollment and drift status.
- Run `reglet restore <provider>`.
- Run `reglet revert <provider>`.
- Link to the backup directory in `~/.reglet/.state/backups`.
- Explain that backups are made for managed provider paths before Reglet changes them; unrelated provider files are preserved in place and are not snapshotted.

### 5. Real-machine QA

Smoke matrix:

- Fresh Mac with no provider configs.
- Mac with Claude Code rules and skills.
- Mac with Codex rules and MCP config.
- Multiple providers selected.
- Existing Reglet master directory.
- Restore after first apply.
- Drift detection after hand-editing a generated provider file.
- Installer uninstall leaves no daemon or sync process running.

Release gate:

- Broader Mac user testing is blocked until this smoke matrix passes.
- CLI alpha testing can continue before this work is complete.
