import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { createUpdaterManifest } from './generate-tauri-updater-manifest.js';

const files = [
  'reglet-desktop-macos-arm64.app.tar.gz',
  'reglet-desktop-macos-x86_64.app.tar.gz',
  'reglet-desktop-windows-x64-setup.exe',
  'reglet-desktop-linux-x86_64.AppImage',
] as const;

describe('Tauri updater manifest', () => {
  test('maps every supported desktop target to its signed release artifact', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reglet-updater-'));
    try {
      await Promise.all(files.flatMap((file) => [
        writeFile(join(directory, file), 'artifact'),
        writeFile(join(directory, `${file}.sig`), `signature-${file}`),
      ]));
      const manifest = await createUpdaterManifest({
        directory,
        repository: 'elijahbutler/reglet',
        version: '1.2.3',
      });
      expect(Object.keys(manifest.platforms)).toEqual(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64', 'linux-x86_64']);
      expect(manifest.platforms['windows-x86_64']).toEqual({
        signature: 'signature-reglet-desktop-windows-x64-setup.exe',
        url: 'https://github.com/elijahbutler/reglet/releases/download/v1.2.3/reglet-desktop-windows-x64-setup.exe',
      });
      expect(manifest.platforms['linux-x86_64']).toEqual({
        signature: 'signature-reglet-desktop-linux-x86_64.AppImage',
        url: 'https://github.com/elijahbutler/reglet/releases/download/v1.2.3/reglet-desktop-linux-x86_64.AppImage',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('refuses a manifest when a signed platform artifact is absent', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reglet-updater-'));
    try {
      await expect(createUpdaterManifest({ directory, repository: 'elijahbutler/reglet', version: '1.2.3' })).rejects.toThrow('Missing updater artifact');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
