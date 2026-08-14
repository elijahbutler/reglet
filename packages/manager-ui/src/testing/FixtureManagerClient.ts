import type {
  JsonValue,
  ManagerProtocolOperation,
  ManagerRpcInputs,
  ManagerSnapshotV3,
} from '@reglet/manager-protocol';
import type {
  ManagerClient,
  ManagerCommandOptions,
  ManagerCommandResult,
  ManagerInvalidation,
} from '../client/ManagerClient.js';
import { managerFixtureContent, managerFixtureSnapshot } from './fixtureSnapshot.js';

export class FixtureManagerClient implements ManagerClient {
  private state: ManagerSnapshotV3;
  private readonly listeners = new Set<(invalidation: ManagerInvalidation) => void>();

  constructor(snapshot: ManagerSnapshotV3 = managerFixtureSnapshot) {
    this.state = structuredClone(snapshot);
  }

  async snapshot(): Promise<ManagerSnapshotV3> {
    return structuredClone(this.state);
  }

  async command<Operation extends ManagerProtocolOperation>(
    operation: Operation,
    input?: ManagerRpcInputs[Operation],
    options: ManagerCommandOptions = {},
  ): Promise<ManagerCommandResult> {
    if (options.expectedRevision !== undefined && options.expectedRevision !== this.state.revision) {
      throw new Error(`Revision conflict: expected ${options.expectedRevision}, observed ${this.state.revision}.`);
    }
    if (operation === 'library.show') {
      return { revision: this.state.revision, changed: false, data: { content: managerFixtureContent } };
    }
    if (operation === 'provider.preview') {
      return { revision: this.state.revision, changed: false, data: { batchDigest: 'fixture-batch-digest', unitDigests: {} } };
    }
    if (operation === 'migration.preview') {
      return { revision: this.state.revision, changed: false, data: { digest: 'fixture-migration-digest', artifacts: [] } };
    }
    if (operation === 'setup.complete') {
      this.state = {
        ...this.state,
        revision: this.state.revision + 1,
        settings: { ...this.state.settings, setup: { completed: true } },
      };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return { revision: this.state.revision, changed: true, data: { completed: true } };
    }
    if (operation === 'sync.run') {
      this.state = {
        ...this.state,
        revision: this.state.revision + 1,
        settings: {
          ...this.state.settings,
          sync: { ...this.state.settings.sync, state: 'idle', lastCompletedAt: '2026-08-13T12:00:00.000Z' },
        },
      };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return { revision: this.state.revision, changed: true, data: { pulled: [], pushed: [], merged: [], deleted: [], conflicts: [] } };
    }
    const mutating = isMutating(operation);
    if (mutating) {
      this.state = { ...this.state, revision: this.state.revision + 1 };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
    }
    const data: JsonValue = { operation };
    return { revision: this.state.revision, changed: mutating, data };
  }

  subscribe(listener: (invalidation: ManagerInvalidation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function isMutating(operation: ManagerProtocolOperation): boolean {
  return ![
    'snapshot',
    'library.list',
    'library.show',
    'provider.list',
    'provider.effective',
    'provider.preview',
    'project.root.list',
    'project.discoveries',
    'activity.list',
    'search',
    'sync.status',
    'remote.status',
    'session.list',
    'diagnostics',
    'migration.preview',
    'migration.status',
  ].includes(operation);
}
