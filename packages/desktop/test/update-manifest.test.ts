import { describe, expect, test } from 'bun:test';
import {
  isNewerVersion,
  parseGitHubRelease,
} from '../src/update-manifest.js';

describe('desktop update metadata', () => {
  test('accepts release metadata without exposing unrelated response fields', () => {
    expect(
      parseGitHubRelease({
        tag_name: 'v1.2.3',
        body: 'Security and compatibility fixes.',
        token: 'must-not-leak',
      }),
    ).toEqual({
      version: '1.2.3',
      releaseNotes: 'Security and compatibility fixes.',
    });
    expect(parseGitHubRelease({ tag_name: 'latest' })).toBeUndefined();
  });

  test('compares stable numeric versions', () => {
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.1.9', '1.2.0')).toBe(false);
  });
});
