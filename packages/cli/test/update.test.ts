import { describe, expect, test } from 'bun:test';
import { binaryName, detectPlatform, resolveCurrentBinaryPath } from '../src/update.js';

describe('reglet update', () => {
  test('detects platform correctly or returns null for unsupported', () => {
    const platform = detectPlatform();
    if (process.platform === 'linux' && process.arch === 'x64') {
      expect(platform).toBe('linux-x64');
    } else if (process.platform === 'darwin' && process.arch === 'arm64') {
      expect(platform).toBe('darwin-arm64');
    } else if (process.platform === 'darwin' && process.arch === 'x64') {
      expect(platform).toBe('darwin-x64');
    } else if (process.platform === 'linux' && process.arch === 'arm64') {
      expect(platform).toBe('linux-arm64');
    }
  });

  test('constructs binary name from platform', () => {
    expect(binaryName('darwin-arm64')).toBe('reglet-darwin-arm64');
    expect(binaryName('darwin-x64')).toBe('reglet-darwin-x64');
    expect(binaryName('linux-x64')).toBe('reglet-linux-x64');
    expect(binaryName('linux-arm64')).toBe('reglet-linux-arm64');
  });

  test('resolves current binary path', () => {
    const binaryPath = resolveCurrentBinaryPath();
    expect(typeof binaryPath).toBe('string');
    expect(binaryPath.length).toBeGreaterThan(0);
  });
});
