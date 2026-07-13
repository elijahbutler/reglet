# Reglet for macOS

Persistent SwiftUI manager for Reglet configuration and onboarding.

The app does not implement provider logic directly. It shells out to the installed `reglet` binary and consumes:

```bash
reglet scan --json
reglet plan --json
reglet init --provider <providers> --content <contents> --no-apply
reglet manager snapshot --json
reglet apply-structured preview --provider <providers> --content <contents>
reglet apply-structured apply --digest <digest> --provider <providers> --content <contents>
reglet rules read <path>
reglet rules write <path>
reglet operations show <receipt-id> --json
reglet operations restore <receipt-id>
reglet state legacy-network-status --json
```

All app-originated provider writes use the structured preview/apply pair. Master edits and onboarding import are staged locally first; the app then displays the fresh redacted review before it can write a provider output.

## Local development

From this directory:

```bash
swift build
REGLET_BINARY=/path/to/reglet swift run RegletSetup
```

For source-checkout development, build the CLI binary first:

```bash
bun run build:binaries
REGLET_BINARY=../../../dist/reglet-darwin-arm64 swift run RegletSetup
```

Installer packaging is intentionally separate. The installer must not install, load, or start the Reglet daemon.

Release app archives bundle the matching `reglet` CLI under `Reglet.app/Contents/Resources`. The Homebrew cask installs the app and links that bundled executable into Homebrew's binary prefix.
