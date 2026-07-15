# Desktop parity checklist

The Swift app remains frozen while Tauri reaches parity. This checklist maps the retained Swift command, screen, and test surface to the desktop implementation.

| Swift surface | Tauri status |
|---|---|
| `RegletCommand.scan`, `managerSnapshot`, `status` | Covered by snapshot v2 refresh through one fixed Manager RPC sidecar command. |
| `plan`, onboarding selection, staged `onboard` | First launch and the Providers tab open a multi-page safety, selection, unified-instructions, skills, provider-preview, and digest-backed apply flow. Technical paths stay hidden in favor of the unified `AGENT.md`, named skills, native provider filenames, and condensed New/Updated/Removed changes. |
| `enroll`, `unenroll` | Providers tab enrolls content directly and requires confirmation before Stop Managing detaches ownership while preserving content. |
| `importDrifted` | Activity & Drift tab requires destructive confirmation, calls `import-drift`, then refreshes. |
| `rulesList`, `readRule`, `writeRule` | Rules tab explicitly loads and picks shared/provider documents, reads exact content, and saves through RPC. |
| `ruleMergeRunners`, `mergeRuleDraft` | Rules tab discovers installed runners and exposes only those; every invocation requires explicit consent and returns an editable draft. |
| `skillsList`, `skillTree`, `readSkillFile`, `writeSkillFile`, `createSkill`, `deleteSkill`, `renameSkill`, `deleteSkillFile`, `renameSkillFile` | Skills tab browses shared/provider skills and file trees, supports both scopes, and confirms destructive file/skill changes. |
| `inspectUnmanagedSkill`, `readUnmanagedSkillFile`, `adoptSkill` | Skills tab provides read-only unmanaged tree/file previews and confirms adoption, including explicit overwrite on destination conflicts. |
| `mcpList`, `upsertMcp`, `deleteMcp` | MCP tab loads shared/provider server definitions, supports scoped JSON editing, validates through core, and confirms deletion. |
| `previewApply`, `applyPreview` | Activity & Drift tab renders each exact structured diff, digest, target, and operation; apply requires a second confirmation and stale digests fail closed. |
| `restoreOperation` | Recovery tab restores receipts after destructive confirmation. |
| `clearLegacyNetworkState` | Recovery tab removes legacy state after destructive confirmation. |
| Manual update check, automatic update opt-in | Sidebar implements manual check action and opt-in automatic checks defaulting off. |
| Unsaved-edit protection | Section changes and native window close protect dirty Rules/Skills/MCP edits. |
| Swift `ProvidersManager`, `RulesManager`, `SkillsManager`, `McpManager`, `ActivityManager`, `RecoveryManager`, `Onboarding`, `ApplyPreview` | Represented as Tauri tabs plus a dedicated multi-page onboarding dialog, using the snapshot v2 read model and RPC-only mutations. |
| Swift tests: color/theme, onboarding route, apply preview grouping, command failures, AI runner consent, drift/recovery, staged onboarding | Frontend tests cover loading, empty, blocked, onboarding routing, first-run selection, AI consent, path-free skill previews, condensed provider change grouping, document/runner discovery, skill browsing/adoption, MCP browsing, exact review, destructive confirmations, stale plans, unsaved edits, recovery, and protocol rejection. Rust tests cover fixed sidecar args, malformed output, nonzero exit, and redaction. |

The implementation surface is mapped. Swift removal remains blocked by the plan's acceptance gates: automated accessibility results, VoiceOver and Narrator evidence, native smoke evidence on macOS arm64/x64 and Windows x64, recovery/no-secret certification, and clean installation of the untrusted release artifacts.
