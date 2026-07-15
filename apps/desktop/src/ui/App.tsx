import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  GitCompare,
  History,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  JsonObject,
  ManagerContentId,
  ManagerMergeRunnerId,
  ManagerProviderId,
  ManagerSnapshotV2,
} from '@reglet/manager-protocol';
import { jsonObject, type ManagerBridge, type UpdateCheckResult } from '../managerBridge.js';
import { BrandMark } from './BrandMark.js';
import { OnboardingWizard } from './OnboardingWizard.js';

const sections = ['Providers', 'Rules', 'Skills', 'MCP', 'Activity & Drift', 'Recovery'] as const;
type Section = (typeof sections)[number];
type Dialog =
  | { kind: 'destructive'; title: string; body: string; actionLabel: string; run: () => Promise<void> }
  | { kind: 'ai-consent'; providers: ManagerProviderId[]; runner: string; run: () => Promise<void> }
  | { kind: 'unsaved'; run: () => void };

interface RuleDocument {
  path: string;
  scope: { kind: 'shared' | 'provider'; provider?: ManagerProviderId };
}

interface MergeRunner {
  id: ManagerMergeRunnerId;
  displayName: string;
}

interface SkillSummary {
  name: string;
  scope: 'shared' | 'provider' | 'unmanaged';
  provider?: ManagerProviderId;
  fileCount: number;
  conflict: boolean;
}

interface SkillFile {
  path: string;
  bytes: number;
}

interface McpServerSummary {
  id: string;
  displayName: string;
  server: JsonObject;
  issues: string[];
}

const contentIds: ManagerContentId[] = ['rules', 'skills', 'mcp'];

interface AppProps {
  bridge: ManagerBridge;
}

interface DraftState {
  rulesPath: string;
  rulesText: string;
  skillName: string;
  skillNewName: string;
  skillPath: string;
  skillNewPath: string;
  skillText: string;
  skillScope: 'shared' | 'provider';
  skillProvider: ManagerProviderId;
  adoptProvider: ManagerProviderId;
  mcpId: string;
  mcpDisplayName: string;
  mcpProvider: ManagerProviderId;
  mcpScope: 'shared' | 'provider';
  mcpText: string;
}

const initialDrafts: DraftState = {
  rulesPath: 'AGENTS.md',
  rulesText: '',
  skillName: 'review',
  skillNewName: 'review-renamed',
  skillPath: 'SKILL.md',
  skillNewPath: 'README.md',
  skillText: '# Skill\n',
  skillScope: 'shared',
  skillProvider: 'claude',
  adoptProvider: 'claude',
  mcpId: 'local-server',
  mcpDisplayName: 'Local server',
  mcpProvider: 'claude',
  mcpScope: 'shared',
  mcpText: '{\n  "command": "node",\n  "args": []\n}',
};

