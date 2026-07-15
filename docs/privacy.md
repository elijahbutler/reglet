# Privacy and network behavior

## Local-only configuration

Public V1 manages files on the current machine only. It does not create an account, pair devices, upload configuration, fetch remote configuration, or start a background network service. Rules, skills, MCP definitions, operation journals, recovery snapshots, and receipts remain in the local master directory.

MCP process-environment references are resolved only in memory while a provider output is being rendered. Reglet does not store or display their resolved values in its own state, previews, diagnostics, journals, or receipts.

## Network requests

The configuration engine and retained manager refresh path make no network requests. Network-capable exceptions are separate user actions: update checks and optional AI rules drafting.

Before each AI draft, the desktop manager shows the selected external CLI and provider source filenames and requires consent. Reglet passes those files' contents and any optional user guidance to the installed tool, whose provider privacy terms apply, and receives an editable proposal without saving or applying it. Declining consent runs nothing. CLI users invoke the equivalent transfer explicitly with `reglet rules merge-draft`.

Automatic update checks are disabled by default and can be enabled explicitly in the desktop app. macOS desktop artifacts are ad-hoc signed and unnotarized; Windows artifacts are unsigned. The retained Swift manager remains frozen during parity and Linux GUI publishing is deferred.

Provider outputs may cause their respective provider to make requests when that provider runs. Reglet does not control those providers' independent network behavior.

## Local storage and permissions

Reglet stores canonical content under `~/.reglet/`. Its state, journals, receipts, and recovery snapshots are created with owner-only permissions: directories are `0700`, files are `0600`. A mutation fails when existing protected state cannot meet that contract.

Older state from earlier versions is retained inertly. `reglet state legacy-network-status` reports only the existence and paths of that state. `reglet state clear-legacy-network-state` permanently removes it after an explicit user action.
