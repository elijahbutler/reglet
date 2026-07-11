# Reglet

**One home for all your AI agent configs.** Reglet keeps your system prompts, skills, and MCP server configs in a single master directory (`~/.reglet/`) and syncs them — converted to the right format — into every AI coding tool on your machine: Claude Code (`~/.claude/CLAUDE.md`), Codex CLI (`~/.codex/AGENTS.md`), Gemini CLI, Cursor, Windsurf, OpenCode, and more.

> A *reglet* is a small flat ruler. Reglet the tool is inspired by (and indebted to) [ruler](https://github.com/intellectronica/ruler), which solves this problem per-project; Reglet solves it machine-wide, with multi-device sync.

## What it does

- **One source of truth**: rules/prompts as markdown, skills as `SKILL.md` folders, MCP servers as one JSON file — all in `~/.reglet/`.
- **Automatic distribution**: `reglet apply` (or the background daemon) converts and writes each provider's global config files.
- **Safe by default**: scans your machine, imports your existing configs, and backs up every file before touching it. `reglet restore` undoes everything.
- **Drift detection**: hand-edits to generated files are detected; import them back into the master or unenroll that file from syncing.
- **Multi-device sync** (self-hostable): a lightweight sync server keeps `~/.reglet/` identical across your Mac and Windows machines.

## Status

Early development. See [docs/specs](docs/specs/) for the design and [ROADMAP.md](ROADMAP.md) for what's next.

## License

MIT
