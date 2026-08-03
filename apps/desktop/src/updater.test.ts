import { describe, expect, test } from 'vitest';
import { parseUpdateDownloadEvent, parseUpdateStatus } from './updater.js';

describe('desktop update response', () => {
  test('accepts each strict native updater state', () => {
    expect(parseUpdateStatus({
      status: 'available',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      notes: 'A safer desktop update.',
    })).toEqual({ status: 'available', currentVersion: '1.0.0', latestVersion: '1.1.0', notes: 'A safer desktop update.' });
    expect(parseUpdateStatus({ status: 'current', currentVersion: '1.1.0' })).toEqual({ status: 'current', currentVersion: '1.1.0' });
    expect(parseUpdateStatus({ status: 'disabled', currentVersion: '1.1.0', reason: 'Local build' })).toEqual({ status: 'disabled', currentVersion: '1.1.0', reason: 'Local build' });
  });

  test('rejects extra or incomplete update fields', () => {
    expect(() => parseUpdateStatus({
      status: 'available', currentVersion: '1.0.0', latestVersion: '1.1.0', notes: null, downloadUrl: 'https://example.com',
    })).toThrow('invalid response');
    expect(() => parseUpdateStatus({
      status: 'available', currentVersion: '1.0.0', latestVersion: '1.1.0',
    })).toThrow('invalid response');
  });

  test('parses bounded download progress events', () => {
    expect(parseUpdateDownloadEvent({ event: 'started', contentLength: 4096 })).toEqual({ event: 'started', contentLength: 4096 });
    expect(parseUpdateDownloadEvent({ event: 'progress', chunkLength: 1024 })).toEqual({ event: 'progress', chunkLength: 1024 });
    expect(parseUpdateDownloadEvent({ event: 'finished' })).toEqual({ event: 'finished' });
    expect(() => parseUpdateDownloadEvent({ event: 'progress', chunkLength: -1 })).toThrow('invalid progress event');
  });
});
