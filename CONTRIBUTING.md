# Contributing

Reglet is early-stage and optimized for conservative local file handling.

Before submitting changes:

```bash
bun run typecheck
bun test
bun run lint
```

Guidelines:

- Never let tests touch real `$HOME` provider config paths.
- Use `REGLET_HOME` and `REGLET_PROVIDER_HOME` for sandboxed filesystem tests.
- Preserve user-owned provider config keys and files.
- Add focused tests for every file-writing path.
- Document provider caveats in `docs/providers.md`.
