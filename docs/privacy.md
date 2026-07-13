# Privacy and network behavior

## Local-only configuration

Public V1 manages files on the current Mac only. It does not create an account, pair devices, upload configuration, fetch remote configuration, or start a background network service. Rules, skills, MCP definitions, operation journals, recovery snapshots, and receipts remain in the local master directory.

MCP process-environment references are resolved only in memory while a provider output is being rendered. Reglet does not store or display their resolved values in its own state, previews, diagnostics, journals, or receipts.

## Network requests

The configuration engine and manager refresh path make no network requests. The only public optional request is the macOS manager's manual **Check for Updates** action. Automatic update checks are disabled by default and can be enabled explicitly in the app menu preference.

Provider outputs may cause their respective provider to make requests when that provider runs. Reglet does not control those providers' independent network behavior.

## Local storage and permissions

Reglet stores canonical content under `~/.reglet/`. Its state, journals, receipts, and recovery snapshots are created with owner-only permissions: directories are `0700`, files are `0600`. A mutation fails when existing protected state cannot meet that contract.

Older state from earlier versions is retained inertly. `reglet state legacy-network-status` reports only the existence and paths of that state. `reglet state clear-legacy-network-state` permanently removes it after an explicit user action.
