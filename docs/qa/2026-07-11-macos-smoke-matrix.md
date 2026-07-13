# V1 certification matrix

This matrix is the release-operator record for the exact CLI artifacts. It replaces earlier exploratory walkthrough notes; it must be completed before publication.

| Area | Required evidence | Status |
|---|---|---|
| macOS Homebrew install | The formula in `elijahbutler/homebrew-reglet` installs the matching CLI release. | Pending release artifact |
| Direct binary launch | macOS arm64, macOS x64, and Windows x64 binaries launch and report the expected version. | Pending release artifact |
| Onboarding | Provider detection, scoped enrollment, master staging, and exact review work without writes before Apply. | Automated contract covered |
| Rules, Skills, MCP | Review shows redacted diffs, target hashes, drift state, snapshot behavior, and a current digest. | Automated contract covered |
| Drift | Plain automation refuses changed provider outputs; CLI import or reviewed replacement requires explicit action. | Automated contract covered |
| Recovery | A receipt lists paths/snapshots and explicit restore returns files/directories to the captured state. | Automated contract covered |
| Lifecycle | Stop Managing preserves provider content and removes Reglet ownership/header. | Automated contract covered |
| Tap gate | The GitHub Release remains draft until `Formula/reglet.rb` is pushed successfully. | Pending release run |

Source-level macOS manager checks remain useful before any future app distribution decision:

| Area | Required evidence | Status |
|---|---|---|
| Keyboard and VoiceOver | Every manager screen and destructive confirmation is operable and announced. | Source-level follow-up |
| Appearance | Contrast, reduced motion, reduced transparency, and larger text remain usable. | Source-level follow-up |

Automated prerequisites are run with:

```bash
bun test
bun run typecheck
bun run lint
swift test --package-path apps/macos/RegletSetup
```
