import { describe, expect, test } from 'vitest';
import { validRegletConnectLink } from './deepLinks.js';

describe('Reglet connection deep links', () => {
  test('accepts a bounded app link with an HTTPS server and connection kind', () => {
    const link = 'reglet://connect#grant=abcdefghijklmnopqrstuvwxyz&server=https%3A%2F%2Fsync.example&kind=pair';
    expect(validRegletConnectLink(link)).toBe(link);
  });

  test('rejects unsafe servers, missing grants, and unexpected fragment data', () => {
    expect(validRegletConnectLink('reglet://connect#server=https%3A%2F%2Fsync.example')).toBeNull();
    expect(validRegletConnectLink('reglet://connect#grant=abcdefghijklmnopqrstuvwxyz&server=http%3A%2F%2Fsync.example')).toBeNull();
    expect(validRegletConnectLink('reglet://connect#grant=abcdefghijklmnopqrstuvwxyz&server=https%3A%2F%2Fsync.example&redirect=https%3A%2F%2Fevil.example')).toBeNull();
  });
});
