import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  defaultConfig,
  deriveMasterRevisions,
  initMasterDir,
  loadConfig,
  loadMasterDir,
  previewApplyStructured,
  saveConfig,
} from '../src/index.js';
import { PROVIDER_RULES_MARKER } from '../src/master.js';

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

async function setup(): Promise<void> {
  home = await mkdtemp(path.join(tmpdir(), 'reglet-revisions-home-'));
  providerHome = await mkdtemp(path.join(tmpdir(), 'reglet-revisions-provider-'));
  process.env.REGLET_HOME = home;
  process.env.REGLET_PROVIDER_HOME = providerHome;
  await initMasterDir(home);
}

describe('master and composition revisions', () => {
  test('document reordering, content, scope, enrollment, and MCP environment changes invalidate revisions', async () => {
    await setup();
    await writeFile(path.join(home, 'rules', '00-general.md'), 'first\n');
    await writeFile(path.join(home, 'rules', '10-extra.md'), 'second\n');
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { local: { command: 'node', env: { TOKEN: { source: 'process-env', name: 'REGLET_TEST_TOKEN' } } } } }, null, 2)}\n`,
    );
    process.env.REGLET_TEST_TOKEN = 'one';
    const config = await loadConfig(home);
    const base = await deriveMasterRevisions(await loadMasterDir(home), config);

    await writeFile(path.join(home, 'rules', '00-general.md'), 'second\n');
    await writeFile(path.join(home, 'rules', '10-extra.md'), 'first\n');
    const reordered = await deriveMasterRevisions(await loadMasterDir(home), config);
    expect(reordered.masterRevision).not.toBe(base.masterRevision);
    expect(reordered.compositionRevisions.claude.rules).not.toBe(base.compositionRevisions.claude.rules);

    await writeFile(path.join(home, 'rules', '00-general.md'), 'first\nchanged\n');
    await writeFile(path.join(home, 'rules', '10-extra.md'), 'second\n');
    const edited = await deriveMasterRevisions(await loadMasterDir(home), config);
    expect(edited.masterRevision).not.toBe(base.masterRevision);

    await mkdir(path.join(home, 'rules', 'claude'), { recursive: true });
    await writeFile(path.join(home, 'rules', 'claude', PROVIDER_RULES_MARKER), '');
    await writeFile(path.join(home, 'rules', 'claude', 'overlay.md'), 'claude only\n');
    const scoped = await deriveMasterRevisions(await loadMasterDir(home), config);
    expect(scoped.compositionRevisions.claude.rules).not.toBe(edited.compositionRevisions.claude.rules);
    expect(scoped.compositionRevisions.codex.rules).toBe(edited.compositionRevisions.codex.rules);

    config.providers.claude.enabled = true;
    await saveConfig(config, home);
    const enrolled = await deriveMasterRevisions(await loadMasterDir(home), await loadConfig(home));
    expect(enrolled.masterRevision).not.toBe(scoped.masterRevision);

    config.providers.claude.skills = !config.providers.claude.skills;
    const skillsEnrollmentChanged = await deriveMasterRevisions(await loadMasterDir(home), config);
    expect(skillsEnrollmentChanged.compositionRevisions.claude.skills).not.toBe(enrolled.compositionRevisions.claude.skills);
    expect(skillsEnrollmentChanged.compositionRevisions.claude.rules).toBe(enrolled.compositionRevisions.claude.rules);

    process.env.REGLET_TEST_TOKEN = 'two';
    const envChanged = await deriveMasterRevisions(await loadMasterDir(home), config);
    expect(envChanged.masterRevision).toBe(skillsEnrollmentChanged.masterRevision);
    expect(envChanged.compositionRevisions.claude.mcp).not.toBe(skillsEnrollmentChanged.compositionRevisions.claude.mcp);
  });

  test('structured preview digest includes MCP environment fingerprint without resolved values', async () => {
    await setup();
    const config = defaultConfig();
    config.providers.claude.enabled = true;
    await saveConfig(config, home);
    await writeFile(
      path.join(home, 'mcp', 'servers.json'),
      `${JSON.stringify({ mcpServers: { local: { command: 'node', env: { TOKEN: { source: 'process-env', name: 'REGLET_TEST_TOKEN' } } } } }, null, 2)}\n`,
    );

    process.env.REGLET_TEST_TOKEN = 'secret-one';
    const first = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home });
    process.env.REGLET_TEST_TOKEN = 'secret-two';
    const second = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home });

    expect(second.digest).not.toBe(first.digest);
    expect(JSON.stringify(second)).not.toContain('secret-two');
    expect(second.entries[0]?.compositionRevision).not.toBe(first.entries[0]?.compositionRevision);
  });

  test('provider-scoped MCP edits invalidate only the matching provider composition', async () => {
    await setup();
    const config = await loadConfig(home);
    const before = await deriveMasterRevisions(await loadMasterDir(home), config);
    await mkdir(path.join(home, 'mcp', 'providers', 'claude'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'providers', 'claude', 'servers.json'),
      '{"mcpServers":{"local":{"command":"node"}}}\n',
    );
    const after = await deriveMasterRevisions(await loadMasterDir(home), config);

    expect(after.compositionRevisions.claude.mcp).not.toBe(before.compositionRevisions.claude.mcp);
    expect(after.compositionRevisions.codex.mcp).toBe(before.compositionRevisions.codex.mcp);
  });

  test('unrelated provider-scoped MCP edits do not stale a selected provider preview', async () => {
    await setup();
    const config = await loadConfig(home);
    config.providers.claude.enabled = true;
    config.providers.claude.mcp = true;
    await saveConfig(config, home);
    const before = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home });
    await mkdir(path.join(home, 'mcp', 'providers', 'codex'), { recursive: true });
    await writeFile(
      path.join(home, 'mcp', 'providers', 'codex', 'servers.json'),
      '{"mcpServers":{"codex-only":{"command":"node"}}}\n',
    );
    const after = await previewApplyStructured({ providers: ['claude'], contents: ['mcp'], home });

    expect(after.masterRevision).not.toBe(before.masterRevision);
    expect(after.entries[0]?.compositionRevision).toBe(before.entries[0]?.compositionRevision);
    expect(after.digest).toBe(before.digest);
  });
});
