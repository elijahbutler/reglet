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
