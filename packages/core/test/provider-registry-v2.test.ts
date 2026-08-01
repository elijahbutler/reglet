import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { allAdapters } from '../src/providers/registry.js';
import { codexConfiguredProjectDiscoveries } from '../src/providers/codex.js';

let providerHome: string | undefined;
const originalProviderHome = process.env.REGLET_PROVIDER_HOME;

afterEach(async () => {
  if (providerHome !== undefined) await rm(providerHome, { recursive: true, force: true });
  providerHome = undefined;
  if (originalProviderHome === undefined) delete process.env.REGLET_PROVIDER_HOME;
  else process.env.REGLET_PROVIDER_HOME = originalProviderHome;
});

describe('provider registry metadata', () => {
  test('keeps discovery knowledge in adapters and exposes uncertain capabilities', () => {
    const adapters = allAdapters();
    expect(adapters).toHaveLength(6);
    for (const adapter of adapters) {
      expect(adapter.documentationUrl).toMatch(/^https:\/\//);
      expect(adapter.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(adapter.schemaVersion).toBeGreaterThanOrEqual(2);
      expect(adapter.discoveries.length).toBeGreaterThan(0);
      expect(adapter.compatibilityFixtures.length).toBeGreaterThan(0);
    }
    expect(adapters.flatMap((adapter) => adapter.discoveries).some((declaration) => !declaration.supported && declaration.issue !== undefined)).toBe(true);
  });

  test('recognizes one project AGENTS file through every declaring provider', () => {
    const recognizedBy = allAdapters()
      .filter((adapter) => adapter.discoveries.some((declaration) =>
        declaration.scope === 'project' && declaration.pattern === 'AGENTS.md',
      ))
      .map((adapter) => adapter.id);
    expect(recognizedBy).toEqual(['codex', 'cursor', 'windsurf', 'opencode']);
  });

  test('loads safe configured Codex fallback names without accepting paths', async () => {
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-provider-metadata-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await mkdir(path.join(providerHome, '.codex'), { recursive: true });
    await writeFile(
      path.join(providerHome, '.codex', 'config.toml'),
      'project_doc_fallback_filenames = ["TEAM.md", "../escape.md", "AGENTS.md"]\n',
    );
    expect(await codexConfiguredProjectDiscoveries()).toEqual([
      expect.objectContaining({ pattern: 'TEAM.md', hierarchical: true, supported: true }),
    ]);
  });
});
