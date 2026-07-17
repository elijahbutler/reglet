# Release integrity and V1 certification

## Artifact requirements

Public releases include standalone CLI binaries plus ad-hoc-signed/unnotarized macOS and unsigned Windows desktop artifacts. Linux GUI packaging is configured for `.deb` and AppImage, but Linux desktop artifacts are deferred until after macOS and Windows stabilize. Release automation fails unless it can:

1. run Bun, Tauri frontend, and Rust checks and tests;
2. build `reglet-darwin-arm64`, `reglet-darwin-x64`, and `reglet-windows-x64.exe`;
3. build ad-hoc-signed, unnotarized Tauri macOS desktop artifacts for Apple silicon and Intel Macs;
4. build unsigned Windows x64 NSIS/WebView2 desktop artifacts;
5. publish SHA-256 checksums and GitHub build provenance for all release artifacts;
6. generate the Homebrew formula and cask;
7. update `Formula/reglet.rb` and `Casks/reglet.rb` in `elijahbutler/homebrew-reglet` using `HOMEBREW_TAP_TOKEN`;
8. publish the GitHub Release only after the tap update succeeds.

`HOMEBREW_TAP_TOKEN` is a repository secret backed by a fine-grained token with **Contents: Read and write** access to `elijahbutler/homebrew-reglet`. If the secret is absent, cloning fails, committing fails, or pushing fails, the workflow fails and leaves the GitHub Release as a draft.

macOS artifacts use ad-hoc code signing (`codesign` identity `-`), not an Apple Developer ID, and are not notarized. Windows artifacts are not Authenticode-signed and may trigger SmartScreen. The app cask installs the same current desktop disk image published on the GitHub Release.

## Release contents

Each tag release includes:

- arm64 and Intel macOS CLI binaries;
- Windows x64 CLI binary;
- ad-hoc-signed, unnotarized Apple silicon and Intel macOS Tauri desktop artifacts;
- unsigned Windows x64 Tauri NSIS desktop installer artifacts;
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
