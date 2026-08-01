import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Database } from 'bun:sqlite';
import { regletHome } from '../paths.js';
import type {
  IgnoredDiscoveryRule,
  ProjectDiscovery,
} from '../projects/discovery.js';
import type {
  SkillRisk,
  SkillTrustDecision,
} from '../security/skills.js';

export interface ProjectRootRecord {
  id: string;
  label: string;
  path: string;
  createdAt: string;
  lastScannedAt?: string;
}

export interface ActivityRecord {
  id: number;
  occurredAt: string;
  action: string;
  artifactId?: string;
  provider?: string;
  outcome: 'success' | 'warning' | 'error';
  metadata: Record<string, string | number | boolean | null>;
}

export interface SearchRecord {
  id: string;
  source: 'canonical' | 'project';
  kind: 'instruction' | 'skill' | 'mcp';
  title: string;
  pathLabel: string;
  body: string;
}

export type SearchResult = Omit<SearchRecord, 'body'>;

export interface StoredProjectDiscovery {
  id: string;
  rootId: string;
  kind: ProjectDiscovery['kind'];
  relativePath: string;
  sourceHash: string;
  size: number;
  recognizedBy: ProjectDiscovery['recognizedBy'];
  formatsByProvider: ProjectDiscovery['formatsByProvider'];
  scope: ProjectDiscovery['scope'];
  state: ProjectDiscovery['state'];
  skillRisks: SkillRisk[];
}

export interface ProjectProvenanceRecord {
  artifactId: string;
  repositoryLabel: string;
  localPath: string;
  originalProviderFormat: string;
  sourceHash: string;
  metadata: Record<string, string | number | boolean | string[]>;
}

export interface RemoteSessionRecord {
  id: string;
  scope: 'read' | 'write' | 'admin';
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface PairingCredential {
  code: string;
  expiresAt: string;
  scope: RemoteSessionRecord['scope'];
}

export interface ClaimedRemoteSession {
  token: string;
  session: RemoteSessionRecord;
}

export interface StoredMcpMachineOverride {
  artifactId: string;
  fieldPath: string;
  value: string;
}

export interface ProjectionRecord {
  artifactId: string;
  provider: string;
  destinationPath?: string;
  desiredHash?: string;
  appliedHash?: string;
  observedHash?: string;
  appliedRevision?: string;
  appliedAt?: string;
}

interface ProjectionRow {
  artifact_id: string;
  provider: string;
  destination_path: string | null;
  desired_hash: string | null;
  applied_hash: string | null;
  observed_hash: string | null;
  applied_revision: string | null;
  applied_at: string | null;
}

interface ProjectRootRow {
  id: string;
  label: string;
  path: string;
  created_at: string;
  last_scanned_at: string | null;
}

interface ActivityRow {
  id: number;
  occurred_at: string;
  action: string;
  artifact_id: string | null;
  provider: string | null;
  outcome: 'success' | 'warning' | 'error';
  metadata_json: string;
}

interface SearchRow {
  id: string;
  source: 'canonical' | 'project';
  kind: 'instruction' | 'skill' | 'mcp';
  title: string;
  path_label: string;
  body: string;
}

interface IgnoredRow {
  relative_path: string;
  source_hash: string;
}

interface DiscoveryRow {
  id: string;
  root_id: string;
  kind: ProjectDiscovery['kind'];
  relative_path: string;
  source_hash: string;
  size_bytes: number;
  recognized_by_json: string;
  formats_json: string;
  scope_json: string;
  state: ProjectDiscovery['state'];
  skill_risks_json: string;
}

interface TrustRow {
  artifact_id: string;
  revision: string;
  trusted_at: string;
  executable_files_json: string;
}

interface ProvenanceRow {
  artifact_id: string;
  repository_label: string;
  local_path: string;
  original_provider_format: string;
  source_hash: string;
  metadata_json: string;
}

interface SessionRow {
  id: string;
  scope: RemoteSessionRecord['scope'];
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface PairingRow {
  id: string;
  scope: RemoteSessionRecord['scope'];
  expires_at: string;
  claimed_at: string | null;
}

export class LocalState {
  readonly databasePath: string;
  readonly database: Database;

  private constructor(databasePath: string, database: Database) {
    this.databasePath = databasePath;
    this.database = database;
  }

