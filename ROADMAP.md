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

## v2 and beyond

- **SaaS**: hosted sync at a small monthly subscription for casual users — same server codebase on Postgres, Stripe billing, web dashboard (React/Tailwind) for account, devices, and browsing synced content. Self-host stays free and first-class.
- **Team / shared skill packs**: publish and subscribe to shared rule/skill collections.
- **Subagents** as a content type (`.claude/agents/`, `.codex/agents/`, …).
- **More providers**: the registry is one-file-per-provider; port remaining adapters from ruler's matrix (Aider, Goose, Zed, Kiro, Amazon Q, …).
- **Optional end-to-end encryption** of synced content.
- **Project-scope mode** interoperating with ruler's `.ruler/` convention.
