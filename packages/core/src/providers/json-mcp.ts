import { readFile } from 'node:fs/promises';
import type { ManagedContent } from '../manifest.js';
import type { McpServerDef } from '../master.js';
import type { ApplyContext, ApplyResult, ProviderId } from './types.js';
import { isNodeError, isRecord } from './common.js';
import { getOutput } from '../manifest.js';
import { safeWriteFile } from '../engine/writer.js';

interface JsonMcpFile {
  mcpServers: Record<string, McpServerDef>;
}

export async function applyJsonMcp(
  provider: ProviderId,
  outputPath: string,
  servers: Record<string, McpServerDef>,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const previous = await getOutput(outputPath, ctx.home);
  const previousManagedKeys = previous?.managedKeys ?? [];
  const baseConfig = await readJsonObject(outputPath);
  const existingServers = isRecord(baseConfig.mcpServers) ? { ...baseConfig.mcpServers } : {};

  for (const key of previousManagedKeys) {
    delete existingServers[key];
  }

  const renderedServers = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      renderStandardMcpDefinition(server),
    ]),
  );
  const nextServers: Record<string, unknown> = {
    ...existingServers,
    ...renderedServers,
  };
  const nextConfig: JsonMcpFile & Record<string, unknown> = {
    ...baseConfig,
    mcpServers: nextServers as Record<string, McpServerDef>,
  };
  const managedKeys = Object.keys(servers).sort((left, right) => left.localeCompare(right));
  const content = `${JSON.stringify(nextConfig, null, 2)}\n`;

  const writeResult = await safeWriteFile({
    outputPath,
    content,
    provider,
    managedContent: 'mcp' satisfies ManagedContent,
    dryRun: ctx.dryRun,
    managedKeys,
    home: ctx.home,
  });

  return {
    provider,
    content: 'mcp',
    outputPath,
    status: writeResult.status,
    managedKeys,
    ...(ctx.dryRun
      ? {
          desiredHash: writeResult.hash,
          appliedHash: writeResult.appliedHash,
          observedHash: writeResult.observedHash,
          appliedAt: writeResult.appliedAt,
        }
      : {}),
  };
}

function renderStandardMcpDefinition(
  server: McpServerDef,
): Record<string, unknown> {
  if (server.transport === 'http' || (server.url !== undefined && server.command === undefined)) {
    return {
      type: 'http',
      url: server.url ?? '',
      ...(server.headers !== undefined && Object.keys(server.headers).length > 0
        ? { headers: server.headers }
        : {}),
    };
  }
  return {
    command: server.command ?? '',
    args: server.args ?? [],
    ...(server.cwd === undefined ? {} : { cwd: server.cwd }),
    ...(server.env !== undefined && Object.keys(server.env).length > 0
      ? { env: server.env }
      : {}),
  };
}

export async function readJsonMcpServerNames(outputPath: string | null): Promise<string[]> {
  if (outputPath === null) {
    return [];
  }

  const config = await readJsonObject(outputPath);
  if (!isRecord(config.mcpServers)) {
    return [];
  }

  return Object.keys(config.mcpServers).sort((left, right) => left.localeCompare(right));
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
