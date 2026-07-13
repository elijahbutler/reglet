import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  applyAll,
  applyStructuredPreview,
  beginOperation,
  defaultConfig,
  detachManagedContent,
  getOperationReceipt,
  initMasterDir,
  listOperationReceipts,
  loadManifest,
  previewApplyStructured,
  recoverPendingOperations,
  replacePathFromDirectory,
  replacePathFromText,
  restoreOperationReceipt,
  saveConfig,
} from '../src/index.js';

let home = '';
let providerHome = '';

afterEach(async () => {
  if (home !== '') await rm(home, { recursive: true, force: true });
  if (providerHome !== '') await rm(providerHome, { recursive: true, force: true });
  home = '';
  providerHome = '';
  delete process.env.REGLET_HOME;
  delete process.env.REGLET_PROVIDER_HOME;
  delete process.env.REGLET_TEST_TOKEN;
});

async function setup(enabled: Array<'claude' | 'codex' | 'gemini'>): Promise<void> {
  home = await mkdtemp(path.join(tmpdir(), 'reglet-operations-home-'));
  providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-operations-provider-'));
  process.env.REGLET_HOME = home;
  process.env.REGLET_PROVIDER_HOME = providerHome;
  await initMasterDir(home);
  const config = defaultConfig();
  for (const provider of enabled) config.providers[provider].enabled = true;
  await saveConfig(config, home);
}

async function writeMasterRule(content = '# Rule\n'): Promise<void> {
  await writeFile(path.join(home, 'rules', '00-general.md'), content);
}

