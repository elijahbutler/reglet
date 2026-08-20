import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { renderRulesFile } from '../header.js';
import { getOutput, loadManifest } from '../manifest.js';
import { loadMasterDir, type McpServerDef, type ResolvedMcpServerDef } from '../master.js';
import { effectiveMcpEnvironmentDigest, listEffectiveMcpServers, listMcpServers, providerMcpScope, redactMcpCredentialArgumentsInText, resolveEffectiveMcpServersEnv } from '../mcp.js';
import { providerHome, regletHome } from '../paths.js';
import { allAdapters, getAdapter } from '../providers/registry.js';
import type { ProviderAdapter, ProviderId } from '../providers/types.js';
import { sha256String } from '../fsutil.js';
import { applyAll, type ApplyContent } from './apply.js';
import { detectDrift, type DriftStatus } from './drift.js';
import type { OperationReceipt } from './operations.js';
import { deriveMasterRevisions } from '../revisions.js';
import { systemSecretStore } from '../security/secrets.js';

export interface StructuredApplyPreviewOptions {
  providers?: ProviderId[];
  contents?: ApplyContent[];
  home?: string;
  providerHome?: string;
}

export interface StructuredApplyPreview {
  version: 1;
  digest: string;
  masterRevision: string;
  validationIssues: string[];
  entries: StructuredApplyPreviewEntry[];
}

export interface StructuredApplyResult {
  preview: StructuredApplyPreview;
  receipt: OperationReceipt;
}

export interface StructuredApplyPreviewEntry {
  provider: ProviderId;
  content: ApplyContent;
  operation: 'write' | 'remove' | 'skip';
  path: string;
  before: unknown;
  after: unknown;
  diff: string;
  /** SHA-256 of the exact target state that this plan expects, never its raw content. */
  expectedTargetHash: string | null;
  /** SHA-256 of the exact rendered target state, never its raw content. */
  resultingTargetHash: string | null;
  compositionRevision: string | null;
  driftStatus: DriftStatus | 'unmanaged' | 'not-applicable';
  snapshot: {
    behavior: 'snapshot-before-write' | 'record-absence' | 'none';
    /** The receipt-scoped location pattern; the receipt id is assigned at apply time. */
    location: string | null;
  };
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
  const compositionBody = {
    version: body.version,
    validationIssues: body.validationIssues,
    entries: body.entries,
  };
  const providers = options.providers ?? allAdapters().map((adapter) => adapter.id);
  const includesMcp = (options.contents ?? ['rules', 'skills', 'mcp']).includes('mcp');
  return {
    ...body,
    digest: sha256String(stableStringify({
      body: compositionBody,
      processEnv: includesMcp ? await previewProcessEnvDigest(home, providers) : {},
    })),
  };
}

export async function applyStructuredPreview(
  expectedDigest: string,
  options: StructuredApplyPreviewOptions = {},
): Promise<StructuredApplyResult> {
  const preview = await previewApplyStructured(options);
  if (preview.validationIssues.length > 0) {
    throw new Error(`Structured apply preview has validation issues: ${preview.validationIssues.join('; ')}`);
  }
  if (preview.digest !== expectedDigest) {
    throw new Error(`Structured apply preview is stale: expected ${expectedDigest}, got ${preview.digest}`);
  }
  const report = await applyAll({
    providers: options.providers,
    contents: options.contents,
    home: options.home,
    providerHome: options.providerHome,
    reviewedReplacement: true,
    structuredPreviewDigest: preview.digest,
  });
  if (report.receipt === undefined) {
    throw new Error('Structured apply did not create an operation receipt');
  }
  return { preview, receipt: report.receipt };
}