export function App({ bridge }: AppProps) {
  const [section, setSection] = useState<Section>('Providers');
  const [snapshot, setSnapshot] = useState<ManagerSnapshotV2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [drafts, setDrafts] = useState<DraftState>(initialDrafts);
  const [dirty, setDirty] = useState(false);
  const [autoUpdates, setAutoUpdates] = useState(() => readAutoUpdatePreference());
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [review, setReview] = useState<{ digest: string; entries: JsonObject[] } | null>(null);
  const [selectedProviders, setSelectedProviders] = useState<ManagerProviderId[]>([]);
  const [selectedContents, setSelectedContents] = useState<ManagerContentId[]>(['rules', 'skills', 'mcp']);
  const [ruleDocuments, setRuleDocuments] = useState<RuleDocument[]>([]);
  const [mergeRunners, setMergeRunners] = useState<MergeRunner[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillFiles, setSkillFiles] = useState<SkillFile[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [showsOnboarding, setShowsOnboarding] = useState(false);
  const promptedForOnboarding = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSnapshot = await bridge.snapshot();
      setSnapshot(nextSnapshot);
      setSelectedProviders((current) => {
        const detected = nextSnapshot.providerDiscovery.filter((provider) => provider.detected).map((provider) => provider.provider);
        const available = new Set(detected);
        const retained = current.filter((provider) => available.has(provider));
        if (retained.length > 0) return retained;
        const enrolled = nextSnapshot.enrollmentMatrix.filter((provider) => provider.enabled).map((provider) => provider.provider);
        return enrolled.length > 0 ? enrolled : detected;
      });
      if (!promptedForOnboarding.current && needsOnboarding(nextSnapshot)) {
        promptedForOnboarding.current = true;
        setShowsOnboarding(true);
      }
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  const checkForUpdates = useCallback(async (silent = false) => {
    setError(null);
    try {
      const result = await bridge.checkForUpdates();
      setUpdate(result.available ? result : null);
      if (!silent) {
        setNotice(result.available
          ? `Reglet ${result.latestVersion} is available.`
          : `Reglet ${result.currentVersion} is up to date.`);
      }
    } catch (updateError) {
      if (!silent) setError(errorMessage(updateError));
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (autoUpdates) void checkForUpdates(true);
  }, [autoUpdates, checkForUpdates]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      const primaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (primaryModifier && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void refresh();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [refresh]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeClose = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [dirty]);

  const mutate = useCallback(async (operation: Parameters<ManagerBridge['rpc']>[0], input?: JsonObject, success = 'Done.') => {
    setBusy(true);
    setError(null);
    try {
      await bridge.rpc(operation, input);
      setNotice(success);
      setDirty(false);
      await refresh();
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setBusy(false);
    }
  }, [bridge, refresh]);

  const providers = snapshot?.providerDiscovery.map((provider) => provider.provider) ?? [];
  const activeProviders = selectedProviders.length > 0 ? selectedProviders : providers.filter((provider) =>
    snapshot?.enrollmentMatrix.find((entry) => entry.provider === provider)?.enabled === true,
  );

  const changeSection = (next: Section) => {
    if (dirty) {
      setDialog({ kind: 'unsaved', run: () => { setDirty(false); setSection(next); } });
      return;
    }
    setSection(next);
  };

  const previewApply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = jsonObject(await bridge.rpc('structured-preview.preview', {
        providers: activeProviders,
        contents: selectedContents,
      }));
      if (typeof result.digest !== 'string' || !Array.isArray(result.entries)) {
        throw new Error('Reglet returned an invalid structured preview.');
      }
      setReview({ digest: result.digest, entries: result.entries.filter(jsonObjectFromUnknown) });
      setNotice('Review plan is ready.');
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setBusy(false);
    }
  };

  const applyReview = async () => {
    if (review === null) return;
    await mutate('structured-preview.apply', {
      digest: review.digest,
      providers: activeProviders,
      contents: selectedContents,
    }, 'Reviewed changes applied.');
    setReview(null);
  };

  const confirmApplyReview = () => {
    if (review === null) return;
    setDialog({
      kind: 'destructive',
      title: 'Apply reviewed changes',
      body: `Apply exactly ${review.entries.length} digest-backed changes? Reglet will snapshot existing targets first.`,
      actionLabel: 'Apply reviewed',
      run: applyReview,
    });
  };

  const loadRules = async () => {
    setBusy(true);
    setError(null);
    try {
      const [listResult, runnersResult] = await Promise.all([
        bridge.rpc('rules.list', {}),
        bridge.rpc('rules.merge-runners', {}),
      ]);
      const documents = objectArray(jsonObject(listResult).documents).map(ruleDocumentFromJson).filter(isDefined);
      const runners = objectArray(jsonObject(runnersResult).runners).map(mergeRunnerFromJson).filter(isDefined);
      setRuleDocuments(documents);
      setMergeRunners(runners);
      setNotice(`Loaded ${documents.length} rule documents.`);
    } catch (listError) {
      setError(errorMessage(listError));
    } finally {
      setBusy(false);
    }
  };

  const selectRule = async (document: RuleDocument) => {
    setDrafts((current) => ({ ...current, rulesPath: document.path }));
    setBusy(true);
    try {
      const result = jsonObject(await bridge.rpc('rules.read', { path: document.path }));
      setDrafts((current) => ({ ...current, rulesText: String(result.content ?? '') }));
      setDirty(false);
    } catch (readError) {
      setError(errorMessage(readError));
    } finally {
      setBusy(false);
    }
  };

  const loadSkills = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = jsonObject(await bridge.rpc('skills.list', {}));
      const summaries = parseSkillSummaries(result);
      setSkills(summaries);
      setNotice(`Loaded ${summaries.length} managed and unmanaged skills.`);
    } catch (listError) {
      setError(errorMessage(listError));
    } finally {
      setBusy(false);
    }
  };

  const selectSkill = async (skill: SkillSummary) => {
    setBusy(true);
    setError(null);
    try {
      setSelectedSkill(skill);
      const scope = skill.scope === 'provider' ? 'provider' : 'shared';
      setDrafts((current) => ({
        ...current,
        skillName: skill.name,
        skillScope: scope,
        ...(skill.provider === undefined ? {} : { skillProvider: skill.provider, adoptProvider: skill.provider }),
      }));
      const result = skill.scope === 'unmanaged'
        ? jsonObject(await bridge.rpc('skills.inspect', { provider: skill.provider ?? 'claude', name: skill.name }))
        : jsonObject(await bridge.rpc('skills.tree', skillScopeInput(scope, skill.provider, { name: skill.name })));
      const tree = objectFromUnknown(result.tree);
      const files = objectArray(tree?.files).map(skillFileFromJson).filter(isDefined);
      setSkillFiles(files);
      if (files.some((file) => file.path === 'SKILL.md')) {
        const fileResult = skill.scope === 'unmanaged'
          ? jsonObject(await bridge.rpc('skills.inspect', { provider: skill.provider ?? 'claude', name: skill.name, path: 'SKILL.md' }))
          : jsonObject(await bridge.rpc('skills.read', skillScopeInput(scope, skill.provider, { name: skill.name, path: 'SKILL.md' })));
        const document = objectFromUnknown(fileResult.document);
        setDrafts((current) => ({ ...current, skillPath: 'SKILL.md', skillText: String(document?.content ?? '') }));
      }
      setDirty(false);
    } catch (skillError) {
      setError(errorMessage(skillError));
    } finally {
      setBusy(false);
    }
  };

  const readSkillDocument = async (path: string) => {
    setBusy(true);
    try {
      const result = selectedSkill?.scope === 'unmanaged'
        ? jsonObject(await bridge.rpc('skills.inspect', { provider: selectedSkill.provider ?? drafts.adoptProvider, name: selectedSkill.name, path }))
        : jsonObject(await bridge.rpc('skills.read', skillMutationInput(drafts, { path })));
      const document = objectFromUnknown(result.document);
      setDrafts((current) => ({ ...current, skillPath: path, skillText: String(document?.content ?? '') }));
      setDirty(false);
    } catch (skillError) {
      setError(errorMessage(skillError));
    } finally {
      setBusy(false);
    }
  };

  const loadMcpServers = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = jsonObject(await bridge.rpc('mcp.list', mcpScopeInput(drafts)));
      const servers = objectArray(result.servers).map(mcpServerFromJson).filter(isDefined);
      setMcpServers(servers);
      setNotice(`Loaded ${servers.length} MCP servers.`);
    } catch (listError) {
      setError(errorMessage(listError));
    } finally {
      setBusy(false);
    }
  };

  const mergeRulesWithAi = (runner: ManagerMergeRunnerId) => {
    const providersForMerge = activeProviders.filter((provider): provider is ManagerProviderId => provider !== undefined);
    setDialog({
      kind: 'ai-consent',
      providers: providersForMerge,
      runner,
      run: async () => {
        try {
          const result = jsonObject(await bridge.rpc('rules.merge-draft', { providers: providersForMerge, runner }));
          setDrafts((current) => ({ ...current, rulesText: String(result.draft ?? '') }));
          setDirty(true);
          setNotice('AI merge draft loaded for review.');
        } catch (mergeError) {
          setError(errorMessage(mergeError));
        }
      },
    });
  };

  const saveMcp = async () => {
    try {
      await mutate('mcp.upsert', mcpInput(drafts), 'MCP server saved.');
    } catch (mcpError) {
      setError(errorMessage(mcpError));
    }
  };

  const readRule = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = jsonObject(await bridge.rpc('rules.read', { path: drafts.rulesPath }));
      setDrafts((current) => ({ ...current, rulesText: String(result.content ?? '') }));
      setDirty(false);
      setNotice('Rule loaded.');
    } catch (readError) {
      setError(errorMessage(readError));
    } finally {
      setBusy(false);
    }
  };

  const stateTone = snapshot?.state.state ?? 'draftOnly';

  return (
    <main className="min-h-screen bg-reglet-bg text-reglet-text">
      <header className="border-b border-reglet-line bg-reglet-panel/95 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <h1 className="text-xl font-semibold tracking-normal">Reglet</h1>
              <p className="text-sm text-reglet-muted">Local manager for rules, skills, and MCP configuration.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge state={stateTone} />
            <button className="icon-button" onClick={() => void refresh()} aria-label="Refresh Manager snapshot" disabled={loading || busy}>
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-73px)] grid-cols-[230px_1fr]">
        <nav className="border-r border-reglet-line bg-reglet-panel px-3 py-4" aria-label="Reglet sections">
          {sections.map((item) => (
            <button
              key={item}
              className={`nav-button ${section === item ? 'nav-button-active' : ''}`}
              onClick={() => changeSection(item)}
              aria-current={section === item ? 'page' : undefined}
            >
              {sectionIcon(item)}
              <span>{item}</span>
            </button>
          ))}
          <div className="mt-6 rounded-md border border-reglet-line bg-reglet-panel2 p-3 text-xs text-reglet-muted">
            <p className="font-medium text-reglet-text">Updates</p>
            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoUpdates}
                onChange={(event) => {
                  const enabled = event.currentTarget.checked;
                  writeAutoUpdatePreference(enabled);
                  setAutoUpdates(enabled);
                }}
                aria-label="Opt in to automatic update checks"
              />
              Automatic checks
            </label>
            <button className="secondary-button mt-3 w-full" onClick={() => void checkForUpdates()} aria-label="Check for updates manually">
              Check now
            </button>
            {update !== null && (
              <button className="primary-button mt-2 w-full" onClick={() => void bridge.openRelease()}>
                Open {update.latestVersion}
              </button>
            )}
          </div>
        </nav>

        <section className="overflow-auto px-6 py-5" aria-live="polite">
          {error !== null && <Banner tone="error" text={error} />}
          {notice !== null && <Banner tone="info" text={notice} onDismiss={() => setNotice(null)} />}
          {loading && <LoadingState />}
          {!loading && snapshot === null && <EmptyState title="No Manager snapshot" body="Reglet could not load local manager state." />}
          {!loading && snapshot !== null && (
            <>
              <SnapshotSummary snapshot={snapshot} />
              {section === 'Providers' && (
                <ProvidersView
                  snapshot={snapshot}
                  selectedProviders={selectedProviders}
                  onSelectedProviders={setSelectedProviders}
                  onSetup={() => setShowsOnboarding(true)}
                  onEnrollment={(operation, input, success) => {
                    if (operation === 'unenroll') {
                      setDialog({ kind: 'destructive', title: 'Stop managing content', body: 'Detach Reglet ownership while preserving the provider content currently on disk?', actionLabel: 'Stop managing', run: () => mutate(operation, input, success) });
                    } else {
                      void mutate(operation, input, success);
                    }
                  }}
                  busy={busy}
                />
              )}
              {section === 'Rules' && (
                <RulesView
                  drafts={drafts}
                  setDrafts={setDrafts}
                  setDirty={setDirty}
                  documents={ruleDocuments}
                  runners={mergeRunners}
                  onLoad={() => void loadRules()}
                  onSelect={(document) => void selectRule(document)}
                  onRead={() => void readRule()}
                  onSave={() => void mutate('rules.write', { path: drafts.rulesPath, content: drafts.rulesText }, 'Rule saved.')}
                  onMerge={mergeRulesWithAi}
                  busy={busy}
                />
              )}
              {section === 'Skills' && (
                <SkillsView
                  snapshot={snapshot}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  setDirty={setDirty}
                  skills={skills}
                  files={skillFiles}
                  onLoad={() => void loadSkills()}
                  onSelect={(skill) => void selectSkill(skill)}
                  onReadFile={(path) => void readSkillDocument(path)}
                  onCreate={() => void mutate('skills.create', skillMutationInput(drafts, { content: drafts.skillText }), 'Skill created.')}
                  onWrite={() => void mutate('skills.write', skillMutationInput(drafts, { path: drafts.skillPath, content: drafts.skillText }), 'Skill file saved.')}
                  onRename={() => void mutate('skills.rename', skillMutationInput(drafts, { newName: drafts.skillNewName }), 'Skill renamed.')}
                  onRenameFile={() => void mutate('skills.rename-file', skillMutationInput(drafts, { path: drafts.skillPath, newPath: drafts.skillNewPath }), 'Skill file renamed.')}
                  onDeleteFile={() => setDialog({ kind: 'destructive', title: 'Delete skill file', body: `Delete ${drafts.skillPath} from ${drafts.skillName}?`, actionLabel: 'Delete file', run: () => mutate('skills.delete-file', skillMutationInput(drafts, { path: drafts.skillPath }), 'Skill file deleted.') })}
                  onAdopt={() => {
                    const conflict = skills.find((skill) => skill.scope === 'unmanaged' && skill.provider === drafts.adoptProvider && skill.name === drafts.skillName)?.conflict ?? false;
                    setDialog({ kind: 'destructive', title: 'Adopt unmanaged skill', body: conflict ? 'The destination exists. Replace it with this provider-local skill?' : 'Copy this provider-local skill into Reglet while preserving its source?', actionLabel: conflict ? 'Replace and adopt' : 'Adopt skill', run: () => mutate('skills.adopt', { provider: drafts.adoptProvider, name: drafts.skillName, scope: drafts.skillScope, overwrite: conflict }, 'Unmanaged skill adopted.') });
                  }}
                  onDelete={() => setDialog({ kind: 'destructive', title: 'Delete skill', body: `Delete ${drafts.skillName} from ${drafts.skillScope} skills?`, actionLabel: 'Delete skill', run: () => mutate('skills.delete', skillMutationInput(drafts), 'Skill deleted.') })}
                  busy={busy}
                />
              )}
              {section === 'MCP' && (
                <McpView
                  snapshot={snapshot}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  setDirty={setDirty}
                  servers={mcpServers}
                  onLoad={() => void loadMcpServers()}
                  onSelect={(server) => { setDrafts((current) => ({ ...current, mcpId: server.id, mcpDisplayName: server.displayName, mcpText: JSON.stringify(server.server, null, 2) })); setDirty(false); }}
                  onSave={() => void saveMcp()}
                  onDelete={() => setDialog({ kind: 'destructive', title: 'Delete MCP server', body: `Delete ${drafts.mcpId} from ${drafts.mcpScope} MCP?`, actionLabel: 'Delete server', run: () => mutate('mcp.delete', mcpDeleteInput(drafts), 'MCP server deleted.') })}
                  busy={busy}
                />
              )}
              {section === 'Activity & Drift' && (
                <ActivityView
                  snapshot={snapshot}
                  review={review}
                  selectedProviders={activeProviders}
                  selectedContents={selectedContents}
                  setSelectedContents={setSelectedContents}
                  onPreview={() => void previewApply()}
                  onApply={confirmApplyReview}
                  onImport={(provider, content) => setDialog({ kind: 'destructive', title: 'Import drift', body: `Replace master ${content} with drift from ${provider}?`, actionLabel: 'Import drift', run: () => mutate('import-drift', { provider, content }, 'Drift imported.') })}
                  busy={busy}
                />
              )}
              {section === 'Recovery' && (
                <RecoveryView
                  snapshot={snapshot}
                  onRestore={(id) => setDialog({ kind: 'destructive', title: 'Restore operation', body: `Restore all files captured by receipt ${id}?`, actionLabel: 'Restore receipt', run: () => mutate('operation.restore', { id }, 'Receipt restored.') })}
                  onClearLegacy={() => setDialog({ kind: 'destructive', title: 'Remove legacy state', body: 'Remove inert pre-V1 network state from disk?', actionLabel: 'Remove legacy state', run: () => mutate('legacy-state.clear', {}, 'Legacy state removed.') })}
                  busy={busy}
                />
              )}
            </>
          )}
        </section>
      </div>
      {dialog !== null && <ConfirmDialog dialog={dialog} onClose={() => setDialog(null)} />}
      {showsOnboarding && snapshot !== null && (
        <OnboardingWizard
          bridge={bridge}
          snapshot={snapshot}
          onClose={() => setShowsOnboarding(false)}
          onStateChanged={refresh}
        />
      )}
    </main>
  );
}

