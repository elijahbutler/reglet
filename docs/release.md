# Release integrity and V1 certification

## Artifact requirements

Public releases include standalone CLI binaries plus ad-hoc-signed/unnotarized macOS and unsigned Windows desktop artifacts. The desktop artifacts also have Tauri updater signatures, which authenticate in-app downloads independently of Apple Developer ID or Windows Authenticode signing. Linux GUI packaging is configured for `.deb` and AppImage, but Linux desktop artifacts are deferred until after macOS and Windows stabilize. Release automation fails unless it can:

1. run Bun, Tauri frontend, and Rust checks and tests;
2. build `reglet-darwin-arm64`, `reglet-darwin-x64`, and `reglet-windows-x64.exe`;
3. build ad-hoc-signed, unnotarized Tauri macOS desktop artifacts for Apple silicon and Intel Macs;
4. build unsigned Windows x64 NSIS/WebView2 desktop artifacts;
5. publish SHA-256 checksums and GitHub build provenance for all release artifacts;
6. generate the Homebrew formula and cask;
7. generate signed updater archives for macOS arm64, macOS x64, and Windows x64, then publish a matching `latest.json` manifest;
8. update `Formula/reglet.rb` and `Casks/reglet.rb` in `elijahbutler/homebrew-reglet` using `HOMEBREW_TAP_TOKEN`;
9. publish the GitHub Release only after the tap update succeeds.

`HOMEBREW_TAP_TOKEN` is a repository secret backed by a fine-grained token with **Contents: Read and write** access to `elijahbutler/homebrew-reglet`. If the secret is absent, cloning fails, committing fails, or pushing fails, the workflow fails and leaves the GitHub Release as a draft.

### Homebrew automation paths

Homebrew publication is centralized in `scripts/publish-homebrew-tap.sh` and is idempotent: rerunning it for the same version makes no new commit.

- The tag-driven `Release` workflow generates the formula and cask, publishes them to `elijahbutler/homebrew-reglet`, and only then makes the GitHub Release public. This preserves the Homebrew tap gate for normal releases.
- The `Homebrew Release` workflow listens for `release.published` so a release published manually or by another trusted integration also updates Homebrew from its four required macOS assets.
- `Homebrew Release` also supports a manual `workflow_dispatch` with an existing release tag for recovery.

GitHub suppresses most new workflow events created with a workflow's default `GITHUB_TOKEN`. For that reason the tag-driven workflow publishes Homebrew directly instead of depending on its own `release.published` event; the event workflow is the fallback for releases created outside that workflow.

macOS artifacts use ad-hoc code signing (`codesign` identity `-`), not an Apple Developer ID, and are not notarized. Windows artifacts are not Authenticode-signed and may trigger SmartScreen. The app cask installs the same current desktop disk image published on the GitHub Release.

## In-app updater signing

Tauri updater signatures are mandatory for automatic installation. Create the signing key once on a trusted machine and keep the private key outside the repository. Choose a strong password from the project password manager when prompted:

```bash
mkdir -p "$HOME/.tauri"
bun run --cwd apps/desktop tauri signer generate \
  --write-keys "$HOME/.tauri/reglet-updater.key"
```

This creates:

- `$HOME/.tauri/reglet-updater.key`: the password-protected private key;
- `$HOME/.tauri/reglet-updater.key.pub`: the distributable public key.

Configure these GitHub Actions values before publishing a tag:

- repository variable `REGLET_UPDATER_PUBLIC_KEY`: the generated public key;
- repository secret `TAURI_SIGNING_PRIVATE_KEY`: the complete private-key contents;
- repository secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password; omit this secret when the key is unencrypted.

Upload them without placing the private key or password in shell history:

```bash
gh variable set REGLET_UPDATER_PUBLIC_KEY \
  --repo elijahbutler/reglet \
  < "$HOME/.tauri/reglet-updater.key.pub"

gh secret set TAURI_SIGNING_PRIVATE_KEY \
  --repo elijahbutler/reglet \
  < "$HOME/.tauri/reglet-updater.key"

# Read the password without echoing it or placing it in shell history.
printf 'Updater key password: '
IFS= read -r -s updater_key_password
printf '\n'
printf '%s' "$updater_key_password" | \
  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD \
    --repo elijahbutler/reglet
unset updater_key_password
```

Confirm that GitHub knows all three names (secret values remain unreadable):

```bash
gh variable list --repo elijahbutler/reglet | rg REGLET_UPDATER_PUBLIC_KEY
gh secret list --repo elijahbutler/reglet | \
  rg 'TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?'
```

The public key is compiled into release builds and is safe to distribute. The private key must never be committed, logged, or copied into an app bundle. Back it up in the project’s secret manager: losing it prevents existing installations from verifying future automatic updates and requires users to install a new build manually.

Release builds set `REGLET_CREATE_UPDATER_ARTIFACTS=1`, which makes missing key material a hard failure. Successful builds publish `.app.tar.gz` or `.exe` updater packages, adjacent `.sig` files, and `latest.json` at `https://github.com/elijahbutler/reglet/releases/latest/download/latest.json`. Local builds omit updater artifacts and report the unavailable verification key clearly in Settings.

## Release contents

Each tag release includes:

- arm64 and Intel macOS CLI binaries;
- Windows x64 CLI binary;
- ad-hoc-signed, unnotarized Apple silicon and Intel macOS Tauri desktop artifacts;
- unsigned Windows x64 Tauri NSIS desktop installer artifacts;
- signed Tauri updater packages and `latest.json` for macOS arm64, macOS x64, and Windows x64;
- `SHA256SUMS.txt`;
- `provenance.txt` and GitHub artifact attestation.

## Required certification record

Before publishing a release candidate, record the date, platform, artifact checksum, and result for each item:

| Check | Required result |
|---|---|
| macOS Homebrew install | Formula installs the matching CLI and cask installs the matching desktop app from `elijahbutler/homebrew-reglet`. |
| Direct binary launch | Downloaded macOS and Windows binaries report the expected version. |
| Onboarding | Detects existing supported providers and writes nothing until review/apply. |
| Review/apply | Redacted diff, current digest, receipt, and snapshots are shown. |
| Drift | Plain apply refuses replacement; reviewed replacement succeeds only after fresh preview. |
| Recovery | Receipt restore returns every affected file/directory to its captured state. |
| Detach | Stop Managing preserves content and removes only Reglet ownership/header. |
| First-device sync | Owner claim, invitation, matching fingerprint approval, and interrupted retry succeed without a bootstrap token. |
| Two-device sync | Windows joins by invitation and request code; its Skill or `AGENTS.md` change reaches the Mac Master without provider writes before Review & Apply. |
| Revocation and backup | Remote disconnect blocks access, the key-rotation warning persists, and a newly created SQLite backup passes verification. |
| Homebrew tap gate | Public release is still draft until the formula and cask update succeeds. |

Desktop manager keyboard, VoiceOver, Narrator, and appearance checks remain tracked separately from the automated artifact gate and must be completed before promoting the untrusted app artifacts more broadly.
