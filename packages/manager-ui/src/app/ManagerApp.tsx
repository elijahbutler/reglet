import {
  Activity,
  AlertTriangle,
  Archive,
  Box,
  Copy,
  FileDiff,
  FileText,
  FolderSearch,
  Inbox,
  Library,
  LayoutDashboard,
  Plus,
  RotateCcw,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Download,
  Cloud,
  ExternalLink,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type {
  JsonValue,
  ManagerArtifactProjectionV3,
  ManagerArtifactV3,
  ManagerContentId,
  ManagerProviderId,
  ManagerRpcInputs,
  ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import type { ManagerClient } from '../client/ManagerClient.js';
import { Button } from '../design-system/Button.js';
import { ManagerCodeEditor } from '../design-system/ManagerCodeEditor.js';
import { LazyTextDiff } from '../design-system/LazyTextDiff.js';
import { Pane, PaneHeader } from '../design-system/Pane.js';
import { Row } from '../design-system/Row.js';
import { Shortcut } from '../design-system/Shortcut.js';
import { StatusBadge } from '../design-system/StatusBadge.js';
import { useDialogFocus } from '../design-system/useDialogFocus.js';
import { ActivityWorkbench } from '../features/activity/ActivityWorkbench.js';
import { CommandPalette } from '../features/command-palette/CommandPalette.js';
import { ProjectInboxWorkbench } from '../features/projects/ProjectInboxWorkbench.js';
import { ProvidersWorkbench } from '../features/providers/ProvidersWorkbench.js';
import { ReviewApplyWorkbench, type ReviewRequest } from '../features/review/ReviewApplyWorkbench.js';
import { SettingsWorkbench, type SettingsSection } from '../features/settings/SettingsWorkbench.js';
import { SetupOnboarding } from '../features/onboarding/SetupOnboarding.js';
import { OverviewWorkbench } from '../features/overview/OverviewWorkbench.js';
import { SyncDiffsView } from '../features/sync-diffs/SyncDiffsView.js';

const destinations = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'diffs', label: 'Sync & Diffs', icon: FileDiff },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'projects', label: 'Project Inbox', icon: Inbox },
  { id: 'providers', label: 'Providers', icon: Box },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

type Destination = (typeof destinations)[number]['id'];
type LifecycleFilter = 'active' | 'drafts' | 'archived';
type ScopeFilter = 'global' | 'provider';
type KindFilter = 'all' | ManagerArtifactV3['metadata']['kind'];
type SaveState = 'canonical' | 'saving' | 'draft';
type ArtifactSheet = 'create' | 'rename' | 'delete' | 'history' | null;

export interface ManagerAppProps {
  client: ManagerClient;
  hostActions?: ManagerHostActions;
  initialDestination?: Destination;
}

export type ManagerUpdateStatus =
  | { status: 'disabled'; currentVersion: string; reason: string }
  | { status: 'current'; currentVersion: string }
  | { status: 'available'; currentVersion: string; latestVersion: string; notes: string | null };

export type ManagerUpdateDownloadEvent =
  | { event: 'started'; contentLength: number | null }
  | { event: 'progress'; chunkLength: number }
  | { event: 'finished' };

export interface ManagerHostActions {
  checkForUpdates?: () => Promise<ManagerUpdateStatus>;
  installUpdate?: (onProgress: (event: ManagerUpdateDownloadEvent) => void) => Promise<void>;
}