function readAutoUpdatePreference(): boolean {
  try {
    return window.localStorage?.getItem('reglet.autoUpdateChecks') === 'true';
  } catch {
    return false;
  }
}

function writeAutoUpdatePreference(enabled: boolean): void {
  try {
    window.localStorage?.setItem('reglet.autoUpdateChecks', String(enabled));
  } catch {
    // Storage can be unavailable in hardened webviews. The in-memory opt-in still applies.
  }
}

function ProvidersView(props: {
  snapshot: ManagerSnapshotV2;
  selectedProviders: ManagerProviderId[];
  onSelectedProviders: (providers: ManagerProviderId[]) => void;
  onSetup: () => void;
  onEnrollment: (operation: 'enroll' | 'unenroll', input: JsonObject, success: string) => void;
  busy: boolean;
}) {
  return (
    <Panel title="Providers" action={<button className="primary-button" disabled={props.busy} onClick={props.onSetup}>Set up providers</button>}>
      <p className="text-sm text-reglet-muted">Choose providers for reviews and manage each content enrollment below.</p>
      <div className="data-grid mt-4">
        {props.snapshot.enrollmentMatrix.map((provider) => (
          <article key={provider.provider} className="row-card">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={props.selectedProviders.includes(provider.provider)}
                onChange={(event) => props.onSelectedProviders(toggle(props.selectedProviders, provider.provider, event.currentTarget.checked))}
                aria-label={`Select ${provider.displayName}`}
              />
              <span>
                <strong>{provider.displayName}</strong>
                <span className="ml-2 text-sm text-reglet-muted">{provider.enabled ? 'Managed' : 'Not managed'}</span>
              </span>
            </label>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {contentIds.map((content) => {
                const cell = provider.cells[content];
                return (
                  <button
                    key={content}
                    className="secondary-button justify-start"
                    onClick={() => props.onEnrollment(cell.enrolled ? 'unenroll' : 'enroll', { provider: provider.provider, content }, cell.enrolled ? 'Stopped managing content.' : 'Content enrolled.')}
                    aria-label={`${cell.enrolled ? 'Unenroll' : 'Enroll'} ${provider.displayName} ${content}`}
                  >
                    <StatusDot state={cell.capability.state} />
                    {content}: {cell.enrolled ? 'on' : 'off'}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function RulesView(props: {
  drafts: DraftState;
  setDrafts: (drafts: DraftState | ((current: DraftState) => DraftState)) => void;
  setDirty: (dirty: boolean) => void;
  documents: RuleDocument[];
  runners: MergeRunner[];
  onLoad: () => void;
  onSelect: (document: RuleDocument) => void;
  onRead: () => void;
  onSave: () => void;
  onMerge: (runner: ManagerMergeRunnerId) => void;
  busy: boolean;
}) {
  return (
    <Panel title="Rules" action={<div className="flex gap-2"><button className="secondary-button" onClick={props.onLoad} disabled={props.busy}>Load documents</button><button className="secondary-button" onClick={props.onRead} disabled={props.busy}>Read path</button><button className="primary-button" onClick={props.onSave} disabled={props.busy}>Save rule</button></div>}>
      {props.documents.length > 0 && <div className="mb-4 flex flex-wrap gap-2" aria-label="Rule documents">{props.documents.map((document) => <button className="secondary-button" key={`${document.scope.kind}-${document.scope.provider ?? 'shared'}-${document.path}`} onClick={() => props.onSelect(document)}>{document.scope.provider ?? 'shared'} · {document.path}</button>)}</div>}
      <div className="grid gap-3">
        <label className="field-label">Rule path<input className="text-input" value={props.drafts.rulesPath} onChange={(event) => { updateDraft(props.setDrafts, 'rulesPath', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">Rule content<textarea className="editor" value={props.drafts.rulesText} onChange={(event) => { updateDraft(props.setDrafts, 'rulesText', event.currentTarget.value); props.setDirty(true); }} /></label>
        <div className="flex gap-2">
          {props.runners.map((runner) => <button key={runner.id} className="secondary-button" onClick={() => props.onMerge(runner.id)}><Sparkles size={16} aria-hidden="true" /> Merge with {runner.displayName}</button>)}
          {props.runners.length === 0 && <span className="text-sm text-reglet-muted">Load documents to discover installed AI runners.</span>}
        </div>
      </div>
    </Panel>
  );
}

function SkillsView(props: {
  snapshot: ManagerSnapshotV2;
  drafts: DraftState;
  setDrafts: (drafts: DraftState | ((current: DraftState) => DraftState)) => void;
  setDirty: (dirty: boolean) => void;
  skills: SkillSummary[];
  files: SkillFile[];
  onLoad: () => void;
  onSelect: (skill: SkillSummary) => void;
  onReadFile: (path: string) => void;
  onCreate: () => void;
  onWrite: () => void;
  onRename: () => void;
  onRenameFile: () => void;
  onDeleteFile: () => void;
  onAdopt: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <Panel title="Skills" action={<div className="flex flex-wrap gap-2"><button className="secondary-button" onClick={props.onLoad} disabled={props.busy}>Load skills</button><button className="secondary-button" onClick={props.onCreate} disabled={props.busy}>Create</button><button className="primary-button" onClick={props.onWrite} disabled={props.busy}>Save file</button><button className="secondary-button" onClick={props.onRename} disabled={props.busy}>Rename skill</button><button className="secondary-button" onClick={props.onRenameFile} disabled={props.busy}>Rename file</button><button className="secondary-button" onClick={props.onAdopt} disabled={props.busy}>Adopt</button><button className="danger-button" onClick={props.onDeleteFile} disabled={props.busy}>Delete file</button><button className="danger-button" onClick={props.onDelete} disabled={props.busy}><Trash2 size={16} aria-hidden="true" /> Delete</button></div>}>
      <p className="mb-3 text-sm text-reglet-muted">Shared skills: {props.snapshot.master.skills.sharedSkills}. Provider-scoped skills: {sumRecord(props.snapshot.master.skills.providerScopedSkills)}.</p>
      {props.skills.length > 0 && <div className="mb-4 grid grid-cols-2 gap-2" aria-label="Skills browser">{props.skills.map((skill) => <button className="row-card text-left" key={`${skill.scope}-${skill.provider ?? 'shared'}-${skill.name}`} onClick={() => props.onSelect(skill)}><strong>{skill.name}</strong><span className="ml-2 text-xs text-reglet-muted">{skill.scope}{skill.provider === undefined ? '' : ` · ${skill.provider}`} · {skill.fileCount} files{skill.conflict ? ' · conflict' : ''}</span></button>)}</div>}
      <div className="grid grid-cols-2 gap-3">
        <label className="field-label">Skill name<input className="text-input" value={props.drafts.skillName} onChange={(event) => { updateDraft(props.setDrafts, 'skillName', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">New skill name<input className="text-input" value={props.drafts.skillNewName} onChange={(event) => { updateDraft(props.setDrafts, 'skillNewName', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">File path<input className="text-input" value={props.drafts.skillPath} onChange={(event) => { updateDraft(props.setDrafts, 'skillPath', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">New file path<input className="text-input" value={props.drafts.skillNewPath} onChange={(event) => { updateDraft(props.setDrafts, 'skillNewPath', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">Adopt from provider<input className="text-input" value={props.drafts.adoptProvider} onChange={(event) => { updateDraft(props.setDrafts, 'adoptProvider', event.currentTarget.value as ManagerProviderId); props.setDirty(true); }} /></label>
        <label className="field-label">Scope<select className="text-input" value={props.drafts.skillScope} onChange={(event) => { updateDraft(props.setDrafts, 'skillScope', event.currentTarget.value === 'provider' ? 'provider' : 'shared'); props.setDirty(true); }}><option value="shared">Shared</option><option value="provider">Provider</option></select></label>
        <label className="field-label">Scope provider<input className="text-input" disabled={props.drafts.skillScope === 'shared'} value={props.drafts.skillProvider} onChange={(event) => { updateDraft(props.setDrafts, 'skillProvider', event.currentTarget.value as ManagerProviderId); props.setDirty(true); }} /></label>
      </div>
      {props.files.length > 0 && <div className="mt-3 flex flex-wrap gap-2" aria-label="Skill files">{props.files.map((file) => <button className="secondary-button" key={file.path} onClick={() => props.onReadFile(file.path)}>{file.path} · {file.bytes} B</button>)}</div>}
      <label className="field-label mt-3">Skill file<textarea className="editor" value={props.drafts.skillText} onChange={(event) => { updateDraft(props.setDrafts, 'skillText', event.currentTarget.value); props.setDirty(true); }} /></label>
    </Panel>
  );
}

function McpView(props: {
  snapshot: ManagerSnapshotV2;
  drafts: DraftState;
  setDrafts: (drafts: DraftState | ((current: DraftState) => DraftState)) => void;
  setDirty: (dirty: boolean) => void;
  servers: McpServerSummary[];
  onLoad: () => void;
  onSelect: (server: McpServerSummary) => void;
  onSave: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <Panel title="MCP" action={<div className="flex gap-2"><button className="secondary-button" onClick={props.onLoad} disabled={props.busy}>Load servers</button><button className="primary-button" onClick={props.onSave} disabled={props.busy}>Save server</button><button className="danger-button" onClick={props.onDelete} disabled={props.busy}><Trash2 size={16} aria-hidden="true" /> Delete</button></div>}>
      <p className="mb-3 text-sm text-reglet-muted">Shared servers: {props.snapshot.master.mcp.sharedServers.length}. Missing environment variables block review and apply.</p>
      {props.servers.length > 0 && <div className="mb-4 grid grid-cols-2 gap-2" aria-label="MCP servers">{props.servers.map((server) => <button className="row-card text-left" key={server.id} onClick={() => props.onSelect(server)}><strong>{server.displayName}</strong><span className="ml-2 text-xs text-reglet-muted">{server.id}{server.issues.length === 0 ? '' : ` · ${server.issues.join('; ')}`}</span></button>)}</div>}
      <div className="grid grid-cols-2 gap-3">
        <label className="field-label">Server id<input className="text-input" value={props.drafts.mcpId} onChange={(event) => { updateDraft(props.setDrafts, 'mcpId', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">Display name<input className="text-input" value={props.drafts.mcpDisplayName} onChange={(event) => { updateDraft(props.setDrafts, 'mcpDisplayName', event.currentTarget.value); props.setDirty(true); }} /></label>
        <label className="field-label">Scope<select className="text-input" value={props.drafts.mcpScope} onChange={(event) => { updateDraft(props.setDrafts, 'mcpScope', event.currentTarget.value === 'provider' ? 'provider' : 'shared'); props.setDirty(true); }}><option value="shared">Shared</option><option value="provider">Provider</option></select></label>
        <label className="field-label">Provider<input className="text-input" value={props.drafts.mcpProvider} onChange={(event) => { updateDraft(props.setDrafts, 'mcpProvider', event.currentTarget.value as ManagerProviderId); props.setDirty(true); }} /></label>
      </div>
      <label className="field-label mt-3">Server JSON<textarea className="editor" value={props.drafts.mcpText} onChange={(event) => { updateDraft(props.setDrafts, 'mcpText', event.currentTarget.value); props.setDirty(true); }} /></label>
    </Panel>
  );
}

function ActivityView(props: {
  snapshot: ManagerSnapshotV2;
  review: { digest: string; entries: JsonObject[] } | null;
  selectedProviders: ManagerProviderId[];
  selectedContents: ManagerContentId[];
  setSelectedContents: (contents: ManagerContentId[]) => void;
  onPreview: () => void;
  onApply: () => void;
  onImport: (provider: ManagerProviderId, content: ManagerContentId) => void;
  busy: boolean;
}) {
  return (
    <Panel title="Activity & Drift" action={<div className="flex gap-2"><button className="secondary-button" onClick={props.onPreview} disabled={props.busy}>Review & Apply</button><button className="primary-button" onClick={props.onApply} disabled={props.busy || props.review === null}>Apply reviewed</button></div>}>
      <SelectionToolbar selectedContents={props.selectedContents} onSelectedContents={props.setSelectedContents} />
      {props.snapshot.driftInbox.length === 0 ? <EmptyState title="No drift" body="Managed provider outputs match the latest recorded Reglet state." /> : (
        <div className="mt-4 grid gap-2">
          {props.snapshot.driftInbox.map((item) => (
            <article className="row-card" key={`${item.provider}-${item.content}-${item.outputPath}`}>
              <div className="flex items-center justify-between gap-3">
                <span><StatusDot state={item.status === 'clean' ? 'supported' : 'needs-attention'} /> {item.provider} {item.content} is {item.status}</span>
                <button className="danger-button" onClick={() => props.onImport(item.provider as ManagerProviderId, item.content)}>Import drift</button>
              </div>
              <p className="mt-2 text-xs text-reglet-muted">{item.outputPath}</p>
            </article>
          ))}
        </div>
      )}
      {props.snapshot.problems.some((issue) => issue.code === 'STALE_PLAN') && <Banner tone="error" text="A stale plan was detected. Refresh and generate a new review before applying." />}
      {props.review !== null && (
        <div className="mt-4 rounded-md border border-reglet-line bg-reglet-panel2 p-4">
          <p className="font-medium">Structured review digest: {props.review.digest}</p>
          <p className="text-sm text-reglet-muted">{props.review.entries.length} planned changes for {props.selectedProviders.length} providers.</p>
          <div className="mt-3 grid gap-3">{props.review.entries.map((entry, index) => (
            <article className="review-entry" key={`${String(entry.provider)}-${String(entry.content)}-${index}`}>
              <p className="font-medium">{String(entry.provider)} · {String(entry.content)} · {String(entry.operation)}</p>
              <p className="mt-1 break-all text-xs text-reglet-muted">{String(entry.path)}</p>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{typeof entry.diff === 'string' && entry.diff.length > 0 ? entry.diff : jsonPreview(entry)}</pre>
            </article>
          ))}</div>
        </div>
      )}
    </Panel>
  );
}

function RecoveryView(props: {
  snapshot: ManagerSnapshotV2;
  onRestore: (id: string) => void;
  onClearLegacy: () => void;
  busy: boolean;
}) {
  return (
    <Panel title="Recovery" action={props.snapshot.legacyNetworkState.present ? <button className="danger-button" onClick={props.onClearLegacy} disabled={props.busy}>Remove legacy state</button> : undefined}>
      {props.snapshot.receipts.list.length === 0 ? <EmptyState title="No receipts" body="Completed provider writes will appear here with restore actions." /> : (
        <div className="grid gap-2">
          {props.snapshot.receipts.list.map((receipt) => (
            <article className="row-card" key={receipt.id}>
              <div className="flex items-center justify-between gap-3">
                <span><History size={16} aria-hidden="true" /> {receipt.id} · {receipt.lifecycle} · {receipt.targetCount} targets</span>
                <button className="secondary-button" onClick={() => props.onRestore(receipt.id)}>Restore</button>
              </div>
              <ReceiptDetails detail={props.snapshot.receipts.details.find((detail) => detail.id === receipt.id)} />
            </article>
          ))}
        </div>
      )}
      {props.snapshot.legacyNetworkState.present && <Banner tone="error" text={`Legacy state paths: ${props.snapshot.legacyNetworkState.paths.join(', ')}`} />}
    </Panel>
  );
}

function ReceiptDetails({ detail }: { detail: ManagerSnapshotV2['receipts']['details'][number] | undefined }) {
  if (detail === undefined) return null;
  return <div className="mt-3 border-t border-reglet-line pt-3 text-xs text-reglet-muted">
    {detail.structuredPreviewDigest !== undefined && <p className="break-all">Reviewed digest: {detail.structuredPreviewDigest}</p>}
    <p>Recovery: {detail.recovery.attempted ? (detail.recovery.recovered ? 'recovered' : 'attempt failed') : 'not needed'}</p>
    <ul className="mt-2 grid gap-1">{detail.targets.map((target) => <li className="break-all" key={target.path}>{target.snapshotKind} · {target.path}</li>)}</ul>
  </div>;
}

function ConfirmDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !working) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose, working]);
  const confirm = async () => {
    setWorking(true);
    if (dialog.kind === 'unsaved') {
      dialog.run();
      onClose();
      return;
    }
    await dialog.run();
    setWorking(false);
    onClose();
  };
  const title = dialog.kind === 'ai-consent'
    ? 'Allow AI runner'
    : dialog.kind === 'unsaved'
      ? 'Discard unsaved edits'
      : dialog.title;
  const body = dialog.kind === 'ai-consent'
    ? `${dialog.runner} will read local rule files for ${dialog.providers.join(', ')} and return an editable draft. Nothing is merged until you save and review.`
    : dialog.kind === 'unsaved'
      ? 'Discard unsaved edits and continue?'
      : dialog.body;
  const label = dialog.kind === 'ai-consent'
    ? 'Allow runner'
    : dialog.kind === 'unsaved'
        ? 'Discard edits'
        : dialog.actionLabel;
  return (
    <div className="modal-backdrop" role="presentation">
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <p id="confirm-body" className="mt-2 text-sm text-reglet-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} className="secondary-button" onClick={onClose} disabled={working}>Cancel</button>
          <button className={dialog.kind === 'ai-consent' ? 'primary-button' : 'danger-button'} onClick={() => void confirm()} disabled={working}>{label}</button>
        </div>
      </div>
    </div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: ManagerSnapshotV2 }) {
  return (
    <div className="mb-5 grid grid-cols-4 gap-3">
      <Metric label="Reglet home" value={snapshot.regletHome} />
      <Metric label="Providers" value={`${snapshot.providerDiscovery.filter((item) => item.detected).length}/${snapshot.providerDiscovery.length} detected`} />
      <Metric label="Drift" value={`${snapshot.driftInbox.length} items`} />
      <Metric label="Receipts" value={`${snapshot.receipts.list.length}`} />
    </div>
  );
}

function SelectionToolbar({ selectedContents, onSelectedContents }: { selectedContents: ManagerContentId[]; onSelectedContents: (contents: ManagerContentId[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Content selection">
      {contentIds.map((content) => (
        <label key={content} className="segmented">
          <input type="checkbox" checked={selectedContents.includes(content)} onChange={(event) => onSelectedContents(toggle(selectedContents, content, event.currentTarget.checked))} />
          {content}
        </label>
      ))}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card-surface p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Banner({ tone, text, onDismiss }: { tone: 'error' | 'info'; text: string; onDismiss?: () => void }) {
  return <div className={`banner ${tone === 'error' ? 'banner-error' : 'banner-info'}`} role={tone === 'error' ? 'alert' : 'status'}><AlertTriangle size={16} aria-hidden="true" /> <span>{text}</span>{onDismiss !== undefined && <button onClick={onDismiss} aria-label="Dismiss notification">Dismiss</button>}</div>;
}

function LoadingState() {
  return <div className="card-surface p-8 text-reglet-muted" role="status">Loading Manager snapshot...</div>;
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="rounded-md border border-dashed border-reglet-line p-6"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-reglet-muted">{body}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card-surface p-3"><p className="text-xs uppercase tracking-wider text-reglet-muted">{label}</p><p className="mt-1 truncate font-medium">{value}</p></div>;
}

function StatusBadge({ state }: { state: string }) {
  const blocked = state === 'blocked' || state === 'driftDetected';
  return <span className={`status-badge ${blocked ? 'status-badge-warn' : 'status-badge-ok'}`}>{blocked ? <ShieldAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />} {state}</span>;
}

function StatusDot({ state }: { state: string }) {
  return <span className={`status-dot ${state === 'supported' || state === 'clean' ? 'status-dot-ok' : 'status-dot-warn'}`} aria-hidden="true" />;
}

function sectionIcon(section: Section) {
  const props = { size: 17, 'aria-hidden': true };
  if (section === 'Providers') return <Download {...props} />;
  if (section === 'Rules') return <FileText {...props} />;
  if (section === 'Skills') return <Wrench {...props} />;
  if (section === 'MCP') return <Plug {...props} />;
  if (section === 'Activity & Drift') return <GitCompare {...props} />;
  return <RotateCcw {...props} />;
}

function toggle<T>(items: T[], item: T, checked: boolean): T[] {
  if (checked) return items.includes(item) ? items : [...items, item];
  return items.filter((candidate) => candidate !== item);
}

function needsOnboarding(snapshot: ManagerSnapshotV2): boolean {
  return snapshot.state.reasons.includes('noDestinationsEnrolled') &&
    snapshot.enrollmentMatrix.every((provider) => contentIds.every((content) => !provider.cells[content].enrolled));
}

function updateDraft<Key extends keyof DraftState>(
  setter: (drafts: DraftState | ((current: DraftState) => DraftState)) => void,
  key: Key,
  value: DraftState[Key],
): void {
  setter((current) => ({ ...current, [key]: value }));
}

function parseMcpDraft(text: string): JsonObject {
  const parsed = JSON.parse(text) as unknown;
  if (jsonObjectFromUnknown(parsed)) return parsed;
  throw new Error('MCP server JSON must be an object.');
}

function mcpInput(drafts: DraftState): JsonObject {
  return {
    id: drafts.mcpId,
    displayName: drafts.mcpDisplayName,
    scope: drafts.mcpScope,
    ...(drafts.mcpScope === 'provider' ? { provider: drafts.mcpProvider } : {}),
    server: parseMcpDraft(drafts.mcpText),
  };
}

function mcpDeleteInput(drafts: DraftState): JsonObject {
  return {
    id: drafts.mcpId,
    scope: drafts.mcpScope,
    ...(drafts.mcpScope === 'provider' ? { provider: drafts.mcpProvider } : {}),
  };
}

function mcpScopeInput(drafts: DraftState): JsonObject {
  return {
    scope: drafts.mcpScope,
    ...(drafts.mcpScope === 'provider' ? { provider: drafts.mcpProvider } : {}),
  };
}

type SkillBaseRpcInput = JsonObject & {
  scope: 'shared' | 'provider';
  provider?: ManagerProviderId;
  name: string;
};

function skillMutationInput<Extra extends JsonObject>(drafts: DraftState, extra?: Extra): SkillBaseRpcInput & Extra {
  return skillScopeInput(drafts.skillScope, drafts.skillProvider, { name: drafts.skillName, ...extra }) as SkillBaseRpcInput & Extra;
}

function skillScopeInput<Extra extends JsonObject>(scope: 'shared' | 'provider', provider: ManagerProviderId | undefined, extra: Extra): SkillBaseRpcInput & Extra {
  return {
    scope,
    ...(scope === 'provider' ? { provider: provider ?? 'claude' } : {}),
    ...extra,
  } as SkillBaseRpcInput & Extra;
}

function objectFromUnknown(value: unknown): JsonObject | undefined {
  return jsonObjectFromUnknown(value) ? value : undefined;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(jsonObjectFromUnknown) : [];
}

function ruleDocumentFromJson(value: JsonObject): RuleDocument | undefined {
  const scope = objectFromUnknown(value.scope);
  if (typeof value.path !== 'string' || (scope?.kind !== 'shared' && scope?.kind !== 'provider')) return undefined;
  if (scope.kind === 'provider') {
    const provider = scope.provider;
    if (!isProviderId(provider)) return undefined;
    return { path: value.path, scope: { kind: 'provider', provider } };
  }
  return { path: value.path, scope: { kind: 'shared' } };
}

function mergeRunnerFromJson(value: JsonObject): MergeRunner | undefined {
  if (!isMergeRunnerId(value.id) || typeof value.displayName !== 'string') return undefined;
  return { id: value.id, displayName: value.displayName };
}

function parseSkillSummaries(value: JsonObject): SkillSummary[] {
  const shared = objectArray(value.shared).flatMap((skill) => typeof skill.name === 'string'
    ? [{ name: skill.name, scope: 'shared' as const, fileCount: numberOrZero(skill.fileCount), conflict: false }]
    : []);
  const providerScoped = objectArray(value.providerScoped).flatMap((skill) =>
    typeof skill.name === 'string' && isProviderId(skill.provider)
      ? [{ name: skill.name, scope: 'provider' as const, provider: skill.provider, fileCount: numberOrZero(skill.fileCount), conflict: false }]
      : []);
  const unmanaged = objectArray(value.unmanaged).flatMap((skill) => {
    if (typeof skill.name !== 'string' || !isProviderId(skill.provider)) return [];
    return [{
      name: skill.name,
      scope: 'unmanaged' as const,
      provider: skill.provider,
      fileCount: 0,
      conflict: skill.sharedConflict === 'destination-exists' || skill.providerConflict === 'destination-exists',
    }];
  });
  return [...shared, ...providerScoped, ...unmanaged];
}

function skillFileFromJson(value: JsonObject): SkillFile | undefined {
  return typeof value.path === 'string' && typeof value.bytes === 'number'
    ? { path: value.path, bytes: value.bytes }
    : undefined;
}

function mcpServerFromJson(value: JsonObject): McpServerSummary | undefined {
  const server = objectFromUnknown(value.server);
  if (typeof value.id !== 'string' || typeof value.displayName !== 'string' || server === undefined) return undefined;
  return {
    id: value.id,
    displayName: value.displayName,
    server,
    issues: Array.isArray(value.issues) ? value.issues.filter((issue): issue is string => typeof issue === 'string') : [],
  };
}

function isProviderId(value: unknown): value is ManagerProviderId {
  return typeof value === 'string' && ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'].includes(value);
}

function isMergeRunnerId(value: unknown): value is ManagerMergeRunnerId {
  return value === 'codex' || value === 'claude' || value === 'gemini';
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function jsonPreview(value: JsonObject): string {
  return JSON.stringify(value, null, 2);
}

function jsonObjectFromUnknown(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sumRecord(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