describe('operation receipts and recovery', () => {
  test('rolls back earlier file writes when a later mutation fails', async () => {
    await setup(['claude', 'gemini']);
    await writeMasterRule('# Transaction\n');
    const claudeRules = path.join(providerHome, '.claude', 'CLAUDE.md');
    const geminiRules = path.join(providerHome, '.gemini', 'GEMINI.md');
    await mkdir(path.dirname(claudeRules), { recursive: true });
    await mkdir(path.dirname(geminiRules), { recursive: true });
    await writeFile(claudeRules, 'claude before\n');
    await writeFile(geminiRules, 'gemini before\n');

    await expect(
      applyAll({
        providers: ['claude', 'gemini'],
        contents: ['rules'],
        home,
        testHooks: {
          beforeMutation(targetPath) {
            if (targetPath === geminiRules) throw new Error('injected rules failure');
          },
        },
      }),
    ).rejects.toThrow('injected rules failure');

    expect(await readFile(claudeRules, 'utf8')).toBe('claude before\n');
    expect(await readFile(geminiRules, 'utf8')).toBe('gemini before\n');
    expect((await loadManifest(home)).outputs).toEqual({});
    const fileReceipt = (await listOperationReceipts(home)).find((receipt) => receipt.lifecycle === 'rolled-back');
    expect(fileReceipt?.targets.map((target) => target.path)).toEqual([claudeRules]);
  });

  test('removes empty provider parent directories created by a failed operation', async () => {
    await setup(['claude', 'gemini']);
    await writeMasterRule('# Transaction parent cleanup\n');
    const geminiRules = path.join(providerHome, '.gemini', 'GEMINI.md');

    await expect(
      applyAll({
        providers: ['claude', 'gemini'],
        contents: ['rules'],
        home,
        testHooks: {
          beforeMutation(targetPath) {
            if (targetPath === geminiRules) throw new Error('injected parent cleanup failure');
          },
        },
      }),
    ).rejects.toThrow('injected parent cleanup failure');

    expect(await Bun.file(path.join(providerHome, '.claude')).exists()).toBe(false);
  });

  test('rolls back earlier directory writes when a later mutation fails', async () => {
    await setup(['claude', 'codex']);
    await mkdir(path.join(home, 'skills', 'review'), { recursive: true });
    await writeFile(path.join(home, 'skills', 'review', 'SKILL.md'), 'new skill\n');
    const claudeSkill = path.join(providerHome, '.claude', 'skills', 'review');
    const codexSkill = path.join(providerHome, '.agents', 'skills', 'review');
    await mkdir(claudeSkill, { recursive: true });
    await mkdir(codexSkill, { recursive: true });
    await writeFile(path.join(claudeSkill, 'SKILL.md'), 'claude skill before\n');
    await writeFile(path.join(codexSkill, 'SKILL.md'), 'codex skill before\n');

    await expect(
      applyAll({
        providers: ['claude', 'codex'],
        contents: ['skills'],
        home,
        testHooks: {
          beforeMutation(targetPath) {
            if (targetPath === codexSkill) throw new Error('injected skills failure');
          },
        },
      }),
    ).rejects.toThrow('injected skills failure');

    expect(await readFile(path.join(claudeSkill, 'SKILL.md'), 'utf8')).toBe('claude skill before\n');
    expect(await readFile(path.join(codexSkill, 'SKILL.md'), 'utf8')).toBe('codex skill before\n');
  });

  test('recovers an unfinished journal before another mutation', async () => {
    await setup(['claude']);
    await writeMasterRule('# Recovered\n');
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'before interruption\n');

    const interrupted = await beginOperation({ home, providers: ['claude'], contents: ['rules'] });
    await interrupted.snapshotTarget(outputPath);
    await replacePathFromText('partial write\n', outputPath);

    const report = await applyAll({ providers: ['claude'], contents: ['rules'], home });
    expect(report.receipt?.lifecycle).toBe('completed');
    expect(await readFile(outputPath, 'utf8')).toContain('# Recovered');
    const recovered = (await listOperationReceipts(home)).find((receipt) => receipt.id === interrupted.id);
    expect(recovered).toMatchObject({ lifecycle: 'rolled-back', recovery: { recovered: true } });
  });

  test('recovers interrupted directory replacement across file and directory target types', async () => {
    await setup(['claude']);
    const source = path.join(home, 'skills', 'replacement');
    const outputPath = path.join(providerHome, '.claude', 'skills', 'replacement');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'SKILL.md'), 'replacement directory\n');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'original file\n');

    const interrupted = await beginOperation({ home, providers: ['claude'], contents: ['skills'] });
    await interrupted.snapshotTarget(outputPath);
    await replacePathFromDirectory(source, outputPath);
    await mkdir(`${outputPath}.reglet-previous-interrupted`, { recursive: true });

    const recovered = await recoverPendingOperations(home);
    expect(recovered.recovered.map((receipt) => receipt.id)).toContain(interrupted.id);
    expect(await readFile(outputPath, 'utf8')).toBe('original file\n');
    await expect(stat(`${outputPath}.reglet-previous-interrupted`)).rejects.toThrow();
  });

  test('lists, restores, and keeps receipt metadata free of resolved secrets', async () => {
    await setup(['claude']);
    const outputPath = path.join(providerHome, '.claude.json');
    await writeFile(outputPath, '{"theme":"before"}\n');
    process.env.REGLET_TEST_TOKEN = 'receipt-secret';
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({
        mcpServers: {
          local: {
            command: 'node',
            env: { TOKEN: { source: 'process-env', name: 'REGLET_TEST_TOKEN' } },
          },
        },
      }, null, 2)}\n`,
    );

    const report = await applyAll({ providers: ['claude'], contents: ['mcp'], home });
    const receipt = report.receipt;
    expect(receipt).toBeDefined();
    expect(await getOperationReceipt(receipt?.id ?? '', home)).toMatchObject({ id: receipt?.id, lifecycle: 'completed' });

    const receiptPath = path.join(home, '.state', 'operations', 'receipts', `${receipt?.id}.json`);
    expect(await readFile(receiptPath, 'utf8')).not.toContain('receipt-secret');

    const interrupted = await beginOperation({ home, providers: ['claude'], contents: ['mcp'] });
    await interrupted.snapshotTarget(outputPath);
    await replacePathFromText('receipt-secret\n', outputPath);
    const journalPath = path.join(home, '.state', 'operations', 'journals', `${interrupted.id}.json`);
    expect(await readFile(journalPath, 'utf8')).not.toContain('receipt-secret');
    await interrupted.rollback('test cleanup');

    await writeFile(outputPath, 'manual edit\n');
    const restored = await restoreOperationReceipt(receipt?.id ?? '', home);
    expect(restored).toEqual([{ path: outputPath, action: 'restored' }]);
    expect(await readFile(outputPath, 'utf8')).toBe('{"theme":"before"}\n');
    expect((await loadManifest(home)).outputs[outputPath]).toBeUndefined();
    const restoreReceipt = (await listOperationReceipts(home)).find(
      (candidate) => candidate.id !== receipt?.id && candidate.targets.some((target) => target.path === outputPath),
    );
    expect(restoreReceipt?.lifecycle).toBe('completed');

    if (process.platform !== 'win32') {
      expect((await stat(path.join(home, '.state'))).mode & 0o777).toBe(0o700);
      expect((await stat(path.join(home, '.state', 'manifest.json'))).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(home, '.state', 'operations', 'receipts'))).mode & 0o777).toBe(0o700);
      expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);
      await chmod(path.join(home, '.state', 'manifest.json'), 0o644);
      await expect(loadManifest(home)).rejects.toThrow('insecure private state permissions');
    }
  });

  test('requires a reviewed structured plan to replace managed drift', async () => {
    await setup(['claude']);
    await writeMasterRule('# Reviewed\n');
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await applyAll({ providers: ['claude'], contents: ['rules'], home });
    await writeFile(outputPath, 'provider edit\n');

    await expect(applyAll({ providers: ['claude'], contents: ['rules'], home })).rejects.toThrow('unreviewed provider drift');

    const preview = await previewApplyStructured({ providers: ['claude'], contents: ['rules'], home });
    const result = await applyStructuredPreview(preview.digest, { providers: ['claude'], contents: ['rules'], home });
    expect(result.receipt.structuredPreviewDigest).toBe(preview.digest);
    expect(await readFile(outputPath, 'utf8')).toContain('# Reviewed');
  });

  test('detaches ownership without deleting provider content and strips generated rules headers', async () => {
    await setup(['claude']);
    await writeMasterRule('# Keep this rule\n');
    const outputPath = path.join(providerHome, '.claude', 'CLAUDE.md');
    await applyAll({ providers: ['claude'], contents: ['rules'], home });

    const detached = await detachManagedContent('claude', 'rules', home);
    expect(detached.receipt.lifecycle).toBe('completed');
    expect(detached.detached).toEqual([{ outputPath, content: 'rules', headerRemoved: true }]);
    expect(await readFile(outputPath, 'utf8')).toBe('<!-- source: rules/00-general.md -->\n\n# Keep this rule\n');
    expect((await loadManifest(home)).outputs[outputPath]).toBeUndefined();
  });
});