export function ManagerApp({ client, hostActions, initialDestination = 'overview' }: ManagerAppProps) {
  const [destination, setDestination] = useState<Destination>(initialDestination);
  const [snapshot, setSnapshot] = useState<ManagerSnapshotV3 | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState('');
  const [loadedContent, setLoadedContent] = useState('');
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('canonical');
  const [filter, setFilter] = useState<LifecycleFilter>('active');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('global');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ArtifactSheet>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ManagerUpdateStatus | null>(null);
  const [reviewRequest, setReviewRequest] = useState<ReviewRequest | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [forceOnboarding, setForceOnboarding] = useState(false);
  const [showReturningNotice, setShowReturningNotice] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('reglet:notice:returning-acknowledged') !== 'true';
  });
  const latestRefresh = useRef(0);
  const latestSnapshotRevision = useRef(-1);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const artifactSearchInput = useRef<HTMLInputElement>(null);
  const reviewReturnTarget = useRef<'top' | 'inspector' | 'overview' | 'providers'>('top');
  const commandModifier = primaryModifierLabel();

  const dismissReturningNotice = () => {
    setShowReturningNotice(false);
    try {
      localStorage.setItem('reglet:notice:returning-acknowledged', 'true');
    } catch {
      // ignore
    }
  };

  const refresh = useCallback(async () => {
    const request = latestRefresh.current + 1;
    latestRefresh.current = request;
    setError(null);
    try {
      const next = await client.snapshot();
      if (next.revision < latestSnapshotRevision.current) return;
      latestSnapshotRevision.current = next.revision;
      setSnapshot(next);
      setSelectedArtifactId((current) => current ?? next.library.artifacts[0]?.metadata.id ?? null);
    } catch (refreshError) {
      if (request === latestRefresh.current) setError(messageFrom(refreshError));
    } finally {
      if (request === latestRefresh.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return client.subscribe(() => void refresh());
  }, [client, refresh]);

  useEffect(() => {
    if (hostActions?.checkForUpdates === undefined || updateStatus !== null) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      void hostActions.checkForUpdates?.().then((status) => {
        if (!disposed) setUpdateStatus(status);
      }).catch(() => {
        // Background checks stay quiet; Settings exposes an explicit retry path.
      });
    }, 8_000);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [hostActions, updateStatus]);

  const artifacts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (snapshot?.library.artifacts ?? []).filter((artifact) => {
      const matchesLifecycle = filter === 'drafts'
        ? artifact.draft !== undefined
        : artifact.metadata.lifecycle === filter;
      const matchesScope = scopeFilter === 'global'
        ? artifact.metadata.scope.kind === 'global'
        : artifact.metadata.scope.kind === 'provider-overlay';
      const matchesKind = kindFilter === 'all' || artifact.metadata.kind === kindFilter;
      const matchesQuery = normalizedQuery.length === 0 ||
        `${artifact.metadata.title} ${artifact.metadata.slug} ${artifact.metadata.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      return matchesLifecycle && matchesScope && matchesKind && matchesQuery;
    });
  }, [filter, kindFilter, query, scopeFilter, snapshot]);

  const selectedArtifact = useMemo(
    () => snapshot?.library.artifacts.find((artifact) => artifact.metadata.id === selectedArtifactId) ?? null,
    [selectedArtifactId, snapshot],
  );

  useEffect(() => {
    if (destination !== 'library' || artifacts.some((artifact) => artifact.metadata.id === selectedArtifactId)) return;
    setSelectedArtifactId(artifacts[0]?.metadata.id ?? null);
  }, [artifacts, destination, selectedArtifactId]);

  useEffect(() => {
    if (selectedArtifactId === null) {
      setArtifactContent('');
      setLoadedContent('');
      setArtifactLoading(false);
      setSaveState('canonical');
      return;
    }
    let disposed = false;
    setArtifactContent('');
    setLoadedContent('');
    setArtifactLoading(true);
    setSaveState('canonical');
    void client.command('library.show', { artifact: selectedArtifactId }).then((result) => {
      if (!disposed) {
        const content = readArtifactContent(result.data);
        setArtifactContent(content);
        setLoadedContent(content);
        setSaveState(readArtifactDraft(result.data) ? 'draft' : 'canonical');
      }
    }).catch((contentError: unknown) => {
      if (!disposed) setError(messageFrom(contentError));
    }).finally(() => {
      if (!disposed) setArtifactLoading(false);
    });
    return () => { disposed = true; };
  }, [client, selectedArtifactId]);

  useEffect(() => {
    if (selectedArtifact === null || artifactLoading || artifactContent === loadedContent) return;
    let current = true;
    setSaveState('saving');
    const artifactId = selectedArtifact.metadata.id;
    const content = artifactContent;
    const timer = window.setTimeout(() => {
      const queued = saveQueue.current.then(async () => {
        const result = await client.command('library.save', { artifact: artifactId, content });
        if (!current) return;
        setLoadedContent(content);
        setSaveState(readBoolean(result.data, 'saved') === false ? 'draft' : 'canonical');
      });
      saveQueue.current = queued.then(() => undefined, () => undefined);
      void queued.catch((saveError: unknown) => {
        if (!current) return;
        setSaveState('draft');
        setError(messageFrom(saveError));
      });
    }, 450);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [artifactContent, artifactLoading, client, loadedContent, selectedArtifact]);

  const openReview = (providerOverride?: ManagerProviderId) => {
    if (selectedArtifact === null) return;
    if (saveState !== 'canonical' || artifactContent !== loadedContent) {
      setError('Wait for the canonical edit to finish saving before reviewing provider changes.');
      return;
    }
    const providers = providerOverride === undefined
      ? [...new Set(selectedArtifact.metadata.targets)]
      : [providerOverride];
    if (providers.length === 0) {
      setError('Choose at least one provider target before reviewing this artifact.');
      return;
    }
    setError(null);
    setPaletteOpen(false);
    reviewReturnTarget.current = providerOverride === undefined ? 'top' : 'inspector';
    setReviewRequest({
      sourceTitle: selectedArtifact.metadata.title,
      units: providers.map((provider) => ({
        provider,
        content: contentForArtifactKind(selectedArtifact.metadata.kind),
      })),
    });
  };

  const openOverviewReview = (units: ReviewRequest['units']) => {
    if (units.length === 0) return;
    setError(null);
    setPaletteOpen(false);
    reviewReturnTarget.current = 'overview';
    setReviewRequest({ sourceTitle: 'the canonical library', units });
  };

  const openProviderReview = (provider: ManagerProviderId, content: ManagerContentId) => {
    setError(null);
    setPaletteOpen(false);
    reviewReturnTarget.current = 'providers';
    setReviewRequest({ sourceTitle: `${providerLabel(provider)} ${contentLabel(content)}`, units: [{ provider, content }] });
  };

  const closeReview = () => {
    if (reviewBusy) return;
    const target = reviewReturnTarget.current;
    setReviewRequest(null);
    window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`[data-review-trigger="${target}"]`);
      element?.focus({ preventScroll: true });
    });
  };

  const leaveReviewFor = (nextDestination: Destination) => {
    setReviewRequest(null);
    setReviewBusy(false);
    setDestination(nextDestination);
  };

  const leaveReviewForSettings = (section: SettingsSection) => {
    setSettingsSection(section);
    leaveReviewFor('settings');
  };

  const blockingOnboardingOpen = snapshot?.library.migration.status === 'available' ||
    (snapshot !== null && !snapshot.settings.setup.completed) ||
    forceOnboarding;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
      if (blockingOnboardingOpen || sheet !== null || paletteOpen || reviewRequest !== null) return;
      const key = event.key.toLocaleLowerCase();
      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (destination === 'library' && key === 'f') {
        event.preventDefault();
        artifactSearchInput.current?.focus({ preventScroll: true });
        artifactSearchInput.current?.select();
        return;
      }
      if (destination === 'library' && key === 'n') {
        event.preventDefault();
        setSheet('create');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [blockingOnboardingOpen, destination, paletteOpen, reviewRequest, sheet]);

  const mutateArtifact = async (operation: 'library.duplicate' | 'library.archive' | 'library.restore', artifact: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await client.command(operation, { artifact });
      if (operation === 'library.duplicate') setSelectedArtifactId(readArtifactId(result.data));
      await refresh();
    } catch (mutationError) {
      setError(messageFrom(mutationError));
    } finally {
      setBusy(false);
    }
  };

  const openExternalArtifact = useCallback((artifactId: string) => {
    void client.command('external.open', {
      target: {
        kind: 'canonical',
        artifact: artifactId,
      },
    }).catch((openError: unknown) => {
      setError(messageFrom(openError));
    });
  }, [client]);

  const initialSyncRequired = snapshot?.settings.sync.enabled === true && snapshot.settings.sync.lastCompletedAt === undefined;
  const runInitialSync = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.command('sync.run', {});
      await refresh();
    } catch (syncError) {
      setError(messageFrom(syncError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rg-manager${initialSyncRequired ? ' rg-manager--notice' : ''}${reviewRequest === null ? '' : ' rg-manager--review'}`} data-testid="manager-workbench">
      <header className="rg-command-bar">
        <div className="rg-brand" aria-label="Reglet">
          <span className="rg-brand__mark" aria-hidden="true">R</span>
          <strong>Reglet</strong>
        </div>
        <div className="rg-breadcrumb" aria-label="Current location">
          <span>{reviewRequest === null ? labelForDestination(destination) : 'Library'}</span>
          {reviewRequest === null
            ? destination !== 'library' || selectedArtifact === null ? null : <><span aria-hidden="true">›</span><strong>{selectedArtifact.metadata.title}</strong></>
            : <><span aria-hidden="true">›</span><strong>Review and apply</strong></>}
        </div>
        {reviewRequest === null ? <button type="button" className="rg-command-search" aria-label="Search or run a command" onClick={() => setPaletteOpen(true)}>
          <Shortcut keys={[commandModifier, 'K']} />
          <span>Search or run command</span>
        </button> : null}
        <div className="rg-command-actions">
          {reviewRequest !== null ? <Button tone="quiet" disabled={reviewBusy} onClick={closeReview}>Close review</Button> : null}
          {reviewRequest === null && updateStatus?.status === 'available' ? <Button className="rg-update-command" tone="secondary" icon={<Download size={15} />} onClick={() => { setSettingsSection('general'); setDestination('settings'); }}>
            Update {updateStatus.latestVersion}
          </Button> : null}
          {reviewRequest === null && initialSyncRequired ? <Button tone="secondary" icon={<Cloud size={15} />} disabled={busy} onClick={() => void runInitialSync()}>Initial sync</Button> : null}
          {reviewRequest === null && destination === 'library' ? <><Button tone="secondary" icon={<Plus size={15} />} onClick={() => setSheet('create')}>New</Button><Button data-review-trigger="top" tone="secondary" icon={<FileDiff size={15} />} onClick={() => openReview()} disabled={busy || artifactLoading || selectedArtifact === null || saveState !== 'canonical' || artifactContent !== loadedContent}>Review changes</Button></> : null}
        </div>
      </header>

      {initialSyncRequired ? <div className="rg-sync-notice" role="status"><Cloud size={15} aria-hidden="true" /><span><strong>Initial sync required</strong> Your encrypted server is connected, but this library has not been exchanged yet.</span><button type="button" disabled={busy} onClick={() => void runInitialSync()}>{busy ? 'Syncing…' : 'Sync now'}</button></div> : null}

      {showReturningNotice && snapshot !== null && snapshot.settings.setup.completed && (snapshot.library.artifacts.length > 0 || snapshot.providers.some((p) => p.detected)) ? (
        <aside className="rg-sync-notice bg-white/[0.02] border-b border-white/10" aria-label="Welcome notice">
          <Sparkles size={15} className="text-amber-400 shrink-0" aria-hidden="true" />
          <span><strong>Welcome back.</strong> We detected existing configuration on this machine. You can pick up where you left off, or review your settings with the guided walkthrough.</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { dismissReturningNotice(); setForceOnboarding(true); }}>Review setup</button>
            <button type="button" onClick={dismissReturningNotice}>Dismiss</button>
          </div>
        </aside>
      ) : null}

      {reviewRequest === null ? <main className="rg-workbench">
        <Pane label="Primary navigation" className="rg-navigation" tone="raised">
          <nav aria-label="Manager destinations">
            {destinations.map(({ id, icon: Icon, label }) => (
              <Row key={id} active={destination === id} leading={<Icon size={16} />} onClick={() => setDestination(id)}>
                {label}
              </Row>
            ))}
          </nav>
          <div className="rg-workspace-switcher">
            <span className="rg-workspace-avatar" aria-hidden="true">R</span>
            <span><strong>Reglet Workspace</strong><small>Local library</small></span>
          </div>
        </Pane>

        {destination === 'overview' ? <OverviewWorkbench
          snapshot={snapshot}
          onOpenActivity={() => setDestination('activity')}
          onOpenLibrary={() => setDestination('library')}
          onOpenProviders={() => setDestination('providers')}
          onReview={openOverviewReview}
        /> : destination === 'diffs' ? (
          <SyncDiffsView
            client={client}
            snapshot={snapshot}
            commandModifier={commandModifier}
            onRefresh={refresh}
            onOpenConflictResolver={() => {
              setDestination('settings');
              setSettingsSection('sync');
            }}
            onOpenSettings={() => setDestination('settings')}
          />
        ) : destination === 'library' ? (
          <LibraryWorkbench
            artifacts={artifacts}
            content={artifactContent}
            baseline={loadedContent}
            filter={filter}
            scopeFilter={scopeFilter}
            kindFilter={kindFilter}
            loading={loading}
            artifactLoading={artifactLoading}
            query={query}
            selected={selectedArtifact}
            snapshot={snapshot}
            onFilter={setFilter}
            onScopeFilter={setScopeFilter}
            onKindFilter={setKindFilter}
            onQuery={setQuery}
            onSelect={setSelectedArtifactId}
            onContent={setArtifactContent}
            onNew={() => setSheet('create')}
            onDuplicate={() => selectedArtifact === null ? undefined : void mutateArtifact('library.duplicate', selectedArtifact.metadata.id)}
            onArchive={() => selectedArtifact === null ? undefined : void mutateArtifact(selectedArtifact.metadata.lifecycle === 'archived' ? 'library.restore' : 'library.archive', selectedArtifact.metadata.id)}
            onRename={() => setSheet('rename')}
            onDelete={() => setSheet('delete')}
            onHistory={() => setSheet('history')}
            onReview={openReview}
            saveState={saveState}
            searchInputRef={artifactSearchInput}
            commandModifier={commandModifier}
            onOpenExternal={openExternalArtifact}
          />
        ) : destination === 'projects' ? <ProjectInboxWorkbench client={client} snapshot={snapshot} onRefresh={refresh} onError={setError} />
          : destination === 'providers' ? <ProvidersWorkbench client={client} snapshot={snapshot} onError={setError} onRefresh={refresh} onReview={openProviderReview} />
            : destination === 'activity' ? <ActivityWorkbench client={client} snapshot={snapshot} onError={setError} onRefresh={refresh} />
              : <SettingsWorkbench client={client} hostActions={hostActions} updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} section={settingsSection} onSection={setSettingsSection} snapshot={snapshot} onRefresh={refresh} onError={setError} onRunSetup={() => setForceOnboarding(true)} />}
      </main> : <main className="rg-review-host"><ReviewApplyWorkbench
        key={reviewRequest.units.map((unit) => `${unit.provider}:${unit.content}`).join('|')}
        client={client}
        commandModifier={commandModifier}
        request={reviewRequest}
        onBusyChange={setReviewBusy}
        onClose={closeReview}
        onOpenActivity={() => leaveReviewFor('activity')}
        onOpenExecutableSkills={() => leaveReviewForSettings('executable-skills')}
        onOpenSettings={() => leaveReviewForSettings('general')}
        onRefresh={refresh}
      /></main>}

      <CommandPalette
        open={paletteOpen && reviewRequest === null}
        onClose={() => setPaletteOpen(false)}
        onNew={() => setSheet('create')}
        onRefresh={() => void refresh()}
        onArchive={selectedArtifact?.metadata.lifecycle === 'active' ? () => void mutateArtifact('library.archive', selectedArtifact.metadata.id) : undefined}
        onSettings={() => { setSettingsSection('general'); setDestination('settings'); }}
        onRunSetup={() => setForceOnboarding(true)}
      />

      {snapshot?.library.migration.status === 'available' ? <MigrationOnboarding
        client={client}
        legacyCount={snapshot.library.migration.legacyArtifacts}
        onComplete={refresh}
        onError={setError}
      /> : null}

      {snapshot !== null && snapshot.library.migration.status !== 'available' && (!snapshot.settings.setup.completed || forceOnboarding) ? <SetupOnboarding
        client={client}
        snapshot={snapshot}
        onRefresh={refresh}
        canCancel={snapshot.settings.setup.completed || forceOnboarding}
        onCancel={() => setForceOnboarding(false)}
        onComplete={(openProjectInbox) => {
          setForceOnboarding(false);
          setDestination(openProjectInbox ? 'projects' : 'library');
        }}
        onError={setError}
      /> : null}

      <ArtifactActionSheet
        kind={sheet}
        artifact={selectedArtifact}
        busy={busy}
        onClose={() => { if (!busy) setSheet(null); }}
        onCreate={async (input) => {
          setBusy(true);
          try {
            const result = await client.command('library.create', input);
            setSelectedArtifactId(readArtifactId(result.data));
            setDestination('library');
            setSheet(null);
            await refresh();
          } catch (actionError) { setError(messageFrom(actionError)); } finally { setBusy(false); }
        }}
        onRename={async (slug) => {
          if (selectedArtifact === null) return;
          setBusy(true);
          try { await client.command('library.rename', { artifact: selectedArtifact.metadata.id, slug }); setSheet(null); await refresh(); }
          catch (actionError) { setError(messageFrom(actionError)); } finally { setBusy(false); }
        }}
        onDelete={async () => {
          if (selectedArtifact === null) return;
          setBusy(true);
          try { await client.command('library.delete', { artifact: selectedArtifact.metadata.id, confirmed: true }); setSelectedArtifactId(null); setSheet(null); await refresh(); }
          catch (actionError) { setError(messageFrom(actionError)); } finally { setBusy(false); }
        }}
        onRestoreRevision={async (revision) => {
          if (selectedArtifact === null) return;
          setBusy(true);
          try { await client.command('history.undo', { artifact: selectedArtifact.metadata.id, revision, confirmed: true }); setSheet(null); await refresh(); }
          catch (actionError) { setError(messageFrom(actionError)); } finally { setBusy(false); }
        }}
      />

      {error === null ? null : (
        <div className="rg-error" role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {reviewRequest === null ? <footer className="rg-shortcut-bar">
        <div>
          <Shortcut keys={[commandModifier, 'K']} label="Search" />
          {destination === 'library' ? <Shortcut keys={[commandModifier, 'N']} label="New artifact" /> : null}
        </div>
        <span className="rg-footer-location">{labelForDestination(destination)}</span>
      </footer> : null}
    </div>
  );
}

