import { readFile } from 'node:fs/promises';
import { safeWriteFile } from '../engine/writer.js';
import type { ManagedContent } from '../manifest.js';
import { getOutput } from '../manifest.js';
import type { McpServerDef } from '../master.js';
import { isNodeError, isRecord } from './common.js';
import type { ApplyContext, ApplyResult } from './types.js';

interface OpenCodeConfig {
  $schema?: string;
  mcp: Record<string, unknown>;
}

interface OpenCodeLocalServer {
  type: 'local';
  command: string[];
  environment?: Record<string, string>;
}

interface OpenCodeRemoteServer {
  type: 'remote';
  url: string;
}

type OpenCodeServer = OpenCodeLocalServer | OpenCodeRemoteServer;

const openCodeSchema = 'https://opencode.ai/config.json';

export async function applyOpenCodeMcp(
  outputPath: string,
  servers: Record<string, McpServerDef>,
  ctx: ApplyContext,
): Promise<ApplyResult> {
  const previous = await getOutput(outputPath);
  const previousManagedKeys = previous?.managedKeys ?? [];
  const baseConfig = await readJsonObject(outputPath);
  const existingServers = isRecord(baseConfig.mcp) ? { ...baseConfig.mcp } : {};

  for (const key of previousManagedKeys) {
    delete existingServers[key];
  }

  for (const [name, server] of Object.entries(servers)) {
    existingServers[name] = toOpenCodeServer(server);
  }

  const nextConfig: OpenCodeConfig & Record<string, unknown> = {
    $schema: typeof baseConfig.$schema === 'string' ? baseConfig.$schema : openCodeSchema,
    ...baseConfig,
    mcp: existingServers,
  };
  const managedKeys = Object.keys(servers).sort((left, right) => left.localeCompare(right));
  const content = `${JSON.stringify(nextConfig, null, 2)}\n`;

  const writeResult = await safeWriteFile({
    outputPath,
    content,
    provider: 'opencode',
    managedContent: 'mcp' satisfies ManagedContent,
    dryRun: ctx.dryRun,
    managedKeys,
  });

  return {
    provider: 'opencode',
    content: 'mcp',
    outputPath,
    status: writeResult.status,
    managedKeys,
  };
}

export async function readOpenCodeMcpServerNames(outputPath: string | null): Promise<string[]> {
  if (outputPath === null) {
    return [];
  }

  const config = await readJsonObject(outputPath);
  if (!isRecord(config.mcp)) {
    return [];
  }

  return Object.keys(config.mcp).sort((left, right) => left.localeCompare(right));
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

function toOpenCodeServer(server: McpServerDef): OpenCodeServer {
  if (server.url !== undefined && server.command === undefined) {
    return {
      type: 'remote',
      url: server.url,
    };
  }

  const command = server.command ?? '';
  return {
    type: 'local',
    command: [command, ...(server.args ?? [])],
    ...(server.env === undefined ? {} : { environment: server.env }),
  };
}