  static async open(home = regletHome()): Promise<LocalState> {
    const databasePath = path.join(home, '.state', 'reglet.sqlite');
    await mkdir(path.dirname(databasePath), { recursive: true });
    const database = new Database(databasePath, {
      create: true,
      readwrite: true,
      strict: true,
    });
    database.run('PRAGMA journal_mode = WAL');
    database.run('PRAGMA foreign_keys = ON');
    migrate(database);
    return new LocalState(databasePath, database);
  }

  close(): void {
    this.database.close();
  }

  migrationVersion(): number {
    return (
      this.database
        .query<{ version: number }, []>(
          'SELECT COALESCE(MAX(version), 0) AS version FROM migration_state',
        )
        .get()?.version ?? 0
    );
  }

  addProjectRoot(rootPath: string, label = path.basename(rootPath)): ProjectRootRecord {
    const resolvedPath = path.resolve(rootPath);
    const id = createHash('sha256').update(resolvedPath).digest('hex').slice(0, 24);
    const createdAt = new Date().toISOString();
    this.database
      .query<
        void,
        [string, string, string, string]
      >(
        `INSERT INTO project_roots (id, label, path, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET label = excluded.label`,
      )
      .run(id, label, resolvedPath, createdAt);
    return this.getProjectRoot(id) ?? { id, label, path: resolvedPath, createdAt };
  }

  removeProjectRoot(id: string): boolean {
    return (
      this.database
        .query<void, [string]>('DELETE FROM project_roots WHERE id = ?')
        .run(id).changes > 0
    );
  }

  listProjectRoots(): ProjectRootRecord[] {
    return this.database
      .query<ProjectRootRow, []>(
        `SELECT id, label, path, created_at, last_scanned_at
         FROM project_roots ORDER BY label COLLATE NOCASE, path`,
      )
      .all()
      .map(mapProjectRoot);
  }

  getProjectRoot(id: string): ProjectRootRecord | undefined {
    const row = this.database
      .query<ProjectRootRow, [string]>(
        `SELECT id, label, path, created_at, last_scanned_at
         FROM project_roots WHERE id = ?`,
      )
      .get(id);
    return row === null ? undefined : mapProjectRoot(row);
  }