interface LibraryWorkbenchProps {
  artifacts: ManagerArtifactV3[];
  artifactLoading: boolean;
  baseline: string;
  content: string;
  filter: LifecycleFilter;
  scopeFilter: ScopeFilter;
  kindFilter: KindFilter;
  loading: boolean;
  query: string;
  selected: ManagerArtifactV3 | null;
  snapshot: ManagerSnapshotV3 | null;
  saveState: SaveState;
  onFilter: (filter: LifecycleFilter) => void;
  onScopeFilter: (filter: ScopeFilter) => void;
  onKindFilter: (filter: KindFilter) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onContent: (content: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onReview: (provider: ManagerArtifactProjectionV3['provider']) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  commandModifier: string;
  onOpenExternal?: (id: string) => void;
}

function LibraryWorkbench({
  artifacts,
  artifactLoading,
  baseline,
  content,
  filter,
  scopeFilter,
  kindFilter,
  loading,
  query,
  selected,
  snapshot,
  saveState,
  onFilter,
  onScopeFilter,
  onKindFilter,
  onQuery,
  onSelect,
  onContent,
  onNew,
  onDuplicate,
  onArchive,
  onRename,
  onDelete,
  onHistory,
  onReview,
  searchInputRef,
  commandModifier,
  onOpenExternal,
}: LibraryWorkbenchProps) {
  const [editorView, setEditorView] = useState<'edit' | 'diff'>('edit');
  const [mobilePane, setMobilePane] = useState<'collection' | 'editor' | 'details'>('collection');
  const list = useRef<HTMLDivElement>(null);

  const PAGE_SIZE = 50;
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
  }, [filter, scopeFilter, kindFilter, query]);

  const selectedIndex = selected ? artifacts.findIndex((a) => a.metadata.id === selected.metadata.id) : -1;
  const effectiveLimit = selectedIndex >= visibleLimit ? selectedIndex + 1 : visibleLimit;
  const visibleArtifacts = artifacts.slice(0, effectiveLimit);
  const hasMore = artifacts.length > effectiveLimit;

  return (
    <>
      <nav className="rg-library-mobile-nav" aria-label="Library panels">
        <button type="button" aria-pressed={mobilePane === 'collection'} onClick={() => setMobilePane('collection')}>Library</button>
        <button type="button" aria-pressed={mobilePane === 'editor'} onClick={() => setMobilePane('editor')}>Edit</button>
        <button type="button" aria-pressed={mobilePane === 'details'} onClick={() => setMobilePane('details')}>Details</button>
      </nav>
      <Pane label="Artifact collection" className={`rg-collection rg-library-mobile-pane${mobilePane === 'collection' ? ' rg-library-mobile-pane--active' : ''}`}>
        <PaneHeader>
          <label className="rg-search-field">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search artifacts</span>
            <input ref={searchInputRef} value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search artifacts…" />
            <span aria-hidden="true">{commandModifier} F</span>
          </label>
        </PaneHeader>
        <div className="rg-filter-tabs" role="group" aria-label="Artifact lifecycle">
          <FilterTab label="Active" count={snapshot?.library.counts.active ?? 0} active={filter === 'active'} onClick={() => onFilter('active')} />
          <FilterTab label="Drafts" count={snapshot?.library.counts.drafts ?? 0} active={filter === 'drafts'} onClick={() => onFilter('drafts')} />
          <FilterTab label="Archived" count={snapshot?.library.counts.archived ?? 0} active={filter === 'archived'} onClick={() => onFilter('archived')} />
        </div>
        <div className="rg-library-scope" role="group" aria-label="Artifact scope">
          <button type="button" aria-pressed={scopeFilter === 'global'} onClick={() => onScopeFilter('global')}>Global <small>{scopeCount(snapshot, 'global')}</small></button>
          <button type="button" aria-pressed={scopeFilter === 'provider'} onClick={() => onScopeFilter('provider')}>Provider-specific <small>{scopeCount(snapshot, 'provider')}</small></button>
        </div>
        <div className="rg-kind-filter" role="group" aria-label="Artifact kind">
          <KindButton label="All" value="all" active={kindFilter === 'all'} onClick={onKindFilter} />
          <KindButton label="Agent rules" value="instruction" active={kindFilter === 'instruction'} onClick={onKindFilter} />
          <KindButton label="Skills" value="skill" active={kindFilter === 'skill'} onClick={onKindFilter} />
          <KindButton label="MCPs" value="mcp" active={kindFilter === 'mcp'} onClick={onKindFilter} />
        </div>
        <div className="rg-collection-label">Artifacts</div>
        <div className="rg-artifact-list" ref={list}>
          {loading ? <CollectionMessage icon={<RefreshCw size={16} />} title="Loading library…" /> : null}
          {!loading && artifacts.length === 0 ? (
            <CollectionMessage icon={filter === 'archived' ? <Archive size={16} /> : <FolderSearch size={16} />} title="No artifacts in this view" />
          ) : null}
          <div className="rg-virtual-list">
            {visibleArtifacts.map((artifact) => {
              return (
                <div className="rg-virtual-row" key={artifact.metadata.id}>
                  <Row
                    active={selected?.metadata.id === artifact.metadata.id}
                    leading={<FileText size={15} />}
                    trailing={<small>{scopeLabel(artifact)}</small>}
                    onClick={() => { onSelect(artifact.metadata.id); setMobilePane('editor'); }}
                  >
                    {artifact.metadata.title}
                  </Row>
                </div>
              );
            })}
            {hasMore ? (
              <button
                type="button"
                className="rg-load-more"
                onClick={() => setVisibleLimit((curr) => curr + PAGE_SIZE)}
              >
                Show more ({artifacts.length - effectiveLimit} remaining)
              </button>
            ) : null}
          </div>
        </div>
        <Button className="rg-new-artifact" tone="quiet" icon={<Plus size={15} />} onClick={onNew}>New artifact</Button>
      </Pane>

      <Pane label="Artifact editor" className={`rg-editor-pane rg-library-mobile-pane${mobilePane === 'editor' ? ' rg-library-mobile-pane--active' : ''}`}>
        <PaneHeader>
          <div className="rg-editor-tabs" role="group" aria-label="Artifact view">
            <button type="button" aria-pressed={editorView === 'edit'} onClick={() => setEditorView('edit')}>Edit</button>
            <button type="button" aria-pressed={editorView === 'diff'} onClick={() => setEditorView('diff')}>Changes</button>
          </div>
          {selected !== null && onOpenExternal !== undefined ? (
            <Button
              tone="quiet"
              icon={<ExternalLink size={14} />}
              onClick={() => onOpenExternal(selected.metadata.id)}
            >
              Open in Editor
            </Button>
          ) : null}
        </PaneHeader>
        {selected === null ? (
          <div className="rg-empty-canvas"><FileText size={24} /><strong>Select an artifact</strong><span>Choose a library item to inspect its canonical content and projections.</span></div>
        ) : artifactLoading ? (
          <div className="rg-empty-canvas" role="status"><RefreshCw size={20} /><strong>Loading canonical content</strong><span>The editor will unlock when this artifact is ready.</span></div>
        ) : (
          <>
            {editorView === 'edit' ? <ManagerCodeEditor
              value={content}
              language={selected.metadata.kind === 'mcp' ? 'json' : 'markdown'}
              label={`${selected.metadata.title} content`}
              onChange={onContent}
            /> : <LazyTextDiff before={baseline} after={content} label={`${selected.metadata.title} pending changes`} />}
            <div className="rg-editor-status">
              <span>{selected.metadata.kind === 'mcp' ? 'JSON' : 'Markdown'}</span>
              <span>{wordCount(content)} words</span>
              <span>{content.length.toLocaleString()} characters</span>
              <span className="rg-editor-status__save">{saveLabel(saveState)}</span>
            </div>
          </>
        )}
      </Pane>

      <ProjectionInspector
        mobileActive={mobilePane === 'details'}
        artifact={selected}
        onDuplicate={onDuplicate}
        onArchive={onArchive}
        onRename={onRename}
        onDelete={onDelete}
        onHistory={onHistory}
        onReview={onReview}
        onOpenExternal={onOpenExternal}
      />
    </>
  );
}