async function previewApplyStructuredBody(
  options: StructuredApplyPreviewOptions,
  home: string,
): Promise<Omit<StructuredApplyPreview, 'digest'>> {
  const config = await loadConfig(home);
  const master = await loadMasterDir(home);
  const revisions = await deriveMasterRevisions(master, config);
  const providers = options.providers === undefined ? allAdapters() : options.providers.map((id) => getAdapter(id));
  const contents = options.contents ?? ['rules', 'skills', 'mcp'];
  const validationIssues = await collectValidationIssues(home, providers, contents);
  const driftByPath = new Map<string, DriftStatus>(
    (await detectDrift(home, {
      providers: providers.map((provider) => provider.id),
      contents,
    })).map((record): [string, DriftStatus] => [record.outputPath, record.status]),
  );
  const entries: StructuredApplyPreviewEntry[] = [];

  for (const adapter of providers) {
    const providerConfig = config.providers[adapter.id];
    for (const content of contents) {
      if (!providerConfig.enabled || !providerConfig[content]) {
        entries.push(skipEntry(adapter.id, content, !providerConfig.enabled ? `${adapter.id} disabled` : `${adapter.id}:${content} unenrolled`));
        continue;
      }
      if (content === 'rules') {
        entries.push(await previewRules(adapter, [...master.rules, ...master.providerRules[adapter.id]], home, driftByPath, revisions.compositionRevisions[adapter.id].rules, options.providerHome));
      }
      if (content === 'skills') entries.push(...(await previewSkills(adapter, master, config, home, driftByPath, revisions.compositionRevisions[adapter.id].skills, options.providerHome)));
      if (content === 'mcp') entries.push(await previewMcp(adapter, home, driftByPath, validationIssues, revisions.compositionRevisions[adapter.id].mcp, options.providerHome));
    }
  }

  return { version: 1, masterRevision: revisions.masterRevision, validationIssues, entries };
}

async function collectValidationIssues(
  home: string,
  providers: readonly ProviderAdapter[],
  contents: readonly ApplyContent[],
): Promise<string[]> {
  const issues: string[] = [];
  if (contents.includes('mcp')) {
    for (const server of (await listMcpServers(home)).servers) {
      issues.push(...server.issues.map((issue) => `mcp/${server.id}: ${issue}`));
    }
    for (const adapter of providers) {
      for (const server of (await listMcpServers(providerMcpScope(adapter.id), home)).servers) {
        issues.push(...server.issues.map((issue) => `mcp/${adapter.id}/${server.id}: ${issue}`));
      }
      const conflict = (await listEffectiveMcpServers(adapter.id, home)).find((entry) => entry.conflictStatus.state === 'conflict');
      if (conflict !== undefined && conflict.conflictStatus.state === 'conflict') {
        issues.push(`mcp/${adapter.id}: display-name conflict ${conflict.conflictStatus.displayName} (${conflict.conflictStatus.conflictingIds.join(', ')})`);
      }
      try {
        await resolveEffectiveMcpServersEnv(adapter.id, home);
      } catch (error) {
        issues.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  if (contents.includes('skills')) {
    const master = await loadMasterDir(home);
    for (const skill of [...master.skills, ...Object.values(master.providerSkills).flat()]) {
      if (!skill.files.some((file) => file.relPath === 'SKILL.md')) {
        issues.push(`skills/${skill.name}: missing SKILL.md`);
      }
    }
  }
  return issues;
}

async function previewRules(
  adapter: ProviderAdapter,
  rules: { relPath: string; content: string }[],
  home: string,
  driftByPath: ReadonlyMap<string, DriftStatus>,
  compositionRevision: string,
  providerRoot: string | undefined,
): Promise<StructuredApplyPreviewEntry> {
  const outputPath = adapter.rulesPath(providerRoot);
  if (outputPath === null) return skipEntry(adapter.id, 'rules', `${adapter.id}:rules unsupported`);
  const before = await readOptionalFile(outputPath);
  const after = renderRulesFile(adapter.id, rules);
  return makeEntry(adapter.id, 'rules', 'write', outputPath, before, after, home, driftByPath.get(outputPath) ?? 'unmanaged', compositionRevision);
}

async function previewSkills(
  adapter: ProviderAdapter,
  master: Awaited<ReturnType<typeof loadMasterDir>>,
  config: Awaited<ReturnType<typeof loadConfig>>,
  home: string,
  driftByPath: ReadonlyMap<string, DriftStatus>,
  compositionRevision: string,
  providerRoot: string | undefined,
): Promise<StructuredApplyPreviewEntry[]> {
  const skillsDir = adapter.skillsDir(providerRoot);
  if (skillsDir === null) return [skipEntry(adapter.id, 'skills', `${adapter.id}:skills unsupported`)];
  const resolved = new Map<string, string>();
  for (const skill of master.skills) {
    const syncProviders = skill.targets ?? config.contentSync.skills[skill.name];
    if (syncProviders === undefined || syncProviders.includes(adapter.id)) {
      resolved.set(skill.name, path.join(home, 'skills', skill.name));
    }
  }
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
        driftByPath.get(outputPath) ?? 'unmanaged',
        compositionRevision,
      ),
    );
  }
  const manifest = await loadManifest(home);
  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    if (output.provider !== adapter.id || output.content !== 'skills' || path.dirname(outputPath) !== skillsDir) continue;
    if (!resolved.has(path.basename(outputPath))) {
      entries.push(
        await makeEntry(
          adapter.id,
          'skills',
          'remove',
          outputPath,
          await readDirectorySnapshot(outputPath),
          null,
          home,
          driftByPath.get(outputPath) ?? 'unmanaged',
          compositionRevision,
        ),
      );
    }
  }
  return entries.length === 0 ? [skipEntry(adapter.id, 'skills', `${adapter.id}:skills no master skills`)] : entries;
}

