import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { getOutput, loadManifest } from '../manifest.js';
import { loadMasterDir, type McpServerDef } from '../master.js';
import { listMcpServers } from '../mcp.js';
import { providerHome, regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ProviderAdapter, ProviderId } from '../providers/types.js';
import { sha256String } from '../fsutil.js';
import { applyAll, type ApplyContent } from './apply.js';

export interface StructuredApplyPreviewOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  home?: string;
}

export interface StructuredApplyPreview {
  version: 1;
  digest: string;
  validationIssues: string[];
  entries: StructuredApplyPreviewEntry[];
}

export interface StructuredApplyPreviewEntry {
  provider: ProviderId;
  content: ApplyContent;
  operation: 'write' | 'remove' | 'skip';
  path: string;
  before: unknown;
  after: unknown;
  diff: string;
  backup: {
    behavior: 'none' | 'existing-backup' | 'backup-before-write';
    location: string | null;
  };
}

export async function previewApplyStructured(
  options: StructuredApplyPreviewOptions = {},
): Promise<StructuredApplyPreview> {
  const home = options.home ?? regletHome();
  const body = await previewApplyStructuredBody(options, home);
  return { ...body, digest: sha256String(stableStringify(body)) };
}

export async function applyStructuredPreview(
  expectedDigest: string,
  options: StructuredApplyPreviewOptions = {},
): Promise<StructuredApplyPreview> {
  const preview = await previewApplyStructured(options);
  if (preview.digest !== expectedDigest) {
    throw new Error(`Structured apply preview is stale: expected ${expectedDigest}, got ${preview.digest}`);
  }
  await applyAll({ providers: options.providers, contents: options.contents, home: options.home });
  return preview;
}

async function previewApplyStructuredBody(
  options: StructuredApplyPreviewOptions,
  home: string,
): Promise<Omit<StructuredApplyPreview, 'digest'>> {
  const config = await loadConfig(home);
  const master = await loadMasterDir(home);
  const providers = options.providers === undefined ? allAdapters() : options.providers.map((id) => getAdapter(id));
  const contents = options.contents ?? ['rules', 'skills', 'mcp'];
  const validationIssues = await collectValidationIssues(home);
  const entries: StructuredApplyPreviewEntry[] = [];

  for (const adapter of providers) {
    const providerConfig = config.providers[adapter.id];
    for (const content of contents) {
      if (!providerConfig.enabled || !providerConfig[content]) {
        entries.push(skipEntry(adapter.id, content, !providerConfig.enabled ? `${adapter.id} disabled` : `${adapter.id}:${content} unenrolled`));
        continue;
      }
      if (content === 'rules') entries.push(await previewRules(adapter, master.rules, home));
      if (content === 'skills') entries.push(...(await previewSkills(adapter, master, home)));
      if (content === 'mcp') entries.push(await previewMcp(adapter, master.mcpServers, home));
    }
  }

  return { version: 1, validationIssues, entries };
}

async function collectValidationIssues(home: string): Promise<string[]> {
  const issues: string[] = [];
  for (const server of (await listMcpServers(home)).servers) {
    issues.push(...server.issues.map((issue) => `mcp/${server.name}: ${issue}`));
  }
  const master = await loadMasterDir(home);
  for (const skill of [...master.skills, ...Object.values(master.providerSkills).flat()]) {
    if (!skill.files.some((file) => file.relPath === 'SKILL.md')) {
      issues.push(`skills/${skill.name}: missing SKILL.md`);
    }
  }
  return issues;
}

async function previewRules(
  adapter: ProviderAdapter,
  rules: { relPath: string; content: string }[],
  home: string,
): Promise<StructuredApplyPreviewEntry> {
  const outputPath = adapter.rulesPath();
  if (outputPath === null) return skipEntry(adapter.id, 'rules', `${adapter.id}:rules unsupported`);
  const before = await readOptionalFile(outputPath);
  const after = renderRulesFile(adapter.id, rules);
  return makeEntry(adapter.id, 'rules', 'write', outputPath, before, after, home);
}

async function previewSkills(
  adapter: ProviderAdapter,
  master: Awaited<ReturnType<typeof loadMasterDir>>,
  home: string,
): Promise<StructuredApplyPreviewEntry[]> {
  const skillsDir = adapter.skillsDir();
  if (skillsDir === null) return [skipEntry(adapter.id, 'skills', `${adapter.id}:skills unsupported`)];
  const resolved = new Map<string, string>();
  for (const skill of master.skills) resolved.set(skill.name, path.join(home, 'skills', skill.name));
  for (const skill of master.providerSkills[adapter.id]) resolved.set(skill.name, path.join(home, 'skills', adapter.id, skill.name));
  const entries: StructuredApplyPreviewEntry[] = [];
  for (const [name, sourceDir] of [...resolved.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const outputPath = path.join(skillsDir, name);
    entries.push(
      await makeEntry(
        adapter.id,
        'skills',
        'write',
        outputPath,
        await readDirectorySnapshot(outputPath),
        await readDirectorySnapshot(sourceDir),
        home,
      ),
    );
  }
  const manifest = await loadManifest(home);
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== adapter.id || output.content !== 'skills' || path.dirname(outputPath) !== skillsDir) continue;
    if (!resolved.has(path.basename(outputPath))) {
      entries.push(await makeEntry(adapter.id, 'skills', 'remove', outputPath, await readDirectorySnapshot(outputPath), null, home));
    }
  }
  return entries.length === 0 ? [skipEntry(adapter.id, 'skills', `${adapter.id}:skills no master skills`)] : entries;
}

