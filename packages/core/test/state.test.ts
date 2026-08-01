import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectDiscovery } from '../src/projects/discovery.js';
import { LocalState } from '../src/state/database.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
});

describe('local sqlite state', () => {
  test('migrates idempotently and stores roots, activity, trust, and FTS content', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-state-'));
    const state = await LocalState.open(currentHome);
    const root = state.addProjectRoot(path.join(currentHome, 'project'), 'Example');
    state.recordActivity({
      action: 'secret-bound',
      outcome: 'success',
      metadata: { apiKey: 'must-not-leak', count: 1 },
    });
    state.saveTrustDecision({
      artifactId: 'skill-1',
      revision: 'revision-1',
      trustedAt: '2026-07-30T00:00:00.000Z',
      executableFiles: ['run.sh'],
    });
    state.indexSearchRecord({
      id: 'artifact-1',
      source: 'canonical',
      kind: 'instruction',
      title: 'TypeScript standards',
      pathLabel: 'rules/typescript.md',
      body: 'Use strict TypeScript and avoid unsafe casts.',
    });
    const pairing = state.createPairingCredential('write', 60_000);
    const claimed = state.claimPairingCredential(pairing.code);

    expect(state.listProjectRoots()).toEqual([root]);
    expect(state.listActivity()[0]?.metadata.apiKey).toBe('[REDACTED]');
    expect(state.trustDecision('skill-1')?.revision).toBe('revision-1');
    expect(state.search('TypeScript')[0]?.id).toBe('artifact-1');
    expect(claimed?.session.scope).toBe('write');
    expect(claimed?.token).toBeDefined();
    expect(state.claimPairingCredential(pairing.code)).toBeUndefined();
    expect(state.authorizeSession(claimed?.token ?? '')?.id).toBe(
      claimed?.session.id,
    );
    expect(state.revokeRemoteSession(claimed?.session.id ?? '')).toBe(true);
    expect(state.authorizeSession(claimed?.token ?? '')).toBeUndefined();
    state.close();

    const reopened = await LocalState.open(currentHome);
    expect(reopened.listProjectRoots()).toEqual([root]);
    reopened.close();
  });

  test('preserves skill risk inventories and marks changed promoted discoveries', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-state-'));
    const state = await LocalState.open(currentHome);
    const root = state.addProjectRoot(path.join(currentHome, 'project'), 'Example');
    const discovery: ProjectDiscovery = {
      id: 'skill-discovery',
      kind: 'skill',
      absolutePath: path.join(root.path, '.agents/skills/release-check'),
      relativePath: '.agents/skills/release-check',
      sourceHash: 'revision-one',
      size: 42,
      recognizedBy: ['codex', 'gemini'],
      formatsByProvider: {
        codex: 'skill-directory',
        gemini: 'skill-directory',
      },
      scope: {
        rootLevel: true,
        hierarchical: true,
        alwaysActive: false,
        globs: [],
        manual: true,
        agentRequested: false,
        lossyFields: [],
      },
      state: 'new',
      skillRisks: [
        {
          code: 'executable',
          severity: 'warning',
          relPath: 'scripts/check.sh',
          message: 'Executable file requires explicit trust.',
        },
      ],
    };

    state.replaceDiscoveries(root.id, [discovery]);
    expect(state.markDiscoveryState(discovery.id, 'promoted')).toBe(true);
    state.replaceDiscoveries(root.id, [
      {
        ...discovery,
        sourceHash: 'revision-two',
      },
    ]);

    expect(state.listDiscoveries(root.id)).toMatchObject([
      {
        state: 'changed',
        sourceHash: 'revision-two',
        skillRisks: discovery.skillRisks,
      },
    ]);
    state.close();
  });

  test('keeps cached FTS search under the 100ms discovery budget', async () => {
    currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-state-scale-'));
    const state = await LocalState.open(currentHome);
    state.replaceSearchPrefix(
      'project:scale:',
      Array.from({ length: 10_000 }, (_, index) => ({
        id: `project:scale:${index}`,
        source: 'project' as const,
        kind: 'instruction' as const,
        title: `Project rule ${index}`,
        pathLabel: `repositories/project-${index}/AGENTS.md`,
        body:
          index % 97 === 0
            ? 'Strict TypeScript release workflow'
            : 'General project guidance',
      })),
    );
    state.search('typescript release', 50);

    const startedAt = performance.now();
    const results = state.search('typescript release', 50);
    const elapsedMs = performance.now() - startedAt;

    expect(results).toHaveLength(50);
    expect(elapsedMs).toBeLessThan(100);
    state.close();
  });
});