async function previewMcp(
  adapter: ProviderAdapter,
  home: string,
  driftByPath: ReadonlyMap<string, DriftStatus>,
  validationIssues: readonly string[],
  compositionRevision: string,
  providerRootOverride: string | undefined,
): Promise<StructuredApplyPreviewEntry> {
  const providerRoot = providerRootOverride ?? providerHome();
  const outputPath = adapter.mcpPath(providerRoot);
  if (outputPath === null) {
    return skipEntry(adapter.id, 'mcp', `${adapter.id}:mcp unsupported`);
  }
  if (validationIssues.some((issue) => issue.startsWith('mcp/') && !isOtherProviderMcpIssue(issue, adapter.id))) {
    return skipEntry(adapter.id, 'mcp', `${adapter.id}:mcp blocked by validation`);
  }
  const effectiveServers = await listEffectiveMcpServers(adapter.id, home);
  const redactionServers = Object.fromEntries(effectiveServers.map((entry) => [entry.displayName, entry.server]));
  let resolvedServers: Record<string, ResolvedMcpServerDef>;
  try {
    resolvedServers = await resolveEffectiveMcpServersEnv(adapter.id, home);
  } catch {
    return skipEntry(adapter.id, 'mcp', `${adapter.id}:mcp blocked by validation`);
  }
  if (adapter.applyMcp(resolvedServers, { dryRun: true, home, providerHome: providerRoot }) === null) {
    return skipEntry(adapter.id, 'mcp', `${adapter.id}:mcp unsupported`);
  }
  const rawBefore = await readOptionalFile(outputPath);
  const rawAfter = await renderMcpInSandbox(adapter, outputPath, home, providerRoot);
  const before = await redactMcpSecrets(rawBefore, redactionServers);
  const after = await redactMcpSecrets(rawAfter, redactionServers);
  return makeEntry(
    adapter.id,
    'mcp',
    'write',
    outputPath,
    before,
    after,
    home,
    driftByPath.get(outputPath) ?? 'unmanaged',
    compositionRevision,
    rawBefore,
    rawAfter,
  );
}

function isOtherProviderMcpIssue(issue: string, provider: ProviderId): boolean {
  const scopedProvider = issue.match(/^mcp\/(claude|codex|cursor|gemini|windsurf|opencode)(?:\/|:)/)?.[1];
  return scopedProvider !== undefined && scopedProvider !== provider;
}