async function previewMcp(
  adapter: ProviderAdapter,
  servers: Record<string, McpServerDef>,
  home: string,
): Promise<StructuredApplyPreviewEntry> {
  const outputPath = adapter.mcpPath();
  if (outputPath === null || adapter.applyMcp(servers, { dryRun: true }) === null) {
    return skipEntry(adapter.id, 'mcp', `${adapter.id}:mcp unsupported`);
  }
  const before = redactMcpSecrets(await readOptionalFile(outputPath), servers);
  const after = redactMcpSecrets(await renderMcpInSandbox(adapter, outputPath, home), servers);
  return makeEntry(adapter.id, 'mcp', 'write', outputPath, before, after, home);
}

async function renderMcpInSandbox(
  adapter: ProviderAdapter,
  outputPath: string,
  home: string,
): Promise<string | null> {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'reglet-preview-'));
  const sandboxHome = path.join(sandbox, 'reglet');
  const sandboxProviderHome = path.join(sandbox, 'provider');
  const relativeOutput = path.relative(providerHome(), outputPath);
  const sandboxOutput = path.join(sandboxProviderHome, relativeOutput);
  const previousProviderHome = process.env.REGLET_PROVIDER_HOME;
  try {
    await mkdir(path.join(sandboxHome, 'mcp'), { recursive: true });
    await copyIfPresent(path.join(home, 'reglet.toml'), path.join(sandboxHome, 'reglet.toml'));
    await copyIfPresent(path.join(home, 'mcp', 'servers.json'), path.join(sandboxHome, 'mcp', 'servers.json'));
    await copyIfPresent(outputPath, sandboxOutput);
    process.env.REGLET_PROVIDER_HOME = sandboxProviderHome;
    await applyAll({ providers: [adapter.id], contents: ['mcp'], home: sandboxHome });
    return readOptionalFile(sandboxOutput);
  } finally {
    if (previousProviderHome === undefined) delete process.env.REGLET_PROVIDER_HOME;
    else process.env.REGLET_PROVIDER_HOME = previousProviderHome;
    await rm(sandbox, { recursive: true, force: true });
  }
}

async function copyIfPresent(source: string, destination: string): Promise<void> {
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

function redactMcpSecrets(content: string | null, servers: Record<string, McpServerDef>): string | null {
  if (content === null) return null;
  let redacted = content;
  for (const server of Object.values(servers)) {
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (value.length === 0) continue;
      redacted = redacted.replaceAll(value, `<redacted:${key}>`);
    }
  }
  return redacted;
}

async function makeEntry(
  provider: ProviderId,
  content: ApplyContent,
  operation: 'write' | 'remove',
  outputPath: string,
  before: unknown,
  after: unknown,
  home: string,
): Promise<StructuredApplyPreviewEntry> {
  const previous = await getOutput(outputPath, home);
  return {
    provider,
    content,
    operation,
    path: outputPath,
    before,
    after,
    diff: unifiedDiff(formatPreviewValue(before), formatPreviewValue(after), outputPath),
    backup: previous?.backedUpTo
      ? { behavior: 'existing-backup', location: previous.backedUpTo }
      : before === null
        ? { behavior: 'none', location: null }
        : { behavior: 'backup-before-write', location: path.join(home, '.state', 'backups', provider) },
  };
}

function skipEntry(provider: ProviderId, content: ApplyContent, message: string): StructuredApplyPreviewEntry {
  return {
    provider,
    content,
    operation: 'skip',
    path: '',
    before: null,
    after: message,
    diff: '',
    backup: { behavior: 'none', location: null },
  };
}

async function readDirectorySnapshot(dirPath: string): Promise<Record<string, string> | null> {
  const result: Record<string, string> = {};
  async function visit(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      if (entry.isFile()) result[path.relative(dirPath, entryPath).split(path.sep).join('/')] = await readFile(entryPath, 'utf8');
    }
  }
  await visit(dirPath);
  return Object.keys(result).length === 0 ? null : result;
}

async function readOptionalFile(filePath: string | null): Promise<string | null> {
  if (filePath === null) return null;
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function formatPreviewValue(value: unknown): string {
  return typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
}

function unifiedDiff(before: string, after: string, label: string): string {
  if (before === after) return '';
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines = [`--- ${label}`, `+++ ${label}`];
  for (const line of beforeLines) if (!afterLines.includes(line)) lines.push(`-${line}`);
  for (const line of afterLines) if (!beforeLines.includes(line)) lines.push(`+${line}`);
  return `${lines.join('\n')}\n`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}
