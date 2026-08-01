import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import { defaultConfig, saveConfig } from '@reglet/core';

let currentHome: string | undefined;
let providerRoot: string | undefined;

afterEach(async () => {
  for (const target of [currentHome, providerRoot]) {
    if (target !== undefined) {
      await rm(target, { recursive: true, force: true });
    }
  }
  currentHome = undefined;
  providerRoot = undefined;
});

describe('reglet CLI', () => {
  test('supports headless artifact lifecycle with JSON output', async () => {
    await useHomes();
    expect((await runCli(['init', '--json'])).exitCode).toBe(0);
    const created = await runCli([
      'create',
      'instruction',
      '--slug',
      'shared',
      '--json',
    ]);
    expect(created.exitCode).toBe(0);
    expect(JSON.parse(created.stdout) as unknown).toMatchObject({
      data: { slug: 'shared', targets: [] },
    });
    expect((await runCli(['archive', 'shared', '--json'])).exitCode).toBe(0);
    const archived = await runCli(['list', 'instructions', '--archived', '--json']);
    expect(archived.stdout).toContain('"lifecycle": "archived"');
    expect((await runCli(['delete', 'shared', '--json'])).exitCode).toBe(3);
    expect((await runCli(['delete', 'shared', '--yes', '--json'])).exitCode).toBe(0);
  });

  test('returns exit code 2 when provider drift is present', async () => {
    await useHomes();
    await runCli(['init', '--json']);
    const config = defaultConfig();
    config.providers.claude.enabled = true;
    await saveConfig(config, currentHome);
    await runCli([
      'create',
      'instruction',
      '--slug',
      'shared',
      '--targets',
      'claude',
      '--json',
    ]);
    expect(
      (await runCli(['apply', '--provider', 'claude', '--content', 'rules', '--json']))
        .exitCode,
    ).toBe(0);
    const outputPath = path.join(providerRoot!, '.claude', 'CLAUDE.md');
    expect(await readFile(outputPath, 'utf8')).toContain('# Shared');
    await writeFile(outputPath, 'external drift\n');

    expect((await runCli(['status', '--json'])).exitCode).toBe(2);
  });
});

async function useHomes(): Promise<void> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-test-'));
  providerRoot = await mkdtemp(path.join(tmpdir(), 'reglet-cli-provider-test-'));
}

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (currentHome === undefined || providerRoot === undefined) {
    throw new Error('Test homes are not initialized.');
  }
  const processHandle = Bun.spawn(
    [
      process.execPath,
      path.join(import.meta.dir, '..', 'src', 'index.ts'),
      ...args,
    ],
    {
      env: {
        ...process.env,
        REGLET_HOME: currentHome,
        REGLET_PROVIDER_HOME: providerRoot,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  return { exitCode, stdout, stderr };
}

