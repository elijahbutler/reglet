import { describe, expect, test } from 'bun:test';
import type { LibraryArtifactMetadata } from '@reglet/core';
import {
  RegletRuntimeClient,
  RuntimeClientError,
} from '../src/runtime-client.js';

describe('RegletRuntimeClient', () => {
  test('carries the observed revision into optimistic mutations', async () => {
    const requests: Array<{ authorization: string | null; body: unknown }> = [];
    let revision = 4;
    const fetcher: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : undefined;
      requests.push({
        authorization: headers.get('Authorization'),
        body,
      });
      const commandType =
        typeof body === 'object' &&
        body !== null &&
        'type' in body &&
        typeof body.type === 'string'
          ? body.type
          : '';
      if (commandType === 'library.save') {
        revision += 1;
      }
      return Response.json({
        revision,
        changed: commandType === 'library.save',
        data:
          commandType === 'library.list'
            ? [artifactFixture()]
            : { status: 'saved' },
      });
    };
    const client = new RegletRuntimeClient({
      baseUrl: 'http://127.0.0.1:4765/',
      token: 'session-token',
      fetch: fetcher,
    });

    const artifacts = await client.listLibrary();
    await client.saveArtifact('general', '# Updated');

    expect(artifacts).toHaveLength(1);
    expect(requests[0]?.authorization).toBe('Bearer session-token');
    expect(requests[1]?.body).toEqual({
      type: 'library.save',
      artifact: 'general',
      content: '# Updated',
      expectedRevision: 4,
    });
    expect(client.revision()).toBe(5);
  });

  test('returns structured runtime errors without leaking arbitrary payloads', async () => {
    const fetcher: typeof fetch = async () =>
      Response.json(
        {
          error: {
            code: 'revision-conflict',
            message: 'Revision conflict: expected 2, observed 3.',
          },
          secret: 'must-not-appear',
        },
        { status: 409 },
      );
    const client = new RegletRuntimeClient({
      baseUrl: 'http://127.0.0.1:4765',
      token: 'session-token',
      fetch: fetcher,
    });

    const error = await client.listLibrary().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RuntimeClientError);
    expect(error).toMatchObject({
      status: 409,
      code: 'revision-conflict',
      message: 'Revision conflict: expected 2, observed 3.',
    });
    expect(String(error)).not.toContain('must-not-appear');
  });
});

function artifactFixture(): LibraryArtifactMetadata {
  return {
    id: 'artifact-general',
    kind: 'instruction',
    lifecycle: 'active',
    slug: 'general',
    title: 'General',
    tags: [],
    targets: [],
    locator: { type: 'file', path: 'rules/general.md' },
  };
}
