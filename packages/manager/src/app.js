const iconPaths = {
  activity:
    '<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>',
  archive:
    '<path d="M4 8h16M5 8v11h14V8M3 4h18v4H3zM9 12h6"/>',
  chevrons:
    '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
  copy:
    '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  diff:
    '<path d="M4 6h10M4 10h7M4 14h6M4 18h8M18 6v12M15 15l3 3 3-3"/>',
  external:
    '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
  file:
    '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h5"/>',
  filter:
    '<path d="M4 5h16M7 12h10M10 19h4"/>',
  history:
    '<path d="M4 5v5h5M4.8 9A8 8 0 1 1 6 17"/><path d="M12 8v5l3 2"/>',
  inbox:
    '<path d="M4 4h16l2 12H16l-2 3h-4l-2-3H2zM3 13h5l2 3h4l2-3h5"/>',
  library:
    '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15 5l4-1 2 15-4 1z"/>',
  close:
    '<path d="m6 6 12 12M18 6 6 18"/>',
  more:
    '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  panelRight:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M18 9v6"/>',
  plus:
    '<path d="M12 5v14M5 12h14"/>',
  providers:
    '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
  search:
    '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  server:
    '<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.65 8.94a1.7 1.7 0 0 0-.34-1.88L4.25 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10.05 3H10V3h4v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15z"/>',
  skill:
    '<path d="m12 3 2.2 5.2L20 10l-4.4 3.8L17 20l-5-3-5 3 1.4-6.2L4 10l5.8-1.8z"/>',
  warning:
    '<path d="M12 3 2.8 20h18.4zM12 9v5M12 17h.01"/>',
};

function iconMarkup(name) {
  const normalized = name === 'panel-right' ? 'panelRight' : name;
  const paths = iconPaths[normalized] ?? iconPaths.file;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

document.querySelectorAll('[data-icon]').forEach((element) => {
  element.innerHTML = iconMarkup(element.dataset.icon ?? 'file');
});

const savedTheme = localStorage.getItem('reglet.theme');
if (savedTheme === 'light' || savedTheme === 'dark') {
  document.documentElement.dataset.theme = savedTheme;
}

const providerCatalog = [
  {
    id: 'codex',
    name: 'Codex',
    destination: '~/.codex/AGENTS.md',
    documentation: 'Codex AGENTS.md',
  },
  {
    id: 'claude',
    name: 'Claude Code',
    destination: '~/.claude/CLAUDE.md',
    documentation: 'Claude Code memory',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    destination: '~/.cursor/rules/reglet.mdc',
    documentation: 'Cursor rules',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    destination: '~/.gemini/GEMINI.md',
    documentation: 'Gemini context',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    destination: '~/.codeium/windsurf/memories/global_rules.md',
    documentation: 'Windsurf rules',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    destination: '~/.config/opencode/AGENTS.md',
    documentation: 'OpenCode instructions',
  },
];

const generalInstruction = `# General agent instructions

These instructions define the baseline behavior for coding agents on this machine.

## Working style

- Prefer small, reviewable changes over broad rewrites.
- Read the surrounding code before editing.
- Explain non-obvious tradeoffs in plain language.
- Preserve user changes that are outside the requested scope.

## TypeScript

- Keep strict mode enabled.
- Avoid \`any\`; model uncertain input as \`unknown\` and narrow it.
- Prefer explicit domain types over stringly typed state.

## Safety

- Never reveal secrets, environment values, or authentication material.
- Ask before destructive or externally visible operations.
- Keep project discoveries local until they are deliberately promoted.

## Verification

- Run the narrowest relevant checks.
- Report what passed and what remains unverified.`;

let artifacts = [
  {
    id: 'general',
    title: 'General agent instructions',
    slug: 'general-agent-instructions',
    kind: 'instruction',
    group: 'Instructions',
    lifecycle: 'active',
    tags: ['core', 'global'],
    targets: ['codex', 'claude', 'cursor', 'gemini', 'opencode'],
    updated: '8 min ago',
    revision: 8,
    content: generalInstruction,
    projections: {
      codex: projection('applied', '0f2c28a', '0f2c28a', '0f2c28a'),
      claude: projection('pending', '0f2c28a', '944bc31', '944bc31'),
      cursor: projection(
        'drifted',
        '0f2c28a',
        '944bc31',
        '61ca96e',
        {
          code: 'shadowed',
          message: 'AGENTS.override.md takes precedence over this managed projection.',
          severity: 'warning',
        },
      ),
      gemini: projection('applied', '0f2c28a', '0f2c28a', '0f2c28a'),
      windsurf: projection('not-targeted'),
      opencode: projection('pending', '0f2c28a', '944bc31', '944bc31'),
    },
  },
  {
    id: 'code-style',
    title: 'TypeScript implementation',
    slug: 'typescript-implementation',
    kind: 'skill',
    group: 'Skills',
    lifecycle: 'active',
    tags: ['typescript', 'implementation'],
    targets: ['codex', 'claude', 'cursor', 'gemini', 'opencode'],
    updated: 'Yesterday',
    revision: 5,
    content: `---
name: typescript-implementation
description: Implement focused TypeScript changes with strict types and proportionate verification.
---

# TypeScript implementation

Use this skill when a task requires production TypeScript changes.

## Workflow

1. Inspect the local types and conventions.
2. Implement the smallest complete change.
3. Keep external input typed as \`unknown\` until validated.
4. Run typecheck, lint, and focused tests.
`,
    projections: allApplied(['codex', 'claude', 'cursor', 'gemini', 'opencode']),
  },
  {
    id: 'release-checklist',
    title: 'Release checklist',
    slug: 'release-checklist',
    kind: 'skill',
    group: 'Skills',
    lifecycle: 'active',
    tags: ['release', 'verification'],
    targets: ['codex', 'claude', 'cursor', 'gemini', 'opencode'],
    updated: '2 days ago',
    revision: 3,
    content: `---
name: release-checklist
description: Prepare a release without skipping recovery, compatibility, or diagnostics checks.
---

# Release checklist

- Confirm migrations are idempotent.
- Run the supported-platform test matrix.
- Exercise backup and restore.
- Verify diagnostic exports contain metadata only.
- Publish release notes after artifacts are signed.
`,
    projections: {
      ...allApplied(['codex', 'cursor', 'gemini']),
      claude: projection('pending', 'a891d20', 'a091a80', 'a091a80'),
      windsurf: projection('unsupported', undefined, undefined, undefined, {
        code: 'provider-limit',
        message: 'Global skills are not verified for Windsurf.',
        severity: 'info',
      }),
      opencode: projection('pending', 'a891d20', 'a091a80', 'a091a80'),
    },
  },
  {
    id: 'linear',
    title: 'Linear',
    slug: 'linear',
    kind: 'mcp',
    group: 'MCP servers',
    lifecycle: 'active',
    tags: ['issues', 'http'],
    targets: ['codex', 'claude', 'cursor', 'gemini', 'windsurf', 'opencode'],
    updated: '4 days ago',
    revision: 2,
    content: `{
  "transport": "http",
  "url": "https://mcp.linear.app/mcp",
  "headers": {},
  "secretHeaders": {
    "Authorization": {
      "id": "linear-api-token",
      "required": true
    }
  }
}`,
    projections: Object.fromEntries(
      providerCatalog.map((provider) => [
        provider.id,
        projection('blocked', '73ba58c', undefined, undefined, {
          code: 'missing-secret',
          message: 'Bind linear-api-token on this machine before applying.',
          severity: 'error',
        }),
      ]),
    ),
  },
  {
    id: 'security',
    title: 'Security review notes',
    slug: 'security-review-notes',
    kind: 'instruction',
    group: 'Instructions',
    lifecycle: 'archived',
    tags: ['security'],
    targets: ['codex', 'claude'],
    updated: 'May 12',
    revision: 6,
    content: `# Security review notes

Archived guidance retained for history. This artifact no longer contributes to desired provider projections.`,
    projections: {
      codex: projection('pending', undefined, '65a77d0', '65a77d0'),
      claude: projection('pending', undefined, '65a77d0', '65a77d0'),
      cursor: projection('not-targeted'),
      gemini: projection('not-targeted'),
      windsurf: projection('not-targeted'),
      opencode: projection('not-targeted'),
    },
  },
];

let discoveries = [
  {
    id: 'agents-root',
    title: 'AGENTS.md',
    path: '~/Code/acme-platform/AGENTS.md',
    state: 'New',
    scope: 'Repository root · Always active',
    recognizedBy: ['Codex', 'Cursor', 'Windsurf', 'OpenCode'],
    icon: 'file',
    recommendation: 'Global instruction',
    description:
      'Root-level guidance applies throughout the repository. Global promotion is available, but changes its scope to every selected project.',
  },
  {
    id: 'cursor-rule',
    title: 'TypeScript review rule',
    path: '~/Code/acme-platform/.cursor/rules/typescript.mdc',
    state: 'Changed',
    scope: 'src/**/*.ts · Agent requested',
    recognizedBy: ['Cursor'],
    icon: 'file',
    recommendation: 'Convert to skill',
    description:
      'This rule is path-scoped and agent-requested. Convert it to a skill to preserve deliberate invocation without making it globally active.',
  },
  {
    id: 'release-skill',
    title: 'release-checklist',
    path: '~/Code/acme-platform/.claude/skills/release-checklist',
    state: 'Conflict',
    scope: 'Project skill · 4 files · 1 executable',
    recognizedBy: ['Claude Code', 'OpenCode'],
    icon: 'skill',
    recommendation: 'Review file inventory',
    description:
      'The project copy differs from the promoted revision and contains an executable script. Trust must be confirmed for this exact revision.',
  },
  {
    id: 'mcp-project',
    title: 'project-tools',
    path: '~/Code/acme-platform/.mcp.json',
    state: 'New',
    scope: 'Project MCP · stdio',
    recognizedBy: ['Claude Code', 'Cursor'],
    icon: 'server',
    recommendation: 'Extract machine override',
    description:
      'The command contains an absolute repository path. Reglet can preserve it as a machine-local override during promotion.',
  },
];

let activity = [
  {
    action: 'Applied 2 projections',
    detail: 'Claude Code and OpenCode · General agent instructions',
    time: '8 min ago',
    icon: 'providers',
  },
  {
    action: 'Project scan completed',
    detail: '4 discoveries changed across 3 development roots',
    time: '22 min ago',
    icon: 'inbox',
  },
  {
    action: 'Draft recovered',
    detail: 'Linear · invalid JSON preserved locally',
    time: 'Yesterday',
    icon: 'history',
  },
  {
    action: 'Provider drift detected',
    detail: 'Cursor · AGENTS.override.md shadows managed output',
    time: 'Yesterday',
    icon: 'warning',
  },
];

const navItems = [
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'inbox', label: 'Project Inbox', icon: 'inbox', badge: '4' },
  { id: 'providers', label: 'Providers', icon: 'providers', badge: '3' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'settings', label: 'Settings', icon: 'settings', spacer: true },
];

const state = {
  section: 'library',
  libraryFilter: 'active',
  inboxFilter: 'all',
  selectedArtifactId: 'general',
  selectedDiscoveryId: 'agents-root',
  selectedProviderId: 'cursor',
  selectedSetting: 'General',
  contentView: 'edit',
  collectionQuery: '',
  collectionLimit: 200,
  searchResultIds: undefined,
  searchPending: false,
  searchRequest: 0,
  commandQuery: '',
  commandIndex: 0,
  applying: false,
  runtimeMode: 'booting',
  runtimeScope: 'admin',
  runtimeClient: undefined,
  runtimeSnapshot: undefined,
  runtimeConnected: false,
  refreshing: false,
  refreshQueued: false,
};

function canWrite() {
  return state.runtimeMode !== 'live' ||
    state.runtimeScope === 'write' ||
    state.runtimeScope === 'admin';
}

function canAdminister() {
  return state.runtimeMode !== 'live' || state.runtimeScope === 'admin';
}

function installRuntimeSnapshot(snapshot) {
  state.runtimeSnapshot = snapshot;
  const providerNames = new Map(
    snapshot.providers.map((provider) => [provider.id, provider.displayName]),
  );
  providerCatalog.splice(
    0,
    providerCatalog.length,
    ...snapshot.providers.map((provider) => ({
      id: provider.id,
      name: provider.displayName,
      destination:
        provider.effective.managedProjection.rulesPath ??
        provider.effective.managedProjection.mcpPath ??
        provider.effective.managedProjection.skillsDir ??
        'Unsupported',
      documentation: `Verified ${formatDate(provider.lastVerifiedAt)}`,
      documentationUrl: provider.documentationUrl,
      detected: provider.detected,
      enrolled: provider.enrolled,
      effective: provider.effective,
    })),
  );
  artifacts = snapshot.artifacts.map((entry) => ({
    ...entry.artifact,
    group:
      entry.artifact.kind === 'instruction'
        ? 'Instructions'
        : entry.artifact.kind === 'skill'
          ? 'Skills'
          : 'MCP servers',
    updated: entry.draft ? 'draft saved locally' : 'in the canonical library',
    revision: 1,
    content: entry.draft?.content ?? '',
    draft: entry.draft,
    history: [],
    validation: undefined,
    projections: Object.fromEntries(
      entry.projections.map((projectionState) => [
        projectionState.provider,
        {
          ...projectionState,
          issue: projectionState.issues[0],
          desiredHash: shortHash(projectionState.desiredHash),
          appliedHash: shortHash(projectionState.appliedHash),
          observedHash: shortHash(projectionState.observedHash),
        },
      ]),
    ),
  }));
  const roots = new Map(
    snapshot.projectRoots.map((root) => [root.id, root]),
  );
  discoveries = snapshot.discoveries.map((discovery) => {
    const root = roots.get(discovery.rootId);
    const scoped =
      !discovery.scope.rootLevel ||
      discovery.scope.globs.length > 0 ||
      discovery.scope.manual ||
      discovery.scope.agentRequested;
    const scope = scopeDescription(discovery.scope);
    return {
      ...discovery,
      title: discovery.relativePath.split('/').at(-1) ?? discovery.relativePath,
      path:
        root === undefined
          ? discovery.relativePath
          : `${root.path.replace(/\/$/, '')}/${discovery.relativePath}`,
      state: titleCase(discovery.state),
      scope,
      recognizedByIds: [...discovery.recognizedBy],
      recognizedBy: discovery.recognizedBy.map(
        (provider) => providerNames.get(provider) ?? titleCase(provider),
      ),
      icon: kindIcon(discovery.kind),
      recommendation:
        discovery.kind === 'instruction'
          ? scoped
            ? 'Convert to skill'
            : 'Global instruction'
          : discovery.kind === 'mcp'
            ? 'Extract machine override'
            : 'Review file inventory',
      description:
        discovery.scope.lossyFields.length > 0
          ? `Global promotion cannot preserve: ${discovery.scope.lossyFields.join(', ')}. Original metadata remains in local provenance.`
          : scoped
            ? 'This source has project-specific activation or path scope. Convert it to a skill to avoid making it globally active.'
            : 'This root-level source is always active. Global promotion is available after acknowledging the scope change.',
    };
  });
  activity = snapshot.activity.map((record) => ({
    action: activityTitle(record.action),
    detail: activityDetail(record),
    time: relativeTime(record.occurredAt),
    icon: activityIcon(record.action, record.outcome),
  }));

  if (!artifacts.some((artifact) => artifact.id === state.selectedArtifactId)) {
    state.selectedArtifactId = artifacts[0]?.id;
  }
  if (
    !discoveries.some(
      (discovery) => discovery.id === state.selectedDiscoveryId,
    )
  ) {
    state.selectedDiscoveryId = discoveries[0]?.id;
  }
  if (
    !providerCatalog.some(
      (provider) => provider.id === state.selectedProviderId,
    )
  ) {
    state.selectedProviderId = providerCatalog[0]?.id ?? 'codex';
  }
}

function scopeDescription(scope) {
  const parts = [];
  parts.push(scope.rootLevel ? 'Repository root' : 'Nested directory');
  if (scope.globs.length > 0) parts.push(scope.globs.join(', '));
  if (scope.manual) parts.push('Manual');
  if (scope.agentRequested) parts.push('Agent requested');
  if (scope.alwaysActive) parts.push('Always active');
  return parts.join(' · ');
}

function activityTitle(action) {
  return action
    .split('.')
    .map((part) => titleCase(part))
    .join(' ');
}

function activityDetail(record) {
  const details = [
    record.provider,
    record.artifactId,
    ...Object.values(record.metadata ?? {}).map(String),
  ].filter(Boolean);
  return details.length > 0
    ? details.join(' · ')
    : `${titleCase(record.outcome)} local operation`;
}

function activityIcon(action, outcome) {
  if (outcome === 'error') return 'warning';
  if (action.startsWith('providers.')) return 'providers';
  if (action.startsWith('project.')) return 'inbox';
  if (action.startsWith('library.')) return 'library';
  return 'activity';
}

function shortHash(value) {
  return typeof value === 'string' ? value.slice(0, 7) : undefined;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date);
}

function relativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  return formatDate(value);
}

async function refreshRuntimeSnapshot(options = {}) {
  if (state.runtimeMode !== 'live') return;
  if (state.refreshing) {
    state.refreshQueued = true;
    return;
  }
  state.refreshing = true;
  try {
    const snapshot = await state.runtimeClient.snapshot();
    installRuntimeSnapshot(snapshot);
    if (options.loadSelected !== false) {
      await loadSelectedArtifactDetail();
    }
    render();
  } catch (error) {
    handleRuntimeError(error, 'Could not refresh the local manager');
  } finally {
    state.refreshing = false;
    if (state.refreshQueued) {
      state.refreshQueued = false;
      void refreshRuntimeSnapshot(options);
    }
  }
}

async function loadSelectedArtifactDetail() {
  if (
    state.runtimeMode !== 'live' ||
    state.selectedArtifactId === undefined
  ) {
    return;
  }
  const artifact = getSelectedArtifact();
  if (artifact === undefined) return;
  const detail = await state.runtimeClient.showArtifact(artifact.id);
  const current = artifacts.find((candidate) => candidate.id === artifact.id);
  if (current === undefined) return;
  current.content = current.draft?.content ?? detail.content;
  current.history = detail.history;
  current.validation = detail.validation;
  current.revision = Math.max(1, detail.history.length + 1);
}

async function selectArtifact(artifactId) {
  state.selectedArtifactId = artifactId;
  state.selectedProviderId = preferredProvider(getSelectedArtifact());
  state.contentView = 'edit';
  if (state.runtimeMode === 'live') {
    try {
      await loadSelectedArtifactDetail();
    } catch (error) {
      handleRuntimeError(error, 'Could not open the canonical artifact');
    }
  }
  render();
}

