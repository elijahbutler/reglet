import { describe, expect, test } from 'bun:test';
import { createTauriUpdaterBuildConfig } from './generate-tauri-updater-config.js';

describe('Tauri updater build configuration', () => {
  test('declares the updater plugin with the release endpoint and exact public key', () => {
    const config = createTauriUpdaterBuildConfig('  untrusted comment: minisign public key\nRWQexample  \n');
    expect(config).toEqual({
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          endpoints: ['https://github.com/elijahbutler/reglet/releases/latest/download/latest.json'],
          pubkey: 'untrusted comment: minisign public key\nRWQexample',
        },
      },
    });
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  test('refuses to build updater configuration without a public key', () => {
    expect(() => createTauriUpdaterBuildConfig(' \n ')).toThrow('REGLET_UPDATER_PUBLIC_KEY is required');
  });
});
