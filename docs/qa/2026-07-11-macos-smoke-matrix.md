# macOS real-machine smoke matrix — 2026-07-11

## Result

**Partial pass.** The current source passes its automated safety and lifecycle coverage, the installed Homebrew app launches successfully on the test Mac, and a permission-enabled visual walkthrough of all seven native surfaces passed on 2026-07-11 (second pass, app 0.1.6). Broader Mac testing remains gated on destructive recovery/uninstall checks on a disposable user account or VM, a genuinely fresh machine image, and an interactive accessibility pass.

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
| Native sidebar and screen rendering | Pass (live walkthrough) | Second pass on app 0.1.6 with Accessibility granted: an automated read-only walkthrough reached all seven sidebar surfaces (Providers, Rules, Skills, MCP, Sync, Activity & Drift, Recovery) and captured a screenshot of each. No blank areas, truncation, overlap, or error banners on any surface. Independent screenshot review confirmed clean rendering. See "Live walkthrough" below. |
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

## Live walkthrough (second pass, 2026-07-11)

- App: `/Applications/Reglet.app` 0.1.6 (Homebrew cask), CLI 0.1.6. Source at `6791f12` plus this branch; `bun test` 72 pass / 0 fail (255 assertions), typecheck and lint clean.
- Method: automated read-only walkthrough driven through macOS Accessibility (`osascript` + `screencapture` by window ID), executed by an independent verification agent, with a separate human-style review of every screenshot. No Apply, Save, Restore, Revert, Adopt, Login, Sync, or daemon control was activated; no provider or master files were modified.
- Result: **pass**. All seven surfaces reached and rendered cleanly. Activity & Drift correctly reported `5 of 886 managed files changed outside Reglet` (the live profile's hand-edited MCP outputs) with per-file Import to Master / Re-apply actions. Sync shows the manual-only, token-stored-locally safety note; Recovery lists Restore/Revert per provider.
- Screenshots and accessibility dumps are retained locally outside the repo (they capture the test user's personal paths and skill inventory): `.context/qa/2026-07-11-app-walkthrough/`.
- Automation note: CoreGraphics reports the window owner as `Reglet` while Accessibility names the process `RegletSetup`; scripts must target the process name. Accessibility briefly failed to enumerate `window 1` on Recovery; capture by window ID succeeded.

## Release-gate follow-up

1. ~~Grant Accessibility and Screen Recording permission to the verification host, then navigate and capture every native surface.~~ Done in the second pass above.
2. Run fresh install, restore/revert, and uninstall on a disposable macOS user or VM.
3. Repeat with representative existing Claude and Codex configurations, inspecting exact backups and previews.
4. Exercise VoiceOver, keyboard-only navigation, Increase Contrast, Reduce Transparency, and Reduce Motion.
5. Record outcomes here; only then mark the roadmap smoke gate complete.
