# macOS real-machine smoke matrix — 2026-07-11

## Result

**Partial pass.** The current source passes its automated safety and lifecycle coverage, and the installed Homebrew app launches successfully on the test Mac. Broader Mac testing remains gated on a permission-enabled visual walkthrough, destructive recovery/uninstall checks on a disposable user account or VM, and a genuinely fresh machine image.

## Environment

- macOS 26.5.2 (25F84), Apple silicon (`arm64`)
- Source: `3d770da` (`origin/main` at the start of the pass)
- Installed CLI: `/opt/homebrew/bin/reglet`, version 0.1.3
- Installed app: `/Applications/Reglet.app`, version 0.1.3
- Distribution: Homebrew cask
- Signature: ad-hoc, arm64; no Developer ID team identifier
- App launch: pass; `/Applications/Reglet.app/Contents/MacOS/RegletSetup` remained running after launch
- Daemon: stopped
- Sync: not configured

## Matrix

| Scenario | Result | Evidence / remaining work |
|---|---|---|
| Fresh Mac with no provider configs | Partial | Isolated temporary homes pass through CLI tests. Repeat the installer and UI flow on a fresh macOS user or VM. |
| Existing Claude Code rules and skills | Pass (isolated) | Onboarding imports rules/MCP, preserves provider-local skills, and supports explicit skill adoption. |
| Existing Codex rules and MCP | Pass (adapter coverage) | Rules and TOML MCP conversion/application pass in the core suite. Add a permission-enabled app walkthrough on a disposable profile. |
| Multiple providers selected | Pass (automated) | Golden rules and MCP adapter coverage passes for Claude, Codex, Cursor, Gemini, Windsurf, and OpenCode. |
| Existing Reglet master directory | Pass (automated) | Master initialization is idempotent; config and manifest round trips pass. |
| Provider-local and scoped skills | Pass (automated) | Discovery, explicit adoption, shared/provider scope, shadowing, cleanup, and sync propagation pass. |
| Backup inspection | Pass (automated) | Existing output is backed up exactly once and manifest behavior passes. Manual Finder inspection remains. |
| Restore after first apply | Pass (isolated) | Targeted restore and byte-identical revert pass against temporary homes. Not run against the real user profile. |
| Drift after provider hand edit | Pass (isolated and observed live) | Modified/missing outputs and import paths pass. The live profile reports four modified MCP outputs without exposing content. |
| Two-device provider-scoped sync | Pass (automated) | Two clients, scoped-skill propagation, pairing, merge, conflict retry, and server restart behavior pass. |
| Conflicts and recovery | Pass (automated) | Non-overlapping merge and overlapping-conflict behavior pass; live destructive resolution was intentionally not attempted. |
| Installer leaves daemon/sync disabled | Pass | Installed app reports daemon stopped and sync unconfigured. |
| Installer uninstall leaves no background process | Not run | Requires intentionally removing the installed cask; run on a disposable account or VM. |
| Native sidebar and screen rendering | Blocked | The app launches, and the installed binary contains Providers, Rules, Skills, MCP, Sync, Activity & Drift, and Recovery surfaces. macOS denied Accessibility access to `osascript`, so navigation and screen-level visual assertions could not be completed. |
| Keyboard, VoiceOver, contrast, reduced motion | Not run | Requires an interactive accessibility pass. |

## Automated checks

After installing locked dependencies with `bun install`:

```text
bun test          63 pass, 0 fail, 222 assertions
bun run typecheck pass
bun run lint      pass
```

The suite covers master/config/manifest behavior, all provider adapters, onboarding scan/plan/init, safe apply and backup behavior, restore/revert, drift/import, skills adoption and precedence, daemon opt-in/watch behavior, and sync/account/conflict flows.

## Live-machine observations

- `Reglet.app` starts successfully from `/Applications` as an arm64 process.
- The app is ad-hoc signed, matching the documented pre-Developer-ID distribution state.
- No sync account is configured and the daemon is stopped.
- Read-only status reports four modified MCP outputs: Claude, Cursor, Gemini, and Windsurf. Their contents were not read or changed during this pass.
- No Apply, Save, Restore, Revert, Adopt, Login, Sync, or daemon mutation was performed.

## Release-gate follow-up

1. Grant Accessibility and Screen Recording permission to the verification host, then navigate and capture every native surface.
2. Run fresh install, restore/revert, and uninstall on a disposable macOS user or VM.
3. Repeat with representative existing Claude and Codex configurations, inspecting exact backups and previews.
4. Exercise VoiceOver, keyboard-only navigation, Increase Contrast, Reduce Transparency, and Reduce Motion.
5. Record screenshots and outcomes here; only then mark the roadmap smoke gate complete.