function handleRuntimeError(error, title) {
  const message =
    error instanceof Error ? error.message : 'The local runtime request failed.';
  showToast(title, message);
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 401
  ) {
    showPairingGate('This manager session expired or was revoked. Pair again.');
  }
}

function projection(status, desiredHash, appliedHash, observedHash, issue) {
  return {
    status,
    desiredHash,
    appliedHash,
    observedHash,
    issue,
    appliedAt: appliedHash ? 'Today, 10:42 AM' : undefined,
  };
}

function allApplied(targets) {
  return Object.fromEntries(
    providerCatalog.map((provider) => [
      provider.id,
      targets.includes(provider.id)
        ? projection('applied', '53b401e', '53b401e', '53b401e')
        : projection('not-targeted'),
    ]),
  );
}

function getSelectedArtifact() {
  return (
    artifacts.find((artifact) => artifact.id === state.selectedArtifactId) ??
    artifacts[0]
  );
}

function getSelectedDiscovery() {
  return (
    discoveries.find(
      (discovery) => discovery.id === state.selectedDiscoveryId,
    ) ?? discoveries[0]
  );
}

function getSelectedProvider() {
  return (
    providerCatalog.find(
      (provider) => provider.id === state.selectedProviderId,
    ) ?? providerCatalog[0]
  );
}

function titleCase(value) {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderNav() {
  const container = document.querySelector('#primary-nav');
  const visibleItems = navItems.filter(
    (item) => item.id !== 'inbox' || canAdminister(),
  );
  container.innerHTML = visibleItems
    .map((item) => {
      const badge =
        state.runtimeMode === 'live'
          ? item.id === 'inbox'
            ? String(
                discoveries.filter(
                  (discovery) => discovery.state !== 'Promoted',
                ).length,
              )
            : item.id === 'providers'
              ? String(
                  artifacts.filter(artifactNeedsAttention).length,
                )
              : undefined
          : item.badge;
      return `
        ${item.spacer ? '<div class="nav-spacer"></div>' : ''}
        <button
          type="button"
          class="nav-button"
          data-section="${item.id}"
          aria-current="${state.section === item.id ? 'page' : 'false'}"
          title="${item.label}"
        >
          ${iconMarkup(item.icon)}
          <span>${item.label}</span>
          ${badge && badge !== '0' ? `<span class="nav-badge">${badge}</span>` : ''}
        </button>
      `;
    })
    .join('');

  container.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      state.section = button.dataset.section;
      state.collectionQuery = '';
      state.collectionLimit = 200;
      state.searchResultIds = undefined;
      state.searchPending = false;
      document.querySelector('#collection-search').value = '';
      render();
    });
  });
}

function renderFilters() {
  const filterRow = document.querySelector('#filter-row');
  if (state.section === 'library') {
    const filters = ['active', 'drafts', 'archived', 'attention'];
    filterRow.innerHTML = filters
      .map(
        (filter) => `
          <button
            type="button"
            class="filter-button"
            data-filter="${filter}"
            aria-pressed="${state.libraryFilter === filter}"
          >
            ${filter === 'attention' ? 'Needs attention' : titleCase(filter)}
          </button>
        `,
      )
      .join('');
    filterRow.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.libraryFilter = button.dataset.filter;
        renderCollection();
        renderFilters();
      });
    });
    return;
  }

  if (state.section === 'inbox') {
    const filters = [
      'all',
      'new',
      'changed',
      'promoted',
      'conflict',
      'ignored',
    ];
    filterRow.innerHTML = filters
      .map(
        (filter) => `
          <button
            type="button"
            class="filter-button"
            data-inbox-filter="${filter}"
            aria-pressed="${state.inboxFilter === filter}"
          >
            ${titleCase(filter)}
          </button>
        `,
      )
      .join('');
    filterRow.querySelectorAll('[data-inbox-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.inboxFilter = button.dataset.inboxFilter;
        renderCollection();
        renderFilters();
      });
    });
    return;
  }

  filterRow.innerHTML = '';
}

function artifactNeedsAttention(artifact) {
  return Object.values(artifact.projections).some((item) =>
    ['pending', 'drifted', 'blocked', 'missing', 'error'].includes(item.status),
  );
}

function filteredArtifacts() {
  const query = state.collectionQuery.trim().toLowerCase();
  return artifacts.filter((artifact) => {
    const matchesQuery =
      query.length === 0 ||
      (state.runtimeMode === 'live' && state.searchResultIds !== undefined
        ? state.searchResultIds.has(`canonical:${artifact.id}`)
        : `${artifact.title} ${artifact.slug} ${artifact.tags.join(' ')}`
            .toLowerCase()
            .includes(query));
    if (!matchesQuery) return false;
    if (state.libraryFilter === 'archived') {
      return artifact.lifecycle === 'archived';
    }
    if (state.libraryFilter === 'attention') {
      return artifact.lifecycle === 'active' && artifactNeedsAttention(artifact);
    }
    if (state.libraryFilter === 'drafts') {
      return artifact.draft !== undefined || artifact.id === 'linear';
    }
    return artifact.lifecycle === 'active';
  });
}

function groupArtifactsByKind(items) {
  const grouped = new Map();
  items.forEach((artifact) => {
    const existing = grouped.get(artifact.group) ?? [];
    existing.push(artifact);
    grouped.set(artifact.group, existing);
  });
  return grouped;
}

function renderLibraryCollection() {
  const list = document.querySelector('#collection-list');
  const matching = filteredArtifacts();
  const visible = matching.slice(0, state.collectionLimit);
  const grouped = groupArtifactsByKind(visible);
  if (grouped.size === 0) {
    list.innerHTML = emptyState(
      'search',
      'No artifacts found',
      'Try another filter or search term. Canonical content remains unchanged.',
    );
    return;
  }

  list.innerHTML = [...grouped.entries()]
    .map(
      ([group, groupArtifacts]) => `
        <div class="list-group-label">${escapeHtml(group)}</div>
        ${groupArtifacts
          .map(
            (artifact) => `
              <button
                type="button"
                class="artifact-row"
                data-artifact="${escapeHtml(artifact.id)}"
                data-attention="${artifactNeedsAttention(artifact)}"
                aria-selected="${state.selectedArtifactId === artifact.id}"
              >
                <span class="artifact-kind">${iconMarkup(kindIcon(artifact.kind))}</span>
                <span class="artifact-copy">
                  <span class="artifact-title">${escapeHtml(artifact.title)}</span>
                  <span class="artifact-subtitle">${escapeHtml(artifact.tags.join(' · '))} · Updated ${escapeHtml(artifact.updated)}</span>
                </span>
                <span class="artifact-targets">${artifact.targets.length}</span>
              </button>
            `,
          )
          .join('')}
      `,
    )
    .join('');
  appendCollectionContinuation(list, matching.length, visible.length);

  list.querySelectorAll('[data-artifact]').forEach((button) => {
    button.addEventListener('click', () => {
      void selectArtifact(button.dataset.artifact);
    });
  });
}

function preferredProvider(artifact) {
  const attentionProvider = providerCatalog.find((provider) =>
    ['drifted', 'blocked', 'missing', 'error', 'pending'].includes(
      artifact.projections[provider.id]?.status,
    ),
  );
  return attentionProvider?.id ?? artifact.targets[0] ?? 'codex';
}

function renderInboxCollection() {
  const list = document.querySelector('#collection-list');
  const query = state.collectionQuery.trim().toLowerCase();
  const visible = discoveries.filter((discovery) => {
    const filterMatch =
      state.inboxFilter === 'all' ||
      discovery.state.toLowerCase() === state.inboxFilter;
    const queryMatch =
      query.length === 0 ||
      (state.runtimeMode === 'live' && state.searchResultIds !== undefined
        ? state.searchResultIds.has(
            `project:${discovery.rootId}:${discovery.id}`,
          )
        : `${discovery.title} ${discovery.path} ${discovery.scope}`
            .toLowerCase()
            .includes(query));
    return filterMatch && queryMatch;
  });
  const rendered = visible.slice(0, state.collectionLimit);

  list.innerHTML =
    visible.length === 0
      ? emptyState(
          'inbox',
          'Inbox is clear',
          'Rescan development roots or change the current discovery filter.',
        )
      : rendered
          .map(
            (discovery) => `
              <button
                type="button"
                class="inbox-row"
                data-discovery="${escapeHtml(discovery.id)}"
                aria-selected="${state.selectedDiscoveryId === discovery.id}"
              >
                <span>${iconMarkup(discovery.icon)}</span>
                <span class="inbox-copy">
                  <span class="inbox-title">${escapeHtml(discovery.title)}</span>
                  <span class="inbox-subtitle">${escapeHtml(discovery.state)} · ${escapeHtml(discovery.scope)}</span>
                  <span class="recognized-by">
                    ${discovery.recognizedBy
                      .map(
                        (provider) =>
                          `<span class="provider-token">${escapeHtml(provider)}</span>`,
                      )
                      .join('')}
                  </span>
                </span>
              </button>
            `,
          )
          .join('');
  appendCollectionContinuation(list, visible.length, rendered.length);

  list.querySelectorAll('[data-discovery]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedDiscoveryId = button.dataset.discovery;
      render();
    });
  });
}

function appendCollectionContinuation(list, total, rendered) {
  if (rendered >= total) return;
  list.insertAdjacentHTML(
    'beforeend',
    `
      <div class="collection-continuation">
        <span>Showing ${rendered.toLocaleString()} of ${total.toLocaleString()}</span>
        <button class="button button-quiet" type="button" data-show-more>Show 200 more</button>
      </div>
    `,
  );
  list.querySelector('[data-show-more]')?.addEventListener('click', () => {
    state.collectionLimit += 200;
    renderCollection();
  });
}

function renderProviderCollection() {
  const list = document.querySelector('#collection-list');
  const query = state.collectionQuery.trim().toLowerCase();
  const visible = providerCatalog.filter((provider) =>
    provider.name.toLowerCase().includes(query),
  );
  list.innerHTML = visible
    .map((provider) => {
      const issueCount = artifacts.filter((artifact) =>
        ['drifted', 'blocked', 'missing', 'error'].includes(
          artifact.projections[provider.id]?.status,
        ),
      ).length;
      return `
        <button
          type="button"
          class="artifact-row"
          data-provider-collection="${escapeHtml(provider.id)}"
          data-attention="${issueCount > 0}"
          aria-selected="${state.selectedProviderId === provider.id}"
        >
          <span class="artifact-kind">${iconMarkup('providers')}</span>
          <span class="artifact-copy">
            <span class="artifact-title">${escapeHtml(provider.name)}</span>
            <span class="artifact-subtitle">Enrolled · ${escapeHtml(provider.documentation)}</span>
          </span>
          <span class="artifact-targets">${issueCount || '—'}</span>
        </button>
      `;
    })
    .join('');

  list.querySelectorAll('[data-provider-collection]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedProviderId = button.dataset.providerCollection;
      render();
    });
  });
}

function renderCollection() {
  const title = document.querySelector('#collection-title');
  const description = document.querySelector('#collection-description');
  const search = document.querySelector('#collection-search');
  const footer = document.querySelector('#collection-footer');
  const action = document.querySelector('#collection-action');
  document
    .querySelector('#collection-list')
    .setAttribute('aria-busy', String(state.searchPending));

  if (state.section === 'library') {
    title.textContent = 'Library';
    description.textContent = 'Canonical and editable';
    search.placeholder = 'Search artifacts';
    action.setAttribute('aria-label', 'Create artifact');
    action.innerHTML = iconMarkup('plus');
    renderLibraryCollection();
    footer.innerHTML = `<button class="button button-quiet" type="button" data-footer-action="new">${iconMarkup('plus')} New artifact</button>`;
  } else if (state.section === 'inbox') {
    title.textContent = 'Project Inbox';
    description.textContent = 'Read-only discoveries';
    search.placeholder = 'Search discoveries';
    action.setAttribute('aria-label', 'Rescan development roots');
    action.innerHTML = iconMarkup('history');
    renderInboxCollection();
    footer.innerHTML = `<button class="button button-quiet" type="button" data-footer-action="scan">${iconMarkup('history')} Rescan ${state.runtimeSnapshot?.projectRoots?.length ?? 3} roots</button>`;
  } else if (state.section === 'providers') {
    title.textContent = 'Providers';
    description.textContent = 'Effective configuration';
    search.placeholder = 'Search providers';
    action.setAttribute('aria-label', 'Detect providers');
    action.innerHTML = iconMarkup('history');
    renderProviderCollection();
    footer.innerHTML = `<span>${providerCatalog.filter((provider) => provider.detected !== false).length} detected · ${providerCatalog.filter((provider) => provider.enrolled?.provider !== false).length} enrolled</span>`;
  } else if (state.section === 'activity') {
    title.textContent = 'Activity';
    description.textContent = 'Local, redacted events';
    search.placeholder = 'Search activity';
    action.setAttribute('aria-label', 'Export diagnostics');
    action.innerHTML = iconMarkup('external');
    document.querySelector('#collection-list').innerHTML =
      activity.length === 0
        ? emptyState(
            'activity',
            'No local activity yet',
            'Canonical edits, scans, promotions, and provider applies appear here.',
          )
        : activity
            .map(
        (item, index) => `
          <button type="button" class="artifact-row" aria-selected="${index === 0}">
            <span class="artifact-kind">${iconMarkup(item.icon)}</span>
            <span class="artifact-copy">
              <span class="artifact-title">${escapeHtml(item.action)}</span>
              <span class="artifact-subtitle">${escapeHtml(item.time)}</span>
            </span>
          </button>
        `,
            )
            .join('');
    footer.innerHTML = `<span>Artifact bodies and project paths are excluded from exports.</span>`;
  } else {
    title.textContent = 'Settings';
    description.textContent = 'Local preferences';
    search.placeholder = 'Search settings';
    action.setAttribute('aria-label', 'Open diagnostics');
    action.innerHTML = iconMarkup('activity');
    const settings = [
      ['General', 'Theme, editor, updates'],
      [
        'Development roots',
        `${state.runtimeSnapshot?.projectRoots?.length ?? 3} local roots`,
      ],
      ['Secrets', 'Keychain bindings'],
      [
        'Remote access',
        state.runtimeSnapshot?.remote?.enabled ? 'Enabled' : 'Disabled',
      ],
      [
        'Sync & devices',
        state.runtimeSnapshot?.sync?.configured ? 'Configured' : 'Not configured',
      ],
      ['Backups & recovery', 'Provider originals retained'],
      ['Diagnostics', 'Runtime and watchers'],
    ].filter(
      ([name]) =>
        canAdminister() || name === 'General' || name === 'Diagnostics',
    );
    if (!settings.some(([name]) => name === state.selectedSetting)) {
      state.selectedSetting = 'General';
    }
    document.querySelector('#collection-list').innerHTML = settings
      .map(
        ([name, detail], index) => `
          <button type="button" class="artifact-row" data-setting="${name}" aria-selected="${state.selectedSetting === name}">
            <span class="artifact-kind">${iconMarkup(index === 0 ? 'settings' : 'file')}</span>
            <span class="artifact-copy">
              <span class="artifact-title">${name}</span>
              <span class="artifact-subtitle">${detail}</span>
            </span>
          </button>
        `,
      )
      .join('');
    document
      .querySelectorAll('[data-setting]')
      .forEach((button) =>
        button.addEventListener('click', () => {
          state.selectedSetting = button.dataset.setting;
          render();
        }),
      );
    footer.innerHTML = `<span>Reglet ${state.runtimeSnapshot?.diagnostics?.runtime?.version ?? '0.1.0'} · Runtime ready</span>`;
  }

  renderFilters();
  footer.querySelector('[data-footer-action="new"]')?.addEventListener('click', () =>
    showToast('New artifact', 'Choose Instruction, Skill, or MCP from the command palette.'),
  );
  footer
    .querySelector('[data-footer-action="scan"]')
    ?.addEventListener('click', () => void rescanProjectRoots());
}

function renderLibraryContent() {
  const artifact = getSelectedArtifact();
  if (artifact === undefined) {
    document.querySelector('#artifact-title').textContent = 'No artifact selected';
    document.querySelector('#artifact-meta').textContent = canWrite()
      ? 'Create an instruction, skill, or MCP server to begin'
      : 'This library does not contain a readable artifact';
    document.querySelector('#artifact-kind-icon').innerHTML = iconMarkup('library');
    document.querySelector('#breadcrumb-section').textContent = 'Library';
    document.querySelector('#breadcrumb-item').textContent = 'Empty';
    document.querySelector('.content-tabs').hidden = true;
    document.querySelector('.editor-statusbar').hidden = true;
    document.querySelector('#editor-region').innerHTML = emptyState(
      'library',
      'Your canonical library is empty',
      canWrite()
        ? 'Create an artifact from the New button or command palette. New artifacts start without provider targets.'
        : 'Pair with write scope to create the first canonical artifact.',
    );
    return;
  }
  document.querySelector('#artifact-title').textContent = artifact.title;
  document.querySelector('#artifact-meta').textContent =
    `${titleCase(artifact.kind)} · ${titleCase(artifact.lifecycle)} · Revision ${artifact.revision}`;
  document.querySelector('#artifact-kind-icon').innerHTML = iconMarkup(
    kindIcon(artifact.kind),
  );
  document.querySelector('#breadcrumb-section').textContent = 'Library';
  document.querySelector('#breadcrumb-item').textContent = artifact.title;
  document.querySelector('.content-tabs').hidden = false;
  document.querySelector('.editor-statusbar').hidden = false;
  document.querySelectorAll('.content-tabs [data-view]').forEach((button) => {
    button.setAttribute(
      'aria-selected',
      String(button.dataset.view === state.contentView),
    );
  });
  renderArtifactView(artifact);
}

