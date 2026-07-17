# Contributing

Reglet is early-stage and optimized for conservative local file handling.

Before submitting changes:

```bash
bun run typecheck
bun test
bun run lint
bun run desktop:cargo:test
```

Guidelines:

- Never let tests touch real `$HOME` provider config paths.
- Use `REGLET_HOME` and `REGLET_PROVIDER_HOME` for sandboxed filesystem tests.
- Preserve user-owned provider config keys and files.
- Add focused tests for every file-writing path.
- Keep public V1 local-only: do not add account, pairing, remote-configuration, or configuration-network behavior to the public CLI or manager.
- Document provider caveats in `docs/providers.md`.
