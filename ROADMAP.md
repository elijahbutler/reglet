# Roadmap

## v1 (OSS, in progress)

- [ ] Core: master dir (`~/.reglet/`), provider registry (Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, OpenCode), converters for rules / skills / MCP configs
- [ ] Onboarding: machine scan, selective import, per-provider backups, restore/revert
- [ ] Drift detection + import/unenroll flow, injected agent-instruction header
- [ ] Background daemon (macOS launchd, Windows scheduled task) with auto-apply
- [ ] Self-hostable sync server (Bun + Hono + SQLite, single Docker container) with device pairing and versioned per-file snapshots (3-way merge, conflict copies)
- [ ] Mac-friendly installer + onboarding UI: signed `.pkg`/`.dmg`, first-run setup app, provider scan/import checklist, file-write preview, backup confirmation, and explicit opt-in toggles for daemon and sync
  - [x] CLI setup contract for native UI: `reglet scan --json` and `reglet plan --json`
  - [x] Native SwiftUI setup app shell using Reglet CLI/core as the engine
  - [ ] First-run flow: welcome/safety, provider selection, content selection, exact file preview, backup/apply confirmation, status/restore
  - [x] Homebrew tap distribution for CLI alpha installs
  - [ ] Signed/notarized `.pkg` or `.dmg` distribution (blocked until Apple Developer ID exists)
  - [ ] Real Mac smoke pass across fresh machine, existing provider configs, backup inspection, restore, drift detection, uninstall, and explicit daemon/sync opt-in
- [ ] Final documentation pass mirroring BranchForge's README/docs/assets structure with Reglet-specific banner and lifecycle SVGs

## App-first roadmap

The macOS app will become Reglet's primary product surface. The CLI remains the stable automation, scripting, and CI engine, while routine setup, configuration, sync, editing, recovery, and provider-specific skill decisions become available natively in the app.

### Next milestone: Persistent Mac Manager

- [x] Reframe `Reglet Setup.app` as the persistent Reglet app, with first-run onboarding as one entry point rather than the app's sole purpose.
- [x] Add a native sidebar for Providers, Rules, Skills, MCP, Sync, Activity/Drift, and Recovery.
- [x] Keep business rules in stable, structured CLI/core operations rather than only in SwiftUI.
- [x] Extend the CLI JSON contract for app screens to expose current configuration, managed and unmanaged content, sync state, drift, and actionable errors.
- [x] Add Activity/Drift resolution, manual token sync, skills/MCP drift import, account/device pairing, and a native master-rules editor.
- [ ] Complete and record the real-machine smoke matrix before broader Mac user testing.

#### Skills

- Preserve the master layout: shared skills at `~/.reglet/skills/<skill>/` and provider-scoped skills at `~/.reglet/skills/<provider>/<skill>/`. Provider-local skills remain unmanaged unless explicitly adopted.
- When the app discovers an unmanaged provider skill, offer three per-skill choices:
  1. **Share with all providers** — copy it into the shared master.
  2. **Sync only for this provider** — copy it into that provider's master namespace.
  3. **Keep local only** — leave it untouched and exclude it from sync.
- Add structured CLI operations to list unmanaged skills and adopt one with `shared` or `provider` scope. The app refreshes status after each operation.
- Before adoption, show the source path, destination, overwrite or conflict state, and affected providers.

#### Native configuration management

- Provide native editors for master rules, skill metadata and files, and MCP definitions.
- Validate skill directory structure, MCP schema, provider support, and name conflicts before applying edits.
- Preview every provider write before apply, including affected paths and backup behavior.
- Surface provider-specific overrides clearly when a scoped skill shadows a shared skill.
- Use familiar document-style editing with explicit Save and Apply actions; never silently apply edits to provider outputs.

#### Sync, drift, and recovery

- Add self-hosted sync setup for server URL, token, device name, connection testing, manual sync, last result, and failure details.
- Keep background sync and the daemon as separate opt-ins, both disabled by default.
- Add an activity and drift view for managed output changes, sync conflicts, pending actions, and resolution paths.
- Add restore and revert controls plus direct access to the backup location.

#### Compatibility and validation

- Keep existing CLI commands working and add app-oriented structured commands instead of replacing CLI behavior.
- Keep existing shared-skill directories backward compatible. Never auto-import a provider-local skill; adoption must be explicit and reversible.
- Add core and CLI tests for skill discovery, each adoption choice, override precedence, local-skill preservation, sync propagation, and apply cleanup.
- Add UI tests for first-run navigation, adoption dialogs, write previews, editing validation, sync errors, drift state, and recovery flows.
- Run macOS smoke tests across fresh setup, existing multi-provider configurations, provider-local skills, two-device provider-scoped sync, conflicts, and recovery.
- Verify keyboard navigation, VoiceOver labels, reduced motion, contrast, and non-color status cues.

### Future milestone: Full Control Plane

- Add native multi-device sync conflict resolution with diff and merge choices.
- Add full provider inventory and lifecycle management, including enrollment, permissions, support changes, and migration assistance.
- Add skill-pack browsing, grouping, sharing, import/export, and provider compatibility guidance.
- Add native history and audit views for applies, syncs, backups, restores, and drift events.
- Add a project-scope view alongside global configuration with the same preview-and-apply model.

## v2 and beyond

- **SaaS**: hosted sync at a small monthly subscription for casual users — same server codebase on Postgres, Stripe billing, web dashboard (React/Tailwind) for account, devices, and browsing synced content. Self-host stays free and first-class.
- **Team / shared skill packs**: publish and subscribe to shared rule/skill collections.
- **Subagents** as a content type (`.claude/agents/`, `.codex/agents/`, …).
- **More providers**: the registry is one-file-per-provider; port remaining adapters from ruler's matrix (Aider, Goose, Zed, Kiro, Amazon Q, …).
- **Optional end-to-end encryption** of synced content.
- **Project-scope mode** interoperating with ruler's `.ruler/` convention.
