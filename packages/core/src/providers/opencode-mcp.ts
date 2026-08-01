import { readFile } from 'node:fs/promises';
import { safeWriteFile } from '../engine/writer.js';
import { getOutput } from '../manifest.js';
import type { McpServerDef } from '../master.js';
import { isNodeError, isRecord } from './common.js';
import type { ApplyContext, ApplyResult } from './types.js';

export async function applyOpenCodeMcp(
  outputPath: string,
  servers: Record<string, McpServerDef>,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const previous = await getOutput(outputPath, ctx.home);
  const existing = await readJsonObject(outputPath);
  const existingServers = isRecord(existing.mcp) ? { ...existing.mcp } : {};
  for (const key of previous?.managedKeys ?? []) {
    delete existingServers[key];
  }
  const rendered = Object.fromEntries(
    Object.entries(servers).map(([name, definition]) => [
      name,
      renderOpenCodeDefinition(definition),
    ]),
  );
  const managedKeys = Object.keys(servers).sort((left, right) =>
    left.localeCompare(right),
  );
  const content = `${JSON.stringify(
    { ...existing, mcp: { ...existingServers, ...rendered } },
    null,
    2,
  )}\n`;
  const write = await safeWriteFile({
    outputPath,
    content,
    provider: 'opencode',
    managedContent: 'mcp',
    dryRun: ctx.dryRun,
    managedKeys,
    home: ctx.home,
  });
  return {
    provider: 'opencode',
    content: 'mcp',
    outputPath,
    status: write.status,
    managedKeys,
    ...(ctx.dryRun
      ? {
          desiredHash: write.hash,
          appliedHash: write.appliedHash,
          observedHash: write.observedHash,
          appliedAt: write.appliedAt,
        }
      : {}),
  };
}

export async function readOpenCodeMcpServerNames(
  outputPath: string | null,
): Promise<string[]> {
  if (outputPath === null) {
    return [];
  }
  const value = await readJsonObject(outputPath);
  return isRecord(value.mcp)
    ? Object.keys(value.mcp).sort((left, right) => left.localeCompare(right))
    : [];
}

function renderOpenCodeDefinition(server: McpServerDef): Record<string, unknown> {
  if (server.transport === 'http' || (server.url !== undefined && server.command === undefined)) {
    return {
      type: 'remote',
      url: server.url ?? '',
      ...(server.headers !== undefined && Object.keys(server.headers).length > 0
        ? { headers: server.headers }
        : {}),
    };
  }
  return {
    type: 'local',
    command: [server.command ?? '', ...(server.args ?? [])],
    ...(server.env !== undefined && Object.keys(server.env).length > 0
      ? { environment: server.env }
      : {}),
    ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
  };
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}
