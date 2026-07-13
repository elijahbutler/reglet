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

The retained Swift decoder intentionally uses the default version 1 snapshot. New Manager surfaces use `reglet manager snapshot --json --contract-version 2`; unsupported contract versions are rejected.

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

The macOS manager is retained source, not a public release artifact. Public releases currently ship CLI-only binaries and a Homebrew formula; they do not publish `Reglet.app`, installer packages, or a Homebrew cask.
