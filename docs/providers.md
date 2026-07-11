# Providers

| Provider | Rules | Skills | MCP | Caveats |
|---|---|---|---|---|
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude.json` | Preserves unrelated JSON keys. |
| Codex CLI | `~/.codex/AGENTS.md` | `~/.agents/skills/` | `~/.codex/config.toml` | TOML comments are not preserved by the current converter. |
| Cursor | unsupported | `~/.cursor/skills/` | `~/.cursor/mcp.json` | Global rules are unsupported in v1. |
| Gemini CLI | `~/.gemini/GEMINI.md` | `~/.gemini/skills/` | `~/.gemini/settings.json` | Preserves unrelated JSON keys. |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` | unsupported | `~/.codeium/windsurf/mcp_config.json` | Skills are unsupported in v1. |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` | `~/.config/opencode/opencode.json` | Converts MCP to OpenCode local/remote schema. |

## Managed MCP Keys

Reglet tracks the server names it manages in `.state/manifest.json`. On subsequent applies it removes or updates only those managed keys. User-added MCP server entries in the same provider file are preserved.

## Generated Rules Header

Generated rules files include an instruction header telling agents to edit `~/.reglet/rules/` or unenroll that content type. Drift detection strips that header when importing generated rules back into the master directory.
