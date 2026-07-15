import type { ManagerSnapshotV2 } from '@reglet/manager-protocol';

export function snapshotFixture(overrides: Partial<ManagerSnapshotV2> = {}): ManagerSnapshotV2 {
  const base: ManagerSnapshotV2 = {
    version: 2,
    contract: 'manager-snapshot',
    regletHome: '/tmp/reglet',
    safety: { localOnly: true, requiresExplicitReview: true },
    providerDiscovery: [
      { provider: 'claude', displayName: 'Claude Code', presence: 'installed', detected: true, capabilities: caps('supported') },
      { provider: 'codex', displayName: 'Codex CLI', presence: 'installed', detected: true, capabilities: caps('supported') },
    ],
    sourceInventory: [],
    enrollmentMatrix: [
      { provider: 'claude', displayName: 'Claude Code', enabled: true, cells: cells('claude') },
      { provider: 'codex', displayName: 'Codex CLI', enabled: false, cells: cells('codex') },
    ],
    master: {
      rules: { sharedDocuments: 1, providerOverlays: providerNumbers() },
      skills: { sharedSkills: 0, providerScopedSkills: providerNumbers() },
      mcp: { sharedServers: [], providerServers: providerArrays() },
    },
    masterRevision: 'rev',
    state: { state: 'upToDate', reasons: ['compositionRevisionCurrent'] },
    problems: [],
    effectiveProviders: [],
    structuredPlan: { available: false, reason: 'snapshot-read-only', entries: [] },
    driftInbox: [],
    receipts: { list: [], details: [] },
    legacyNetworkState: { present: false, paths: [] },
  };
  return { ...base, ...overrides };
}

function caps(state: 'supported' | 'needs-attention') {
  return {
    rules: state === 'supported' ? { state } : { state, reason: 'blocked' },
    skills: state === 'supported' ? { state } : { state, reason: 'blocked' },
    mcp: state === 'supported' ? { state } : { state, reason: 'blocked' },
  } as const;
}

function cells(provider: 'claude' | 'codex') {
  return {
    rules: { provider, content: 'rules', enrolled: true, capability: { state: 'supported' }, destinationPath: '/tmp/rules' },
    skills: { provider, content: 'skills', enrolled: false, capability: { state: 'supported' }, destinationPath: '/tmp/skills' },
    mcp: { provider, content: 'mcp', enrolled: false, capability: { state: 'supported' }, destinationPath: '/tmp/mcp' },
  } as const;
}

function providerNumbers() {
  return { claude: 0, codex: 0, cursor: 0, gemini: 0, windsurf: 0, opencode: 0 };
}

function providerArrays() {
  return { claude: [], codex: [], cursor: [], gemini: [], windsurf: [], opencode: [] };
}
