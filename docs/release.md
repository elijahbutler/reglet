# Release integrity and V1 certification

## Artifact requirements

Public releases are macOS-only. Release automation fails unless it can:

1. import a Developer ID certificate;
2. sign the CLI binaries, app bundle, and installer package with hardened runtime and timestamps;
3. submit the app archive and installer package for notarization;
4. staple and validate the resulting tickets;
5. verify signatures with `codesign`, `pkgutil`, and `spctl`;
6. publish SHA-256 checksums and GitHub build provenance.

There is no unsigned, ad-hoc, or quarantine-bypass fallback.

## Release contents

Each tag release includes:

- arm64 and Intel macOS CLI binaries;
- arm64 and Intel notarized `Reglet.app` archives;
- arm64 and Intel notarized installer packages;
- `SHA256SUMS.txt`;
- `provenance.txt` and GitHub artifact attestation.

## Required certification record

Before publishing a release candidate, record the date, macOS version, artifact checksum, and result for each item:

| Check | Required result |
|---|---|
| Fresh-machine install | Signed package/app installs without bypassing Gatekeeper. |
| Onboarding | Detects existing supported providers and writes nothing until review/apply. |
| Review/apply | Redacted diff, current digest, receipt, and snapshots are shown. |
| Drift | Plain apply refuses replacement; reviewed replacement succeeds only after fresh preview. |
| Recovery | Receipt restore returns every affected file/directory to its captured state. |
| Detach | Stop Managing preserves content and removes only Reglet ownership/header. |
| Uninstall | Leaves no daemon, login item, or configuration-network process behind. |
| Keyboard | All manager flows, dialogs, and destructive confirmations are operable without a pointer. |
| VoiceOver | Labels, selected scope, validation, drift, receipt status, and destructive effects are announced. |
| Appearance | Contrast, reduced motion, reduced transparency, and larger text remain legible and usable. |

Do not call a build public V1 until every required result is recorded against the exact signed artifact.