  replaceDiscoveries(rootId: string, discoveries: ProjectDiscovery[]): void {
    const now = new Date().toISOString();
    const previous = new Map(
      this.listDiscoveries(rootId).map((discovery) => [
        discovery.id,
        discovery,
      ]),
    );
    this.database.run('BEGIN IMMEDIATE');
    try {
      this.database
        .query<void, [string]>('DELETE FROM discoveries WHERE root_id = ?')
        .run(rootId);
      const insert = this.database.query<
        void,
        [
          string,
          string,
          string,
          string,
          string,
          number,
          string,
          string,
          string,
          string,
          string,
        ]
      >(
        `INSERT INTO discoveries (
          id, root_id, kind, relative_path, source_hash, size_bytes,
          recognized_by_json, formats_json, scope_json, state, skill_risks_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const discovery of discoveries) {
        const previousDiscovery = previous.get(discovery.id);
        const state =
          previousDiscovery?.state === 'promoted'
            ? previousDiscovery.sourceHash === discovery.sourceHash
              ? 'promoted'
              : 'changed'
            : discovery.state;
        insert.run(
          discovery.id,
          rootId,
          discovery.kind,
          discovery.relativePath,
          discovery.sourceHash,
          discovery.size,
          JSON.stringify(discovery.recognizedBy),
          JSON.stringify(discovery.formatsByProvider),
          JSON.stringify(discovery.scope),
          state,
          JSON.stringify(discovery.skillRisks),
        );
      }
      this.database
        .query<void, [string, string]>(
          'UPDATE project_roots SET last_scanned_at = ? WHERE id = ?',
        )
        .run(now, rootId);
      this.database.run('COMMIT');
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  listDiscoveries(rootId?: string): StoredProjectDiscovery[] {
    const rows =
      rootId === undefined
        ? this.database
            .query<DiscoveryRow, []>(
              `SELECT id, root_id, kind, relative_path, source_hash, size_bytes,
                recognized_by_json, formats_json, scope_json, state, skill_risks_json
               FROM discoveries ORDER BY relative_path`,
            )
            .all()
        : this.database
            .query<DiscoveryRow, [string]>(
              `SELECT id, root_id, kind, relative_path, source_hash, size_bytes,
                recognized_by_json, formats_json, scope_json, state, skill_risks_json
               FROM discoveries WHERE root_id = ? ORDER BY relative_path`,
            )
            .all(rootId);
    return rows.map((row) => ({
      id: row.id,
      rootId: row.root_id,
      kind: row.kind,
      relativePath: row.relative_path,
      sourceHash: row.source_hash,
      size: row.size_bytes,
      recognizedBy: parseProviderIds(row.recognized_by_json),
      formatsByProvider: parseProviderFormats(row.formats_json),
      scope: parseScope(row.scope_json),
      state: row.state,
      skillRisks: parseSkillRisks(row.skill_risks_json),
    }));
  }

  markDiscoveryState(id: string, state: ProjectDiscovery['state']): boolean {
    return (
      this.database
        .query<void, [string, string]>(
          'UPDATE discoveries SET state = ? WHERE id = ?',
        )
        .run(state, id).changes > 0
    );
  }

  saveProvenance(record: ProjectProvenanceRecord): void {
    this.database
      .query<void, [string, string, string, string, string, string]>(
        `INSERT INTO provenance (
          artifact_id, repository_label, local_path, original_provider_format,
          source_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          repository_label = excluded.repository_label,
          local_path = excluded.local_path,
          original_provider_format = excluded.original_provider_format,
          source_hash = excluded.source_hash,
          metadata_json = excluded.metadata_json`,
      )
      .run(
        record.artifactId,
        record.repositoryLabel,
        record.localPath,
        record.originalProviderFormat,
        record.sourceHash,
        JSON.stringify(record.metadata),
      );
  }

  replaceMcpMachineOverrides(
    artifactId: string,
    overrides: Array<{ fieldPath: string; value: string }>,
  ): void {
    this.database.run('BEGIN IMMEDIATE');
    try {
      this.database
        .query<void, [string]>(
          'DELETE FROM mcp_machine_overrides WHERE artifact_id = ?',
        )
        .run(artifactId);
      const insert = this.database.query<void, [string, string, string]>(
        `INSERT INTO mcp_machine_overrides (artifact_id, field_path, value)
         VALUES (?, ?, ?)`,
      );
      for (const override of overrides) {
        insert.run(artifactId, override.fieldPath, override.value);
      }
      this.database.run('COMMIT');
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  mcpMachineOverrides(artifactId: string): StoredMcpMachineOverride[] {
    return this.database
      .query<
        { artifact_id: string; field_path: string; value: string },
        [string]
      >(
        `SELECT artifact_id, field_path, value
         FROM mcp_machine_overrides WHERE artifact_id = ?
         ORDER BY field_path`,
      )
      .all(artifactId)
      .map((row) => ({
        artifactId: row.artifact_id,
        fieldPath: row.field_path,
        value: row.value,
      }));
  }

  provenance(artifactId: string): ProjectProvenanceRecord | undefined {
    const row = this.database
      .query<ProvenanceRow, [string]>(
        `SELECT artifact_id, repository_label, local_path,
          original_provider_format, source_hash, metadata_json
         FROM provenance WHERE artifact_id = ?`,
      )
      .get(artifactId);
    if (row === null) {
      return undefined;
    }
    return {
      artifactId: row.artifact_id,
      repositoryLabel: row.repository_label,
      localPath: row.local_path,
      originalProviderFormat: row.original_provider_format,
      sourceHash: row.source_hash,
      metadata: parseProvenanceMetadata(row.metadata_json),
    };
  }

  setIgnoredDiscovery(
    rootId: string,
    relativePath: string,
    sourceHash: string,
  ): void {
    this.database
      .query<void, [string, string, string, string]>(
        `INSERT INTO ignored_discoveries (
          root_id, relative_path, source_hash, ignored_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(root_id, relative_path) DO UPDATE SET
          source_hash = excluded.source_hash,
          ignored_at = excluded.ignored_at`,
      )
      .run(rootId, relativePath, sourceHash, new Date().toISOString());
  }

  ignoredDiscoveries(rootId: string): IgnoredDiscoveryRule[] {
    return this.database
      .query<IgnoredRow, [string]>(
        `SELECT relative_path, source_hash
         FROM ignored_discoveries WHERE root_id = ?`,
      )
      .all(rootId)
      .map((row) => ({
        relativePath: row.relative_path,
        sourceHash: row.source_hash,
      }));
  }

  saveTrustDecision(decision: SkillTrustDecision): void {
    this.database
      .query<void, [string, string, string, string]>(
        `INSERT INTO trust_decisions (
          artifact_id, revision, trusted_at, executable_files_json
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          revision = excluded.revision,
          trusted_at = excluded.trusted_at,
          executable_files_json = excluded.executable_files_json`,
      )
      .run(
        decision.artifactId,
        decision.revision,
        decision.trustedAt,
        JSON.stringify(decision.executableFiles),
      );
  }

  trustDecision(artifactId: string): SkillTrustDecision | undefined {
    const row = this.database
      .query<TrustRow, [string]>(
        `SELECT artifact_id, revision, trusted_at, executable_files_json
         FROM trust_decisions WHERE artifact_id = ?`,
      )
      .get(artifactId);
    if (row === null) {
      return undefined;
    }
    return {
      artifactId: row.artifact_id,
      revision: row.revision,
      trustedAt: row.trusted_at,
      executableFiles: parseStringArray(row.executable_files_json),
    };
  }

  recordActivity(input: {
    action: string;
    artifactId?: string;
    provider?: string;
    outcome: ActivityRecord['outcome'];
    metadata?: Record<string, string | number | boolean | null>;
  }): void {
    this.database
      .query<
        void,
        [string, string, string | null, string | null, string, string]
      >(
        `INSERT INTO activity (
          occurred_at, action, artifact_id, provider, outcome, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        new Date().toISOString(),
        input.action,
        input.artifactId ?? null,
        input.provider ?? null,
        input.outcome,
        JSON.stringify(redactMetadata(input.metadata ?? {})),
      );
  }

  saveProjectionRecord(record: ProjectionRecord): void {
    this.database
      .query<
        void,
        [string, string, string | null, string | null, string | null, string | null, string | null, string | null]
      >(
        `INSERT INTO projection_records (
          artifact_id, provider, destination_path, desired_hash,
          applied_hash, observed_hash, applied_revision, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id, provider) DO UPDATE SET
          destination_path = excluded.destination_path,
          desired_hash = excluded.desired_hash,
          applied_hash = excluded.applied_hash,
          observed_hash = excluded.observed_hash,
          applied_revision = excluded.applied_revision,
          applied_at = excluded.applied_at`,
      )
      .run(
        record.artifactId,
        record.provider,
        record.destinationPath ?? null,
        record.desiredHash ?? null,
        record.appliedHash ?? null,
        record.observedHash ?? null,
        record.appliedRevision ?? null,
        record.appliedAt ?? null,
      );
  }

  listProjectionRecords(artifactId?: string): ProjectionRecord[] {
    const rows = artifactId === undefined
      ? this.database
          .query<ProjectionRow, []>(
            `SELECT artifact_id, provider, destination_path, desired_hash,
              applied_hash, observed_hash, applied_revision, applied_at
             FROM projection_records ORDER BY artifact_id, provider`,
          )
          .all()
      : this.database
          .query<ProjectionRow, [string]>(
            `SELECT artifact_id, provider, destination_path, desired_hash,
              applied_hash, observed_hash, applied_revision, applied_at
             FROM projection_records WHERE artifact_id = ? ORDER BY provider`,
          )
          .all(artifactId);
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      provider: row.provider,
      destinationPath: row.destination_path ?? undefined,
      desiredHash: row.desired_hash ?? undefined,
      appliedHash: row.applied_hash ?? undefined,
      observedHash: row.observed_hash ?? undefined,
      appliedRevision: row.applied_revision ?? undefined,
      appliedAt: row.applied_at ?? undefined,
    }));
  }

  commandRevision(): number {
    const row = this.database
      .query<{ value: string }, [string]>(
        'SELECT value FROM sync_state WHERE key = ?',
      )
      .get('application.revision');
    if (row === null) {
      return 0;
    }
    const revision = Number.parseInt(row.value, 10);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  }

  createPairingCredential(
    scope: RemoteSessionRecord['scope'],
    lifetimeMs = 10 * 60 * 1_000,
  ): PairingCredential {
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
    this.database
      .query<void, [string, string, string, string, string]>(
        `INSERT INTO pairing_credentials (
          id, code_hash, scope, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        hashCredential(code),
        scope,
        new Date().toISOString(),
        expiresAt,
      );
    return { code, expiresAt, scope };
  }

  claimPairingCredential(
    code: string,
    sessionLifetimeMs?: number,
  ): ClaimedRemoteSession | undefined {
    const now = new Date().toISOString();
    this.database.run('BEGIN IMMEDIATE');
    try {
      const pairing = this.database
        .query<PairingRow, [string, string]>(
          `SELECT id, scope, expires_at, claimed_at
           FROM pairing_credentials
           WHERE code_hash = ? AND claimed_at IS NULL AND expires_at > ?`,
        )
        .get(hashCredential(code), now);
      if (pairing === null) {
        this.database.run('ROLLBACK');
        return undefined;
      }
      const token = randomBytes(32).toString('base64url');
      const session: RemoteSessionRecord = {
        id: randomUUID(),
        scope: pairing.scope,
        createdAt: now,
        expiresAt:
          sessionLifetimeMs === undefined
            ? undefined
            : new Date(Date.now() + sessionLifetimeMs).toISOString(),
      };
      this.database
        .query<void, [string, string, string, string, string | null]>(
          `INSERT INTO remote_sessions (
            id, token_hash, scope, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          hashCredential(token),
          session.scope,
          session.createdAt,
          session.expiresAt ?? null,
        );
      this.database
        .query<void, [string, string]>(
          'UPDATE pairing_credentials SET claimed_at = ? WHERE id = ?',
        )
        .run(now, pairing.id);
      this.database.run('COMMIT');
      return { token, session };
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  authorizeSession(token: string): RemoteSessionRecord | undefined {
    const row = this.database
      .query<SessionRow, [string, string]>(
        `SELECT id, scope, created_at, expires_at, revoked_at
         FROM remote_sessions
         WHERE token_hash = ? AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(hashCredential(token), new Date().toISOString());
    return row === null ? undefined : mapSession(row);
  }

  listRemoteSessions(): RemoteSessionRecord[] {
    return this.database
      .query<SessionRow, []>(
        `SELECT id, scope, created_at, expires_at, revoked_at
         FROM remote_sessions ORDER BY created_at DESC`,
      )
      .all()
      .map(mapSession);
  }

  revokeRemoteSession(id: string): boolean {
    return (
      this.database
        .query<void, [string, string]>(
          `UPDATE remote_sessions SET revoked_at = ?
           WHERE id = ? AND revoked_at IS NULL`,
        )
        .run(new Date().toISOString(), id).changes > 0
    );
  }

  setSetting(key: string, value: string): void {
    this.database
      .query<void, [string, string, string]>(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  setting(key: string): string | undefined {
    return (
      this.database
        .query<{ value: string }, [string]>(
          'SELECT value FROM sync_state WHERE key = ?',
        )
        .get(key)?.value ?? undefined
    );
  }

  advanceCommandRevision(expectedRevision: number): number {
    const current = this.commandRevision();
    if (current !== expectedRevision) {
      throw new Error(
        `Application revision changed: expected ${expectedRevision}, observed ${current}.`,
      );
    }
    const next = current + 1;
    this.database
      .query<void, [string, string, string]>(
        `INSERT INTO sync_state (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run('application.revision', String(next), new Date().toISOString());
    return next;
  }

  listActivity(limit = 100): ActivityRecord[] {
    return this.database
      .query<ActivityRow, [number]>(
        `SELECT id, occurred_at, action, artifact_id, provider, outcome, metadata_json
         FROM activity ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({
        id: row.id,
        occurredAt: row.occurred_at,
        action: row.action,
        artifactId: row.artifact_id ?? undefined,
        provider: row.provider ?? undefined,
        outcome: row.outcome,
        metadata: parseMetadata(row.metadata_json),
      }));
  }

  indexSearchRecord(record: SearchRecord): void {
    this.database.run('BEGIN IMMEDIATE');
    try {
      this.database
        .query<void, [string]>('DELETE FROM search_index WHERE id = ?')
        .run(record.id);
      this.database
        .query<void, [string, string, string, string, string, string]>(
          `INSERT INTO search_index (
            id, source, kind, title, path_label, body
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.source,
          record.kind,
          record.title,
          record.pathLabel,
          record.body,
        );
      this.database.run('COMMIT');
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  replaceSearchPrefix(prefix: string, records: SearchRecord[]): void {
    this.database.run('BEGIN IMMEDIATE');
    try {
      this.database
        .query<void, [string]>('DELETE FROM search_index WHERE id GLOB ?')
        .run(`${prefix}*`);
      const insert = this.database.query<
        void,
        [string, string, string, string, string, string]
      >(
        `INSERT INTO search_index (
          id, source, kind, title, path_label, body
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const record of records) {
        insert.run(
          record.id,
          record.source,
          record.kind,
          record.title,
          record.pathLabel,
          record.body,
        );
      }
      this.database.run('COMMIT');
    } catch (error) {
      this.database.run('ROLLBACK');
      throw error;
    }
  }

  search(
    query: string,
    limit = 50,
    source?: SearchRecord['source'],
  ): SearchResult[] {
    const normalized = query.trim();
    if (normalized.length === 0) {
      return [];
    }
    const rows =
      source === undefined
        ? this.database
            .query<Omit<SearchRow, 'body'>, [string, number]>(
              `SELECT id, source, kind, title, path_label
               FROM search_index
               WHERE search_index MATCH ?
               ORDER BY bm25(search_index)
               LIMIT ?`,
            )
            .all(toFtsQuery(normalized), limit)
        : this.database
            .query<Omit<SearchRow, 'body'>, [string, string, number]>(
              `SELECT id, source, kind, title, path_label
               FROM search_index
               WHERE search_index MATCH ? AND source = ?
               ORDER BY bm25(search_index)
               LIMIT ?`,
            )
            .all(toFtsQuery(normalized), source, limit);
    return rows
      .map((row) => ({
        id: row.id,
        source: row.source,
        kind: row.kind,
        title: row.title,
        pathLabel: row.path_label,
      }));
  }
}

function migrate(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS migration_state (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projection_records (
      artifact_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      destination_path TEXT,
      desired_hash TEXT,
      applied_hash TEXT,
      observed_hash TEXT,
      applied_revision TEXT,
      applied_at TEXT,
      PRIMARY KEY (artifact_id, provider)
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at TEXT NOT NULL,
      action TEXT NOT NULL,
      artifact_id TEXT,
      provider TEXT,
      outcome TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS project_roots (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_scanned_at TEXT
    );
    CREATE TABLE IF NOT EXISTS discoveries (
      id TEXT PRIMARY KEY,
      root_id TEXT NOT NULL REFERENCES project_roots(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      recognized_by_json TEXT NOT NULL,
      formats_json TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      state TEXT NOT NULL,
      skill_risks_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS provenance (
      artifact_id TEXT PRIMARY KEY,
      repository_label TEXT NOT NULL,
      local_path TEXT NOT NULL,
      original_provider_format TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS ignored_discoveries (
      root_id TEXT NOT NULL REFERENCES project_roots(id) ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      ignored_at TEXT NOT NULL,
      PRIMARY KEY (root_id, relative_path)
    );
    CREATE TABLE IF NOT EXISTS mcp_machine_overrides (
      artifact_id TEXT NOT NULL,
      field_path TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (artifact_id, field_path)
    );
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS pairing_credentials (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trust_decisions (
      artifact_id TEXT PRIMARY KEY,
      revision TEXT NOT NULL,
      trusted_at TEXT NOT NULL,
      executable_files_json TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      id UNINDEXED,
      source UNINDEXED,
      kind UNINDEXED,
      title,
      path_label,
      body,
      tokenize = 'unicode61'
    );
  `);
  ensureColumn(
    database,
    'projection_records',
    'applied_revision',
    'TEXT',
  );
  ensureColumn(
    database,
    'discoveries',
    'skill_risks_json',
    "TEXT NOT NULL DEFAULT '[]'",
  );
  database
    .query<void, [number, string]>(
      'INSERT OR IGNORE INTO migration_state (version, applied_at) VALUES (?, ?)',
    )
    .run(1, new Date().toISOString());
  database
    .query<void, [number, string]>(
      'INSERT OR IGNORE INTO migration_state (version, applied_at) VALUES (?, ?)',
    )
    .run(2, new Date().toISOString());
  database
    .query<void, [number, string]>(
      'INSERT OR IGNORE INTO migration_state (version, applied_at) VALUES (?, ?)',
    )
    .run(3, new Date().toISOString());
}

function ensureColumn(
  database: Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all();
  if (!columns.some((candidate) => candidate.name === column)) {
    database.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function mapProjectRoot(row: ProjectRootRow): ProjectRootRecord {
  return {
    id: row.id,
    label: row.label,
    path: row.path,
    createdAt: row.created_at,
    lastScannedAt: row.last_scanned_at ?? undefined,
  };
}

function redactMetadata(
  value: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSecretShapedKey(key) ? '[REDACTED]' : item;
  }
  return result;
}

function isSecretShapedKey(key: string): boolean {
  return /(?:secret|token|password|credential|authorization|api[-_]?key)/i.test(key);
}

function parseMetadata(value: string): Record<string, string | number | boolean | null> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string | number | boolean | null> = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean' ||
        item === null
      ) {
        result[key] = item;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseProviderIds(value: string): ProjectDiscovery['recognizedBy'] {
  return parseStringArray(value).filter(
    (item): item is ProjectDiscovery['recognizedBy'][number] =>
      item === 'claude' ||
      item === 'codex' ||
      item === 'cursor' ||
      item === 'gemini' ||
      item === 'windsurf' ||
      item === 'opencode',
  );
}

function parseProviderFormats(
  value: string,
): ProjectDiscovery['formatsByProvider'] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: ProjectDiscovery['formatsByProvider'] = {};
    for (const [provider, format] of Object.entries(parsed)) {
      if (typeof format !== 'string') {
        continue;
      }
      if (
        provider === 'claude' ||
        provider === 'codex' ||
        provider === 'cursor' ||
        provider === 'gemini' ||
        provider === 'windsurf' ||
        provider === 'opencode'
      ) {
        result[provider] = format;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function parseScope(value: string): ProjectDiscovery['scope'] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      'rootLevel' in parsed &&
      typeof parsed.rootLevel === 'boolean' &&
      'hierarchical' in parsed &&
      typeof parsed.hierarchical === 'boolean' &&
      'alwaysActive' in parsed &&
      typeof parsed.alwaysActive === 'boolean' &&
      'globs' in parsed &&
      Array.isArray(parsed.globs) &&
      parsed.globs.every((item) => typeof item === 'string') &&
      'manual' in parsed &&
      typeof parsed.manual === 'boolean' &&
      'agentRequested' in parsed &&
      typeof parsed.agentRequested === 'boolean' &&
      'lossyFields' in parsed &&
      Array.isArray(parsed.lossyFields) &&
      parsed.lossyFields.every((item) => typeof item === 'string')
    ) {
      return {
        rootLevel: parsed.rootLevel,
        hierarchical: parsed.hierarchical,
        alwaysActive: parsed.alwaysActive,
        globs: parsed.globs,
        manual: parsed.manual,
        agentRequested: parsed.agentRequested,
        lossyFields: parsed.lossyFields,
      };
    }
  } catch {
    // Fall through to a conservative scope.
  }
  return {
    rootLevel: false,
    hierarchical: true,
    alwaysActive: false,
    globs: [],
    manual: false,
    agentRequested: false,
      lossyFields: [],
  };
}

function parseSkillRisks(value: string): SkillRisk[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const risks: SkillRisk[] = [];
    for (const item of parsed) {
      if (
        typeof item !== 'object' ||
        item === null ||
        !('code' in item) ||
        typeof item.code !== 'string' ||
        !('severity' in item) ||
        (item.severity !== 'info' &&
          item.severity !== 'warning' &&
          item.severity !== 'error') ||
        !('message' in item) ||
        typeof item.message !== 'string'
      ) {
        continue;
      }
      risks.push({
        code: item.code as SkillRisk['code'],
        severity: item.severity,
        message: item.message,
        relPath:
          'relPath' in item && typeof item.relPath === 'string'
            ? item.relPath
            : undefined,
      });
    }
    return risks;
  } catch {
    return [];
  }
}

function parseProvenanceMetadata(
  value: string,
): ProjectProvenanceRecord['metadata'] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const result: ProjectProvenanceRecord['metadata'] = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean' ||
        (Array.isArray(item) && item.every((entry) => typeof entry === 'string'))
      ) {
        result[key] = item;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function toFtsQuery(value: string): string {
  return value
    .split(/\s+/)
    .map((term) => `"${term.replaceAll('"', '""')}"*`)
    .join(' AND ');
}

export function newSessionId(): string {
  return randomUUID();
}

function pairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  return [...bytes]
    .map((byte) => alphabet[byte % alphabet.length] ?? 'A')
    .join('');
}

function hashCredential(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mapSession(row: SessionRow): RemoteSessionRecord {
  return {
    id: row.id,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
  };
}