function ProjectionInspector({
  artifact,
  mobileActive,
  onDuplicate,
  onArchive,
  onRename,
  onDelete,
  onHistory,
  onReview,
  onOpenExternal,
}: {
  artifact: ManagerArtifactV3 | null;
  mobileActive: boolean;
  onDuplicate: () => void;
  onArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
  onHistory: () => void;
  onReview: (provider: ManagerArtifactProjectionV3['provider']) => void;
  onOpenExternal?: (id: string) => void;
}) {
  const selectedProjection = artifact?.projections.find((projection) => projection.status === 'drifted') ?? artifact?.projections[0] ?? null;
  return (
    <Pane label="Projection inspector" className={`rg-inspector rg-library-mobile-pane${mobileActive ? ' rg-library-mobile-pane--active' : ''}`} tone="raised">
      <PaneHeader><span>Projection inspector</span></PaneHeader>
      {artifact === null ? (
        <div className="rg-inspector-empty">Projection details appear here.</div>
      ) : (
        <>
          <section className="rg-inspector-section">
            <h2>Artifact</h2>
            <div className="rg-artifact-summary"><FileText size={17} /><span><strong>{artifact.metadata.title}</strong><small>{scopeLabel(artifact)} · {capitalize(artifact.metadata.lifecycle)}</small></span></div>
          </section>
          <section className="rg-inspector-section">
            <h2>Projection states</h2>
            <div className="rg-projection-list">
              {artifact.projections.length === 0 ? <span className="rg-muted">No provider targets</span> : null}
              {artifact.projections.map((projection) => <ProjectionRow key={projection.provider} projection={projection} />)}
            </div>
          </section>
          {selectedProjection === null ? null : (
            <section className="rg-inspector-section rg-revisions">
              <h2>Revision comparison ({selectedProjection.provider})</h2>
              {selectedProjection.issues.map((issue) => (
                <div className="rg-warning" key={`${issue.code}:${issue.message}`}><AlertTriangle size={15} /><span>{issue.message}</span></div>
              ))}
              <Revision label="Desired" hash={selectedProjection.desiredHash} />
              <Revision label="Applied" hash={selectedProjection.appliedHash} />
              <Revision label="Observed" hash={selectedProjection.observedHash} />
              <Button data-review-trigger="inspector" tone="secondary" icon={<FileDiff size={15} />} onClick={() => onReview(selectedProjection.provider)}>Review changes</Button>
            </section>
          )}
          <section className="rg-inspector-section">
            <h2>Lifecycle & history</h2>
            <div className="rg-action-grid">
              {onOpenExternal !== undefined ? (
                <Button tone="secondary" icon={<ExternalLink size={14} />} onClick={() => onOpenExternal(artifact.metadata.id)}>Open in Editor</Button>
              ) : null}
              <Button tone="secondary" icon={<Copy size={14} />} onClick={onDuplicate}>Duplicate</Button>
              <Button tone="secondary" onClick={onRename}>Rename</Button>
              <Button tone="secondary" icon={<Archive size={14} />} onClick={onArchive}>{artifact.metadata.lifecycle === 'archived' ? 'Restore' : 'Archive'}</Button>
              <Button tone="secondary" icon={<RotateCcw size={14} />} onClick={onHistory}>History</Button>
              <Button tone="danger" icon={<Trash2 size={14} />} onClick={onDelete}>Delete permanently</Button>
            </div>
          </section>
        </>
      )}
    </Pane>
  );
}

