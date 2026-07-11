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

## Test Safety

Tests must use `REGLET_HOME` and `REGLET_PROVIDER_HOME` temp directories. They must not touch real provider config paths or install launchd/scheduled-task services.

## Add A Provider

1. Add one adapter under `packages/core/src/providers/`.
2. Register it in `providers/registry.ts`.
3. Add rules, skills, and MCP tests.
4. Document paths and caveats in `docs/providers.md`.

## Contributing

Keep provider writes conservative, preserve user-owned config keys, and add focused tests for every file-writing path.
