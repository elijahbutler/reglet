# Usage

## Scan Providers

```bash
reglet scan
```

This prints detected provider directories and inventory counts without changing files.

## Onboard Selectively

Interactive:

```bash
reglet init
```

Scripted:

```bash
reglet init --provider claude --content rules
reglet init --provider claude,codex --content rules,mcp
```

## Apply Master Config

```bash
reglet apply
reglet apply --provider claude
reglet apply --provider codex --content mcp
```

Reglet writes generated provider files through the safe writer, creating a first backup and recording hashes in `.state/manifest.json`.

Shared skills live in `~/.reglet/skills/<skill-name>/` and apply to every enrolled provider with skills support. Provider-specific skills live in `~/.reglet/skills/<provider>/<skill-name>/`, such as `~/.reglet/skills/codex/my-skill/`, and apply only to that provider. A provider-specific skill with the same name as a shared skill overrides the shared version for that provider.

Provider-local skills are never imported automatically. Review and adopt them explicitly:

```bash
reglet skills unmanaged
reglet skills adopt claude my-skill --scope shared
reglet skills adopt claude my-skill --scope provider
```

Adoption copies the skill into the master without deleting the provider-local source. Existing master destinations are reported as conflicts; use `--overwrite` only after reviewing the destination.

## Drift

```bash
reglet status --check
reglet import claude:rules
reglet unenroll claude:rules
```

`status --check` exits with code `2` when drift is present. Rules drift can be imported back into the master directory.

## Restore

```bash
reglet restore claude
reglet revert
```

Restore/revert uses the recorded backups and removes Reglet-created files that had no original.

## Sync

Single-user token mode:

```bash
reglet login http://localhost:3000 --token "$REGLET_TOKEN" --device laptop
reglet sync
```

Sync scope is limited to:

- `rules/`
- `skills/`
- `mcp/servers.json`
- `reglet.toml`

Provider-specific skills are included because they are nested under `skills/<provider>/`.

`.state/` is never synced.