function renderArtifactView(artifact) {
  const region = document.querySelector('#editor-region');
  if (state.contentView === 'edit') {
    const lineCount = artifact.content.split('\n').length;
    region.innerHTML = `
      <div class="editor-shell">
        <div class="line-gutter" aria-hidden="true">${lineNumbers(lineCount)}</div>
        <textarea class="artifact-editor" spellcheck="false" aria-label="${canWrite() ? 'Edit' : 'Read'} ${escapeHtml(artifact.title)}" ${canWrite() ? '' : 'readonly'}>${escapeHtml(artifact.content)}</textarea>
      </div>
    `;
    const editor = region.querySelector('.artifact-editor');
    if (canWrite()) {
      editor.addEventListener('input', () => {
        artifact.content = editor.value;
        region.querySelector('.line-gutter').textContent = lineNumbers(
          editor.value.split('\n').length,
        );
        markCanonicalEdit(artifact);
        updateDocumentStats(artifact);
      });
    }
  } else if (state.contentView === 'preview') {
    region.innerHTML = `<article class="markdown-preview">${markdownToHtml(artifact.content)}</article>`;
  } else {
    const history =
      artifact.history?.length > 0
        ? artifact.history.map((revision) => [
            revision.reason,
            historyTitle(revision.reason),
            revision.revision.slice(0, 12),
            formatDate(revision.createdAt),
            revision.revision,
          ])
        : state.runtimeMode === 'live'
          ? []
          : [
              ['edit', 'Content updated', 'rev-8 · 0f2c28a', 'Today, 10:41 AM'],
              ['edit', 'Provider targets changed', 'rev-7 · 944bc31', 'Yesterday'],
              ['rename', 'Renamed from agent-baseline', 'rev-6 · 81c664f', 'Jul 28'],
              ['restore', 'Restored canonical revision', 'rev-5 · 79d14fe', 'Jul 26'],
            ];
    region.innerHTML = `
      <div class="history-list">
        ${
          history.length === 0
            ? emptyState(
                'history',
                'No earlier revisions',
                'Reglet creates recoverable history before the first canonical change.',
              )
            : history
                .map(
                  ([icon, title, revision, time, fullRevision]) => `
              <div class="history-row">
                <span class="history-icon">${iconMarkup(icon === 'edit' ? 'file' : 'history')}</span>
                <span class="history-copy">
                  <strong>${title}</strong>
                  <span class="history-revision">${revision}</span>
                </span>
                <time>${time}</time>
                ${
                  fullRevision
                    ? `<button class="button button-quiet" type="button" data-restore-revision="${fullRevision}">Restore</button>`
                    : ''
                }
              </div>
            `,
                )
                .join('')
        }
      </div>
    `;
    region.querySelectorAll('[data-restore-revision]').forEach((button) => {
      button.addEventListener('click', () =>
        confirmHistoryRestore(artifact, button.dataset.restoreRevision),
      );
    });
  }
  updateDocumentStats(artifact);
}

function confirmHistoryRestore(artifact, revision) {
  openActionSheet(
    `Restore ${artifact.title}?`,
    'The current canonical state is snapshotted before recovery.',
    `
      <div class="sheet-callout">Restore revision ${escapeHtml(revision.slice(0, 12))}. Provider projections become pending and remain unchanged until Apply.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-primary" type="button" data-confirm-history-restore>Restore revision</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-history-restore]')
    .addEventListener('click', () =>
      void restoreHistoryRevision(artifact, revision),
    );
}

async function restoreHistoryRevision(artifact, revision) {
  try {
    await state.runtimeClient.execute({
      type: 'history.undo',
      artifact: artifact.id,
      revision,
      confirmed: true,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast(
      'Canonical revision restored',
      'The previous current state remains recoverable in history.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not restore this revision');
  }
}

function historyTitle(reason) {
  if (reason === 'edit') return 'Content updated';
  if (reason === 'rename') return 'Artifact renamed';
  if (reason === 'archive') return 'Lifecycle changed';
  if (reason === 'delete') return 'Recovery snapshot created';
  return 'Revision restored';
}

function markCanonicalEdit(artifact) {
  clearTimeout(markCanonicalEdit.timeout);
  const indicator = document.querySelector('#save-indicator');
  const draftStatus = document.querySelector('#draft-status');
  indicator.className = 'status-dot status-dot-warning';
  draftStatus.textContent = 'Saving canonical edit…';
  Object.values(artifact.projections).forEach((item) => {
    if (item.status === 'applied') item.status = 'pending';
  });
  markCanonicalEdit.timeout = setTimeout(async () => {
    if (state.runtimeMode === 'live') {
      try {
        const result = await state.runtimeClient.execute({
          type: 'library.save',
          artifact: artifact.id,
          content: artifact.content,
        });
        const saved =
          typeof result.data === 'object' &&
          result.data !== null &&
          result.data.saved === true;
        indicator.className = saved
          ? 'status-dot status-dot-success'
          : 'status-dot status-dot-warning';
        draftStatus.textContent = saved
          ? 'Saved locally · projection pending'
          : 'Draft not applied · fix validation errors';
        await refreshRuntimeSnapshot();
        if (!saved) {
          showToast(
            'Draft not applied',
            'The invalid edit is preserved on this machine and was not projected or synced.',
          );
        }
      } catch (error) {
        indicator.className = 'status-dot status-dot-error';
        draftStatus.textContent = 'Canonical edit not saved';
        handleRuntimeError(error, 'Could not save the canonical edit');
      }
      return;
    }
    artifact.revision += 1;
    indicator.className = 'status-dot status-dot-success';
    draftStatus.textContent = `Canonical revision ${artifact.revision}`;
    renderProviderList();
    renderProjectionDetail();
    updateApplyButtons();
  }, 480);
}

function lineNumbers(count) {
  return Array.from({ length: count }, (_, index) => index + 1).join('\n');
}

function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  let listType = null;
  const result = [];

  function closeList() {
    if (listType) {
      result.push(`</${listType}>`);
      listType = null;
    }
  }

  lines.forEach((sourceLine) => {
    const line = escapeHtml(sourceLine);
    if (line.startsWith('### ')) {
      closeList();
      result.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
    } else if (line.startsWith('## ')) {
      closeList();
      result.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`);
    } else if (line.startsWith('# ')) {
      closeList();
      result.push(`<h1>${inlineMarkdown(line.slice(2))}</h1>`);
    } else if (line.startsWith('- ')) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        result.push('<ul>');
      }
      result.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        result.push('<ol>');
      }
      result.push(`<li>${inlineMarkdown(line.replace(/^\d+\. /, ''))}</li>`);
    } else if (line.trim().length === 0) {
      closeList();
    } else {
      closeList();
      result.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  });
  closeList();
  return result.join('');
}

function inlineMarkdown(value) {
  return value.replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderInboxContent() {
  const discovery = getSelectedDiscovery();
  if (discovery === undefined) {
    document.querySelector('#artifact-title').textContent = 'Project Inbox';
    document.querySelector('#artifact-meta').textContent = 'No discovery selected';
    document.querySelector('#artifact-kind-icon').innerHTML = iconMarkup('inbox');
    document.querySelector('#breadcrumb-section').textContent = 'Project Inbox';
    document.querySelector('#breadcrumb-item').textContent = 'Empty';
    document.querySelector('.content-tabs').hidden = true;
    document.querySelector('.editor-statusbar').hidden = true;
    document.querySelector('#editor-region').innerHTML = emptyState(
      'inbox',
      'No project artifacts discovered',
      'Add a development root or rescan existing roots. Project files remain read-only.',
    );
    return;
  }
  document.querySelector('#artifact-title').textContent = discovery.title;
  document.querySelector('#artifact-meta').textContent =
    `${discovery.state} discovery · ${discovery.scope}`;
  document.querySelector('#artifact-kind-icon').innerHTML = iconMarkup(
    discovery.icon,
  );
  document.querySelector('#breadcrumb-section').textContent = 'Project Inbox';
  document.querySelector('#breadcrumb-item').textContent = discovery.title;
  document.querySelector('.content-tabs').hidden = true;
  document.querySelector('.editor-statusbar').hidden = true;
  document.querySelector('#editor-region').innerHTML = `
    <div class="markdown-preview">
      <h1>${escapeHtml(discovery.title)}</h1>
      <p><code>${escapeHtml(discovery.path)}</code></p>
      <h2>Source scope</h2>
      <p>${escapeHtml(discovery.description)}</p>
      <h2>Recognized by</h2>
      <p>${escapeHtml(discovery.recognizedBy.join(', '))}</p>
      ${
        discovery.kind === 'skill'
          ? `
            <h2>Trust review</h2>
            ${
              discovery.skillRisks?.length > 0
                ? `<div class="skill-risk-list">${discovery.skillRisks
                    .map(
                      (risk) => `
                        <div class="issue-banner ${risk.severity === 'error' ? 'error' : ''}">
                          <div class="issue-heading">${iconMarkup('warning')} ${escapeHtml(titleCase(risk.code))} · ${escapeHtml(risk.relPath)}</div>
                          <p>${escapeHtml(risk.message)}</p>
                        </div>
                      `,
                    )
                    .join('')}</div>`
                : '<p>No executable, binary, symlink, or oversized-file risk was found during the non-executing scan.</p>'
            }
          `
          : ''
      }
      <h2>Choose how this enters the library</h2>
      <div class="scope-choice-list">
        ${promotionChoices(discovery)
          .map(
            (choice, index) => `
              <label class="scope-choice">
                <input type="radio" name="promotion-mode" value="${choice.mode}" ${index === 0 ? 'checked' : ''}>
                <span>
                  <strong>${escapeHtml(choice.title)}${index === 0 ? ' · Recommended' : ''}</strong>
                  <p>${escapeHtml(choice.description)}</p>
                </span>
              </label>
            `,
          )
          .join('')}
      </div>
      <h2>Provider targets</h2>
      <p>Promotion never selects every provider automatically. Choose where this artifact may be projected.</p>
      <div class="promotion-targets">
        ${discovery.recognizedByIds
          .map((providerId) => {
            const provider = providerCatalog.find(
              (candidate) => candidate.id === providerId,
            );
            return `
              <label class="target-choice">
                <input type="checkbox" name="promotion-target" value="${escapeHtml(providerId)}">
                <span>${escapeHtml(provider?.name ?? titleCase(providerId))}</span>
              </label>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
}

function promotionChoices(discovery) {
  if (discovery.kind === 'skill') {
    return [
      {
        mode: 'skill',
        title: 'Promote reviewed skill',
        description:
          'Review the complete file inventory, then create a skill or merge selected files into one already in the library.',
      },
    ];
  }
  if (discovery.kind === 'mcp') {
    return [
      {
        mode: 'mcp',
        title: 'Import MCP server',
        description:
          'Compare normalized definitions, extract machine paths, and bind likely credentials through keychain references.',
      },
    ];
  }
  const skillFirst = discovery.recommendation === 'Convert to skill';
  const choices = [
    {
      mode: 'global-instruction',
      title: 'Global instruction',
      description:
        'Applies across selected providers and projects. Repository scope is not preserved.',
    },
    {
      mode: 'convert-to-skill',
      title: 'Convert to skill',
      description:
        'Preserves task-specific guidance for deliberate or agent-requested use.',
    },
    {
      mode: 'disabled-library-draft',
      title: 'Disabled library draft',
      description:
        'Keeps the source for editing without targeting any provider.',
    },
  ];
  return skillFirst ? [choices[1], choices[0], choices[2]] : choices;
}

function renderProvidersContent() {
  const provider = getSelectedProvider();
  const effective = provider.effective;
  const shadowingIssues =
    effective?.issues?.filter((issue) => issue.code === 'shadowed') ?? [];
  const unmanagedEntries = effective?.unmanagedMcpEntries ?? [];
  const knownProjectFiles = effective?.knownProjectFiles ?? [];
  document.querySelector('#artifact-title').textContent = provider.name;
  document.querySelector('#artifact-meta').textContent =
    `${provider.detected === false ? 'Not detected' : 'Detected'} · ${provider.enrolled?.provider === false ? 'Not enrolled' : 'Enrolled'} · ${provider.documentation}`;
  document.querySelector('#artifact-kind-icon').innerHTML =
    iconMarkup('providers');
  document.querySelector('#breadcrumb-section').textContent = 'Providers';
  document.querySelector('#breadcrumb-item').textContent = provider.name;
  document.querySelector('.content-tabs').hidden = true;
  document.querySelector('.editor-statusbar').hidden = true;

  const targeted = artifacts.filter(
    (artifact) => artifact.projections[provider.id]?.status !== 'not-targeted',
  );
  document.querySelector('#editor-region').innerHTML = `
    <div class="provider-overview">
      <div class="provider-overview-row">
        <strong>Managed projection</strong>
        <p>${escapeHtml(provider.destination)}<br>${targeted.length} canonical artifacts contribute to this output.</p>
        ${canAdminister() ? '<button type="button" class="button button-quiet" data-provider-action="reveal">Reveal</button>' : ''}
      </div>
      <div class="provider-overview-row">
        <strong>Shadowing</strong>
        <p>${escapeHtml(shadowingIssues[0]?.message ?? 'No unmanaged override is shadowing the managed global projection.')}</p>
        <span class="provider-state ${shadowingIssues.length > 0 ? 'state-drifted' : 'state-applied'}">${shadowingIssues.length > 0 ? `${shadowingIssues.length} warning` : 'Clear'}</span>
      </div>
      <div class="provider-overview-row">
        <strong>Unmanaged entries</strong>
        <p>${escapeHtml(unmanagedEntries.length > 0 ? `${unmanagedEntries.join(', ')} remain provider-owned and are preserved during merges.` : 'Provider-owned MCP entries are preserved when Reglet merges its managed definitions.')}</p>
        <span class="provider-state state-applied">${unmanagedEntries.length || 'Preserved'}</span>
      </div>
      <div class="provider-overview-row">
        <strong>Known project files</strong>
        <p>${knownProjectFiles.length} files across configured development roots. Project content remains local and read-only.</p>
        ${canAdminister() ? '<button type="button" class="button button-quiet" data-provider-action="inbox">Open Inbox</button>' : '<span class="provider-state state-not-targeted">Admin only</span>'}
      </div>
    </div>
  `;

  document
    .querySelector('[data-provider-action="reveal"]')
    ?.addEventListener('click', () => {
      const content =
        effective?.managedProjection?.rulesPath !== null
          ? 'rules'
          : effective?.managedProjection?.mcpPath !== null
            ? 'mcp'
            : 'skills';
      void openProviderDestination(provider, content, true);
    });
  document
    .querySelector('[data-provider-action="inbox"]')
    ?.addEventListener('click', () => {
      state.section = 'inbox';
      render();
    });
}

function renderActivityContent() {
  document.querySelector('#artifact-title').textContent = 'Local activity';
  document.querySelector('#artifact-meta').textContent =
    'Structured and secret-redacted';
  document.querySelector('#artifact-kind-icon').innerHTML =
    iconMarkup('activity');
  document.querySelector('#breadcrumb-section').textContent = 'Activity';
  document.querySelector('#breadcrumb-item').textContent = 'Recent events';
  document.querySelector('.content-tabs').hidden = true;
  document.querySelector('.editor-statusbar').hidden = true;
  document.querySelector('#editor-region').innerHTML = `
    <div class="activity-list">
      ${activity
        .map(
          (item) => `
            <div class="activity-row">
              <span class="history-icon">${iconMarkup(item.icon)}</span>
              <span class="history-copy">
                <strong>${escapeHtml(item.action)}</strong>
                <span>${escapeHtml(item.detail)}</span>
              </span>
              <time>${escapeHtml(item.time)}</time>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderSettingsContent() {
  const setting = state.selectedSetting;
  document.querySelector('#artifact-title').textContent = setting;
  document.querySelector('#artifact-meta').textContent = settingsSubtitle(setting);
  document.querySelector('#artifact-kind-icon').innerHTML =
    iconMarkup('settings');
  document.querySelector('#breadcrumb-section').textContent = 'Settings';
  document.querySelector('#breadcrumb-item').textContent = setting;
  document.querySelector('.content-tabs').hidden = true;
  document.querySelector('.editor-statusbar').hidden = true;
  const region = document.querySelector('#editor-region');
  if (setting === 'Development roots') {
    renderDevelopmentRootsSettings(region);
  } else if (setting === 'Secrets') {
    renderSecretSettings(region);
  } else if (setting === 'Remote access') {
    renderRemoteSettings(region);
  } else if (setting === 'Sync & devices') {
    renderSyncSettings(region);
  } else if (setting === 'Backups & recovery') {
    renderRecoverySettings(region);
  } else if (setting === 'Diagnostics') {
    renderDiagnosticsSettings(region);
  } else {
    renderGeneralSettings(region);
  }
}

function settingsSubtitle(setting) {
  if (setting === 'Development roots') return 'Local, read-only project intake';
  if (setting === 'Secrets') return 'OS keychain bindings';
  if (setting === 'Remote access') return 'Pairing, scopes, and sessions';
  if (setting === 'Sync & devices') return 'Optional canonical-only sync';
  if (setting === 'Backups & recovery') return 'Provider originals and artifact history';
  if (setting === 'Diagnostics') return 'Metadata-only runtime health';
  return 'Local manager preferences';
}

function renderGeneralSettings(region) {
  const theme = document.documentElement.dataset.theme ?? 'system';
  const reopenChangedIgnored = preferenceBoolean(
    'reglet.reopen-changed-ignored',
    true,
  );
  region.innerHTML = `
    <div class="settings-list">
      <div class="settings-row">
        <span>
          <strong>Appearance</strong>
          <p>Light and dark themes are co-primary. System follows your operating system.</p>
        </span>
        <div class="segmented-control" role="group" aria-label="Appearance">
          ${['system', 'light', 'dark']
            .map(
              (option) => `<button type="button" data-theme-choice="${option}" aria-pressed="${theme === option}">${titleCase(option)}</button>`,
            )
            .join('')}
        </div>
      </div>
      <div class="settings-row">
        <span>
          <strong>Reopen changed ignored discoveries</strong>
          <p>A changed source can return to Project Inbox.</p>
        </span>
        <label class="switch">
          <input type="checkbox" data-preference="reopen-changed-ignored" ${reopenChangedIgnored ? 'checked' : ''} aria-label="Reopen changed ignored discoveries">
          <span aria-hidden="true"></span>
        </label>
      </div>
      <div class="settings-row">
        <span>
          <strong>Crash reporting</strong>
          <p>Off. No crash upload endpoint is configured.</p>
        </span>
        <span class="provider-state state-not-targeted">Off</span>
      </div>
      <div class="settings-row">
        <span>
          <strong>Application updates</strong>
          <p>Signed desktop builds check daily. Downloads require approval and install on restart.</p>
        </span>
        <span class="provider-state state-applied">Daily</span>
      </div>
    </div>
  `;
  region.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => setTheme(button.dataset.themeChoice));
  });
  region
    .querySelector('[data-preference="reopen-changed-ignored"]')
    ?.addEventListener('change', (event) => {
      localStorage.setItem(
        'reglet.reopen-changed-ignored',
        event.currentTarget.checked ? 'true' : 'false',
      );
    });
}

function renderDevelopmentRootsSettings(region) {
  const roots = state.runtimeSnapshot?.projectRoots ?? [];
  region.innerHTML = `
    <div class="settings-list">
      <form class="settings-row settings-form-row" id="add-root-form">
        <span><strong>Add development root</strong><p>Reglet scans recognized files without modifying project content.</p></span>
        <div class="inline-control">
          <input name="path" required placeholder="/Users/you/Code">
          <button class="button button-primary" type="submit">Add root</button>
        </div>
      </form>
      ${
        roots.length === 0
          ? emptyState(
              'inbox',
              'No development roots',
              'Add a local directory to discover project instructions, skills, and MCP files.',
            )
          : roots
              .map(
                (root) => `
                  <div class="settings-row">
                    <span>
                      <strong>${escapeHtml(root.label)}</strong>
                      <p>${escapeHtml(root.path)}${root.lastScannedAt ? ` · Scanned ${relativeTime(root.lastScannedAt)}` : ' · Not scanned yet'}</p>
                    </span>
                    <button class="button button-quiet" type="button" data-remove-root="${root.id}">Remove…</button>
                  </div>
                `,
              )
              .join('')
      }
    </div>
  `;
  region
    .querySelector('#add-root-form')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      void addDevelopmentRoot(event.currentTarget.elements.path.value);
    });
  region.querySelectorAll('[data-remove-root]').forEach((button) => {
    button.addEventListener('click', () => {
      const root = roots.find(
        (candidate) => candidate.id === button.dataset.removeRoot,
      );
      if (root) confirmRootRemoval(root);
    });
  });
}