function ProjectionRow({ projection }: { projection: ManagerArtifactProjectionV3 }) {
  return (
    <div className="rg-projection-row">
      <span><Box size={15} aria-hidden="true" />{providerLabel(projection.provider)}</span>
      <StatusBadge status={projection.status} />
    </div>
  );
}

function Revision({ label, hash }: { label: string; hash?: string }) {
  return (
    <div className="rg-revision">
      <span>{label}</span>
      <code>{hash === undefined ? 'Not recorded' : hash.slice(0, 12)}</code>
    </div>
  );
}

function FilterTab({ active, count, label, onClick }: { active: boolean; count: number; label: string; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick}><span>{label}</span><small>{count}</small></button>;
}

function KindButton({ active, label, value, onClick }: { active: boolean; label: string; value: KindFilter; onClick: (value: KindFilter) => void }) {
  return <button type="button" aria-pressed={active} onClick={() => onClick(value)}>{label}</button>;
}

function scopeCount(snapshot: ManagerSnapshotV3 | null, scope: ScopeFilter): number {
  return (snapshot?.library.artifacts ?? []).filter((artifact) => scope === 'global' ? artifact.metadata.scope.kind === 'global' : artifact.metadata.scope.kind === 'provider-overlay').length;
}

function CollectionMessage({ icon, title }: { icon: ReactNode; title: string }) {
  return <div className="rg-collection-message">{icon}<span>{title}</span></div>;
}

