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

From the repository root, build the current architecture's CLI, install it to `~/.local/bin`, and launch the app from source with one command:

```bash
bun run macos:local
```

To install an ad-hoc-signed local build to `~/Applications/Reglet.app` with the matching CLI bundled inside it:

```bash
bun run macos:install
```

Both commands install the matching CLI at `~/.local/bin/reglet`. Override `REGLET_CLI_INSTALL_DIR` or `REGLET_APP_INSTALL_DIR` to use different destinations; set `REGLET_NO_OPEN=1` to install without launching the app.

The macOS manager remains absent from public release artifacts. `macos:install` is a source-checkout convenience that creates an ad-hoc-signed local app, not a notarized public distribution.
