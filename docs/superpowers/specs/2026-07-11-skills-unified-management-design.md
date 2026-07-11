# Skills unified management on onboarding — design

Date: 2026-07-11
Status: approved

## Problem

Reglet's master ("unified") skills layout — shared skills at `~/.reglet/skills/<skill>/`,
provider-scoped skills at `~/.reglet/skills/<provider>/<skill>/` — is invisible: no CLI
command or app view renders it. Provider-local skills can only be adopted one at a time
through a sheet in the Skills manager, onboarding has no skills step at all, and adoption
copies into the master without applying, so adopted skills don't reach other providers
until something else runs `reglet apply`.

## Goals

1. One structured CLI operation that exposes the whole skills world (shared,
   provider-scoped, per-provider unmanaged).
2. Checkbox-driven bulk adoption during onboarding and in the Skills manager.
3. Sync-through: after adoption, automatically apply skills so they land in providers.

Non-goals: batch-adopt CLI command (the app loops the existing `skills adopt`),
skill content editing, sync-server changes.

## CLI/core contract

### New core function `listSkills(home?)` in `packages/core/src/skills.ts`

```ts
export interface SharedSkillSummary {
  name: string;
  path: string;               // absolute
  fileCount: number;
  shadowedBy: ProviderId[];   // providers with a scoped skill of the same name
}

export interface ProviderScopedSkillSummary {
  provider: ProviderId;
  name: string;
  path: string;
  fileCount: number;
  shadowsShared: boolean;
}

export interface SkillsOverview {
  shared: SharedSkillSummary[];
  providerScoped: ProviderScopedSkillSummary[];
  unmanaged: UnmanagedSkill[]; // existing shape, unchanged
}
```

Built on `loadMasterDir` + existing `listUnmanagedSkills`. Sorted by name (shared) and
provider then name (scoped/unmanaged).

### New CLI command `reglet skills list [--json]`

`--json` prints:

```json
{
  "version": 1,
  "regletHome": "/Users/x/.reglet",
  "shared": [...],
  "providerScoped": [...],
  "unmanaged": [...]
}
```

Non-JSON output: one tab-separated line per skill: `shared|<provider>\t<name>\t<path>`.

Existing `skills unmanaged` and `skills adopt` stay unchanged (backward compatible).

## App (RegletSetup)

### Onboarding wizard

Steps become Safety → Choose → **Skills** → Preview → Done. The Skills step is skipped
automatically when there are no unmanaged skills for the selected providers.

Skills step UI: table grouped by provider. Each row: checkbox + skill name + scope picker
("Share with all" default / "This provider only") + conflict badge. Rows whose chosen
scope destination conflicts are disabled unless an explicit per-row "Overwrite" toggle is
set. Group header has select-all. Unchecked rows are kept local (untouched).

Adoptions execute after the Preview step's "Create Backups and Apply" confirmation,
alongside onboarding: loop `reglet skills adopt <provider> <name> --scope <scope>
[--overwrite] --json`, then run `reglet apply --content skills`, then rescan. Partial
failure: stop the loop, surface the error, refresh state (already-adopted skills show as
managed on refresh).

### Skills manager section

Three groups rendered from `skills list --json`:

1. **Unified (shared)** — read-only list, path + shadowed-by badges.
2. **Provider-scoped** — read-only list grouped by provider, "shadows shared" badge.
3. **Provider-local (unmanaged)** — same checkbox/scope-picker rows as onboarding, with
   a bottom bar "Adopt Selected" button that runs the same adopt-loop + apply + refresh.

The one-at-a-time `SkillAdoptionView` sheet is removed in favor of the checkbox flow.

### Model changes

- `SkillsOverviewResponse` Decodable mirroring the JSON above.
- `SetupModel`: `skillsOverview` replaces the bare `unmanagedSkills` array (keep a
  computed `unmanagedSkills` for convenience); `skillSelections: [String: SkillAdoptionScope]`
  keyed by `provider:name`; `overwriteFlags: Set<String>`; `adoptSelectedSkills()` runs
  the loop + `apply --content skills` + refresh.
- `RegletCommand`: `skillsList()`, `applySkills()` (runs `apply --content skills`),
  adopt gains an overwrite flag.

## Sync-through semantics

`reglet apply --content skills` applies master skills to all enrolled providers that
support skills. Running it once after the adopt loop propagates shared adoptions to every
provider and scoped adoptions to their provider. No daemon or sync-server involvement;
Safety copy in the wizard stays accurate.

## Testing

- Core: `listSkills` covering empty master, shared-only, provider-scoped shadowing,
  unmanaged detection alongside managed outputs.
- CLI: `skills list` text + `--json` shapes (extend `packages/cli/test/cli.test.ts`).
- App: builds via `swift build`; manual smoke of wizard step skip/show logic.
