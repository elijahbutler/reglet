# Reglet for macOS

Persistent SwiftUI manager for Reglet configuration and onboarding.

The app does not implement provider logic directly. It shells out to the installed `reglet` binary and consumes:

```bash
reglet scan --json
reglet plan --json
reglet init --provider <providers> --content <contents>
reglet status --json
reglet rules list --json
reglet rules read <path>
reglet rules write <path>
reglet diff --content rules
reglet apply --content rules
reglet login <url> --token <token> --device <name>
reglet sync --json
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

Release app archives bundle the matching `reglet` CLI under `Reglet.app/Contents/Resources`. The Homebrew cask installs the app and links that bundled executable into Homebrew's binary prefix.
