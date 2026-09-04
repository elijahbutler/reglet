import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test } from 'bun:test';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve(import.meta.dir, '..', 'src', 'index.ts');

let currentHome: string | undefined;

afterEach(async () => {
  if (currentHome !== undefined) {
    await rm(currentHome, { recursive: true, force: true });
    currentHome = undefined;
  }
});

async function useTempHome(): Promise<string> {
  currentHome = await mkdtemp(path.join(tmpdir(), 'reglet-cli-secret-home-'));
  return currentHome;
}

async function runCli(
  args: string[],
  home: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync('bun', [cliPath, ...args], {
      env: {
        ...process.env,
        REGLET_HOME: home,
        ...extraEnv,
      },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.code ?? 1,
    };
  }
}

describe('CLI secret command suite', () => {
  test('sets, inspects, lists, and deletes a vaulted secret', async () => {
    const home = await useTempHome();

    // 1. Initially empty list
    const listEmpty = await runCli(['secret', 'list', '--json'], home);
    expect(listEmpty.exitCode).toBe(0);
    const emptyJson = JSON.parse(listEmpty.stdout);
    expect(emptyJson.secrets).toEqual([]);

    // 2. Set secret (vaulted)
    const setRes = await runCli(['secret', 'set', 'MY_API_KEY', 'super-secret-token-12345', '--json'], home);
    expect(setRes.exitCode).toBe(0);
    const setJson = JSON.parse(setRes.stdout);
    expect(setJson).toEqual({ id: 'MY_API_KEY', storage: 'vault+keychain', bound: true });

    // 3. List secrets
    const listRes = await runCli(['secret', 'list', '--json'], home);
    expect(listRes.exitCode).toBe(0);
    const listJson = JSON.parse(listRes.stdout);
    expect(listJson.secrets.length).toBe(1);
    expect(listJson.secrets[0].id).toBe('MY_API_KEY');
    expect(listJson.secrets[0].storage).toBe('vault+keychain');
    expect(listJson.secrets[0].bound).toBe(true);

    // 4. Status without reveal does not leak value
    const statusRes = await runCli(['secret', 'status', 'MY_API_KEY', '--json'], home);
    expect(statusRes.exitCode).toBe(0);
    const statusJson = JSON.parse(statusRes.stdout);
    expect(statusJson.bound).toBe(true);
    expect(statusJson.storage).toBe('vault+keychain');
    expect(statusJson.value).toBeUndefined();

    // 5. Status with reveal returns value in JSON
    const revealRes = await runCli(['secret', 'status', 'MY_API_KEY', '--reveal', '--json'], home);
    expect(revealRes.exitCode).toBe(0);
    const revealJson = JSON.parse(revealRes.stdout);
    expect(revealJson.value).toBe('super-secret-token-12345');

    // 6. Delete secret
    const delRes = await runCli(['secret', 'delete', 'MY_API_KEY', '-y', '--json'], home);
    expect(delRes.exitCode).toBe(0);
    const delJson = JSON.parse(delRes.stdout);
    expect(delJson.deleted).toBe(true);

    // 7. Verify empty after deletion
    const listAfter = await runCli(['secret', 'list', '--json'], home);
    const afterJson = JSON.parse(listAfter.stdout);
    expect(afterJson.secrets).toEqual([]);
  });

  test('sets a local-only secret', async () => {
    const home = await useTempHome();

    const setRes = await runCli(['secret', 'set', 'LOCAL_TOKEN', 'local-secret-val', '--local-only', '--json'], home);
    expect(setRes.exitCode).toBe(0);
    const setJson = JSON.parse(setRes.stdout);
    expect(setJson).toEqual({ id: 'LOCAL_TOKEN', storage: 'keychain', bound: true });
  });
});