function ArtifactActionSheet({
  kind,
  artifact,
  busy,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onRestoreRevision,
}: {
  kind: ArtifactSheet;
  artifact: ManagerArtifactV3 | null;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: ManagerRpcInputs['library.create']) => Promise<void>;
  onRename: (slug: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onRestoreRevision: (revision: string) => Promise<void>;
}) {
  const [artifactKind, setArtifactKind] = useState<'instruction' | 'skill' | 'mcp'>('instruction');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('# New instruction\n');
  const dialog = useDialogFocus<HTMLElement>(kind !== null, onClose);

  useEffect(() => {
    if (kind === 'rename') setSlug(artifact?.metadata.slug ?? '');
    if (kind === 'create') {
      setArtifactKind('instruction');
      setSlug('');
      setTitle('');
      setContent('# New instruction\n');
    }
  }, [artifact?.metadata.slug, kind]);

  if (kind === null) return null;
  return <div className="rg-sheet-backdrop" role="presentation" onMouseDown={onClose}><aside ref={dialog} tabIndex={-1} className="rg-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle(kind)} onMouseDown={(event) => event.stopPropagation()}><PaneHeader><span>{sheetTitle(kind)}</span><button type="button" className="rg-icon-button" disabled={busy} onClick={onClose} aria-label="Close">×</button></PaneHeader><div className="rg-sheet__body">
    {kind === 'create' ? <>
      <p>Create canonical content first. Provider files change only through Review and Apply.</p>
      <label className="rg-field"><span>Kind</span><select value={artifactKind} onChange={(event) => {
        const next = event.target.value as 'instruction' | 'skill' | 'mcp';
        setArtifactKind(next);
        setContent(defaultArtifactContent(next));
      }}><option value="instruction">Instruction</option><option value="skill">Skill</option><option value="mcp">MCP server</option></select></label>
      <label className="rg-field"><span>Slug</span><input value={slug} onChange={(event) => setSlug(event.target.value)} autoFocus /></label>
      <label className="rg-field"><span>Title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="rg-field rg-field--grow"><span>Initial content</span><textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} /></label>
      <Button tone="primary" disabled={busy || slug.trim().length === 0 || title.trim().length === 0} onClick={() => void onCreate({ kind: artifactKind, slug, title, content })}>Create artifact</Button>
    </> : null}
    {kind === 'rename' ? <><p>The artifact ID remains stable. Its canonical locator moves atomically.</p><label className="rg-field"><span>New slug</span><input value={slug} onChange={(event) => setSlug(event.target.value)} autoFocus /></label><Button tone="primary" disabled={busy || slug.trim().length === 0} onClick={() => void onRename(slug)}>Rename artifact</Button></> : null}
    {kind === 'delete' ? <><div className="rg-inline-notice rg-inline-notice--danger"><Trash2 size={15} /><span>This emits a sync tombstone. Recoverable history is retained for at least 30 days.</span></div><p><strong>{artifact?.metadata.title}</strong> will be permanently removed from the active library.</p><Button tone="danger" disabled={busy || artifact === null} onClick={() => void onDelete()}>Permanently delete</Button></> : null}
    {kind === 'history' ? <><p>Restoring creates a new canonical revision; it does not erase later history.</p><div className="rg-history-list">{artifact?.history.length === 0 ? <span className="rg-muted">No earlier revisions are available.</span> : artifact?.history.map((entry) => <div key={entry.revision}><span><strong>{entry.reason}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span><Button tone="secondary" disabled={busy} onClick={() => void onRestoreRevision(entry.revision)}><RotateCcw size={14} /> Restore</Button></div>)}</div></> : null}
  </div></aside></div>;
}