function renderSecretSettings(region) {
  region.innerHTML = `
    <div class="settings-list">
      <form class="settings-row settings-form-row" id="secret-binding-form">
        <span>
          <strong>Bind a secret reference</strong>
          <p>The value is sent directly to the OS keychain. API responses expose binding state only.</p>
        </span>
        <div class="secret-fields">
          <input name="id" required autocomplete="off" placeholder="linear-api-token">
          <input name="value" required type="password" autocomplete="new-password" placeholder="Secret value">
          <button class="button button-primary" type="submit">Bind secret</button>
        </div>
      </form>
      <form class="settings-row settings-form-row" id="secret-status-form">
        <span><strong>Check or remove a binding</strong><p>Reglet never returns the keychain value.</p></span>
        <div class="inline-control">
          <input name="id" required autocomplete="off" placeholder="secret-reference">
          <button class="button button-quiet" type="submit">Check status</button>
          <button class="button button-quiet" type="button" data-delete-secret>Delete…</button>
        </div>
        <p class="inline-status" id="secret-status-result"></p>
      </form>
    </div>
  `;
  region
    .querySelector('#secret-binding-form')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      void bindSecret(event.currentTarget);
    });
  const statusForm = region.querySelector('#secret-status-form');
  statusForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void checkSecretStatus(event.currentTarget.elements.id.value);
  });
  statusForm
    .querySelector('[data-delete-secret]')
    .addEventListener('click', () => {
      const id = statusForm.elements.id.value.trim();
      if (id) confirmSecretDeletion(id);
    });
}

function renderRemoteSettings(region) {
  const remote = state.runtimeSnapshot?.remote ?? { enabled: false };
  const sessions = state.runtimeSnapshot?.sessions ?? [];
  region.innerHTML = `
    <div class="settings-list">
      <form class="settings-row settings-form-row" id="remote-form">
        <span>
          <strong>${remote.enabled ? 'Remote access enabled' : 'Remote access disabled'}</strong>
          <p>Prefer a tailnet endpoint or custom HTTPS. Enabling authorizes the next non-loopback <code>reglet serve</code> listener; raw LAN HTTP also requires its explicit CLI override.</p>
        </span>
        <div class="inline-control">
          <input name="endpoint" type="url" required value="${escapeHtml(remote.endpoint ?? '')}" placeholder="https://reglet.tailnet.example">
          <button class="button ${remote.enabled ? 'button-danger' : 'button-primary'}" type="submit">${remote.enabled ? 'Disable' : 'Enable'}</button>
        </div>
        ${remote.warning ? `<div class="sheet-callout danger">${escapeHtml(remote.warning)}</div>` : ''}
      </form>
      <div class="settings-row settings-form-row">
        <span><strong>Create one-use pairing credential</strong><p>Credentials expire after ten minutes. The resulting session is random, hashed locally, scoped, and revocable.</p></span>
        <div class="inline-control">
          <button class="button button-quiet" type="button" data-create-pair="read">Read</button>
          <button class="button button-quiet" type="button" data-create-pair="write">Write</button>
          <button class="button button-primary" type="button" data-create-pair="admin">Admin</button>
        </div>
      </div>
      <div class="settings-row">
        <span><strong>Paired sessions</strong><p>Tokens are stored only as hashes and can be revoked immediately.</p></span>
      </div>
      ${sessions
        .map(
          (session) => `
            <div class="settings-row">
              <span><strong>${titleCase(session.scope)} session</strong><p>${escapeHtml(session.id.slice(0, 12))} · Created ${relativeTime(session.createdAt)}${session.revokedAt ? ' · Revoked' : ''}</p></span>
              <button class="button button-quiet" type="button" data-revoke-session="${session.id}" ${session.revokedAt ? 'disabled' : ''}>Revoke…</button>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
  region.querySelector('#remote-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void toggleRemoteAccess(remote, event.currentTarget.elements.endpoint.value);
  });
  region.querySelectorAll('[data-revoke-session]').forEach((button) => {
    button.addEventListener('click', () =>
      confirmSessionRevocation(button.dataset.revokeSession),
    );
  });
  region.querySelectorAll('[data-create-pair]').forEach((button) => {
    button.addEventListener('click', () =>
      void createPairingCredential(button.dataset.createPair),
    );
  });
}

async function createPairingCredential(scope) {
  if (state.runtimeMode !== 'live') {
    showToast(
      'Pairing credential',
      `${titleCase(scope)} credential would expire in ten minutes.`,
    );
    return;
  }
  try {
    const result = await state.runtimeClient.execute({
      type: 'pair.start',
      scope,
    });
    const pairing = result.data;
    openActionSheet(
      `${titleCase(scope)} pairing credential`,
      'Use this credential once before it expires. It cannot be recovered afterward.',
      `
        <div class="pairing-code" aria-label="Pairing code">${escapeHtml(pairing.code)}</div>
        <div class="sheet-callout">
          Expires ${escapeHtml(formatDate(pairing.expiresAt))}. Read sessions cannot mutate. Write sessions cannot access secrets, roots, sessions, or network settings.
        </div>
        <div class="sheet-actions">
          <button class="button button-quiet" type="button" data-copy-pair>Copy code</button>
          <button class="button button-primary" type="button" data-sheet-cancel>Done</button>
        </div>
      `,
    );
    document.querySelector('[data-copy-pair]')?.addEventListener('click', () => {
      void navigator.clipboard?.writeText(pairing.code);
      showToast('Pairing code copied', 'It remains valid for one use only.');
    });
  } catch (error) {
    handleRuntimeError(error, 'Could not create a pairing credential');
  }
}

function renderSyncSettings(region) {
  const sync = state.runtimeSnapshot?.sync ?? { configured: false };
  region.innerHTML = `
    <div class="settings-list">
      <div class="settings-row">
        <span>
          <strong>${sync.configured ? 'Canonical sync configured' : 'Sync is off'}</strong>
          <p>Only canonical library content and tombstones sync. Project paths, drafts, trust decisions, machine overrides, activity, and secrets stay local.</p>
        </span>
        <span class="provider-state ${sync.configured ? 'state-applied' : 'state-not-targeted'}">${sync.configured ? 'Configured' : 'Local only'}</span>
      </div>
      <form class="settings-row settings-form-row" id="sync-form">
        <span>
          <strong>Self-hosted sync server</strong>
          <p>HTTPS is required except for a loopback server. The credential is stored only in the OS keychain.</p>
        </span>
        <div class="secret-fields">
          <input name="serverUrl" type="url" required value="${escapeHtml(sync.serverUrl ?? '')}" placeholder="https://sync.example.com">
          <input name="token" type="password" autocomplete="new-password" placeholder="${sync.configured ? 'Leave blank to keep current credential' : 'Sync server token'}">
          <button class="button button-primary" type="submit">${sync.configured ? 'Update' : 'Configure'}</button>
        </div>
      </form>
      ${
        sync.configured
          ? `
            <div class="settings-row">
              <span><strong>Sync state</strong><p>${titleCase(sync.state ?? 'ready')}${sync.lastSyncedAt ? ` · ${relativeTime(sync.lastSyncedAt)}` : ''}${sync.message ? ` · ${escapeHtml(sync.message)}` : ''}</p></span>
              <div class="sheet-actions">
                <button class="button button-quiet" type="button" data-sync-now>Sync now</button>
                <button class="button button-quiet" type="button" data-sync-disable>Disable…</button>
              </div>
            </div>
          `
          : ''
      }
      ${(sync.blockedFiles ?? [])
        .map(
          (file) => `
            <div class="settings-row">
              <span><strong>Sync blocked · ${escapeHtml(file.path)}</strong><p>${escapeHtml(file.issue)} Local management and provider apply remain available.</p></span>
              <span class="provider-state state-blocked">${formatBytes(file.size)}</span>
            </div>
          `,
        )
        .join('')}
      ${(sync.conflicts ?? [])
        .map(
          (conflict) => `
            <div class="settings-row">
              <span><strong>${escapeHtml(conflict.path)}</strong><p>${escapeHtml(conflict.message)}${conflict.binary ? ' Both binary variants are retained locally.' : ''}</p></span>
              <div class="sheet-actions">
                <button class="button button-quiet" type="button" data-sync-resolve="${escapeHtml(conflict.path)}" data-choice="ours">Keep this machine</button>
                <button class="button button-quiet" type="button" data-sync-resolve="${escapeHtml(conflict.path)}" data-choice="theirs">Use remote</button>
              </div>
            </div>
          `,
        )
        .join('')}
      <div class="sheet-callout">Self-hosted storage contains canonical content in plaintext unless the operator encrypts storage. Hosted sync remains unavailable until end-to-end encryption exists.</div>
    </div>
  `;
  region.querySelector('#sync-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void configureSync(event.currentTarget);
  });
  region
    .querySelector('[data-sync-now]')
    ?.addEventListener('click', () => void syncNow());
  region
    .querySelector('[data-sync-disable]')
    ?.addEventListener('click', confirmSyncDisable);
  region.querySelectorAll('[data-sync-resolve]').forEach((button) => {
    button.addEventListener('click', () =>
      confirmSyncResolution(
        button.dataset.syncResolve,
        button.dataset.choice,
      ),
    );
  });
}

function renderRecoverySettings(region) {
  region.innerHTML = `
    <div class="settings-list">
      <div class="settings-row">
        <span><strong>Provider originals</strong><p>Original provider outputs are retained until that provider is explicitly purged.</p></span>
      </div>
      ${providerCatalog
        .map(
          (provider) => `
            <div class="settings-row">
              <span><strong>${provider.name}</strong><p>Restore the latest retained provider original after reviewing the destination.</p></span>
              <div class="sheet-actions">
                <button class="button button-quiet" type="button" data-restore-provider="${provider.id}">Restore…</button>
                <button class="button button-quiet" type="button" data-purge-provider="${provider.id}">Purge…</button>
              </div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
  region.querySelectorAll('[data-restore-provider]').forEach((button) => {
    const provider = providerCatalog.find(
      (candidate) => candidate.id === button.dataset.restoreProvider,
    );
    if (provider) {
      button.addEventListener('click', () => confirmProviderRestore(provider));
    }
  });
  region.querySelectorAll('[data-purge-provider]').forEach((button) => {
    const provider = providerCatalog.find(
      (candidate) => candidate.id === button.dataset.purgeProvider,
    );
    if (provider) {
      button.addEventListener('click', () => confirmBackupPurge(provider));
    }
  });
}

function renderDiagnosticsSettings(region) {
  const diagnostics = state.runtimeSnapshot?.diagnostics ?? {};
  region.innerHTML = `
    <div class="settings-list">
      ${[
        ['Runtime', diagnostics.runtime?.version ?? 'Unknown', diagnostics.ready !== false],
        ['Database', `Migration ${diagnostics.database?.migrationVersion ?? 'unknown'}`, diagnostics.database?.ready === true],
        ['Canonical directory', diagnostics.canonicalDirectory?.ready ? 'Ready' : 'Unavailable', diagnostics.canonicalDirectory?.ready === true],
        ['Project scanning', diagnostics.watcher?.mode === 'explicit-scan' ? 'Explicit rescan · no background watcher' : diagnostics.watcher?.detail ?? 'Unknown', diagnostics.watcher?.ready === true],
        ['Providers', `${diagnostics.providers?.detected ?? 0} detected · ${diagnostics.providers?.enrolled ?? 0} enrolled`, true],
        ['Sync', diagnostics.sync?.configured ? `${titleCase(diagnostics.sync.state ?? 'ready')} · ${diagnostics.sync.conflictCount ?? 0} conflicts · ${diagnostics.sync.blockedFileCount ?? 0} blocked files` : 'Off · canonical library remains fully local', true],
        ['Project roots', `${diagnostics.projectRoots?.count ?? 0} configured · paths excluded from export`, true],
        ['Activity', `${diagnostics.activity?.countSampled ?? 0} records sampled · content excluded`, true],
        ['Secrets', diagnostics.secretsIncluded ? 'Included' : 'Excluded', diagnostics.secretsIncluded !== true],
        ['Authorization', diagnostics.authorizationIncluded ? 'Included' : 'Excluded', diagnostics.authorizationIncluded !== true],
      ]
        .map(
          ([name, detail, healthy]) => `
            <div class="settings-row">
              <span><strong>${name}</strong><p>${detail}</p></span>
              <span class="provider-state ${healthy ? 'state-applied' : 'state-error'}">${healthy ? 'Ready' : 'Attention'}</span>
            </div>
          `,
        )
        .join('')}
      <div class="sheet-callout">Diagnostic export defaults to metadata only and excludes artifact bodies, project paths, environment values, secrets, and authorization data.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-export-diagnostics>${iconMarkup('external')} Export metadata</button>
      </div>
    </div>
  `;
  region
    .querySelector('[data-export-diagnostics]')
    ?.addEventListener('click', () => void exportDiagnostics());
}

