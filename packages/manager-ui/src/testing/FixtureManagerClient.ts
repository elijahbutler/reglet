import {
  isManagerMutatingOperation,
  type JsonValue,
  type ManagerContentId,
  type ManagerProjectionReviewV3,
  type ManagerProtocolOperation,
  type ManagerProviderId,
  type ManagerRpcInputs,
  type ManagerSnapshotV3,
  type SyncDeviceSummary,
  type SyncSnapshot,
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
  private recoveryRestored = false;
  private syncDevices: SyncDeviceSummary[] = [
    { id: 'fixture-device-current', name: 'Studio Mac', current: true, status: 'active', createdAt: '2026-08-01T12:00:00.000Z', lastSeenAt: '2026-08-19T18:30:00.000Z', revokedAt: null },
    { id: 'fixture-device-mobile', name: 'Travel Mac', current: false, status: 'active', createdAt: '2026-08-03T12:00:00.000Z', lastSeenAt: '2026-08-18T17:20:00.000Z', revokedAt: null },
  ];
  private readonly trustedSkillRevisions = new Map<string, { revision: string; trustedAt: string }>();
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
    if (operation === 'skill.inspect') {
      const skillInput = input as ManagerRpcInputs['skill.inspect'] | undefined;
      if (skillInput === undefined) throw new Error('Fixture skill inspection requires an artifact.');
      const artifact = this.state.library.artifacts.find((candidate) => candidate.metadata.id === skillInput.artifact);
      if (artifact?.metadata.kind !== 'skill') throw new Error('Fixture skill inspection requires a canonical skill.');
      const skillRevision = `fixture-skill-revision-${artifact.metadata.slug}`;
      const trusted = this.trustedSkillRevisions.get(artifact.metadata.id);
      return {
        revision: this.state.revision,
        changed: false,
        data: {
          artifact: {
            id: artifact.metadata.id,
            title: artifact.metadata.title,
            slug: artifact.metadata.slug,
            targets: artifact.metadata.targets,
          },
          revision: skillRevision,
          totalBytes: 1842,
          files: [
            { relPath: 'SKILL.md', kind: 'file', size: 842, executable: false, binary: false, contentHash: 'fixture-skill-doc-hash' },
            { relPath: 'scripts/check.mjs', kind: 'file', size: 1000, executable: true, binary: false, contentHash: 'fixture-executable-hash' },
          ],
          risks: [{ code: 'executable', severity: 'warning', relPath: 'scripts/check.mjs', message: 'Executable content requires explicit trust before promotion.' }],
          promotionBlocked: false,
          requiresExecutableConfirmation: true,
          trust: trusted?.revision === skillRevision
            ? { state: 'trusted', revision: trusted.revision, trustedAt: trusted.trustedAt, executableFiles: ['scripts/check.mjs'] }
            : { state: trusted === undefined ? 'untrusted' : 'changed' },
        },
      };
    }
    if (operation === 'skill.trust') {
      const skillInput = input as ManagerRpcInputs['skill.trust'] | undefined;
      if (skillInput === undefined || !skillInput.confirmed) throw new Error('Fixture skill approval requires confirmation.');
      const artifact = this.state.library.artifacts.find((candidate) => candidate.metadata.id === skillInput.artifact);
      if (artifact?.metadata.kind !== 'skill') throw new Error('Fixture skill approval requires a canonical skill.');
      const skillRevision = `fixture-skill-revision-${artifact.metadata.slug}`;
      if (skillInput.revision !== skillRevision) throw new Error('This skill changed after it was reviewed.');
      const trustedAt = '2026-08-19T19:00:00.000Z';
      this.trustedSkillRevisions.set(artifact.metadata.id, { revision: skillRevision, trustedAt });
      this.state = { ...this.state, revision: this.state.revision + 1 };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return { revision: this.state.revision, changed: true, data: { trusted: true, revision: skillRevision, executableFiles: ['scripts/check.mjs'] } };
    }
    if (operation === 'provider.preview') {
      return {
        revision: this.state.revision,
        changed: false,
        data: {
          batchDigest: 'fixture-batch-digest',
          content: 'rules',
          unitDigest: 'fixture-unit-digest',
          review: {
            version: 1,
            digest: 'fixture-batch-digest',
            units: [{
              key: 'codex:rules',
              provider: 'codex',
              content: 'rules',
              digest: 'fixture-unit-digest',
              masterRevision: 'fixture-master-revision',
              status: 'ready',
              validationIssues: [],
              entries: [{
                operation: 'write',
                path: '~/.codex/AGENTS.md',
                diff: '@@ -1 +1 @@\n-old\n+new',
                driftStatus: 'clean',
                expectedTargetHash: 'fixture-before-hash',
                resultingTargetHash: 'fixture-after-hash',
                snapshotBehavior: 'snapshot-before-write',
                backupBehavior: 'backup-before-write',
              }],
              artifacts: [{ id: 'artifact-general-instructions', title: 'General agent instructions', kind: 'instruction' }],
              requiresDriftConfirmation: false,
            }],
          },
        },
      };
    }
    if (operation === 'provider.review') {
      const reviewInput = input as ManagerRpcInputs['provider.review'] | undefined;
      if (reviewInput === undefined) throw new Error('Fixture provider review requires units.');
      return {
        revision: this.state.revision,
        changed: false,
        data: fixtureProjectionReview(reviewInput.units),
      };
    }
    if (operation === 'provider.apply') {
      const applyInput = input as ManagerRpcInputs['provider.apply'] | undefined;
      if (applyInput === undefined) throw new Error('Fixture provider apply requires reviewed units.');
      this.state = { ...this.state, revision: this.state.revision + 1 };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return {
        revision: this.state.revision,
        changed: true,
        data: {
          version: 1,
          units: applyInput.units.map((unit) => ({
            key: `${unit.provider}:${unit.content}`,
            provider: unit.provider,
            content: unit.content,
            status: 'applied',
            issues: [],
            receiptId: `fixture-receipt-${unit.provider}-${unit.content}`,
            completedAt: '2026-08-19T18:42:00.000Z',
          })),
          summary: { applied: applyInput.units.length, blocked: 0, failed: 0 },
        },
      };
    }
    if (operation === 'provider.source.preview') {
      const sourceInput = input as ManagerRpcInputs['provider.source.preview'] | undefined;
      if (sourceInput === undefined) throw new Error('Fixture provider source preview requires an exact source.');
      const title = sourceInput.content === 'rules' ? 'Imported provider instructions' : sourceInput.name ?? `Imported ${sourceInput.content}`;
      return {
        revision: this.state.revision,
        changed: false,
        data: {
          version: 1,
          digest: `fixture-adoption-${sourceInput.provider}-${sourceInput.content}`,
          provider: sourceInput.provider,
          content: sourceInput.content,
          source: {
            path: fixtureTargetPath(sourceInput.provider, sourceInput.content),
            ...(sourceInput.name === undefined ? {} : { name: sourceInput.name }),
            revision: 'fixture-source-revision',
            ownership: 'unmanaged',
          },
          artifact: {
            kind: sourceInput.content === 'rules' ? 'instruction' : sourceInput.content === 'skills' ? 'skill' : 'mcp',
            slug: 'imported-provider-content',
            title,
            scope: sourceInput.destination === 'provider' ? { kind: 'provider-overlay', provider: sourceInput.provider } : { kind: 'global' },
            targets: sourceInput.destination === 'provider' ? [sourceInput.provider] : sourceInput.targets ?? [sourceInput.provider],
            locator: { type: 'file', path: 'rules/imported-provider-content.md' },
          },
          contentText: sourceInput.content === 'mcp' ? '{\n  "command": "fixture"\n}\n' : '# Imported provider content\n',
          issues: [],
          blocked: false,
        },
      };
    }
    if (operation === 'provider.source.stop-managing.preview') {
      const detachInput = input as ManagerRpcInputs['provider.source.stop-managing.preview'] | undefined;
      if (detachInput === undefined) throw new Error('Fixture stop-managing preview requires provider content.');
      return {
        revision: this.state.revision,
        changed: false,
        data: {
          version: 1,
          provider: detachInput.provider,
          content: detachInput.content,
          digest: `fixture-detach-${detachInput.provider}-${detachInput.content}`,
          status: 'ready',
          issues: [],
          targets: [{
            path: fixtureTargetPath(detachInput.provider, detachInput.content),
            content: detachInput.content,
            operation: 'rewrite',
            diff: '@@ -1,2 +1 @@\n-<!-- Generated by Reglet -->\n # Provider content',
            current: { kind: 'file', hash: 'fixture-current-hash', size: 84 },
            resulting: { kind: 'file', hash: 'fixture-detached-hash', size: 52 },
          }],
        },
      };
    }
    if (operation === 'provider.source.stop-managing') {
      const detachInput = input as ManagerRpcInputs['provider.source.stop-managing'] | undefined;
      if (detachInput === undefined) throw new Error('Fixture stop-managing requires reviewed provider content.');
      this.state = { ...this.state, revision: this.state.revision + 1 };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return {
        revision: this.state.revision,
        changed: true,
        data: {
          version: 1,
          provider: detachInput.provider,
          content: detachInput.content,
          receiptId: `fixture-detach-receipt-${detachInput.provider}-${detachInput.content}`,
          detached: [{ path: fixtureTargetPath(detachInput.provider, detachInput.content), headerRemoved: true }],
        },
      };
    }
    if (operation === 'recovery.list') {
      return {
        revision: this.state.revision,
        changed: false,
        data: this.recoveryRestored ? [
          fixtureRecoveryReceipt('fixture-recovery-undo', 'completed', true),
          fixtureRecoveryReceipt('fixture-provider-apply', 'restored', false),
        ] : [fixtureRecoveryReceipt('fixture-provider-apply', 'completed', true)],
      };
    }
    if (operation === 'recovery.preview') {
      const recoveryInput = input as ManagerRpcInputs['recovery.preview'] | undefined;
      if (recoveryInput === undefined) throw new Error('Fixture recovery preview requires a receipt.');
      return {
        revision: this.state.revision,
        changed: false,
        data: {
          version: 1,
          receipt: fixtureRecoveryReceipt(recoveryInput.receiptId, 'completed', true),
          digest: `fixture-recovery-digest-${recoveryInput.receiptId}`,
          targets: [{
            path: '~/.claude/CLAUDE.md',
            action: 'restored',
            current: { kind: 'file', hash: 'fixture-current-provider-hash', size: 124 },
            restored: { kind: 'file', hash: 'fixture-prior-provider-hash', size: 96 },
          }],
        },
      };
    }
    if (operation === 'recovery.restore') {
      const recoveryInput = input as ManagerRpcInputs['recovery.restore'] | undefined;
      if (recoveryInput === undefined) throw new Error('Fixture recovery restore requires a reviewed receipt.');
      this.recoveryRestored = true;
      this.state = { ...this.state, revision: this.state.revision + 1 };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return {
        revision: this.state.revision,
        changed: true,
        data: {
          version: 1,
          receiptId: recoveryInput.receiptId,
          undoReceiptId: 'fixture-recovery-undo',
          actions: [{ path: '~/.claude/CLAUDE.md', action: 'restored' }],
        },
      };
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
    if (operation === 'sync.snapshot') {
      const sync = this.state.settings.sync;
      const connected = sync.phase === 'active';
      const data: SyncSnapshot = {
        version: 1,
        previewAcknowledged: true,
        phase: connected ? 'connected' : sync.phase === 'pending' ? 'pending' : 'disconnected',
        serverUrl: connected ? 'https://sync.reglet.test' : null,
        serverHost: connected ? 'sync.reglet.test' : null,
        compatibility: connected ? 'compatible' : 'unknown',
        currentDeviceId: connected ? 'fixture-device-current' : null,
        currentDeviceName: connected ? 'Studio Mac' : null,
        pending: null,
        devices: connected ? this.syncDevices : [],
        conflicts: sync.conflicts,
        lastSync: sync.lastCompletedAt === undefined ? null : { completedAt: sync.lastCompletedAt, pulled: 0, pushed: 0, merged: 0, conflicts: sync.conflictCount, deleted: 0, providerReviewRequired: false },
        lastError: sync.lastError ?? null,
        keyRotationRequired: this.syncDevices.some((device) => device.status === 'revoked'),
      };
      return {
        revision: this.state.revision,
        changed: false,
        data: data as unknown as JsonValue,
      };
    }
    if (operation === 'sync.conflict.preview') {
      const conflictInput = input as ManagerRpcInputs['sync.conflict.preview'] | undefined;
      if (conflictInput === undefined) throw new Error('Fixture conflict preview requires a path.');
      const local = '# Local canonical instructions\n';
      const remote = '# Remote canonical instructions\n';
      return {
        revision: this.state.revision,
        changed: false,
        data: {
          version: 1,
          path: conflictInput.path,
          local: { state: 'text', content: local, size: new TextEncoder().encode(local).byteLength, hash: 'fixture-local-conflict-hash' },
          remote: { state: 'text', content: remote, size: new TextEncoder().encode(remote).byteLength, hash: 'fixture-remote-conflict-hash' },
        },
      };
    }
    if (operation === 'sync.resolve') {
      const resolveInput = input as ManagerRpcInputs['sync.resolve'] | undefined;
      if (resolveInput === undefined) throw new Error('Fixture conflict resolution requires a choice.');
      const conflicts = this.state.settings.sync.conflicts.filter((path) => path !== resolveInput.path);
      this.state = { ...this.state, revision: this.state.revision + 1, settings: { ...this.state.settings, sync: { ...this.state.settings.sync, state: conflicts.length === 0 ? 'idle' : 'conflict', conflictCount: conflicts.length, conflicts } } };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return { revision: this.state.revision, changed: true, data: { path: resolveInput.path, choice: resolveInput.choice, resolved: true } };
    }
    if (operation === 'sync.device.rename') {
      const renameInput = input as ManagerRpcInputs['sync.device.rename'] | undefined;
      if (renameInput === undefined) throw new Error('Fixture device rename requires a device.');
      this.syncDevices = this.syncDevices.map((device) => device.id === renameInput.deviceId ? { ...device, name: renameInput.name } : device);
      return { revision: this.state.revision, changed: true, data: { renamed: true, deviceId: renameInput.deviceId, name: renameInput.name } };
    }
    if (operation === 'sync.device.revoke') {
      const revokeInput = input as ManagerRpcInputs['sync.device.revoke'] | undefined;
      if (revokeInput === undefined) throw new Error('Fixture device revocation requires a device.');
      this.syncDevices = this.syncDevices.map((device) => device.id === revokeInput.deviceId ? { ...device, status: 'revoked', revokedAt: '2026-08-19T18:45:00.000Z' } : device);
      return { revision: this.state.revision, changed: true, data: { revoked: true, deviceId: revokeInput.deviceId } };
    }
    if (operation === 'sync.run') {
      this.state = {
        ...this.state,
        revision: this.state.revision + 1,
        settings: {
          ...this.state.settings,
          sync: {
            ...this.state.settings.sync,
            enabled: true,
            phase: 'active',
            state: 'idle',
            lastCompletedAt: '2026-08-13T12:00:00.000Z',
          },
        },
      };
      const invalidation: ManagerInvalidation = { revision: this.state.revision, reason: 'command' };
      for (const listener of this.listeners) listener(invalidation);
      return { revision: this.state.revision, changed: true, data: { pulled: [], pushed: [], merged: [], deleted: [], conflicts: [] } };
    }
    const mutating = isManagerMutatingOperation(operation);
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

function fixtureRecoveryReceipt(id: string, lifecycle: 'completed' | 'restored', restorable: boolean): JsonValue {
  return {
    id,
    lifecycle,
    startedAt: '2026-08-19T18:40:00.000Z',
    completedAt: '2026-08-19T18:40:01.000Z',
    providers: ['claude'],
    contents: ['rules'],
    targetCount: 1,
    restorable,
    ...(restorable ? {} : { reason: 'This receipt has already been restored.' }),
  };
}

function fixtureProjectionReview(units: Array<{ provider: ManagerProviderId; content: ManagerContentId }>): JsonValue {
  const review: ManagerProjectionReviewV3 = {
    version: 1,
    digest: `fixture-batch-${units.map((unit) => `${unit.provider}-${unit.content}`).join('-')}`,
    units: units.map(({ provider, content }) => {
      const operation = provider === 'codex' ? 'skip' as const : provider === 'gemini' ? 'remove' as const : 'write' as const;
      const executableBlocked = content === 'skills';
      const blocked = provider === 'opencode' || executableBlocked;
      const driftStatus = provider === 'cursor' ? 'modified' as const : operation === 'remove' ? 'unmanaged' as const : 'clean' as const;
      const targetPath = fixtureTargetPath(provider, content);
      return {
        key: `${provider}:${content}`,
        provider,
        content,
        digest: `fixture-unit-${provider}-${content}`,
        masterRevision: `fixture-master-${content}`,
        status: blocked ? 'blocked' : 'ready',
        validationIssues: executableBlocked
          ? ['Executable skill impeccable has not been approved for provider sync at revision fixture-skil.']
          : provider === 'opencode' ? ['The OpenCode target directory is not writable.'] : [],
        entries: [{
          operation,
          path: targetPath,
          diff: fixtureDiff(operation, targetPath),
          driftStatus,
          expectedTargetHash: operation === 'skip' ? 'fixture-current-hash' : 'fixture-before-hash',
          resultingTargetHash: operation === 'remove' ? null : 'fixture-after-hash',
          snapshotBehavior: operation === 'skip' ? 'none' : 'snapshot-before-write',
          backupBehavior: operation === 'skip' ? 'none' : 'backup-before-write',
          ...(operation === 'skip' ? { note: 'Provider target already matches the canonical library.' } : {}),
        }],
        artifacts: [{ id: 'artifact-general-instructions', title: 'General agent instructions', kind: content === 'rules' ? 'instruction' : content === 'skills' ? 'skill' : 'mcp' }],
        requiresDriftConfirmation: driftStatus === 'modified',
      };
    }),
  };
  return review as unknown as JsonValue;
}

function fixtureTargetPath(provider: ManagerProviderId, content: ManagerContentId): string {
  const basePaths: Record<ManagerProviderId, string> = {
    claude: '~/.claude',
    codex: '~/.codex',
    cursor: '~/.cursor',
    gemini: '~/.gemini',
    windsurf: '~/.codeium/windsurf',
    opencode: '~/.config/opencode',
  };
  const names: Record<ManagerContentId, string> = {
    rules: provider === 'claude' ? 'CLAUDE.md' : provider === 'gemini' ? 'GEMINI.md' : 'AGENTS.md',
    skills: 'skills/reglet/SKILL.md',
    mcp: 'mcp.json',
  };
  return `${basePaths[provider]}/${names[content]}`;
}

function fixtureDiff(operation: 'write' | 'remove' | 'skip', targetPath: string): string {
  if (operation === 'skip') return '';
  if (operation === 'remove') return `--- ${targetPath}\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-# Legacy provider instructions\n-Use the provider-local copy.`;
  return `--- ${targetPath}\n+++ ${targetPath}\n@@ -1,3 +1,4 @@\n # General agent instructions\n \n-- Prefer provider-local configuration.\n+- Use the canonical Reglet library.\n+- Review every provider write before applying.`;
}
