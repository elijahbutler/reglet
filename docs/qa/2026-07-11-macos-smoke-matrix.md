# macOS V1 certification matrix

This matrix is the release-operator record for the exact signed artifact. It replaces earlier exploratory walkthrough notes; it must be completed on a fresh macOS user or VM before publication.

| Area | Required evidence | Status |
|---|---|---|
| Installation | Gatekeeper accepts the signed, notarized app archive and installer package without bypass. | Pending signed artifact |
| Onboarding | Provider detection, scoped enrollment, master staging, and exact review work without writes before Apply. | Automated contract covered |
| Rules, Skills, MCP | Review shows redacted diffs, target hashes, drift state, snapshot behavior, and a current digest. | Automated contract covered |
| Drift | Plain automation refuses changed provider outputs; the manager offers import or reviewed replacement. | Automated contract covered |
| Recovery | A receipt lists paths/snapshots and explicit restore returns files/directories to the captured state. | Automated contract covered |
| Lifecycle | Stop Managing preserves provider content and removes Reglet ownership/header. | Automated contract covered |
| Uninstall | No daemon, login item, or configuration-network process remains. | Pending signed artifact |
| Keyboard and VoiceOver | Every manager screen and destructive confirmation is operable and announced. | Pending signed artifact |
| Appearance | Contrast, reduced motion, reduced transparency, and larger text remain usable. | Pending signed artifact |

Automated prerequisites are run with:

```bash
bun test
bun run typecheck
bun run lint
swift test --package-path apps/macos/RegletSetup
```
