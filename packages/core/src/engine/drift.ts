import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { assertPrivateFile, writePrivateJson, sha256File, sha256String } from '../fsutil.js';
import { loadManifest, type ManagedContent } from '../manifest.js';
import type { ResolvedMcpServerDef } from '../master.js';
import { resolveEffectiveMcpServersEnv } from '../mcp.js';
import { regletHome } from '../paths.js';
import { isNodeError, isRecord } from '../providers/common.js';
import type { ProviderId } from '../providers/types.js';

export type DriftStatus = 'clean' | 'modified' | 'missing';

export interface DriftRecord {
  outputPath: string;
  provider: string;
  content: ManagedContent;
  status: DriftStatus;
}

export interface DriftEvent extends DriftRecord {
  detectedAt: string;
}

export interface DriftQueue {
  version: 1;
  events: DriftEvent[];
}

export async function detectDrift(home = regletHome()): Promise<DriftRecord[]> {
  const manifest = await loadManifest(home);
  const records: DriftRecord[] = [];

  for (const [outputPath, output] of Object.entries(manifest.outputs)) {
    const exists = await pathExists(outputPath);
    if (!exists) {
      records.push({
        outputPath,
        provider: output.provider,
        content: output.content,
        status: 'missing',
      });
      continue;
    }

    const status =
      output.content === 'mcp' && isProviderId(output.provider)
        ? await detectMcpStatus(outputPath, output.provider, output.managedKeys ?? [], home)
        : ((await currentOutputHash(outputPath)) === output.hash ? 'clean' : 'modified');

    records.push({
      outputPath,
      provider: output.provider,
      content: output.content,
      status,
    });
  }

  return records;
}

export async function appendDriftEvent(event: DriftRecord, home = regletHome()): Promise<DriftQueue> {
  const queue = await listDriftEvents(home);
  queue.events.push({ ...event, detectedAt: new Date().toISOString() });
  await saveDriftQueue(queue, home);
  return queue;
}

export async function listDriftEvents(home = regletHome()): Promise<DriftQueue> {
  try {
    const targetPath = driftQueuePath(home);
    await assertPrivateFile(targetPath);
    const parsed = JSON.parse(await readFile(targetPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.events)) {
      return emptyDriftQueue();
    }

    return {
      version: 1,
      events: parsed.events.filter(isDriftEvent),
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return emptyDriftQueue();
    }
    throw error;
  }
}

export async function clearDriftEvents(home = regletHome()): Promise<void> {
  await saveDriftQueue(emptyDriftQueue(), home);
}

function driftQueuePath(home: string): string {
  return path.join(home, '.state', 'drift.json');
}

async function saveDriftQueue(queue: DriftQueue, home: string): Promise<void> {
  await writePrivateJson(driftQueuePath(home), queue);
}

function emptyDriftQueue(): DriftQueue {
  return { version: 1, events: [] };
}

async function detectMcpStatus(
  outputPath: string,
  provider: ProviderId,
  managedKeys: string[],
  home: string,
): Promise<DriftStatus> {
  const current = await readProviderMcpServers(outputPath, provider);
  const resolvedServers = await resolveEffectiveMcpServersEnv(provider, home);
  for (const key of managedKeys) {
    const resolved = resolvedServers[key];
    const expected = resolved === undefined ? undefined : convertMcpServer(provider, resolved);
    if (!deepEqual(current[key], expected)) {
      return 'modified';
    }
  }
  return 'clean';
}

async function readProviderMcpServers(outputPath: string, provider: ProviderId): Promise<Record<string, unknown>> {
  if (provider === 'codex') {
    const parsed = parseToml(await readFile(outputPath, 'utf8')) as unknown;
    return isRecord(parsed) && isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
  }

  const parsed = JSON.parse(await readFile(outputPath, 'utf8')) as unknown;
  if (!isRecord(parsed)) {
    return {};
  }

  if (provider === 'opencode') {
    return isRecord(parsed.mcp) ? parsed.mcp : {};
  }

  return isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
}

function convertMcpServer(provider: ProviderId, server: ResolvedMcpServerDef): unknown {
  if (provider === 'opencode') {
    if (server.url !== undefined && server.command === undefined) {
      return { type: 'remote', url: server.url };
    }
    return {
      type: 'local',
      command: [server.command ?? '', ...(server.args ?? [])],
      ...(server.env === undefined ? {} : { environment: server.env }),
    };
  }

  return {
    ...(server.command === undefined ? {} : { command: server.command }),
    ...(server.url === undefined ? {} : { url: server.url }),
    ...(server.args === undefined ? {} : { args: server.args }),
    ...(server.env === undefined ? {} : { env: server.env }),
  };
}

async function currentOutputHash(outputPath: string): Promise<string> {
  const outputStat = await stat(outputPath);
  if (outputStat.isDirectory()) {
    return hashDirectory(outputPath);
  }
  return sha256File(outputPath);
}

async function hashDirectory(dirPath: string): Promise<string> {
  const parts: string[] = [];

  async function visit(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (entry.isFile()) {
        const relPath = path.relative(dirPath, entryPath).split(path.sep).join('/');
        parts.push(`${relPath}\0${await readFile(entryPath, 'utf8')}`);
      }
    }
  }

  await visit(dirPath);
  return sha256String(parts.join('\0'));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isDriftEvent(value: unknown): value is DriftEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.outputPath === 'string' &&
    typeof value.provider === 'string' &&
    (value.content === 'rules' || value.content === 'skills' || value.content === 'mcp') &&
    (value.status === 'clean' || value.status === 'modified' || value.status === 'missing') &&
    typeof value.detectedAt === 'string'
  );
}

function isProviderId(value: string): value is ProviderId {
  return (
    value === 'claude' ||
    value === 'codex' ||
    value === 'cursor' ||
    value === 'gemini' ||
    value === 'windsurf' ||
    value === 'opencode'
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}