function MigrationOnboarding({ client, legacyCount, onComplete, onError }: {
  client: ManagerClient;
  legacyCount: number;
  onComplete: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState<JsonValue>();
  const [busy, setBusy] = useState(false);
  const dialog = useDialogFocus<HTMLElement>(true);
  useEffect(() => {
    void client.command('migration.preview', {}).then((result) => setPreview(result.data)).catch((error: unknown) => onError(messageFrom(error)));
  }, [client, onError]);
  const digest = preview === undefined ? undefined : readOptionalString(preview, 'digest');
  return <div className="rg-onboarding-backdrop"><section ref={dialog} tabIndex={-1} className="rg-onboarding" role="dialog" aria-modal="true" aria-labelledby="migration-title"><span className="rg-brand__mark" aria-hidden="true">R</span><div><p className="rg-eyebrow">Library V2 migration</p><h1 id="migration-title">Review your canonical library</h1><p>Reglet found {legacyCount} existing artifact{legacyCount === 1 ? '' : 's'}. Migration creates stable IDs and metadata without moving, rewriting, or applying provider content.</p></div><dl className="rg-key-values"><div><dt>Canonical files</dt><dd>Remain in place</dd></div><div><dt>Provider writes</dt><dd>None</dd></div><div><dt>Recovery</dt><dd>Reversible receipt</dd></div><div><dt>Preview digest</dt><dd><code>{digest?.slice(0, 16) ?? 'Preparing…'}</code></dd></div></dl><Button tone="primary" disabled={busy || digest === undefined} onClick={() => {
    if (digest === undefined) return;
    setBusy(true);
    void client.command('migration.apply', { yes: true, previewDigest: digest }).then(onComplete).catch((error: unknown) => onError(messageFrom(error))).finally(() => setBusy(false));
  }}>{busy ? 'Migrating…' : `Approve ${legacyCount} artifact${legacyCount === 1 ? '' : 's'}`}</Button></section></div>;
}

function sheetTitle(kind: Exclude<ArtifactSheet, null>): string {
  return kind === 'create' ? 'New artifact' : kind === 'rename' ? 'Rename artifact' : kind === 'delete' ? 'Permanent deletion' : 'Artifact history';
}

function defaultArtifactContent(kind: 'instruction' | 'skill' | 'mcp'): string {
  if (kind === 'skill') return '---\nname: new-skill\ndescription: Describe when this skill should be used.\n---\n\n# New skill\n';
  if (kind === 'mcp') return '{\n  "command": "command"\n}\n';
  return '# New instruction\n';
}

function scopeLabel(artifact: ManagerArtifactV3): string {
  return artifact.metadata.scope.kind === 'global'
    ? 'Global'
    : providerLabel(artifact.metadata.scope.provider);
}

function providerLabel(provider: string): string {
  const labels: Record<string, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    gemini: 'Gemini CLI',
    windsurf: 'Windsurf',
    opencode: 'OpenCode',
  };
  return labels[provider] ?? provider;
}

