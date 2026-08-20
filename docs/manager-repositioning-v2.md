# Manager Repositioning V2

Status: accepted and in implementation  
Baseline: `origin/main` at or after `7bf1c0f`  
Supersedes: PR #61 and commit `f62de4d`  
Archive: `archive/pr-61-manager-runtime-foundation`

Current execution status and acceptance criteria are tracked in the
[Reglet overhaul audit and delivery plan](./reglet-overhaul-plan.md).

## Decision

Reglet has one canonical manager application layer, one versioned protocol, one
shared React workbench, one Tauri desktop shell, one thin browser entry, and one
encrypted Sync V2 implementation. The local manager runtime and the encrypted
sync server are separate services. Electron and parallel provider/application/
sync stacks are not part of the target architecture.

```text
packages/core                 canonical artifacts, providers, projections,
                              filesystem recovery, discovery, security, sync scope
packages/manager-protocol     commands, DTOs, validators, compatibility contracts
packages/manager-application  serialized transport-neutral use cases
packages/manager-runtime      local Hono API, sessions, watcher, asset hosting
packages/manager-ui           shared React workbench and ManagerClient contract
apps/desktop                  Tauri lifecycle and native integration
apps/manager-web              browser bootstrap and pairing
packages/cli                  headless application adapter and compatibility CLI
packages/server               encrypted Sync V2 and owner administration only
```

## Locked boundaries

- Canonical content is stored in the existing master directory and indexed by
  schema-version-2 `library.json`; migration never moves or rewrites content.
- Provider outputs change only after an explicit digest-checked Apply.
- Project roots are read-only and remain machine-local unless content is
  deliberately promoted.
- Secrets are referenced, never serialized into canonical content, responses,
  sync, activity, logs, or diagnostics.
- Sync is optional, self-hosted, encrypted, canonical-only, and independent of
  the local manager runtime.
- Remote manager access is disabled by default and uses scoped, revocable
  sessions.
- Snapshot V2 and protocol V1 remain read-only compatibility surfaces for one
  release after Snapshot V3 ships.

## Delivery order

1. Contracts and visual authority.
2. Canonical schema and explicit migration.
3. Shared application and projection semantics.
4. SQLite local state and security.
5. Local runtime, CLI parity, and Tauri bootstrap.
6. Shared workbench and browser entry.
7. Project Inbox and promotion workflows.
8. Encrypted-sync scope migration, accessibility, performance, and release
   hardening.

Every phase retains the existing `main` validation suites. The visual authority
is [the approved manager workbench](../.impeccable/mocks/manager-workbench.png)
and the shared [design contract](../DESIGN.md).
