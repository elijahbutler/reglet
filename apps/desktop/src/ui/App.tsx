import {
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
  GitCompare,
  History,
  Plug,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
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

type RuleDocument =
  | { path: string; scope: { kind: 'shared' } }
  | { path: string; scope: { kind: 'provider'; provider: ManagerProviderId } };

interface MergeRunner {
  id: ManagerMergeRunnerId;
  displayName: string;
}

interface SkillSummary {
  name: string;
  scope: 'shared' | 'provider' | 'unmanaged';
  provider?: ManagerProviderId;
  path?: string;
  fileCount: number;
  conflict: boolean;
  syncProviders: ManagerProviderId[];
}

interface McpServerSummary {
  id: string;
  displayName: string;
  server: JsonObject;
  issues: string[];
  scope: 'shared' | 'provider';
  provider?: ManagerProviderId;
  path: string;
  syncProviders: ManagerProviderId[];
}

const contentIds: ManagerContentId[] = ['rules', 'skills', 'mcp'];

interface AppProps {
  bridge: ManagerBridge;
}

interface DraftState {
  rulesPath: string;
  rulesText: string;
  skillName: string;
  skillText: string;
  skillScope: 'shared' | 'provider';
  skillProvider: ManagerProviderId;
  skillSyncProviders: ManagerProviderId[];
  mcpId: string;
  mcpDisplayName: string;
  mcpProvider: ManagerProviderId;
  mcpScope: 'shared' | 'provider';
  mcpText: string;
  mcpSyncProviders: ManagerProviderId[];
}

const initialDrafts: DraftState = {
  rulesPath: 'AGENTS.md',
  rulesText: '',
  skillName: 'review',
  skillText: '# Skill\n',
  skillScope: 'shared',
  skillProvider: 'claude',
  skillSyncProviders: [],
  mcpId: 'local-server',
  mcpDisplayName: 'Local server',
  mcpProvider: 'claude',
  mcpScope: 'shared',
  mcpText: '{\n  "command": "node",\n  "args": []\n}',
  mcpSyncProviders: [],
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
  const [selectedRuleDocument, setSelectedRuleDocument] = useState<RuleDocument | null>(null);
  const [mergeRunners, setMergeRunners] = useState<MergeRunner[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillSummary | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [selectedMcpServer, setSelectedMcpServer] = useState<McpServerSummary | null>(null);
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
    if (section === 'Rules' && snapshot !== null && ruleDocuments.length === 0 && !busy) {
      void loadRules();
    }
  }, [section, snapshot]);

  useEffect(() => {
    if (section === 'Skills' && snapshot !== null && skills.length === 0 && !busy) {
      void loadSkills();
    }
  }, [section, snapshot]);

  useEffect(() => {
    if (section === 'MCP' && snapshot !== null && mcpServers.length === 0 && !busy) {
      void loadMcpServers();
    }
  }, [section, snapshot]);

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
      const nextDocument = preferredRuleDocument(documents, selectedRuleDocument?.path ?? drafts.rulesPath);
      setSelectedRuleDocument(nextDocument);
      if (nextDocument !== null) {
        const result = jsonObject(await bridge.rpc('rules.read', { path: nextDocument.path }));
        setDrafts((current) => ({
          ...current,
          rulesPath: nextDocument.path,
          rulesText: String(result.content ?? ''),
        }));
        setDirty(false);
      }
      setNotice(`Loaded ${documents.length} rule documents.`);
    } catch (listError) {
      setError(errorMessage(listError));
    } finally {
      setBusy(false);
    }
  };

  const selectRule = async (document: RuleDocument) => {
    setSelectedRuleDocument(document);
    setDrafts((current) => ({ ...current, rulesPath: document.path }));
    setBusy(true);
    setError(null);
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

  const openRuleLocation = async (path: string) => {
    setError(null);
    try {
      await bridge.openFileLocation(path);
    } catch (openError) {
      setError(errorMessage(openError));
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
        skillSyncProviders: skill.syncProviders,
        ...(skill.provider === undefined ? {} : { skillProvider: skill.provider }),
      }));
      const fileResult = skill.scope === 'unmanaged'
        ? jsonObject(await bridge.rpc('skills.inspect', { provider: skill.provider ?? 'claude', name: skill.name, path: 'SKILL.md' }))
        : jsonObject(await bridge.rpc('skills.read', skillScopeInput(scope, skill.provider, { name: skill.name, path: 'SKILL.md' })));
      const document = objectFromUnknown(fileResult.document);
      setDrafts((current) => ({ ...current, skillText: String(document?.content ?? '') }));
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
      const results = await Promise.all([
        bridge.rpc('mcp.list', {}),
        ...providers.map((provider) => bridge.rpc('mcp.list', { scope: 'provider', provider })),
      ]);
      const servers = results.flatMap((raw) => {
        const result = jsonObject(raw);
        const path = typeof result.path === 'string' ? result.path : '';
        return objectArray(result.servers).map((server) => mcpServerFromJson(server, path)).filter(isDefined);
      });
      setMcpServers(servers);
      setNotice(`Loaded ${servers.length} unified and provider-scoped MCP servers.`);
    } catch (listError) {
      setError(errorMessage(listError));
    } finally {
      setBusy(false);
    }
  };

  const selectMcpServer = (server: McpServerSummary) => {
    setSelectedMcpServer(server);
    setDrafts((current) => ({
      ...current,
      mcpId: server.id,
      mcpDisplayName: server.displayName,
      mcpScope: server.scope,
      mcpProvider: server.provider ?? current.mcpProvider,
      mcpText: JSON.stringify(server.server, null, 2),
      mcpSyncProviders: server.syncProviders,
    }));
    setDirty(false);
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

  const saveSkill = async () => {
    if (selectedSkill === null || selectedSkill.scope === 'unmanaged') return;
    setBusy(true);
    setError(null);
    try {
      await bridge.rpc('skills.write', skillMutationInput(drafts, { path: 'SKILL.md', content: drafts.skillText }));
      if (drafts.skillScope === 'shared') {
        await bridge.rpc('skills.update-sync', { name: drafts.skillName, providers: drafts.skillSyncProviders });
      }
      setSkills((current) => current.map((skill) => skillKey(skill) === skillKey(selectedSkill)
        ? { ...skill, syncProviders: drafts.skillSyncProviders }
        : skill));
      setSelectedSkill((current) => current === null ? null : { ...current, syncProviders: drafts.skillSyncProviders });
      setDirty(false);
      setNotice('Skill saved.');
    } catch (skillError) {
      setError(errorMessage(skillError));
    } finally {
      setBusy(false);
    }
  };

  const saveMcp = async () => {
    if (selectedMcpServer === null) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.rpc('mcp.upsert', mcpInput(drafts));
      if (drafts.mcpScope === 'shared') {
        await bridge.rpc('mcp.update-sync', { id: drafts.mcpId, providers: drafts.mcpSyncProviders });
      }
      setMcpServers((current) => current.map((server) => mcpServerKey(server) === mcpServerKey(selectedMcpServer)
        ? { ...server, server: parseMcpDraft(drafts.mcpText), syncProviders: drafts.mcpSyncProviders }
        : server));
      setSelectedMcpServer((current) => current === null
        ? null
        : { ...current, server: parseMcpDraft(drafts.mcpText), syncProviders: drafts.mcpSyncProviders });
      setDirty(false);
      setNotice('MCP server saved.');
    } catch (mcpError) {
      setError(errorMessage(mcpError));
    } finally {
      setBusy(false);
    }
  };

  const refreshSelectedRule = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = jsonObject(await bridge.rpc('rules.read', { path: drafts.rulesPath }));
      setDrafts((current) => ({ ...current, rulesText: String(result.content ?? '') }));
      setDirty(false);
      setNotice('Rule refreshed.');
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
                  regletHome={snapshot.regletHome}
                  drafts={drafts}
                  setDrafts={setDrafts}
                  setDirty={setDirty}
                  documents={ruleDocuments}
                  selectedDocument={selectedRuleDocument}
                  runners={mergeRunners}
                  onLoad={() => void loadRules()}
                  onSelect={(document) => void selectRule(document)}
                  onRefresh={() => void refreshSelectedRule()}
                  onSave={() => void mutate('rules.write', { path: drafts.rulesPath, content: drafts.rulesText }, 'Rule saved.')}
                  onOpenLocation={(path) => void openRuleLocation(path)}
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
                  selectedSkill={selectedSkill}
                  providers={syncProviders(snapshot, 'skills')}
                  onLoad={() => void loadSkills()}
                  onSelect={(skill) => void selectSkill(skill)}
                  onSave={() => void saveSkill()}
                  onOpenLocation={(path) => void openRuleLocation(path)}
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
                  selectedServer={selectedMcpServer}
                  providers={syncProviders(snapshot, 'mcp')}
                  onLoad={() => void loadMcpServers()}
                  onSelect={selectMcpServer}
                  onSave={() => void saveMcp()}
                  onOpenLocation={(path) => void openRuleLocation(path)}
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
  regletHome: string;
  drafts: DraftState;
  setDrafts: (drafts: DraftState | ((current: DraftState) => DraftState)) => void;
  setDirty: (dirty: boolean) => void;
  documents: RuleDocument[];
  selectedDocument: RuleDocument | null;
  runners: MergeRunner[];
  onLoad: () => void;
  onSelect: (document: RuleDocument) => void;
  onRefresh: () => void;
  onSave: () => void;
  onOpenLocation: (path: string) => void;
  onMerge: (runner: ManagerMergeRunnerId) => void;
  busy: boolean;
}) {
  const selectedKey = props.selectedDocument === null ? '' : ruleDocumentKey(props.selectedDocument);
  const selectedLabel = props.selectedDocument === null
    ? 'No rule document selected'
    : ruleDocumentLabel(props.selectedDocument);
  return (
    <Panel title="Rules" action={<div className="flex flex-wrap gap-2"><button className="secondary-button" onClick={props.onLoad} disabled={props.busy}>Refresh</button><button className="primary-button" onClick={props.onSave} disabled={props.busy || props.selectedDocument === null}>Save</button>{props.selectedDocument !== null && <button className="secondary-button" onClick={() => props.onOpenLocation(resolveRulePath(props.regletHome, props.selectedDocument?.path ?? ''))} disabled={props.busy}><FolderOpen size={16} aria-hidden="true" /> Open file location</button>}</div>}>
      <div className="mb-4 grid gap-3">
        <label className="field-label">
          Agent markdown
          <select
            className="text-input"
            value={selectedKey}
            disabled={props.documents.length === 0 || props.busy}
            onChange={(event) => {
              const document = props.documents.find((candidate) => ruleDocumentKey(candidate) === event.currentTarget.value);
              if (document !== undefined) props.onSelect(document);
            }}
          >
            {props.documents.length === 0 && <option value="">Refresh to load markdown files</option>}
            {props.documents.map((document) => (
              <option key={ruleDocumentKey(document)} value={ruleDocumentKey(document)}>
                {ruleDocumentLabel(document)}
              </option>
            ))}
          </select>
        </label>
        {props.documents.length > 0 && (
          <div className="grid grid-cols-2 gap-2" aria-label="Agent markdown files">
            {props.documents.map((document) => (
              <div key={ruleDocumentKey(document)} className="row-card flex items-center justify-between gap-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => props.onSelect(document)} disabled={props.busy} aria-label={`Edit ${ruleDocumentLabel(document)}`}>
                  <strong className="block truncate">{ruleDocumentTitle(document)}</strong>
                  <span className="block truncate text-xs text-reglet-muted">{fileName(document.path)}</span>
                </button>
                <button className="icon-button" onClick={() => props.onOpenLocation(resolveRulePath(props.regletHome, document.path))} disabled={props.busy} aria-label={`Open file location for ${ruleDocumentLabel(document)}`}>
                  <FolderOpen size={16} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-3">
        <label className="field-label">{selectedLabel}<textarea className="editor" aria-label="Rule content" value={props.drafts.rulesText} onChange={(event) => { updateDraft(props.setDrafts, 'rulesText', event.currentTarget.value); props.setDirty(true); }} /></label>
        <div className="flex flex-wrap gap-2">
          <button className="secondary-button" onClick={props.onRefresh} disabled={props.busy || props.selectedDocument === null}>Refresh content</button>
        </div>
        <div className="flex gap-2">
          {props.runners.map((runner) => <button key={runner.id} className="secondary-button" onClick={() => props.onMerge(runner.id)}><Sparkles size={16} aria-hidden="true" /> Merge with {runner.displayName}</button>)}
          {props.runners.length === 0 && <span className="text-sm text-reglet-muted">Refresh to discover installed AI runners.</span>}
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
  selectedSkill: SkillSummary | null;
  providers: ManagerProviderId[];
  onLoad: () => void;
  onSelect: (skill: SkillSummary) => void;
  onSave: () => void;
  onOpenLocation: (path: string) => void;
  busy: boolean;
}) {
  const unified = props.skills.filter((skill) => skill.scope === 'shared' && isSyncedToEveryProvider(skill.syncProviders, props.providers));
  const limited = props.skills.filter((skill) => skill.scope !== 'unmanaged' && !unified.includes(skill));
  const providerLocal = props.skills.filter((skill) => skill.scope === 'unmanaged');
  return (
    <Panel title="Skills" action={<button className="secondary-button" onClick={props.onLoad} disabled={props.busy}>Refresh</button>}>
      <p className="mb-4 text-sm text-reglet-muted">Edit the shared source once, then choose its provider targets in Advanced settings.</p>
      <SkillGroup {...props} title="Unified skills" skills={unified} />
      <SkillGroup {...props} title="Limited and provider-only skills" skills={limited} />
      <SkillGroup {...props} title="Provider-local skills" skills={providerLocal} />
    </Panel>
  );
}

function SkillGroup(props: Omit<Parameters<typeof SkillsView>[0], 'snapshot'> & { title: string; skills: SkillSummary[] }) {
  if (props.skills.length === 0) return null;
  return (
    <section className="mb-5 last:mb-0" aria-label={props.title}>
      <h2 className="mb-2 text-sm font-semibold text-reglet-text">{props.title}</h2>
      <div className="grid gap-2">
        {props.skills.map((skill) => <SkillDisclosure key={skillKey(skill)} skill={skill} {...props} />)}
      </div>
    </section>
  );
}

function SkillDisclosure(props: Omit<Parameters<typeof SkillsView>[0], 'snapshot' | 'skills'> & { skill: SkillSummary }) {
  const selected = props.selectedSkill !== null && skillKey(props.selectedSkill) === skillKey(props.skill);
  const editable = props.skill.scope !== 'unmanaged';
  return (
    <details className="row-card disclosure" open={selected}>
      <summary onClick={(event) => { event.preventDefault(); props.onSelect(props.skill); }}>
        <ChevronRight size={16} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate">{props.skill.name}</strong>
          <span className="block truncate text-xs text-reglet-muted">{skillScopeLabel(props.skill)}{props.skill.conflict ? ' · conflict' : ''}</span>
        </span>
        {props.skill.path !== undefined && <button className="icon-button" type="button" aria-label={`Open file location for ${props.skill.name}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); props.onOpenLocation(props.skill.path ?? ''); }} disabled={props.busy}><FolderOpen size={16} aria-hidden="true" /></button>}
      </summary>
      {selected && (
        <div className="mt-4 grid gap-3 border-t border-reglet-line pt-4">
          <label className="field-label">Skill content<textarea className="editor" aria-label="Skill content" readOnly={!editable} value={props.drafts.skillText} onChange={(event) => { updateDraft(props.setDrafts, 'skillText', event.currentTarget.value); props.setDirty(true); }} /></label>
          {editable ? (
            <details className="advanced-settings">
              <summary>Advanced settings</summary>
              {props.skill.scope === 'shared' ? <ProviderSyncChecklist providers={props.providers} selected={props.drafts.skillSyncProviders} label="Skill sync providers" onChange={(providers) => { updateDraft(props.setDrafts, 'skillSyncProviders', providers); props.setDirty(true); }} /> : <p className="mt-3 text-sm text-reglet-muted">This skill is scoped to {providerLabel(props.skill.provider ?? 'claude')}.</p>}
            </details>
          ) : <p className="text-sm text-reglet-muted">This provider-local skill is not managed by Reglet.</p>}
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => props.onSelect(props.skill)} disabled={props.busy}>Refresh content</button>
            {editable && <button className="primary-button" onClick={props.onSave} disabled={props.busy}>Save</button>}
          </div>
        </div>
      )}
    </details>
  );
}

function McpView(props: {
  snapshot: ManagerSnapshotV2;
  drafts: DraftState;
  setDrafts: (drafts: DraftState | ((current: DraftState) => DraftState)) => void;
  setDirty: (dirty: boolean) => void;
  servers: McpServerSummary[];
  selectedServer: McpServerSummary | null;
  providers: ManagerProviderId[];
  onLoad: () => void;
  onSelect: (server: McpServerSummary) => void;
  onSave: () => void;
  onOpenLocation: (path: string) => void;
  busy: boolean;
}) {
  const unified = props.servers.filter((server) => server.scope === 'shared' && isSyncedToEveryProvider(server.syncProviders, props.providers));
  const limited = props.servers.filter((server) => !unified.includes(server));
  return (
    <Panel title="MCP" action={<button className="secondary-button" onClick={props.onLoad} disabled={props.busy}>Refresh</button>}>
      <p className="mb-4 text-sm text-reglet-muted">Edit each server once, then limit its provider targets in Advanced settings.</p>
      <McpGroup {...props} title="Unified MCP servers" servers={unified} />
      <McpGroup {...props} title="Limited and provider-only MCP servers" servers={limited} />
    </Panel>
  );
}

function McpGroup(props: Omit<Parameters<typeof McpView>[0], 'snapshot'> & { title: string; servers: McpServerSummary[] }) {
  if (props.servers.length === 0) return null;
  return (
    <section className="mb-5 last:mb-0" aria-label={props.title}>
      <h2 className="mb-2 text-sm font-semibold text-reglet-text">{props.title}</h2>
      <div className="grid gap-2">
        {props.servers.map((server) => <McpDisclosure key={mcpServerKey(server)} server={server} {...props} />)}
      </div>
    </section>
  );
}

function McpDisclosure(props: Omit<Parameters<typeof McpView>[0], 'snapshot' | 'servers'> & { server: McpServerSummary }) {
  const selected = props.selectedServer !== null && mcpServerKey(props.selectedServer) === mcpServerKey(props.server);
  return (
    <details className="row-card disclosure" open={selected}>
      <summary onClick={(event) => { event.preventDefault(); props.onSelect(props.server); }}>
        <ChevronRight size={16} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block truncate">{props.server.displayName}</strong>
          <span className="block truncate text-xs text-reglet-muted">{mcpScopeLabel(props.server)}{props.server.issues.length === 0 ? '' : ` · ${props.server.issues.join('; ')}`}</span>
        </span>
        <button className="icon-button" type="button" aria-label={`Open file location for ${props.server.displayName}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); props.onOpenLocation(props.server.path); }} disabled={props.busy}><FolderOpen size={16} aria-hidden="true" /></button>
      </summary>
      {selected && (
        <div className="mt-4 grid gap-3 border-t border-reglet-line pt-4">
          <label className="field-label">Server JSON<textarea className="editor" aria-label="Server JSON" value={props.drafts.mcpText} onChange={(event) => { updateDraft(props.setDrafts, 'mcpText', event.currentTarget.value); props.setDirty(true); }} /></label>
          <details className="advanced-settings">
            <summary>Advanced settings</summary>
            {props.server.scope === 'shared' ? <ProviderSyncChecklist providers={props.providers} selected={props.drafts.mcpSyncProviders} label="MCP sync providers" onChange={(providers) => { updateDraft(props.setDrafts, 'mcpSyncProviders', providers); props.setDirty(true); }} /> : <p className="mt-3 text-sm text-reglet-muted">This server is scoped to {providerLabel(props.server.provider ?? 'claude')}.</p>}
          </details>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={() => props.onSelect(props.server)} disabled={props.busy}>Refresh content</button>
            <button className="primary-button" onClick={props.onSave} disabled={props.busy}>Save</button>
          </div>
        </div>
      )}
    </details>
  );
}

function ProviderSyncChecklist(props: {
  providers: ManagerProviderId[];
  selected: ManagerProviderId[];
  label: string;
  onChange: (providers: ManagerProviderId[]) => void;
}) {
  return (
    <fieldset className="mt-3 grid gap-2" aria-label={props.label}>
      <legend className="text-sm text-reglet-muted">Sync to providers</legend>
      <div className="flex flex-wrap gap-2">
        {props.providers.map((provider) => {
          const checked = props.selected.includes(provider);
          return <label className="segmented" key={provider}><input type="checkbox" checked={checked} onChange={() => props.onChange(checked ? props.selected.filter((item) => item !== provider) : [...props.selected, provider])} />{providerLabel(provider)}</label>;
        })}
      </div>
    </fieldset>
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

function mcpInput(drafts: DraftState): JsonObject & {
  id: string;
  displayName: string;
  scope: 'shared' | 'provider';
  provider?: ManagerProviderId;
  server: JsonObject;
} {
  return {
    id: drafts.mcpId,
    displayName: drafts.mcpDisplayName,
    scope: drafts.mcpScope,
    ...(drafts.mcpScope === 'provider' ? { provider: drafts.mcpProvider } : {}),
    server: parseMcpDraft(drafts.mcpText),
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

function preferredRuleDocument(documents: RuleDocument[], currentPath: string): RuleDocument | null {
  return documents.find((document) => document.path === currentPath) ??
    documents.find((document) => document.scope.kind === 'shared') ??
    documents[0] ??
    null;
}

function ruleDocumentKey(document: RuleDocument): string {
  const owner = document.scope.kind === 'provider' ? document.scope.provider : 'shared';
  return `${document.scope.kind}:${owner}:${document.path}`;
}

function ruleDocumentLabel(document: RuleDocument): string {
  return `${ruleDocumentTitle(document)} · ${fileName(document.path)}`;
}

function ruleDocumentTitle(document: RuleDocument): string {
  return document.scope.kind === 'shared'
    ? 'Unified rules'
    : `${providerLabel(document.scope.provider)} rules`;
}

function providerLabel(provider: ManagerProviderId): string {
  switch (provider) {
  case 'claude': return 'Claude';
  case 'codex': return 'Codex';
  case 'cursor': return 'Cursor';
  case 'gemini': return 'Gemini';
  case 'windsurf': return 'Windsurf';
  case 'opencode': return 'OpenCode';
  }
}

function syncProviders(snapshot: ManagerSnapshotV2, content: 'skills' | 'mcp'): ManagerProviderId[] {
  return snapshot.providerDiscovery
    .filter((provider) => provider.capabilities[content].state !== 'unsupported')
    .map((provider) => provider.provider);
}

function isSyncedToEveryProvider(selected: ManagerProviderId[], providers: ManagerProviderId[]): boolean {
  return providers.length > 0 && providers.every((provider) => selected.includes(provider));
}

function skillKey(skill: SkillSummary): string {
  return `${skill.scope}:${skill.provider ?? 'shared'}:${skill.name}`;
}

function skillScopeLabel(skill: SkillSummary): string {
  if (skill.scope === 'shared') return `Unified · ${syncTargetLabel(skill.syncProviders)}`;
  if (skill.scope === 'provider') return `${providerLabel(skill.provider ?? 'claude')} only`;
  return `${providerLabel(skill.provider ?? 'claude')} local`;
}

function mcpServerKey(server: McpServerSummary): string {
  return `${server.scope}:${server.provider ?? 'shared'}:${server.id}`;
}

function mcpScopeLabel(server: McpServerSummary): string {
  return server.scope === 'shared'
    ? `Unified · ${syncTargetLabel(server.syncProviders)}`
    : `${providerLabel(server.provider ?? 'claude')} only`;
}

function syncTargetLabel(providers: ManagerProviderId[]): string {
  if (providers.length === 0) return 'No sync targets';
  return providers.map(providerLabel).join(', ');
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function resolveRulePath(regletHome: string, documentPath: string): string {
  if (documentPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(documentPath)) return documentPath;
  return `${regletHome.replace(/\/$/, '')}/rules/${documentPath}`;
}

function mergeRunnerFromJson(value: JsonObject): MergeRunner | undefined {
  if (!isMergeRunnerId(value.id) || typeof value.displayName !== 'string') return undefined;
  return { id: value.id, displayName: value.displayName };
}

function parseSkillSummaries(value: JsonObject): SkillSummary[] {
  const shared = objectArray(value.shared).flatMap((skill) => typeof skill.name === 'string'
    ? [{
      name: skill.name,
      scope: 'shared' as const,
      path: typeof skill.path === 'string' ? skill.path : undefined,
      fileCount: numberOrZero(skill.fileCount),
      conflict: false,
      syncProviders: syncProvidersFromJson(skill.syncProviders),
    }]
    : []);
  const providerScoped = objectArray(value.providerScoped).flatMap((skill) =>
    typeof skill.name === 'string' && isProviderId(skill.provider)
      ? [{
        name: skill.name,
        scope: 'provider' as const,
        provider: skill.provider,
        path: typeof skill.path === 'string' ? skill.path : undefined,
        fileCount: numberOrZero(skill.fileCount),
        conflict: false,
        syncProviders: [skill.provider],
      }]
      : []);
  const unmanaged = objectArray(value.unmanaged).flatMap((skill) => {
    if (typeof skill.name !== 'string' || !isProviderId(skill.provider)) return [];
    return [{
      name: skill.name,
      scope: 'unmanaged' as const,
      provider: skill.provider,
      path: typeof skill.sourcePath === 'string' ? skill.sourcePath : undefined,
      fileCount: 0,
      conflict: skill.sharedConflict === 'destination-exists' || skill.providerConflict === 'destination-exists',
      syncProviders: [],
    }];
  });
  return [...shared, ...providerScoped, ...unmanaged];
}

function mcpServerFromJson(value: JsonObject, path: string): McpServerSummary | undefined {
  const server = objectFromUnknown(value.server);
  const scope = objectFromUnknown(value.scope);
  if (typeof value.id !== 'string' || typeof value.displayName !== 'string' || server === undefined || (scope?.kind !== 'shared' && scope?.kind !== 'provider')) return undefined;
  const provider = isProviderId(scope.provider) ? scope.provider : undefined;
  if (scope.kind === 'provider' && provider === undefined) return undefined;
  return {
    id: value.id,
    displayName: value.displayName,
    server,
    issues: Array.isArray(value.issues) ? value.issues.filter((issue): issue is string => typeof issue === 'string') : [],
    scope: scope.kind,
    ...(scope.kind === 'provider' ? { provider } : {}),
    path,
    syncProviders: scope.kind === 'shared' ? syncProvidersFromJson(value.syncProviders) : provider === undefined ? [] : [provider],
  };
}

function syncProvidersFromJson(value: unknown): ManagerProviderId[] {
  return value === undefined ? allProviderIds : providerArray(value);
}

function providerArray(value: unknown): ManagerProviderId[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<ManagerProviderId[]>((providers, candidate) => {
    if (isProviderId(candidate)) providers.push(candidate);
    return providers;
  }, []);
}

const allProviderIds: ManagerProviderId[] = ['claude', 'codex', 'cursor', 'gemini', 'windsurf', 'opencode'];

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
