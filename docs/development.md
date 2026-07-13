# Development

## Run Checks

```bash
bun run typecheck
bun test
bun run lint
```

## Build Binaries

```bash
bun run build:binaries
```

Outputs:

- `dist/reglet-darwin-arm64`
- `dist/reglet-darwin-x64`
- `dist/reglet-windows-x64.exe`

Public release packaging additionally runs:

```bash
swift test --package-path apps/macos/RegletSetup
```

The Swift test is a source-level guard for the retained macOS manager. Public release automation does not build or publish `Reglet.app`, installer packages, or a Homebrew cask.

## Run or install the macOS app locally

```bash
bun run macos:local
bun run macos:install
```

`macos:local` installs the native CLI and launches the app from source. `macos:install` creates an ad-hoc-signed `~/Applications/Reglet.app` with the same CLI bundled inside it. Set `REGLET_NO_OPEN=1` for unattended installation tests, or override `REGLET_CLI_INSTALL_DIR` and `REGLET_APP_INSTALL_DIR` to keep outputs in a temporary directory.

## Test Safety

Tests must use `REGLET_HOME` and `REGLET_PROVIDER_HOME` temp directories. They must not touch real provider config paths or install launchd/scheduled-task services.

## Add A Provider

1. Add one adapter under `packages/core/src/providers/`.
2. Register it in `providers/registry.ts`.
3. Add rules, skills, and MCP tests.
4. Document paths and caveats in `docs/providers.md`.

## Contributing

Keep provider writes conservative, preserve user-owned config keys, and add focused tests for every file-writing path.