function contentLabel(content: ManagerContentId): string {
  return content === 'rules' ? 'instructions' : content === 'skills' ? 'skills' : 'MCP servers';
}

function labelForDestination(destination: Destination): string {
  return destinations.find((candidate) => candidate.id === destination)?.label ?? 'Library';
}

function readArtifactContent(value: JsonValue): string {
  if (!isJsonRecord(value)) return '';
  if (isJsonRecord(value.draft) && typeof value.draft.content === 'string') return value.draft.content;
  return typeof value.content === 'string' ? value.content : '';
}

function readArtifactDraft(value: JsonValue): boolean {
  return isJsonRecord(value) && isJsonRecord(value.draft) && typeof value.draft.content === 'string';
}

function readArtifactId(value: JsonValue): string {
  if (isJsonRecord(value) && typeof value.id === 'string') return value.id;
  if (isJsonRecord(value) && isJsonRecord(value.artifact) && typeof value.artifact.id === 'string') return value.artifact.id;
  throw new Error('Manager response is missing the artifact ID.');
}

function readBoolean(value: JsonValue, key: string): boolean | undefined {
  return isJsonRecord(value) && typeof value[key] === 'boolean' ? value[key] : undefined;
}

function readOptionalString(value: JsonValue, key: string): string | undefined {
  return isJsonRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function contentForArtifactKind(kind: ManagerArtifactV3['metadata']['kind']): ManagerContentId {
  return kind === 'instruction' ? 'rules' : kind === 'skill' ? 'skills' : 'mcp';
}

function isJsonRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageFrom(value: unknown): string {
  return value instanceof Error ? value.message : 'The manager operation failed.';
}

function wordCount(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

function saveLabel(state: SaveState): string {
  return state === 'saving' ? 'Saving…' : state === 'draft' ? 'Local draft · validation required' : 'Canonical content saved';
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches('input, textarea, select, [role="textbox"]');
}

function primaryModifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? '⌘' : 'Ctrl';
}
