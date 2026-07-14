# Release integrity and V1 certification

## Artifact requirements

Public releases include CLI binaries and unnotarized macOS app archives. Release automation fails unless it can:

1. run Bun checks and tests;
2. run the source-level Swift tests for the retained macOS manager;
3. build `reglet-darwin-arm64`, `reglet-darwin-x64`, and `reglet-windows-x64.exe`;
4. build ad-hoc-signed, unnotarized `Reglet.app` archives for Apple silicon and Intel Macs;
5. publish SHA-256 checksums and GitHub build provenance for all release artifacts;
6. generate the Homebrew formula;
7. update `Formula/reglet.rb` in `elijahbutler/homebrew-reglet` using `HOMEBREW_TAP_TOKEN`;
8. publish the GitHub Release only after the tap update succeeds.

`HOMEBREW_TAP_TOKEN` is a repository secret backed by a fine-grained token with **Contents: Read and write** access to `elijahbutler/homebrew-reglet`. If the secret is absent, cloning fails, committing fails, or pushing fails, the workflow fails and leaves the GitHub Release as a draft.

The app archives are ad-hoc signed for bundle integrity, not signed with an Apple Developer ID, and not notarized. The legacy 0.1.6 app cask remains an uninstall path only; users install new app archives manually.

## Release contents

Each tag release includes:

- arm64 and Intel macOS CLI binaries;
- Windows x64 CLI binary;
- Apple silicon and Intel macOS app archives;
- `SHA256SUMS.txt`;
- `provenance.txt` and GitHub artifact attestation.

## Required certification record

Before publishing a release candidate, record the date, platform, artifact checksum, and result for each item:

| Check | Required result |
|---|---|
| macOS Homebrew install | Formula installs the matching CLI from `elijahbutler/homebrew-reglet`. |
| Direct binary launch | Downloaded macOS and Windows binaries report the expected version. |
| Onboarding | Detects existing supported providers and writes nothing until review/apply. |
| Review/apply | Redacted diff, current digest, receipt, and snapshots are shown. |
| Drift | Plain apply refuses replacement; reviewed replacement succeeds only after fresh preview. |
| Recovery | Receipt restore returns every affected file/directory to its captured state. |
| Detach | Stop Managing preserves content and removes only Reglet ownership/header. |
| Homebrew tap gate | Public release is still draft until the formula update succeeds. |

macOS manager keyboard, VoiceOver, and appearance checks remain tracked separately from the automated artifact gate and should be completed before promoting the unnotarized app archives more broadly.
