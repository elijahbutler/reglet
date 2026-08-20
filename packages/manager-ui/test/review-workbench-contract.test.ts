import { describe, expect, test } from 'bun:test';
import { isManagerProjectionReviewV3 } from '@reglet/manager-protocol';
import { FixtureManagerClient } from '../src/testing/FixtureManagerClient.js';

describe('Review and Apply workbench contract', () => {
  test('reviews an exact multi-provider batch and applies only selected ready units', async () => {
    const client = new FixtureManagerClient();
    const response = await client.command('provider.review', {
      units: [
        { provider: 'claude', content: 'rules' },
        { provider: 'cursor', content: 'rules' },
        { provider: 'opencode', content: 'rules' },
      ],
    });

    expect(isManagerProjectionReviewV3(response.data)).toBe(true);
    if (!isManagerProjectionReviewV3(response.data)) throw new Error('Fixture review is invalid.');
    expect(response.data.units.map((unit) => unit.key)).toEqual([
      'claude:rules',
      'cursor:rules',
      'opencode:rules',
    ]);
    expect(response.data.units.find((unit) => unit.key === 'cursor:rules')?.requiresDriftConfirmation).toBe(true);
    expect(response.data.units.find((unit) => unit.key === 'opencode:rules')?.status).toBe('blocked');

    const selected = response.data.units.filter((unit) => unit.status === 'ready');
    const refreshed = await client.command('provider.review', {
      units: selected.map(({ provider, content }) => ({ provider, content })),
    });
    if (!isManagerProjectionReviewV3(refreshed.data)) throw new Error('Refreshed fixture review is invalid.');
    const applied = await client.command('provider.apply', {
      batchDigest: refreshed.data.digest,
      units: refreshed.data.units.map(({ provider, content, digest }) => ({ provider, content, digest })),
      confirmDrift: true,
    });

    expect(applied.data).toMatchObject({
      version: 1,
      summary: { applied: 2, blocked: 0, failed: 0 },
    });
    expect(applied.revision).toBe(response.revision + 1);
  });
});

describe('Fixture Manager client contract', () => {
  test('advances revisions and invalidates device mutations', async () => {
    const client = new FixtureManagerClient();
    const initialRevision = (await client.snapshot()).revision;
    const invalidations: number[] = [];
    const unsubscribe = client.subscribe((invalidation) => invalidations.push(invalidation.revision));

    const renamed = await client.command('sync.device.rename', {
      deviceId: 'fixture-device-mobile',
      name: 'Travel laptop',
    });
    const revoked = await client.command('sync.device.revoke', { deviceId: 'fixture-device-mobile' });

    expect(renamed.revision).toBe(initialRevision + 1);
    expect(revoked.revision).toBe(initialRevision + 2);
    expect(invalidations).toEqual([initialRevision + 1, initialRevision + 2]);
    unsubscribe();
  });
});
