# Reglet Setup for macOS

SwiftUI shell for first-run Reglet onboarding.

The app does not implement provider logic directly. It shells out to the installed `reglet` binary and consumes:

```bash
reglet scan --json
reglet plan --json
reglet init --provider <providers> --content <contents>
reglet restore <provider>
reglet revert <provider>
```

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
