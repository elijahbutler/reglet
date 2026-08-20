import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTauriUpdaterBuildConfig } from './generate-tauri-updater-config.js';

interface BaseTauriConfig {
  plugins?: {
    updater?: {
      endpoints?: unknown;
      pubkey?: unknown;
    };
  };
}

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

  test('keeps unsigned desktop builds bootable with a disabled updater configuration', async () => {
    const config = (await Bun.file(
      join(import.meta.dir, '../apps/desktop/src-tauri/tauri.conf.json'),
    ).json()) as BaseTauriConfig;

    expect(config.plugins?.updater).toEqual({
      endpoints: [],
      pubkey: '',
    });
  });
});
