import {
  Activity,
  AlertTriangle,
  Archive,
  Box,
  ChevronDown,
  Copy,
  FileDiff,
  FileText,
  FolderSearch,
  Inbox,
  Library,
  MoreHorizontal,
  Plus,
  RotateCcw,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Download,
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  JsonValue,
  ManagerArtifactProjectionV3,
  ManagerArtifactV3,
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
import { ActivityWorkbench } from '../features/activity/ActivityWorkbench.js';
import { CommandPalette } from '../features/command-palette/CommandPalette.js';
import { ProjectInboxWorkbench } from '../features/projects/ProjectInboxWorkbench.js';
import { ProvidersWorkbench } from '../features/providers/ProvidersWorkbench.js';
import { SettingsWorkbench } from '../features/settings/SettingsWorkbench.js';

const destinations = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'projects', label: 'Project Inbox', icon: Inbox },
  { id: 'providers', label: 'Providers', icon: Box },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

type Destination = (typeof destinations)[number]['id'];
type LifecycleFilter = 'active' | 'drafts' | 'archived';
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

export function ManagerApp({ client, hostActions, initialDestination = 'library' }: ManagerAppProps) {
  const [destination, setDestination] = useState<Destination>(initialDestination);
  const [snapshot, setSnapshot] = useState<ManagerSnapshotV3 | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [artifactContent, setArtifactContent] = useState('');
  const [loadedContent, setLoadedContent] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('canonical');
  const [filter, setFilter] = useState<LifecycleFilter>('active');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ArtifactSheet>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ManagerUpdateStatus | null>(null);
  const [preparedPreview, setPreparedPreview] = useState<{ batchDigest: string; artifactId: string; provider: ManagerArtifactProjectionV3['provider']; unitDigests: Record<string, string> } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await client.snapshot();
      setSnapshot(next);
      setSelectedArtifactId((current) => current ?? next.library.artifacts[0]?.metadata.id ?? null);
    } catch (refreshError) {
      setError(messageFrom(refreshError));
    } finally {
      setLoading(false);
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
      const matchesQuery = normalizedQuery.length === 0 ||
        `${artifact.metadata.title} ${artifact.metadata.slug} ${artifact.metadata.tags.join(' ')}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      return matchesLifecycle && matchesQuery;
    });
  }, [filter, query, snapshot]);

  const selectedArtifact = useMemo(
    () => snapshot?.library.artifacts.find((artifact) => artifact.metadata.id === selectedArtifactId) ?? null,
    [selectedArtifactId, snapshot],
  );

  useEffect(() => {
    setPreparedPreview(null);
    if (selectedArtifactId === null) {
      setArtifactContent('');
      return;
    }
    let disposed = false;
    void client.command('library.show', { artifact: selectedArtifactId }).then((result) => {
      if (!disposed) {
        const content = readArtifactContent(result.data);
        setArtifactContent(content);
        setLoadedContent(content);
        setSaveState(readArtifactDraft(result.data) ? 'draft' : 'canonical');
      }
    }).catch((contentError: unknown) => {
      if (!disposed) setError(messageFrom(contentError));
    });
    return () => { disposed = true; };
  }, [client, selectedArtifactId]);

  useEffect(() => {
    if (selectedArtifact === null || artifactContent === loadedContent) return;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void client.command('library.save', {
        artifact: selectedArtifact.metadata.id,
        content: artifactContent,
      }).then((result) => {
        setLoadedContent(artifactContent);
        setSaveState(readBoolean(result.data, 'saved') === false ? 'draft' : 'canonical');
      }).catch((saveError: unknown) => {
        setSaveState('draft');
        setError(messageFrom(saveError));
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [artifactContent, client, loadedContent, selectedArtifact]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault();
        setSheet('create');
      }
      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setSheet(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const preparePreview = async () => {
    if (selectedArtifact === null) return;
    const provider = selectedArtifact.metadata.targets[0];
    if (provider === undefined) {
      setError('Choose at least one provider target before previewing this artifact.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await client.command('provider.preview', {
        artifact: selectedArtifact.metadata.id,
        provider,
      });
      setPreparedPreview({
        batchDigest: readString(result.data, 'batchDigest'),
        artifactId: selectedArtifact.metadata.id,
        provider,
        unitDigests: readStringRecord(result.data, 'unitDigests'),
      });
    } catch (previewError) {
      setError(messageFrom(previewError));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (preparedPreview === null) {
      setError('Preview the current changes before applying them.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.command('provider.apply', {
        batchDigest: preparedPreview.batchDigest,
        unitDigests: preparedPreview.unitDigests,
        providers: [preparedPreview.provider],
        artifacts: [preparedPreview.artifactId],
      });
      setPreparedPreview(null);
      await refresh();
    } catch (applyError) {
      setError(messageFrom(applyError));
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <div className="rg-manager" data-testid="manager-workbench">
      <header className="rg-command-bar">
        <div className="rg-brand" aria-label="Reglet">
          <span className="rg-brand__mark" aria-hidden="true">R</span>
          <strong>Reglet</strong>
        </div>
        <div className="rg-breadcrumb" aria-label="Current location">
          <span>{labelForDestination(destination)}</span>
          {selectedArtifact === null ? null : <><span aria-hidden="true">›</span><strong>{selectedArtifact.metadata.title}</strong></>}
        </div>
        <button type="button" className="rg-command-search" aria-label="Search or run a command" onClick={() => setPaletteOpen(true)}>
          <Shortcut keys={['⌘', 'K']} />
          <span>Search or run command</span>
        </button>
        <div className="rg-command-actions">
          {updateStatus?.status === 'available' ? <Button className="rg-update-command" tone="secondary" icon={<Download size={15} />} onClick={() => setDestination('settings')}>
            Update {updateStatus.latestVersion}
          </Button> : null}
          <Button tone="secondary" icon={<Plus size={15} />} onClick={() => setSheet('create')}>New</Button>
          <Button tone="secondary" icon={<FileDiff size={15} />} onClick={() => void preparePreview()} disabled={busy || selectedArtifact === null}>
            Preview diff
          </Button>
          <Button tone="secondary" onClick={() => void apply()} disabled={busy || preparedPreview === null}>
            Apply changes
          </Button>
          <button type="button" className="rg-icon-button" aria-label="More actions"><MoreHorizontal size={17} /></button>
        </div>
      </header>

      <main className="rg-workbench">
        <Pane label="Primary navigation" className="rg-navigation" tone="raised">
          <nav aria-label="Manager destinations">
            {destinations.map(({ id, icon: Icon, label }) => (
              <Row key={id} active={destination === id} leading={<Icon size={16} />} onClick={() => setDestination(id)}>
                {label}
              </Row>
            ))}
          </nav>
          <button type="button" className="rg-workspace-switcher">
            <span className="rg-workspace-avatar" aria-hidden="true">R</span>
            <span><strong>Reglet Workspace</strong><small>Local library</small></span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </Pane>

        {destination === 'library' ? (
          <LibraryWorkbench
            artifacts={artifacts}
            content={artifactContent}
            baseline={loadedContent}
            filter={filter}
            loading={loading}
            query={query}
            selected={selectedArtifact}
            snapshot={snapshot}
            onFilter={setFilter}
            onQuery={setQuery}
            onSelect={setSelectedArtifactId}
            onContent={setArtifactContent}
            onNew={() => setSheet('create')}
            onDuplicate={() => selectedArtifact === null ? undefined : void mutateArtifact('library.duplicate', selectedArtifact.metadata.id)}
            onArchive={() => selectedArtifact === null ? undefined : void mutateArtifact(selectedArtifact.metadata.lifecycle === 'archived' ? 'library.restore' : 'library.archive', selectedArtifact.metadata.id)}
            onRename={() => setSheet('rename')}
            onDelete={() => setSheet('delete')}
            onHistory={() => setSheet('history')}
            saveState={saveState}
          />
        ) : destination === 'projects' ? <ProjectInboxWorkbench client={client} snapshot={snapshot} onRefresh={refresh} onError={setError} />
          : destination === 'providers' ? <ProvidersWorkbench client={client} snapshot={snapshot} onError={setError} />
            : destination === 'activity' ? <ActivityWorkbench snapshot={snapshot} />
              : <SettingsWorkbench client={client} hostActions={hostActions} updateStatus={updateStatus} onUpdateStatus={setUpdateStatus} snapshot={snapshot} onRefresh={refresh} onError={setError} />}
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNew={() => setSheet('create')}
        onPreview={() => void preparePreview()}
        onRefresh={() => void refresh()}
        onArchive={() => selectedArtifact === null ? undefined : void mutateArtifact('library.archive', selectedArtifact.metadata.id)}
        onSettings={() => setDestination('settings')}
      />

      {snapshot?.library.migration.status === 'available' ? <MigrationOnboarding
        client={client}
        legacyCount={snapshot.library.migration.legacyArtifacts}
        onComplete={refresh}
        onError={setError}
      /> : null}

      <ArtifactActionSheet
        kind={sheet}
        artifact={selectedArtifact}
        busy={busy}
        onClose={() => setSheet(null)}
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

      <footer className="rg-shortcut-bar">
        <div>
          <Shortcut keys={['⌘', 'K']} label="Search" />
          <Shortcut keys={['⌘', 'N']} label="New artifact" />
          <Shortcut keys={['⌘', '⇧', 'P']} label="Preview diff" />
          <Shortcut keys={['⌘', '↵']} label="Apply changes" />
          <Shortcut keys={['?']} label="Show shortcuts" />
        </div>
        <Button tone="primary" onClick={() => void apply()} disabled={busy || preparedPreview === null}>
          Apply changes
        </Button>
      </footer>
    </div>
  );
}

interface LibraryWorkbenchProps {
  artifacts: ManagerArtifactV3[];
  baseline: string;
  content: string;
  filter: LifecycleFilter;
  loading: boolean;
  query: string;
  selected: ManagerArtifactV3 | null;
  snapshot: ManagerSnapshotV3 | null;
  saveState: SaveState;
  onFilter: (filter: LifecycleFilter) => void;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onContent: (content: string) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
  onHistory: () => void;
}

function LibraryWorkbench({
  artifacts,
  baseline,
  content,
  filter,
  loading,
  query,
  selected,
  snapshot,
  saveState,
  onFilter,
  onQuery,
  onSelect,
  onContent,
  onNew,
  onDuplicate,
  onArchive,
  onRename,
  onDelete,
  onHistory,
}: LibraryWorkbenchProps) {
  const [editorView, setEditorView] = useState<'edit' | 'diff'>('edit');
  const list = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: artifacts.length,
    getScrollElement: () => list.current,
    estimateSize: () => 38,
    overscan: 8,
  });
  return (
    <>
      <Pane label="Artifact collection" className="rg-collection">
        <PaneHeader>
          <label className="rg-search-field">
            <Search size={15} aria-hidden="true" />
            <span className="sr-only">Search artifacts</span>
            <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search artifacts…" />
            <span aria-hidden="true">⌘ F</span>
          </label>
          <button type="button" className="rg-icon-button" aria-label="Filter artifacts"><SlidersHorizontal size={16} /></button>
        </PaneHeader>
        <div className="rg-filter-tabs" role="tablist" aria-label="Artifact lifecycle">
          <FilterTab label="Active" count={snapshot?.library.counts.active ?? 0} active={filter === 'active'} onClick={() => onFilter('active')} />
          <FilterTab label="Drafts" count={snapshot?.library.counts.drafts ?? 0} active={filter === 'drafts'} onClick={() => onFilter('drafts')} />
          <FilterTab label="Archived" count={snapshot?.library.counts.archived ?? 0} active={filter === 'archived'} onClick={() => onFilter('archived')} />
        </div>
        <div className="rg-collection-label">Artifacts</div>
        <div className="rg-artifact-list" ref={list}>
          {loading ? <CollectionMessage icon={<RefreshCw size={16} />} title="Loading library…" /> : null}
          {!loading && artifacts.length === 0 ? (
            <CollectionMessage icon={filter === 'archived' ? <Archive size={16} /> : <FolderSearch size={16} />} title="No artifacts in this view" />
          ) : null}
          <div className="rg-virtual-list" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((item) => {
              const artifact = artifacts[item.index];
              if (artifact === undefined) return null;
              return <div className="rg-virtual-row" key={artifact.metadata.id} style={{ transform: `translateY(${item.start}px)`, height: item.size }}><Row
                active={selected?.metadata.id === artifact.metadata.id}
                leading={<FileText size={15} />}
                trailing={<small>{scopeLabel(artifact)}</small>}
                onClick={() => onSelect(artifact.metadata.id)}
              >{artifact.metadata.title}</Row></div>;
            })}
          </div>
        </div>
        <Button className="rg-new-artifact" tone="quiet" icon={<Plus size={15} />} onClick={onNew}>New artifact</Button>
      </Pane>

      <Pane label="Artifact editor" className="rg-editor-pane">
        <PaneHeader>
          <div className="rg-editor-tabs" role="tablist" aria-label="Artifact view">
            <button type="button" role="tab" aria-selected={editorView === 'edit'} onClick={() => setEditorView('edit')}>Edit</button>
            <button type="button" role="tab" aria-selected={editorView === 'diff'} onClick={() => setEditorView('diff')}>Changes</button>
          </div>
          <button type="button" className="rg-icon-button" aria-label="Editor actions"><MoreHorizontal size={16} /></button>
        </PaneHeader>
        {selected === null ? (
          <div className="rg-empty-canvas"><FileText size={24} /><strong>Select an artifact</strong><span>Choose a library item to inspect its canonical content and projections.</span></div>
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

      <ProjectionInspector artifact={selected} onDuplicate={onDuplicate} onArchive={onArchive} onRename={onRename} onDelete={onDelete} onHistory={onHistory} />
    </>
  );
}

function ProjectionInspector({ artifact, onDuplicate, onArchive, onRename, onDelete, onHistory }: {
  artifact: ManagerArtifactV3 | null;
  onDuplicate: () => void;
  onArchive: () => void;
  onRename: () => void;
  onDelete: () => void;
  onHistory: () => void;
}) {
  const selectedProjection = artifact?.projections.find((projection) => projection.status === 'drifted') ?? artifact?.projections[0] ?? null;
  return (
    <Pane label="Projection inspector" className="rg-inspector" tone="raised">
      <PaneHeader><span>Projection inspector</span><button type="button" className="rg-icon-button" aria-label="Inspector options"><MoreHorizontal size={15} /></button></PaneHeader>
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
              <Button tone="secondary" icon={<FileDiff size={15} />}>Preview diff</Button>
            </section>
          )}
          <section className="rg-inspector-section">
            <h2>Lifecycle & history</h2>
            <div className="rg-action-grid">
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
  return <button type="button" role="tab" aria-selected={active} onClick={onClick}><span>{label}</span><small>{count}</small></button>;
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
  return <div className="rg-sheet-backdrop" role="presentation" onMouseDown={onClose}><aside className="rg-sheet" role="dialog" aria-modal="true" aria-label={sheetTitle(kind)} onMouseDown={(event) => event.stopPropagation()}><PaneHeader><span>{sheetTitle(kind)}</span><button type="button" className="rg-icon-button" onClick={onClose} aria-label="Close">×</button></PaneHeader><div className="rg-sheet__body">
    {kind === 'create' ? <>
      <p>Create canonical content first. Provider writes still require a reviewed preview and explicit Apply.</p>
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
  useEffect(() => {
    void client.command('migration.preview', {}).then((result) => setPreview(result.data)).catch((error: unknown) => onError(messageFrom(error)));
  }, [client, onError]);
  const digest = preview === undefined ? undefined : readOptionalString(preview, 'digest');
  return <div className="rg-onboarding-backdrop"><section className="rg-onboarding" role="dialog" aria-modal="true" aria-labelledby="migration-title"><span className="rg-brand__mark" aria-hidden="true">R</span><div><p className="rg-eyebrow">Library V2 migration</p><h1 id="migration-title">Review your canonical library</h1><p>Reglet found {legacyCount} existing artifact{legacyCount === 1 ? '' : 's'}. Migration creates stable IDs and metadata without moving, rewriting, or applying provider content.</p></div><dl className="rg-key-values"><div><dt>Canonical files</dt><dd>Remain in place</dd></div><div><dt>Provider writes</dt><dd>None</dd></div><div><dt>Recovery</dt><dd>Reversible receipt</dd></div><div><dt>Preview digest</dt><dd><code>{digest?.slice(0, 16) ?? 'Preparing…'}</code></dd></div></dl><Button tone="primary" disabled={busy || digest === undefined} onClick={() => {
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

function readString(value: JsonValue, key: string): string {
  if (!isJsonRecord(value) || typeof value[key] !== 'string') {
    throw new Error(`Manager response is missing ${key}.`);
  }
  return value[key];
}

function readOptionalString(value: JsonValue, key: string): string | undefined {
  return isJsonRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function readStringRecord(value: JsonValue, key: string): Record<string, string> {
  if (!isJsonRecord(value)) {
    throw new Error(`Manager response is missing ${key}.`);
  }
  const candidate = value[key];
  if (candidate === undefined || !isJsonRecord(candidate)) {
    throw new Error(`Manager response is missing ${key}.`);
  }
  const entries = Object.entries(candidate);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    throw new Error(`Manager response contains an invalid ${key}.`);
  }
  return Object.fromEntries(entries);
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
