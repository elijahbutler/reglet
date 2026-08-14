import type { ManagerSnapshotV3 } from '@reglet/manager-protocol';

const desired = 'd1151ab6c4c5a7e68fd6798d8b5a3191f1fe691d';
const applied = 'a9914b7870ce9f9f40bbb74aa4fc8a4d5f2d8dd4';
const observed = '0b55ed8f43d125348287dcc459ec6e5d4c4dbd8a';

export const managerFixtureContent = `# General agent instructions

## Purpose

This artifact defines the baseline behavior and constraints for all agents operating in the Reglet ecosystem.

## Core principles

- Be accurate, concise, and thorough.
- Prefer clarity over brevity.
- Ask before making assumptions.
- Cite sources when available.

## Safety

- Do not expose secrets or sensitive data.
- Respect data handling policy.
- Refuse harmful or unethical requests.
`;

export const managerFixtureSnapshot: ManagerSnapshotV3 = {
  version: 3,
  contract: 'manager-snapshot',
  protocolVersion: 2,
  revision: 7,
  permissions: { scope: 'admin', canMutate: true, canAdmin: true },
  library: {
    schemaVersion: 2,
    migration: { status: 'applied', appliedAt: '2026-07-31T18:10:00.000Z', receiptId: 'migration-1' },
    artifacts: [
      {
        metadata: {
          id: 'artifact-general-instructions',
          kind: 'instruction',
          lifecycle: 'active',
          scope: { kind: 'global' },
          slug: 'general-agent-instructions',
          title: 'General agent instructions',
          description: 'Baseline behavior and constraints for every agent.',
          tags: ['system', 'safety'],
          targets: ['codex', 'claude', 'cursor', 'gemini', 'opencode'],
          locator: { type: 'file', path: 'rules/AGENTS.md' },
        },
        projections: [
          { artifactId: 'artifact-general-instructions', provider: 'codex', status: 'applied', destinationPath: '~/.codex/AGENTS.md', desiredHash: desired, appliedHash: desired, observedHash: desired, issues: [] },
          { artifactId: 'artifact-general-instructions', provider: 'claude', status: 'pending', destinationPath: '~/.claude/CLAUDE.md', desiredHash: desired, appliedHash: applied, observedHash: applied, issues: [] },
          { artifactId: 'artifact-general-instructions', provider: 'cursor', status: 'drifted', destinationPath: '~/.cursor/rules/reglet.mdc', desiredHash: desired, appliedHash: applied, observedHash: observed, issues: [{ code: 'SHADOWED_BY_PROVIDER_POLICY', severity: 'warning', message: 'Shadowed by provider policy.' }] },
          { artifactId: 'artifact-general-instructions', provider: 'gemini', status: 'applied', destinationPath: '~/.gemini/GEMINI.md', desiredHash: desired, appliedHash: desired, observedHash: desired, issues: [] },
          { artifactId: 'artifact-general-instructions', provider: 'windsurf', status: 'not-targeted', destinationPath: null, issues: [] },
          { artifactId: 'artifact-general-instructions', provider: 'opencode', status: 'pending', destinationPath: '~/.config/opencode/AGENTS.md', desiredHash: desired, issues: [] },
        ],
        history: [
          { revision: 'revision-v5', createdAt: '2026-07-31T18:10:00.000Z', reason: 'edit' },
        ],
      },
      ...['Coding standards', 'Tool use policy', 'Security guidelines', 'PR message standards', 'Commit message standards', 'Documentation style guide', 'Testing guidelines', 'Release process'].map((title, index) => ({
        metadata: {
          id: `artifact-${index + 2}`,
          kind: 'instruction' as const,
          lifecycle: 'active' as const,
          scope: { kind: 'global' as const },
          slug: title.toLocaleLowerCase().replaceAll(' ', '-'),
          title,
          tags: [],
          targets: ['codex' as const, 'claude' as const],
          locator: { type: 'file' as const, path: `rules/${title.toLocaleLowerCase().replaceAll(' ', '-')}.md` },
        },
        projections: [],
        history: [],
      })),
    ],
    tombstones: [],
    counts: { active: 9, archived: 0, drafts: 0 },
  },
  providers: [
    { id: 'codex', displayName: 'Codex', detected: true, documentationUrl: 'https://developers.openai.com/codex/', lastVerifiedAt: '2026-07-31', schemaVersion: 1, capabilities: { instructions: { supported: true }, skills: { supported: true }, mcp: { supported: true } }, projections: [] },
    { id: 'claude', displayName: 'Claude Code', detected: true, documentationUrl: 'https://docs.anthropic.com/', lastVerifiedAt: '2026-07-31', schemaVersion: 1, capabilities: { instructions: { supported: true }, skills: { supported: true }, mcp: { supported: true } }, projections: [] },
    { id: 'cursor', displayName: 'Cursor', detected: true, documentationUrl: 'https://docs.cursor.com/', lastVerifiedAt: '2026-07-31', schemaVersion: 1, capabilities: { instructions: { supported: true }, skills: { supported: true }, mcp: { supported: true } }, projections: [] },
    { id: 'gemini', displayName: 'Gemini CLI', detected: true, documentationUrl: 'https://github.com/google-gemini/gemini-cli', lastVerifiedAt: '2026-07-31', schemaVersion: 1, capabilities: { instructions: { supported: true }, skills: { supported: true }, mcp: { supported: true } }, projections: [] },
    { id: 'windsurf', displayName: 'Windsurf', detected: false, documentationUrl: 'https://docs.windsurf.com/', lastVerifiedAt: '2026-07-31', schemaVersion: 1, capabilities: { instructions: { supported: true }, skills: { supported: false, issue: 'Global skill projection is not verified.' }, mcp: { supported: true } }, projections: [] },
    { id: 'opencode', displayName: 'OpenCode', detected: true, documentationUrl: 'https://opencode.ai/docs/', lastVerifiedAt: '2026-07-31', schemaVersion: 1, capabilities: { instructions: { supported: true }, skills: { supported: true }, mcp: { supported: true } }, projections: [] },
  ],
  projectInbox: { roots: [], discoveries: [] },
  activity: [],
  settings: {
    setup: { completed: true },
    sync: { enabled: false, state: 'disabled', conflictCount: 0 },
    remote: { enabled: false },
    secretBindings: [],
    sessions: [],
  },
  diagnostics: { healthy: true, issues: [] },
};