function setTheme(theme) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  localStorage.setItem('reglet.theme', theme);
  renderContent();
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function exportDiagnostics() {
  try {
    const diagnostics =
      state.runtimeMode === 'live'
        ? (
            await state.runtimeClient.execute(
              { type: 'diagnostics' },
              { optimistic: false },
            )
          ).data
        : {
            ready: true,
            runtime: { version: 'preview', platform: 'browser' },
            projectRoots: { count: 3, pathsIncluded: false },
            activity: { countSampled: activity.length, contentIncluded: false },
            secretsIncluded: false,
            authorizationIncluded: false,
          };
    const blob = new Blob([`${JSON.stringify(diagnostics, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reglet-diagnostics-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(
      'Diagnostics exported',
      'Metadata only; artifact content, project paths, secrets, and sessions were excluded.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not export diagnostics');
  }
}

async function configureSync(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    if (form.elements.token.value.length > 0) {
      await state.runtimeClient.execute({
        type: 'secret.set',
        id: 'reglet-sync-token',
        value: form.elements.token.value,
      });
      form.elements.token.value = '';
    }
    await state.runtimeClient.execute({
      type: 'sync.configure',
      serverUrl: form.elements.serverUrl.value,
    });
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      'Canonical sync configured',
      'Project data, local drafts, trust, activity, and secrets remain excluded.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not configure canonical sync');
  } finally {
    button.disabled = false;
    button.textContent = 'Update';
  }
}

async function syncNow() {
  showToast('Syncing canonical library', 'Local editing remains available.');
  try {
    const result = await state.runtimeClient.execute({ type: 'sync.now' });
    await refreshRuntimeSnapshot({ loadSelected: false });
    const status = result.data;
    showToast(
      status.state === 'conflict'
        ? 'Sync completed with conflicts'
        : status.state === 'blocked'
          ? 'Sync is blocked'
          : 'Canonical library synced',
      status.message ??
        'Clean canonical files are up to date on the sync server.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Canonical sync failed');
  }
}

function confirmSyncDisable() {
  openActionSheet(
    'Disable canonical sync?',
    'Local library management and provider apply remain fully available.',
    `
      <div class="sheet-callout">The local canonical library and sync base are retained. No remote file is deleted.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-sync-disable>Disable sync</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-sync-disable]')
    .addEventListener('click', () => void disableSync());
}

async function disableSync() {
  try {
    await state.runtimeClient.execute({ type: 'sync.disable' });
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast('Canonical sync disabled', 'The manager is fully local again.');
  } catch (error) {
    handleRuntimeError(error, 'Could not disable canonical sync');
  }
}

function confirmSyncResolution(filePath, choice) {
  openActionSheet(
    `Resolve ${filePath}?`,
    'The unselected state remains recoverable in local conflict storage.',
    `
      <div class="sheet-callout danger">${choice === 'ours' ? 'Keep the content currently on this machine.' : 'Replace the local canonical file with the remote content.'} Sync again afterward to publish the resolution.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-primary" type="button" data-confirm-sync-resolution>Resolve conflict</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-sync-resolution]')
    .addEventListener('click', () =>
      void resolveSyncConflict(filePath, choice),
    );
}

async function resolveSyncConflict(filePath, choice) {
  try {
    await state.runtimeClient.execute({
      type: 'sync.resolve',
      path: filePath,
      choice,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast(
      'Sync conflict resolved',
      'Sync again to publish the selected canonical state.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not resolve the sync conflict');
  }
}

async function addDevelopmentRoot(rootPath) {
  try {
    await state.runtimeClient.execute({
      type: 'project.root.add',
      path: rootPath,
    });
    await state.runtimeClient.execute({
      type: 'project.scan',
      reappearChangedIgnored: preferenceBoolean(
        'reglet.reopen-changed-ignored',
        true,
      ),
    });
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      'Development root added',
      'Recognized project artifacts were scanned locally.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not add the development root');
  }
}

function confirmRootRemoval(root) {
  openActionSheet(
    `Remove ${root.label}?`,
    'The project files remain untouched.',
    `
      <div class="sheet-callout danger">This removes the root, its discovery index, ignored rules, and local project search records from Reglet. Canonical promotions are retained.</div>
      <div class="path-well"><span class="path-value">${escapeHtml(root.path)}</span></div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-root-removal>Remove root</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-root-removal]')
    .addEventListener('click', () => void removeDevelopmentRoot(root.id));
}

async function removeDevelopmentRoot(rootId) {
  try {
    await state.runtimeClient.execute({
      type: 'project.root.remove',
      rootId,
      confirmed: true,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      'Development root removed',
      'No project file was changed or deleted.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not remove the development root');
  }
}

async function bindSecret(form) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Binding…';
  try {
    const id = form.elements.id.value.trim();
    await state.runtimeClient.execute({
      type: 'secret.set',
      id,
      value: form.elements.value.value,
    });
    form.elements.value.value = '';
    showToast(
      'Secret bound',
      `${id} is available from the OS keychain on this machine.`,
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not bind the secret');
  } finally {
    button.disabled = false;
    button.textContent = 'Bind secret';
  }
}

async function checkSecretStatus(id) {
  const output = document.querySelector('#secret-status-result');
  try {
    const result = await state.runtimeClient.execute(
      { type: 'secret.status', id },
      { optimistic: false },
    );
    output.textContent = result.data.bound
      ? `${id} is bound on this machine.`
      : `${id} is unbound on this machine.`;
  } catch (error) {
    handleRuntimeError(error, 'Could not check the secret binding');
  }
}

function confirmSecretDeletion(id) {
  openActionSheet(
    `Delete ${id}?`,
    'Only the local OS keychain binding is removed.',
    `
      <div class="sheet-callout danger">Affected MCP projections become blocked until this reference is bound again. Canonical definitions and sync data are unchanged.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-secret-delete>Delete binding</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-secret-delete]')
    .addEventListener('click', () => void deleteSecret(id));
}

async function deleteSecret(id) {
  try {
    await state.runtimeClient.execute({ type: 'secret.delete', id });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast('Secret binding deleted', 'Canonical content was unchanged.');
  } catch (error) {
    handleRuntimeError(error, 'Could not delete the secret binding');
  }
}

async function toggleRemoteAccess(remote, endpoint) {
  try {
    await state.runtimeClient.execute(
      remote.enabled
        ? { type: 'remote.disable' }
        : { type: 'remote.enable', endpoint },
    );
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      remote.enabled ? 'Remote access disabled' : 'Remote access enabled',
      remote.enabled
        ? 'Existing sessions remain revocable from this machine.'
        : 'Create scoped one-use pairing codes from the CLI.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not change remote access');
  }
}

function confirmSessionRevocation(sessionId) {
  openActionSheet(
    'Revoke paired session?',
    'Revocation takes effect on the next HTTP or WebSocket authorization.',
    `
      <div class="sheet-callout danger">Session ${escapeHtml(sessionId.slice(0, 12))} will no longer be able to read or change Reglet.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-session-revoke>Revoke session</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-session-revoke]')
    .addEventListener('click', () => void revokeSession(sessionId));
}

async function revokeSession(sessionId) {
  try {
    await state.runtimeClient.execute({
      type: 'session.revoke',
      sessionId,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast('Session revoked', 'Its stored token hash is no longer valid.');
  } catch (error) {
    handleRuntimeError(error, 'Could not revoke the session');
  }
}

function confirmProviderRestore(provider) {
  openActionSheet(
    `Restore ${provider.name} original?`,
    'The current provider output receives a safety backup first.',
    `
      <div class="sheet-callout danger">Reglet will restore retained provider originals for ${provider.name}. Canonical library content is unchanged.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-provider-restore>Restore provider</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-provider-restore]')
    .addEventListener('click', () => void restoreProvider(provider));
}

async function restoreProvider(provider) {
  try {
    await state.runtimeClient.execute({
      type: 'providers.restore',
      provider: provider.id,
      confirmed: true,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast(
      `${provider.name} restored`,
      'The pre-restore provider state was retained as a safety backup.',
    );
  } catch (error) {
    handleRuntimeError(error, `Could not restore ${provider.name}`);
  }
}

function confirmBackupPurge(provider) {
  openActionSheet(
    `Purge ${provider.name} backups?`,
    'This removes retained provider originals and pre-restore safety copies.',
    `
      <div class="sheet-callout danger">This backup history cannot be recovered through Reglet. Canonical artifacts and current provider files are not changed.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-backup-purge>Purge backups</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-backup-purge]')
    .addEventListener('click', () => void purgeProviderBackups(provider));
}

async function purgeProviderBackups(provider) {
  try {
    await state.runtimeClient.execute({
      type: 'providers.purge-backups',
      provider: provider.id,
      confirmed: true,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      `${provider.name} backups purged`,
      'Canonical artifacts and current provider files were left unchanged.',
    );
  } catch (error) {
    handleRuntimeError(error, `Could not purge ${provider.name} backups`);
  }
}

function renderContent() {
  if (state.section === 'library') renderLibraryContent();
  else if (state.section === 'inbox') renderInboxContent();
  else if (state.section === 'providers') renderProvidersContent();
  else if (state.section === 'activity') renderActivityContent();
  else renderSettingsContent();
}

function renderProviderList() {
  const list = document.querySelector('#provider-list');
  if (state.section !== 'library') {
    list.innerHTML = '';
    return;
  }
  const artifact = getSelectedArtifact();
  if (artifact === undefined) {
    list.innerHTML = emptyState(
      'providers',
      'No projections yet',
      'Create a canonical artifact before selecting provider targets.',
    );
    document.querySelector('#inspector-summary').textContent = 'No artifact selected';
    return;
  }
  list.innerHTML = providerCatalog
    .map((provider) => {
      const item = artifact.projections[provider.id] ?? projection('not-targeted');
      const enrolled =
        artifact.kind === 'instruction'
          ? provider.enrolled?.instructions
          : artifact.kind === 'skill'
            ? provider.enrolled?.skills
            : provider.enrolled?.mcp;
      return `
        <button
          type="button"
          class="provider-row"
          data-provider="${escapeHtml(provider.id)}"
          aria-selected="${state.selectedProviderId === provider.id}"
        >
          <span class="provider-identity">
            <span class="provider-icon">${iconMarkup('providers')}</span>
            <span class="provider-copy">
              <span class="provider-name">${escapeHtml(provider.name)}</span>
              <small>${artifact.targets.includes(provider.id) ? 'Targeted' : 'Not targeted'} · ${enrolled === false ? 'Not enrolled' : 'Enrolled'}</small>
            </span>
          </span>
          <span class="provider-state state-${item.status}">${titleCase(item.status)}</span>
        </button>
      `;
    })
    .join('');
  list.querySelectorAll('[data-provider]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedProviderId = button.dataset.provider;
      renderProviderList();
      renderProjectionDetail();
    });
  });

  const targeted = Object.values(artifact.projections).filter(
    (item) => item.status !== 'not-targeted',
  );
  const pending = targeted.filter((item) => item.status === 'pending').length;
  const attention = targeted.filter((item) =>
    ['drifted', 'blocked', 'missing', 'error'].includes(item.status),
  ).length;
  document.querySelector('#inspector-summary').textContent =
    `${targeted.length} targeted · ${pending} pending${attention ? ` · ${attention} issue` : ''}`;
}

function renderProjectionDetail() {
  const detail = document.querySelector('#projection-detail');
  if (state.section === 'library') {
    const artifact = getSelectedArtifact();
    if (artifact === undefined) {
      detail.innerHTML = emptyState(
        'providers',
        'Projection details appear here',
        'Desired, applied, and observed state are shown after an artifact is created.',
      );
      return;
    }
    const provider = getSelectedProvider();
    const item = artifact.projections[provider.id] ?? projection('not-targeted');
    detail.innerHTML = projectionDetailMarkup(artifact, provider, item);
    wireProjectionActions(provider, item);
    return;
  }

  if (state.section === 'inbox') {
    const discovery = getSelectedDiscovery();
    if (discovery === undefined) {
      detail.innerHTML = emptyState(
        'inbox',
        'No discovery selected',
        'Rescan development roots to populate the Project Inbox.',
      );
      return;
    }
    detail.innerHTML = `
      <h3>${escapeHtml(discovery.recommendation)}</h3>
      <p>Promotion recommendation</p>
      <div class="issue-banner">
        <div class="issue-heading">${iconMarkup('warning')} Scope changes on promotion</div>
        <p>Original provider metadata and local scope remain in machine-local provenance for comparison.</p>
      </div>
      <div class="detail-section">
        <span class="detail-label">Original source</span>
        <div class="path-well">
          <span class="path-value">${escapeHtml(discovery.path)}</span>
          <button type="button" class="copy-button" aria-label="Copy path">${iconMarkup('copy')}</button>
        </div>
      </div>
      <div class="detail-section">
        <span class="detail-label">Trust and conversion</span>
        <div class="metadata-grid">
          <div class="metadata-line"><span>Scope</span><span>${escapeHtml(discovery.scope)}</span></div>
          <div class="metadata-line"><span>Recognized by</span><span>${discovery.recognizedBy.length} providers</span></div>
          <div class="metadata-line"><span>Project writes</span><span>Never</span></div>
          ${
            discovery.kind === 'skill'
              ? `<div class="metadata-line"><span>Trust risks</span><span>${discovery.skillRisks?.length ?? 0}</span></div>`
              : ''
          }
        </div>
      </div>
      <div class="detail-section detail-actions">
        <button class="detail-action" type="button" data-detail-action="open-project">${iconMarkup('external')} Open source externally</button>
        <button class="detail-action" type="button" data-detail-action="promote">${iconMarkup('plus')} Continue promotion <kbd>↵</kbd></button>
        <button class="detail-action" type="button" data-detail-action="ignore">${iconMarkup('archive')} Ignore this revision</button>
        ${
          discovery.kind === 'skill'
            ? `<label class="trust-confirmation"><input type="checkbox" data-confirm-executables> I reviewed the file inventory and trust executable files in this revision.</label>`
            : ''
        }
      </div>
    `;
    detail
      .querySelector('[data-detail-action="open-project"]')
      ?.addEventListener('click', async () => {
        if (state.runtimeMode !== 'live') {
          showToast('External editor', `Would open ${discovery.path}`);
          return;
        }
        try {
          await state.runtimeClient.execute({
            type: 'external.open',
            target: {
              kind: 'project',
              discoveryId: discovery.id,
            },
          });
          showToast(
            'Opened externally',
            'The read-only project source was opened.',
          );
        } catch (error) {
          handleRuntimeError(error, 'Could not open the project source');
        }
      });
    detail
      .querySelector('[data-detail-action="promote"]')
      ?.addEventListener('click', () => void openPromotionReview(discovery));
    detail
      .querySelector('[data-detail-action="ignore"]')
      ?.addEventListener('click', () => void ignoreSelectedDiscovery(discovery));
    return;
  }

  if (state.section === 'providers') {
    const provider = getSelectedProvider();
    const effective = provider.effective ?? {
      managedProjection: {
        rulesPath: provider.destination,
        skillsDir: null,
        mcpPath: null,
      },
      issues: [],
      unmanagedMcpEntries: [],
      unsupportedGlobalCapabilities: [],
      knownProjectFiles: [],
    };
    const destinations = [
      ['rules', 'Instructions', effective.managedProjection.rulesPath],
      ['skills', 'Skills', effective.managedProjection.skillsDir],
      ['mcp', 'MCP', effective.managedProjection.mcpPath],
    ];
    detail.innerHTML = `
      <h3>${escapeHtml(provider.name)}</h3>
      <p>Effective configuration</p>
      ${(effective.issues ?? [])
        .map(
          (issue) => `
            <div class="issue-banner ${issue.severity === 'error' ? 'error' : ''}">
              <div class="issue-heading">${iconMarkup('warning')} ${escapeHtml(titleCase(issue.code))}</div>
              <p>${escapeHtml(issue.message)}</p>
            </div>
          `,
        )
        .join('')}
      <div class="detail-section">
        <span class="detail-label">Managed projections</span>
        <div class="metadata-grid">
          ${destinations
            .map(
              ([, label, destination]) => `
                <div class="metadata-line">
                  <span>${label}</span>
                  <span>${destination === null ? 'Unsupported' : escapeHtml(destination)}</span>
                </div>
              `,
            )
            .join('')}
        </div>
      </div>
      ${
        effective.unmanagedMcpEntries?.length > 0
          ? `
            <div class="detail-section">
              <span class="detail-label">Unmanaged MCP entries preserved</span>
              <div class="tag-list">${effective.unmanagedMcpEntries
                .map((name) => `<span>${escapeHtml(name)}</span>`)
                .join('')}</div>
            </div>
          `
          : ''
      }
      ${
        effective.unsupportedGlobalCapabilities?.length > 0
          ? `
            <div class="detail-section">
              <span class="detail-label">Adapter issues</span>
              <div class="metadata-grid">${effective.unsupportedGlobalCapabilities
                .map(
                  (issue) => `
                    <div class="metadata-line">
                      <span>${escapeHtml(titleCase(issue.capability))}</span>
                      <span>${escapeHtml(issue.message)}</span>
                    </div>
                  `,
                )
                .join('')}</div>
            </div>
          `
          : ''
      }
      <div class="detail-section">
        <span class="detail-label">Known project files</span>
        <div class="metadata-grid">
          ${
            effective.knownProjectFiles?.length > 0
              ? effective.knownProjectFiles
                  .slice(0, 8)
                  .map(
                    (file) => `
                      <div class="metadata-line">
                        <span>${escapeHtml(file.relativePath)}</span>
                        <span>Read-only</span>
                      </div>
                    `,
                  )
                  .join('')
              : '<div class="metadata-line"><span>None indexed</span><span>—</span></div>'
          }
        </div>
      </div>
      <div class="detail-section detail-actions">
        ${canAdminister() ? destinations
          .filter(([, , destination]) => destination !== null)
          .map(
            ([content, label]) => `
              <button class="detail-action" type="button" data-provider-open="${content}">
                ${iconMarkup('external')} Open ${label.toLowerCase()} file
              </button>
              <button class="detail-action" type="button" data-provider-reveal="${content}">
                ${iconMarkup('file')} Reveal ${label.toLowerCase()} destination
              </button>
            `,
          )
          .join('') : ''}
        <button class="detail-action" type="button" data-provider-refresh>${iconMarkup('history')} Refresh effective configuration</button>
        ${
          provider.documentationUrl
            ? `<a class="detail-action" href="${escapeHtml(provider.documentationUrl)}" target="_blank" rel="noreferrer">${iconMarkup('external')} Provider documentation</a>`
            : ''
        }
      </div>
    `;
    detail.querySelectorAll('[data-provider-open]').forEach((button) => {
      button.addEventListener('click', () =>
        void openProviderDestination(
          provider,
          button.dataset.providerOpen,
          false,
        ),
      );
    });
    detail.querySelectorAll('[data-provider-reveal]').forEach((button) => {
      button.addEventListener('click', () =>
        void openProviderDestination(
          provider,
          button.dataset.providerReveal,
          true,
        ),
      );
    });
    detail
      .querySelector('[data-provider-refresh]')
      ?.addEventListener('click', () => void refreshRuntimeSnapshot());
    return;
  }

  detail.innerHTML =
    state.section === 'activity'
      ? `
        <h3>Diagnostics-safe</h3>
        <p>Activity records metadata, not artifact bodies.</p>
        <div class="detail-section">
          <span class="detail-label">Export defaults</span>
          <div class="metadata-grid">
            <div class="metadata-line"><span>Artifact content</span><span>Excluded</span></div>
            <div class="metadata-line"><span>Project paths</span><span>Excluded</span></div>
            <div class="metadata-line"><span>Secrets</span><span>Excluded</span></div>
          </div>
        </div>
      `
      : `
        <h3>Local-first</h3>
        <p>Remote access and sync stay disabled until you enable them.</p>
        <div class="detail-section">
          <span class="detail-label">Privacy</span>
          <div class="metadata-grid">
            <div class="metadata-line"><span>Analytics</span><span>Off</span></div>
            <div class="metadata-line"><span>Crash uploads</span><span>Off</span></div>
            <div class="metadata-line"><span>Remote access</span><span>Off</span></div>
          </div>
        </div>
      `;
}

async function openProviderDestination(provider, content, reveal) {
  if (state.runtimeMode !== 'live') {
    showToast(
      reveal ? 'Reveal destination' : 'External editor',
      `${titleCase(content)} destination for ${provider.name}.`,
    );
    return;
  }
  try {
    await state.runtimeClient.execute({
      type: 'external.open',
      target: {
        kind: 'provider',
        provider: provider.id,
        content,
      },
      reveal,
    });
    showToast(
      reveal ? 'Revealed destination' : 'Opened externally',
      `${provider.name} ${content} destination.`,
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not open the provider destination');
  }
}

async function openPromotionReview(discovery) {
  if (state.runtimeMode !== 'live') {
    openActionSheet(
      `Review ${discovery.title}`,
      'Preview mode demonstrates the safe promotion checkpoint.',
      `
        <div class="sheet-callout"><strong>${escapeHtml(discovery.recommendation)}</strong><br>${escapeHtml(discovery.description)}</div>
        <label class="scope-choice"><input type="radio" checked><span><strong>Create a new library artifact</strong><p>No existing canonical artifact is changed.</p></span></label>
        <div class="sheet-actions">
          <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
          <button class="button button-primary" type="button" data-mock-promote>Promote preview</button>
        </div>
      `,
    );
    document.querySelector('[data-mock-promote]').addEventListener('click', () => {
      closeActionSheet();
      showToast(
        'Promotion prepared',
        `${discovery.recommendation} selected. No project file was changed.`,
      );
    });
    return;
  }
  const mode = document.querySelector(
    'input[name="promotion-mode"]:checked',
  )?.value;
  const targets = [
    ...document.querySelectorAll('input[name="promotion-target"]:checked'),
  ].map((input) => input.value);
  if (mode === 'global-instruction' && targets.length === 0) {
    showToast(
      'Choose a provider target',
      'A global instruction needs at least one explicit provider target.',
    );
    return;
  }
  const confirmExecutables =
    document.querySelector('[data-confirm-executables]')?.checked === true;
  try {
    const result = await state.runtimeClient.execute({
      type: 'project.promotion-preview',
      discoveryId: discovery.id,
      ...(discovery.kind === 'instruction' ? { mode } : {}),
    });
    renderPromotionReviewSheet(discovery, result.data, {
      mode,
      targets,
      confirmExecutables,
    });
  } catch (error) {
    handleRuntimeError(error, 'Promotion comparison is unavailable');
  }
}

function renderPromotionReviewSheet(discovery, preview, choices) {
  const candidates = Array.isArray(preview.candidates) ? preview.candidates : [];
  openActionSheet(
    `Promote ${discovery.title}`,
    'Compare before changing the canonical library. The project source remains read-only.',
    `
      <div class="sheet-callout">
        <strong>${escapeHtml(discovery.recommendation)}</strong><br>
        ${escapeHtml(discovery.scope)}. Unsupported scope metadata stays in local provenance.
      </div>
      <fieldset class="promotion-destination-list">
        <legend>Library destination</legend>
        <label class="scope-choice">
          <input type="radio" name="promotion-destination" value="" checked>
          <span><strong>Create a new artifact</strong><p>Uses a new stable ID and leaves existing canonical content unchanged.</p></span>
        </label>
        ${candidates
          .map(
            (candidate) => `
              <label class="scope-choice">
                <input type="radio" name="promotion-destination" value="${escapeHtml(candidate.artifact.id)}">
                <span><strong>Merge into ${escapeHtml(candidate.artifact.title)}</strong><p>${escapeHtml(candidate.artifact.slug)} · stable ID preserved · history created first</p></span>
              </label>
            `,
          )
          .join('')}
      </fieldset>
      ${promotionComparisonMarkup(preview)}
      <div class="sheet-callout">Provider targets: ${choices.targets.length > 0 ? escapeHtml(choices.targets.join(', ')) : 'none'}. Provider files remain unchanged until Apply.</div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-primary" type="button" data-confirm-promotion>Promote selection</button>
      </div>
    `,
    true,
  );
  const destinationInputs = [
    ...document.querySelectorAll('input[name="promotion-destination"]'),
  ];
  const syncComparison = () => {
    const destination = document.querySelector(
      'input[name="promotion-destination"]:checked',
    )?.value;
    document.querySelectorAll('[data-comparison-destination]').forEach((item) => {
      item.hidden = item.dataset.comparisonDestination !== destination;
    });
    document.querySelectorAll('input[name="promotion-file"]').forEach((input) => {
      input.disabled = destination.length === 0;
      if (destination.length === 0) input.checked = true;
    });
  };
  destinationInputs.forEach((input) => input.addEventListener('change', syncComparison));
  syncComparison();
  document
    .querySelector('[name="promotion-server"]')
    ?.addEventListener('change', (event) => {
      const selected = (preview.servers ?? []).find(
        (server) => server.name === event.currentTarget.value,
      );
      const structuralPreview = document.querySelector('.structural-preview');
      if (structuralPreview !== null) {
        structuralPreview.textContent = JSON.stringify(
          selected?.definition ?? {},
          null,
          2,
        );
      }
    });
  document
    .querySelector('[data-confirm-promotion]')
    .addEventListener('click', () =>
      void commitPromotionSelection(discovery, preview, choices),
    );
}

function promotionComparisonMarkup(preview) {
  if (preview.kind === 'instruction') {
    return `
      <div class="promotion-comparison" data-comparison-destination="">
        <strong>New canonical artifact</strong>
        <p>The full normalized source will be added. Scope metadata remains only in local provenance.</p>
      </div>
      ${(preview.candidates ?? [])
        .map(
          (candidate) => `
            <div class="promotion-comparison" data-comparison-destination="${escapeHtml(candidate.artifact.id)}" hidden>
              <strong>Selected-hunk merge</strong>
              <p>Choose the incoming changes to merge. Unselected canonical lines stay unchanged.</p>
              ${(candidate.hunks ?? [])
                .map(
                  (hunk) => `
                    <label class="promotion-hunk">
                      <input type="checkbox" name="promotion-hunk" value="${escapeHtml(hunk.id)}" checked>
                      <span class="promotion-hunk-diff">
                        ${hunk.baseLines.map((line) => `<code class="removed">− ${escapeHtml(line)}</code>`).join('')}
                        ${hunk.incomingLines.map((line) => `<code class="added">+ ${escapeHtml(line)}</code>`).join('')}
                      </span>
                    </label>
                  `,
                )
                .join('') || '<div class="sheet-callout">The source already matches this artifact.</div>'}
            </div>
          `,
        )
        .join('')}
    `;
  }
  if (preview.kind === 'skill') {
    const files = (preview.inspection?.files ?? []).filter(
      (file) => file.kind !== 'directory',
    );
    return `
      <div class="promotion-comparison">
        <strong>Reviewed skill tree</strong>
        <p>Select the files to add or merge. Reglet never executes them and blocks escaping symlinks.</p>
        <div class="skill-inventory">
          ${files
            .map(
              (file) => `
                <label class="skill-inventory-row selectable">
                  <input type="checkbox" name="promotion-file" value="${escapeHtml(file.relPath)}" checked>
                  <code>${escapeHtml(file.relPath)}</code>
                  <span>${escapeHtml(file.kind)}${file.executable ? ' · executable' : ''}${file.binary ? ' · binary' : ''}</span>
                  <span>${formatBytes(file.size)}</span>
                </label>
              `,
            )
            .join('')}
        </div>
      </div>
    `;
  }
  return `
    <div class="promotion-comparison">
      <strong>Normalized MCP definitions</strong>
      <p>Select one server. Likely credentials become keychain references and project paths become machine overrides.</p>
      <label class="sheet-field">
        <span>Server</span>
        <select name="promotion-server">
          ${(preview.servers ?? [])
            .map(
              (server) => `<option value="${escapeHtml(server.name)}">${escapeHtml(server.name)}${server.machineOverrideFields?.length ? ` · ${server.machineOverrideFields.length} machine overrides` : ''}</option>`,
            )
            .join('')}
        </select>
      </label>
      <pre class="structural-preview">${escapeHtml(JSON.stringify(preview.servers?.[0]?.definition ?? {}, null, 2))}</pre>
    </div>
  `;
}

async function commitPromotionSelection(discovery, preview, choices) {
  const destinationArtifact = document.querySelector(
    'input[name="promotion-destination"]:checked',
  )?.value;
  const comparison = [...document.querySelectorAll('[data-comparison-destination]')].find(
    (item) => item.dataset.comparisonDestination === destinationArtifact,
  );
  const selectedHunks = [
    ...(comparison?.querySelectorAll('input[name="promotion-hunk"]:checked') ?? []),
  ].map((input) => input.value);
  const selectedFiles = [
    ...document.querySelectorAll('input[name="promotion-file"]:checked'),
  ].map((input) => input.value);
  const serverName = document.querySelector('[name="promotion-server"]')?.value;
  if (
    destinationArtifact &&
    preview.kind === 'instruction' &&
    selectedHunks.length === 0
  ) {
    showToast('Choose a change', 'Select at least one incoming text hunk to merge.');
    return;
  }
  if (preview.kind === 'skill' && selectedFiles.length === 0) {
    showToast('Choose a file', 'Select at least one reviewed skill file.');
    return;
  }
  const button = document.querySelector('[data-confirm-promotion]');
  button.disabled = true;
  button.textContent = 'Promoting…';
  try {
    await state.runtimeClient.execute({
      type: 'project.promote',
      discoveryId: discovery.id,
      ...(discovery.kind === 'instruction' ? { mode: choices.mode } : {}),
      targets: choices.targets,
      confirmExecutables: choices.confirmExecutables,
      ...(destinationArtifact ? { destinationArtifact } : {}),
      ...(destinationArtifact && preview.kind === 'instruction'
        ? { selectedHunks }
        : {}),
      ...(preview.kind === 'skill' ? { selectedFiles } : {}),
      ...(preview.kind === 'mcp' && serverName ? { serverName } : {}),
    });
    closeActionSheet();
    showToast(
      'Promoted into the library',
      destinationArtifact
        ? 'The selected changes were merged after creating recoverable history.'
        : 'A new canonical artifact was created. The project source stayed read-only.',
    );
    state.section = 'library';
    await refreshRuntimeSnapshot();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Promote selection';
    handleRuntimeError(error, 'Promotion needs attention');
  }
}

async function ignoreSelectedDiscovery(discovery) {
  if (state.runtimeMode !== 'live') {
    showToast('Discovery ignored', 'The local path-and-hash rule was saved.');
    return;
  }
  try {
    await state.runtimeClient.execute({
      type: 'project.ignore',
      discoveryId: discovery.id,
    });
    showToast(
      'Discovery ignored',
      'The local path-and-hash rule was saved and was not synced.',
    );
    await refreshRuntimeSnapshot({ loadSelected: false });
  } catch (error) {
    handleRuntimeError(error, 'Could not ignore this discovery');
  }
}

function projectionDetailMarkup(artifact, provider, item) {
  const destination = item.destinationPath ?? provider.destination;
  const issues = projectionIssues(artifact, provider, item);
  const issueMarkup = issues
    .map(
      (issue) => `
        <div class="issue-banner ${issue.severity === 'error' ? 'error' : ''}">
          <div class="issue-heading">${iconMarkup('warning')} ${escapeHtml(titleCase(issue.code))}</div>
          <p>${escapeHtml(issue.message)}</p>
        </div>
      `,
    )
    .join('');
  return `
    <h3>${escapeHtml(provider.name)}</h3>
    <p>${escapeHtml(titleCase(item.status))} projection · ${escapeHtml(artifact.title)}</p>
    ${issueMarkup}
    <div class="detail-section">
      <span class="detail-label">Destination</span>
      <div class="path-well">
        <span class="path-value">${escapeHtml(destination)}</span>
        <button type="button" class="copy-button" data-copy-path aria-label="Copy destination path">${iconMarkup('copy')}</button>
      </div>
    </div>
    <div class="detail-section">
      <span class="detail-label">Revision comparison</span>
      <div class="revision-stack">
        <div class="revision-row">
          <span>Desired</span>
          <span class="revision-hash">${escapeHtml(item.desiredHash ?? 'No output desired')}</span>
        </div>
        <div class="revision-row">
          <span>Applied</span>
          <span class="revision-hash">${escapeHtml(item.appliedHash ?? 'Never applied')}</span>
        </div>
        <div class="revision-row">
          <span>Observed</span>
          <span class="revision-hash">${escapeHtml(item.observedHash ?? 'File not present')}</span>
        </div>
      </div>
    </div>
    ${
      item.status === 'drifted'
        ? `
          <div class="diff-view" aria-label="Projection diff preview">
            <div class="diff-line removed"><span>12</span><span>−</span><span>Prefer strict types.</span></div>
            <div class="diff-line added"><span>12</span><span>+</span><span>Prefer strict types unless the task explicitly overrides them.</span></div>
          </div>
        `
        : ''
    }
    <div class="detail-section">
      <span class="detail-label">Observed state</span>
      <div class="metadata-grid">
        <div class="metadata-line"><span>Status</span><span>${titleCase(item.status)}</span></div>
        <div class="metadata-line"><span>Applied revision</span><span>${item.appliedHash ? `rev ${artifact.revision - (item.status === 'pending' ? 1 : 0)}` : '—'}</span></div>
        <div class="metadata-line"><span>Last applied</span><span>${item.appliedAt ?? '—'}</span></div>
      </div>
    </div>
    <div class="detail-section detail-actions">
      ${canAdminister() ? `<button class="detail-action" type="button" data-detail-action="external">${iconMarkup('external')} Open external file <kbd>⌘ O</kbd></button>` : ''}
      <button class="detail-action" type="button" data-detail-action="diff">${iconMarkup('diff')} Preview exact diff <kbd>⌘ D</kbd></button>
      ${
        canWrite() && (item.status === 'drifted' || item.status === 'missing')
          ? `<button class="detail-action" type="button" data-detail-action="reapply">${iconMarkup('history')} Reapply over ${item.status}</button>`
          : ''
      }
      ${
        canAdminister() &&
        artifact.kind === 'skill' &&
        issues.some((issue) =>
          issue.message.toLowerCase().includes('trust'),
        )
          ? `<button class="detail-action" type="button" data-detail-action="trust-skill">${iconMarkup('warning')} Review and trust this skill revision</button>`
          : ''
      }
    </div>
  `;
}

function projectionIssues(artifact, provider, item) {
  const compatibility = artifact.validation?.compatibility?.find(
    (result) => result.provider === provider.id,
  );
  const candidates = [
    ...(artifact.validation?.issues ?? []),
    ...(compatibility?.issues ?? []),
    ...(item.issues ?? (item.issue ? [item.issue] : [])),
  ];
  const seen = new Set();
  return candidates.filter((issue) => {
    const key = `${issue.code}:${issue.severity}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function wireProjectionActions(provider, item) {
  const destination = item.destinationPath ?? provider.destination;
  document.querySelector('[data-copy-path]')?.addEventListener('click', () => {
    void navigator.clipboard?.writeText(destination);
    showToast('Path copied', destination);
  });
  document
    .querySelector('[data-detail-action="external"]')
    ?.addEventListener('click', async () => {
      if (state.runtimeMode !== 'live') {
        showToast('External editor', `Would open ${destination}`);
        return;
      }
      try {
        await state.runtimeClient.execute({
          type: 'external.open',
          target: {
            kind: 'provider',
            artifact: getSelectedArtifact().id,
            provider: provider.id,
          },
        });
        showToast('Opened externally', destination);
      } catch (error) {
        handleRuntimeError(error, 'Could not open the provider file');
      }
    });
  document
    .querySelector('[data-detail-action="diff"]')
    ?.addEventListener('click', () =>
      void openProjectionPreview(provider, item),
    );
  document
    .querySelector('[data-detail-action="reapply"]')
    ?.addEventListener('click', () =>
      confirmReapplyOverDrift(provider, item),
    );
  document
    .querySelector('[data-detail-action="trust-skill"]')
    ?.addEventListener('click', () => void openSkillTrustSheet());
}

async function openSkillTrustSheet() {
  const artifact = getSelectedArtifact();
  if (state.runtimeMode !== 'live') {
    showToast(
      'Trust review',
      'Executable files are trusted only for the reviewed content revision.',
    );
    return;
  }
  try {
    const result = await state.runtimeClient.execute(
      {
        type: 'library.inspect-skill',
        artifact: artifact.id,
      },
      { optimistic: false },
    );
    const inspection = result.data;
    openActionSheet(
      `Trust ${artifact.title}?`,
      'Review every file before approving executable content for this exact revision.',
      `
        ${(inspection.risks ?? [])
          .map(
            (risk) => `
              <div class="sheet-callout ${risk.severity === 'error' ? 'danger' : ''}">
                <strong>${escapeHtml(titleCase(risk.code))} · ${escapeHtml(risk.relPath)}</strong><br>
                ${escapeHtml(risk.message)}
              </div>
            `,
          )
          .join('')}
        <div class="skill-inventory">
          ${(inspection.files ?? [])
            .map(
              (file) => `
                <div class="skill-inventory-row">
                  <code>${escapeHtml(file.relPath)}</code>
                  <span>${escapeHtml(file.kind)}${file.executable ? ' · executable' : ''}${file.binary ? ' · binary' : ''}</span>
                  <span>${formatBytes(file.size)}</span>
                </div>
              `,
            )
            .join('')}
        </div>
        <div class="sheet-callout">
          Trust is machine-local and tied to revision <code>${escapeHtml(inspection.revision.slice(0, 12))}</code>. Any executable content change invalidates it.
        </div>
        <div class="sheet-actions">
          <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
          <button class="button button-danger" type="button" data-confirm-skill-trust ${inspection.promotionBlocked ? 'disabled' : ''}>Trust this revision</button>
        </div>
      `,
      true,
    );
    document
      .querySelector('[data-confirm-skill-trust]')
      ?.addEventListener('click', async () => {
        try {
          await state.runtimeClient.execute({
            type: 'library.trust-skill',
            artifact: artifact.id,
            confirmed: true,
          });
          closeActionSheet();
          showToast(
            'Skill revision trusted',
            'Executable content may now be projected. Future changes require another review.',
          );
          await refreshRuntimeSnapshot();
        } catch (error) {
          handleRuntimeError(error, 'Could not trust this skill revision');
        }
      });
  } catch (error) {
    handleRuntimeError(error, 'Could not inspect the skill');
  }
}

async function openProjectionPreview(provider, item) {
  const artifact = getSelectedArtifact();
  if (state.runtimeMode !== 'live') {
    const preview = {
      provider: provider.id,
      artifactId: artifact.id,
      kind: artifact.kind,
      destinationPath: item.destinationPath ?? provider.destination,
      format: artifact.kind === 'skill' ? 'tree' : 'text',
      desired: artifact.content,
      observed:
        item.status === 'drifted'
          ? `${artifact.content.trimEnd()}\n\n<!-- External provider edit -->\n`
          : artifact.content,
      exact: artifact.kind !== 'mcp',
      redacted: artifact.kind === 'mcp',
      issues: [],
    };
    showProjectionPreview(provider, preview);
    return;
  }
  try {
    const result = await state.runtimeClient.execute(
      {
        type: 'providers.preview',
        artifact: artifact.id,
        provider: provider.id,
      },
      { optimistic: false },
    );
    showProjectionPreview(provider, result.data);
  } catch (error) {
    handleRuntimeError(error, 'Could not build the projection preview');
  }
}

function showProjectionPreview(provider, preview) {
  const lines = lineDiff(preview.observed ?? '', preview.desired ?? '');
  const issues = (preview.issues ?? [])
    .map(
      (issue) => `
        <div class="sheet-callout ${issue.severity === 'error' ? 'danger' : ''}">
          <strong>${escapeHtml(titleCase(issue.code))}</strong><br>
          ${escapeHtml(issue.message)}
        </div>
      `,
    )
    .join('');
  openActionSheet(
    `${provider.name} projection`,
    preview.exact
      ? 'Exact desired output compared with the current provider projection.'
      : 'Normalized structural comparison with secret-bound values redacted.',
    `
      <div class="preview-summary">
        <span>${escapeHtml(titleCase(preview.format))}</span>
        <span>${preview.redacted ? 'Secrets redacted' : 'No secret values included'}</span>
        <span>${lines.length} lines</span>
      </div>
      ${issues}
      <div class="path-well">
        <span class="path-value">${escapeHtml(preview.destinationPath ?? 'Unsupported')}</span>
      </div>
      <div class="exact-diff" role="region" aria-label="Observed to desired projection diff">
        ${
          lines.length === 0
            ? '<div class="diff-empty">Observed and desired projections match.</div>'
            : lines
                .map(
                  (line) => `
                    <div class="exact-diff-line ${line.kind}">
                      <span class="diff-sign" aria-hidden="true">${line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span>
                      <code>${escapeHtml(line.text.length === 0 ? ' ' : line.text)}</code>
                    </div>
                  `,
                )
                .join('')
        }
      </div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Close</button>
      </div>
    `,
    true,
  );
}

function lineDiff(observed, desired) {
  if (observed === desired) return [];
  const before =
    observed.length === 0 ? [] : observed.replace(/\n$/, '').split('\n');
  const after =
    desired.length === 0 ? [] : desired.replace(/\n$/, '').split('\n');
  if (before.length * after.length > 250_000) {
    return [
      ...before.map((text) => ({ kind: 'removed', text })),
      ...after.map((text) => ({ kind: 'added', text })),
    ];
  }
  const widths = after.length + 1;
  const table = new Uint32Array((before.length + 1) * widths);
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      const index = left * widths + right;
      table[index] =
        before[left] === after[right]
          ? table[(left + 1) * widths + right + 1] + 1
          : Math.max(
              table[(left + 1) * widths + right],
              table[left * widths + right + 1],
            );
    }
  }
  const result = [];
  let left = 0;
  let right = 0;
  while (left < before.length || right < after.length) {
    if (
      left < before.length &&
      right < after.length &&
      before[left] === after[right]
    ) {
      result.push({ kind: 'context', text: before[left] });
      left += 1;
      right += 1;
    } else if (
      right < after.length &&
      (left >= before.length ||
        table[left * widths + right + 1] >=
          table[(left + 1) * widths + right])
    ) {
      result.push({ kind: 'added', text: after[right] });
      right += 1;
    } else {
      result.push({ kind: 'removed', text: before[left] });
      left += 1;
    }
  }
  return result;
}

function confirmReapplyOverDrift(provider, item) {
  const artifact = getSelectedArtifact();
  const destination = item.destinationPath ?? provider.destination;
  openActionSheet(
    `Reapply ${provider.name}?`,
    'Reglet creates a provider backup before replacing the observed output.',
    `
      <div class="sheet-callout danger">
        The current provider-owned file differs from the last applied revision. Reapplying will preserve it in Backups & Recovery, then write the current canonical projection.
      </div>
      <div class="path-well"><span class="path-value">${escapeHtml(destination)}</span></div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-reapply>Back up and reapply</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-reapply]')
    .addEventListener('click', () =>
      void reapplyOverDrift(artifact, provider),
    );
}

async function reapplyOverDrift(artifact, provider) {
  const content =
    artifact.kind === 'instruction'
      ? 'rules'
      : artifact.kind === 'skill'
        ? 'skills'
        : 'mcp';
  try {
    await state.runtimeClient.execute({
      type: 'providers.apply',
      providers: [provider.id],
      contents: [content],
      allowOverwriteDrift: true,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast(
      `${provider.name} reapplied`,
      'The previous observed output remains available in Backups & Recovery.',
    );
  } catch (error) {
    handleRuntimeError(error, `Could not reapply ${provider.name}`);
  }
}

function renderInspector() {
  renderProviderList();
  renderProjectionDetail();
}

function updateDocumentStats(artifact) {
  const words = artifact.content.trim().split(/\s+/).filter(Boolean).length;
  document.querySelector('#document-stats').textContent =
    `${artifact.kind === 'mcp' ? 'JSON' : 'Markdown'} · ${words} words · UTF-8`;
  document.querySelector('#draft-status').textContent =
    `Canonical revision ${artifact.revision}`;
}

function pendingProjectionCount() {
  if (state.section !== 'library') return 0;
  const artifact = getSelectedArtifact();
  if (artifact === undefined) return 0;
  return Object.values(artifact.projections).filter(
    (item) => item.status === 'pending',
  ).length;
}

function updateApplyButtons() {
  const count = pendingProjectionCount();
  const top = document.querySelector('#apply-top');
  const bottom = document.querySelector('#apply-bottom');
  top.disabled = !canWrite() || state.applying || count === 0;
  bottom.disabled = !canWrite() || state.applying || count === 0;
  top.textContent = state.applying ? 'Applying…' : 'Apply changes';
  bottom.textContent = state.applying
    ? 'Applying…'
    : count === 0
      ? 'All changes applied'
      : `Apply ${count} change${count === 1 ? '' : 's'}`;
}

async function applyChanges() {
  if (!canWrite()) {
    showToast(
      'Read-only session',
      'Pair with write or admin scope to apply provider projections.',
    );
    return;
  }
  const artifact = getSelectedArtifact();
  if (artifact === undefined) return;
  const count = pendingProjectionCount();
  if (state.applying || count === 0) return;
  state.applying = true;
  document.body.classList.add('applying');
  updateApplyButtons();

  if (state.runtimeMode === 'live') {
    const providers = providerCatalog
      .filter(
        (provider) =>
          artifact.projections[provider.id]?.status === 'pending',
      )
      .map((provider) => provider.id);
    const content =
      artifact.kind === 'instruction'
        ? 'rules'
        : artifact.kind === 'skill'
          ? 'skills'
          : 'mcp';
    try {
      const result = await state.runtimeClient.execute({
        type: 'providers.apply',
        providers,
        contents: [content],
      });
      const results =
        typeof result.data === 'object' &&
        result.data !== null &&
        Array.isArray(result.data.results)
          ? result.data.results
          : [];
      const applied = results.filter((item) =>
        ['written', 'unchanged'].includes(item.status),
      ).length;
      const failed = results.filter((item) =>
        ['blocked', 'error'].includes(item.status),
      ).length;
      showToast(
        `${applied} projection${applied === 1 ? '' : 's'} applied`,
        failed > 0
          ? `${failed} provider output${failed === 1 ? '' : 's'} still need attention. Successful writes were kept.`
          : 'Desired, applied, and observed outputs now match.',
      );
      await refreshRuntimeSnapshot();
    } catch (error) {
      handleRuntimeError(error, 'Provider apply failed');
    } finally {
      state.applying = false;
      document.body.classList.remove('applying');
      updateApplyButtons();
    }
    return;
  }

  setTimeout(() => {
    Object.values(artifact.projections).forEach((item) => {
      if (item.status === 'pending') {
        item.status = 'applied';
        item.appliedHash = item.desiredHash;
        item.observedHash = item.desiredHash;
        item.appliedAt = 'Just now';
      }
    });
    state.applying = false;
    document.body.classList.remove('applying');
    renderProviderList();
    renderProjectionDetail();
    updateApplyButtons();
    const drifted = Object.values(artifact.projections).some(
      (item) => item.status === 'drifted',
    );
    showToast(
      `${count} projection${count === 1 ? '' : 's'} applied`,
      drifted
        ? 'External drift was preserved and still requires review.'
        : 'Desired, applied, and observed outputs now match.',
    );
  }, 850);
}

function renderCommandPalette() {
  const commands = commandItems().filter((item) =>
    `${item.label} ${item.detail}`.toLowerCase().includes(
      state.commandQuery.trim().toLowerCase(),
    ),
  );
  if (state.commandIndex >= commands.length) state.commandIndex = 0;
  const results = document.querySelector('#command-results');
  results.innerHTML =
    commands.length === 0
      ? emptyState(
          'search',
          'No matching command',
          'Search by artifact, provider, destination, or action.',
        )
      : `
        <div class="command-group-label">Commands and artifacts</div>
        ${commands
          .map(
            (item, index) => `
              <button
                type="button"
                class="command-row"
                data-command="${escapeHtml(item.id)}"
                aria-selected="${state.commandIndex === index}"
              >
                <span class="command-row-icon">${iconMarkup(item.icon)}</span>
                <span class="command-row-copy">
                  <strong>${escapeHtml(item.label)}</strong>
                  <small>${escapeHtml(item.detail)}</small>
                </span>
                ${item.shortcut ? `<kbd>${escapeHtml(item.shortcut)}</kbd>` : ''}
              </button>
            `,
          )
          .join('')}
      `;
  results.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => runCommand(button.dataset.command));
  });
}

function commandItems() {
  const drift = nextProjectionDrift();
  const items = [
    {
      id: 'create:instruction',
      label: 'Create instruction',
      detail: 'New canonical Markdown guidance',
      icon: 'plus',
      shortcut: '⌘ N',
    },
    {
      id: 'create:skill',
      label: 'Create skill',
      detail: 'New SKILL.md with validated frontmatter',
      icon: 'skill',
    },
    {
      id: 'create:mcp',
      label: 'Create MCP server',
      detail: 'New non-executing structured definition',
      icon: 'server',
    },
    {
      id: 'library',
      label: 'Open Library',
      detail: 'Canonical artifacts and drafts',
      icon: 'library',
    },
    {
      id: 'inbox',
      label: 'Open Project Inbox',
      detail: `${discoveries.filter((item) => ['New', 'Changed', 'Conflict'].includes(item.state)).length} local discoveries need review`,
      icon: 'inbox',
    },
    {
      id: 'apply',
      label: 'Apply pending changes',
      detail: `${pendingProjectionCount()} projections for the selected artifact`,
      icon: 'providers',
      shortcut: '⌘ ↵',
    },
    {
      id: 'drift',
      label: 'Resolve next drift',
      detail:
        drift === undefined
          ? 'No drifted or missing projection'
          : `${drift.provider.name} · ${drift.artifact.title}`,
      icon: 'warning',
    },
    {
      id: 'scan',
      label: 'Rescan development roots',
      detail: `${state.runtimeSnapshot?.projectRoots?.length ?? 3} configured roots · project data stays local`,
      icon: 'history',
    },
    {
      id: 'sync',
      label: 'Sync now',
      detail: state.runtimeSnapshot?.sync?.configured
        ? `${titleCase(state.runtimeSnapshot.sync.state)} · canonical library only`
        : 'Sync is not configured',
      icon: 'history',
    },
    {
      id: 'open-external',
      label: 'Open external file',
      detail: 'Open the selected canonical source in the configured editor',
      icon: 'external',
      shortcut: '⌘ O',
    },
    {
      id: 'toggle-theme',
      label: 'Toggle theme',
      detail: 'Switch between the co-primary light and dark themes',
      icon: 'settings',
    },
    {
      id: 'settings',
      label: 'Open Settings',
      detail: canAdminister()
        ? 'Roots, secrets, remote access, sync, recovery, and diagnostics'
        : 'Theme, privacy defaults, and local diagnostics',
      icon: 'settings',
    },
    ...providerCatalog.map((provider) => ({
      id: `provider:${provider.id}`,
      label: `Switch to ${provider.name}`,
      detail: 'Open effective provider configuration',
      icon: 'providers',
    })),
    ...artifacts.map((artifact) => ({
      id: `artifact:${artifact.id}`,
      label: artifact.title,
      detail: `${titleCase(artifact.kind)} · ${artifact.targets.length} targets`,
      icon: kindIcon(artifact.kind),
    })),
  ];
  return items.filter((item) => {
    if (
      !canWrite() &&
      (item.id.startsWith('create:') || item.id === 'apply')
    ) {
      return false;
    }
    if (
      !canAdminister() &&
      ['inbox', 'scan', 'sync', 'open-external'].includes(item.id)
    ) {
      return false;
    }
    return true;
  });
}

function nextProjectionDrift() {
  for (const artifact of artifacts) {
    for (const provider of providerCatalog) {
      if (
        ['drifted', 'missing'].includes(
          artifact.projections[provider.id]?.status,
        )
      ) {
        return { artifact, provider };
      }
    }
  }
  return undefined;
}

function openCommandPalette() {
  const dialog = document.querySelector('#command-dialog');
  state.commandQuery = '';
  state.commandIndex = 0;
  document.querySelector('#command-input').value = '';
  renderCommandPalette();
  dialog.showModal();
  requestAnimationFrame(() => document.querySelector('#command-input').focus());
}

function openCreateSheet(initialKind = 'instruction') {
  if (state.runtimeMode !== 'live') {
    showToast('Create artifact', 'Choose Instruction, Skill, or MCP server.');
    return;
  }
  openActionSheet(
    'Create library artifact',
    'New artifacts start without provider targets.',
    `
      <form class="sheet-form" id="create-artifact-form">
        <label class="sheet-field">
          <span>Type</span>
          <select name="kind">
            <option value="instruction">Instruction</option>
            <option value="skill">Skill</option>
            <option value="mcp">MCP server</option>
          </select>
        </label>
        <label class="sheet-field">
          <span>Slug</span>
          <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="artifact-name">
        </label>
        <label class="sheet-field">
          <span>Title</span>
          <input name="title" required placeholder="Artifact name">
        </label>
        <label class="sheet-field">
          <span>Canonical content</span>
          <textarea name="content" required spellcheck="false"># New instruction

Describe the guidance this instruction should provide.</textarea>
        </label>
        <fieldset class="sheet-group">
          <legend>Provider targets · optional</legend>
          ${providerCatalog
            .map(
              (provider) => `
                <label class="target-choice">
                  <input type="checkbox" name="target" value="${escapeHtml(provider.id)}">
                  <span>${escapeHtml(provider.name)}</span>
                </label>
              `,
            )
            .join('')}
        </fieldset>
        <div class="sheet-actions">
          <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
          <button class="button button-primary" type="submit">Create artifact</button>
        </div>
      </form>
    `,
  );
  const form = document.querySelector('#create-artifact-form');
  const kind = form.elements.kind;
  const slug = form.elements.slug;
  const title = form.elements.title;
  const content = form.elements.content;
  kind.value = initialKind;
  content.value = defaultContentFor(initialKind, 'new-artifact');
  kind.addEventListener('change', () => {
    content.value = defaultContentFor(kind.value, slug.value || 'new-artifact');
  });
  slug.addEventListener('input', () => {
    if (title.dataset.edited !== 'true') {
      title.value = titleCase(slug.value);
    }
  });
  title.addEventListener('input', () => {
    title.dataset.edited = 'true';
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void createArtifactFromSheet(form);
  });
}

async function createArtifactFromSheet(form) {
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Creating…';
  try {
    const result = await state.runtimeClient.execute({
      type: 'library.create',
      kind: form.elements.kind.value,
      slug: form.elements.slug.value,
      title: form.elements.title.value,
      content: form.elements.content.value,
      targets: [...form.querySelectorAll('input[name="target"]:checked')].map(
        (input) => input.value,
      ),
    });
    const created = result.data;
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    if (
      typeof created === 'object' &&
      created !== null &&
      typeof created.id === 'string'
    ) {
      await selectArtifact(created.id);
    }
    showToast('Artifact created', 'Canonical content was saved locally.');
  } catch (error) {
    handleRuntimeError(error, 'Could not create the artifact');
    submit.disabled = false;
    submit.textContent = 'Create artifact';
  }
}

function defaultContentFor(kind, slug) {
  const normalizedSlug = slug || 'new-artifact';
  if (kind === 'skill') {
    return `---\nname: ${normalizedSlug}\ndescription: Describe when this skill should be used.\n---\n\n# ${titleCase(normalizedSlug)}\n`;
  }
  if (kind === 'mcp') {
    return `${JSON.stringify(
      {
        transport: 'stdio',
        command: 'command',
        args: [],
        env: {},
        secretEnv: {},
      },
      null,
      2,
    )}\n`;
  }
  return `# ${titleCase(normalizedSlug)}\n\n`;
}

function openArtifactActions() {
  const artifact = getSelectedArtifact();
  if (state.runtimeMode !== 'live') {
    showToast(
      'Artifact actions',
      'Duplicate, rename, archive, history, and permanent delete.',
    );
    return;
  }
  openActionSheet(
    artifact.title,
    `${titleCase(artifact.kind)} · Stable ID ${artifact.id.slice(0, 8)}`,
    `
      <div class="sheet-stack">
        <button class="detail-action" type="button" data-artifact-action="duplicate">${iconMarkup('copy')} Duplicate without provider targets</button>
        <form class="sheet-form" id="rename-artifact-form">
          <label class="sheet-field">
            <span>Canonical slug</span>
            <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeHtml(artifact.slug)}">
          </label>
          <div class="sheet-actions">
            <button class="button button-quiet" type="submit">Rename</button>
          </div>
        </form>
        <form class="sheet-form" id="artifact-targets-form">
          <fieldset class="sheet-group">
            <legend>Provider targets</legend>
            ${providerCatalog
              .map(
                (provider) => `
                  <label class="target-choice">
                    <input type="checkbox" name="target" value="${escapeHtml(provider.id)}" ${artifact.targets.includes(provider.id) ? 'checked' : ''}>
                    <span>${escapeHtml(provider.name)}</span>
                  </label>
                `,
              )
              .join('')}
          </fieldset>
          <div class="sheet-actions">
            <button class="button button-quiet" type="submit">Update targets</button>
          </div>
        </form>
        <div class="sheet-divider"></div>
        <button class="detail-action" type="button" data-artifact-action="lifecycle">${iconMarkup('archive')} ${artifact.lifecycle === 'archived' ? 'Restore to active library' : 'Archive artifact'}</button>
        <button class="detail-action danger-action" type="button" data-artifact-action="delete">${iconMarkup('warning')} Permanently delete…</button>
      </div>
    `,
  );
  document
    .querySelector('[data-artifact-action="duplicate"]')
    .addEventListener('click', () => void duplicateArtifact(artifact));
  document
    .querySelector('#rename-artifact-form')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      void renameArtifact(artifact, event.currentTarget.elements.slug.value);
    });
  document
    .querySelector('#artifact-targets-form')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      void updateArtifactTargets(
        artifact,
        [...event.currentTarget.querySelectorAll('input[name="target"]:checked')]
          .map((input) => input.value),
      );
    });
  document
    .querySelector('[data-artifact-action="lifecycle"]')
    .addEventListener('click', () => confirmLifecycleChange(artifact));
  document
    .querySelector('[data-artifact-action="delete"]')
    .addEventListener('click', () => confirmPermanentDelete(artifact));
}

