import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  createSkill, deleteMcpServer, listManagedSkillTrees, listMcpServers, readSkillFile,
  applyStructuredPreview, initMasterDir, loadConfig, previewApplyStructured, renameSkill, renameSkillFile, saveConfig,
  serializeMcpServers, upsertMcpServer, validateMcpServer, writeSkillFile,
} from '../src/index.js';

let home = '';
let providerHome = '';
afterEach(async () => {
  if (home !== '') await rm(home, { recursive: true, force: true });
  if (providerHome !== '') await rm(providerHome, { recursive: true, force: true });
  home = ''; providerHome = ''; delete process.env.REGLET_PROVIDER_HOME;
});
async function setup(): Promise<string> { home = await mkdtemp(path.join(tmpdir(), 'reglet-native-edit-')); return home; }

describe('native skill editing', () => {
  test('round trips shared files and preserves provider scope on rename', async () => {
    const root = await setup();
    await createSkill({ kind: 'shared' }, 'review', '---\nname: review\n---\n# Review\n', root);
    await writeSkillFile({ kind: 'shared' }, 'review', 'assets/note.txt', 'hello', root);
    await renameSkillFile({ kind: 'shared' }, 'review', 'assets/note.txt', 'references/note.txt', root);
    expect((await readSkillFile({ kind: 'shared' }, 'review', 'references/note.txt', root)).content).toBe('hello');
    expect((await listManagedSkillTrees(root))[0]?.files.map((file) => file.path)).toEqual(['references/note.txt', 'SKILL.md']);
    await renameSkill({ kind: 'shared' }, 'review', 'review-v2', root);
    expect((await listManagedSkillTrees(root))[0]?.name).toBe('review-v2');
  });

  test('rejects traversal, provider collisions, malformed frontmatter, and symlinks', async () => {
    const root = await setup();
    await createSkill({ kind: 'shared' }, 'review', '# Review\n', root);
    await expect(writeSkillFile({ kind: 'shared' }, 'review', '../outside', 'bad', root)).rejects.toThrow('Traversal');
    await expect(createSkill({ kind: 'shared' }, 'claude', '# Bad\n', root)).rejects.toThrow('provider namespace');
    await expect(writeSkillFile({ kind: 'shared' }, 'review', 'SKILL.md', '---\nname: bad', root)).rejects.toThrow('frontmatter');
    await writeFile(path.join(root, 'outside'), 'secret');
    await symlink(path.join(root, 'outside'), path.join(root, 'skills', 'review', 'linked'));
    await expect(readSkillFile({ kind: 'shared' }, 'review', 'linked', root)).rejects.toThrow('Symlink');
  });
});

describe('native MCP editing', () => {
  test('validates transports and writes deterministic definitions', async () => {
    const root = await setup();
    expect(validateMcpServer('bad', { command: 'node', url: 'https://example.test' }).ok).toBe(false);
    expect(validateMcpServer('remote', { url: 'file:///tmp/socket' }).ok).toBe(false);
    await upsertMcpServer('zeta', { url: 'https://example.test' }, root);
    await upsertMcpServer('alpha', { command: 'node', env: { Z: 'secret', A: 'value' } }, root);
    expect((await listMcpServers(root)).servers.map((entry) => entry.name)).toEqual(['alpha', 'zeta']);
    expect(await readFile(path.join(root, 'mcp', 'servers.json'), 'utf8')).toBe(serializeMcpServers({
      alpha: { command: 'node', env: { A: 'value', Z: 'secret' } }, zeta: { url: 'https://example.test' },
    }));
    await deleteMcpServer('alpha', root);
    expect((await listMcpServers(root)).servers.map((entry) => entry.name)).toEqual(['zeta']);
  });

  test('renders exact redacted provider output and rejects a stale digest', async () => {
    const root = await setup();
    providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-native-provider-'));
    process.env.REGLET_PROVIDER_HOME = providerHome;
    await initMasterDir(root);
    const config = await loadConfig(root);
    config.providers.claude.enabled = true;
    config.providers.claude.mcp = true;
    await saveConfig(config, root);
    await upsertMcpServer('managed', { command: 'node', env: { TOKEN: 'super-secret' } }, root);
    const output = path.join(providerHome, '.claude.json');
    await writeFile(output, '{"theme":"dark","mcpServers":{"local":{"command":"ruby"}}}\n');

    const preview = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home: root });
    expect(preview.entries[0]?.diff).toContain('"theme": "dark"');
    expect(preview.entries[0]?.diff).toContain('<redacted:TOKEN>');
    expect(preview.entries[0]?.diff).not.toContain('super-secret');

    await writeFile(output, '{"theme":"light","mcpServers":{}}\n');
    await expect(applyStructuredPreview(preview.digest, { providers: ['claude'], contents: ['mcp'], home: root }))
      .rejects.toThrow('stale');
  });
});
