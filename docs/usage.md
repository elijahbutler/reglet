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
reglet init --provider claude --content skills --skill claude:skill-creator
```

When importing skills, interactive onboarding shows individual provider skills before copying them into `~/.reglet/skills`. Scripted onboarding can use `--skill provider:name` one or more times, or as a comma-separated list. If no `--skill` flag is provided, all selected providers' skills are imported.

## Apply Master Config

```bash
reglet apply
reglet apply --provider claude
reglet apply --provider codex --content mcp
```

Reglet writes generated provider files through the safe writer, creating a first backup and recording hashes in `.state/manifest.json`. Backups cover provider paths Reglet manages and is about to change; unrelated provider files are left untouched rather than snapshotted.

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

`.state/` is never synced.