async function updateArtifactTargets(artifact, targets) {
  try {
    await state.runtimeClient.execute({
      type: 'library.targets',
      artifact: artifact.id,
      targets,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast(
      'Provider targets updated',
      'Desired projections changed; provider files remain untouched until Apply.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not update provider targets');
  }
}

async function duplicateArtifact(artifact) {
  try {
    const result = await state.runtimeClient.execute({
      type: 'library.duplicate',
      artifact: artifact.id,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    if (
      typeof result.data === 'object' &&
      result.data !== null &&
      typeof result.data.id === 'string'
    ) {
      await selectArtifact(result.data.id);
    }
    showToast(
      'Artifact duplicated',
      'The copy has a new stable ID and no provider targets.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not duplicate the artifact');
  }
}

async function renameArtifact(artifact, slug) {
  try {
    await state.runtimeClient.execute({
      type: 'library.rename',
      artifact: artifact.id,
      slug,
    });
    closeActionSheet();
    await refreshRuntimeSnapshot();
    showToast(
      'Artifact renamed',
      'Its stable ID was preserved and provider projections are pending.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not rename the artifact');
  }
}

function confirmLifecycleChange(artifact) {
  const archiving = artifact.lifecycle !== 'archived';
  openActionSheet(
    archiving ? `Archive ${artifact.title}?` : `Restore ${artifact.title}?`,
    'This changes canonical lifecycle only. Provider writes still require Apply.',
    `
      <div class="sheet-callout">
        ${archiving ? 'Pending removals' : 'Pending additions'}: ${artifact.targets
          .map(
            (providerId) =>
              providerCatalog.find((provider) => provider.id === providerId)
                ?.name ?? providerId,
          )
          .join(', ') || 'No targeted providers'}
      </div>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button ${archiving ? 'button-danger' : 'button-primary'}" type="button" data-confirm-lifecycle>${archiving ? 'Archive artifact' : 'Restore artifact'}</button>
      </div>
    `,
  );
  document
    .querySelector('[data-confirm-lifecycle]')
    .addEventListener('click', () => void changeArtifactLifecycle(artifact));
}

async function changeArtifactLifecycle(artifact) {
  const archiving = artifact.lifecycle !== 'archived';
  try {
    await state.runtimeClient.execute({
      type: archiving ? 'library.archive' : 'library.restore',
      artifact: artifact.id,
    });
    closeActionSheet();
    state.libraryFilter = archiving ? 'archived' : 'active';
    await refreshRuntimeSnapshot();
    showToast(
      archiving ? 'Artifact archived' : 'Artifact restored',
      'Provider outputs are unchanged until Apply.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not change the artifact lifecycle');
  }
}

function confirmPermanentDelete(artifact) {
  openActionSheet(
    `Permanently delete ${artifact.title}?`,
    'Recoverable local history is retained for at least 30 days.',
    `
      <div class="sheet-callout danger">
        Canonical files and manifest metadata will be removed. A sync tombstone and recovery snapshot will be retained. Pending provider removals: ${artifact.targets.length}.
      </div>
      <label class="sheet-field">
        <span>Type ${escapeHtml(artifact.slug)} to confirm</span>
        <input id="delete-confirmation" autocomplete="off">
      </label>
      <div class="sheet-actions">
        <button class="button button-quiet" type="button" data-sheet-cancel>Cancel</button>
        <button class="button button-danger" type="button" data-confirm-delete disabled>Delete permanently</button>
      </div>
    `,
  );
  const input = document.querySelector('#delete-confirmation');
  const confirm = document.querySelector('[data-confirm-delete]');
  input.addEventListener('input', () => {
    confirm.disabled = input.value !== artifact.slug;
  });
  confirm.addEventListener('click', () => void permanentlyDeleteArtifact(artifact));
}

async function permanentlyDeleteArtifact(artifact) {
  try {
    await state.runtimeClient.execute({
      type: 'library.delete',
      artifact: artifact.id,
      confirmed: true,
    });
    closeActionSheet();
    state.libraryFilter = 'active';
    await refreshRuntimeSnapshot();
    showToast(
      'Artifact deleted',
      'A tombstone and recoverable local history were retained.',
    );
  } catch (error) {
    handleRuntimeError(error, 'Could not permanently delete the artifact');
  }
}

let actionSheetReturnFocus;

function openActionSheet(title, description, body, wide = false) {
  const sheet = document.querySelector('#action-sheet');
  if (sheet.hidden && document.activeElement instanceof HTMLElement) {
    actionSheetReturnFocus = document.activeElement;
  }
  document.querySelector('#action-sheet-title').textContent = title;
  document.querySelector('#action-sheet-description').textContent = description;
  document.querySelector('#action-sheet-body').innerHTML = body;
  sheet.classList.toggle('is-wide', wide);
  sheet.hidden = false;
  sheet.querySelectorAll('[data-sheet-cancel]').forEach((button) => {
    button.addEventListener('click', closeActionSheet);
  });
  queueMicrotask(() => {
    const target = document.querySelector('#action-sheet-body').querySelector(
      '[autofocus], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])',
    );
    (target ?? sheet).focus();
  });
}

function closeActionSheet() {
  const sheet = document.querySelector('#action-sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.classList.remove('is-wide');
  document.querySelector('#action-sheet-body').innerHTML = '';
  if (actionSheetReturnFocus?.isConnected) actionSheetReturnFocus.focus();
  actionSheetReturnFocus = undefined;
}

function runCommand(commandId) {
  document.querySelector('#command-dialog').close();
  if (
    !canWrite() &&
    (commandId === 'create' ||
      commandId?.startsWith('create:') ||
      commandId === 'apply')
  ) {
    showToast('Read-only session', 'This command requires write scope.');
    return;
  }
  if (
    !canAdminister() &&
    ['inbox', 'scan', 'sync', 'open-external'].includes(commandId)
  ) {
    showToast('Admin scope required', 'This command accesses machine-local settings.');
    return;
  }
  if (commandId === 'create') {
    openCreateSheet();
  } else if (commandId?.startsWith('create:')) {
    openCreateSheet(commandId.slice('create:'.length));
  } else if (commandId === 'library' || commandId === 'inbox') {
    state.section = commandId;
    render();
  } else if (commandId === 'apply') {
    applyChanges();
  } else if (commandId === 'drift') {
    const drift = nextProjectionDrift();
    if (drift === undefined) {
      showToast(
        'No drift to resolve',
        'Observed provider outputs match the last applied revisions.',
      );
    } else {
      state.section = 'library';
      state.selectedArtifactId = drift.artifact.id;
      state.selectedProviderId = drift.provider.id;
      render();
    }
  } else if (commandId === 'scan') {
    void rescanProjectRoots();
  } else if (commandId === 'sync') {
    if (state.runtimeSnapshot?.sync?.configured) {
      void syncNow();
    } else {
      state.section = 'settings';
      state.selectedSetting = 'Sync & devices';
      render();
    }
  } else if (commandId === 'open-external') {
    document.querySelector('#open-external').click();
  } else if (commandId === 'toggle-theme') {
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'dark' ? 'light' : 'dark');
  } else if (commandId === 'settings') {
    state.section = 'settings';
    render();
  } else if (commandId?.startsWith('provider:')) {
    state.section = 'providers';
    state.selectedProviderId = commandId.slice('provider:'.length);
    render();
  } else if (commandId?.startsWith('artifact:')) {
    state.section = 'library';
    state.selectedArtifactId = commandId.slice('artifact:'.length);
    state.selectedProviderId = preferredProvider(getSelectedArtifact());
    render();
  }
}

async function rescanProjectRoots() {
  if (state.runtimeMode !== 'live') {
    showToast(
      'Scan started',
      'Development roots are scanned without blocking the UI.',
    );
    return;
  }
  showToast(
    'Scanning development roots',
    'Project files remain local and read-only.',
  );
  try {
    await state.runtimeClient.execute({
      type: 'project.scan',
      reappearChangedIgnored: preferenceBoolean(
        'reglet.reopen-changed-ignored',
        true,
      ),
    });
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      'Project scan complete',
      `${discoveries.length} deduplicated discoveries are available.`,
    );
  } catch (error) {
    handleRuntimeError(error, 'Project scan failed');
  }
}

function showToast(title, message) {
  const region = document.querySelector('#toast-region');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
  region.append(toast);
  setTimeout(() => toast.remove(), 3400);
}

function preferenceBoolean(key, fallback) {
  const value = localStorage.getItem(key);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function kindIcon(kind) {
  if (kind === 'skill') return 'skill';
  if (kind === 'mcp') return 'server';
  return 'file';
}

function emptyState(icon, title, description) {
  return `
    <div class="empty-state">
      <div>
        ${iconMarkup(icon)}
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(description)}</p>
      </div>
    </div>
  `;
}

function render() {
  renderNav();
  renderCollection();
  renderContent();
  renderInspector();
  updateApplyButtons();
  renderRuntimeState();
  renderScopedControls();
}

function renderScopedControls() {
  const writable = canWrite();
  const admin = canAdminister();
  document.querySelector('#new-artifact').hidden = !writable;
  document.querySelector('#apply-top').hidden = !writable;
  document.querySelector('#apply-bottom').hidden = !writable;
  const hasArtifact = getSelectedArtifact() !== undefined;
  document.querySelector('#more-actions').hidden = !writable || !hasArtifact;
  document.querySelector('#open-external').hidden = !admin || !hasArtifact;
  document.querySelector('#preview-diff').disabled = !hasArtifact;
  const action = document.querySelector('#collection-action');
  action.disabled =
    (state.section === 'library' && !writable) ||
    (state.section === 'inbox' && !admin);
}

function renderRuntimeState() {
  const label = document.querySelector('.runtime-label');
  const connection = document.querySelector('.actionbar-state');
  const workspaceDetail = document.querySelector('.workspace-copy small');
  if (state.runtimeMode === 'live') {
    label.textContent = `${titleCase(state.runtimeScope)} session`;
    connection.innerHTML = `<span class="connection-dot" aria-hidden="true"></span>${state.runtimeConnected ? 'Local runtime ready' : 'Reconnecting to runtime'}`;
    connection.classList.toggle('is-offline', !state.runtimeConnected);
    workspaceDetail.textContent = state.runtimeSnapshot?.sync?.configured
      ? 'Sync configured'
      : 'Sync off';
    return;
  }
  label.textContent = 'Preview data';
  connection.innerHTML =
    '<span class="connection-dot" aria-hidden="true"></span>Mock workspace';
  workspaceDetail.textContent = 'Preview mode';
}

document.querySelector('#collection-search').addEventListener('input', (event) => {
  state.collectionQuery = event.currentTarget.value;
  state.collectionLimit = 200;
  scheduleIndexedSearch();
  renderCollection();
});

let indexedSearchTimeout;

function scheduleIndexedSearch() {
  clearTimeout(indexedSearchTimeout);
  const query = state.collectionQuery.trim();
  const searchableSection = state.section === 'library' || state.section === 'inbox';
  state.searchRequest += 1;
  const request = state.searchRequest;
  if (
    state.runtimeMode !== 'live' ||
    !searchableSection ||
    query.length === 0
  ) {
    state.searchResultIds = undefined;
    state.searchPending = false;
    return;
  }
  state.searchResultIds = undefined;
  state.searchPending = true;
  indexedSearchTimeout = setTimeout(async () => {
    try {
      const result = await state.runtimeClient.execute({
        type: 'search',
        query,
        limit: 1_000,
      });
      if (
        request !== state.searchRequest ||
        query !== state.collectionQuery.trim()
      ) {
        return;
      }
      const records = Array.isArray(result.data) ? result.data : [];
      state.searchResultIds = new Set(
        records
          .map((record) =>
            typeof record === 'object' &&
            record !== null &&
            typeof record.id === 'string'
              ? record.id
              : undefined,
          )
          .filter(Boolean),
      );
    } catch (error) {
      if (request !== state.searchRequest) return;
      state.searchResultIds = undefined;
      handleRuntimeError(error, 'Indexed search is unavailable');
    } finally {
      if (request === state.searchRequest) {
        state.searchPending = false;
        renderCollection();
      }
    }
  }, 120);
}

document.querySelectorAll('.content-tabs [data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    state.contentView = button.dataset.view;
    renderContent();
  });
});

document.querySelector('#command-trigger').addEventListener('click', openCommandPalette);
document.querySelector('#new-artifact').addEventListener('click', () =>
  runCommand('create'),
);
document.querySelector('#collection-action').addEventListener('click', () => {
  if (state.section === 'library') runCommand('create');
  else if (state.section === 'inbox') runCommand('scan');
  else if (state.section === 'activity') void exportDiagnostics();
  else if (state.section === 'settings') {
    state.selectedSetting = 'diagnostics';
    render();
  } else {
    showToast('Detection complete', '6 supported providers are available.');
  }
});
document.querySelector('#preview-diff').addEventListener('click', () => {
  const provider = getSelectedProvider();
  const artifact = getSelectedArtifact();
  if (artifact === undefined || provider === undefined) return;
  const item =
    artifact.projections[provider.id] ?? projection('not-targeted');
  void openProjectionPreview(provider, item);
});
document.querySelector('#open-external').addEventListener('click', () => {
  const artifact = getSelectedArtifact();
  if (!canAdminister()) {
    showToast('Admin scope required', 'Opening local applications requires admin scope.');
    return;
  }
  if (artifact === undefined) return;
  if (state.runtimeMode !== 'live') {
    showToast(
      'External editor',
      `Would open the canonical ${artifact.kind} source.`,
    );
    return;
  }
  void state.runtimeClient
    .execute({
      type: 'external.open',
      target: {
        kind: 'canonical',
        artifact: artifact.id,
      },
    })
    .then(() =>
      showToast(
        'Opened externally',
        `Canonical ${artifact.kind} source opened.`,
      ),
    )
    .catch((error) =>
      handleRuntimeError(error, 'Could not open the canonical source'),
    );
});
document.querySelector('#more-actions').addEventListener('click', () =>
  openArtifactActions(),
);
document
  .querySelector('#action-sheet-close')
  .addEventListener('click', closeActionSheet);
document.querySelector('#workspace-button').addEventListener('click', () =>
  showToast('Local workspace', 'Sync and remote access are both disabled.'),
);
document.querySelector('#collapse-inspector').addEventListener('click', () => {
  document.body.classList.toggle('inspector-collapsed');
});
document.querySelector('#apply-top').addEventListener('click', applyChanges);
document.querySelector('#apply-bottom').addEventListener('click', applyChanges);

const commandInput = document.querySelector('#command-input');
commandInput.addEventListener('input', () => {
  state.commandQuery = commandInput.value;
  state.commandIndex = 0;
  renderCommandPalette();
});
commandInput.addEventListener('keydown', (event) => {
  const commands = commandItems().filter((item) =>
    `${item.label} ${item.detail}`.toLowerCase().includes(
      state.commandQuery.trim().toLowerCase(),
    ),
  );
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    state.commandIndex = (state.commandIndex + 1) % Math.max(commands.length, 1);
    renderCommandPalette();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    state.commandIndex =
      (state.commandIndex - 1 + Math.max(commands.length, 1)) %
      Math.max(commands.length, 1);
    renderCommandPalette();
  } else if (event.key === 'Enter' && commands[state.commandIndex]) {
    event.preventDefault();
    runCommand(commands[state.commandIndex].id);
  }
});

