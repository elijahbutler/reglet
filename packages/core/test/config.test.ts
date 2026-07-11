import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
});

async function useTempHome(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-core-config-'));
  process.env.REGLET_HOME = currentHome;
  process.env.REGLET_PROVIDER_HOME = currentHome;
  return currentHome;
}

describe('config', () => {
  test('missing reglet.toml loads defaults', async () => {
    const home = await useTempHome();

    expect(await loadConfig(home)).toEqual(defaultConfig());
  });

  test('round-trips reglet.toml', async () => {
    const home = await useTempHome();
    const config = defaultConfig();
    config.providers.claude.enabled = true;
    config.providers.claude.mcp = false;
    config.sync.server_url = 'https://example.test';

    await saveConfig(config, home);

    expect(await loadConfig(home)).toEqual(config);
  });
});
