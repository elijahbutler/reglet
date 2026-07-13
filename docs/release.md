# Release integrity and V1 certification

## Artifact requirements

Public releases are CLI-only. Release automation fails unless it can:

1. run Bun checks and tests;
2. run the source-level Swift tests for the retained macOS manager;
3. build `reglet-darwin-arm64`, `reglet-darwin-x64`, and `reglet-windows-x64.exe`;
4. publish SHA-256 checksums and GitHub build provenance for those CLI binaries;
5. generate the Homebrew formula;
6. update `Formula/reglet.rb` in `elijahbutler/homebrew-reglet` using `HOMEBREW_TAP_TOKEN`;
7. publish the GitHub Release only after the tap update succeeds.

`HOMEBREW_TAP_TOKEN` is a repository secret backed by a fine-grained token with **Contents: Read and write** access to `elijahbutler/homebrew-reglet`. If the secret is absent, cloning fails, committing fails, or pushing fails, the workflow fails and leaves the GitHub Release as a draft.

## Release contents

Each tag release includes:

- arm64 and Intel macOS CLI binaries;
- Windows x64 CLI binary;
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

Source-level macOS manager keyboard, VoiceOver, and appearance checks should remain tracked separately. They are not public CLI release blockers unless a future decision makes the app a release artifact.