document.addEventListener('keydown', (event) => {
  const sheet = document.querySelector('#action-sheet');
  if (event.key === 'Escape' && !sheet.hidden) {
    event.preventDefault();
    closeActionSheet();
    return;
  }
  const commandKey = event.metaKey || event.ctrlKey;
  if (commandKey && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommandPalette();
  } else if (commandKey && event.key === 'Enter') {
    event.preventDefault();
    applyChanges();
  } else if (commandKey && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    document.querySelector('#preview-diff').click();
  } else if (commandKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    document.querySelector('#open-external').click();
  } else if (
    commandKey &&
    event.key.toLowerCase() === 'f' &&
    !document.querySelector('#command-dialog').open
  ) {
    event.preventDefault();
    document.querySelector('#collection-search').focus();
  }
});

const pairingForm = document.querySelector('#pairing-form');
pairingForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitPairingCode();
});

async function startManager() {
  if (
    location.protocol === 'file:' ||
    new URLSearchParams(location.search).get('mock') === '1'
  ) {
    state.runtimeMode = 'mock';
    document.querySelector('#app-shell').hidden = false;
    render();
    return;
  }

  showRuntimeGate(
    'Connecting to the local runtime…',
    'Reglet is loading canonical metadata and observed provider state.',
    true,
  );
  try {
    const result = await window.RegletRuntime.bootstrap();
    if (result.mode === 'pairing') {
      showPairingGate();
      return;
    }
    await activateRuntime(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The local runtime could not be reached.';
    showPairingGate(message);
  }
}

async function activateRuntime(result) {
  if (result.mode !== 'live') return;
  state.runtimeMode = 'live';
  state.runtimeClient = result.client;
  state.runtimeScope = result.client.session?.scope ?? 'read';
  installRuntimeSnapshot(await result.client.snapshot());
  await loadSelectedArtifactDetail();
  document.querySelector('#runtime-gate').hidden = true;
  document.querySelector('#app-shell').hidden = false;
  render();
  maybeOpenOnboarding();
  void result.client
    .subscribe(
      (event) => {
        if (event.type === 'invalidated') {
          void refreshRuntimeSnapshot();
        }
      },
      (connected) => {
        state.runtimeConnected = connected;
        renderRuntimeState();
      },
    )
    .catch((error) => handleRuntimeError(error, 'Live updates are unavailable'));
}

function maybeOpenOnboarding() {
  if (
    !canWrite() ||
    localStorage.getItem('reglet.onboarding-complete') === 'true' ||
    providerCatalog.some((provider) => provider.enrolled?.provider)
  ) {
    return;
  }
  openActionSheet(
    'Set up your local workspace',
    'Reglet keeps canonical content separate from provider projections and project discoveries.',
    `
      <div class="onboarding-boundaries">
        <div class="sheet-callout"><strong>Library</strong><br>Canonical, editable, and optionally synced.</div>
        <div class="sheet-callout"><strong>Providers</strong><br>Previewed projections that change only when you apply.</div>
        <div class="sheet-callout"><strong>Projects</strong><br>Read-only intake sources that stay on this machine.</div>
      </div>
      <form id="onboarding-form">
        <fieldset class="target-picker">
          <legend>Enroll detected providers</legend>
          ${providerCatalog
            .map(
              (provider) => `
                <label class="target-choice">
                  <input type="checkbox" name="provider" value="${escapeHtml(provider.id)}" ${provider.detected ? 'checked' : ''}>
                  <span>${escapeHtml(provider.name)}${provider.detected ? ' · Detected' : ''}</span>
                </label>
              `,
            )
            .join('')}
        </fieldset>
        <div class="sheet-actions">
          <button class="button button-quiet" type="button" data-onboarding-skip>Skip for now</button>
          <button class="button button-primary" type="submit">Finish setup</button>
        </div>
      </form>
    `,
    true,
  );
  document
    .querySelector('[data-onboarding-skip]')
    .addEventListener('click', closeActionSheet);
  document
    .querySelector('#onboarding-form')
    .addEventListener('submit', (event) => {
      event.preventDefault();
      void completeOnboarding(event.currentTarget);
    });
}

async function completeOnboarding(form) {
  const button = form.querySelector('button[type="submit"]');
  const providers = [
    ...form.querySelectorAll('input[name="provider"]:checked'),
  ].map((input) => input.value);
  button.disabled = true;
  button.textContent = 'Setting up…';
  try {
    for (const provider of providers) {
      await state.runtimeClient.execute({
        type: 'providers.enrollment',
        provider,
        enrolled: true,
      });
    }
    localStorage.setItem('reglet.onboarding-complete', 'true');
    closeActionSheet();
    await refreshRuntimeSnapshot({ loadSelected: false });
    showToast(
      'Workspace ready',
      'Artifacts still start without targets; provider writes remain explicit.',
    );
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Finish setup';
    handleRuntimeError(error, 'Could not finish local setup');
  }
}

async function submitPairingCode() {
  const input = document.querySelector('#pairing-code');
  const button = pairingForm.querySelector('button[type="submit"]');
  const status = document.querySelector('#runtime-gate-status');
  const code = input.value.trim();
  if (code.length === 0) return;
  button.disabled = true;
  button.textContent = 'Pairing…';
  status.textContent = '';
  try {
    const result = await window.RegletRuntime.pair(location.origin, code);
    await activateRuntime(result);
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : 'Pairing failed. Create a new one-use code and try again.';
    input.select();
  } finally {
    button.disabled = false;
    button.textContent = 'Pair manager';
  }
}

function showPairingGate(message) {
  state.runtimeClient?.close();
  state.runtimeMode = 'pairing';
  document.querySelector('#app-shell').hidden = true;
  showRuntimeGate(
    'Pair with the local runtime',
    'Enter the one-use code shown by reglet session pair --scope admin. It expires after ten minutes.',
    false,
  );
  document.querySelector('#runtime-gate-status').textContent = message ?? '';
  requestAnimationFrame(() => document.querySelector('#pairing-code').focus());
}

function showRuntimeGate(title, copy, connecting) {
  const gate = document.querySelector('#runtime-gate');
  gate.hidden = false;
  document.querySelector('#runtime-gate-title').textContent = title;
  document.querySelector('#runtime-gate-copy').textContent = copy;
  pairingForm.hidden = connecting;
  document.querySelector('.runtime-gate-note').hidden = connecting;
  document.querySelector('#runtime-gate-status').textContent = '';
}

void startManager();