async function renderMcpInSandbox(
  adapter: ProviderAdapter,
  outputPath: string,
  home: string,
  providerRoot: string,
): Promise<string | null> {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'reglet-preview-'));
  const sandboxHome = path.join(sandbox, 'reglet');
  const sandboxProviderHome = path.join(sandbox, 'provider');
  const relativeOutput = path.relative(providerRoot, outputPath);
  const sandboxOutput = path.join(sandboxProviderHome, relativeOutput);
  try {
    await mkdir(path.join(sandboxHome, 'mcp'), { recursive: true });
    await copyIfPresent(path.join(home, 'reglet.toml'), path.join(sandboxHome, 'reglet.toml'));
    await copyIfPresent(path.join(home, 'mcp', 'servers.json'), path.join(sandboxHome, 'mcp', 'servers.json'));
    await copyIfPresent(path.join(home, 'mcp', 'providers'), path.join(sandboxHome, 'mcp', 'providers'));
    await copyIfPresent(outputPath, sandboxOutput);
    await applyAll({ providers: [adapter.id], contents: ['mcp'], home: sandboxHome, providerHome: sandboxProviderHome });
    return readOptionalFile(sandboxOutput);
  } finally {
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

async function redactMcpSecrets(
  content: string | null,
  servers: Record<string, McpServerDef>,
): Promise<string | null> {
  if (content === null) return null;
  let redacted = redactMcpCredentialArgumentsInText(redactLikelyEnvironmentValues(content));
  const secretStore = systemSecretStore();
  for (const server of Object.values(servers)) {
    for (const [key, ref] of Object.entries(server.env ?? {})) {
      const replacement = `<redacted:${key}>`;
      const resolvedValue = ref.source === 'process-env'
        ? process.env[ref.name]
        : await secretStore.resolve(ref.id);
      if (resolvedValue !== undefined && resolvedValue.length > 0) {
        redacted = redacted.replaceAll(resolvedValue, replacement);
      }
      redacted = redactJsonEnvValue(redacted, key, replacement);
      redacted = redactTomlEnvValue(redacted, key, replacement);
    }
  }
  return redacted;
}

/**
 * Legacy raw MCP entries are intentionally omitted from the typed master
 * model, so their key names are not available to the normal typed-redaction
 * pass. Scrub every conventional environment-variable assignment as a final
 * defense before any preview leaves this process.
 */
function redactLikelyEnvironmentValues(content: string): string {
  const json = content.replace(
    /("[A-Z_][A-Z0-9_]*"\s*:\s*)"(?:\\.|[^"\\])*"/g,
    '$1"<redacted:environment>"',
  );
  return json.replace(
    /^(\s*[A-Z_][A-Z0-9_]*\s*=\s*)"(?:\\.|[^"\\])*"\s*$/gm,
    '$1"<redacted:environment>"',
  );
}

async function previewProcessEnvDigest(home: string, providers: readonly ProviderId[]): Promise<Record<string, unknown>> {
  return Object.fromEntries(
    await Promise.all(
      providers.map(async (provider) => [
        provider,
        effectiveMcpEnvironmentDigest(await listEffectiveMcpServers(provider, home)),
      ] as const),
    ),
  );
}

function redactJsonEnvValue(content: string, key: string, replacement: string): string {
  return content.replace(
    new RegExp(`("${escapeRegExp(key)}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, 'g'),
    `$1"${replacement}"`,
  );
}

function redactTomlEnvValue(content: string, key: string, replacement: string): string {
  return content.replace(
    new RegExp(`(\\b${escapeRegExp(key)}\\b\\s*=\\s*)"(?:\\\\.|[^"\\\\])*"`, 'g'),
    `$1"${replacement}"`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function makeEntry(
  provider: ProviderId,
  content: ApplyContent,
  operation: 'write' | 'remove',
  outputPath: string,
  before: unknown,
  after: unknown,
  home: string,
  driftStatus: DriftStatus | 'unmanaged',
  compositionRevision: string,
  rawBefore: unknown = before,
  rawAfter: unknown = after,
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
    expectedTargetHash: fingerprintTarget(rawBefore),
    resultingTargetHash: fingerprintTarget(rawAfter),
    compositionRevision,
    driftStatus,
    snapshot: before === null
      ? { behavior: 'record-absence', location: null }
      : {
          behavior: 'snapshot-before-write',
          location: path.join(home, '.state', 'operations', 'snapshots', '<receipt-id>', encodeURIComponent(outputPath)),
        },
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
    expectedTargetHash: null,
    resultingTargetHash: null,
    compositionRevision: null,
    driftStatus: 'not-applicable',
    snapshot: { behavior: 'none', location: null },
    backup: { behavior: 'none', location: null },
  };
}

function fingerprintTarget(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return sha256String(typeof value === 'string' ? value : stableStringify(value));
}

async function readDirectorySnapshot(dirPath: string): Promise<Record<string, string> | null> {
  const result: Record<string, string> = {};
  async function visit(current: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      if (entry.isFile()) result[path.relative(dirPath, entryPath).split(path.sep).join('/')] = await readFile(entryPath, 'utf8');
    }
    return true;
  }
  return (await visit(dirPath)) ? result : null;
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
