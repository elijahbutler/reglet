# Roadmap

## v1 (OSS, in progress)

- [ ] Core: master dir (`~/.reglet/`), provider registry (Claude Code, Codex CLI, Cursor, Gemini CLI, Windsurf, OpenCode), converters for rules / skills / MCP configs
- [ ] Onboarding: machine scan, selective import, per-provider backups, restore/revert
- [ ] Drift detection + import/unenroll flow, injected agent-instruction header
- [ ] Background daemon (macOS launchd, Windows scheduled task) with auto-apply
- [ ] Self-hostable sync server (Bun + Hono + SQLite, single Docker container) with device pairing and versioned per-file snapshots (3-way merge, conflict copies)

## v2 and beyond

- **SaaS**: hosted sync at a small monthly subscription for casual users — same server codebase on Postgres, Stripe billing, web dashboard (React/Tailwind) for account, devices, and browsing synced content. Self-host stays free and first-class.
- **Team / shared skill packs**: publish and subscribe to shared rule/skill collections.
- **Subagents** as a content type (`.claude/agents/`, `.codex/agents/`, …).
- **More providers**: the registry is one-file-per-provider; port remaining adapters from ruler's matrix (Aider, Goose, Zed, Kiro, Amazon Q, …).
- **Optional end-to-end encryption** of synced content.
- **Project-scope mode** interoperating with ruler's `.ruler/` convention.
