# Development

## Run Checks

```bash
bun run typecheck
bun run test
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

Public release automation publishes ad-hoc-signed/unnotarized macOS and unsigned Windows Tauri desktop artifacts; Linux GUI artifacts are structurally prepared but deferred.

The Tauri app requires a Rust toolchain. Validate the frontend and fixed sidecar bridge without starting a development server:

```bash
bun run desktop:typecheck
bun run desktop:test
bash scripts/stage-tauri-check-sidecar.sh
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Release builds first compile the standalone CLIs, stage each matching target-triple sidecar, then call `scripts/build-tauri-desktop.sh`. The script injects the tag version into both the package metadata and Rust update checker.

## Run or install the macOS Tauri app locally

```bash
bun run macos:local
bun run macos:install
```

`macos:local` builds the host Tauri app and opens it from the Tauri build output. `macos:install` builds the host Tauri app, installs it to `~/Applications/Reglet.app`, and opens it unless `REGLET_NO_OPEN=1` is set. Set `REGLET_APP_INSTALL_DIR` to install somewhere else.

## Test Safety

Tests must use `REGLET_HOME` and `REGLET_PROVIDER_HOME` temp directories. They must not touch real provider config paths or install launchd/scheduled-task services.

## Add A Provider

1. Add one adapter under `packages/core/src/providers/`.
2. Register it in `providers/registry.ts`.
3. Add rules, skills, and MCP tests.
4. Document paths and caveats in `docs/providers.md`.

## Contributing

Keep provider writes conservative, preserve user-owned config keys, and add focused tests for every file-writing path.
